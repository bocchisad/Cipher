#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server v4.0
 * Fixes applied:
 * - PBKDF2 password hashing (replaces SHA-256)
 * - Disconnect: set ws=null, don't delete users (fixes "User not found" bug)
 * - broadcast() null-check on user.ws
 * - Rate limiting for registration
 * - WebRTC signaling (offer/answer/ice) forwarded
 * - Delivered receipts sent to sender
 * - Online user list filtered to only active connections
 * - Atomic file save for persistence
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ==================== CONFIG ====================
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';
const USERS_FILE = path.join(__dirname, 'users.json');

// ==================== HELPERS ====================
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

// PBKDF2 password hashing (much stronger than plain SHA-256)
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pwd, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  try {
    if (stored.startsWith('pbkdf2:')) {
      // New PBKDF2 format
      const [, salt, hash] = stored.split(':');
      const computed = crypto.pbkdf2Sync(pwd, salt, 100000, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
    } else {
      // Legacy SHA-256 format — upgrade on login
      const legacy = crypto.createHash('sha256').update(pwd).digest('hex');
      return legacy === stored;
    }
  } catch {
    return false;
  }
}

// ==================== STORAGE ====================
const users = new Map(); // uuid -> {ws, uuid, nickname, avatar, lastSeen, password}
const messageQueue = new Map(); // uuid -> [{from, to, content, ts}, ...]

// ==================== RATE LIMITING ====================
const regAttempts = new Map(); // ip -> {count, resetAt}

function checkRateLimit(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const rec = regAttempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowMs; }
  rec.count++;
  regAttempts.set(ip, rec);
  return rec.count <= limit;
}

// Clean up rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of regAttempts) {
    if (now > rec.resetAt) regAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

// ==================== PERSISTENCE ====================
function saveUsers() {
  const data = {};
  for (const [uuid, user] of users) {
    data[uuid] = {
      uuid: user.uuid,
      nickname: user.nickname,
      avatar: user.avatar,
      password: user.password,
      lastSeen: user.lastSeen
    };
  }
  // Atomic write: write to temp file, then rename
  const tmp = USERS_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, USERS_FILE);
  } catch(e) {
    console.error('💾 Save error:', e.message);
    // Clean up temp file if it exists
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [uuid, user] of Object.entries(data)) {
        users.set(uuid, { ...user, ws: null }); // ws is always null on load
      }
      console.log(`✓ Loaded ${users.size} users from disk`);
    }
  } catch(e) {
    console.error('💾 Load error:', e.message);
    // Try to load from backup if main file is corrupt
    const backup = USERS_FILE + '.bak';
    if (fs.existsSync(backup)) {
      try {
        const data = JSON.parse(fs.readFileSync(backup, 'utf8'));
        for (const [uuid, user] of Object.entries(data)) {
          users.set(uuid, { ...user, ws: null });
        }
        console.log(`✓ Loaded ${users.size} users from backup`);
      } catch(e2) {
        console.error('💾 Backup load error:', e2.message);
      }
    }
  }
}

// Save backup every 5 minutes
setInterval(() => {
  if (fs.existsSync(USERS_FILE)) {
    try { fs.copyFileSync(USERS_FILE, USERS_FILE + '.bak'); } catch {}
  }
}, 5 * 60 * 1000);

