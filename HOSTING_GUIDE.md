# 🚀 Гайд по деплою Cipher на Render

> Render — **полностью бесплатно**, не требует карты, простая настройка через GitHubоблог.
> Бесплатный тариф: 0.5 shared CPU, 512MB RAM, достаточно для WebSocket-сервера.
> ⚠️ Минус: сервер засыпает через 15 минут неактивности (переподключится при обращении).

---

## Почему Render

| Платформа | Бесплатно | Карта | Засыпает | Развёртывание |
|-----------|-----------|-------|----------|----------------|
| **Fly.io** | ✅ Да | ❌ Не нужна | ❌ Нет | ✅ Есть (Volumes) |
| Render | ✅ Да | ❌ Не нужна | ⚠️ Да (15 мин) | ❌ Нет |
| Railway | ⚠️ $5 кредит | ✅ Нужна | ❌ Нет | ✅ Есть |
| Replit | ✅ Да | ❌ Не нужна | ⚠️ Да (15 мин) | ⚠️ Сбрасывается |
| Heroku | ❌ Платно | ✅ Нужна | — | — |

**Render выбран:** бесплатно + без карты + очень простое развёртывание из GitHub (один клик).

---

## Часть 1 — Подготовка проекта

### Шаг 1.1 — Обновить `package.json`

```json
{
  "name": "cipher-relay",
  "version": "2.0.0",
  "description": "Cipher P2P Messenger - WebSocket Relay Server",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "ws": "^8.13.0",
    "better-sqlite3-sqlcipher": "^9.4.3",
    "bcrypt": "^5.1.1",
    "dotenv": "^16.3.1"
  }
}
```

### Шаг 1.2 — Создать `.env` для локальной разработки

Создать файл `.env` в корне проекта (не коммитить в git!):

```env
DB_ENCRYPTION_KEY=replace-this-with-your-own-random-64-char-string-keep-it-secret
DB_PATH=./data/cipher.db
PORT=5000
```

**Важно:** Ключ шифрования БД должен быть длинным случайным. Сгенерировать можно так:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Шаг 1.3 — Добавить `.gitignore`

```gitignore
node_modules/
.env
data/
*.db
*.db-shm
*.db-wal
```

### Шаг 1.4 — Создать `database.js`

