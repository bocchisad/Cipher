# 🚀 Cipher — Гайд по запуску (что нужно сделать тебе)

> Все баги исправлены в коде. Этот файл — о том, что **автоматически не сделать**:
> задеплоить сервер и вставить твой URL в клиент.

---

## Что уже исправлено в коде (не нужно делать самому)

| # | Баг | Файл | Статус |
|---|-----|------|--------|
| 1 | `username` → `uuid` в sendToServer | `index.html` | ✅ Исправлено |
| 2 | Клиент не знает адрес сервера | `index.html` | ✅ Исправлено (DEFAULT_SERVER) |
| 3 | Disconnect удалял юзера из памяти → "User not found" | `server.js` | ✅ Исправлено |
| 4 | broadcast() падал при ws=null | `server.js` | ✅ Исправлено |
| 5 | `handleUserOnline` принимал объект как строку | `index.html` | ✅ Исправлено |
| 6 | `profile-update` отправлял `nick` вместо `nickname` | `index.html` | ✅ Исправлено |
| 7 | `addChat` создавал контакт с полем `nick` вместо `nickname` | `index.html` | ✅ Исправлено |
| 8 | Пароль хранился в localStorage открытым текстом | `index.html` | ✅ SHA-256 хэш |
| 9 | SHA-256 на сервере → заменено на PBKDF2-SHA512 100k rounds | `server.js` | ✅ Исправлено |
| 10 | Rate limiting на регистрацию | `server.js` | ✅ 5 рег/мин на IP |
| 11 | Атомарная запись users.json (защита от битых файлов) | `server.js` | ✅ Исправлено |
| 12 | Галочки доставки (✓ → ✓✓ зелёные) | `index.html` + `server.js` | ✅ Исправлено |
| 13 | Уведомления браузера | `index.html` | ✅ Добавлено |
| 14 | Медиа-вкладки (Медиа/Файлы/Ссылки) | `index.html` | ✅ Работают |
| 15 | WebRTC сигналинг (offer/answer/ice) | `server.js` | ✅ Добавлен форвардинг |
| 16 | Удалить у обоих | `server.js` + `index.html` | ✅ Добавлено |
| 17 | URL-ссылки кликабельны в сообщениях | `index.html` | ✅ Добавлено |
| 18 | Превью последнего сообщения (тип-зависимое) | `index.html` | ✅ Исправлено |

---

## Что нужно сделать тебе

### ШАГ 1 — Задеплоить сервер на Fly.io (30 минут)

#### 1.1 Зарегистрироваться на Fly.io

