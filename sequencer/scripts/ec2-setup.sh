#!/bin/bash
#
# EC2 First-Time Setup Script for Omnify Sequencer
# Instance: t3.small (2 vCPU, 2GB RAM) — Amazon Linux 2023 or Ubuntu 22.04
#
# Usage: ssh into your EC2, then run:
#   curl -o setup.sh https://raw.githubusercontent.com/<your-repo>/sequencer/scripts/ec2-setup.sh
#   chmod +x setup.sh
#   sudo ./setup.sh
#

set -euo pipefail

echo "=========================================="
echo "  Omnify Sequencer — EC2 Setup"
echo "  Target: t3.small (2GB RAM)"
echo "=========================================="

# ------------------------------------------
# 1. System updates
# ------------------------------------------
echo "[1/7] Updating system packages..."
if command -v apt &> /dev/null; then
    # Ubuntu / Debian
    export DEBIAN_FRONTEND=noninteractive
    apt update -y && apt upgrade -y
    apt install -y curl git build-essential
    PKG_MANAGER="apt"
elif command -v dnf &> /dev/null; then
    # Amazon Linux 2023
    dnf update -y
    dnf install -y curl git gcc-c++ make
    PKG_MANAGER="dnf"
else
    echo "Unsupported OS. Use Ubuntu 22.04 or Amazon Linux 2023."
    exit 1
fi

# ------------------------------------------
# 2. Create swap file (critical for 2GB instance)
# ------------------------------------------
echo "[2/7] Creating 2GB swap file..."
if [ ! -f /swapfile ]; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Optimize swap behavior for low-memory server
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    sysctl -p
    echo "   Swap created and enabled (2GB)"
else
    echo "   Swap already exists, skipping"
fi

# ------------------------------------------
# 3. Install Node.js 20 LTS
# ------------------------------------------
echo "[3/7] Installing Node.js 20 LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null || \
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
    if [ "$PKG_MANAGER" = "apt" ]; then
        apt install -y nodejs
    else
        dnf install -y nodejs
    fi
fi
echo "   Node.js $(node -v) installed"

# ------------------------------------------
# 4. Install Redis
# ------------------------------------------
echo "[4/7] Installing Redis..."
if ! command -v redis-server &> /dev/null; then
    if [ "$PKG_MANAGER" = "apt" ]; then
        apt install -y redis-server
    else
        dnf install -y redis6
    fi
fi

# Configure Redis for low memory
cat > /etc/redis/redis.conf.d/omnify.conf 2>/dev/null || true
mkdir -p /etc/redis
cat > /etc/redis/omnify.conf << 'REDIS_CONF'
# Omnify Redis Config — optimized for t3.small
maxmemory 128mb
maxmemory-policy allkeys-lru
appendonly yes
appendfsync everysec
# Disable snapshotting to save memory (AOF is enough)
save ""
REDIS_CONF

# Try to include the custom config (path varies by distro)
if [ -f /etc/redis/redis.conf ]; then
    if ! grep -q "omnify.conf" /etc/redis/redis.conf; then
        echo "include /etc/redis/omnify.conf" >> /etc/redis/redis.conf
    fi
fi

systemctl enable redis-server 2>/dev/null || systemctl enable redis 2>/dev/null
systemctl restart redis-server 2>/dev/null || systemctl restart redis 2>/dev/null
echo "   Redis installed and configured (128MB limit)"

# ------------------------------------------
# 5. Install PM2
# ------------------------------------------
echo "[5/7] Installing PM2..."
npm install -g pm2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
echo "   PM2 installed with log rotation"

# ------------------------------------------
# 6. Create app user and directory
# ------------------------------------------
echo "[6/7] Setting up app directory..."
# Create omnify user if not exists
id -u omnify &>/dev/null || useradd -m -s /bin/bash omnify

# Create app directory
mkdir -p /opt/omnify/sequencer
chown -R omnify:omnify /opt/omnify

# ------------------------------------------
# 7. Setup PM2 startup on boot
# ------------------------------------------
echo "[7/7] Configuring PM2 startup..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u omnify --hp /home/omnify
systemctl enable pm2-omnify 2>/dev/null || true

echo ""
echo "=========================================="
echo "  Setup complete!"
echo "=========================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Switch to omnify user:"
echo "     sudo su - omnify"
echo ""
echo "  2. Clone your repo:"
echo "     git clone <your-repo-url> /opt/omnify/sequencer"
echo ""
echo "  3. Install & build:"
echo "     cd /opt/omnify/sequencer"
echo "     npm ci --production=false"
echo "     npm run build"
echo ""
echo "  4. Create .env file:"
echo "     cp .env.example .env"
echo "     nano .env  # fill in your production values"
echo ""
echo "  5. Start the sequencer:"
echo "     pm2 start ecosystem.production.config.js"
echo "     pm2 save"
echo ""
echo "  6. Verify:"
echo "     pm2 status"
echo "     curl http://localhost:3000/health"
echo ""
echo "=========================================="
