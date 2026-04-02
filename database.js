/**
 * database.js — Cipher Messenger encrypted database
 * Uses SQLite + SQLCipher (AES-256-CBC) for all server-side data.
 *
 * To use: replace the in-memory + JSON store in server.js with these functions.
 * Requires: npm install better-sqlite3-sqlcipher bcrypt dotenv
 * See SETUP_GUIDE.md for Fly.io deployment instructions.
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
  db.pragma(`key = '${DB_KEY}'`);

  // Verify DB opened correctly (wrong key = integrity check fails)
  try {
    db.pragma('integrity_check');
  } catch (e) {
    console.error('❌ Database integrity check failed. Wrong DB_ENCRYPTION_KEY?');
    process.exit(1);
  }

  // Performance + reliability settings
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -32000'); // 32MB cache
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
      last_seen   INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS message_queue (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_uuid   TEXT NOT NULL,
      to_uuid     TEXT NOT NULL,
      content     TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (to_uuid) REFERENCES users(uuid) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_queue_to ON message_queue(to_uuid);
    CREATE INDEX IF NOT EXISTS idx_queue_ts  ON message_queue(ts);
    CREATE INDEX IF NOT EXISTS idx_users_seen ON users(last_seen);
  `);
}

// ==================== USER OPERATIONS ====================
function saveUser(userData) {
  db.prepare(`
    INSERT INTO users (uuid, nickname, avatar, password, last_seen)
    VALUES (@uuid, @nickname, @avatar, @password, @last_seen)
    ON CONFLICT(uuid) DO UPDATE SET
      nickname  = excluded.nickname,
      avatar    = excluded.avatar,
      last_seen = excluded.last_seen
  `).run({
    uuid:      userData.uuid,
    nickname:  userData.nickname,
    avatar:    userData.avatar || '',
    password:  userData.password,
    last_seen: userData.lastSeen || Date.now()
  });
}

function saveUserPassword(uuid, password) {
  db.prepare('UPDATE users SET password = ? WHERE uuid = ?').run(password, uuid);
}

function getUser(uuid) {
  return db.prepare('SELECT * FROM users WHERE uuid = ?').get(uuid);
}

function updateUserProfile(uuid, nickname, avatar) {
  db.prepare(`
    UPDATE users SET nickname = ?, avatar = ?, last_seen = ? WHERE uuid = ?
  `).run(nickname, avatar ?? '', Date.now(), uuid);
}

function updateLastSeen(uuid) {
  db.prepare('UPDATE users SET last_seen = ? WHERE uuid = ?').run(Date.now(), uuid);
}

// ==================== MESSAGE QUEUE ====================
function enqueueMessage(message) {
  db.prepare(`
    INSERT INTO message_queue (from_uuid, to_uuid, content, ts)
    VALUES (?, ?, ?, ?)
  `).run(message.from, message.to, JSON.stringify(message), message.ts || Date.now());
}

function dequeueMessages(toUuid) {
  const msgs = db.prepare(`
    SELECT * FROM message_queue WHERE to_uuid = ? ORDER BY ts ASC
  `).all(toUuid);

  if (msgs.length > 0) {
    db.prepare('DELETE FROM message_queue WHERE to_uuid = ?').run(toUuid);
  }

  return msgs.map(row => {
    try { return JSON.parse(row.content); }
    catch { return null; }
  }).filter(Boolean);
}

function getPendingCount(toUuid) {
  return db.prepare('SELECT COUNT(*) as c FROM message_queue WHERE to_uuid = ?')
    .get(toUuid)?.c || 0;
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
  saveUserPassword,
  getUser,
  updateUserProfile,
  updateLastSeen,
  enqueueMessage,
  dequeueMessages,
  getPendingCount
};
