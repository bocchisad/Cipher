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

const { PeerServer } = require('peerjs');
const http = require('http');
const https = require('https');
const fs = require('fs');

const PORT = process.env.PORT || 9000;
const USE_HTTPS = process.env.HTTPS === '1' || process.env.USE_WSS === '1';

// ==================== SERVER ====================
let app;

if (USE_HTTPS && fs.existsSync('cert.pem') && fs.existsSync('key.pem')) {
  // HTTPS режим (для WSS)
  app = https.createServer({
    cert: fs.readFileSync('cert.pem'),
    key: fs.readFileSync('key.pem')
  }, (req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Cipher PeerJS Server\nReady for connections');
  });
} else {
  // HTTP режим (локально)
  app = http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Cipher PeerJS Server\nReady for connections');
  });
}

// PeerJS сервер
const peerServer = PeerServer({
  port: PORT,
  http: app
});

peerServer.on('connection', (client) => {
  console.log(`✓ ${client.getId()} connected`);
});

peerServer.on('disconnect', (client) => {
  console.log(`✗ ${client.getId()} disconnected`);
});

// Stats
setInterval(() => {
  console.log(`[${new Date().toLocaleTimeString()}] Server is running on port ${PORT}`);
}, 30000);

// ==================== GRACEFUL SHUTDOWN ====================
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  app.close(() => {
    console.log('✅ Server stopped');
    process.exit(0);
  });
});

// ==================== START ====================
app.listen(PORT, () => {
  const proto = USE_HTTPS ? 'wss' : 'ws';
  const getLocalIP = () => {
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
  };

  const localIP = getLocalIP();

  console.log(`
╔═══════════════════════════════════════════════════╗
║      Cipher PeerJS Server v1.0                    ║
║═══════════════════════════════════════════════════║
║ 🚀 Running on port: ${PORT}${' '.repeat(26 - String(PORT).length)}║
║ 🌐 Local: ${proto}://localhost:${PORT}${' '.repeat(24 - String(PORT).length)}║
║ 📱 Network: ${proto}://${localIP}:${PORT}${' '.repeat(20 - String(localIP).length - String(PORT).length)}║
║                                                   ║
║ Ready for P2P connections...${' '.repeat(14)}║
╚═══════════════════════════════════════════════════╝
  `);
});
