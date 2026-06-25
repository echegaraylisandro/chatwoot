#!/bin/bash
# Setup ONE DEPIL Bot — Ubuntu 22.04 / 24.04
set -e

echo "======================================"
echo "  ONE DEPIL Bot — Setup del servidor"
echo "======================================"

# 1. Actualizar sistema
echo "[1/6] Actualizando sistema..."
apt-get update -qq && apt-get upgrade -y -qq

# 2. Instalar Node.js 20 LTS
echo "[2/6] Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
apt-get install -y nodejs > /dev/null 2>&1
echo "   Node: $(node -v)  npm: $(npm -v)"

# 3. Instalar PM2 (gestor de procesos)
echo "[3/6] Instalando PM2..."
npm install -g pm2 > /dev/null 2>&1

# 4. Instalar dependencias del bot
echo "[4/6] Instalando dependencias del bot..."
cd /root/onedepil-bot
npm install --production > /dev/null 2>&1

# 5. Configurar PM2 para arrancar con el sistema
echo "[5/6] Configurando arranque automático..."
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# 6. Firewall básico
echo "[6/6] Configurando firewall..."
ufw allow OpenSSH > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1

echo ""
echo "======================================"
echo "  Setup completado!"
echo "  Próximo paso: escaneá el QR"
echo "  Corré: pm2 start bot.js --name aldana"
echo "======================================"
