// Cloudflare Pages Function: POST /api/track
// Receives analytics events from client JS, enriches with CF edge data, sends Discord embeds

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'http://localhost:8080',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json();

    if (!body.event || !body.sessionId) {
      return new Response(null, { status: 400, headers: corsHeaders });
    }

    // Enrich with Cloudflare edge data
    const cf = request.cf || {};
    const enriched = {
      ...body,
      ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown',
      geo: {
        country: cf.country || 'unknown',
        city: cf.city || 'unknown',
        region: cf.region || 'unknown',
        continent: cf.continent || 'unknown',
        latitude: cf.latitude,
        longitude: cf.longitude,
        postalCode: cf.postalCode,
        timezone: cf.timezone,
      },
      network: {
        asn: cf.asn,
        asOrganization: cf.asOrganization,
        tlsVersion: cf.tlsVersion,
        httpProtocol: cf.httpProtocol,
      },
      browser: parseUserAgent(request.headers.get('user-agent') || ''),
    };

    // Fire Discord + D1 tasks in parallel, never blocking the 204
    const tasks = [];
    const webhook = env.DISCORD_WEBHOOK;

    if (body.event === 'session_start') {
      if (webhook) tasks.push(sendArrivalAlert(webhook, enriched));
      if (env.DB) tasks.push(storeSessionStart(env.DB, enriched).catch(() => {}));
    } else if (body.event === 'session_end') {
      if (webhook) tasks.push(sendSessionSummary(webhook, enriched));
      if (env.DB) tasks.push(storeSessionEnd(env.DB, enriched).catch(() => {}));
    }

    if (tasks.length > 0) {
      context.waitUntil(Promise.allSettled(tasks));
    }

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (err) {
    return new Response(null, { status: 400, headers: corsHeaders });
  }
}

