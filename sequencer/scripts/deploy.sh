#!/bin/bash
#
# Deploy / Update Omnify Sequencer on EC2
#
# Usage (from your local machine):
#   ./scripts/deploy.sh <ec2-host>
#
# Example:
#   ./scripts/deploy.sh ec2-user@3.14.15.92
#   ./scripts/deploy.sh omnify@your-domain.com
#
# What it does:
#   1. Builds locally (faster than building on t3.small)
#   2. Syncs built files to EC2
#   3. Installs production deps & restarts PM2
#

set -euo pipefail

# --- Config ---
EC2_HOST="${1:?Usage: ./deploy.sh <user@ec2-host>}"
REMOTE_DIR="/opt/omnify/sequencer"
SSH_KEY="${SSH_KEY:-}"  # Set SSH_KEY env var if not using default key

# SSH options
SSH_OPTS=""
if [ -n "$SSH_KEY" ]; then
    SSH_OPTS="-i $SSH_KEY"
fi

echo "=========================================="
echo "  Deploying Sequencer to $EC2_HOST"
echo "=========================================="

# ------------------------------------------
# 1. Build locally
# ------------------------------------------
echo ""
echo "[1/4] Building locally..."
cd "$(dirname "$0")/.."
npm run build
echo "   Build complete"

# ------------------------------------------
# 2. Sync files to EC2
# ------------------------------------------
echo ""
echo "[2/4] Syncing files to EC2..."
rsync -avz --delete \
    $( [ -n "$SSH_KEY" ] && echo "-e 'ssh -i $SSH_KEY'" ) \
    --exclude='node_modules' \
    --exclude='.env' \
    --exclude='logs' \
    --exclude='src' \
    --exclude='.git' \
    --include='dist/***' \
    --include='package.json' \
    --include='package-lock.json' \
    --include='ecosystem.production.config.js' \
    --include='scripts/***' \
    --exclude='*' \
    ./ "$EC2_HOST:$REMOTE_DIR/"
echo "   Files synced"

# ------------------------------------------
# 3. Install deps & restart on remote
# ------------------------------------------
echo ""
echo "[3/4] Installing dependencies on EC2..."
ssh $SSH_OPTS "$EC2_HOST" << 'REMOTE_SCRIPT'
    cd /opt/omnify/sequencer
    npm ci --omit=dev
    echo "   Dependencies installed"
REMOTE_SCRIPT

echo ""
echo "[4/4] Restarting PM2 processes..."
ssh $SSH_OPTS "$EC2_HOST" << 'REMOTE_SCRIPT'
    cd /opt/omnify/sequencer

    # Check if PM2 processes are already running
    if pm2 list | grep -q "scheduler"; then
        echo "   Reloading existing processes (zero-downtime)..."
        pm2 reload ecosystem.production.config.js
    else
        echo "   Starting processes for the first time..."
        pm2 start ecosystem.production.config.js
    fi

    pm2 save

    echo ""
    echo "   Process status:"
    pm2 status
REMOTE_SCRIPT

echo ""
echo "=========================================="
echo "  Deploy complete!"
echo "=========================================="
echo ""
echo "  Verify:"
echo "    ssh $EC2_HOST 'curl -s http://localhost:3000/health'"
echo "    ssh $EC2_HOST 'pm2 logs --lines 20'"
echo ""
