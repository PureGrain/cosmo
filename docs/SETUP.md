# Cosmo -- Third-Party Services Setup Guide

This guide walks through every external service Cosmo can connect to. Only the **Anthropic API key** is required -- everything else is optional and can be added later.

| Service | Required? | What it does |
|---|---|---|
| Anthropic API | **Yes** | Powers the AI chatbot and contact form replies |
| Cloudflare Pages | **Yes** (for production) | Hosts the static frontend |
| Cloudflare Turnstile | No | Bot verification for chat and contact form |
| Cloudflare D1 | No | Visitor analytics database (server-side) |
| Mailgun | No | Sends AI-generated email replies to contact form submissions |
| Discord Webhook | No | Real-time visitor alerts and chat notifications |
| VPS | **Yes** (for production) | Runs the API server (Node.js) |
| Domain & DNS | **Yes** (for production) | Routes traffic through Cloudflare |
| SSL/TLS | **Yes** (for production) | HTTPS for the API subdomain |

---

## 1. Anthropic API Key

The API key is the only hard requirement. Without it, the chatbot and contact form will not function.

### Create an account

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up with email or Google
3. Complete email verification

### Get your API key

1. Navigate to **API Keys** in the left sidebar
2. Click **Create Key**
3. Name it something like `cosmo-production`
4. Copy the key immediately -- it starts with `sk-ant-api03-` and is only shown once

### Set up billing

1. Go to **Plans & Billing** in the sidebar
2. Add a payment method (credit card)
3. Set a **monthly spend limit** -- $5-10/month is plenty for a portfolio site
4. Anthropic bills per-token: Claude Sonnet 4 costs $3 per million input tokens and $15 per million output tokens
5. A typical portfolio chat message costs roughly $0.003-0.01

### Choose your model

The default model is `claude-sonnet-4-20250514` (Claude Sonnet 4). This is a good balance of quality and cost for a portfolio chatbot. You can override it in your `.env` file:

```bash
# In api/.env
MODEL=claude-sonnet-4-20250514
```

Other options:
- `claude-haiku-4-20250414` -- Cheaper and faster, slightly less capable
- `claude-opus-4-20250514` -- Most capable, significantly more expensive

### Add to your environment

```bash
# In api/.env
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```

> **Security note:** Never commit your API key to git. The `.gitignore` already excludes `.env` files.

---

## 2. Cloudflare Pages

Cloudflare Pages hosts the static frontend (HTML, CSS, JS). No build step is needed -- Cosmo's frontend is plain static files.

### Create an account

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Sign up for a free account
3. No payment method is required for Pages (the free tier is generous)

### Connect your GitHub repo

1. In the Cloudflare dashboard, go to **Workers & Pages**
2. Click **Create** and select the **Pages** tab
3. Click **Connect to Git**
4. Authorize Cloudflare to access your GitHub account
5. Select the repository: `PureGrain/cosmo` (or your fork)

### Configure the build

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | *(leave empty)* |
| Build output directory | `frontend/` |

There is **no build command** because Cosmo's frontend is static HTML, CSS, and vanilla JS. Cloudflare just needs to know which directory to serve.

6. Click **Save and Deploy**

### Configure a custom domain (optional)

1. Go to your Pages project in the dashboard
2. Click **Custom domains** tab
3. Click **Set up a custom domain**
4. Enter your domain (e.g. `alexchen.dev`)
5. Cloudflare will walk you through DNS verification
6. If your domain already uses Cloudflare DNS, this is automatic

Your site will also be available at `your-project.pages.dev` as a fallback.

### Environment variables for Pages Functions

If you are using Cloudflare D1 analytics (see section 4), you need to set environment variables for the Pages Functions:

1. Go to your Pages project > **Settings** > **Environment variables**
2. Add for both Production and Preview:

