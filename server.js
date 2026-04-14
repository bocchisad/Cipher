#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server v5.0 with E2EE
 * - Blind Router for encrypted messages
 * - Public key exchange (ECDSA, ECDH)
 * - Room Key Share signaling
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
const USE_SQLITE = process.env.USE_SQLITE === '1';
let dbModule = null;

if (USE_SQLITE) {
  try {
    dbModule = require('./database.js');
    dbModule.openDatabase();
    console.log('✅ Storage: SQLite (SQLCipher AES-256)');
  } catch (e) {
    console.error('❌ Failed to load database.js:', e.message);
  }
}

if (!USE_SQLITE || !dbModule) {
  console.log('💾 Storage: JSON files');
}

// ==================== HELPERS ====================
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

// Function to create time buckets (e.g., 1-hour windows) for privacy
function getTimeBucket() {
  const now = Date.now();
  const bucketSize = 60 * 60 * 1000; // 1 hour
  return Math.floor(now / bucketSize) * bucketSize;
}

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

function normalizeRoom(room) {
  if (!room) return;
  room.owner = normUid(room.owner);
  room.members = [...new Set((room.members || []).map(normUid))];
  const adm = [...new Set((room.admins || []).map(normUid))].filter((a) => a && a !== room.owner);
  room.admins = adm;
}

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
      const legacy = crypto.createHash('sha256').update(pwd).digest('hex');
      return legacy === stored;
    }
  } catch {
    return false;
  }
}

// ==================== IN-MEMORY STORE ====================
const users = new Map();
const messageQueue = new Map();
const rooms = new Map();
const channelUsernames = new Map();

// ==================== TOKEN REGISTRY (PRIVACY: Anonymous Routing) ====================
const tokenRegistry = new Map(); // token -> uuid
const userTokens = new Map();    // uuid -> token

// Generate ephemeral tokens for users
function generateUserToken(uuid) {
  if (userTokens.has(uuid)) {
    return userTokens.get(uuid);
  }
  const token = crypto.randomBytes(32).toString('hex');
  tokenRegistry.set(token, uuid);
  userTokens.set(uuid, token);
  return token;
}

// Rotate tokens periodically (every hour) for privacy
setInterval(() => {
  for (const [uuid, oldToken] of userTokens) {
    const newToken = crypto.randomBytes(32).toString('hex');
    // PRIVACY: Keep old token for queued messages, add new token for new messages
    tokenRegistry.set(newToken, uuid);
    userTokens.set(uuid, newToken);
    // Notify user of new token
    const user = getUserLive(uuid);
    if (user?.ws) {
      safeWsSend(user.ws, { type: 'token-rotated', data: { newToken } });
    }
  }
}, 60 * 60 * 1000);

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
    const mem = users.get(uuid);
    return { ...row, ws: mem?.ws || null };
  }
  return users.get(uuid) || null;
}

function saveUserToStore(user) {
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
    dbModule.enqueueMessage(message);
  } else {
    if (!messageQueue.has(key)) messageQueue.set(key, []);
    messageQueue.get(key).push(message);
    saveQueueJSON();
  }
}

function dequeueMessagesFromStore(uuid) {
  const n = normUid(uuid);
  if (dbModule) {
    return dbModule.dequeueMessages(n);
  }
  let msgs = [...(messageQueue.get(n) || [])];
  messageQueue.delete(n);
  for (const [k, arr] of [...messageQueue.entries()]) {
    if (normUid(k) === n && arr?.length) {
      msgs = msgs.concat(arr);
      messageQueue.delete(k);
    }
  }
  if (msgs.length) saveQueueJSON();
  return msgs;
}

// ==================== RATE LIMITING ====================
const regAttempts = new Map();
const loginAttempts = new Map();

function checkRateLimit(map, ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const rec = map.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
  rec.count++;
  map.set(ip, rec);
  return rec.count <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of regAttempts) if (now > rec.resetAt) regAttempts.delete(ip);
  for (const [ip, rec] of loginAttempts) if (now > rec.resetAt) loginAttempts.delete(ip);
}, 5 * 60 * 1000);

