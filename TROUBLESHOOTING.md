# 🐛 Отладка Auth проблемы

## Проблема была
```
📡 New connection from 127.0.0.1  (много раз)
✓ emo connected (1 total)  (только один раз)
✗ emo disconnected  (сразу завершено)
```

Соединение устанавливалось, но тут же обрывалось!

## Что мы исправили

### 1. **Race condition - Client отправлял auth слишком рано**
Было:
```javascript
await connectWebSocket();
sendToServer('auth', ...); // Отправляем СРАЗУ!
```

Стало:
```javascript
await connectWebSocket();
// Ждем server-ready от сервера
await new Promise((resolve) => {
  // Слушаем message event
  // Если приходит server-ready → resolve
  // Timeout 1s → resolve в любом случае
});
sendToServer('auth', ...); // Отправляем только ПОСЛЕ
```

### 2. **Сервер не логировал обработку auth**
Было:
```javascript
switch(type) {
  case 'auth':
    handleAuth(ws, data, setUsername); // Молчит
```

Стало:
```javascript
console.log(`📬 Сообщение type="${type}" от ${username}`);
switch(type) {
  case 'auth':
    console.log(`🔐 Auth попытка: ${username}`);
    handleAuth(...);
    console.log(`✅ ${username} auth успешен`);
```

### 3. **Клиент передавал неполные данные**
Было:
```javascript
sendToServer('auth', {username, password, ...});
```

Стало:
```javascript
sendToServer('auth', {
  username,
  password,
  nick: username,
  avatar: regAvatar
});
```

## Как отладить на Replit

### В браузере (F12 → Console):
Должны видеть:
```
🔌 Подключаюсь к wss://...
✓ WebSocket подключен
📨 Сообщение от сервера: server-ready
✓ Сервер готов
⏳ Ожидаю server-ready от сервера...
✓ server-ready получен
📤 Отправляю auth: username123
```

### На сервере Replit (Console):
Должны видеть:
```
📡 New connection from 127.0.0.1
🔐 Auth попытка: username123
✅ username123 auth успешен (1 total users online)
```

## Если ПОСЛЕ исправлений ТСЕ ЕЩЕ не работает

### Чек-лист:
1. ✓ Обновили код на Replit?
2. ✓ Запустили `npm install`?
3. ✓ Нажали "Run"?
4. ✓ Очистили браузер localStorage? (Ctrl+Shift+Delete)
5. ✓ Перезагрузили страницу? (Ctrl+F5)

### Команды для отладки:

```bash
# В консоли Replit:

# Проверить что сервер слушает на 5000
netstat -tulpn | grep 5000

# Проверить logs сервера в реальном времени
npm start

# Проверить что WebSocket работает
npm install wscat
wscat -c ws://localhost:5000
```

### В браузере (более подробный лог):
Откройте DevTools, в консоли:
```javascript
// Посмотреть что в localStorage
console.log(JSON.parse(localStorage.cipherAuth));

// Проверить IndexedDB
// Application → Storage → IndexedDB → Cipher
```

## Самая вероятная причина
Клиент отправляет auth ОДНОВРЕМЕННО с подключением, а сервер не успевает обработать.

Решение: **Ждем server-ready перед auth** ✓ Уже исправлено!
