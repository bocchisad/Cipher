#!/usr/bin/env node
/**
 * Cipher P2P Messenger - Relay Server
 * Supports: WebSocket + HTTP polling fallback
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5000;

// ==================== STORAGE ====================
const wsUsers   = new Map(); // username -> {ws, nick, avatar}
const pollUsers = new Map(); // username -> {nick, avatar, lastSeen}
const pollQueues = new Map(); // username -> [{type, data, ts}]
const msgQueue  = new Map(); // offline username -> [messages]

function getAllUsers() {
  const out = {};
  for (const [u, d] of wsUsers)   out[u] = {username: u, nick: d.nick, avatar: d.avatar};
  for (const [u, d] of pollUsers) out[u] = {username: u, nick: d.nick, avatar: d.avatar};
  return Object.values(out);
}

function pushEvent(toUsername, event) {
  if (!pollQueues.has(toUsername)) pollQueues.set(toUsername, []);
  pollQueues.get(toUsername).push(event);
}

function broadcastEvent(event, excludeUser = null) {
  const data = JSON.stringify(event);
  for (const [u, user] of wsUsers) {
    if (u === excludeUser) continue;
    if (user.ws.readyState === WebSocket.OPEN) user.ws.send(data);
  }
  for (const [u] of pollUsers) {
    if (u === excludeUser) continue;
    pushEvent(u, event);
  }
}

// ==================== HTTP + API ====================
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) reject(new Error('Too large')); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(data));
}

const app = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : ''));

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // Serve index.html
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html', ...CORS });
      res.end(data);
    });
    return;
  }

  // HTTP Polling: Auth
  if (req.method === 'POST' && url === '/api/auth') {
    const body = await parseBody(req);
    const { username, nick, avatar } = body;
    if (!username || username.length < 3) return json(res, 400, {error: 'Invalid username'});

    pollUsers.set(username, { nick: nick || username, avatar: avatar || '', lastSeen: Date.now() });
    pollQueues.set(username, []);

    // Deliver queued messages
    const pending = msgQueue.get(username) || [];
    msgQueue.delete(username);
    const events = pending.map(m => ({ type: 'message', data: m }));

    broadcastEvent({ type: 'user-online', data: { username, nick: nick || username, avatar: avatar || '' } }, username);
    console.log(`✓ [HTTP] ${username} authed`);

    return json(res, 200, { ok: true, users: getAllUsers(), pending: events });
  }

  // HTTP Polling: Poll for new events
  if (req.method === 'GET' && url === '/api/poll') {
    const { username } = query;
    if (!username) return json(res, 400, {error: 'username required'});

    // Update lastSeen
    if (pollUsers.has(username)) pollUsers.get(username).lastSeen = Date.now();

    const events = pollQueues.get(username) || [];
    pollQueues.set(username, []);
    return json(res, 200, { events, users: getAllUsers() });
  }

  // HTTP Polling: Send message
  if (req.method === 'POST' && url === '/api/send') {
    const body = await parseBody(req);
    const { from, to, content, ts } = body;
    const message = { from, to, content, ts };

    const toWsUser = wsUsers.get(to);
    if (toWsUser && toWsUser.ws.readyState === WebSocket.OPEN) {
      toWsUser.ws.send(JSON.stringify({ type: 'message', data: message }));
    } else if (pollUsers.has(to)) {
      pushEvent(to, { type: 'message', data: message });
    } else {
      if (!msgQueue.has(to)) msgQueue.set(to, []);
      msgQueue.get(to).push(message);
    }
    return json(res, 200, { ok: true });
  }

  // HTTP Polling: Profile update
  if (req.method === 'POST' && url === '/api/profile') {
    const body = await parseBody(req);
    const { username, nick, avatar } = body;
    if (pollUsers.has(username)) {
      const u = pollUsers.get(username);
      if (nick) u.nick = nick;
      if (avatar) u.avatar = avatar;
    }
    broadcastEvent({ type: 'user-profile', data: { username, nick, avatar } }, username);
    return json(res, 200, { ok: true });
  }

  // HTTP Polling: Logout
  if (req.method === 'POST' && url === '/api/logout') {
    const body = await parseBody(req);
    const { username } = body;
    pollUsers.delete(username);
    pollQueues.delete(username);
    broadcastEvent({ type: 'user-offline', data: username });
    return json(res, 200, { ok: true });
  }

  // Status page
  if (req.method === 'GET' && url === '/api/status') {
    return json(res, 200, { wsUsers: wsUsers.size, pollUsers: pollUsers.size, users: getAllUsers() });
  }

  res.writeHead(404, CORS);
  res.end('Not found');
});

// ==================== WEBSOCKET ====================
const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });

app.on('upgrade', (req, socket, head) => {
  console.log(`🔌 WS upgrade from: ${req.headers.origin || socket.remoteAddress}`);
  socket.on('error', err => console.error('Socket error:', err.message));
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  console.log(`🟢 WS connected: ${req.headers.origin || 'unknown'}`);
  let username = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      const { type, data: d, username: u } = msg;
      switch (type) {
        case 'auth': {
          const { username: name, nick, avatar } = d;
          if (!name || name.length < 3) { ws.send(JSON.stringify({type:'error',error:'Invalid username'})); return; }
          if (wsUsers.has(name)) {
            const old = wsUsers.get(name);
            if (old.ws.readyState === WebSocket.OPEN) old.ws.close();
          }
          username = name;
          wsUsers.set(name, { ws, nick: nick||name, avatar: avatar||'' });
          const pending = msgQueue.get(name) || [];
          msgQueue.delete(name);
          pending.forEach(m => ws.send(JSON.stringify({type:'message',data:m})));
          ws.send(JSON.stringify({ type: 'auth-ok', users: getAllUsers() }));
          broadcastEvent({ type: 'user-online', data: { username: name, nick: nick||name, avatar: avatar||'' } }, name);
          console.log(`✓ [WS] ${name} authed (total: ${wsUsers.size + pollUsers.size})`);
          break;
        }
        case 'message': {
          const { to, content, ts } = d;
          const message = { from: u, to, content, ts };
          const toWs = wsUsers.get(to);
          if (toWs && toWs.ws.readyState === WebSocket.OPEN) {
            toWs.ws.send(JSON.stringify({type:'message',data:message}));
          } else if (pollUsers.has(to)) {
            pushEvent(to, {type:'message',data:message});
          } else {
            if (!msgQueue.has(to)) msgQueue.set(to, []);
            msgQueue.get(to).push(message);
          }
          break;
        }
        case 'profile-update': {
          if (!username) return;
          const user = wsUsers.get(username);
          if (user) {
            if (d.nick) user.nick = d.nick;
            if (d.avatar) user.avatar = d.avatar;
          }
          broadcastEvent({type:'user-profile',data:{username,nick:d.nick,avatar:d.avatar}}, username);
          break;
        }
      }
    } catch (err) {
      console.error('WS message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (username && wsUsers.get(username)?.ws === ws) {
      wsUsers.delete(username);
      broadcastEvent({ type: 'user-offline', data: username });
      console.log(`✗ [WS] ${username} disconnected`);
    }
  });

  ws.on('error', err => console.error('WS error:', err.message));
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Clean up stale poll users (no poll in 30s = offline)
setInterval(() => {
  const now = Date.now();
  for (const [u, d] of pollUsers) {
    if (now - d.lastSeen > 30000) {
      pollUsers.delete(u);
      pollQueues.delete(u);
      broadcastEvent({ type: 'user-offline', data: u });
      console.log(`✗ [HTTP] ${u} timed out`);
    }
  }
}, 10000);

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Cipher Relay Server on port ${PORT}`);
  console.log(`HTTP: http://0.0.0.0:${PORT}`);
  console.log(`WS:   ws://0.0.0.0:${PORT}`);
});

setInterval(() => {
  console.log(`[stats] ws:${wsUsers.size} http:${pollUsers.size} queued:${msgQueue.size}`);
}, 30000);
