# 🧪 UUID-Based Auth - Testing Guide

## What Changed

**Old System:** username-based registration/login
**New System:** UUID-based registration/login

| Aspect | Old | New |
|--------|-----|-----|
| User ID | username | UUID (server-generated) |
| Storage | localStorage: {username, password} | localStorage: {uuid, password} |
| Nickname | Used as username (unique required) | Visual-only field |
| Registration | Create username account | Get UUID from server |
| Login | Send username | Send UUID + password |

## Testing Steps

### 1. Server (Replit)

```bash
# Run the server
npm start

# You should see:
╔═══════════════════════════════════════════════════════╗
║  Cipher Server v3.0 - UUID-based Authentication      ║
║═══════════════════════════════════════════════════════║
║ 🚀 Running on: 0.0.0.0:3000
│ 🔐 Auth: Register/Login with UUID + Password         │
...
```

### 2. Client Testing in Browser

#### First User - Register

1. Open your GitHub Pages URL (or localhost)
2. Open DevTools (F12 → Console)
3. **Register Form:**
   - Nickname: `alice` (any name, doesn't have to be unique!)
   - Password: `password123`
   - Click "Зарегистрироваться"

4. **Expected Logs:**
```
📝 Отправляю register: alice
✅ Регистрация успешна, UUID: a1b2c3d4...
🚀 Cipher запущен для: a1b2c3d4...
```

5. **Check localStorage:**
   ```javascript
   // In DevTools console:
   JSON.parse(localStorage.cipherAuth)
   // Should show: {uuid: "a1b2c3d4...", password: "password123"}
   ```

#### Server Console Should Show:
```
📡 New connection from 127.0.0.1
📝 Register new user: alice → a1b2c3d4...
✅ Registration successful: alice (a1b2c3d4...)
👥 Users: 1, 📋 Queued: 0
```

### 3. Test Login

1. **Clear localStorage and refresh:**
   ```javascript
   localStorage.removeItem('cipherAuth')
   location.reload()
   ```

2. **Should see registration form again** - Register second time:
   - Nickname: `alice2` (or any other name)
   - Password: `password123`
   - Get NEW UUID

3. **Refresh page again** - Should auto-login with stored UUID

4. **Expected behavior:**
   - Loads previous profile (uuid + nickname)
   - Shows stored contacts
   - Can access messages

### 4. Test Messaging

1. **Create second user in Private Window:**
   - Incognito/Private window with same URL
   - Register new account: `bob`
   - Get new UUID

2. **User Alice adds Bob:**
   - Click "+" button in sidebar
   - Paste Bob's UUID
   - Give him nickname: `Bob`

3. **Send Message from Alice to Bob:**
   - Click on Bob in chat list
   - Type message
   - Send

4. **Check Server Logs:**
```
💬 Message: a1b2c3d4... → b5e6f7g8...
  ✓ Delivered immediately
```

5. **Check Message Data:**
```javascript
// In DevTools console:
await db.transaction('messages', 'readonly').objectStore('messages').getAll()
// Should show: {from: uuid, to: uuid, content, ts, type}
```

### 5. Expected Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| localhost registration fails | No server | Start npm start |
| "User not found" on login | Wrong UUID | Check localStorage |
| Messages don't appear | Missing contact | Add manually with UUID |
| Server shows 0 users | Connection issue | Check DevTools Console |

## Key Files to Check

- **Server:** `server.js` lines 80-230 (handlers)
- **Client:** `index.html` lines 878-940 (register), 784-835 (login), 580-605 (handlers)
- **Database:** IndexedDB "Cipher" → "contacts" store (should have `uuid` keyPath)

## Debug Commands

```javascript
// Check current user
console.log('UUID:', myProfile.uuid)
console.log('Nickname:', myProfile.nickname)

// Check contacts
console.log('Contacts:', contacts)

// Check auth storage
console.log('Stored Auth:', JSON.parse(localStorage.cipherAuth))

// Check messages for specific contact
db.transaction('messages', 'readonly')
  .objectStore('messages')
  .index('chatId').getAll('OTHER_UUID_HERE')
```

## Success Criteria

✅ Register creates account with UUID
✅ Login works with UUID + password
✅ Refresh maintains session
✅ Multiple users can exist
✅ Messages send between UUIDs
✅ Server stores all users
✅ No username conflicts

---

**Latest Commit:** `b7e209a` - Complete UUID-based auth refactor