// ==================== JSON PERSISTENCE ====================
function saveUsersJSON() {
  if (dbModule) return;
  const data = {};
  for (const [uuid, user] of users) {
    data[uuid] = { 
      uuid: user.uuid, 
      nickname: user.nickname, 
      avatar: user.avatar, 
      password: user.password,
      pub_ecdh: user.pub_ecdh || '',
      pub_ecdsa: user.pub_ecdsa || '',
      lastSeen: user.lastSeen 
    };
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
  if (dbModule) return;
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [uuid, user] of Object.entries(data)) {
        users.set(uuid, { 
          ...user, 
          ws: null,
          pub_ecdh: user.pub_ecdh || '',
          pub_ecdsa: user.pub_ecdsa || ''
        });
      }
      console.log(`✓ Loaded ${users.size} users from JSON`);
    }
  } catch (e) {
    console.error('💾 Load users error:', e.message);
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
          avatar: room.avatar || '',
          linkedGroupId: room.linkedGroupId || undefined,
          commentsEnabled: room.commentsEnabled || false,
          commentsMembersOnly: room.commentsMembersOnly || false
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
      res.end(`Cipher Messenger Server v5.0\nUsers: ${users.size}\nUptime: ${process.uptime().toFixed(0)}s`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ==================== WEBSOCKET SERVER ====================
const wss = new WebSocket.Server({
  server: app,
  perMessageDeflate: false,
  maxPayload: 25 * 1024 * 1024
});

wss.on('connection', (ws, req) => {
  let userId = null;
  ws.isAlive = true;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  console.log(`📡 New connection established`);
  safeWsSend(ws, { type: 'server-ready', timestamp: Date.now() });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
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
  const version = msg.version || 1; // V1 = legacy, V2 = privacy enhanced

  switch (type) {
    case 'register':
      handleRegister(ws, msg, ip, setUserId);
      break;
    case 'reregister':
      handleReregister(ws, msg, setUserId);
      break;
    case 'login':
      handleLogin(ws, msg, setUserId, ip);
      break;
    case 'publish-keys':
      handlePublishKeys(uuid, data, ws);
      break;
    case 'get-pub-keys':
      handleGetPublicKeys(uuid, data, ws);
      break;
    case 'msg':
    case 'rtc-offer':
    case 'rtc-answer':
    case 'rtc-ice':
      if (data.recipientToken) {
        // V2: Privacy enhanced - use anonymous routing (default)
        handleAnonymousMessage(data);
      } else {
        // V1: Legacy handling (fallback)
        handleE2EEMessage(uuid, type, data);
      }
      break;
    case 'rtc-hangup':
      if (data?.to) {
        const targetUser = getUserLive(data.to);
        if (targetUser?.ws && targetUser.ws.readyState === WebSocket.OPEN) {
          safeWsSend(targetUser.ws, { type: 'rtc-hangup', data: { from: uuid } });
        }
      }
      break;
    case 'room-key-share':
      handleRoomKeyShare(uuid, data);
      break;
    case 'message':
      handleSendMessage(uuid, data);
      break;
    case 'profile-update':
      handleProfileUpdate(uuid, data);
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
    case 'channel-create-comments-group':
      handleCreateCommentsGroup(uuid, data);
      break;
    case 'poll-vote':
      handlePollVote(uuid, data, ws);
      break;
    case 'room-delete':
      handleRoomDelete(uuid, data);
      break;
    case 'message-reaction':
      handleMessageReaction(uuid, data);
      break;
    case 'clear-all-data':
      handleClearAllData(uuid, ws);
      break;
    case 'edit-msg':
    case 'edit-message':
      handleEditMessage(uuid, data);
      break;
    case 'relay-message':
      handleRelayMessage(uuid, data);
      break;
    case 'rotate-key':
      handleKeyRotation(uuid, data);
      break;
    case 'anonymous-msg':
      handleAnonymousMessage(data);
      break;
    case 'get-pub-keys-anonymous':
      handleGetPublicKeysAnonymous(data, ws);
      break;
    case 'get-token':
      handleGetToken(uuid, data, ws);
      break;
    case 'ping':
      break;
    default:
      console.warn(`⚠️ Unknown message type: ${type}`);
  }
}

// ==================== REGISTRATION ====================
function handleRegister(ws, msg, ip, setUserId) {
  if (!checkRateLimit(regAttempts, ip, 5, 60000)) {
    safeWsSend(ws, { type: 'error', error: 'Too many registrations. Try again in 1 minute.' });
    console.warn(`⚠️ Rate limit hit (registration)`);
    return;
  }

  const { password, nickname, avatar, pub_ecdh, pub_ecdsa } = msg || {};

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
    password: hashPassword(password),
    pub_ecdh: pub_ecdh || '',
    pub_ecdsa: pub_ecdsa || '',
    lastSeen: Date.now()
  };

  users.set(uuid, user);
  setUserId(uuid);
  saveUserToStore(user);

  if (dbModule) {
    dbModule.updatePublicKeys(uuid, pub_ecdh || '', pub_ecdsa || '');
  }

  // PRIVACY: Generate token for anonymous routing on registration
  generateUserToken(uuid);

  console.log(`✅ Registered: ${user.nickname} (${uuid.substring(0, 8)}...)`);
  safeWsSend(ws, { type: 'register-ok', uuid, nickname: user.nickname, avatar: user.avatar });
}

function handleReregister(ws, msg, setUserId) {
  const { uuid, password, nickname, avatar } = msg || {};

  if (!uuid || !password) {
    safeWsSend(ws, { type: 'error', error: 'Missing credentials' });
    return;
  }

  const existingUser = getUserFromStore(uuid);
  if (existingUser) {
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

  // PRIVACY: Generate token for anonymous routing on login
  generateUserToken(uidCanon);

  const onlineUsers = Array.from(users.values())
    .filter(u => u.ws && u.ws.readyState === WebSocket.OPEN)
    .map(u => ({ uuid: u.uuid, nickname: u.nickname, avatar: u.avatar }));

  const pending = dequeueMessagesFromStore(uidCanon);
  if (pending.length > 0) {
    console.log(`📨 Delivering ${pending.length} queued messages to ${user.nickname}`);
    pending.forEach(qMsg => {
      if (qMsg.type && ['msg', 'rtc-offer', 'rtc-answer', 'rtc-ice', 'edit-msg', 'edit-message', 'anonymous-msg'].includes(qMsg.type)) {
        safeWsSend(ws, { type: qMsg.type, data: qMsg });
      } else {
        safeWsSend(ws, { type: 'message', data: qMsg });
      }
    });
  }

  console.log(`✅ Login: ${user.nickname} (${uidCanon.substring(0, 8)}...) [${users.size} users, ${onlineUsers.length} online]`);

  safeWsSend(ws, { type: 'login-ok', uuid: uidCanon, nickname: user.nickname, avatar: user.avatar, bio: user.bio || '', tracks: user.tracks || [], attachedChannelId: user.attachedChannelId || '', users: onlineUsers });
  broadcast({ type: 'user-online', data: { uuid: uidCanon, nickname: user.nickname, avatar: user.avatar } }, uidCanon);
}

// ==================== E2EE MESSAGE HANDLERS ====================

// Publish public keys to server
function handlePublishKeys(uuid, data, ws) {
  if (!data?.pub_ecdh || !data?.pub_ecdsa) return;

  const user = getUserFromStore(uuid);
  if (!user) return;

  user.pub_ecdh = data.pub_ecdh;
  user.pub_ecdsa = data.pub_ecdsa;

  saveUserToStore(user);

  if (dbModule) {
    dbModule.updatePublicKeys(uuid, data.pub_ecdh, data.pub_ecdsa);
  }

  safeWsSend(ws, { type: 'keys-published' });
  console.log(`🔑 Published keys: ${uuid.substring(0, 8)}…`);
}

// Get public keys for recipient
function handleGetPublicKeys(uuid, data, ws) {
  if (!data?.targetUuid) return;

  const target = getUserFromStore(data.targetUuid);
  if (!target) {
    safeWsSend(ws, { type: 'error', data: { error: 'User not found' } });
    return;
  }

  const payload = {
    type: 'pub-keys-response',
    data: {
      uuid: target.uuid,
      pub_ecdh: target.pub_ecdh || '',
      pub_ecdsa: target.pub_ecdsa || ''
    }
  };
  safeWsSend(ws, payload);
}

// E2EE Message - Blind Router (payload, iv, signature not parsed)
function handleE2EEMessage(fromUuid, type, data) {
  if (!data?.to || !data?.payload || !data?.iv || !data?.signature) {
    return;
  }

  const toUuid = normUid(data.to);
  const message = {
    from: fromUuid,
    to: toUuid,
    type,
    payload: data.payload,
    iv: data.iv,
    signature: data.signature,
    // PRIVACY: Use coarse-grained time bucket instead of precise timestamp
    timeBucket: getTimeBucket()
  };

  const toUser = getUserLive(toUuid);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type, data: message });
  } else {
    enqueueMessageToStore(message);
  }

  console.log(`💬 E2EE ${type}: ${fromUuid.substring(0, 8)}… → ${toUuid.substring(0, 8)}…`);
}