// ==================== SERVER ====================
const app = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({
      status: 'ok',
      users: users.size,
      online: Array.from(users.values()).filter(u => u.ws && u.ws.readyState === WebSocket.OPEN).length,
      queued: messageQueue.size,
      uptime: Math.floor(process.uptime())
    }));
    return;
  }

  // Serve index.html if it exists
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(`Cipher Messenger Server v4.0\nUsers: ${users.size}\nUptime: ${process.uptime().toFixed(0)}s`);
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: app, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  let userId = null;
  ws.isAlive = true;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  console.log(`📡 New connection from ${ip}`);

  // Send server-ready signal immediately
  ws.send(JSON.stringify({ type: 'server-ready', timestamp: Date.now() }));

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
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
        // FIX: don't delete — set ws to null so user can reconnect
        user.ws = null;
        user.lastSeen = Date.now();
        saveUsers();
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
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ==================== MESSAGE ROUTER ====================
async function handleMessage(ws, msg, setUserId, ip) {
  const { type, data, uuid } = msg;

  switch (type) {
    case 'register':
      handleRegister(ws, msg, ip);
      break;
    case 'reregister':
      handleReregister(ws, msg, setUserId);
      break;
    case 'login':
      handleLogin(ws, msg, setUserId);
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
function handleRegister(ws, msg, ip) {
  if (!checkRateLimit(ip, 5, 60000)) {
    safeWsSend(ws, { type: 'error', error: 'Too many registrations. Try again in 1 minute.' });
    console.warn(`⚠️ Rate limit hit for ${ip}`);
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
  saveUsers();

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

  if (users.has(uuid)) {
    // User exists — just do a login
    handleLogin(ws, msg, setUserId);
    return;
  }

  // Restore with existing UUID
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
  saveUsers();

  console.log(`♻️ Reregistered: ${user.nickname} (${uuid.substring(0, 8)}...)`);
  safeWsSend(ws, { type: 'login-ok', uuid, nickname: user.nickname, avatar: user.avatar, users: [] });
  broadcast({ type: 'user-online', data: { uuid, nickname: user.nickname, avatar: user.avatar } }, uuid);
}

// ==================== LOGIN ====================
function handleLogin(ws, msg, setUserId) {
  const { uuid, password } = msg || {};

  if (!uuid || !password) {
    safeWsSend(ws, { type: 'error', error: 'Missing credentials' });
    return;
  }

  const user = users.get(uuid);

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

  // Upgrade legacy SHA-256 hash to PBKDF2 on login
  if (!user.password.startsWith('pbkdf2:')) {
    user.password = hashPassword(password);
    console.log(`🔒 Upgraded password hash for ${uuid.substring(0, 8)}...`);
  }

  // Close old connection if active
  if (user.ws && user.ws !== ws && user.ws.readyState === WebSocket.OPEN) {
    console.log(`♻️ Replacing old connection for ${user.nickname}`);
    user.ws.close();
  }

  user.ws = ws;
  user.lastSeen = Date.now();
  users.set(uuid, user);
  setUserId(uuid);
  saveUsers();

  // Only send currently active users
  const onlineUsers = Array.from(users.values())
    .filter(u => u.ws && u.ws.readyState === WebSocket.OPEN)
    .map(u => ({ uuid: u.uuid, nickname: u.nickname, avatar: u.avatar }));

  // Deliver queued messages
  if (messageQueue.has(uuid)) {
    const pending = messageQueue.get(uuid);
    console.log(`📨 Delivering ${pending.length} queued messages to ${user.nickname}`);
    pending.forEach(qMsg => safeWsSend(ws, { type: 'message', data: qMsg }));
    messageQueue.delete(uuid);
  }

  console.log(`✅ Login: ${user.nickname} (${uuid.substring(0, 8)}...) [${users.size} users, ${onlineUsers.length} online]`);

  safeWsSend(ws, {
    type: 'login-ok',
    uuid,
    nickname: user.nickname,
    avatar: user.avatar,
    users: onlineUsers
  });

  // Notify others
  broadcast({ type: 'user-online', data: { uuid, nickname: user.nickname, avatar: user.avatar } }, uuid);
}

// ==================== MESSAGE SENDING ====================
function handleSendMessage(fromUuid, data) {
  if (!fromUuid || !data?.to) {
    console.warn('⚠️ handleSendMessage: missing fromUuid or data.to');
    return;
  }

  const { to, content, ts, type: msgType } = data;
  const message = { from: fromUuid, to, content, ts, type: msgType };

  console.log(`💬 ${fromUuid.substring(0, 8)}... → ${to.substring(0, 8)}...`);

  const toUser = users.get(to);

  if (toUser && toUser.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'message', data: message });

    // Send delivery receipt to sender
    const fromUser = users.get(fromUuid);
    if (fromUser && fromUser.ws && fromUser.ws.readyState === WebSocket.OPEN) {
      safeWsSend(fromUser.ws, { type: 'delivered', data: { to, ts } });
    }

    console.log(`  ✓ Delivered to ${toUser.nickname}`);
  } else {
    if (!messageQueue.has(to)) messageQueue.set(to, []);
    messageQueue.get(to).push(message);
    console.log(`  ⏸️ Queued (${messageQueue.get(to).length} pending for ${to.substring(0, 8)}...)`);
  }
}

// ==================== PROFILE UPDATE ====================
function handleProfileUpdate(uuid, data) {
  const user = users.get(uuid);
  if (!user) return;

  // FIX: server reads both 'nickname' and 'nick' for compatibility
  if (data.nickname) user.nickname = data.nickname.slice(0, 32);
  else if (data.nick) user.nickname = data.nick.slice(0, 32);
  if (data.avatar !== undefined) user.avatar = data.avatar;
  user.lastSeen = Date.now();

  saveUsers();
  console.log(`👤 Profile update: ${user.nickname}`);

  broadcast({
    type: 'user-profile',
    data: { uuid, nickname: user.nickname, avatar: user.avatar }
  });
}

// ==================== WEBRTC SIGNALING ====================
function handleRtcSignal(fromUuid, type, data) {
  if (!data?.to) return;
  const toUser = users.get(data.to);
  if (toUser && toUser.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type, data: { ...data, from: fromUuid } });
    console.log(`📞 RTC ${type}: ${fromUuid.substring(0, 8)}... → ${data.to.substring(0, 8)}...`);
  }
}

