// Cloudflare Pages Function: GET /api/analytics
// Query endpoint for visitor analytics — requires ANALYTICS_KEY Bearer auth

export async function onRequestGet(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'http://localhost:8080',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const json = (data, status = 200) => new Response(
    JSON.stringify(data, null, 2),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  // Auth check
  const auth = request.headers.get('Authorization') || '';
  if (!env.ANALYTICS_KEY || auth !== `Bearer ${env.ANALYTICS_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  if (!env.DB) {
    return json({ error: 'Database not configured' }, 503);
  }

  try {
    const db = env.DB;

    const [total, unique, avgDuration, avgPages, chatOpened, chatMessaged, countries, browsers, recent] =
      await Promise.all([
        db.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_bot = 0').first(),
        db.prepare('SELECT COUNT(DISTINCT ip) as count FROM sessions WHERE is_bot = 0').first(),
        db.prepare('SELECT AVG(total_duration) as avg FROM sessions WHERE is_bot = 0 AND total_duration > 0').first(),
        db.prepare('SELECT AVG(total_pages) as avg FROM sessions WHERE is_bot = 0 AND total_pages > 0').first(),
        db.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_bot = 0 AND chat_opened = 1').first(),
        db.prepare('SELECT COUNT(*) as count FROM sessions WHERE is_bot = 0 AND chat_messages > 0').first(),
        db.prepare('SELECT country, COUNT(*) as count FROM sessions WHERE is_bot = 0 AND country IS NOT NULL GROUP BY country ORDER BY count DESC LIMIT 10').all(),
        db.prepare('SELECT browser, COUNT(*) as count FROM sessions WHERE is_bot = 0 AND browser IS NOT NULL GROUP BY browser ORDER BY count DESC LIMIT 10').all(),
        db.prepare(`SELECT session_id, country, city, browser, os, device, landing_page,
          total_duration, total_pages, chat_opened, chat_messages, started_at, ended_at
          FROM sessions WHERE is_bot = 0 ORDER BY started_at DESC LIMIT 20`).all(),
      ]);

    return json({
      summary: {
        totalSessions: total.count,
        uniqueVisitors: unique.count,
        avgDurationSeconds: Math.round(avgDuration.avg || 0),
        avgPages: Math.round((avgPages.avg || 0) * 10) / 10,
        chatOpenRate: total.count > 0 ? Math.round((chatOpened.count / total.count) * 100) : 0,
        chatMessageRate: total.count > 0 ? Math.round((chatMessaged.count / total.count) * 100) : 0,
      },
      topCountries: countries.results,
      topBrowsers: browsers.results,
      recentSessions: recent.results,
    });
  } catch (err) {
    return json({ error: 'Query failed', detail: err.message }, 500);
  }
}

export async function onRequestOptions(context) {
  const env = context.env || {};
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'http://localhost:8080',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
