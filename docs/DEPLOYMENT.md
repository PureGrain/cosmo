# Deployment Guide

This guide covers deploying Cosmo in production: a static frontend on Cloudflare Pages and an API server on a VPS, with the origin firewalled to only accept Cloudflare traffic.

```
Visitor  -->  Cloudflare CDN  -->  yourdomain.com (Pages)
                  |
                  +-->  api.yourdomain.com (DNS proxy)  -->  YOUR_VPS_IP:443 (nginx)  -->  localhost:3001 (Node)
```

---

## API Server (VPS)

**Target:** `YOUR_VPS_IP` --> `api.yourdomain.com`

### 1. Server Prerequisites

SSH into your VPS and install Node.js 18+:

```bash
ssh root@YOUR_VPS_IP

# Install Node.js 18+ (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Verify
node --version   # v18.x or higher
npm --version
```

Install nginx and certbot while you are here:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

### 2. Deploy the Code

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/cosmo.git
cd cosmo/api
npm install

cp .env.example .env
# Edit .env with your values:
#   ANTHROPIC_API_KEY   — required, get from console.anthropic.com
#   ALLOWED_ORIGIN      — your frontend URL, e.g. https://yourdomain.com
#   ADMIN_KEY           — optional, enables /admin/stats
#   TURNSTILE_SECRET    — optional, Cloudflare Turnstile bot protection
#   DISCORD_WEBHOOK     — optional, conversation notifications
#   MAILGUN_API_KEY     — optional, contact form email replies
#   MAILGUN_DOMAIN      — optional, e.g. mg.yourdomain.com
#   OWNER_EMAIL         — your email for contact form messages
nano .env
```

Test that it starts:

```bash
node server.js
# Should print: Cosmo API listening on port 3001
# Ctrl+C to stop
```

### 3. Firewall -- Cloudflare-Only Origin Access

**Why this matters:** Without firewall rules, anyone who discovers your VPS IP can bypass Cloudflare entirely -- skipping rate limiting, WAF rules, DDoS protection, and bot filtering. The origin server should only accept HTTP/HTTPS traffic from Cloudflare's edge network.

The included script `scripts/cloudflare-firewall.sh` configures `ufw` to:
1. Allow SSH from anywhere (so you do not lock yourself out)
2. Allow ports 80 and 443 **only** from Cloudflare IP ranges
3. Deny everything else

**Run it:**

```bash
cd /opt/cosmo
bash scripts/cloudflare-firewall.sh
```

**Verify the rules are active:**

```bash
ufw status numbered
```

You should see SSH allowed from anywhere, and HTTP/HTTPS rules scoped to Cloudflare CIDR blocks (173.245.48.0/20, 104.16.0.0/13, 2606:4700::/32, etc.).

**Test that direct access is blocked:**

```bash
# From a non-Cloudflare IP (your local machine, a different server, etc.):
curl -m 5 http://YOUR_VPS_IP
# Should timeout or connection refused

# Through Cloudflare (should work):
curl https://api.yourdomain.com/health
```

**Updating the rules:** Cloudflare occasionally adds new IP ranges. Re-run the script periodically (monthly is fine) to pick up changes. The script fetches the current list from https://www.cloudflare.com/ips/ and resets all rules before applying.

```bash
# Cron job to update monthly (optional):
echo "0 3 1 * * root bash /opt/cosmo/scripts/cloudflare-firewall.sh >> /var/log/cf-firewall.log 2>&1" \
  > /etc/cron.d/cloudflare-firewall
```

### 4. systemd Service

Create the service file:

```bash
cat > /etc/systemd/system/cosmo.service << 'EOF'
[Unit]
Description=Cosmo Portfolio Bot API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cosmo/api
EnvironmentFile=/opt/cosmo/api/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable cosmo
systemctl start cosmo
systemctl status cosmo
```

Check the logs:

```bash
journalctl -u cosmo -f
```

### 5. Nginx Reverse Proxy

Create the nginx site configuration. This includes two critical pieces:
- **Cloudflare real-IP restoration** so your application sees actual visitor IPs (not Cloudflare edge IPs) in logs and rate limiting
- **SSE support** with `proxy_buffering off` so streamed chat responses are not held in the nginx buffer

```bash
cat > /etc/nginx/sites-available/cosmo-api << 'NGINX'
# ─── Cloudflare Real-IP Restore ──────────────────────────────────────────────
# Without this, all requests appear to come from Cloudflare edge IPs.
# These ranges must match https://www.cloudflare.com/ips/

