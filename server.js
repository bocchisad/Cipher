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
  const { to } = message;
  if (dbModule) {
    dbModule.enqueueMessage(message);
  } else {
    if (!messageQueue.has(to)) messageQueue.set(to, []);
    messageQueue.get(to).push(message);
    saveQueueJSON();
  }
}

function dequeueMessagesFromStore(uuid) {
  if (dbModule) {
    return dbModule.dequeueMessages(uuid);
  }
  const msgs = messageQueue.get(uuid) || [];
  if (msgs.length > 0) {
    messageQueue.delete(uuid);
    saveQueueJSON();
  }
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
  const { type, data, uuid } = msg;

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
      handleRtcSignal(uuid, type, data);
      break;
    case 'delete-for-both':
      handleDeleteForBoth(uuid, data);
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

  const user = getUserFromStore(uuid);

  if (!user) {
    console.warn(`❌ Login: user not found ${uuid.substring(0, 8)}...`);
    safeWsSend(ws, { type: 'error', error: 'User not found' });
    return;
  }

  if (!verifyPassword(password, user.password)) {
    console.warn(`❌ Login: wrong password for ${uuid.substring(0, 8)}...`);
    safeWsSend(ws, { type: 'error', error: 'Wrong password' });
    return;
  }

  // Upgrade legacy SHA-256 → PBKDF2
  if (!user.password.startsWith('pbkdf2:')) {
    user.password = hashPassword(password);
    console.log(`🔒 Upgraded password hash for ${uuid.substring(0, 8)}...`);
  }

  // Close old connection if active
  const memUser = users.get(uuid);
  if (memUser?.ws && memUser.ws !== ws && memUser.ws.readyState === WebSocket.OPEN) {
    console.log(`♻️ Replacing old connection for ${user.nickname}`);
    memUser.ws.close();
  }

  // Merge: keep ws in memory record
  const updatedUser = { ...user, ws, lastSeen: Date.now() };
  users.set(uuid, updatedUser);
  setUserId(uuid);
  saveUserToStore(updatedUser);

  const onlineUsers = Array.from(users.values())
    .filter(u => u.ws && u.ws.readyState === WebSocket.OPEN)
    .map(u => ({ uuid: u.uuid, nickname: u.nickname, avatar: u.avatar }));

  // Deliver queued messages
  const pending = dequeueMessagesFromStore(uuid);
  if (pending.length > 0) {
    console.log(`📨 Delivering ${pending.length} queued messages to ${user.nickname}`);
    pending.forEach(qMsg => safeWsSend(ws, { type: 'message', data: qMsg }));
  }

  console.log(`✅ Login: ${user.nickname} (${uuid.substring(0, 8)}...) [${users.size} users, ${onlineUsers.length} online]`);

  safeWsSend(ws, { type: 'login-ok', uuid, nickname: user.nickname, avatar: user.avatar, users: onlineUsers });
  broadcast({ type: 'user-online', data: { uuid, nickname: user.nickname, avatar: user.avatar } }, uuid);
}

// ==================== SEND MESSAGE ====================
function handleSendMessage(fromUuid, data) {
  if (!fromUuid || !data?.to) {
    console.warn('⚠️ handleSendMessage: missing fromUuid or data.to');
    return;
  }

  const { to, content, ts, type: msgType } = data;
  const message = { from: fromUuid, to, content, ts, type: msgType };

  console.log(`💬 ${fromUuid.substring(0, 8)}... → ${to.substring(0, 8)}...`);

  const toUser = users.get(to);

  if (toUser?.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'message', data: message });

    // Delivery receipt to sender
    const fromUser = users.get(fromUuid);
    if (fromUser?.ws && fromUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(fromUser.ws, { type: 'delivered', data: { to, ts } });
    }

    console.log(`  ✓ Delivered to ${toUser.nickname}`);
  } else {
    // [FIX-3.5] Queue is now persisted
    enqueueMessageToStore(message);
    console.log(`  ⏸️ Queued for ${to.substring(0, 8)}...`);
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
