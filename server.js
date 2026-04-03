#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server v4.1
 * Fixes from Senior Dev Audit:
 * ✅ [CRIT-2.2] IP removed from console.log — privacy fix
 * ✅ [CRIT-2.3] SQLite (database.js) integration via USE_SQLITE=1 env
 * ✅ [CRIT-2.5] handleRegister now calls setUserId — ws.close cleanup fixed
 * ✅ [CRIT-2.6] WebSocket maxPayload 25MB + runtime size guard
 * ✅ [SERIOUS-3.5] messageQueue persisted to queue.json (survives restart)
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, 'users.json');
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(__dirname, 'queue.json');
const ROOMS_FILE = process.env.ROOMS_FILE || path.join(__dirname, 'rooms.json');

// ==================== SQLITE INTEGRATION ====================
// Launch with: USE_SQLITE=1 node server.js  (or set in render.yaml)
const USE_SQLITE = process.env.USE_SQLITE === '1';
let dbModule = null;

if (USE_SQLITE) {
  try {
    dbModule = require('./database.js');
    dbModule.openDatabase();
    console.log('✅ Storage: SQLite (SQLCipher AES-256)');
  } catch (e) {
    console.error('❌ Failed to load database.js:', e.message);
    console.error('   Falling back to JSON storage.');
  }
}

if (!USE_SQLITE || !dbModule) {
  console.log('💾 Storage: JSON files');
}

// ==================== HELPERS ====================
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

/** Единый формат UUID пользователя (клиенты шлют с разным регистром) */
function normUid(s) {
  return String(s || '').trim().toLowerCase().replace(/-/g, '');
}

function getUserLive(id) {
  if (!id) return null;
  const n = normUid(id);
  let u = users.get(id) || users.get(n);
  if (u) return u;
  for (const [k, v] of users) {
    if (normUid(k) === n) return v;
  }
  return null;
}

/** Нормализовать участников комнаты (регистр + дедуп) */
function normalizeRoom(room) {
  if (!room) return;
  room.owner = normUid(room.owner);
  room.members = [...new Set((room.members || []).map(normUid))];
  const adm = [...new Set((room.admins || []).map(normUid))].filter((a) => a && a !== room.owner);
  room.admins = adm;
}

// PBKDF2 password hashing (100k rounds SHA-512)
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pwd, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  try {
    if (stored.startsWith('pbkdf2:')) {
      const [, salt, hash] = stored.split(':');
      const computed = crypto.pbkdf2Sync(pwd, salt, 100000, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
    } else {
      // Legacy SHA-256 — will be upgraded on next login
      const legacy = crypto.createHash('sha256').update(pwd).digest('hex');
      return legacy === stored;
    }
  } catch {
    return false;
  }
}

// ==================== IN-MEMORY STORE ====================
// ws connections always in memory; persistent data goes to SQLite or JSON
const users = new Map(); // uuid -> { ws, uuid, nickname, avatar, lastSeen, password }
const messageQueue = new Map(); // uuid -> [{ from, to, content, ts, type }, ...]
/** roomId -> { id, title, kind: 'group'|'channel', owner, members: string[], admins?: string[], username?: string } */
const rooms = new Map();
/** публичный @username канала (нормализованный) -> roomId */
const channelUsernames = new Map();

function normalizeChannelUsername(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase().replace(/^@+/, '');
  s = s.replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 32);
}

function rebuildChannelUsernameIndex() {
  channelUsernames.clear();
  for (const [, room] of rooms) {
    if (room.kind === 'channel' && room.username) {
      channelUsernames.set(String(room.username).toLowerCase(), room.id);
    }
  }
}

// ==================== STORAGE ABSTRACTION ====================
function getUserFromStore(uuid) {
  if (dbModule) {
    const row = dbModule.getUser(uuid);
    if (!row) return null;
    // Merge DB record with live ws from memory
    const mem = users.get(uuid);
    return { ...row, ws: mem?.ws || null };
  }
  return users.get(uuid) || null;
}

function saveUserToStore(user) {
  // Always keep ws reference in memory
  const existing = users.get(user.uuid) || {};
  users.set(user.uuid, { ...existing, ...user });

  if (dbModule) {
    dbModule.saveUser(user);
  } else {
    saveUsersJSON();
  }
}