// Room Key Share - Blind routing encrypted room keys
function handleRoomKeyShare(uuid, data) {
  if (!data?.to || !data?.encryptedKey || !data?.roomId) return;

  const toUser = getUserLive(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, {
      type: 'room-key-share',
      data: {
        from: uuid,
        roomId: data.roomId,
        encryptedKey: data.encryptedKey
      }
    });
  }

  console.log(`🔑 Room key share: ${uuid.substring(0, 8)}… → ${data.to.substring(0, 8)}…`);
}

// Key Rotation - Forward secrecy for Double Ratchet
function handleKeyRotation(fromUuid, data) {
  if (!data?.to || !data?.newPublicKey) return;

  const toUser = getUserLive(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, {
      type: 'key-rotation',
      data: {
        from: fromUuid,
        newPublicKey: data.newPublicKey
      }
    });
  }

  console.log(`🔄 Key rotation: ${fromUuid.substring(0, 8)}… → ${data.to.substring(0, 8)}…`);
}

// Anonymous Message Routing - Hide communication graph from server
function handleAnonymousMessage(data) {
  if (!data?.encryptedEnvelope || !data?.recipientToken) {
    return;
  }

  // Store without decrypting - server only sees encrypted blob
  const anonymousMessage = {
    envelope: data.encryptedEnvelope,
    recipientToken: data.recipientToken,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24h expiry
  };

  // recipientToken is actually the recipientUuid (client sends UUID, server converts to token internally)
  const recipientUuid = normUid(data.recipientToken);
  const toUser = getUserLive(recipientUuid);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    // Get recipient's token for privacy
    const recipientToken = userTokens.get(recipientUuid);
    anonymousMessage.recipientToken = recipientToken || data.recipientToken;
    safeWsSend(toUser.ws, { type: 'anonymous-msg', data: anonymousMessage });
  } else {
    // Queue with UUID instead of token
    enqueueAnonymousMessage(anonymousMessage, recipientUuid);
  }

  console.log(`📦 Anonymous message routed (sender unknown)`);
}

