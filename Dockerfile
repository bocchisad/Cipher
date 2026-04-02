FROM node:20-alpine

# Build deps needed for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ sqlite-dev openssl-dev

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js .
COPY database.js .
COPY index.html .

# Persistent data directory — will be replaced by Fly Volume mount
RUN mkdir -p /data

EXPOSE 5000

CMD ["node", "server.js"]
