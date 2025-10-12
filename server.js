// server.js — prod hardening + midnight schedule + last-good fallback
// + archive API + redirect to GitHub Pages (frontend)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
// Support both the old export (default function) and the new one (named exports)
const gen = require('./generate');
const generateVerse   = gen.generateDailyVerse || gen;      // existing daily generator
const generateForDate = gen.generateForDate    || null;     // will be available after you update generate.js
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// --- ensure /public exists ---
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// --- basic hardening ---
app.disable('x-powered-by');
app.set('trust proxy', 1); // respect reverse proxy (Render) for IP/proto
app.use(compression());    // gzip/br compression for faster responses
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')); // access logs

// Content Security Policy (adjust if you add new domains)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src https://fonts.gstatic.com",
      "connect-src 'self'",
    ].join('; ')
  );
  next();
});

// CORS (relaxed for GitHub Pages frontend hitting this API)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


// --- security headers (simple best-practice set) ---
app.use((req, res, next) => {
  // Force HTTPS on future visits (HSTS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Keep referrers minimal
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Disallow embedding in iframes
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});


// --- granular caching: long cache for static, no-store for API ---
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  } else if (/\.(css|js|png|jpg|svg|woff2?)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// --- static files (/daily.js, /daily.json, etc.) ---
app.use(express.static(PUBLIC_DIR));

/* =======================
   API ROUTES
   ======================= */

// Current daily JSON (with last-good fallback)
app.get('/api/daily', (req, res) => {
  try {
    const dailyPath = path.join(PUBLIC_DIR, 'daily.json');
    const lastGoodPath = path.join(PUBLIC_DIR, 'last-good.json');

    if (fs.existsSync(dailyPath)) {
      const data = fs.readFileSync(dailyPath, 'utf8');
      res.type('application/json').send(data);
      return;
    }
    if (fs.existsSync(lastGoodPath)) {
      const data = fs.readFileSync(lastGoodPath, 'utf8');
      res.setHeader('X-Fallback', 'last-good');
      res.type('application/json').send(data);
      return;
    }
    res.status(503).json({ error: 'Daily verse not ready yet.' });
  } catch (err) {
    try {
      const lastGoodPath = path.join(PUBLIC_DIR, 'last-good.json');
      if (fs.existsSync(lastGoodPath)) {
        const data = fs.readFileSync(lastGoodPath, 'utf8');
        res.setHeader('X-Fallback', 'last-good-on-error');
        res.type('application/json').send(data);
        return;
      }
    } catch {}
    res.status(500).json({ error: 'Server error.' });
  }
});

// Archive: list last 30 days (date + reference)
app.get('/api/archive', (_req, res) => {
  try {
    const p = path.join(PUBLIC_DIR, 'archive', 'index.json');
    const data = fs.readFileSync(p, 'utf8');
    res.type('application/json').send(data);
  } catch {
    res.json([]);
  }
});

// Archive: get specific day snapshot
app.get('/api/archive/:date', (req, res) => {
  try {
    const p = path.join(PUBLIC_DIR, 'archive', `${req.params.date}.json`);
    const data = fs.readFileSync(p, 'utf8');
    res.type('application/json').send(data);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// Optional status
app.get('/api/status', (_req, res) => {
  const dailyPath = path.join(PUBLIC_DIR, 'daily.json');
  const lastGoodPath = path.join(PUBLIC_DIR, 'last-good.json');
  const hasDaily = fs.existsSync(dailyPath);
  const hasLastGood = fs.existsSync(lastGoodPath);
  let archiveCount = 0;
  try {
    const idx = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_DIR, 'archive', 'index.json'), 'utf8')
    );
    archiveCount = Array.isArray(idx) ? idx.length : 0;
  } catch {}
  res.json({
    hasDaily,
    hasLastGood,
    archiveCount,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

/* =======================
   ADMIN (token-protected)
   ======================= */

// Set ADMIN_TOKEN in Render → Environment
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1] : (req.query.token || '');
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// POST /api/admin/generate  { date: "YYYY-MM-DD", reference?: "Book C:V" }
// Generates & saves the verse/context for that date (and updates daily if it's today)
app.post('/api/admin/generate', requireAdmin, async (req, res) => {
  try {
    const { date, reference } = req.body || {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'bad_date' });
    }
    if (reference && !/^.+\s+\d+:\d+$/.test(reference)) {
      return res.status(400).json({ error: 'bad_reference' });
    }

    if (!generateForDate) {
      // Your current generate.js doesn’t export generateForDate yet.
      // After you paste the updated generate.js I’ll give you next, this will run properly.
      return res.status(501).json({ error: 'update_generate_js_first' });
    }

    const payload = await generateForDate(date, reference || null);
    res.json({ ok: true, date: payload.date, reference: payload.reference, translation: payload.translation });
  } catch (e) {
    console.error('admin_generate_fail', e);
    res.status(500).json({ error: 'generate_failed' });
  }
});

// GET /api/admin/day/:date — view the saved snapshot for a date
app.get('/api/admin/day/:date', requireAdmin, (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad_date' });
  try {
    const p = path.join(PUBLIC_DIR, 'archive', `${date}.json`);
    const data = fs.readFileSync(p, 'utf8');
    res.type('application/json').send(data);
  } catch {
    res.status(404).json({ error: 'not_found' });
  }
});

/* =======================
   FRONTEND ROUTES
   ======================= */

// robots.txt — allow all crawlers and link sitemap
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(
    `User-agent: *
Allow: /
Sitemap: https://davidajose7559.github.io/daily-verse/sitemap.xml`
  );
});

// sitemap.xml — basic site map for SEO
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://davidajose7559.github.io/daily-verse/</loc>
  </url>
  <url>
    <loc>https://davidajose7559.github.io/daily-verse/archive.html</loc>
  </url>
</urlset>`);
});

// Redirect root to your GitHub Pages frontend (Option A)
app.get('/', (_req, res) => {
  res.redirect('https://davidaajose7559.github.io/daily-verse/');
});

// Health check
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

/* =======================
   SCHEDULER
   ======================= */

function msUntilNextMidnightToronto() {
  const now = DateTime.now().setZone('America/Toronto');
  const next = now.plus({ days: 1 }).startOf('day');
  return next.diff(now).as('milliseconds');
}

// Generate on boot + schedule
(async function boot() {
  try {
    await generateVerse();
  } catch (e) {
    console.error('Initial generation failed:', e?.message || e);
  }

  if (process.env.NODE_ENV === 'production') {
    // run at next local midnight, then every 24h
    setTimeout(() => {
      generateVerse().catch(err =>
        console.error('Midnight generation failed:', err?.message || err)
      );
      setInterval(() => {
        generateVerse().catch(err =>
          console.error('Daily generation failed:', err?.message || err)
        );
      }, 24 * 60 * 60 * 1000);
    }, msUntilNextMidnightToronto());
  } else {
    // dev/testing: regenerate every minute
    setInterval(async () => {
      try {
        await generateVerse();
      } catch (e) {
        console.error('Periodic generation failed:', e?.message || e);
      }
    }, 60 * 1000);
  }
})();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