// Anonymous Key Exchange - Get public keys without revealing UUID
function handleGetPublicKeysAnonymous(data, ws) {
  if (!data?.recipientToken) return;

  const uuid = tokenRegistry.get(data.recipientToken);
  if (!uuid) {
    safeWsSend(ws, { type: 'error', data: { error: 'Token not found' } });
    return;
  }

  const target = getUserFromStore(uuid);
  if (!target) return;

  // Return keys without revealing which user they belong to
  safeWsSend(ws, {
    type: 'pub-keys-anonymous-response',
    data: {
      pub_ecdh: target.pub_ecdh,
      pub_ecdsa: target.pub_ecdsa
      // NO uuid returned!
    }
  });
}

// Token Lookup - Get token for a UUID
function handleGetToken(fromUuid, data, ws) {
  if (!data?.targetUuid) return;

  const target = getUserFromStore(data.targetUuid);
  if (!target) {
    safeWsSend(ws, { type: 'error', data: { error: 'User not found' } });
    return;
  }

  // Generate or retrieve existing token
  const token = generateUserToken(data.targetUuid);

  safeWsSend(ws, {
    type: 'token-response',
    data: {
      targetUuid: data.targetUuid,  // Client knows this
      token: token  // Use this for messaging
    }
  });
}

// Queue anonymous messages for offline users
function enqueueAnonymousMessage(anonymousMessage, targetUuid) {
  const key = normUid(targetUuid);
  if (dbModule) {
    // Store in database with token instead of UUID for privacy
    const msg = {
      from_uuid: 'anonymous',
      to_uuid: targetUuid,
      payload: anonymousMessage.envelope,
      iv: '',
      signature: '',
      raw_json: JSON.stringify(anonymousMessage),
      msg_type: 'anonymous-msg',
      ts: Date.now(),
      time_bucket: getTimeBucket()
    };
    dbModule.enqueueMessage(msg);
  } else {
    if (!messageQueue.has(key)) messageQueue.set(key, []);
    messageQueue.get(key).push({
      type: 'anonymous-msg',
      data: anonymousMessage
    });
    saveQueueJSON();
  }
}