| Variable | Value | Purpose |
|---|---|---|
| `ALLOWED_ORIGIN` | `https://yourdomain.com` | CORS origin for API requests |
| `ANALYTICS_KEY` | *(generate a random string)* | Bearer token for `/api/analytics` endpoint |
| `DISCORD_WEBHOOK` | *(your webhook URL)* | Discord notifications for visitor events |

---

## 3. Cloudflare Turnstile (optional)

Turnstile is Cloudflare's CAPTCHA alternative. It verifies that visitors are human without showing a puzzle. If not configured, bot verification is skipped entirely -- the chatbot and contact form still work, they just won't challenge bots.

### Create a Turnstile widget

1. In the Cloudflare dashboard, go to **Turnstile** in the left sidebar
2. Click **Add site**
3. Fill in:
   - **Site name:** Your site name (e.g. `My Portfolio`)
   - **Domain:** Your domain (e.g. `alexchen.dev`). Add `localhost` too for local development.
   - **Widget mode:** Select **Invisible** or **Interaction Only**

**Recommended mode:** `Interaction Only` -- this shows a brief, non-intrusive check only when Cloudflare suspects suspicious behavior. Most real visitors never see it.

4. Click **Create**
5. Copy the **Site Key** and **Secret Key**

### Add to your configuration

The **site key** goes in `cosmo.config.js` (it is public, sent to the browser):

```js
// In cosmo.config.js
turnstileSiteKey: '0x4AAAA...',
```

The **secret key** goes in your API server's `.env` (it is private, never exposed to the browser):

```bash
# In api/.env
TURNSTILE_SECRET=0x4AAAA-your-turnstile-secret-here
```

### How it works in Cosmo

- The chat widget and contact form both load the Turnstile script automatically when a site key is present
- On the first chat message or form submission, Turnstile generates a token client-side
- The API server verifies the token with Cloudflare's API before processing the request
- Once verified, the IP is cached for 1 hour (no re-verification needed per message)
- If `turnstileSiteKey` is empty in the config, all Turnstile logic is skipped

---

## 4. Cloudflare D1 (optional)

D1 is Cloudflare's serverless SQL database. Cosmo uses it to store visitor analytics data (geo, device, journey, chat engagement) collected by the Pages Functions at the edge. If not configured, visitor tracking events are still sent to Discord (if a webhook is set) but nothing is persisted.

### Create a D1 database

Using the Cloudflare CLI (`wrangler`):

```bash
# Install wrangler if you don't have it
npm install -g wrangler

# Authenticate
wrangler login

# Create the database
wrangler d1 create cosmo-analytics
```

This will output a database ID. Save it -- you need it for the binding.

### Create the schema

Run the following SQL against your D1 database:

```bash
wrangler d1 execute cosmo-analytics --command "
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT UNIQUE NOT NULL,
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  continent TEXT,
  latitude REAL,
  longitude REAL,
  postal_code TEXT,
  timezone_cf TEXT,
  asn INTEGER,
  isp TEXT,
  tls_version TEXT,
  http_protocol TEXT,
  browser TEXT,
  browser_version TEXT,
  os TEXT,
  device TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  viewport_width INTEGER,
  viewport_height INTEGER,
  language TEXT,
  timezone TEXT,
  dark_mode INTEGER DEFAULT 0,
  referrer TEXT,
  landing_page TEXT DEFAULT '/',
  is_bot INTEGER DEFAULT 0,
  journey TEXT,
  total_duration INTEGER DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  chat_opened INTEGER DEFAULT 0,
  chat_messages INTEGER DEFAULT 0,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME
);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);
CREATE INDEX idx_sessions_session_id ON sessions(session_id);
"
```

### Bind D1 to Pages Functions

1. In the Cloudflare dashboard, go to your Pages project
2. Navigate to **Settings** > **Functions** > **D1 database bindings**
3. Click **Add binding**
4. Set the variable name to `DB`
5. Select the `cosmo-analytics` database you just created
6. Save