function enqueueMessageToStore(message) {
  const key = normUid(message.to);
  if (dbModule) {
    dbModule.enqueueMessage({ ...message, to: key });
  } else {
    if (!messageQueue.has(key)) messageQueue.set(key, []);
    messageQueue.get(key).push({ ...message, to: key });
    saveQueueJSON();
  }
}

function dequeueMessagesFromStore(uuid) {
  const n = normUid(uuid);
  if (dbModule) {
    return dbModule.dequeueMessages(n);
  }
  const msgs = [];
  for (const [k, arr] of [...messageQueue.entries()]) {
    if (!arr?.length) continue;
    if (normUid(k) === n) {
      msgs.push(...arr);
      messageQueue.delete(k);
    }
  }
  if (msgs.length) saveQueueJSON();
  return msgs;
}

// ==================== RATE LIMITING ====================
const regAttempts = new Map(); // ip -> { count, resetAt }
const loginAttempts = new Map(); // ip -> { count, resetAt }

function checkRateLimit(map, ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const rec = map.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
  rec.count++;
  map.set(ip, rec);
  return rec.count <= limit;
}

// Cleanup rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of regAttempts) if (now > rec.resetAt) regAttempts.delete(ip);
  for (const [ip, rec] of loginAttempts) if (now > rec.resetAt) loginAttempts.delete(ip);
}, 5 * 60 * 1000);

// ==================== JSON PERSISTENCE ====================
function saveUsersJSON() {
  if (dbModule) return; // SQLite handles it
  const data = {};
  for (const [uuid, user] of users) {
    data[uuid] = { uuid: user.uuid, nickname: user.nickname, avatar: user.avatar, password: user.password, lastSeen: user.lastSeen };
  }
  const tmp = USERS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, USERS_FILE);
  } catch (e) {
    console.error('💾 Save users error:', e.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function loadUsersJSON() {
  if (dbModule) return; // SQLite loaded via openDatabase()
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [uuid, user] of Object.entries(data)) {
        users.set(uuid, { ...user, ws: null });
      }
      console.log(`✓ Loaded ${users.size} users from JSON`);
    }
  } catch (e) {
    console.error('💾 Load users error:', e.message);
    // Try backup
    const backup = USERS_FILE + '.bak';
    if (fs.existsSync(backup)) {
      try {
        const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
        for (const [uuid, user] of Object.entries(data)) {
          users.set(uuid, { ...user, ws: null });
        }
        console.log(`✓ Loaded ${users.size} users from backup`);
      } catch (e2) {
        console.error('💾 Backup load error:', e2.message);
      }
    }
  }
}

