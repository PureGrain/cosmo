# Cosmo

AI-powered portfolio with a Claude chatbot. Zero frameworks. 3 dependencies. Production security.

---

Cosmo is an open-source portfolio template that turns your resume into a live AI assistant. Visitors chat with a Claude-powered bot that knows your career, your projects, and your work style -- and can hand conversations off to email when they turn into real opportunities.

No React. No Next.js. No build step. One config file to make it yours.

## Features

**AI Chatbot**
- Claude-powered conversational assistant trained on your resume and projects
- Editable system prompt and personality -- make the bot sound like you
- Conversation persistence across page navigation (visitors don't lose context)
- Streaming responses with markdown rendering
- Chat-to-email handoff when a visitor wants to connect

**Security**
- Honeypot injection detection (blocks prompt injection attempts)
- Per-IP daily rate limiting (conversations and API spend)
- Cloudflare Turnstile bot verification (optional)
- Cloudflare-only origin firewall script (blocks direct-to-IP requests)
- CORS origin locking
- No client-side API keys

**Lead Capture**
- Contact form with AI-generated auto-reply emails (via Mailgun)
- Chat-to-email handoff -- visitors can share their email mid-conversation
- Discord webhook alerts for new contacts and conversations

**Analytics**
- Visitor tracking via Cloudflare Pages Functions + D1 (SQLite at the edge)
- Page views, unique visitors, referrers, device breakdown
- Admin stats endpoint with secret key auth
- Discord alerts for notable traffic events

**Design**
- Dark and light theme with system preference detection
- Glass morphism UI with CSS custom properties
- Fully responsive -- mobile, tablet, desktop
- Smooth page transitions and scroll animations
- Zero layout shift, no FOUC

## Quick Start

```bash
git clone https://github.com/PureGrain/cosmo.git
cd cosmo

# 1. Edit your identity
nano cosmo.config.js

# 2. Edit your resume (AI knowledge base)
nano api/knowledge/resume.md

# 3. Add your API key
cp api/.env.example api/.env
nano api/.env  # Add ANTHROPIC_API_KEY

# 4. Start the API
cd api && npm install && node server.js

# 5. Serve the frontend (in another terminal)
cd frontend && python3 -m http.server 8080

# 6. Open http://localhost:8080
```

The chatbot will work immediately with just the `ANTHROPIC_API_KEY`. All other features (Turnstile, Mailgun, Discord, analytics) are optional and disabled by default.

## Architecture

```
Browser --> Cloudflare Pages (frontend/)
              |
              |-- Static HTML/CSS/JS
              |-- cosmo.config.js (identity)
              '-- functions/api/ (analytics --> D1)

Browser --> Cloudflare Edge --> VPS (api/)
              |                    |
              |                    |-- server.js (3 deps)
              |                    |-- prompts/ (editable AI personality)
              |                    |-- knowledge/resume.md
              |                    '-- cosmo.db (SQLite)
              |
              '-- Turnstile (optional bot verification)
```

The frontend is fully static -- no server-side rendering, no build step. Deploy it anywhere that serves files: Cloudflare Pages (free), Vercel, Netlify, GitHub Pages, or any web server.

The API server is a single Node.js file with three dependencies (`@anthropic-ai/sdk`, `better-sqlite3`, `busboy`). It runs on any VPS, VM, or container that supports Node.js 18+.

## Customization

### Level 1: Identity

Edit `cosmo.config.js`. This single file controls your name, title, projects, social links, hero section, proof points, about page, services, chat suggestions, and branding. Both the frontend and API read from it.

### Level 2: AI Personality

Edit two files:
- `api/knowledge/resume.md` -- Your full resume in markdown. This is what the chatbot knows about you.
- `api/prompts/system.md` -- The system prompt that defines the bot's personality, tone, and behavior rules.

### Level 3: Design

Edit the frontend directly:
- `frontend/css/style.css` -- Design tokens (colors, fonts, spacing) are CSS custom properties at the top of the file. Glass effects, layout, and responsive breakpoints below.
- `frontend/*.html` -- Each page is standalone HTML. Add, remove, or reorder pages.
- `frontend/js/` -- Vanilla JS modules. No build step, no bundler, no transpiler.

## Project Structure

```
cosmo/
|-- cosmo.config.js          # Your identity (one file = yours)
|-- api/
|   |-- server.js            # API server (3 deps, no framework)
|   |-- .env.example         # Environment variable template
|   |-- package.json         # Node.js dependencies
|   |-- knowledge/
|   |   '-- resume.md        # Your resume (AI knowledge base)
|   '-- prompts/
|       |-- system.md        # AI personality (editable template)
|       |-- email.md         # Email reply prompt
|       |-- deflection.txt   # Injection deflection response
|       '-- honeypot.txt     # Injection detection patterns
|-- frontend/
|   |-- index.html           # Landing page
|   |-- projects.html        # Project showcase
|   |-- about.html           # Career timeline & skills
|   |-- services.html        # Service offerings
|   |-- products.html        # Product listings (optional)
|   |-- colophon.html        # How it works
|   |-- robots.txt           # Search engine directives
|   |-- css/
|   |   '-- style.css        # Design tokens & glass UI
|   '-- js/
|       |-- chat-widget.js   # Chat UI + streaming + persistence
|       |-- nav.js           # Navigation + mobile menu
|       |-- contact.js       # Contact form + Turnstile
|       |-- analytics.js     # Visitor analytics dashboard
|       |-- theme.js         # Dark/light theme toggle
|       |-- animations.js    # Scroll + page transitions
|       '-- markdown.js      # Lightweight markdown renderer
|-- functions/               # Cloudflare Pages Functions
|   '-- api/
|       |-- track.js         # Analytics collector (edge)
|       '-- analytics.js     # Analytics query API (edge)
|-- scripts/
|   '-- cloudflare-firewall.sh  # Lock origin to Cloudflare IPs
'-- docs/
    |-- SETUP.md             # Third-party service guides
    '-- DEPLOYMENT.md        # VPS + Cloudflare deploy
```

## Environment Variables

All environment variables are configured in `api/.env`. Copy `.env.example` to get started.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | -- | Your Anthropic API key |
| `ALLOWED_ORIGIN` | Yes | `http://localhost:8080` | Frontend URL for CORS (no trailing slash) |
| `MODEL` | No | `claude-sonnet-4-20250514` | Claude model to use |
| `PORT` | No | `3001` | API server port |
| `ADMIN_KEY` | No | -- | Secret key for `/admin/stats` endpoint |
| `TURNSTILE_SECRET` | No | -- | Cloudflare Turnstile secret (enables bot verification) |
| `DISCORD_WEBHOOK` | No | -- | Discord webhook URL for alerts |
| `MAILGUN_API_KEY` | No | -- | Mailgun API key (enables email replies) |
| `MAILGUN_DOMAIN` | No | -- | Mailgun sending domain (e.g., `mg.yourdomain.com`) |
| `OWNER_EMAIL` | No | -- | Your email for contact form messages |
| `DAILY_CONV_LIMIT` | No | `5` | Max conversations per IP per day |
| `DAILY_SPEND_LIMIT` | No | `1.00` | Max API spend in USD per day |

## Optional Features

Cosmo works out of the box with just an Anthropic API key. Everything else layers on:

- **Cloudflare Turnstile** -- Bot verification before chat starts. Set `TURNSTILE_SECRET` in `.env` and `turnstileSiteKey` in `cosmo.config.js`. If not configured, chat works without verification.
- **Mailgun** -- AI-generated email replies to contact form submissions and chat-to-email handoffs. If not configured, contacts are logged to Discord only.
- **Discord Webhooks** -- Real-time alerts for new contacts, conversations, and daily spend warnings. If not configured, events are logged to the server console.
- **Cloudflare D1 Analytics** -- Visitor tracking at the edge via Pages Functions. Requires a Cloudflare Pages deployment with a D1 database binding. If not deployed to Cloudflare, analytics are simply not collected.
- **Products Page** -- Set the `products` array in `cosmo.config.js` to show a products page. Set to `null` (the default) to hide it from navigation.
- **Services Page** -- Set `services` to `null` in `cosmo.config.js` to hide it if you don't offer services.

## Deployment

Cosmo is designed for a split deployment:

1. **Frontend** -- Deploy `frontend/` to Cloudflare Pages (free tier). The `functions/` directory deploys automatically as Pages Functions if you connect the repo.
2. **API** -- Deploy `api/` to any VPS or cloud VM. A $5/month droplet is more than enough. Run `scripts/cloudflare-firewall.sh` on the VPS to lock the origin server to Cloudflare IPs only.

Detailed deployment instructions are in `docs/DEPLOYMENT.md`. Third-party service setup (Turnstile, Mailgun, Discord, D1) is covered in `docs/SETUP.md`.

## License

MIT -- see [LICENSE](LICENSE).

## Credits

Built with [Claude](https://www.anthropic.com/claude) by Anthropic. Cosmo was made to be the best open-source option in the "portfolio + AI chatbot" space -- fork it, make it yours, ship it.
