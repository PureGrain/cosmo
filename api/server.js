// Cosmo API server — AI portfolio chatbot
// https://github.com/PureGrain/cosmo
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const Database = require('better-sqlite3');
const Busboy = require('busboy');

const config = require('../cosmo.config.js');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── KNOWLEDGE BASE ────────────────────────────────────────────────────────
const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');
function loadKnowledge(filename) {
  try {
    return fs.readFileSync(path.join(KNOWLEDGE_DIR, filename), 'utf8');
  } catch (e) {
    console.error(`[knowledge] Failed to load ${filename}:`, e.message);
    return '';
  }
}
const RESUME_KNOWLEDGE = loadKnowledge('resume.md');

// ─── PROMPT TEMPLATES ──────────────────────────────────────────────────────
const PROMPTS_DIR = path.join(__dirname, 'prompts');
function loadPrompt(filename) {
  try {
    return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf8');
  } catch (e) {
    console.error(`[prompts] Failed to load ${filename}:`, e.message);
    return '';
  }
}

function interpolate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

function buildProjectSection(projects) {
  if (!projects || projects.length === 0) return 'No projects configured.';
  return projects.map(p => {
    let section = `### ${p.name} — ${p.tagline}\n${p.description}\n`;
    if (p.details && p.details.length > 0) {
      section += '\n**Key technical details:**\n';
      section += p.details.map(d => `- ${d.replace(/<[^>]+>/g, '')}`).join('\n');
    }
    return section;
  }).join('\n\n');
}

function buildServicesSection(services) {
  if (!services || services.length === 0) return 'No services configured.';
  return services.map(s => `- **${s.title}:** ${s.description}`).join('\n');
}

const templateVars = {
  BOT_NAME: config.botName || 'Cosmo',
  OWNER_NAME: config.name || 'the site owner',
  WEBSITE: config.website || 'this website',
  RESUME: RESUME_KNOWLEDGE,
  PROJECTS: buildProjectSection(config.projects),
  SERVICES: buildServicesSection(config.services),
};

const systemTemplate = loadPrompt('system.md');
const SYSTEM_PROMPT = interpolate(systemTemplate, templateVars);

const emailTemplate = loadPrompt('email.md');
const EMAIL_ADDON = interpolate(emailTemplate, templateVars);
const EMAIL_SYSTEM_PROMPT = SYSTEM_PROMPT + '\n\n' + EMAIL_ADDON;

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const MODEL = process.env.MODEL || 'claude-sonnet-4-20250514';
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 10;
const GLOBAL_MESSAGE_CAP = parseInt(process.env.MESSAGE_CAP || '5000', 10);
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
const BOT_NAME = config.botName || 'Cosmo';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || config.website || 'http://localhost:8080').split(',').map(s => s.trim());
const SESSION_MSG_LIMIT = 20;
const DAILY_CONV_LIMIT = 5;
const MAX_BODY_SIZE = 50 * 1024; // 50KB
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const DAILY_SPEND_CAP = parseFloat(process.env.DAILY_SPEND_CAP || '5'); // $5/day default
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY || '';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN || '';
const CONTACT_DAILY_LIMIT = 3;
const EMAIL_DAILY_LIMIT = 10;

// ─── HONEYPOT PATTERNS ──────────────────────────────────────────────────────
const honeypotFile = loadPrompt('honeypot.txt');
const INJECTION_PATTERNS = honeypotFile
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
  .map(pattern => new RegExp(pattern, 'i'));

