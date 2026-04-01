#!/usr/bin/env node
/**
 * Cipher P2P Messenger - Relay Server
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 5000;

// ==================== STORAGE ====================
const users = new Map();
const messageQueue = new Map();

// ==================== HTTP SERVER ====================
const app = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(`Cipher Relay Server | users: ${users.size}`);
});

// ==================== WEBSOCKET (noServer mode) ====================
const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

app.on('upgrade', (req, socket, head) => {
  console.log(`🔌 WS upgrade from: ${req.headers.origin || socket.remoteAddress}`);
  socket.on('error', (err) => {
    console.error('Socket error during upgrade:', err.message);
  });
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log(`🟢 Connected: ${req.headers.origin || 'unknown'}`);
  let username = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      await handleMessage(ws, msg, (u) => { username = u; });
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
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

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
    if (old.ws && old.ws.readyState === WebSocket.OPEN) old.ws.close();
  }

  const user = { ws, username, nick: nick || username, avatar: avatar || '' };
  users.set(username, user);
  setUsername(username);
  console.log(`✓ ${username} authed (total: ${users.size})`);

  const onlineUsers = Array.from(users.values()).map(u => ({
    username: u.username, nick: u.nick, avatar: u.avatar
  }));

  if (messageQueue.has(username)) {
    messageQueue.get(username).forEach(m => {
      ws.send(JSON.stringify({ type: 'message', data: m }));
    });
    messageQueue.delete(username);
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
    if (!messageQueue.has(to)) messageQueue.set(to, []);
    messageQueue.get(to).push(message);
    console.log(`  ⏸ ${from} → ${to} queued`);
  }
}

function handleProfileUpdate(username, data) {
  const user = users.get(username);
  if (!user) return;
  if (data.nick) user.nick = data.nick;
  if (data.avatar) user.avatar = data.avatar;
  broadcast({ type: 'user-profile', data: { username, nick: user.nick, avatar: user.avatar } });
}

function broadcast(msg, excludeUser = null) {
  const data = JSON.stringify(msg);
  for (const [u, user] of users) {
    if (excludeUser && u === excludeUser) continue;
    if (user.ws.readyState === WebSocket.OPEN) user.ws.send(data);
  }
}

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cipher Relay Server running on port ${PORT}`);
});

setInterval(() => {
  console.log(`[stats] users: ${users.size}, queued: ${messageQueue.size}`);
}, 30000);