// ==================== QUEUE PERSISTENCE (JSON fallback) ====================
function saveQueueJSON() {
  if (dbModule) return;
  const data = {};
  for (const [uuid, msgs] of messageQueue) data[uuid] = msgs;
  const tmp = QUEUE_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (e) {
    console.error('💾 Queue save error:', e.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function loadQueueJSON() {
  if (dbModule) return;
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      for (const [uuid, msgs] of Object.entries(data)) {
        messageQueue.set(uuid, msgs);
      }
      console.log(`✓ Loaded ${messageQueue.size} queued conversations from JSON`);
    }
  } catch (e) {
    console.error('💾 Queue load error:', e.message);
  }
}

function saveRoomsJSON() {
  if (dbModule) return;
  const data = {};
  for (const [id, room] of rooms) {
    data[id] = { ...room, members: [...room.members] };
  }
  const tmp = ROOMS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, ROOMS_FILE);
  } catch (e) {
    console.error('💾 Save rooms error:', e.message);
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function loadRoomsJSON() {
  if (dbModule) return;
  try {
    if (fs.existsSync(ROOMS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
      for (const [id, room] of Object.entries(data)) {
        const r = {
          id,
          title: room.title || id.slice(0, 8),
          kind: room.kind === 'channel' ? 'channel' : 'group',
          owner: room.owner,
          members: Array.isArray(room.members) ? room.members : [],
          admins: Array.isArray(room.admins) ? room.admins : [],
          username: room.username || undefined,
          avatar: room.avatar || ''
        };
        normalizeRoom(r);
        rooms.set(id, r);
      }
      rebuildChannelUsernameIndex();
      console.log(`✓ Loaded ${rooms.size} rooms from JSON`);
    }
  } catch (e) {
    console.error('💾 Load rooms error:', e.message);
  }
}

// Backup users every 5 minutes (JSON mode only)
setInterval(() => {
  if (!dbModule && fs.existsSync(USERS_FILE)) {
    try { fs.copyFileSync(USERS_FILE, USERS_FILE + '.bak'); } catch {}
  }
}, 5 * 60 * 1000);

// ==================== HTTP SERVER ====================
const app = http.createServer((req, res) => {
  if (req.url === '/health') {
    const online = Array.from(users.values()).filter(u => u.ws && u.ws.readyState === WebSocket.OPEN).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      users: users.size,
      online,
      queued: messageQueue.size,
      uptime: Math.floor(process.uptime()),
      storage: dbModule ? 'sqlite' : 'json'
    }));
    return;
  }

  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`Cipher Messenger Server v4.1\nUsers: ${users.size}\nUptime: ${process.uptime().toFixed(0)}s`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ==================== WEBSOCKET SERVER ====================
// [FIX-2.6] maxPayload set to 25MB to prevent OOM crash
const wss = new WebSocket.Server({
  server: app,
  perMessageDeflate: false,
  maxPayload: 25 * 1024 * 1024 // 25 MB hard limit
});

wss.on('connection', (ws, req) => {
  let userId = null;
  ws.isAlive = true;

  // [FIX-2.2] IP kept ONLY for rate-limiting, never logged to console
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  // [FIX-2.2] No IP in log
  console.log(`📡 New connection established`);

  // Send ready signal
  safeWsSend(ws, { type: 'server-ready', timestamp: Date.now() });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    // [FIX-2.6] Runtime size guard (belt-and-suspenders after maxPayload)
    if (data.length > 20 * 1024 * 1024) {
      safeWsSend(ws, { type: 'error', error: 'Message too large (max 20MB)' });
      console.warn('⚠️ Oversized message rejected');
      return;
    }
    try {
      const msg = JSON.parse(data);
      await handleMessage(ws, msg, (uid) => { userId = uid; }, ip);
    } catch (err) {
      console.error('❌ Message error:', err.message);
      safeWsSend(ws, { type: 'error', error: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    if (userId) {
      const user = users.get(userId);
      if (user && user.ws === ws) {
        user.ws = null;
        user.lastSeen = Date.now();
        saveUserToStore(user);
        broadcast({ type: 'user-offline', data: userId });
        console.log(`✗ ${user.nickname} (${userId.substring(0, 8)}...) disconnected`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WS error:', err.message);
  });
});

// ==================== SAFE SEND ====================
function safeWsSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ==================== HEARTBEAT ====================
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ==================== MESSAGE ROUTER ====================
async function handleMessage(ws, msg, setUserId, ip) {
  const { type, data } = msg;
  const uuid = msg.uuid ? normUid(msg.uuid) : null;

  switch (type) {
    case 'register':
      // [FIX-2.5] Pass setUserId so ws.close() properly cleans up userId
      handleRegister(ws, msg, ip, setUserId);
      break;
    case 'reregister':
      handleReregister(ws, msg, setUserId);
      break;
    case 'login':
      handleLogin(ws, msg, setUserId, ip);
      break;
    case 'message':
      handleSendMessage(uuid, data);
      break;
    case 'profile-update':
      handleProfileUpdate(uuid, data);
      break;
    case 'rtc-offer':
    case 'rtc-answer':
    case 'rtc-ice':
    case 'rtc-hangup':
      handleRtcSignal(uuid, type, data);
      break;
    case 'delete-for-both':
      handleDeleteForBoth(uuid, data);
      break;
    case 'delete-message':
      handleDeleteMessage(uuid, data);
      break;
    case 'room-create':
      handleRoomCreate(uuid, data);
      break;
    case 'room-join':
      handleRoomJoin(uuid, data);
      break;
    case 'room-add-members':
      handleRoomAddMembers(uuid, data);
      break;
    case 'channel-subscribe':
      handleChannelSubscribe(uuid, data);
      break;
    case 'room-admin':
      handleRoomAdmin(uuid, data);
      break;
    case 'room-update':
      handleRoomUpdate(uuid, data);
      break;
    case 'message-reaction':
      handleMessageReaction(uuid, data);
      break;
    case 'ping':
      // keep-alive от клиента (прокси / Render idle)
      break;
    default:
      console.warn(`⚠️ Unknown message type: ${type}`);
  }
}

// ==================== REGISTRATION ====================
// [FIX-2.5] Added setUserId parameter — critical for disconnect cleanup
function handleRegister(ws, msg, ip, setUserId) {
  if (!checkRateLimit(regAttempts, ip, 5, 60000)) {
    safeWsSend(ws, { type: 'error', error: 'Too many registrations. Try again in 1 minute.' });
    // [FIX-2.2] No IP in warning log
    console.warn(`⚠️ Rate limit hit (registration)`);
    return;
  }

  const { password, nickname, avatar } = msg || {};

  if (!password || password.length < 8) {
    safeWsSend(ws, { type: 'error', error: 'Password hash too short' });
    return;
  }

  if (!nickname || nickname.trim().length < 1) {
    safeWsSend(ws, { type: 'error', error: 'Nickname required' });
    return;
  }

  const uuid = generateUUID();
  const user = {
    ws,
    uuid,
    nickname: nickname.trim().slice(0, 32),
    avatar: avatar || '',
    password: hashPassword(password), // PBKDF2
    lastSeen: Date.now()
  };

  users.set(uuid, user);

  // [FIX-2.5] setUserId called — ws.on('close') will now correctly null out user.ws
  setUserId(uuid);

  saveUserToStore(user);

  console.log(`✅ Registered: ${user.nickname} (${uuid.substring(0, 8)}...)`);
  safeWsSend(ws, { type: 'register-ok', uuid, nickname: user.nickname, avatar: user.avatar });
}

// ==================== REREGISTER ====================
function handleReregister(ws, msg, setUserId) {
  const { uuid, password, nickname, avatar } = msg || {};

  if (!uuid || !password) {
    safeWsSend(ws, { type: 'error', error: 'Missing credentials' });
    return;
  }

  const existingUser = getUserFromStore(uuid);
  if (existingUser) {
    // User exists — delegate to login
    handleLogin(ws, msg, setUserId, null);
    return;
  }

  const user = {
    ws,
    uuid,
    nickname: (nickname || uuid.substring(0, 8)).slice(0, 32),
    avatar: avatar || '',
    password: hashPassword(password),
    lastSeen: Date.now()
  };

  users.set(uuid, user);
  setUserId(uuid);
  saveUserToStore(user);

  console.log(`♻️ Reregistered: ${user.nickname} (${uuid.substring(0, 8)}...)`);
  safeWsSend(ws, { type: 'login-ok', uuid, nickname: user.nickname, avatar: user.avatar, users: [] });
  broadcast({ type: 'user-online', data: { uuid, nickname: user.nickname, avatar: user.avatar } }, uuid);
}

function findUserForLogin(uuidInput) {
  const n = normUid(uuidInput);
  let u = users.get(uuidInput) || users.get(n);
  if (u) return u;
  for (const [, v] of users) {
    if (normUid(v.uuid) === n) return v;
  }
  if (dbModule) {
    return dbModule.getUser(n) || dbModule.getUser(uuidInput);
  }
  return null;
}

// ==================== LOGIN ====================
function handleLogin(ws, msg, setUserId, ip) {
  const { uuid, password } = msg || {};

  if (!uuid || !password) {
    safeWsSend(ws, { type: 'error', error: 'Missing credentials' });
    return;
  }

  // [NEW] Rate limit login attempts to prevent brute force
  if (ip && !checkRateLimit(loginAttempts, ip, 10, 60000)) {
    safeWsSend(ws, { type: 'error', error: 'Too many login attempts. Try again in 1 minute.' });
    console.warn(`⚠️ Login rate limit hit`);
    return;
  }

  const user = findUserForLogin(uuid);

  if (!user) {
    console.warn(`❌ Login: user not found ${String(uuid).substring(0, 8)}...`);
    safeWsSend(ws, { type: 'error', error: 'User not found' });
    return;
  }

  if (!verifyPassword(password, user.password)) {
    console.warn(`❌ Login: wrong password for ${String(uuid).substring(0, 8)}...`);
    safeWsSend(ws, { type: 'error', error: 'Wrong password' });
    return;
  }

  const uidCanon = normUid(user.uuid);

  // Upgrade legacy SHA-256 → PBKDF2
  if (!user.password.startsWith('pbkdf2:')) {
    user.password = hashPassword(password);
    console.log(`🔒 Upgraded password hash for ${uidCanon.substring(0, 8)}...`);
  }

  for (const [k, v] of [...users.entries()]) {
    if (normUid(v.uuid) === uidCanon && v.ws && v.ws !== ws && v.ws.readyState === WebSocket.OPEN) {
      console.log(`♻️ Replacing old connection for ${v.nickname}`);
      try { v.ws.close(); } catch (_) {}
    }
    if (normUid(k) === uidCanon && k !== uidCanon) {
      users.delete(k);
    }
  }

  user.uuid = uidCanon;
  const updatedUser = { ...user, ws, lastSeen: Date.now() };
  users.set(uidCanon, updatedUser);
  setUserId(uidCanon);
  saveUserToStore(updatedUser);

  const onlineUsers = Array.from(users.values())
    .filter(u => u.ws && u.ws.readyState === WebSocket.OPEN)
    .map(u => ({ uuid: u.uuid, nickname: u.nickname, avatar: u.avatar }));

  const pending = dequeueMessagesFromStore(uidCanon);
  if (pending.length > 0) {
    console.log(`📨 Delivering ${pending.length} queued messages to ${user.nickname}`);
    pending.forEach(qMsg => safeWsSend(ws, { type: 'message', data: qMsg }));
  }

  console.log(`✅ Login: ${user.nickname} (${uidCanon.substring(0, 8)}...) [${users.size} users, ${onlineUsers.length} online]`);

  safeWsSend(ws, { type: 'login-ok', uuid: uidCanon, nickname: user.nickname, avatar: user.avatar, users: onlineUsers });
  broadcast({ type: 'user-online', data: { uuid: uidCanon, nickname: user.nickname, avatar: user.avatar } }, uidCanon);
}

// ==================== SEND MESSAGE ====================
function handleSendMessage(fromUuid, data) {
  if (!fromUuid || !data?.to) {
    console.warn('⚠️ handleSendMessage: missing fromUuid or data.to');
    return;
  }

  const sender = normUid(fromUuid);
  const toRaw = data.to;
  const to = normUid(toRaw);
  const { content, ts, type: msgType, roomId } = data;
  const message = {
    from: sender,
    to,
    content,
    ts,
    type: msgType,
    roomId: roomId || (rooms.has(to) ? to : undefined)
  };

  if (rooms.has(to)) {
    const room = rooms.get(to);
    normalizeRoom(room);
    if (room.kind === 'channel') {
      const admins = new Set([room.owner, ...(room.admins || [])].map(normUid));
      if (!admins.has(sender)) {
        const fromUser = getUserLive(sender);
        if (fromUser?.ws && fromUser.ws.readyState === WebSocket.OPEN) {
          safeWsSend(fromUser.ws, { type: 'error', error: 'В канале публикуют только администраторы' });
        }
        return;
      }
    }
    const memberSet = new Set(room.members.map(normUid));
    if (!memberSet.has(sender)) {
      const fromUser = getUserLive(sender);
      if (fromUser?.ws && fromUser.ws.readyState === WebSocket.OPEN) {
        safeWsSend(fromUser.ws, { type: 'error', error: 'Вы не в этой комнате' });
      }
      return;
    }
    for (const memberId of room.members) {
      if (normUid(memberId) === sender) continue;
      const u = getUserLive(memberId);
      if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
        safeWsSend(u.ws, { type: 'message', data: message });
      } else {
        const qid = normUid(memberId);
        if (dbModule) {
          dbModule.enqueueMessageForUser(qid, message);
        } else {
          if (!messageQueue.has(qid)) messageQueue.set(qid, []);
          messageQueue.get(qid).push(message);
          saveQueueJSON();
        }
      }
    }
    const fromUser = getUserLive(sender);
    if (fromUser?.ws && fromUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(fromUser.ws, { type: 'delivered', data: { to, ts } });
    }
    console.log(`  📣 Room ${to.substring(0, 8)}...`);
    return;
  }

  console.log(`💬 ${sender.substring(0, 8)}... → ${to.substring(0, 8)}...`);

  const toUser = getUserLive(to);

  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'message', data: message });

    const fromUser = getUserLive(sender);
    if (fromUser?.ws && fromUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(fromUser.ws, { type: 'delivered', data: { to, ts } });
    }

    console.log(`  ✓ Delivered to ${toUser.nickname}`);
  } else {
    enqueueMessageToStore(message);
    console.log(`  ⏸️ Queued for ${to.substring(0, 8)}...`);
  }
}

function broadcastRoomToMembers(room) {
  normalizeRoom(room);
  const payload = { type: 'room-updated', data: { room } };
  for (const mem of room.members) {
    const usr = getUserLive(mem);
    if (usr?.ws && usr.ws.readyState === WebSocket.OPEN) safeWsSend(usr.ws, payload);
  }
}

function handleRoomCreate(fromUuid, data) {
  const self = users.get(fromUuid);
  if (!fromUuid || !data?.title) {
    if (self?.ws) safeWsSend(self.ws, { type: 'error', data: { error: 'Укажите название' } });
    return;
  }
  const kind = data.kind === 'channel' ? 'channel' : 'group';
  const memberUuids = Array.isArray(data.memberUuids)
    ? [...new Set(data.memberUuids.map((x) => String(x).trim().toLowerCase()).filter(Boolean))]
    : [];
  let username = null;
  if (kind === 'channel') {
    username = normalizeChannelUsername(data.username || '');
    if (username.length < 3) {
      if (self?.ws) {
        safeWsSend(self.ws, { type: 'error', data: { error: 'Юзернейм канала: минимум 3 символа (латиница, цифры, _)' } });
      }
      return;
    }
    if (channelUsernames.has(username)) {
      const suggested = [username + '_2', username + '_3', username + '_' + String(Math.floor(100 + Math.random() * 900))];
      if (self?.ws) {
        safeWsSend(self.ws, { type: 'error', data: { error: 'Этот юзернейм занят', channelSuggestions: suggested } });
      }
      return;
    }
  }
  const id = generateUUID();
  const owner = normUid(fromUuid);
  const members = new Set([owner, ...memberUuids]);
  const room = {
    id,
    title: String(data.title).slice(0, 64),
    kind,
    owner,
    members: [...members],
    admins: kind === 'channel' ? [owner] : [],
    avatar: ''
  };
  if (kind === 'channel' && username) {
    room.username = username;
    channelUsernames.set(username, id);
  }
  normalizeRoom(room);
  rooms.set(id, room);
  saveRoomsJSON();
  const creator = getUserLive(owner);
  if (creator?.ws) safeWsSend(creator.ws, { type: 'room-created', data: { room } });
  const invite = { type: 'room-invite', data: { room } };
  for (const mid of room.members) {
    if (normUid(mid) === owner) continue;
    const usr = getUserLive(mid);
    if (usr?.ws && usr.ws.readyState === WebSocket.OPEN) safeWsSend(usr.ws, invite);
  }
  console.log(`📁 Room: ${room.title} (${id.substring(0, 8)}...)`);
}

function handleRoomAddMembers(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.roomId || !Array.isArray(data.memberUuids)) return;
  const rid = String(data.roomId).trim().toLowerCase().replace(/-/g, '');
  const room = rooms.get(rid);
  if (!room) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Комната не найдена' } });
    return;
  }
  normalizeRoom(room);
  const adminSet = new Set([room.owner, ...(room.admins || [])].map(normUid));
  if (!adminSet.has(normUid(fromUuid))) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Недостаточно прав' } });
    return;
  }
  const memSet = new Set(room.members.map(normUid));
  for (const raw of data.memberUuids) {
    const mid = normUid(raw);
    if (!mid || memSet.has(mid)) continue;
    room.members.push(mid);
    memSet.add(mid);
    const usr = getUserLive(mid);
    if (usr?.ws && usr.ws.readyState === WebSocket.OPEN) {
      safeWsSend(usr.ws, { type: 'room-invite', data: { room } });
    }
  }
  saveRoomsJSON();
  broadcastRoomToMembers(room);
}

