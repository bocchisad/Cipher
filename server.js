#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server - UUID-based Authentication
 * - UUID: реальный идентификатор пользователя
 * - Nickname: визуальное имя (может быть изменено)
 * - Сообщения отправляются по UUID
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0';

// ==================== HELPERS ====================
function generateUUID() {
  return crypto.randomBytes(16).toString('hex');
}

// ==================== STORAGE ====================
const users = new Map(); // uuid -> {ws, uuid, nickname, avatar, lastSeen, password}
const messageQueue = new Map(); // uuid -> [{from, to, content, ts}, ...]

// ==================== PERSISTENCE ====================
const fs = require('fs');
const path = require('path');
const USERS_FILE = path.join(__dirname, 'users.json');

function saveUsers() {
  const data = {};
  for (const [uuid, user] of users) {
    data[uuid] = { uuid: user.uuid, nickname: user.nickname, avatar: user.avatar, password: user.password, lastSeen: user.lastSeen };
  }
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); } catch(e) { console.error('Save error:', e.message); }
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [uuid, user] of Object.entries(data)) {
        users.set(uuid, { ...user, ws: null });
      }
      console.log(`✓ Loaded ${users.size} users from disk`);
    }
  } catch(e) { console.error('Load error:', e.message); }
}

// ==================== SERVER ====================
const app = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(200, {'Content-Type': 'text/plain'});
      res.end(`Cipher Messenger Server\n${users.size} users connected\nUptime: ${process.uptime().toFixed(0)}s`);
      return;
    }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server: app, perMessageDeflate: false});

