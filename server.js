#!/usr/bin/env node
/**
 * Cipher P2P Messenger Server
 * Минималистичный сервер мессенджера (как Telegram/WhatsApp)
 * 
 * Функции:
 * - Маршрутизация сообщений между пользователями
 * - Хранение сообщений для офлайн пользователей
 * - Синхронизация статуса онлайн/офлайн
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// ==================== STORAGE ====================
const users = new Map(); // username -> {ws, nick, avatar, lastSeen}
const messageQueue = new Map(); // username -> [{from, to, content, ts}, ...]

// ==================== SERVER ====================
let app;

// На Replit HTTPS автоматический через фронтенд
// Мы просто используем HTTP локально, а Replit обрабатывает SSL/TLS
app = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*'});
  res.end(`Cipher Messenger Server\n${users.size} users connected\nUptime: ${process.uptime().toFixed(0)}s`);
});

const wss = new WebSocket.Server({server: app, perMessageDeflate: false});

wss.on('connection', (ws, req) => {
  let username = null;
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
        broadcast({type: 'user-offline', data: username});
        console.log(`✗ ${username} disconnected`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// Heartbeat - проверяем соединения каждые 30 сек
setInterval(() => {
  let activeCount = 0;
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('💀 Терминирую мертвое соединение');
      return ws.terminate();
    }
    activeCount++;
    ws.isAlive = false;
    ws.ping();
  });
  // console.log(`[Heartbeat] ${activeCount} active connections`);
}, 30000);

// ==================== MESSAGE HANDLERS ====================
async function handleMessage(ws, msg, setUsername) {
  const {type, data, username} = msg;

  console.log(`📬 Сообщение type="${type}" от ${username || 'unknown'}`, data ? Object.keys(data) : '');

  switch(type) {
    case 'auth':
      handleAuth(ws, data, username, setUsername);
      break;
    case 'message':
      handleSendMessage(username, data);
      break;
    case 'profile-update':
      handleProfileUpdate(username, data);
      break;
    default:
      console.warn(`⚠️ Неизвестный тип сообщения: ${type}`);
  }
}

function handleAuth(ws, data, clientUsername, setUsername) {
  const {username, nick, avatar} = data || {};

  if (!username || username.length < 3) {
    console.error('❌ Auth ошибка: неверный username', {username, nick});
    ws.send(JSON.stringify({type: 'error', error: 'Invalid username'}));
    return;
  }

  console.log(`🔐 Auth попытка: ${username}`);

  // Удаляем старое соединение если есть
  if (users.has(username)) {
    const old = users.get(username);
    console.log(`♻️  Заменяю старое соединение для ${username}`);
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

  console.log(`✅ ${username} auth успешен (${users.size} total users online)`);

  // Отправляем список онлайн пользователей
  const onlineUsers = Array.from(users.values()).map(u => ({
    username: u.username,
    nick: u.nick,
    avatar: u.avatar
  }));

  // Отправляем сохранённые сообщения
  if (messageQueue.has(username)) {
    const pending = messageQueue.get(username);
    console.log(`📨 Доставляю ${pending.length} сообщений для ${username}`);
    pending.forEach(msg => {
      ws.send(JSON.stringify({type: 'message', data: msg}));
    });
    messageQueue.delete(username);
  }

  ws.send(JSON.stringify({type: 'auth-ok', users: onlineUsers, username: username}));

  // Уведомляем всех о новом пользователе
  broadcast({type: 'user-online', data: {username, nick: user.nick, avatar: user.avatar}}, username);
}

function handleSendMessage(from, data) {
  const {to, content, ts} = data;
  const message = {from, to, content, ts};

  console.log(`💬 Сообщение: ${from} → ${to}`);

  const toUser = users.get(to);

  if (toUser && toUser.ws.readyState === WebSocket.OPEN) {
    // Пользователь онлайн - отправляем сразу
    toUser.ws.send(JSON.stringify({type: 'message', data: message}));
    console.log(`  ✓ Доставлено сразу`);
  } else {
    // Пользователь офлайн - сохраняем в очередь
    if (!messageQueue.has(to)) {
      messageQueue.set(to, []);
    }
    messageQueue.get(to).push(message);
    console.log(`  ⏸️  В очереди (${messageQueue.get(to).length} ожидают)`);
  }
}

function handleProfileUpdate(username, data) {
  const user = users.get(username);
  if (!user) {
    console.warn(`⚠️ Profile update от неизвестного пользователя: ${username}`);
    return;
  }

  console.log(`👤 Profile update: ${username}`, {nick: data.nick, hasAvatar: !!data.avatar});

  if (data.nick) user.nick = data.nick;
  if (data.avatar) user.avatar = data.avatar;

  // Уведомляем всех об обновлении профиля
  broadcast({
    type: 'user-profile',
    data: {username, nick: user.nick, avatar: user.avatar}
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
app.listen(PORT, HOST, () => {
  const proto = 'wss';
  // На Replit URL генерируется автоматически и доступен через переменную окружения
  // Формат: https://projectname.randomstring.repl.co
  const replitUrl = process.env.REPLIT_OUTAGE_URL || process.env.REPL_SLUG || 'localhost';
  const domain = replitUrl.replace('https://', '').replace('http://', '');

  console.log(`
╔═══════════════════════════════════════════════════════╗
║     Cipher Messenger Server v2.1 - WebSocket Relay    ║
║═══════════════════════════════════════════════════════║
║ 🚀 Запущен на: 0.0.0.0:${PORT}${' '.repeat(18 - String(PORT).length)}║
║ 🌐 WebSocket URL:                                     ║
║    ${proto}://${domain}${' '.repeat(30 - domain.length)}║
║ 📊 Статус: Готово к подключению${' '.repeat(16)}║
║ 🔐 Поддерживает WSS (Secure WebSocket)${' '.repeat(8)}║
╚═══════════════════════════════════════════════════════╝
  `);

  console.log(`\n✓ Сервер готов к подключениям`);
  console.log(`✓ Используйте этот URL в клиенте: wss://${domain}`);
  console.log(`✓ Ожидаю соединения на порту ${PORT}\n`);
});

function getLocalIP() {
  const {networkInterfaces} = require('os');
  const interfaces = networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