function handleChannelSubscribe(fromUuid, data) {
  const u = users.get(fromUuid);
  let rid = data?.roomId ? String(data.roomId).trim().toLowerCase().replace(/-/g, '') : '';
  if (!rid && data?.username) {
    const un = normalizeChannelUsername(data.username);
    rid = channelUsernames.get(un) || '';
  }
  if (!rid || !rooms.has(rid)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Канал не найден' } });
    return;
  }
  const room = rooms.get(rid);
  if (room.kind !== 'channel') {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Это не канал' } });
    return;
  }
  normalizeRoom(room);
  const sub = normUid(fromUuid);
  if (!room.members.some((m) => normUid(m) === sub)) room.members.push(sub);
  saveRoomsJSON();
  if (u?.ws) safeWsSend(u.ws, { type: 'room-joined', data: { room } });
  broadcastRoomToMembers(room);
}

function handleRoomUpdate(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.roomId) return;
  const rid = String(data.roomId).trim().toLowerCase().replace(/-/g, '');
  const room = rooms.get(rid);
  if (!room) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Комната не найдена' } });
    return;
  }
  normalizeRoom(room);
  if (normUid(room.owner) !== normUid(fromUuid)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Только владелец может менять настройки' } });
    return;
  }
  if (data.title != null && String(data.title).trim()) {
    room.title = String(data.title).trim().slice(0, 64);
  }
  if (data.avatar !== undefined) {
    const av = data.avatar === '' ? '' : String(data.avatar);
    room.avatar = av.length > 400000 ? av.slice(0, 400000) : av;
  }
  if (room.kind === 'channel' && data.username != null && String(data.username).trim()) {
    const nu = normalizeChannelUsername(data.username);
    if (nu.length >= 3 && nu !== room.username) {
      if (channelUsernames.has(nu)) {
        const base = nu;
        const suggested = [base + '_2', base + '_3'];
        if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Юзернейм занят', channelSuggestions: suggested } });
        return;
      }
      if (room.username) channelUsernames.delete(room.username);
      room.username = nu;
      channelUsernames.set(nu, room.id);
    }
  }
  normalizeRoom(room);
  saveRoomsJSON();
  broadcastRoomToMembers(room);
}