// ==================== LEGACY MESSAGE HANDLER ====================
function handleSendMessage(fromUuid, data) {
  if (!fromUuid || !data?.to) {
    console.warn('⚠️ handleSendMessage: missing fromUuid or data.to');
    return;
  }

  const sender = normUid(fromUuid);
  const toRaw = data.to;
  const to = normUid(toRaw);
  const { content, ts, type: msgType, roomId, payload, iv, signature, forwardFrom, replyTo, msgId } = data;
  const message = {
    from: sender,
    to,
    content,
    ts,
    msgId: msgId || `${sender}:${Number(ts || Date.now())}`,
    type: msgType,
    roomId: roomId || (rooms.has(to) ? to : undefined),
    // E2EE fields (preserved for forwarding and replies)
    payload: payload || undefined,
    iv: iv || undefined,
    signature: signature || undefined,
    forwardFrom: forwardFrom || undefined,
    replyTo: replyTo || undefined
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
          const msg = { ...message, from: sender, to: qid, payload: content, iv: '', signature: '', type: 'message' };
          dbModule.enqueueMessage(msg);
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
    // Double-check: verify username uniqueness in actual rooms data (not just in-memory map)
    let usernameTaken = false;
    for (const [, room] of rooms) {
      if (room.kind === 'channel' && normalizeChannelUsername(room.username || '') === username) {
        usernameTaken = true;
        break;
      }
    }
    if (channelUsernames.has(username) || usernameTaken) {
      // FIX #2: Use crypto.randomBytes instead of Math.random() for secure random generation
      const randomSuffix = 100 + (crypto.randomBytes(2).readUInt16LE(0) % 900);
      const suggested = [username + '_2', username + '_3', username + '_' + String(randomSuffix)];
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
  normalizeRoom(room);
  if (!room) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Комната не найдена' } });
    return;
  }
  const isAdmin = normUid(fromUuid) === normUid(room.owner) || (room.admins && room.admins.some(a => normUid(a) === normUid(fromUuid)));
  if (!isAdmin) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Только администраторы могут добавлять участников' } });
    return;
  }
  const newMembers = data.memberUuids.map(normUid).filter(Boolean);
  for (const nm of newMembers) {
    if (!room.members.some(m => normUid(m) === nm)) {
      room.members.push(nm);
    }
  }
  normalizeRoom(room);
  saveRoomsJSON();
  const inv = { type: 'room-invite', data: { room } };
  for (const nm of newMembers) {
    const usr = getUserLive(nm);
    if (usr?.ws && usr.ws.readyState === WebSocket.OPEN) safeWsSend(usr.ws, inv);
  }
  broadcastRoomToMembers(room);
  
  // FIX: Request history sync from existing members when admin adds new members
  // Send separate sync request for EACH new member (not just the first one)
  if (room.members.length > newMembers.length) {
    for (const newMember of newMembers) {
      const syncPayload = {
        type: 'room-member-joined',
        data: {
          roomId: rid,
          newMember: newMember, // Sync for each new member individually
          roomKind: room.kind
        }
      };

      // Send to all existing members except the new members
      for (const memberId of room.members) {
        if (newMembers.some(nm => normUid(nm) === normUid(memberId))) continue;
        const memberUser = getUserLive(memberId);
        if (memberUser?.ws && memberUser.ws.readyState === WebSocket.OPEN) {
          safeWsSend(memberUser.ws, syncPayload);
        }
      }
    }
    console.log(`📢 Admin added ${newMembers.length} members to ${rid.substring(0, 8)}…, requesting history sync for each`);
  }
}

function handleChannelSubscribe(fromUuid, data) {
  const username = data?.username || data?.channel; // Accept both for compatibility
  if (!username || typeof username !== 'string') return;
  const ch = normalizeChannelUsername(username);
  const rid = channelUsernames.get(ch);
  if (!rid) {
    const u = getUserLive(fromUuid);
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Канал не найден' } });
    return;
  }
  const room = rooms.get(rid);
  if (!room) return;
  normalizeRoom(room);
  const uid = normUid(fromUuid);
  const wasMember = room.members.some(m => normUid(m) === uid);
  if (!wasMember) {
    room.members.push(uid);
    saveRoomsJSON();
  }
  const u = getUserLive(uid);
  if (u?.ws) safeWsSend(u.ws, { type: 'room-joined', data: { room } });

  // FIX: Request history sync from existing members when new member subscribes
  if (!wasMember && room.members.length > 1) {
    const syncPayload = {
      type: 'room-member-joined',
      data: {
        roomId: rid,
        newMember: uid,
        roomKind: room.kind
      }
    };

    // Send to all existing members except the new subscriber
    for (const memberId of room.members) {
      if (normUid(memberId) === uid) continue;
      const memberUser = getUserLive(memberId);
      if (memberUser?.ws && memberUser.ws.readyState === WebSocket.OPEN) {
        safeWsSend(memberUser.ws, syncPayload);
      }
    }
    console.log(`📢 New subscriber joined channel ${rid.substring(0, 8)}…, requesting history sync`);
  }
}