export async function onRequestOptions(context) {
  const env = context.env || {};
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'http://localhost:8080',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// --- User-Agent Parser ---

function parseUserAgent(ua) {
  const result = { name: 'Unknown', version: '', os: 'Unknown', device: 'Desktop' };
  if (!ua) return result;

  // Device type
  if (/iPad|Tablet|PlayBook|Silk/.test(ua)) {
    result.device = 'Tablet';
  } else if (/Mobile|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/.test(ua)) {
    result.device = 'Mobile';
  }

  // Operating system
  if (/Windows NT/.test(ua)) result.os = 'Windows';
  else if (/Mac OS X|macOS/.test(ua)) result.os = 'macOS';
  else if (/CrOS/.test(ua)) result.os = 'ChromeOS';
  else if (/Android/.test(ua)) result.os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) result.os = 'iOS';
  else if (/Linux/.test(ua)) result.os = 'Linux';

  // Browser (order matters: check specific UA tokens first)
  let m;
  if ((m = ua.match(/Edg\/(\d+)/))) { result.name = 'Edge'; result.version = m[1]; }
  else if ((m = ua.match(/OPR\/(\d+)/))) { result.name = 'Opera'; result.version = m[1]; }
  else if ((m = ua.match(/Vivaldi\/(\d+\.\d+)/))) { result.name = 'Vivaldi'; result.version = m[1]; }
  else if ((m = ua.match(/Firefox\/(\d+)/))) { result.name = 'Firefox'; result.version = m[1]; }
  else if ((m = ua.match(/Chrome\/(\d+)/))) { result.name = 'Chrome'; result.version = m[1]; }
  else if (/Safari\//.test(ua) && (m = ua.match(/Version\/(\d+)/))) { result.name = 'Safari'; result.version = m[1]; }

  // Bot detection
  if (/bot|crawl|spider|slurp|Bingbot|Googlebot|DuckDuckBot|Baiduspider|YandexBot|facebookexternalhit|Twitterbot|LinkedInBot/i.test(ua)) {
    result.name = 'Bot';
    result.device = 'Bot';
  }

  return result;
}

// --- D1 Storage ---

async function storeSessionStart(db, data) {
  const b = data.browser;
  const g = data.geo;
  const n = data.network;
  await db.prepare(`
    INSERT INTO sessions (
      session_id, ip, country, city, region, continent,
      latitude, longitude, postal_code, timezone_cf,
      asn, isp, tls_version, http_protocol,
      browser, browser_version, os, device,
      screen_width, screen_height, viewport_width, viewport_height,
      language, timezone, dark_mode,
      referrer, landing_page, is_bot
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.sessionId, data.ip,
    g.country, g.city, g.region, g.continent,
    g.latitude || null, g.longitude || null, g.postalCode || null, g.timezone || null,
    n.asn || null, n.asOrganization || null, n.tlsVersion || null, n.httpProtocol || null,
    b.name, b.version, b.os, b.device,
    data.screen?.width || null, data.screen?.height || null,
    data.viewport?.width || null, data.viewport?.height || null,
    data.language || null, data.timezone || null,
    data.darkMode ? 1 : 0,
    data.referrer || null, data.page || '/',
    b.device === 'Bot' ? 1 : 0
  ).run();
}

async function storeSessionEnd(db, data) {
  await db.prepare(`
    UPDATE sessions
    SET journey = ?, total_duration = ?, total_pages = ?,
        chat_opened = ?, chat_messages = ?, ended_at = datetime('now')
    WHERE session_id = ?
  `).bind(
    JSON.stringify(data.journey || []),
    data.totalDuration || 0,
    data.journey ? data.journey.length : 0,
    data.chat?.opened ? 1 : 0,
    data.chat?.messagesSent || 0,
    data.sessionId
  ).run();
}

// --- Helpers ---

function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function locationString(geo) {
  const parts = [];
  if (geo.city && geo.city !== 'unknown') parts.push(geo.city);
  if (geo.region && geo.region !== 'unknown') parts.push(geo.region);
  if (geo.country && geo.country !== 'unknown') parts.push(geo.country);
  return parts.join(', ') || 'Unknown';
}

function discordTimestamp(ts) {
  const unix = Math.floor((ts || Date.now()) / 1000);
  return `<t:${unix}:t>`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// --- Discord Embeds ---

async function sendArrivalAlert(webhookUrl, data) {
  const loc = locationString(data.geo);
  const b = data.browser;
  const isp = data.network.asOrganization;
  const referrer = parseReferrer(data.referrer);
  const ts = discordTimestamp(data.timestamp);

  const embed = {
    title: '\uD83D\uDC41\uFE0F New Visitor',
    color: 0x4f46e5,
    fields: [
      {
        name: '\uD83C\uDF10 Location',
        value: `${loc}${isp ? ` \u2022 ${isp}` : ''}${data.network.asn ? ` (AS${data.network.asn})` : ''}`,
        inline: false,
      },
      {
        name: '\uD83D\uDCBB Device',
        value: `${b.name} ${b.version} \u2022 ${b.os} \u2022 ${b.device}`,
        inline: false,
      },
      {
        name: '\uD83D\uDD17 Referrer',
        value: referrer,
        inline: true,
      },
      {
        name: '\uD83D\uDCC4 Landed on',
        value: data.page || '/',
        inline: true,
      },
      {
        name: '\uD83D\uDD52 Time',
        value: ts,
        inline: true,
      },
    ],
    footer: {
      text: `IP: ${maskIP(data.ip)} \u2022 Session: ${data.sessionId.slice(0, 8)}`,
    },
    timestamp: new Date(data.timestamp || Date.now()).toISOString(),
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

async function sendSessionSummary(webhookUrl, data) {
  const loc = locationString(data.geo);
  const b = data.browser;
  const isp = data.network.asOrganization;

  // Build journey
  let journeyStr = 'No page data';
  if (data.journey && data.journey.length > 0) {
    journeyStr = data.journey.map((p, i) => {
      let line = `${i + 1}. **${p.page}** (${formatDuration(p.duration)}) \u2022 scrolled ${p.scrollDepth}%`;
      if (p.clicks && p.clicks.length > 0) {
        const clickList = p.clicks.slice(0, 5).map(c => `\u2514 clicked: ${truncate(c, 40)}`);
        line += '\n' + clickList.join('\n');
      }
      return line;
    }).join('\n');
  }

  // Build fields
  const fields = [
    {
      name: '\uD83C\uDF10 Location',
      value: `${loc}${isp ? ` \u2022 ${isp}` : ''}`,
      inline: false,
    },
    {
      name: '\uD83D\uDCBB Device',
      value: `${b.name} ${b.version} \u2022 ${b.os} \u2022 ${b.device}`,
      inline: false,
    },
    {
      name: '\uD83D\uDDFA\uFE0F Journey',
      value: truncate(journeyStr, 1024),
      inline: false,
    },
  ];

  // Chat section
  if (data.chat && data.chat.opened) {
    const chatVal = data.chat.messagesSent > 0
      ? `\uD83D\uDCAC Opened chat \u2022 ${data.chat.messagesSent} message${data.chat.messagesSent !== 1 ? 's' : ''} sent`
      : '\uD83D\uDCAC Opened chat \u2022 no messages sent';
    fields.push({ name: '\uD83D\uDCAC Chat', value: chatVal, inline: false });
  }

  // Session stats
  const totalDuration = data.totalDuration || 0;
  const totalPages = data.journey ? data.journey.length : 0;
  const screenStr = data.screen ? `${data.screen.width}\u00D7${data.screen.height}` : 'unknown';
  const themeStr = data.darkMode ? 'dark mode' : 'light mode';
  const referrer = parseReferrer(data.referrer);

  fields.push({
    name: '\uD83D\uDCCA Session',
    value: [
      `\u23F1 **${formatDuration(totalDuration)}** \u2022 ${totalPages} page${totalPages !== 1 ? 's' : ''}`,
      `\uD83D\uDDA5 ${screenStr} \u2022 ${themeStr} \u2022 ${data.language || 'en'} \u2022 ${data.timezone || 'UTC'}`,
      `\uD83D\uDD17 Referrer: ${referrer}`,
    ].join('\n'),
    inline: false,
  });

  const embed = {
    title: '\uD83D\uDC4B Session Ended',
    color: 0x10b981,
    fields,
    footer: {
      text: `IP: ${maskIP(data.ip)} \u2022 Session: ${data.sessionId.slice(0, 8)}`,
    },
    timestamp: new Date(data.timestamp || Date.now()).toISOString(),
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

function parseReferrer(ref) {
  if (!ref) return 'Direct';
  try {
    const url = new URL(ref);
    return url.hostname + (url.pathname !== '/' ? url.pathname : '');
  } catch {
    return ref.slice(0, 60);
  }
}

function maskIP(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  return ip;
}
