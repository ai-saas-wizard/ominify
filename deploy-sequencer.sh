#!/bin/bash
set -e

########################################
# Omnify Sequencer — EC2 Deploy Script
########################################
#
# Usage:
#   ./deploy-sequencer.sh              # Full deploy (build + upload + restart)
#   ./deploy-sequencer.sh --env-only   # Only upload .env and restart
#   ./deploy-sequencer.sh --restart    # Only restart PM2 on EC2
#
########################################

# ── Config ──
EC2_HOST="54.156.90.226"
EC2_USER="ubuntu"
SSH_KEY="$HOME/.ssh/omnify-sequencer.pem"
REMOTE_DIR="/opt/omnify/sequencer"
LOCAL_DIR="$(cd "$(dirname "$0")/sequencer" && pwd)"
ENV_FILE="$LOCAL_DIR/.env.production"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Helpers ──
log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info()  { echo -e "${CYAN}[→]${NC} $1"; }

ssh_cmd() {
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" "$1"
}

# ── Preflight checks ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Omnify Sequencer Deploy Script     ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

[ ! -f "$SSH_KEY" ] && err "SSH key not found: $SSH_KEY"
[ ! -d "$LOCAL_DIR" ] && err "Sequencer directory not found: $LOCAL_DIR"

# Test SSH connection
info "Testing SSH connection..."
ssh_cmd "echo 'connected'" > /dev/null 2>&1 || err "Cannot SSH into $EC2_HOST. Check your key and security group."
log "SSH connection OK"

# ── Parse flags ──
MODE="full"
if [ "$1" == "--env-only" ]; then
    MODE="env-only"
elif [ "$1" == "--restart" ]; then
    MODE="restart"
fi

# ── Step 1: Build locally ──
if [ "$MODE" == "full" ]; then
    info "Building sequencer locally..."
    cd "$LOCAL_DIR"

    # Install deps if node_modules missing
    if [ ! -d "node_modules" ]; then
        warn "node_modules missing, running npm install..."
        npm install
    fi

    # TypeScript compile
    npx tsc
    log "Build complete → dist/"

    # ── Step 2: Upload built files ──
    info "Uploading dist/ to EC2..."

    # Create a temp tarball for faster upload
    tar -czf /tmp/sequencer-dist.tar.gz -C "$LOCAL_DIR" \
        dist/ \
        package.json \
        package-lock.json \
        ecosystem.config.js

    scp -o StrictHostKeyChecking=no -i "$SSH_KEY" \
        /tmp/sequencer-dist.tar.gz \
        "$EC2_USER@$EC2_HOST:/tmp/sequencer-dist.tar.gz"

    # Extract on server
    ssh_cmd "
        sudo tar -xzf /tmp/sequencer-dist.tar.gz -C $REMOTE_DIR &&
        sudo chown -R $EC2_USER:$EC2_USER $REMOTE_DIR &&
        rm /tmp/sequencer-dist.tar.gz
    "
    rm /tmp/sequencer-dist.tar.gz
    log "Files uploaded"

    # ── Step 3: Install production deps on EC2 ──
    info "Installing production dependencies on EC2..."
    ssh_cmd "cd $REMOTE_DIR && npm install --omit=dev --ignore-scripts 2>&1 | tail -3"
    log "Dependencies installed"
fi

# ── Step 4: Upload .env if it exists ──
if [ "$MODE" == "full" ] || [ "$MODE" == "env-only" ]; then
    if [ -f "$ENV_FILE" ]; then
        info "Uploading .env.production → .env on EC2..."
        scp -o StrictHostKeyChecking=no -i "$SSH_KEY" \
            "$ENV_FILE" \
            "$EC2_USER@$EC2_HOST:/tmp/sequencer-env"
        ssh_cmd "sudo mv /tmp/sequencer-env $REMOTE_DIR/.env && sudo chown $EC2_USER:$EC2_USER $REMOTE_DIR/.env && chmod 600 $REMOTE_DIR/.env"
        log ".env uploaded"
    else
        warn "No .env.production found at $ENV_FILE"
        warn "Create it with your production credentials before deploying."
        warn "Template: $LOCAL_DIR/.env.example"

        if [ "$MODE" == "env-only" ]; then
            err "Cannot do --env-only without .env.production file"
        fi
    fi
fi

# ── Step 5: Restart PM2 ──
info "Restarting PM2 processes..."
ssh_cmd "
    cd $REMOTE_DIR &&
    pm2 delete all 2>/dev/null || true &&
    pm2 start ecosystem.config.js --env production &&
    pm2 save
" 2>&1

log "PM2 restarted"

# ── Step 6: Health check ──
info "Waiting 5s for workers to start..."
sleep 5

echo ""
info "PM2 Status:"
ssh_cmd "pm2 list"

echo ""

# Check for any errored processes
ERRORED=$(ssh_cmd "pm2 jlist" 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    errored = [p['name'] for p in procs if p.get('pm2_env', {}).get('status') != 'online']
    if errored:
        print('ERRORED: ' + ', '.join(errored))
    else:
        print('ALL_ONLINE')
except:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")

if [ "$ERRORED" == "ALL_ONLINE" ]; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   ✅ Deploy successful!               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
    echo ""
elif [[ "$ERRORED" == ERRORED* ]]; then
    echo ""
    echo -e "${RED}╔══════════════════════════════════════╗${NC}"
    echo -e "${RED}║   ⚠️  Some workers failed to start    ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════╝${NC}"
    echo -e "${RED}$ERRORED${NC}"
    echo ""
    warn "Check logs with: ssh -i $SSH_KEY $EC2_USER@$EC2_HOST 'pm2 logs --lines 50'"
else
    warn "Could not verify status. Check manually."
fi
