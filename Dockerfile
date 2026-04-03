FROM node:20-alpine

# Build deps for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ sqlite-dev openssl-dev

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js .
COPY database.js .
COPY index.html .

# ✅ [FIX-2.3] /data будет заменён Render Persistent Disk mount'ом.
# В dev-режиме (без диска) данные пишутся сюда внутри контейнера.
RUN mkdir -p /data

# Healthcheck — Render использует его для проверки готовности
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

EXPOSE 5000

CMD ["node", "server.js"]