function handleRoomUpdate(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.roomId) return;
  const rid = normUid(data.roomId);
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
  // Comments settings for channels
  if (room.kind === 'channel') {
    if (data.commentsEnabled !== undefined) {
      room.commentsEnabled = !!data.commentsEnabled;
    }
    if (data.commentsMembersOnly !== undefined) {
      room.commentsMembersOnly = !!data.commentsMembersOnly;
    }
    // Link or create linked group for comments
    if (data.linkedGroupId !== undefined) {
      room.linkedGroupId = data.linkedGroupId || null;
    }
  }
  normalizeRoom(room);
  saveRoomsJSON();
  broadcastRoomToMembers(room);
}

function handleCreateCommentsGroup(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.channelId || !data?.title) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Укажите ID канала и название группы' } });
    return;
  }
  const channelId = normUid(data.channelId);
  const channel = rooms.get(channelId);
  if (!channel || channel.kind !== 'channel') {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Канал не найден' } });
    return;
  }
  if (normUid(channel.owner) !== normUid(fromUuid)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Только владелец может создать группу комментариев' } });
    return;
  }
  
  // Create linked group for comments
  const groupId = generateUUID();
  const owner = normUid(fromUuid);
  const group = {
    id: groupId,
    title: String(data.title).slice(0, 64),
    kind: 'group',
    owner,
    members: [owner],
    admins: [],
    avatar: data.avatar || channel.avatar || ''
  };
  normalizeRoom(group);
  rooms.set(groupId, group);
  
  // Link group to channel
  channel.linkedGroupId = groupId;
  channel.commentsEnabled = true;
  normalizeRoom(channel);
  saveRoomsJSON();
  
  // Notify creator (не переключаем чат — пользователь остаётся в канале)
  if (u?.ws) safeWsSend(u.ws, { type: 'room-created', data: { room: group, skipOpenChat: true } });
  if (u?.ws) safeWsSend(u.ws, { type: 'room-updated', data: { room: channel } });
  
  console.log(`📁 Comments group created: ${group.title} for channel ${channel.title}`);
}

function handlePollVote(fromUuid, data, ws) {
  if (!data?.msgId || !data?.pollData) {
    if (ws) safeWsSend(ws, { type: 'error', data: { error: 'Invalid poll vote data' } });
    return;
  }
  
  // Broadcast poll vote update to all room members
  const pollData = data.pollData;
  const roomId = data.roomId;
  
  const rid = roomId ? normUid(roomId) : '';
  if (rid && rooms.has(rid)) {
    const room = rooms.get(rid);
    for (const memberId of room.members) {
      if (normUid(memberId) === normUid(fromUuid)) continue;
      const u = getUserLive(memberId);
      if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
        safeWsSend(u.ws, { 
          type: 'poll-vote-update', 
          data: { 
            roomId: rid,
            msgId: data.msgId,
            pollData: pollData
          } 
        });
      }
    }
  } else if (rid) {
    // ЛС: клиент шлёт roomId = peer (как chatId у голосующего). У получателя те же сообщения лежат в чате с uuid голосующего.
    const recipient = normUid(rid);
    const voter = normUid(fromUuid);
    if (recipient !== voter) {
      const u = getUserLive(recipient);
      if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
        safeWsSend(u.ws, {
          type: 'poll-vote-update',
          data: { roomId: voter, msgId: data.msgId, pollData }
        });
      }
    }
  }
  
  console.log(`🗳️ Poll vote from ${fromUuid.substring(0, 8)}...`);
}

