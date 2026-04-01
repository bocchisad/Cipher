const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const HOST = '0.0.0.0';

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cipher frontend running at http://${HOST}:${PORT}`);
});