function handleRoomAdmin(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.roomId || !data?.memberUuid) return;
  const rid = String(data.roomId).trim().toLowerCase().replace(/-/g, '');
  const room = rooms.get(rid);
  normalizeRoom(room);
  if (!room || normUid(room.owner) !== normUid(fromUuid)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Только владелец может менять админов' } });
    return;
  }
  const target = normUid(data.memberUuid);
  if (target === room.owner) return;
  if (!room.members.some((m) => normUid(m) === target)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Пользователь не в чате' } });
    return;
  }
  if (!room.admins) room.admins = [];
  if (data.add) {
    if (!room.admins.includes(target)) room.admins.push(target);
  } else {
    room.admins = room.admins.filter((x) => x !== target);
  }
  saveRoomsJSON();
  broadcastRoomToMembers(room);
}

function handleRoomJoin(fromUuid, data) {
  if (!fromUuid || !data?.roomId) return;
  const rid = String(data.roomId).trim().toLowerCase().replace(/-/g, '');
  const room = rooms.get(rid);
  if (!room) {
    const u = users.get(fromUuid);
    if (u?.ws) safeWsSend(u.ws, { type: 'error', error: 'Комната не найдена' });
    return;
  }
  normalizeRoom(room);
  const joiner = normUid(fromUuid);
  if (!room.members.some((m) => normUid(m) === joiner)) {
    room.members.push(joiner);
    saveRoomsJSON();
  }
  const u = getUserLive(fromUuid);
  if (u?.ws) safeWsSend(u.ws, { type: 'room-joined', data: { room } });
}

