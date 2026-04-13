/**
 * database.js — Cipher Messenger encrypted database with E2EE support
 * Uses SQLite + SQLCipher (AES-256-CBC) for all server-side data.
 */

const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'cipher.db');
const DB_KEY  = process.env.DB_ENCRYPTION_KEY;

if (!DB_KEY || DB_KEY.length < 32) {
  console.error('❌ DB_ENCRYPTION_KEY must be at least 32 characters.');
  console.error('   Set it in .env file or via: fly secrets set DB_ENCRYPTION_KEY="..."');
  process.exit(1);
}

let db;

// ==================== OPEN & INIT ====================
function openDatabase() {
  const Database = require('better-sqlite3-sqlcipher');
  const fs = require('fs');

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);

  // Apply AES-256 encryption key
  const escapedKey = String(DB_KEY).replace(/'/g, "''");
  db.pragma(`key = '${escapedKey}'`);

  // Verify DB opened correctly
  try {
    db.pragma('integrity_check');
  } catch (e) {
    console.error('❌ Database integrity check failed. Wrong DB_ENCRYPTION_KEY?');
    process.exit(1);
  }

  // Performance + reliability settings
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -32000');
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');

  createTables();

  console.log(`✅ Encrypted SQLite (SQLCipher AES-256) opened at ${DB_PATH}`);
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uuid        TEXT PRIMARY KEY,
      nickname    TEXT NOT NULL,
      avatar      TEXT NOT NULL DEFAULT '',
      password    TEXT NOT NULL,
      pub_ecdh    TEXT DEFAULT '',
      pub_ecdsa   TEXT DEFAULT '',
      last_seen   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS keys (
      key         TEXT PRIMARY KEY,
      encrypted   TEXT NOT NULL,
      ts          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS roomKeys (
      roomId      TEXT PRIMARY KEY,
      encKey      TEXT NOT NULL,
      ts          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS message_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_uuid   TEXT NOT NULL,
      to_uuid     TEXT NOT NULL,
      payload     TEXT NOT NULL,
      iv          TEXT NOT NULL,
      signature   TEXT NOT NULL,
      raw_json    TEXT,
      msg_type    TEXT DEFAULT 'msg',
      ts          INTEGER NOT NULL,
      time_bucket INTEGER NOT NULL,  -- PRIVACY: Coarse-grained time (1-hour buckets)
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (to_uuid) REFERENCES users(uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_queue_to ON message_queue(to_uuid);
    CREATE INDEX IF NOT EXISTS idx_queue_ts ON message_queue(ts);
    CREATE INDEX IF NOT EXISTS idx_users_seen ON users(last_seen);
  `);
  try { db.exec('ALTER TABLE message_queue ADD COLUMN raw_json TEXT'); } catch (_) {}
  // PRIVACY: Add time_bucket column for timestamp hiding
  try { db.exec('ALTER TABLE message_queue ADD COLUMN time_bucket INTEGER'); } catch (_) {}
}

// ==================== USER OPERATIONS ====================
function saveUser(userData) {
  db.prepare(`
    INSERT INTO users (uuid, nickname, avatar, password, pub_ecdh, pub_ecdsa, last_seen)
    VALUES (@uuid, @nickname, @avatar, @password, @pub_ecdh, @pub_ecdsa, @last_seen)
    ON CONFLICT(uuid) DO UPDATE SET
      nickname  = excluded.nickname,
      avatar    = excluded.avatar,
      pub_ecdh  = excluded.pub_ecdh,
      pub_ecdsa = excluded.pub_ecdsa,
      last_seen = excluded.last_seen
  `).run({
    uuid:      userData.uuid,
    nickname:  userData.nickname,
    avatar:    userData.avatar || '',
    password:  userData.password,
    pub_ecdh:  userData.pub_ecdh || '',
    pub_ecdsa: userData.pub_ecdsa || '',
    last_seen: userData.lastSeen || Date.now()
  });
}

function getUser(uuid) {
  return db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
}

function updatePublicKeys(uuid, ecdh, ecdsa) {
  db.prepare('UPDATE users SET pub_ecdh = ?, pub_ecdsa = ? WHERE uuid = ?')
    .run(ecdh, ecdsa, uuid);
}

function updateLastSeen(uuid) {
  db.prepare('UPDATE users SET last_seen = ? WHERE uuid = ?').run(Date.now(), uuid);
}

// ==================== KEYS OPERATIONS (E2EE) ====================
function saveKeys(uuid, encryptedKeys) {
  db.prepare(`
    INSERT INTO keys (key, encrypted) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET encrypted = excluded.encrypted
  `).run(uuid, encryptedKeys);
}

function loadKeys(uuid) {
  return db.prepare('SELECT encrypted FROM keys WHERE key = ?').get(uuid);
}

function saveRoomKey(roomId, encryptedKey) {
  db.prepare(`
    INSERT INTO roomKeys (roomId, encKey) VALUES (?, ?)
    ON CONFLICT(roomId) DO UPDATE SET encKey = excluded.encKey
  `).run(roomId, encryptedKey);
}

function loadRoomKey(roomId) {
  return db.prepare('SELECT encKey FROM roomKeys WHERE roomId = ?').get(roomId);
}

// ==================== MESSAGE QUEUE (E2EE FORMAT) ====================
function enqueueMessage(message) {
  db.prepare(`
    INSERT INTO message_queue (from_uuid, to_uuid, payload, iv, signature, raw_json, msg_type, ts, time_bucket)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(message.from || ''),
    String(message.to || ''),
    String(message.payload || ''),
    String(message.iv || ''),
    String(message.signature || ''),
    JSON.stringify(message || {}),
    message.type || 'msg',
    message.ts || Date.now(),
    message.time_bucket || Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000)
  );
}

function dequeueMessages(toUuid) {
  const msgs = db.prepare(`
    SELECT * FROM message_queue WHERE to_uuid = ? ORDER BY ts ASC
  `).all(toUuid);

  if (msgs.length > 0) {
    db.prepare('DELETE FROM message_queue WHERE to_uuid = ?').run(toUuid);
  }

  return msgs.map(row => {
    if (row.raw_json) {
      try {
        return JSON.parse(row.raw_json);
      } catch (_) {}
    }
    return {
      from: row.from_uuid,
      to: row.to_uuid,
      payload: row.payload,
      iv: row.iv,
      signature: row.signature,
      type: row.msg_type,
      ts: row.ts
    };
  });
}

function clearUserQueue(uuid) {
  db.prepare('DELETE FROM message_queue WHERE to_uuid = ? OR from_uuid = ?').run(uuid, uuid);
}

// ==================== CLOSE ====================
function closeDatabase() {
  if (db) {
    db.close();
    console.log('✅ Database closed');
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  saveUser,
  getUser,
  updatePublicKeys,
  updateLastSeen,
  saveKeys,
  loadKeys,
  saveRoomKey,
  loadRoomKey,
  enqueueMessage,
  dequeueMessages,
  clearUserQueue
};
