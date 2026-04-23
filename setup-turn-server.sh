#!/bin/bash
# ==========================================
# Быстрая установка TURN сервера для Cipher P2P
# Запускать на VPS сервере с Ubuntu/Debian
# ==========================================

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Установка TURN сервера для Cipher P2P ===${NC}"

# Получение IP сервера
SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
echo -e "${YELLOW}Обнаружен IP сервера: $SERVER_IP${NC}"

# Генерация учетных данных
TURN_USER="cipher$(openssl rand -hex 6)"
TURN_PASS="$(openssl rand -base64 24)"

echo ""
echo -e "${YELLOW}Сгенерированные учетные данные:${NC}"
echo "  Username: $TURN_USER"
echo "  Password: $TURN_PASS"
echo ""

# Обновление системы
echo -e "${GREEN}[1/6] Обновление системы...${NC}"
apt update -qq

# Установка coturn
echo -e "${GREEN}[2/6] Установка coturn...${NC}"
apt install -y -qq coturn openssl

# Создание конфигурации
echo -e "${GREEN}[3/6] Настройка coturn...${NC}"
cat > /etc/turnserver.conf << EOF
# Cipher P2P TURN Server Configuration
# Сгенерировано: $(date)

# Network
listening-port=3478
listening-ip=0.0.0.0
external-ip=$SERVER_IP
min-port=10000
max-port=20000

# Authentication
fingerprint
lt-cred-mech
user=$TURN_USER:$TURN_PASS

# Logging
log-file=/var/log/turnserver.log
verbose

# Security
no-cli
no-multicast-peers
no-sslv3
no-tlsv1
no-tlsv1_1

# Performance
stale-nonce
total-quota=100
max-bps=1000000

# WebRTC specific
no-stun-check-attribute
EOF

# Создание лог-файла
touch /var/log/turnserver.log
chmod 666 /var/log/turnserver.log

# Настройка firewall
echo -e "${GREEN}[4/6] Настройка firewall...${NC}"
if command -v ufw &> /dev/null; then
    ufw allow 3478/tcp >/dev/null 2>&1
    ufw allow 3478/udp >/dev/null 2>&1
    ufw allow 10000:20000/udp >/dev/null 2>&1
    echo "  UFW настроен"
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=3478/tcp >/dev/null 2>&1
    firewall-cmd --permanent --add-port=3478/udp >/dev/null 2>&1
    firewall-cmd --permanent --add-port=10000-20000/udp >/dev/null 2>&1
    firewall-cmd --reload >/dev/null 2>&1
    echo "  firewalld настроен"
else
    iptables -A INPUT -p tcp --dport 3478 -j ACCEPT >/dev/null 2>&1
    iptables -A INPUT -p udp --dport 3478 -j ACCEPT >/dev/null 2>&1
    iptables -A INPUT -p udp --dport 10000:20000 -j ACCEPT >/dev/null 2>&1
    echo "  iptables настроен"
fi

# Включение автозапуска
echo -e "${GREEN}[5/6] Включение автозапуска...${NC}"
sed -i 's/TURNSERVER_ENABLED=0/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable coturn >/dev/null 2>&1

# Запуск сервиса
echo -e "${GREEN}[6/6] Запуск TURN сервера...${NC}"
systemctl restart coturn
sleep 2

# Проверка статуса
if systemctl is-active --quiet coturn; then
    echo ""
    echo -e "${GREEN}✅ TURN сервер успешно запущен!${NC}"
    echo ""
    echo -e "${YELLOW}=== КОНФИГУРАЦИЯ ДЛЯ index.html ===${NC}"
    echo ""
    echo "{"
    echo "  urls: 'turn:$SERVER_IP:3478',"
    echo "  username: '$TURN_USER',"
    echo "  credential: '$TURN_PASS'"
    echo "},"
    echo "{"
    echo "  urls: 'turn:$SERVER_IP:3478?transport=tcp',"
    echo "  username: '$TURN_USER',"
    echo "  credential: '$TURN_PASS'"
    echo "}"
    echo ""
    echo -e "${YELLOW}Проверка:${NC}"
    echo "  systemctl status coturn    - статус сервера"
    echo "  tail -f /var/log/turnserver.log  - логи"
    echo "  ss -tulpn | grep 3478      - проверка портов"
    echo ""
else
    echo -e "${RED}❌ Ошибка при запуске TURN сервера${NC}"
    echo "Проверьте логи: journalctl -u coturn -n 50"
    exit 1
fi