function handleMessageReaction(fromUuid, data) {
  if (!data?.to || data.ts == null || !data.emoji) return;
  const payload = {
    type: 'message-reaction',
    data: {
      from: fromUuid,
      to: data.to,
      ts: data.ts,
      emoji: data.emoji,
      remove: !!data.remove
    }
  };
  if (rooms.has(data.to)) {
    const room = rooms.get(data.to);
    normalizeRoom(room);
    const src = normUid(fromUuid);
    for (const memberId of room.members) {
      if (normUid(memberId) === src) continue;
      const u = getUserLive(memberId);
      if (u?.ws && u.ws.readyState === WebSocket.OPEN) safeWsSend(u.ws, payload);
    }
  } else {
    const u = getUserLive(data.to);
    if (u?.ws && u.ws.readyState === WebSocket.OPEN) safeWsSend(u.ws, payload);
  }
}

// ==================== PROFILE UPDATE ====================
function handleProfileUpdate(uuid, data) {
  const user = getUserFromStore(uuid);
  if (!user) return;

  if (data.nickname) user.nickname = data.nickname.slice(0, 32);
  else if (data.nick) user.nickname = data.nick.slice(0, 32);
  if (data.avatar !== undefined) user.avatar = data.avatar;
  user.lastSeen = Date.now();

  // Update memory
  const memUser = users.get(uuid);
  if (memUser) Object.assign(memUser, { nickname: user.nickname, avatar: user.avatar, lastSeen: user.lastSeen });

  saveUserToStore(user);
  console.log(`👤 Profile update: ${user.nickname}`);

  broadcast({ type: 'user-profile', data: { uuid, nickname: user.nickname, avatar: user.avatar } });
}