wss.on('connection', (ws, req) => {
  let userId = null; // UUID пользователя
  let isAlive = true;
  const ip = req.socket.remoteAddress;

  console.log(`📡 New connection from ${ip}`);

  // Отправляем сразу сигнал что сервер готов
  ws.send(JSON.stringify({type: 'server-ready', timestamp: Date.now()}));

  ws.on('pong', () => {
    isAlive = true;
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      await handleMessage(ws, msg, (uid) => userId = uid);
    } catch (err) {
      console.error('❌ Message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (userId) {
      const user = users.get(userId);
      if (user && user.ws === ws) {
        users.delete(userId);
        broadcast({type: 'user-offline', data: userId});
        console.log(`✗ ${user.nickname} (${userId}) disconnected`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WS error:', err.message);
  });
});

// Heartbeat
setInterval(() => {
  let activeCount = 0;
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('💀 Terminating dead connection');
      return ws.terminate();
    }
    activeCount++;
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ==================== MESSAGE HANDLERS ====================
async function handleMessage(ws, msg, setUserId) {
  const {type, data, uuid} = msg;

  console.log(`📬 Message type="${type}" from ${uuid ? uuid.substring(0, 8) : 'unknown'}...`);

  switch(type) {
    case 'register':
      handleRegister(ws, msg);
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
    default:
      console.warn(`⚠️ Unknown message type: ${type}`);
  }
}

// ==================== REGISTRATION ====================
function handleRegister(ws, msg) {
  const {password, nickname, avatar} = msg || {};

  if (!password || password.length < 4) {
    console.error('❌ Register error: invalid password');
    ws.send(JSON.stringify({type: 'error', error: 'Password too short (min 4)'}));
    return;
  }

  if (!nickname || nickname.length < 1) {
    console.error('❌ Register error: invalid nickname');
    ws.send(JSON.stringify({type: 'error', error: 'Nickname too short'}));
    return;
  }

  // Генерируем новый UUID
  const uuid = generateUUID();

  console.log(`📝 Register new user: ${nickname} → ${uuid.substring(0, 8)}...`);

  const user = {
    ws,
    uuid,
    nickname: nickname || 'User',
    avatar: avatar || '',
    password: hashPassword(password), // TODO: use proper hashing
    lastSeen: Date.now()
  };

  users.set(uuid, user);
  saveUsers();

  console.log(`✅ Registration successful: ${nickname} (${uuid.substring(0, 8)}...)`);

  ws.send(JSON.stringify({ type: 'register-ok', uuid, nickname: user.nickname, avatar: user.avatar }));
}

// ==================== REREGISTER (restore after server restart) ====================
function handleReregister(ws, msg, setUserId) {
  const {uuid, password, nickname, avatar} = msg || {};

  if (!uuid || !password) {
    ws.send(JSON.stringify({type: 'error', error: 'Missing credentials'}));
    return;
  }

  // If user already exists (loaded from disk), just do a login
  if (users.has(uuid)) {
    handleLogin(ws, msg, setUserId);
    return;
  }

  // Restore user with their existing UUID
  const user = {
    ws,
    uuid,
    nickname: nickname || uuid.substring(0, 8),
    avatar: avatar || '',
    password: hashPassword(password),
    lastSeen: Date.now()
  };

  users.set(uuid, user);
  setUserId(uuid);
  saveUsers();

  console.log(`♻️ Reregistered: ${user.nickname} (${uuid.substring(0, 8)}...)`);
  ws.send(JSON.stringify({ type: 'login-ok', uuid, nickname: user.nickname, avatar: user.avatar, users: [] }));
  broadcast({type: 'user-online', data: {uuid, nickname: user.nickname, avatar: user.avatar}}, uuid);
}

// ==================== LOGIN ====================
function handleLogin(ws, msg, setUserId) {
  const {uuid, password} = msg || {};

  if (!uuid || !password) {
    console.error('❌ Login error: missing uuid or password');
    ws.send(JSON.stringify({type: 'error', error: 'Missing credentials'}));
    return;
  }

  const user = users.get(uuid);

  if (!user) {
    console.error(`❌ Login error: user not found ${uuid.substring(0, 8)}...`);
    ws.send(JSON.stringify({type: 'error', error: 'User not found'}));
    return;
  }

  // TODO: implement proper password verification
  if (user.password !== hashPassword(password)) {
    console.error(`❌ Login error: wrong password for ${uuid.substring(0, 8)}...`);
    ws.send(JSON.stringify({type: 'error', error: 'Wrong password'}));
    return;
  }

  console.log(`🔐 Login attempt: ${user.nickname} (${uuid.substring(0, 8)}...)`);

  // Закрываем старое соединение если есть
  if (user.ws && user.ws !== ws && user.ws.readyState === WebSocket.OPEN) {
    console.log(`♻️  Replacing old connection`);
    user.ws.close();
  }

  // Обновляем пользователя с новым WebSocket
  user.ws = ws;
  user.lastSeen = Date.now();
  users.set(uuid, user);
  setUserId(uuid);

  console.log(`✅ Login successful: ${user.nickname} (${users.size} total online)`);

  // Отправляем список онлайн пользователей
  const onlineUsers = Array.from(users.values()).map(u => ({
    uuid: u.uuid,
    nickname: u.nickname,
    avatar: u.avatar
  }));

  // Отправляем сохранённые сообщения
  if (messageQueue.has(uuid)) {
    const pending = messageQueue.get(uuid);
    console.log(`📨 Delivering ${pending.length} queued messages`);
    pending.forEach(msg => {
      ws.send(JSON.stringify({type: 'message', data: msg}));
    });
    messageQueue.delete(uuid);
  }

  ws.send(JSON.stringify({
    type: 'login-ok',
    uuid: uuid,
    nickname: user.nickname,
    avatar: user.avatar,
    users: onlineUsers
  }));

  // Уведомляем всех о новом пользователе
  broadcast({type: 'user-online', data: {uuid, nickname: user.nickname, avatar: user.avatar}}, uuid);
}

// ==================== MESSAGE SENDING ====================
function handleSendMessage(fromUuid, data) {
  const {to, content, ts, type: msgType} = data;
  const message = {from: fromUuid, to, content, ts, type: msgType};

  console.log(`💬 Message: ${fromUuid.substring(0, 8)}... → ${to.substring(0, 8)}...`);

  const toUser = users.get(to);

  if (toUser && toUser.ws.readyState === WebSocket.OPEN) {
    toUser.ws.send(JSON.stringify({type: 'message', data: message}));
    console.log(`  ✓ Delivered immediately`);
  } else {
    if (!messageQueue.has(to)) {
      messageQueue.set(to, []);
    }
    messageQueue.get(to).push(message);
    console.log(`  ⏸️  Queued (${messageQueue.get(to).length} pending)`);
  }
}

// ==================== PROFILE UPDATE ====================
function handleProfileUpdate(uuid, data) {
  const user = users.get(uuid);
  if (!user) {
    console.warn(`⚠️ Profile update from unknown user: ${uuid.substring(0, 8)}...`);
    return;
  }

  if (data.nickname) user.nickname = data.nickname;
  if (data.avatar) user.avatar = data.avatar;

  console.log(`👤 Profile update: ${user.nickname}`);

  broadcast({
    type: 'user-profile',
    data: {uuid, nickname: user.nickname, avatar: user.avatar}
  });
}

// ==================== BROADCAST ====================
function broadcast(msg, excludeUuid = null) {
  const data = JSON.stringify(msg);
  for (const [uuid, user] of users) {
    if (excludeUuid && uuid === excludeUuid) continue;
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

// ==================== STATS ====================
setInterval(() => {
  console.log(`[${new Date().toLocaleTimeString()}] 👥 Users: ${users.size}, 📋 Queued: ${messageQueue.size}`);
}, 30000);

// ==================== SHUTDOWN ====================
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server...');
  wss.clients.forEach(ws => ws.close());
  app.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});

// ==================== START ====================
loadUsers();
app.listen(PORT, HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  Cipher Server v3.0 - UUID-based Authentication      ║
║═══════════════════════════════════════════════════════║
║ 🚀 Running on: 0.0.0.0:${PORT}${' '.repeat(18 - String(PORT).length)}║
║ 🔐 Auth: Register/Login with UUID + Password         ║
║ 📊 Status: Ready for connections                     ║
╚═══════════════════════════════════════════════════════╝
  `);
  console.log(`✓ WebSocket server listening on port ${PORT}\n`);
});

// ==================== UTILS ====================
function hashPassword(pwd) {
  // TODO: use bcrypt or argon2
  return crypto.createHash('sha256').update(pwd).digest('hex');
}