# Cloudflare IPv4
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;

# Cloudflare IPv6
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;

real_ip_header CF-Connecting-IP;

# ─── Server Block ────────────────────────────────────────────────────────────
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # Pass real client info
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support — disable buffering so streamed responses
        # are forwarded to the client immediately
        proxy_buffering off;
        proxy_cache off;

        # SSE connections can be long-lived
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;

        # WebSocket upgrade (if needed)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX
```

Enable the site and reload nginx:

```bash
ln -sf /etc/nginx/sites-available/cosmo-api /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

### 6. SSL with Let's Encrypt

Run certbot to obtain a certificate and automatically update the nginx config for HTTPS:

```bash
certbot --nginx -d api.yourdomain.com
```

Certbot will:
- Obtain a certificate from Let's Encrypt
- Modify the nginx site config to listen on 443 with SSL
- Add an HTTP-to-HTTPS redirect
- Set up automatic renewal via a systemd timer

Verify the renewal timer is active:

```bash
systemctl list-timers | grep certbot
```

**Note:** For certbot to work, the domain `api.yourdomain.com` must already point to `YOUR_VPS_IP` via a DNS A record. If you are using Cloudflare DNS with the proxy enabled (orange cloud), temporarily set it to DNS-only (grey cloud) for the initial certificate issuance, then re-enable the proxy afterward.

### 7. Verify API

Run these checks to confirm everything is working:

```bash
# 1. Direct localhost (from the VPS itself)
curl -s http://localhost:3001/health
# Expected: {"status":"ok",...}

# 2. Through Cloudflare (from anywhere)
curl -s https://api.yourdomain.com/health
# Expected: {"status":"ok",...}

# 3. Direct IP access is blocked (from a non-Cloudflare IP)
curl -m 5 http://YOUR_VPS_IP
# Expected: timeout / connection refused

# 4. SSE streaming works
curl -N -s https://api.yourdomain.com/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
# Expected: SSE stream with data: lines
```

---

## Frontend (Cloudflare Pages)

### 1. DNS Setup

In the Cloudflare dashboard for `yourdomain.com`:

| Type  | Name  | Content        | Proxy   |
|-------|-------|----------------|---------|
| A     | `api` | `YOUR_VPS_IP`  | Proxied (orange cloud) |

The root domain (`yourdomain.com`) will be handled by Cloudflare Pages automatically -- no A record needed for it.

### 2. Pages Project

1. Go to **Cloudflare Dashboard** --> **Workers & Pages** --> **Create application** --> **Pages** --> **Connect to Git**
2. Select your GitHub repository (`YOUR_USERNAME/cosmo`)
3. Configure the build:
   - **Production branch:** `main`
   - **Build command:** _(leave blank -- static site, no build step)_
   - **Build output directory:** `frontend`
4. Click **Save and Deploy**

Cloudflare Pages will deploy the contents of the `frontend/` directory as a static site.

### 3. Custom Domain

1. In your Pages project, go to **Custom domains** --> **Set up a custom domain**
2. Enter `yourdomain.com`
3. Cloudflare will automatically configure the DNS records
4. Optionally add `www.yourdomain.com` and set up a redirect rule

### 4. Verify Frontend

```bash
# Homepage loads
curl -s -o /dev/null -w "%{http_code}" https://yourdomain.com
# Expected: 200

# Chat widget connects to the API
# Open https://yourdomain.com in a browser, click the chat icon,
# send a message, and confirm you get a streamed response.
```

---

## Updating

### API

```bash
ssh root@YOUR_VPS_IP
cd /opt/cosmo
git pull origin main
cd api
npm install
systemctl restart cosmo

# Verify
systemctl status cosmo
curl -s http://localhost:3001/health
```

If you changed `.env`:

```bash
systemctl restart cosmo
```

If you changed the nginx config:

```bash
nginx -t && systemctl reload nginx
```

### Frontend

Push to `main` -- Cloudflare Pages auto-deploys on every push. No SSH or manual steps needed.

```bash
git add frontend/
git commit -m "Update frontend"
git push origin main
# Cloudflare Pages picks up the push and deploys within ~60 seconds
```

---

## Troubleshooting

### API won't start