### Set environment variables

In **Settings** > **Environment variables**, make sure these are set:

| Variable | Value | Purpose |
|---|---|---|
| `ANALYTICS_KEY` | *(random secret string)* | Auth for the `GET /api/analytics` query endpoint |
| `ALLOWED_ORIGIN` | `https://yourdomain.com` | CORS for tracking requests |
| `DISCORD_WEBHOOK` | *(your webhook URL)* | Optional -- visitor arrival/departure alerts |

### Query your analytics

Once data is flowing, query it via the analytics endpoint:

```bash
curl -s https://yourdomain.com/api/analytics \
  -H "Authorization: Bearer YOUR_ANALYTICS_KEY"
```

This returns session counts, unique visitors, average duration, chat engagement rates, top countries, top browsers, and recent sessions.

---

## 5. Mailgun (optional)

Mailgun handles outbound email. When someone submits the contact form, the AI generates a personalized reply and Mailgun delivers it to their inbox. Without Mailgun configured, the contact form still works -- it logs the message to Discord (if configured) and saves it to the local database, but no email reply is sent to the visitor.

Mailgun also powers:
- **Chat-to-email handoff:** After 5 chat messages, visitors can opt to receive a conversation summary via email and continue over email
- **Inbound email replies:** Visitors can reply to the AI's email, and Cosmo responds with context from the conversation history

### Create an account

