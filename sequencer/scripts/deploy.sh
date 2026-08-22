#!/bin/bash
#
# Deploy / Update Omnify Sequencer on EC2
#
# Usage (from your local machine):
#   ./scripts/deploy.sh <user@ec2-host>
#   SSH_KEY=~/.ssh/other.pem ./scripts/deploy.sh ubuntu@1.2.3.4
#
# Example:
#   ./scripts/deploy.sh ubuntu@54.156.90.226
#
# What it does:
#   1. Builds locally (faster than building on a t3.small)
#   2. Syncs dist/ + package + PM2 config to EC2
#   3. Installs production deps ONLY when package-lock.json changed
#   4. Zero-downtime PM2 reload, then verifies the processes came back
#
# The sequencer runs the COMPILED dist/, so a deploy that skips the build
# ships nothing. node_modules/.env/logs are never synced, so the server keeps
# its own credentials.
#

set -euo pipefail

# --- Config ---
EC2_HOST="${1:?Usage: ./deploy.sh <user@ec2-host>}"
REMOTE_DIR="${REMOTE_DIR:-/opt/omnify/sequencer}"

# Key resolution: explicit SSH_KEY wins; otherwise fall back to the project key
# if it happens to be there, else rely on ssh-agent / ~/.ssh/config.
SSH_KEY="${SSH_KEY:-}"
if [ -z "$SSH_KEY" ] && [ -f "$HOME/.ssh/omnify-sequencer.pem" ]; then
    SSH_KEY="$HOME/.ssh/omnify-sequencer.pem"
    echo "  (using $SSH_KEY — override with SSH_KEY=...)"
fi

# Build the ssh command as an ARRAY. The previous version did:
#     $( [ -n "$SSH_KEY" ] && echo "-e 'ssh -i $SSH_KEY'" )
# Unquoted command substitution word-splits on spaces and the single quotes
# survive as literal characters, so rsync received -e "'ssh" and failed — which
# is why this script could not be used with a key and deploys were done by hand.
SSH_CMD=(ssh)
if [ -n "$SSH_KEY" ]; then
    SSH_CMD+=(-i "$SSH_KEY")
fi

remote() {
    "${SSH_CMD[@]}" "$EC2_HOST" "$@"
}

echo "=========================================="
echo "  Deploying Sequencer to $EC2_HOST"
echo "  Remote dir: $REMOTE_DIR"
echo "=========================================="

cd "$(dirname "$0")/.."

# ------------------------------------------
# 1. Build locally
# ------------------------------------------
echo ""
echo "[1/5] Building locally..."
npm run build
if [ ! -f dist/workers/scheduler-worker.js ]; then
    echo "  ERROR: build produced no dist/workers/scheduler-worker.js — aborting" >&2
    exit 1
fi
echo "   Build complete"

# ------------------------------------------
# 2. Did dependencies change?
# ------------------------------------------
echo ""
echo "[2/5] Checking dependencies..."
LOCAL_LOCK_SUM=$(shasum -a 256 package-lock.json | awk '{print $1}')
REMOTE_LOCK_SUM=$(remote "shasum -a 256 $REMOTE_DIR/package-lock.json 2>/dev/null | awk '{print \$1}'" || true)
if [ "$LOCAL_LOCK_SUM" = "$REMOTE_LOCK_SUM" ]; then
    NEEDS_INSTALL=false
    echo "   package-lock unchanged — skipping npm ci"
else
    NEEDS_INSTALL=true
    echo "   package-lock changed — will run npm ci on the remote"
fi

# ------------------------------------------
# 3. Sync files to EC2
# ------------------------------------------
echo ""
echo "[3/5] Syncing files to EC2..."
rsync -avz --delete \
    -e "${SSH_CMD[*]}" \
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
# 4. Install deps (only if needed) & reload PM2
# ------------------------------------------
if [ "$NEEDS_INSTALL" = true ]; then
    echo ""
    echo "[4/5] Installing dependencies on EC2..."
    remote "cd $REMOTE_DIR && npm ci --omit=dev"
    echo "   Dependencies installed"
else
    echo ""
    echo "[4/5] Skipping dependency install"
fi

echo ""
echo "[5/5] Reloading PM2 processes..."
# reload (not restart) so in-flight jobs drain instead of being killed.
remote "cd $REMOTE_DIR && \
    if pm2 list | grep -q scheduler; then \
        echo '   Reloading existing processes (zero-downtime)...'; \
        pm2 reload ecosystem.production.config.js; \
    else \
        echo '   Starting processes for the first time...'; \
        pm2 start ecosystem.production.config.js; \
    fi; \
    pm2 save >/dev/null"

# ------------------------------------------
# Verify — a deploy that silently no-ops is worse than one that fails loudly.
# ------------------------------------------
echo ""
echo "Verifying..."
ONLINE=$(remote "pm2 jlist" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const l=JSON.parse(s);
    const on=l.filter(p=>p.pm2_env.status==='online').length;
    const bad=l.filter(p=>p.pm2_env.status!=='online').map(p=>p.name+':'+p.pm2_env.status);
    console.log(on+'|'+l.length+'|'+bad.join(','));
  }catch(e){console.log('0|0|parse-failed')}
});")
ON_COUNT="${ONLINE%%|*}"; REST="${ONLINE#*|}"; TOTAL="${REST%%|*}"; BAD="${REST#*|}"
echo "   PM2: $ON_COUNT/$TOTAL online"
if [ -n "$BAD" ]; then
    echo "   NOT ONLINE: $BAD" >&2
fi
if [ "$ON_COUNT" = "0" ] || [ "$ON_COUNT" != "$TOTAL" ]; then
    echo ""
    echo "  DEPLOY INCOMPLETE — some processes are not online." >&2
    echo "  Check: ssh $EC2_HOST 'pm2 logs --err --lines 40'" >&2
    exit 1
fi

echo ""
echo "=========================================="
echo "  Deploy complete — $ON_COUNT/$TOTAL processes online"
echo "=========================================="
echo ""
echo "  Logs:   ssh $EC2_HOST 'pm2 logs --lines 20'"
echo "  Health: ssh $EC2_HOST 'curl -s http://localhost:3000/health'"
echo ""