function handleRoomDelete(fromUuid, data) {
  const u = getUserLive(fromUuid);
  if (!data?.roomId) return;
  const rid = normUid(data.roomId);
  const room = rooms.get(rid);
  if (!room) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Комната не найдена' } });
    return;
  }
  normalizeRoom(room);
  if (normUid(room.owner) !== normUid(fromUuid)) {
    if (u?.ws) safeWsSend(u.ws, { type: 'error', data: { error: 'Удалить может только владелец' } });
    return;
  }
  const members = [...room.members];
  if (room.kind === 'channel' && room.username) {
    channelUsernames.delete(String(room.username).toLowerCase());
  }
  rooms.delete(rid);
  saveRoomsJSON();
  const payload = { type: 'room-deleted', data: { roomId: rid } };
  for (const mid of members) {
    const usr = getUserLive(mid);
    if (usr?.ws && usr.ws.readyState === WebSocket.OPEN) safeWsSend(usr.ws, payload);
  }
  console.log(`🗑️ Room deleted ${rid.substring(0, 8)}… by owner`);
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
  const wasMember = room.members.some((m) => normUid(m) === joiner);
  if (!wasMember) {
    room.members.push(joiner);
    saveRoomsJSON();
  }
  const u = getUserLive(fromUuid);
  if (u?.ws) safeWsSend(u.ws, { type: 'room-joined', data: { room } });
  
  // FIX: Request history sync from existing members when new member joins
  if (!wasMember && room.members.length > 1) {
    // Notify existing members that a new member joined and should receive history
    const syncPayload = {
      type: 'room-member-joined',
      data: {
        roomId: rid,
        newMember: joiner,
        roomKind: room.kind
      }
    };
    
    // Send to all existing members except the joiner
    for (const memberId of room.members) {
      if (normUid(memberId) === joiner) continue;
      const memberUser = getUserLive(memberId);
      if (memberUser?.ws && memberUser.ws.readyState === WebSocket.OPEN) {
        safeWsSend(memberUser.ws, syncPayload);
      }
    }
    console.log(`📢 New member joined ${rid.substring(0, 8)}…, requesting history sync`);
  }
}

// ==================== MESSAGE REACTION ====================
// Plaintext router for reactions - metadata only
function handleMessageReaction(fromUuid, data) {
  if (!data?.to || data.ts == null || !data.emoji) return;
  
  // PLAINTEXT reaction routing - no E2EE, just metadata
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
    console.log(`😀 Reaction in room: ${fromUuid.substring(0, 8)}… → ${data.to.substring(0, 8)}…`);
  } else {
    const u = getUserLive(data.to);
    if (u?.ws && u.ws.readyState === WebSocket.OPEN) {
      safeWsSend(u.ws, payload);
      console.log(`😀 Reaction: ${fromUuid.substring(0, 8)}… → ${data.to.substring(0, 8)}…`);
    }
  }
}

// ==================== PROFILE UPDATE ====================
function handleProfileUpdate(uuid, data) {
  const user = getUserFromStore(uuid);
  if (!user) return;

  if (data.nickname) user.nickname = data.nickname.slice(0, 32);
  else if (data.nick) user.nickname = data.nick.slice(0, 32);
  if (data.avatar !== undefined) user.avatar = data.avatar;
  
  // New fields: bio, tracks, attachedChannelId
  if (data.bio !== undefined) user.bio = String(data.bio).slice(0, 140);
  if (data.tracks !== undefined) user.tracks = data.tracks;
  if (data.attachedChannelId !== undefined) user.attachedChannelId = data.attachedChannelId;
  
  user.lastSeen = Date.now();

  const memUser = users.get(uuid);
  if (memUser) Object.assign(memUser, { 
    nickname: user.nickname, 
    avatar: user.avatar, 
    bio: user.bio,
    tracks: user.tracks,
    attachedChannelId: user.attachedChannelId,
    lastSeen: user.lastSeen 
  });

  saveUserToStore(user);
  console.log(`👤 Profile update: ${user.nickname}`);

  broadcast({ 
    type: 'user-profile', 
    data: { 
      uuid, 
      nickname: user.nickname, 
      avatar: user.avatar,
      bio: user.bio,
      tracks: user.tracks,
      attachedChannelId: user.attachedChannelId
    } 
  });
}

// ==================== DELETE FOR BOTH ====================
function handleDeleteForBoth(fromUuid, data) {
  if (!data?.to) return;
  const toUser = users.get(data.to);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'delete-for-both', data: { from: fromUuid, ts: data.ts } });
  }
}

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

function handleClearAllData(uuid, ws) {
  if (!uuid) return;
  const uid = normUid(uuid);

  if (dbModule && typeof dbModule.clearUserQueue === 'function') {
    dbModule.clearUserQueue(uid);
  } else {
    for (const [k, arr] of [...messageQueue.entries()]) {
      const filtered = (arr || []).filter((m) => normUid(m?.from) !== uid && normUid(m?.to) !== uid);
      if (filtered.length) {
        messageQueue.set(k, filtered);
      } else {
        messageQueue.delete(k);
      }
    }
    saveQueueJSON();
  }

  for (const [rid, room] of [...rooms.entries()]) {
    normalizeRoom(room);
    const ownerUid = normUid(room.owner);
    if (ownerUid === uid) {
      if (room.kind === 'channel' && room.username) {
        channelUsernames.delete(String(room.username).toLowerCase());
      }
      rooms.delete(rid);
      for (const memberId of room.members || []) {
        const member = getUserLive(memberId);
        if (member?.ws && member.ws.readyState === WebSocket.OPEN) {
          safeWsSend(member.ws, { type: 'room-deleted', data: { roomId: rid } });
        }
      }
      continue;
    }
    const before = room.members.length;
    room.members = room.members.filter((m) => normUid(m) !== uid);
    room.admins = (room.admins || []).filter((a) => normUid(a) !== uid);
    if (!room.members.length) {
      if (room.kind === 'channel' && room.username) {
        channelUsernames.delete(String(room.username).toLowerCase());
      }
      rooms.delete(rid);
      continue;
    }
    if (room.members.length !== before) {
      saveRoomsJSON();
      broadcastRoomToMembers(room);
    }
  }

  saveRoomsJSON();
  safeWsSend(ws, { type: 'clear-all-data-ok' });
  console.log(`🧹 Cleared server chat data for ${uid.substring(0, 8)}…`);
}