function isInjectionAttempt(text) {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

const deflectionTemplate = loadPrompt('deflection.txt');
const DEFLECTION_RESPONSE = interpolate(deflectionTemplate, templateVars);

// Rate limiting
const rateLimits = new Map();

// Verified IPs — once Turnstile passes, skip re-verification for 1 hour
const verifiedIps = new Map();
function isIpVerified(ip) {
  const ts = verifiedIps.get(ip);
  if (!ts) return false;
  if (Date.now() - ts > 3600000) { verifiedIps.delete(ip); return false; }
  return true;
}
function markIpVerified(ip) { verifiedIps.set(ip, Date.now()); }

// ─── DATABASE ───────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'cosmo.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    ip TEXT,
    user_message TEXT,
    assistant_message TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    ip TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    message_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    event_type TEXT,
    detail TEXT
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    messages TEXT DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS daily_conversations (
    ip TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    PRIMARY KEY (ip, date)
  );
  CREATE TABLE IF NOT EXISTS email_conversations (
    sender TEXT PRIMARY KEY,
    messages TEXT DEFAULT '[]',
    message_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS email_daily (
    email TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    PRIMARY KEY (email, date)
  );
`);

const stmtInsertChat = db.prepare(`INSERT INTO chat_log (ip, user_message, assistant_message, input_tokens, output_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)`);
const stmtUpsertSession = db.prepare(`INSERT INTO sessions (ip, message_count) VALUES (?, 1) ON CONFLICT(ip) DO UPDATE SET message_count = message_count + 1`);
const stmtGetSession = db.prepare(`SELECT * FROM sessions WHERE ip = ?`);
const stmtInsertEvent = db.prepare(`INSERT INTO events (event_type, detail) VALUES (?, ?)`);
const stmtGetGlobalCount = db.prepare(`SELECT COUNT(*) as cnt FROM chat_log`);
const stmtUpsertDaily = db.prepare(`INSERT INTO daily_conversations (ip, date) VALUES (?, date('now')) ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`);
const stmtGetDaily = db.prepare(`SELECT count FROM daily_conversations WHERE ip = ? AND date = date('now')`);

// Cost estimation (Sonnet pricing: $3/M input, $15/M output)
function estimateCost(inputTokens, outputTokens) {
  return (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
}

function getGlobalCount() {
  return stmtGetGlobalCount.get().cnt;
}

function checkDailyLimit(ip) {
  const row = stmtGetDaily.get(ip);
  return !row || row.count < DAILY_CONV_LIMIT;
}

function incrementDailyCount(ip) {
  stmtUpsertDaily.run(ip);
}

async function sendDiscordNotification(message) {
  if (!DISCORD_WEBHOOK) return;
  try {
    const payload = JSON.stringify({ content: message });
    const url = new URL(DISCORD_WEBHOOK);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    await new Promise((resolve, reject) => {
      const r = https.request(options, resolve);
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
  } catch (err) {
    console.error('Discord webhook error:', err.message);
  }
}

function trackSession(ip) {
  const existing = stmtGetSession.get(ip);
  const isNew = !existing;
  stmtUpsertSession.run(ip);
  if (isNew) {
    stmtInsertEvent.run('new_visitor', ip);
    sendDiscordNotification(`**${BOT_NAME}** New visitor from \`${ip}\` at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  }
  return stmtGetSession.get(ip);
}

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW;
  }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── TURNSTILE VERIFICATION ─────────────────────────────────────────────────
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true; // Skip if not configured
  if (!token) return false;
  try {
    const payload = JSON.stringify({ secret: TURNSTILE_SECRET, response: token, remoteip: ip });
    return new Promise((resolve) => {
      const r = https.request({
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v0/siteverify',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body).success === true); }
          catch { resolve(false); }
        });
      });
      r.on('error', () => resolve(false));
      r.write(payload);
      r.end();
    });
  } catch { return false; }
}

// ─── DAILY SPEND CAP ────────────────────────────────────────────────────────
function getTodaySpend() {
  const row = db.prepare(`SELECT COALESCE(SUM(cost), 0) as total FROM chat_log WHERE timestamp >= date('now')`).get();
  return row.total;
}

// ─── CLIENT IP (Cloudflare-aware) ───────────────────────────────────────────
function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']
    || req.socket.remoteAddress;
}

// ─── CORS ───────────────────────────────────────────────────────────────────
function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

// ─── READ BODY WITH SIZE LIMIT ──────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── EMAIL HELPERS ──────────────────────────────────────────────────────────

function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    let processed = line
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:13px">$1</code>');
    const trimmed = processed.trim();
    if (trimmed.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3 style="margin:16px 0 8px;font-size:16px">${trimmed.slice(4)}</h3>`;
    } else if (trimmed.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 style="margin:16px 0 8px;font-size:18px">${trimmed.slice(3)}</h2>`;
    } else if (/^[-*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      if (!inList) { html += '<ul style="margin:8px 0;padding-left:20px">'; inList = true; }
      const content = trimmed.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');
      html += `<li style="margin-bottom:4px">${content}</li>`;
    } else if (trimmed === '') {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<br>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p style="margin:8px 0;line-height:1.6">${processed}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#333;max-width:600px">${html}</div>`;
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const bb = Busboy({ headers: req.headers });
    bb.on('field', (name, val) => { fields[name] = val; });
    bb.on('close', () => resolve(fields));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

const INSPIRATIONAL_QUOTES = [
  '"The best way to predict the future is to invent it." \u2014 Alan Kay',
  '"Stay hungry, stay foolish." \u2014 Steve Jobs',
  '"Simplicity is the ultimate sophistication." \u2014 Leonardo da Vinci',
  '"First, solve the problem. Then, write the code." \u2014 John Johnson',
  '"Talk is cheap. Show me the code." \u2014 Linus Torvalds',
  '"Make it work, make it right, make it fast." \u2014 Kent Beck',
  '"Any sufficiently advanced technology is indistinguishable from magic." \u2014 Arthur C. Clarke',
  '"The best error message is the one that never shows up." \u2014 Thomas Fuchs',
  '"Code is like humor. When you have to explain it, it\'s bad." \u2014 Cory House',
  '"Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away." \u2014 Antoine de Saint-Exup\u00E9ry',
];

function getEmailSignature() {
  const quote = INSPIRATIONAL_QUOTES[Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length)];
  return `\n\n---\n${BOT_NAME} \u2014 AI Ambassador for ${config.website || 'this site'}\n${quote}`;
}

async function sendMailgunReply(to, subject, text, headers) {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.error('MAILGUN_API_KEY or MAILGUN_DOMAIN not set \u2014 cannot send email');
    return;
  }
  const auth = Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64');
  const params = new URLSearchParams({
    from: `${BOT_NAME} <ai@${MAILGUN_DOMAIN}>`,
    to,
    subject,
    text,
    html: markdownToHtml(text),
  });
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      params.append(`h:${k}`, v);
    }
  }
  const payload = params.toString();

  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'api.mailgun.net',
      path: `/v3/${MAILGUN_DOMAIN}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`Mailgun ${res.statusCode}: ${body}`));
      });
    });
    r.on('error', reject);
    r.write(payload);
    r.end();
  });
}

function getEmailConversation(sender) {
  const row = db.prepare('SELECT * FROM email_conversations WHERE sender = ?').get(sender);
  if (row) return { messages: JSON.parse(row.messages), count: row.message_count };
  return { messages: [], count: 0 };
}

function saveEmailConversation(sender, messages, count) {
  db.prepare(`INSERT INTO email_conversations (sender, messages, message_count) VALUES (?, ?, ?)
    ON CONFLICT(sender) DO UPDATE SET messages = ?, message_count = ?, updated_at = datetime('now')`)
    .run(sender, JSON.stringify(messages), count, JSON.stringify(messages), count);
}

function checkEmailDailyLimit(email, limit) {
  const row = db.prepare(`SELECT count FROM email_daily WHERE email = ? AND date = date('now')`).get(email);
  return !row || row.count < limit;
}

function incrementEmailDaily(email) {
  db.prepare(`INSERT INTO email_daily (email, date) VALUES (?, date('now'))
    ON CONFLICT(email, date) DO UPDATE SET count = count + 1`).run(email);
}

// ─── SERVER ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // Public stats
  if (req.method === 'GET' && req.url === '/api/public-stats') {
    const msgCount = getGlobalCount();
    const costRow = db.prepare(`SELECT COALESCE(SUM(cost),0) as total, COALESCE(SUM(input_tokens),0) as inp, COALESCE(SUM(output_tokens),0) as outp FROM chat_log`).get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      messages: msgCount,
      remaining: GLOBAL_MESSAGE_CAP - msgCount,
      totalCost: `$${costRow.total.toFixed(4)}`,
      totalTokens: costRow.inp + costRow.outp,
      inputTokens: costRow.inp,
      outputTokens: costRow.outp,
    }));
    return;
  }

  // Admin stats
  if (req.method === 'GET' && req.url === '/admin/stats') {
    const authHeader = req.headers.authorization || '';
    if (!ADMIN_KEY || authHeader !== `Bearer ${ADMIN_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const msgCount = getGlobalCount();
    const costRow = db.prepare(`SELECT COALESCE(SUM(cost),0) as total, COALESCE(SUM(input_tokens),0) as inp, COALESCE(SUM(output_tokens),0) as outp FROM chat_log`).get();
    const sessionList = db.prepare(`SELECT * FROM sessions ORDER BY first_seen DESC`).all();
    const recentMessages = db.prepare(`SELECT * FROM chat_log ORDER BY id DESC LIMIT 20`).all().reverse();
    const fullHistory = db.prepare(`SELECT * FROM chat_log ORDER BY id ASC`).all();
    const events = db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT 50`).all();

    const stats = {
      status: 'ok',
      usage: {
        globalMessages: `${msgCount}/${GLOBAL_MESSAGE_CAP}`,
        remaining: GLOBAL_MESSAGE_CAP - msgCount,
        totalCost: `$${costRow.total.toFixed(4)}`,
        totalInputTokens: costRow.inp,
        totalOutputTokens: costRow.outp,
      },
      visitors: {
        unique: sessionList.length,
        sessions: sessionList,
      },
      recentMessages: recentMessages.map(e => ({
        time: e.timestamp,
        ip: e.ip,
        user: (e.user_message || '').slice(0, 100),
        assistant: (e.assistant_message || '').slice(0, 150),
        tokens: { input: e.input_tokens, output: e.output_tokens },
        cost: `$${(e.cost || 0).toFixed(4)}`,
      })),
      fullHistory: fullHistory.map(e => ({
        time: e.timestamp,
        ip: e.ip,
        user: e.user_message,
        assistant: e.assistant_message,
        tokens: { input: e.input_tokens, output: e.output_tokens },
        cost: `$${(e.cost || 0).toFixed(4)}`,
      })),
      events,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  // Save conversation
  if (req.method === 'POST' && req.url === '/api/conversation') {
    let body;
    try { body = await readBody(req); } catch { res.writeHead(400); res.end(); return; }
    const { id, messages: msgs } = body;
    if (!id || !msgs) { res.writeHead(400); res.end(); return; }
    const ip = getClientIp(req);
    db.prepare(`INSERT INTO conversations (id, ip, messages) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET messages = ?, updated_at = datetime('now')`)
      .run(id, ip, JSON.stringify(msgs), JSON.stringify(msgs));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Load conversation
  if (req.method === 'GET' && req.url.startsWith('/api/conversation/')) {
    const id = req.url.split('/api/conversation/')[1];
    const row = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: row.id, messages: JSON.parse(row.messages), createdAt: row.created_at }));
    return;
  }

  // Chat endpoint
  if (req.method === 'POST' && req.url === '/api/chat') {
    const ip = getClientIp(req);

    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Please slow down.' }));
      return;
    }

    if (!checkDailyLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Daily conversation limit reached. Please come back tomorrow.' }));
      return;
    }

    const currentCount = getGlobalCount();
    if (currentCount >= GLOBAL_MESSAGE_CAP) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'This assistant has reached its message limit. Please try again later.' })}\n\n`);
      res.end();
      return;
    }

    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      const status = err.message === 'Request body too large' ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    const { messages, turnstileToken } = body;
    if (!messages || !Array.isArray(messages)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Messages array required' }));
      return;
    }

    // Turnstile verification
    if (!isIpVerified(ip)) {
      const turnstileOk = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileOk) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Verification failed. Please refresh and try again.' }));
        stmtInsertEvent.run('turnstile_fail', ip);
        return;
      }
      markIpVerified(ip);
    }

    // Daily spend cap
    if (getTodaySpend() >= DAILY_SPEND_CAP) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'The bot is taking a break. Please try again tomorrow.' })}\n\n`);
      res.end();
      stmtInsertEvent.run('daily_cap_hit', `$${getTodaySpend().toFixed(4)}`);
      return;
    }

    // Input validation
    const lastMsg = messages[messages.length - 1]?.content || '';
    if (!lastMsg.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Message cannot be empty' }));
      return;
    }

    if (lastMsg.length > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Message too long (2000 character limit)' }));
      return;
    }

    // Honeypot injection detection
    if (isInjectionAttempt(lastMsg)) {
      stmtInsertEvent.run('injection_attempt', `${ip}: ${lastMsg.slice(0, 200)}`);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const chunkSize = 6;
      for (let i = 0; i < DEFLECTION_RESPONSE.length; i += chunkSize) {
        res.write(`data: ${JSON.stringify({ type: 'text', text: DEFLECTION_RESPONSE.slice(i, i + chunkSize) })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();

      stmtInsertChat.run(ip, lastMsg, DEFLECTION_RESPONSE, 0, 0, 0);
      sendDiscordNotification(
        `**${BOT_NAME}** Injection blocked from \`${ip}\`\n**Attempt:** ${lastMsg.slice(0, 200)}`
      );
      return;
    }

    const trimmedMessages = messages.slice(-20);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let aborted = false;
    req.on('close', () => { aborted = true; });

    trackSession(ip);
    incrementDailyCount(ip);
    const userMsg = trimmedMessages[trimmedMessages.length - 1]?.content || '';

    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: trimmedMessages,
      });

      const text = response.content[0].text;
      const inputTokens = response.usage?.input_tokens || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      const cost = estimateCost(inputTokens, outputTokens);

      stmtInsertChat.run(ip, userMsg, text, inputTokens, outputTokens, cost);
      const count = getGlobalCount();
      console.log(`[cosmo] Message ${count}/${GLOBAL_MESSAGE_CAP} | tokens: ${inputTokens}+${outputTokens} | cost: $${cost.toFixed(4)}`);

      const truncatedQ = userMsg.length > 200 ? userMsg.slice(0, 200) + '...' : userMsg;
      const truncatedA = text.length > 300 ? text.slice(0, 300) + '...' : text;
      const totalCostSoFar = db.prepare(`SELECT COALESCE(SUM(cost),0) as t FROM chat_log`).get().t;
      sendDiscordNotification(
        `**${BOT_NAME}** [${count}/${GLOBAL_MESSAGE_CAP}] | $${totalCostSoFar.toFixed(4)} total\n` +
        `**Q:** ${truncatedQ}\n` +
        `**A:** ${truncatedA}\n` +
        `_${inputTokens}+${outputTokens} tokens | $${cost.toFixed(4)}_`
      );

      if (!aborted) {
        const chunkSize = 6;
        for (let i = 0; i < text.length; i += chunkSize) {
          if (aborted) break;
          res.write(`data: ${JSON.stringify({ type: 'text', text: text.slice(i, i + chunkSize) })}\n\n`);
        }
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();
        }
      }
    } catch (err) {
      console.error('Chat error:', err.message);
      stmtInsertEvent.run('error', err.message);
      if (!aborted) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Something went wrong. Please try again.' })}\n\n`);
          res.end();
        } catch {}
      }
    }
    return;
  }

  // ─── CONTACT FORM ────────────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/contact') {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Please slow down.' }));
      return;
    }

    let body;
    try { body = await readBody(req); } catch (err) {
      const status = err.message === 'Request body too large' ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    const { name, email, message, turnstileToken } = body;
    if (!name || !email || !message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Name, email, and message are required.' }));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid email address.' }));
      return;
    }
    if (message.length > 2000) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Message too long (2000 character limit).' }));
      return;
    }

    // Turnstile verification
    if (!isIpVerified(ip)) {
      const turnstileOk = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileOk) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Verification failed. Please refresh and try again.' }));
        return;
      }
      markIpVerified(ip);
    }

    if (!checkEmailDailyLimit(email, CONTACT_DAILY_LIMIT)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Daily contact limit reached. Check your inbox for previous replies.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));

    try {
      incrementEmailDaily(email);
      const conv = getEmailConversation(email);
      conv.messages.push({ role: 'user', content: `[Contact form from ${name}]: ${message}` });

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: EMAIL_SYSTEM_PROMPT,
        messages: conv.messages.slice(-20),
      });

      const replyText = response.content[0].text;
      conv.messages.push({ role: 'assistant', content: replyText });
      saveEmailConversation(email, conv.messages, conv.count + 1);

      const messageId = `<contact-${Date.now()}@${MAILGUN_DOMAIN}>`;
      await sendMailgunReply(email, `Re: Contact from ${config.website || 'our site'}`, replyText + getEmailSignature(), { 'Message-Id': messageId });

      const cost = estimateCost(response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);
      stmtInsertChat.run(ip, `[CONTACT] ${name} <${email}>: ${message}`, replyText, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0, cost);
      sendDiscordNotification(
        `**${BOT_NAME}** Contact form from **${name}** <${email}>\n**Message:** ${message.slice(0, 300)}\n**AI Reply:** ${replyText.slice(0, 300)}`
      );
    } catch (err) {
      console.error('Contact form error:', err.message);
      stmtInsertEvent.run('error', `contact: ${err.message}`);
    }
    return;
  }

  // ─── CHAT-TO-EMAIL HANDOFF ─────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/chat-handoff') {
    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many requests. Please slow down.' }));
      return;
    }

    let body;
    try { body = await readBody(req); } catch (err) {
      const status = err.message === 'Request body too large' ? 413 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    const { email, messages: chatMessages, turnstileToken } = body;
    if (!email || !chatMessages || !Array.isArray(chatMessages)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email and messages are required.' }));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid email address.' }));
      return;
    }

    if (!isIpVerified(ip)) {
      const turnstileOk = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileOk) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Verification failed. Please refresh and try again.' }));
        return;
      }
      markIpVerified(ip);
    }

    if (!checkEmailDailyLimit(email, CONTACT_DAILY_LIMIT)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Daily limit reached. Check your inbox.' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));

    try {
      incrementEmailDaily(email);

      const summaryResponse = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: `Summarize this chat conversation between a visitor and ${config.name || 'the site owner'}'s AI assistant. Write it as a friendly email that recaps the key points discussed. End with an invitation to reply to continue the conversation. Sign off as "${BOT_NAME}".`,
        messages: [{ role: 'user', content: chatMessages.map(m => `${m.role === 'user' ? 'Visitor' : 'AI'}: ${m.content}`).join('\n\n') }],
      });

      const summaryText = summaryResponse.content[0].text;

      saveEmailConversation(email, chatMessages, chatMessages.filter(m => m.role === 'user').length);

      const messageId = `<handoff-${Date.now()}@${MAILGUN_DOMAIN}>`;
      await sendMailgunReply(email, `Your conversation with ${BOT_NAME}`, summaryText + getEmailSignature(), { 'Message-Id': messageId });

      const cost = estimateCost(summaryResponse.usage?.input_tokens || 0, summaryResponse.usage?.output_tokens || 0);
      stmtInsertChat.run(ip, `[HANDOFF] ${email}`, summaryText, summaryResponse.usage?.input_tokens || 0, summaryResponse.usage?.output_tokens || 0, cost);
      sendDiscordNotification(
        `**${BOT_NAME}** Chat handoff to email: **${email}**\n**Chat messages:** ${chatMessages.length}\n**Summary:** ${summaryText.slice(0, 300)}`
      );
    } catch (err) {
      console.error('Chat handoff error:', err.message);
      stmtInsertEvent.run('error', `handoff: ${err.message}`);
    }
    return;
  }

  // ─── MAILGUN INBOUND WEBHOOK ───────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/email-webhook') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));

    try {
      const fields = await parseMultipart(req);
      const sender = (fields.sender || fields.from || '').replace(/.*<([^>]+)>.*/, '$1').trim().toLowerCase();
      const subject = fields.subject || 'No subject';
      const body = fields['stripped-text'] || fields['body-plain'] || '';

      if (!sender || !body.trim()) return;

      if (!checkEmailDailyLimit(sender, EMAIL_DAILY_LIMIT)) {
        console.log(`[email] Daily limit hit for ${sender}`);
        return;
      }
      incrementEmailDaily(sender);

      const conv = getEmailConversation(sender);
      conv.messages.push({ role: 'user', content: body });

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: EMAIL_SYSTEM_PROMPT,
        messages: conv.messages.slice(-20),
      });

      const replyText = response.content[0].text;
      conv.messages.push({ role: 'assistant', content: replyText });
      saveEmailConversation(sender, conv.messages, conv.count + 1);

      const messageId = `<reply-${Date.now()}@${MAILGUN_DOMAIN}>`;
      const inReplyTo = fields['Message-Id'] || fields['message-id'] || '';
      const replyHeaders = { 'Message-Id': messageId };
      if (inReplyTo) {
        replyHeaders['In-Reply-To'] = inReplyTo;
        replyHeaders['References'] = inReplyTo;
      }

      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
      await sendMailgunReply(sender, replySubject, replyText + getEmailSignature(), replyHeaders);

      const cost = estimateCost(response.usage?.input_tokens || 0, response.usage?.output_tokens || 0);
      stmtInsertChat.run(sender, `[EMAIL] ${body.slice(0, 500)}`, replyText, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0, cost);
      sendDiscordNotification(
        `**${BOT_NAME}** Inbound email from **${sender}**\n**Subject:** ${subject}\n**Message:** ${body.slice(0, 200)}\n**AI Reply:** ${replyText.slice(0, 200)}`
      );
    } catch (err) {
      console.error('Email webhook error:', err.message);
      stmtInsertEvent.run('error', `email-webhook: ${err.message}`);
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`${BOT_NAME} API running on port ${PORT}`);
});