```bash
# Check the logs first
journalctl -u cosmo -n 50 --no-pager

# Common causes:
# 1. Missing ANTHROPIC_API_KEY in .env
#    Fix: ensure .env has a valid key, restart with systemctl restart cosmo

# 2. Port 3001 already in use
#    Fix: lsof -i :3001  -- kill the conflicting process or change PORT in .env

# 3. Missing node_modules
#    Fix: cd /opt/cosmo/api && npm install

# 4. Node.js too old (needs 18+)
#    Fix: node --version  -- upgrade if below 18
```

### SSE not streaming (responses arrive all at once)

This is almost always an nginx buffering issue.

```bash
# Verify proxy_buffering is off in the nginx config:
grep -n "proxy_buffering" /etc/nginx/sites-available/cosmo-api
# Should show: proxy_buffering off;

# If you changed the config, reload:
nginx -t && systemctl reload nginx
```

If responses still arrive in chunks, check if Cloudflare is buffering. In the Cloudflare dashboard for `api.yourdomain.com`, ensure response buffering is not enabled under **Speed** --> **Optimization**.

### CORS errors

The browser console shows `Access-Control-Allow-Origin` errors.

```bash
# Check ALLOWED_ORIGIN in .env matches your frontend URL exactly:
grep ALLOWED_ORIGIN /opt/cosmo/api/.env
# Must match: https://yourdomain.com (no trailing slash, correct protocol)

# Common mistakes:
#   http:// vs https://
#   www.yourdomain.com vs yourdomain.com
#   Trailing slash: https://yourdomain.com/  <-- wrong

# After fixing, restart the service:
systemctl restart cosmo
```

### Chat not connecting

The chat widget shows a connection error or spins indefinitely.

```bash
# 1. Is the API running?
systemctl status cosmo

# 2. Is nginx forwarding correctly?
curl -s http://localhost:3001/health    # Direct -- should work
curl -s https://api.yourdomain.com/health   # Through stack -- should work

# 3. Is the frontend pointing at the right API URL?
#    Check cosmo.config.js for the apiUrl value.
#    It should be: https://api.yourdomain.com

# 4. Check browser console (F12) for specific errors
```

### Daily limit hit

Visitors see "daily limit reached" messages. This is intentional -- the API enforces per-IP daily conversation limits and a global daily spend cap to prevent runaway costs.

```bash
# Check current limits in .env:
grep -E "DAILY_(CONV|SPEND)_LIMIT" /opt/cosmo/api/.env

# Defaults if not set:
#   DAILY_CONV_LIMIT=5      (5 conversations per IP per day)
#   DAILY_SPEND_LIMIT=1.00  ($1.00 USD max API spend per day)

# Limits reset at midnight UTC. To adjust:
#   Edit .env, then: systemctl restart cosmo

# To check current usage (requires ADMIN_KEY to be set):
curl -s https://api.yourdomain.com/admin/stats \
  -H "Authorization: Bearer YOUR_ADMIN_KEY"
```

### All IPs show as Cloudflare

Your logs or rate limiting show Cloudflare edge IPs (e.g., 172.64.x.x) instead of real visitor IPs.

```bash
# Verify the real_ip directives are in the nginx config:
grep -c "set_real_ip_from" /etc/nginx/sites-available/cosmo-api
# Should be 22 (15 IPv4 + 7 IPv6 ranges)

grep "real_ip_header" /etc/nginx/sites-available/cosmo-api
# Should show: real_ip_header CF-Connecting-IP;

# If missing, re-apply the nginx config from step 5 above, then:
nginx -t && systemctl reload nginx
```

### Locked out of SSH

If you accidentally lock yourself out while configuring the firewall:

- The `cloudflare-firewall.sh` script always allows SSH from all IPs (`ufw allow ssh`) as the very first rule. If you modified this, you need console access from your VPS provider.
- Most VPS providers offer a web-based console (VNC/KVM) in their dashboard. Use it to:
  ```bash
  ufw allow ssh
  ufw reload
  ```
- **Prevention:** Always keep an active SSH session open while modifying firewall rules. Test SSH in a second terminal before closing the first.

### Direct IP access still works

If `curl http://YOUR_VPS_IP` returns a response instead of timing out:

```bash
# 1. Is ufw enabled?
ufw status
# Should show: Status: active

# 2. Re-run the firewall script
bash /opt/cosmo/scripts/cloudflare-firewall.sh

# 3. Verify no conflicting rules
ufw status numbered
# Look for broad "allow 80" or "allow 443" rules that are not scoped to CF IPs.
# Delete them:
#   ufw delete RULE_NUMBER

# 4. Test again from a non-Cloudflare IP:
curl -m 5 http://YOUR_VPS_IP
# Should timeout
```