1. Go to [mailgun.com](https://www.mailgun.com) and sign up
2. The free tier allows 100 emails/day for the first month, then moves to a pay-as-you-go plan
3. Add a payment method to unlock sending to any email address (sandbox mode is restricted to verified recipients only)

### Add and verify a domain

1. In the Mailgun dashboard, go to **Sending** > **Domains**
2. Click **Add New Domain**
3. Enter a subdomain like `mg.yourdomain.com` (using a subdomain keeps your root domain's email reputation clean)
4. Mailgun will show you DNS records to add

### Configure DNS records

Add these records at your DNS provider (Cloudflare, in most cases):

| Type | Name | Value | Purpose |
|---|---|---|---|
| TXT | `mg.yourdomain.com` | `v=spf1 include:mailgun.org ~all` | SPF -- authorizes Mailgun to send |
| TXT | `smtp._domainkey.mg.yourdomain.com` | *(Mailgun provides this)* | DKIM -- email signing |
| CNAME | `email.mg.yourdomain.com` | `mailgun.org` | Tracking (optional) |
| MX | `mg.yourdomain.com` | `mxa.mailgun.org` (priority 10) | Inbound email routing |
| MX | `mg.yourdomain.com` | `mxb.mailgun.org` (priority 10) | Inbound email routing (backup) |

> **Important:** If using Cloudflare DNS, set the CNAME record to **DNS only** (gray cloud), not proxied. MX and TXT records cannot be proxied.

5. Click **Verify DNS Settings** in Mailgun and wait for verification (can take a few minutes to a few hours)

### Get your API key

1. Go to **API Keys** in the Mailgun dashboard (under your account settings, top-right)
2. Copy your **Private API key**

### Configure inbound email (for reply handling)

If you want visitors to be able to reply to the AI's emails and get responses:

1. Go to **Receiving** > **Routes** in Mailgun
2. Create a new route:
   - **Expression type:** Match Recipient
   - **Recipient:** `ai@mg.yourdomain.com` (or whatever address you want the AI to send from)
   - **Action:** Forward to `https://api.yourdomain.com/api/email-webhook`
   - **Priority:** 0
3. Save the route

### Add to your environment

```bash
# In api/.env
MAILGUN_API_KEY=your-mailgun-private-api-key
MAILGUN_DOMAIN=mg.yourdomain.com
OWNER_EMAIL=you@yourdomain.com
```

The `OWNER_EMAIL` is used as the reply-to address and for Discord notifications. Emails are sent from `BotName <ai@mg.yourdomain.com>` where `BotName` comes from `cosmo.config.js`.

---

## 6. Discord Webhook (optional)

Discord webhooks send real-time notifications to a channel. Cosmo uses them for:

- **New visitor alerts** -- when someone first messages the chatbot
- **Chat transcripts** -- every Q&A pair with token counts and costs
- **Injection attempts** -- when someone tries to manipulate the AI
- **Contact form submissions** -- name, email, message, and AI reply
- **Visitor arrivals and departures** -- rich embeds with geo, device, and journey data (via Pages Functions)

Without a webhook configured, all of this is silently skipped.

### Create a webhook

1. Open Discord and go to the server where you want notifications
2. Right-click the target channel > **Edit Channel** (or click the gear icon)
3. Go to **Integrations** > **Webhooks**
4. Click **New Webhook**
5. Name it (e.g. `Cosmo`) and optionally set an avatar
6. Click **Copy Webhook URL**

The URL looks like: `https://discord.com/api/webhooks/1234567890/abcdefg...`

### Add to your environment

```bash
# In api/.env (for chatbot notifications)
DISCORD_WEBHOOK=https://discord.com/api/webhooks/your-webhook-url
```

The same webhook URL should also be set in Cloudflare Pages environment variables if you are using D1 analytics (see section 4). You can use the same webhook for both, or create separate webhooks for separate channels.

---

## 7. VPS Setup

The API server runs on a VPS (Virtual Private Server). Any Linux VPS provider works -- DigitalOcean, Linode, Hetzner, Vultr, etc. A $4-6/month instance is sufficient.

### Provision a server

1. Create a new server with your preferred provider:
   - **OS:** Ubuntu 22.04 or Debian 12 (LTS recommended)
   - **Size:** 1 CPU, 1GB RAM, 25GB disk is plenty
   - **Region:** Choose one close to your expected audience
2. Set up SSH key authentication during creation
3. Note the server's public IP address

### Initial server setup

SSH into your new server:

```bash
ssh root@YOUR_SERVER_IP
```

Update packages and set up a non-root user (optional but recommended):

```bash
apt update && apt upgrade -y
```

### Install Node.js

Install Node.js 18 or later:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version  # should show v20.x
```

### Clone the repo and install

```bash
cd /opt
git clone https://github.com/PureGrain/cosmo.git
cd cosmo/api
npm install --production
```

### Create the environment file

```bash
cp .env.example .env
nano .env
```

Fill in your values:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
ALLOWED_ORIGIN=https://yourdomain.com

# Optional
# MODEL=claude-sonnet-4-20250514
# ADMIN_KEY=your-secret-admin-key
# TURNSTILE_SECRET=0x4AAAA-your-turnstile-secret
# DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
# MAILGUN_API_KEY=your-mailgun-key
# MAILGUN_DOMAIN=mg.yourdomain.com
# OWNER_EMAIL=you@yourdomain.com
# DAILY_CONV_LIMIT=5
# DAILY_SPEND_LIMIT=1.00
# PORT=3001
```

### Test the server

```bash
cd /opt/cosmo/api
node server.js
```

You should see: `Nova API running on port 3001` (where `Nova` is whatever `botName` is set to in `cosmo.config.js`).

Test the health endpoint from another terminal:

```bash
curl http://localhost:3001/health
# {"status":"ok","timestamp":"..."}
```

### Set up systemd (run on boot)

Create a systemd service so the API starts automatically and restarts on crash:

```bash
cat > /etc/systemd/system/cosmo.service << 'EOF'
[Unit]
Description=Cosmo API Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/cosmo/api
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/cosmo/api/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cosmo
systemctl start cosmo
systemctl status cosmo
```

### Firewall setup

Lock down the server so only Cloudflare can reach ports 80/443, while SSH remains open to you:

```bash
# The repo includes a script for this
bash /opt/cosmo/scripts/cloudflare-firewall.sh
```

This script configures `ufw` to:
1. Allow SSH from anywhere
2. Allow HTTP/HTTPS only from Cloudflare IP ranges
3. Deny everything else

> **Important:** Always ensure SSH access is allowed before enabling the firewall. The script handles this, but double-check.

---

## 8. Domain & DNS

Your domain needs to point to Cloudflare nameservers so Pages can serve the frontend and the API can be proxied through Cloudflare.

### Move your domain to Cloudflare DNS

1. In the Cloudflare dashboard, click **Add a site**
2. Enter your domain (e.g. `alexchen.dev`)
3. Select the **Free** plan
4. Cloudflare will scan existing DNS records
5. Update your domain registrar's nameservers to the ones Cloudflare provides (e.g. `aria.ns.cloudflare.com` and `bruce.ns.cloudflare.com`)
6. Wait for propagation (can take up to 24 hours, usually much faster)

### Configure DNS records

Add an A record for the API subdomain:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| A | `api` | `YOUR_VPS_IP` | **Proxied** (orange cloud) |

The orange cloud means traffic goes through Cloudflare's network, which provides:
- DDoS protection
- SSL termination
- The ability to use the Cloudflare firewall script on your VPS (only Cloudflare IPs reach your server)

Your Pages project handles the root domain (`yourdomain.com`) automatically if you set up a custom domain in section 2.

### Update cosmo.config.js

Set the API URL to your production API subdomain:

```js
// In cosmo.config.js
apiUrl: 'https://api.yourdomain.com',
```

### Update the API's ALLOWED_ORIGIN

```bash
# In api/.env
ALLOWED_ORIGIN=https://yourdomain.com
```

If you need multiple origins (e.g. both `www` and apex domain), separate them with commas:

```bash
ALLOWED_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
```

---

## 9. SSL/TLS

The API subdomain needs HTTPS. Since traffic is proxied through Cloudflare, you have two layers of encryption to configure:

1. **Browser to Cloudflare** -- handled automatically by Cloudflare
2. **Cloudflare to your VPS** -- requires a certificate on your server

### Set Cloudflare SSL mode

1. In the Cloudflare dashboard, go to **SSL/TLS** > **Overview**
2. Set the encryption mode to **Full (strict)**

This requires a valid certificate on your origin server. Cloudflare provides free origin certificates for this purpose.

### Option A: Cloudflare Origin Certificate (recommended)

This is the simplest option since you are already using Cloudflare:

1. Go to **SSL/TLS** > **Origin Server** in the Cloudflare dashboard
2. Click **Create Certificate**
3. Keep the defaults (RSA 2048, 15-year expiry, covers `*.yourdomain.com` and `yourdomain.com`)
4. Click **Create**
5. Copy the **Origin Certificate** and **Private Key**

On your VPS:

```bash
mkdir -p /etc/ssl/cosmo

# Paste the origin certificate
nano /etc/ssl/cosmo/origin.pem

# Paste the private key
nano /etc/ssl/cosmo/origin-key.pem

# Secure the key
chmod 600 /etc/ssl/cosmo/origin-key.pem
```

### Option B: Let's Encrypt with certbot

If you prefer a publicly trusted certificate (e.g. for direct access without Cloudflare):

```bash
apt install -y certbot
```

> **Note:** For certbot's HTTP challenge to work, you need to temporarily pause Cloudflare proxying (set the A record to DNS only / gray cloud) or use the DNS challenge instead.

Using DNS challenge with Cloudflare (no need to pause proxying):

```bash
apt install -y python3-certbot-dns-cloudflare

# Create Cloudflare API credentials file
mkdir -p /root/.secrets
cat > /root/.secrets/cloudflare.ini << 'EOF'
dns_cloudflare_api_token = YOUR_CLOUDFLARE_API_TOKEN
EOF
chmod 600 /root/.secrets/cloudflare.ini

# Get the certificate
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d api.yourdomain.com

# Certificates are saved to /etc/letsencrypt/live/api.yourdomain.com/
```

Certbot sets up automatic renewal via a systemd timer. Verify it:

```bash
certbot renew --dry-run
```

### Install and configure Nginx

Nginx acts as a reverse proxy, terminating SSL and forwarding requests to the Node.js API on port 3001:

```bash
apt install -y nginx
```

Create the Nginx configuration:

```bash
cat > /etc/nginx/sites-available/cosmo << 'NGINX'
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # --- Choose ONE certificate source ---

    # Option A: Cloudflare Origin Certificate
    ssl_certificate     /etc/ssl/cosmo/origin.pem;
    ssl_certificate_key /etc/ssl/cosmo/origin-key.pem;

    # Option B: Let's Encrypt
    # ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # --- SSL settings ---
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # --- Reverse proxy to Cosmo API ---
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support (chat streaming)
        proxy_set_header Connection '';
        proxy_cache off;
        proxy_buffering off;
        chunked_transfer_encoding on;
    }
}
NGINX
```

Enable the site and restart Nginx:

```bash
ln -sf /etc/nginx/sites-available/cosmo /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t          # test configuration
systemctl restart nginx
systemctl enable nginx
```

### Verify everything works

From your local machine:

```bash
curl https://api.yourdomain.com/health
# {"status":"ok","timestamp":"..."}
```

---

## Summary Checklist

After completing the steps above, verify each piece:

- [ ] `curl https://api.yourdomain.com/health` returns `{"status":"ok"}`
- [ ] Frontend loads at `https://yourdomain.com`
- [ ] Chat widget opens, sends a message, and gets a streamed response
- [ ] Contact form submits without errors
- [ ] (If Turnstile configured) Bot verification passes silently
- [ ] (If Discord configured) New visitor and chat messages appear in your Discord channel
- [ ] (If Mailgun configured) Contact form submission sends an email reply
- [ ] (If D1 configured) `GET /api/analytics` returns session data

## Environment Variable Reference

### API Server (`api/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | -- | Your Anthropic API key |
| `ALLOWED_ORIGIN` | **Yes** | `http://localhost:8080` | Frontend origin for CORS |
| `MODEL` | No | `claude-sonnet-4-20250514` | Claude model ID |
| `PORT` | No | `3001` | API server port |
| `ADMIN_KEY` | No | -- | Secret for `/admin/stats` endpoint |
| `TURNSTILE_SECRET` | No | -- | Cloudflare Turnstile secret key |
| `DISCORD_WEBHOOK` | No | -- | Discord webhook URL |
| `MAILGUN_API_KEY` | No | -- | Mailgun private API key |
| `MAILGUN_DOMAIN` | No | -- | Mailgun sending domain |
| `OWNER_EMAIL` | No | -- | Your email (for reply-to and notifications) |
| `DAILY_CONV_LIMIT` | No | `5` | Max conversations per IP per day |
| `DAILY_SPEND_LIMIT` | No | `1.00` | Max API spend in USD per day |

### Cloudflare Pages (Environment Variables)

| Variable | Required | Description |
|---|---|---|
| `ALLOWED_ORIGIN` | If using D1 | Frontend origin for CORS |
| `ANALYTICS_KEY` | If using D1 | Bearer token for analytics query endpoint |
| `DISCORD_WEBHOOK` | No | Webhook URL for visitor event embeds |

### Cloudflare Pages (Bindings)

| Binding | Type | Name | Description |
|---|---|---|---|
| D1 Database | D1 | `DB` | The `cosmo-analytics` database |

### Frontend Config (`cosmo.config.js`)

| Property | Description |
|---|---|
| `apiUrl` | Full URL to your API server (e.g. `https://api.yourdomain.com`) |
| `turnstileSiteKey` | Cloudflare Turnstile site key (leave empty to skip verification) |
