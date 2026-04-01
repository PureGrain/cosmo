// Cosmo Configuration — Your AI Portfolio Identity
// Edit this one file to make the site yours.
//
// UMD pattern: works in both Node.js (require) and browser (<script> tag)
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.COSMO = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  return {

    // ─── IDENTITY ──────────────────────────────────────────────────────
    name: 'Alex Chen',
    firstName: 'Alex',
    title: 'Full-Stack Developer & AI Engineer',
    website: 'https://alexchen.dev',
    email: 'hello@alexchen.dev',
    location: 'San Francisco, CA',

    // Bot personality
    botName: 'Nova',
    botTagline: 'AI-powered portfolio with a Claude chatbot',

    // Logo & branding (nav bar)
    logoInitials: 'AC',
    logoText: 'alexchen.dev',

    // ─── SOCIAL LINKS ──────────────────────────────────────────────────
    social: {
      github: 'https://github.com/alexchen-dev',
      linkedin: 'https://linkedin.com/in/alexchen',
      // twitter: 'https://twitter.com/alexchen',
    },

    // ─── HERO SECTION ──────────────────────────────────────────────────
    hero: {
      eyebrow: 'Full-Stack Developer \u2022 8 Years Building for the Web',
      tagline: 'I build production systems that solve real problems \u2014 not demos, not prototypes. The chatbot below? I built it. Go ahead, ask me anything.',
      ctaPrimary: { label: 'Interview Me', message: 'Give me the quick pitch \u2014 who is Alex and what does he bring to the table?' },
      ctaSecondary: { label: 'Explore My Work', href: '/projects.html' },
    },

    // ─── PROOF POINTS (stats bar below hero) ───────────────────────────
    proofPoints: [
      { number: '8', label: 'Years Shipping Code' },
      { number: '50+', label: 'Projects Delivered' },
      { number: '3', label: 'Open Source Projects' },
      { number: '10M+', label: 'Users Reached' },
    ],

    // ─── PROJECTS ──────────────────────────────────────────────────────
    // Featured projects shown on the homepage (cards) and projects page (detail)
    projects: [
      {
        name: 'Spectra',
        tagline: 'Real-time analytics dashboard with AI insights',
        description: 'A full-stack analytics platform that processes millions of events per day, surfaces actionable insights with AI, and presents them in a real-time dashboard built from scratch.',
        badges: ['React', 'Node.js', 'PostgreSQL', 'Claude API'],
        github: null, // set to URL string to show "View on GitHub" link
        chatPrompt: 'Tell me about Spectra \u2014 how does the real-time analytics pipeline work?',
        chatLabel: 'How does real-time analytics work?',
        details: [
          '<strong>Event pipeline:</strong> Ingests 10M+ events/day via a custom Node.js collector with Redis buffering and PostgreSQL batch writes',
          '<strong>AI insights:</strong> Claude API analyzes trends nightly, generates plain-English summaries and anomaly alerts',
          '<strong>Dashboard:</strong> React frontend with WebSocket updates, custom charting library, sub-100ms render times',
          '<strong>Multi-tenant:</strong> Row-level security, per-tenant API keys, usage-based billing integration',
        ],
      },
      {
        name: 'Nexus',
        tagline: 'Team collaboration platform with AI-powered search',
        description: 'An internal knowledge base and collaboration tool that uses semantic search to surface relevant documents, conversations, and decisions across the entire organization.',
        badges: ['TypeScript', 'Next.js', 'Pinecone', 'OpenAI'],
        github: 'https://github.com/alexchen-dev/nexus',
        chatPrompt: 'How does Nexus use AI to make team knowledge searchable?',
        chatLabel: 'How does AI-powered search work?',
        details: [
          '<strong>Semantic search:</strong> Documents are chunked, embedded via OpenAI, and stored in Pinecone for sub-second similarity search',
          '<strong>Unified index:</strong> Ingests Slack messages, Google Docs, Notion pages, and GitHub issues into one searchable corpus',
          '<strong>Smart summaries:</strong> AI generates context-aware summaries of long threads and documents on demand',
          '<strong>SSO integration:</strong> SAML/OIDC authentication with role-based access control per workspace',
        ],
      },
      {
        name: 'Forge',
        tagline: 'CI/CD pipeline builder with visual workflow editor',
        description: 'A developer tool that lets teams design, test, and deploy CI/CD pipelines through a visual drag-and-drop interface, with built-in secrets management and rollback support.',
        badges: ['Go', 'React', 'Docker', 'Kubernetes'],
        github: 'https://github.com/alexchen-dev/forge',
        chatPrompt: 'Tell me about Forge \u2014 how does the visual pipeline builder work?',
        chatLabel: 'See the pipeline builder',
        details: [
          '<strong>Visual editor:</strong> Drag-and-drop pipeline design with real-time validation and YAML export',
          '<strong>Execution engine:</strong> Go-based runner that executes steps in isolated Docker containers with resource limits',
          '<strong>Secrets vault:</strong> Encrypted at rest, injected at runtime, rotated automatically — never written to logs',
          '<strong>Rollback:</strong> One-click rollback to any previous successful deployment with full audit trail',
        ],
      },
      {
        name: 'Sentinel',
        tagline: 'Infrastructure monitoring with anomaly detection',
        description: 'A lightweight monitoring agent and dashboard that tracks server health, detects anomalies using statistical analysis, and alerts via Slack, email, or webhook.',
        badges: ['Python', 'FastAPI', 'InfluxDB', 'Grafana'],
        github: 'https://github.com/alexchen-dev/sentinel',
        chatPrompt: 'How does Sentinel detect infrastructure anomalies?',
        chatLabel: 'How does anomaly detection work?',
        details: [
          '<strong>Lightweight agent:</strong> Single Python binary, <10MB RAM, collects CPU/memory/disk/network metrics every 10 seconds',
          '<strong>Anomaly detection:</strong> Rolling Z-score analysis with adaptive thresholds — no ML training required',
          '<strong>Alert routing:</strong> Configurable escalation chains: Slack first, then email, then PagerDuty if unacknowledged',
          '<strong>Dashboard:</strong> Grafana dashboards with InfluxDB backend, 90-day retention, custom panels for fleet overview',
        ],
      },
    ],

    // ─── ABOUT PAGE ────────────────────────────────────────────────────
    about: {
      headline: 'About Alex',
      subtitle: '8 years of building for the web. From startups to scale.',
      stats: [
        { number: '8', label: 'Years in Development' },
        { number: '50+', label: 'Projects Shipped' },
        { number: '3', label: 'Open Source Projects' },
        { number: '10M+', label: 'Users Reached' },
      ],
      timeline: [
        {
          title: 'Senior Full-Stack Engineer \u2014 Freelance',
          period: '2024 \u2013 Present',
          location: 'San Francisco, CA',
          description: 'Independent engineering practice building production AI applications, developer tools, and full-stack platforms for startups and agencies.',
        },
        {
          title: 'Staff Engineer \u2014 DataFlow Inc.',
          period: '2021 \u2013 2024',
          location: 'San Francisco, CA',
          description: 'Led a team of 6 engineers building the core analytics platform. Designed the real-time event pipeline processing 10M+ events/day. Reduced infrastructure costs 40% through architecture optimization.',
        },
        {
          title: 'Senior Developer \u2014 CloudStack',
          period: '2019 \u2013 2021',
          location: 'Remote',
          description: 'Full-stack development on a multi-tenant SaaS platform. Built the CI/CD pipeline builder, secrets management system, and customer-facing API.',
        },
        {
          title: 'Frontend Engineer \u2014 StartupXYZ',
          period: '2017 \u2013 2019',
          location: 'San Francisco, CA',
          description: 'First engineering hire. Built the entire frontend from scratch using React. Grew the product from 0 to 50K MAU. Implemented real-time collaboration features.',
        },
      ],
      skills: [
        { group: 'Frontend', badges: ['React', 'Next.js', 'TypeScript', 'Tailwind', 'Vue'] },
        { group: 'Backend', badges: ['Node.js', 'Go', 'Python', 'FastAPI', 'Express'] },
        { group: 'Data & AI', badges: ['PostgreSQL', 'Redis', 'Claude API', 'OpenAI', 'Pinecone'] },
        { group: 'Infrastructure', badges: ['Docker', 'Kubernetes', 'AWS', 'Terraform', 'Nginx'] },
        { group: 'Tools & Workflow', badges: ['Git', 'GitHub Actions', 'Cloudflare', 'Vercel', 'Linux'] },
      ],
      traits: [
        { title: 'Builder First', description: 'Would rather show you a working prototype than a slide deck. Ships fast, iterates in production.' },
        { title: 'Full-Stack Mindset', description: 'Comfortable from database schema design to pixel-perfect UI. Owns features end-to-end.' },
        { title: 'Clear Communicator', description: 'Writes docs, explains trade-offs, and keeps stakeholders in the loop. No surprises.' },
        { title: 'Quality Obsessed', description: 'Writes tests, reviews thoroughly, and cares about performance. Technical debt is a choice, not an accident.' },
      ],
    },

    // ─── SERVICES ──────────────────────────────────────────────────────
    // Set to null to hide the Services page from navigation
    services: [
      { title: 'Full-Stack Development', description: 'Custom web applications built from scratch. React, Node.js, PostgreSQL, deployed and maintained.' },
      { title: 'AI Integration', description: 'Claude API, OpenAI, embeddings, RAG pipelines, AI agents \u2014 integrated into your existing product or built standalone.' },
      { title: 'Technical Architecture', description: 'System design, database modeling, API design, infrastructure planning. Get it right before you build.' },
      { title: 'Developer Tools', description: 'CI/CD pipelines, monitoring, internal tools, CLI utilities. The tooling that makes your team faster.' },
    ],

    // ─── PRODUCTS ──────────────────────────────────────────────────────
    // Set to null to hide the Products page from navigation
    products: null,

    // ─── CHAT SUGGESTIONS ──────────────────────────────────────────────
    // Shown in the chat widget when first opened
    chatWelcome: "Hey! I'm Nova \u2014 I know everything about Alex's career, projects, and what he can build for you. Ask me anything.",
    chatSuggestions: [
      { label: 'What makes Alex different?', message: 'Give me the quick pitch \u2014 who is Alex and what makes him different?' },
      { label: 'Show me his best work', message: "Walk me through Alex's biggest projects and what he built." },
      { label: 'What can he build for me?', message: 'What could Alex build for my company? What services does he offer?' },
    ],

    // ─── API CONFIGURATION ─────────────────────────────────────────────
    // Used by chat-widget.js and contact.js to connect to the API server
    apiUrl: 'http://localhost:3001',

    // Cloudflare Turnstile (optional — leave empty to skip bot verification)
    turnstileSiteKey: '',

    // ─── COLOPHON (How It Works page) ──────────────────────────────────
    colophon: {
      headline: 'How This Site Works',
      subtitle: 'No WordPress. No templates. A custom-built, AI-powered platform deployed with production tooling.',
    },

    // ─── FOOTER ────────────────────────────────────────────────────────
    footerPoweredBy: {
      label: 'Cosmo',
      url: 'https://github.com/PureGrain/cosmo',
    },
  };
}));
