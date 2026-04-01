#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server
 * Минималистичный сервер мессенджера (как Telegram/WhatsApp)
 *
 * Функции:
 * - Раздача index.html (фронтенд)
 * - Маршрутизация сообщений между пользователями
 * - Хранение сообщений для офлайн пользователей
 * - Синхронизация статуса онлайн/офлайн
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;

// ==================== STORAGE ====================
const users = new Map(); // username -> {ws, nick, avatar, lastSeen}
const messageQueue = new Map(); // username -> [{from, to, content, ts}, ...]

// ==================== SERVER ====================
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const app = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
  res.end(`Cipher Messenger Relay Server\n${users.size} users connected`);
});

const wss = new WebSocket.Server({ server: app, perMessageDeflate: false });

wss.on('connection', (ws, req) => {
  console.log(`🟢 New WS connection from: ${req.headers.origin || req.socket.remoteAddress}`);
  let username = null;
  let isAlive = true;

  ws.on('pong', () => {
    isAlive = true;
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      await handleMessage(ws, msg, (username_) => username = username_);
    } catch (err) {
      console.error('Message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (username) {
      const user = users.get(username);
      if (user && user.ws === ws) {
        users.delete(username);
        broadcast({ type: 'user-offline', data: username });
        console.log(`✗ ${username} disconnected`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ==================== MESSAGE HANDLERS ====================
async function handleMessage(ws, msg, setUsername) {
  const { type, data, username } = msg;

  switch (type) {
    case 'auth':
      handleAuth(ws, data, setUsername);
      break;
    case 'message':
      handleSendMessage(username, data);
      break;
    case 'profile-update':
      handleProfileUpdate(username, data);
      break;
  }
}

function handleAuth(ws, data, setUsername) {
  const { username, nick, avatar } = data;

  if (!username || username.length < 3) {
    ws.send(JSON.stringify({ type: 'error', error: 'Invalid username' }));
    return;
  }

  if (users.has(username)) {
    const old = users.get(username);
    if (old.ws && old.ws.readyState === WebSocket.OPEN) {
      old.ws.close();
    }
  }

  const user = {
    ws,
    username,
    nick: nick || username,
    avatar: avatar || '',
    lastSeen: Date.now()
  };

  users.set(username, user);
  setUsername(username);

  console.log(`✓ ${username} connected (${users.size} total)`);

  const onlineUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    nick: u.nick,
    avatar: u.avatar
  }));

  if (messageQueue.has(username)) {
    const pending = messageQueue.get(username);
    pending.forEach(msg => {
      ws.send(JSON.stringify({ type: 'message', data: msg }));
    });
    messageQueue.delete(username);
    console.log(`  📨 Доставлено ${pending.length} сообщений для ${username}`);
  }

  ws.send(JSON.stringify({ type: 'auth-ok', users: onlineUsers }));
  broadcast({ type: 'user-online', data: { username, nick: user.nick, avatar: user.avatar } });
}

function handleSendMessage(from, data) {
  const { to, content, ts } = data;
  const message = { from, to, content, ts };

  const toUser = users.get(to);

  if (toUser && toUser.ws.readyState === WebSocket.OPEN) {
    toUser.ws.send(JSON.stringify({ type: 'message', data: message }));
  } else {
    if (!messageQueue.has(to)) {
      messageQueue.set(to, []);
    }
    messageQueue.get(to).push(message);
    console.log(`  ⏸️  Сообщение от ${from} → ${to} в очереди (${messageQueue.get(to).length} ожидают)`);
  }
}

function handleProfileUpdate(username, data) {
  const user = users.get(username);
  if (!user) return;

  if (data.nick) user.nick = data.nick;
  if (data.avatar) user.avatar = data.avatar;

  broadcast({
    type: 'user-profile',
    data: { username, nick: user.nick, avatar: user.avatar }
  });
}

// ==================== BROADCAST ====================
function broadcast(msg, excludeUser = null) {
  const data = JSON.stringify(msg);
  for (const [username, user] of users) {
    if (excludeUser && username === excludeUser) continue;
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  }
}

// ==================== STATS ====================
setInterval(() => {
  console.log(`[${new Date().toLocaleTimeString()}] 👥 Пользователей: ${users.size}, 📋 В очереди: ${messageQueue.size}`);
}, 30000);

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', () => {
  console.log('\n👋 Выключение сервера...');
  wss.clients.forEach(ws => ws.close());
  app.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║       Cipher Messenger Server v2.0                ║
╠═══════════════════════════════════════════════════╣
║ 🚀 Порт: ${PORT}                                     ║
║ 🌐 http://0.0.0.0:${PORT}                            ║
║ 🔌 ws://0.0.0.0:${PORT}                              ║
║ Готово к подключению...                           ║
╚═══════════════════════════════════════════════════╝
  `);
});