Открыть [fly.io](https://fly.io) → **Get Started** → войти через GitHub.
**Карта не нужна.**

#### 1.2 Установить flyctl

```bash
# macOS / Linux:
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell):
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

# Проверить:
fly version
```

#### 1.3 Авторизоваться

```bash
fly auth login
# Откроется браузер — войти в Fly.io
```

#### 1.4 Инициализировать приложение

В папке проекта (где лежит `server.js`):

```bash
fly launch
```

Отвечать так:
```
? Choose an app name: cipher-relay       ← или любое другое имя
? Select Organization: personal
? Choose a region: ams                   ← Амстердам, или fra — Франкфурт
? Set up Postgresql? No
? Set up Upstash Redis? No
? Deploy now? No                         ← ВАЖНО: сначала настроим секреты!
```

После этого создастся файл `fly.toml`.

#### 1.5 Создать постоянный Volume для данных

```bash
fly volumes create cipher_data --size 1 --region ams
# ↑ тот же регион что выбрали выше
```

#### 1.6 Добавить Volume в fly.toml

Открыть созданный `fly.toml` и добавить в конец:

```toml
[[mounts]]
  source = "cipher_data"
  destination = "/data"
```

Также убедиться что есть секция `[[services]]` с портом 5000:

```toml
[[services]]
  protocol = "tcp"
  internal_port = 5000

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [[services.ports]]
    port = 80
    handlers = ["http"]
```

#### 1.7 Сгенерировать ключ шифрования БД

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Скопируй вывод и сохрани в надёжном месте** — если потеряешь, база данных станет нечитаемой.

#### 1.8 Задать секреты

```bash
fly secrets set DB_ENCRYPTION_KEY="ВОТ_СЮДА_ВСТАВЬ_КЛЮЧ_ИЗ_ПРЕДЫДУЩЕГО_ШАГА"
fly secrets set DB_PATH="/data/cipher.db"
fly secrets set PORT="5000"
```

#### 1.9 Задеплоить

```bash
fly deploy
```

Первый деплой: 2–5 минут. В конце увидишь URL типа:
```
Visit your app at https://cipher-relay.fly.dev/
```

#### 1.10 Проверить

```bash
fly logs
# Должно быть:
# ✓ WebSocket server listening on port 5000
# ╔═══... Cipher Server v4.0 ...═══╗
```

```bash
curl https://cipher-relay.fly.dev/health
# Должно вернуть: {"status":"ok","users":0,...}
```

---

### ШАГ 2 — Прописать URL сервера в index.html (2 минуты)

Открыть `index.html`, найти строку:

```javascript
const DEFAULT_SERVER = 'wss://YOUR-APP.fly.dev';
```

Заменить на твой реальный URL (то что показал `fly deploy`):

```javascript
const DEFAULT_SERVER = 'wss://cipher-relay.fly.dev';
//                            ↑ твой реальный app name
```

> ⚠️ Обязательно `wss://` (не `ws://`) — GitHub Pages работает только по HTTPS.

---

### ШАГ 3 — Опубликовать index.html на GitHub Pages (5 минут)

Если ещё не настроено:

1. Создать репозиторий на GitHub (можно приватный с включёнными Pages)
2. Перейти в Settings → Pages → Source: "Deploy from branch" → branch: `main`, folder: `/ (root)`
3. Загрузить `index.html` в корень репозитория

Если уже есть репо:

```bash
git add index.html
git commit -m "fix: production server URL + all bugs fixed"
git push
```

GitHub Pages обновится через ~1 минуту.

---

### ШАГ 4 — Проверить что всё работает

1. Открыть `https://твой-ник.github.io/название-репо/`
2. Поле "Сервер" должно быть уже заполнено (`wss://cipher-relay.fly.dev`)
3. Зарегистрироваться (Username + Пароль)
4. Открыть в другом браузере / режиме инкогнито, зарегистрировать второй аккаунт
5. Скопировать UUID первого аккаунта (Settings → нажать на UUID)
6. Во втором браузере: нажать `+` → вставить UUID → добавить чат
7. Написать сообщение — должно прийти с галочками ✓✓

---

## Опциональный Шаг 5 — SQLite вместо JSON (для продакшна)

Текущий сервер хранит данные в `users.json` с атомарными записями — этого достаточно для небольшого использования.

Для полноценного продакшна (много пользователей, надёжность данных) нужен SQLite:

#### 5.1 Обновить Dockerfile

В `Dockerfile` уже правильные зависимости для компиляции SQLite. Убедись что там есть:
```dockerfile
RUN apk add --no-cache python3 make g++ sqlite-dev openssl-dev
```

#### 5.2 Создать .env для локальной разработки

```env
DB_ENCRYPTION_KEY=your-local-test-key-at-least-32-characters-long
DB_PATH=./data/cipher.db
PORT=5000
```

> **Не коммить `.env` в git!** Он уже добавлен в `.gitignore`.

#### 5.3 Переключить server.js на database.js

В `server.js` заменить блок `PERSISTENCE` на импорт из `database.js`. Это потребует ~30 минут работы.
Полная реализация `database.js` уже готова в файле — функции `saveUser`, `getUser`, `enqueueMessage`, `dequeueMessages` полностью заменяют текущий Map + JSON подход.

---

## Обслуживание сервера

```bash
# Логи в реальном времени:
fly logs --tail

# Перезапуск:
fly machine restart

# Обновление после изменений кода:
fly deploy

# Статус:
fly status

# Резервная копия users.json:
fly ssh sftp get /app/users.json ./users_backup_$(date +%Y%m%d).json
```

---

## Решение проблем

### "WebSocket connection failed" в браузере

1. Открыть DevTools → Network → WS — проверить точный URL подключения
2. Убедиться что `DEFAULT_SERVER` в `index.html` точно совпадает с URL из `fly status`
3. Проверить `curl https://cipher-relay.fly.dev/health` — должен ответить `{"status":"ok",...}`

### "User not found" при входе

Это значит что сервер был перезапущен до применения патча. После деплоя нового кода проблема уходит — сервер теперь сохраняет `users.json` и не удаляет пользователей при дисконнекте. Существующим пользователям нужно перерегистрироваться один раз.

### Сервер не принимает новые регистрации

Проверь rate limit — по умолчанию 5 регистраций в минуту с одного IP. Это нормально для продакшна. При тестировании подожди минуту.

### "DB_ENCRYPTION_KEY must be at least 32 characters" в логах

```bash
fly secrets list           # проверить что ключ задан
fly secrets set DB_ENCRYPTION_KEY="новый-ключ-минимум-32-символа"
fly deploy
```

---

## Итоговый чеклист

```
[ ] 1. Создан аккаунт на fly.io
[ ] 2. Установлен flyctl: fly version работает
[ ] 3. fly auth login выполнен
[ ] 4. fly launch выполнен (без немедленного деплоя)
[ ] 5. fly volumes create cipher_data --size 1 выполнен
[ ] 6. [[mounts]] добавлен в fly.toml
[ ] 7. Ключ шифрования сгенерирован и сохранён
[ ] 8. fly secrets set DB_ENCRYPTION_KEY="..." выполнен
[ ] 9. fly secrets set DB_PATH="/data/cipher.db" PORT="5000" выполнены
[10] 10. fly deploy выполнен успешно
[ ] 11. fly logs показывает "Cipher Server v4.0" и "listening on port 5000"
[ ] 12. curl https://ваш-app.fly.dev/health возвращает JSON
[ ] 13. DEFAULT_SERVER в index.html обновлён на wss://ваш-app.fly.dev
[ ] 14. index.html запушен на GitHub Pages
[ ] 15. Тест: два браузера, регистрация, обмен сообщениями, галочки ✓✓ ✅
```