// ==================== WEBRTC SIGNALING ====================
function handleRtcSignal(fromUuid, type, data) {
  if (!data?.to) return;
  const toUser = users.get(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type, data: { ...data, from: fromUuid } });
    console.log(`📞 RTC ${type}: ${fromUuid.substring(0, 8)}... → ${data.to.substring(0, 8)}...`);
  }
}

// ==================== DELETE FOR BOTH ====================
function handleDeleteForBoth(fromUuid, data) {
  if (!data?.to) return;
  const toUser = users.get(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'delete-for-both', data: { from: fromUuid, ts: data.ts } });
  }
}

/** Удаление одного сообщения у собеседника (только scope both — «у всех») */
function handleDeleteMessage(fromUuid, data) {
  if (!data?.to || data.ts == null) return;
  if (data.scope !== 'both') return;
  const toUser = users.get(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, {
      type: 'message-deleted',
      data: { from: fromUuid, ts: data.ts }
    });
  }
}

// ==================== BROADCAST ====================
function broadcast(msg, excludeUuid = null) {
  const data = JSON.stringify(msg);
  for (const [uuid, user] of users) {
    if (excludeUuid && uuid === excludeUuid) continue;
    if (user.ws && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

// ==================== PERIODIC STATS ====================
setInterval(() => {
  const online = Array.from(users.values()).filter(u => u.ws && u.ws.readyState === WebSocket.OPEN).length;
  console.log(`[${new Date().toLocaleTimeString()}] 👥 Total: ${users.size} | Online: ${online} | Queued: ${messageQueue.size}`);
}, 30000);

// ==================== GRACEFUL SHUTDOWN ====================
function shutdown() {
  console.log('\n👋 Shutting down...');
  saveUsersJSON();
  saveQueueJSON();
  saveRoomsJSON();
  if (dbModule) dbModule.closeDatabase();
  wss.clients.forEach(ws => ws.close());
  app.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ==================== START ====================
loadUsersJSON();
loadQueueJSON();
loadRoomsJSON();

app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  Cipher Server v4.1 — Audit Fixed                    ║
║═══════════════════════════════════════════════════════║
║ 🚀 Running on: 0.0.0.0:${PORT}${' '.repeat(18 - String(PORT).length)}║
║ 🔐 Passwords: PBKDF2-SHA512 (100k rounds)            ║
║ 💾 Persistence: ${(dbModule ? 'SQLite AES-256' : 'JSON atomic  ').padEnd(22)}║
║ 🛡️  Rate limiting: register + login per IP           ║
║ 📦 Max payload: 25MB                                 ║
║ 📞 WebRTC signaling: offer/answer/ice                ║
╚═══════════════════════════════════════════════════════╝
  `);
  console.log(`✓ WebSocket server listening on port ${PORT}\n`);
});
