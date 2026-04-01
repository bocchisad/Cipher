# Cipher P2P Messenger

A secure, decentralized peer-to-peer messaging application with end-to-end encryption.

## Architecture

- **Frontend**: Static `index.html` served via `serve.js` on port 5000
  - Built with HTML5, Tailwind CSS, and vanilla JavaScript
  - Uses WebRTC for peer-to-peer communication
  - Uses Web Crypto API for AES-GCM 256-bit E2EE
  - Stores data in IndexedDB / LocalStorage
- **Relay Server**: Node.js WebSocket server (`server.js`) on port 9000
  - Routes messages between peers
  - Queues messages for offline users
  - Tracks online/offline user status

## Project Structure

```
index.html      - Main frontend (single-file app)
server.js       - WebSocket relay server
serve.js        - Simple HTTP server to serve index.html on port 5000
package.json    - Node.js dependencies (ws package)
```

## Running the App

Two workflows are configured:
1. **Start application** - Serves the frontend at port 5000 (`node serve.js`)
2. **Relay Server** - Runs the WebSocket relay at port 9000 (`node server.js`)

## Dependencies

- `ws` ^8.13.0 - WebSocket library for the relay server

## Configuration Notes

- The relay server's default WebSocket URL is set in `index.html` (the `serverAddress` variable)
- Users can override the relay server address in the login UI
- The relay server uses in-memory storage (users/messages reset on restart)
- For persistent state across restarts, deployment uses the `vm` target