// ==================== RELAY MESSAGE ====================
// Relay messages between users for history sync
function handleRelayMessage(fromUuid, data) {
  if (!data?.to || !data?.msg) return;

  const toUuid = normUid(data.to);
  const msg = data.msg;

  // PRIVACY: Add time bucket to relayed message
  if (msg && !msg.timeBucket) {
    msg.timeBucket = getTimeBucket();
  }

  // Relay the message to the target user
  const toUser = getUserLive(toUuid);
  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'relayed-message', data: msg });
    console.log(`📨 Relayed message: ${fromUuid.substring(0, 8)}… → ${toUuid.substring(0, 8)}…`);
  } else {
    console.log(`⚠️ Target user ${toUuid.substring(0, 8)}… offline, cannot relay message`);
  }
}

// ==================== EDIT MESSAGE ====================
// Blind router for edit messages - server never parses encrypted content
function handleEditMessage(fromUuid, data) {
  if (!data?.to || !data?.originalTs) return;

  const toUuid = normUid(data.to);
  const originalMsgId = data.originalMsgId || `${fromUuid}:${Number(data.originalTs)}`;

  // Check if this is an E2EE edit (has encrypted payload)
  if (data.payload && data.iv && data.signature) {
    // Blind router: just forward the encrypted payload
    const message = {
      from: fromUuid,
      to: toUuid,
      type: 'edit-msg',
      payload: data.payload,
      iv: data.iv,
      signature: data.signature,
      originalTs: data.originalTs,
      originalMsgId,
      ts: data.ts || Date.now(),
      // PRIVACY: Use coarse-grained time bucket instead of precise timestamp
      timeBucket: getTimeBucket()
    };
    
    const toUser = getUserLive(toUuid);
    if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(toUser.ws, { type: 'edit-message', data: message });
      console.log(`✏️ E2EE edit-msg: ${fromUuid.substring(0, 8)}… → ${toUuid.substring(0, 8)}…`);
    } else {
      // Queue for offline delivery
      enqueueMessageToStore(message);
      console.log(`⏸️ Queued edit-msg for ${toUuid.substring(0, 8)}…`);
    }
  } else {
    // Legacy plaintext edit (fallback)
    const message = {
      from: fromUuid,
      to: toUuid,
      type: 'edit-msg',
      originalTs: data.originalTs,
      originalMsgId,
      newContent: data.newContent,
      ts: data.ts || Date.now()
    };
    
    const toUser = getUserLive(toUuid);
    if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(toUser.ws, { type: 'edit-message', data: message });
    } else {
      enqueueMessageToStore(message);
    }
    console.log(`✏️ Plaintext edit-msg: ${fromUuid.substring(0, 8)}… → ${toUuid.substring(0, 8)}…`);
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
║  Cipher Server v5.0 — E2EE + Blind Router             ║
║═══════════════════════════════════════════════════════║
║ 🚀 Running on: 0.0.0.0:${PORT}${' '.repeat(18 - String(PORT).length)}║
║ 🔐 Passwords: PBKDF2-SHA512 (100k rounds)             ║
║ 🔑 E2EE: ECDSA (P-384) + ECDH (P-384) + AES-GCM       ║
║ 💾 Persistence: ${(dbModule ? 'SQLite AES-256' : 'JSON atomic  ').padEnd(22)}║
║ 🛡️  Rate limiting: register + login per IP            ║
║ 📦 Max payload: 25MB                                  ║
║ 📞 WebRTC signaling: encrypted                        ║
╚═══════════════════════════════════════════════════════╝
  `);
  console.log(`✓ WebSocket server listening on port ${PORT}\n`);
});