// ==================== DELETE FOR BOTH ====================
function handleDeleteForBoth(fromUuid, data) {
  if (!data?.to) return;
  const toUser = users.get(data.to);
  if (toUser && toUser.ws && toUser.ws.readyState === WebSocket.OPEN) {
    safeWsSend(toUser.ws, { type: 'delete-for-both', data: { from: fromUuid, ts: data.ts } });
  }
}

// ==================== BROADCAST ====================
function broadcast(msg, excludeUuid = null) {
  const data = JSON.stringify(msg);
  for (const [uuid, user] of users) {
    if (excludeUuid && uuid === excludeUuid) continue;
    // FIX: null-check on user.ws before accessing readyState
    if (user.ws && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

// ==================== STATS ====================
setInterval(() => {
  const online = Array.from(users.values()).filter(u => u.ws && u.ws.readyState === WebSocket.OPEN).length;
  console.log(`[${new Date().toLocaleTimeString()}] 👥 Total: ${users.size} | Online: ${online} | Queued: ${messageQueue.size}`);
}, 30000);

// ==================== GRACEFUL SHUTDOWN ====================
function shutdown() {
  console.log('\n👋 Shutting down...');
  saveUsers();
  wss.clients.forEach(ws => ws.close());
  app.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ==================== START ====================
loadUsers();
app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  Cipher Server v4.0 — Production Ready               ║
║═══════════════════════════════════════════════════════║
║ 🚀 Running on: 0.0.0.0:${PORT}${' '.repeat(18 - String(PORT).length)}║
║ 🔐 Passwords: PBKDF2-SHA512 (100k rounds)            ║
║ 💾 Persistence: JSON with atomic writes              ║
║ 🛡️  Rate limiting: 5 regs/min per IP                ║
║ 📞 WebRTC signaling: offer/answer/ice                ║
╚═══════════════════════════════════════════════════════╝
  `);
  console.log(`✓ WebSocket server listening on port ${PORT}\n`);
});
