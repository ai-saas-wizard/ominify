# Omnify Sequencer — AWS EC2 Deployment Guide

## Instance: t3.small (~$12-15/mo)
- 2 vCPU, 2GB RAM
- Handles 0-50 users comfortably
- Redis runs locally (no ElastiCache needed)

---

## Step 1: Launch EC2 Instance

1. Go to **AWS Console → EC2 → Launch Instance**
2. Configure:
   - **Name:** `omnify-sequencer`
   - **AMI:** Ubuntu 22.04 LTS (free tier eligible)
   - **Instance type:** `t3.small`
   - **Key pair:** Create or select one (save the .pem file!)
   - **Storage:** 20 GB gp3 (default is fine)
3. **Security Group** — create new with these inbound rules:

   | Type | Port | Source | Purpose |
   |------|------|--------|---------|
   | SSH | 22 | Your IP | SSH access |
   | Custom TCP | 3000 | 0.0.0.0/0 | Webhook server (Twilio/VAPI callbacks) |

   > **Note:** Port 3001 (admin/health) should NOT be public. Access via SSH tunnel only.

4. Click **Launch Instance**
5. Note the **Public IP** or assign an **Elastic IP** (recommended — keeps IP stable on restart)

---

## Step 2: First-Time Server Setup

```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@<your-ec2-ip>

# Download and run setup script
curl -o setup.sh https://raw.githubusercontent.com/<your-repo>/sequencer/scripts/ec2-setup.sh
chmod +x setup.sh
sudo ./setup.sh
```

This installs Node.js 20, Redis, PM2, creates a swap file, and configures everything.

---

## Step 3: Deploy the Sequencer

### Option A: Deploy from your local machine (recommended)

```bash
# From your local machine, in the sequencer/ directory
cd sequencer

# First deploy
./scripts/deploy.sh omnify@<your-ec2-ip>
```

### Option B: Manual deploy on the server

```bash
# On the EC2 instance
sudo su - omnify
git clone <your-repo-url> /opt/omnify/sequencer
cd /opt/omnify/sequencer

npm ci --omit=dev
npm run build
```

---

## Step 4: Configure Environment

```bash
# On the EC2 instance
sudo su - omnify
cd /opt/omnify/sequencer

cp .env.example .env
nano .env
```

Fill in your production values:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
REDIS_URL=redis://localhost:6379
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
OPENAI_API_KEY=sk-...
ENCRYPTION_KEY=<generate with: openssl rand -hex 32>
WEBHOOK_BASE_URL=https://<your-ec2-ip-or-domain>:3000
WEBHOOK_PORT=3000
ADMIN_PORT=3001
NODE_ENV=production
```

---

## Step 5: Start the Sequencer

```bash
cd /opt/omnify/sequencer
pm2 start ecosystem.production.config.js
pm2 save

# Verify everything is running
pm2 status
```

You should see 7 processes all showing `online`:
```
┌──────────────────┬────┬──────┬────────┬─────────┐
│ name             │ id │ mode │ status │ memory  │
├──────────────────┼────┼──────┼────────┼─────────┤
│ scheduler        │ 0  │ fork │ online │ 80 MB   │
│ sms-worker       │ 1  │ fork │ online │ 65 MB   │
│ email-worker     │ 2  │ fork │ online │ 65 MB   │
│ vapi-worker      │ 3  │ fork │ online │ 75 MB   │
│ webhook-server   │ 4  │ fork │ online │ 60 MB   │
│ event-processor  │ 5  │ fork │ online │ 55 MB   │
│ analytics-worker │ 6  │ fork │ online │ 70 MB   │
└──────────────────┴────┴──────┴────────┴─────────┘
```

---

## Step 6: Configure Webhooks

Update your webhook URLs in Twilio and VAPI to point to your EC2:

- **Twilio SMS webhook:** `http://<your-ec2-ip>:3000/webhooks/twilio/sms`
- **Twilio status callback:** `http://<your-ec2-ip>:3000/webhooks/twilio/status`
- **VAPI webhook:** `http://<your-ec2-ip>:3000/webhooks/vapi/events`
- **Lead ingestion:** `http://<your-ec2-ip>:3000/webhooks/leads/inbound`

> **Tip:** For production, put Nginx or Caddy in front with SSL.
> Quick SSL with Caddy: `sudo caddy reverse-proxy --from your-domain.com --to localhost:3000`

---

## Updating the Sequencer

From your local machine:
```bash
cd sequencer
./scripts/deploy.sh omnify@<your-ec2-ip>
```

This builds locally, syncs files, and does a zero-downtime PM2 reload.

---

## Useful Commands

```bash
# View all process status
pm2 status

# View logs (all processes)
pm2 logs

# View logs for specific process
pm2 logs scheduler
pm2 logs webhook-server

# Monitor CPU/memory in real-time
pm2 monit

# Restart a specific process
pm2 restart scheduler

# Restart all processes
pm2 restart all

# Check Redis
redis-cli ping
redis-cli info memory

# Check system memory
free -h

# Check disk space
df -h
```

---

## Scaling Up (when you outgrow t3.small)

When you hit 50+ active users:

1. **Upgrade instance:** Stop EC2 → Change instance type to `t3.medium` (4GB, ~$30/mo) → Start
2. **Scale workers:** Edit `ecosystem.production.config.js`, set SMS/Email workers to `instances: 2`
3. **Restart:** `pm2 restart ecosystem.production.config.js`

All data is in Supabase & Redis (with AOF persistence), so no data loss on instance changes.

---

## Cost Breakdown

| Resource | Monthly Cost |
|----------|-------------|
| t3.small (on-demand) | ~$15 |
| t3.small (1yr reserved) | ~$10 |
| 20GB gp3 storage | ~$1.60 |
| Elastic IP (while attached) | Free |
| Data transfer (first 100GB) | Free |
| **Total** | **~$12-17/mo** |