Скопировать полный код из `CIPHER_BUG_REPORT.md` (Баг #3, секция "Новый файл database.js") в файл `database.js` в корне проекта.

### Шаг 1.5 — Обновить `server.js`

Применить все изменения из `CIPHER_BUG_REPORT.md` (Баг #3, секция "Обновить server.js").

### Шаг 1.6 — Создать `Dockerfile`

Render поддерживает Docker. Создать `Dockerfile`:

```dockerfile
FROM node:20-alpine

# Устанавливаем зависимости для компиляции better-sqlite3-sqlcipher
RUN apk add --no-cache python3 make g++ sqlite-dev openssl-dev

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm ci --production

# Копируем исходный код
COPY server.js .
COPY database.js .

# Создаём папку для данных (SQLite база будет временно сохраняться в памяти контейнера)
RUN mkdir -p /data

EXPOSE 5000

CMD ["node", "server.js"]
```

> **Важно:** На бесплатном уровне Render не имеет постоянного хранилища. Данные SQLite будут теряться при перезагрузке сервера. Если нужна постоянной хранение — используйте платный план (есть пробный период) или переключитесь на Fly.io.

### Шаг 1.7 — Создать файл для Render (`render.yaml`)

В корне проекта создать файл `render.yaml`:

```yaml
services:
  - type: web
    name: cipher-relay
    env: docker
    dockerfilePath: ./Dockerfile
    port: 5000
    envVars:
      - key: PORT
        value: "5000"
      - key: DB_PATH
        value: "/tmp/cipher.db"
      - key: DB_ENCRYPTION_KEY
        generateValue: true
```

---

## Часть 2 — Регистрация на Render

### Шаг 2.1 — Зарегистрироваться

1. Открыть [render.com](https://render.com)
2. Нажать "Get Started" или "Sign Up"
3. Зарегистрироваться через GitHub (проще всего) или email
4. **Карту не просят** — используйте свободный тариф

> Render автоматически синхронизируется с вашим GitHub репозиторием!

---

## Часть 3 — Подготовка GitHub репозитория

### Шаг 3.1 — Загрузить проект на GitHub

Если ещё не на GitHub:

```bash
git init
git add .
git commit -m "Initial commit: Cipher server"
git branch -M main
git remote add origin https://github.com/ВАШ_ЮЗЕР/cipher-relay.git
git push -u origin main
```

### Шаг 3.2 — Проверить что всё на месте

В корне репозитория должны быть:
- `Dockerfile` ✓
- `server.js` ✓
- `database.js` ✓
- `package.json` ✓
- `.gitignore` (чтобы не закоммитить `.env` и `data/`)
- `render.yaml` (опционально, но удобно)

---

## Часть 4 — Развёртывание на Render

### Шаг 4.1 — Создать новый сервис

1. Зайти в [dashboard.render.com](https://dashboard.render.com)
2. Нажать **"New +" → "Web Service"**
3. Выбрать **"Deploy an existing repository"** → выбрать свой репозиторий `cipher-relay`
4. Если репозитория нет в списке — нажать "Configure account" и разрешить Render доступ к GitHub

### Шаг 4.2 — Настроить сервис

Заполнить форму:

| Поле | Значение |
|------|----------|
| **Name** | `cipher-relay` |
| **Environment** | `Docker` |
| **Region** | Ohio, Singapore или Frankfurt (выбрать ближайший) |
| **Branch** | `main` |
| **Dockerfile path** | `./Dockerfile` (путь по умолчанию) |

### Шаг 4.3 — Добавить переменные окружения

В секции **"Environment"** нажать **"Add Environment Variable"** и добавить:

1. **Name:** `DB_ENCRYPTION_KEY`  
   **Value:** (сгенерировать самостоятельно)
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Пример: `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0`

2. **Name:** `DB_PATH`  
   **Value:** `/tmp/cipher.db`

3. **Name:** `PORT`  
   **Value:** `5000`

> **Важно:** Сохранить `DB_ENCRYPTION_KEY` в надёжном месте! Если потеряете — не восстановить данные из БД.

### Шаг 4.4 — Задать план оплаты

- Выбрать **"Free"** (тариф)
- Render может попросить добавить способ оплаты (для верификации), но деньги не будут списаны с бесплатного плана

### Шаг 4.5 — Запустить развёртывание

Нажать **"Create Web Service"** или **"Deploy"**.

Render начнёт:
1. Собирать Docker-образ (~1-2 минуты)
2. Запускать контейнер
3. Проверять здоровье сервиса

Когда статус сервиса станет **"Live"** (зелёный) — сервер готов!

### Шаг 4.6 — Получить URL сервера

После развёртывания Render выдаст URL вроде:
```
https://cipher-relay-xxxx.onrender.com
```

Скопировать этот URL — понадобится для настройки index.html.

---

## Часть 5 — Подключить GitHub Pages к Render

### Шаг 5.1 — Обновить `index.html`

Открыть `index.html`, найти строку ~428 и изменить:

```javascript
// Было:
const _onExternalHost = !['localhost','127.0.0.1'].includes(window.location.hostname)
  && !window.location.hostname.includes('replit');
let serverAddress = _onExternalHost ? '' : ...;

// Стало — вписать реальный URL Render:
const DEFAULT_SERVER = 'wss://cipher-relay-xxxx.onrender.com'; // ← ваш реальный URL от Render

const _onExternalHost = !['localhost','127.0.0.1'].includes(window.location.hostname);
let serverAddress = _onExternalHost
  ? DEFAULT_SERVER
  : (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host;
```

### Шаг 5.2 — Также исправить БАГ #1 (самый важный)

```javascript
// Найти функцию sendToServer (~строка 589) и изменить:
function sendToServer(type, data) {
  const msg = {type, data, uuid: myProfile.uuid, timestamp: Date.now()}; // username → uuid!
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
```

### Шаг 5.3 — Запушить `index.html` на GitHub

```bash
git add index.html
git commit -m "fix: connect to Render server, fix uuid field"
git push
```

GitHub Pages автоматически обновится через 1–2 минуты.

### Шаг 5.4 — Проверить работу

1. Открыть `https://ваш-ник.github.io/название-репо/`
2. Зарегистрироваться (поле "Сервер" должно быть уже заполнено вашим `wss://cipher-relay-xxxx.onrender.com`)
3. В другом браузере / режиме инкогнито зарегистрироваться вторым аккаунтом
4. Добавить первый аккаунт по UUID и отправить сообщение

---

## Часть 6 — Мониторинг и управление

### Просмотр логов в реальном времени

В панели Render:
1. Зайти в [dashboard.render.com](https://dashboard.render.com)
2. Выбрать сервис `cipher-relay`
3. Открыть вкладку **"Logs"** — видны все логи в реальном времени

### Перезапуск сервера

В панели Render:
1. Выбрать сервис → **"Manual Deploy"** → **"Redeploy"**

Или через API/CLI если установлена.

### Обновление кода (после изменений в GitHub)

Render автоматически пересобирает и переразворачивает при каждом `git push`:
1. Отправить коммит на GitHub: `git push origin main`
2. Render автоматически заметит изменения и начнёт новый деплой (~2-3 секунды)
3. Логи обновятся в реальном времени

### Проверить состояние сервиса

В панели Render:
1. Выбрать сервис
2. Видно: статус (**Live** = работает, **Building** = собирается, **Deploying** = развёртывается)
3. Видно: IP, URL, дата последнего деплоя

### Резервная копия SQLite

> **Внимание:** На бесплатном плане Render не имеет постоянного хранилища! База теряется при перезагрузке.

Для сохранения данных:
1. **Вариант 1:** Использовать платный план Render с постоянным диском
2. **Вариант 2:** Перейти на Fly.io (там бесплатный Volume)
3. **Вариант 3:** Использовать PostgreSQL (`render.com` предоставляет PostgreSQL в бесплатном уровне)

Если всё же хочется прямо сейчас сделать резервную копию:
```bash
# Подключиться к контейнеру через SSH (если доступно):
# Обычно на бесплатном плане SSH не предоставляется
```

---

## Часть 7 — Решение частых проблем

### Проблема: Сервис падает при деплое — ошибка сборки

**Причина:** Обычно проблема с зависимостями (`better-sqlite3-sqlcipher`).

**Решение:** Проверить `Dockerfile`:
```dockerfile
# Убедиться что установлены все зависимости:
RUN apk add --no-cache python3 make g++ sqlite-dev openssl-dev
```

Если всё равно не работает — посмотреть полный лог в Render:
1. Выбрать сервис → **"Logs"**
2. Найти строку с ошибкой
3. Обновить `Dockerfile` и запушить → Render автоматически пересибрирает

### Проблема: "DB_ENCRYPTION_KEY must be at least 32 characters"

**Причина:** Переменная окружения не задана или имеет неправильное значение.

**Решение:**
1. Зайти в Render → выбрать сервис → **"Environment"**
2. Найти `DB_ENCRYPTION_KEY` — проверить что он существует и имеет ≥32 символов
3. Если не задан — добавить заново:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. Скопировать вывод в `DB_ENCRYPTION_KEY`
5. Нажать **"Save"** → Render автоматически перезапустит сервис

### Проблема: Сервер живой, но WebSocket не подключается

Проверить в браузере: открыть DevTools → **Console** → посмотреть ошибки.

Частые причины:

1. **DEFAULT_SERVER в index.html указывает не на тот URL**
   ```javascript
   // Проверить что это ваш реальный URL от Render:
   const DEFAULT_SERVER = 'wss://cipher-relay-xxxx.onrender.com';
   // где xxxx — уникальный ID вашего приложения
   ```
   Решение: обновить `index.html` и запушить → GitHub Pages обновится автоматически

2. **Используется ws:// вместо wss://**
   GitHub Pages требуетWSS (WebSocket Secure).
   
   Решение: в index.html должно быть:
   ```javascript
   const DEFAULT_SERVER = 'wss://cipher-relay-xxxx.onrender.com'; // ← WSS!
   ```

3. **Render сервис спит** (засыпает через 15 минут)
   
   Решение: когда клиент подключается, Render автоматически просыпается  (~2-5 секунд на холодный старт). Просто попробуйте переподключиться.

### Проблема: Данные из БД теряются при перезагрузке

**Это нормально для бесплатного Render!** На бесплатном уровне нет постоянного хранилища.

**Варианты:**

1. **Временное решение:** Данные хранятся в памяти контейнера между перезагрузками, но при каждом новом деплое теряются.

2. **Перейти на платный план Render:** Они предоставляют постоянный диск в платных планах (есть пробный период с $7 кредитом).

3. **Использовать PostgreSQL вместо SQLite:** Render даёт бесплатную PostgreSQL базу, но нужно переписать code database.js.

4. **Вернуться на Fly.io:** Fly предоставляет бесплатный persistent Volume без карты.

### Проблема: "Service is starting" бесконечно

**Причина:** Контейнер не может стартовать (обычно ошибка в коде).

**Решение:**
1. Открыть **"Logs"** в Render
2. Найти сообщение об ошибке (красные строки)
3. Исправить код в `server.js` или `database.js`
4. Запушить:`git push origin main` → Render перересоберет

Типичные ошибки:
- `Cannot find module 'ws'` — забыли установить зависимости в `package.json`
- `DB_ENCRYPTION_KEY is undefined` — не задана переменная окружения
- `Port already in use` — порт 5000 занят (не должно быть на Render)

### Проблема: Хочу больше памяти/ CPU

**Бесплатный план:** 512MB RAM, 0.5 CPU — этого достаточно для мессенджера на 100+ пользователей.

**Если нужно больше:**
- Перейти на платный план Render (~$7/месяц)
- Или использовать Fly.io (там есть бесплатный уровень мощнее)

---

## Часть 8 — Кастомный домен (опционально)

Если хочется `wss://chat.yourdomain.com` вместо `wss://cipher-relay-xxxx.onrender.com`:

1. Зайти в Render → выбрать сервис → **"Custom Domains"**  
2. Нажать **"Add Custom Domain"**
3. Ввести `chat.yourdomain.com`
4. Render покажет CNAME запись для добавления в DNS

Добавить CNAME в настройки вашего домена:
```
Name: chat
Type: CNAME
Value: cipher-relay-xxxx.onrender.com (то что показал Render)
TTL: 3600 (или по умолчанию)
```

После добавления DNS-записи (~5-15 минут) — обновить `DEFAULT_SERVER` в `index.html`:
```javascript
const DEFAULT_SERVER = 'wss://chat.yourdomain.com';
```

Запушить → GitHub Pages обновится.

---

## Итого — чеклист деплоя на Render

```
[ ] 1. Проект на GitHub (public или private, оба работают)
[ ] 2. database.js создан с SQLCipher
[ ] 3. server.js обновлён (использует database.js)
[ ] 4. Dockerfile создан с зависимостями
[ ] 5. package.json обновлён (ws, better-sqlite3-sqlcipher, dotenv)
[ ] 6. .gitignore содержит .env и data/
[ ] 7. render.yaml создан (опционально)
[ ] 8. Зарегистрирован на render.com через GitHub
[ ] 9. Создан Web Service, выбран репозиторий
[ ] 10. Переменные окружения добавлены в Render:
    - DB_ENCRYPTION_KEY (32+ символа)
    - DB_PATH = /tmp/cipher.db
    - PORT = 5000
[ ] 11. Выбран бесплатный тариф ("Free")
[ ] 12. Запущен деплой → сервис в статусе "Live" (зелёный)
[ ] 13. Скопирован URL сервиса (вроде cipher-relay-xxxx.onrender.com)
[ ] 14. index.html обновлён: DEFAULT_SERVER = 'wss://cipher-relay-xxxx.onrender.com'
[ ] 15. index.html обновлён: username → uuid в sendToServer
[ ] 16. index.html запушен → GitHub Pages обновилась
[ ] 17. Тест в браузере:
    - Открыть https://ваш-ник.github.io/repo
    - Зарегистрироваться
    - В другом браузере второй аккаунт
    - Отправить сообщение ✓
[ ] 18. Проверить логи в Render — нет ошибок ✓
```

---

## Важные замечания о Render vs Fly.io

| Аспект | Render | Fly.io |
|--------|--------|--------|
| **Карта** | ❌ Не нужна | ❌ Не нужна |
| **Стоимость** | Бесплатно (но спит) | Бесплатно (но для постоянного диска нужна карта) |
| **Сон** | ⚠️ 15 мин (засыпает) | ❌ Нет (24/7 работает) |
| **Постоянный диск** | ❌ Нет (бесплатно) | ✅ Да (Volume) |
| **Развёртывание** | ✅ Из GitHub (кликом) | ⚠️ Нужен flyctl CLI |
| **Ограничения** | 512MB RAM, 0.5 CPU | 3 shared VM, 256MB RAM |
| **Переподключение** | Автоматическое при обращении | Всегда онлайн |

**Вывод:** Render проще для быстрого деплоя, Fly лучше для production.
