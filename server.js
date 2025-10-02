// server.js — prod hardening + midnight schedule + last-good fallback
// + archive API + redirect to GitHub Pages (frontend)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
const generateVerse = require('./generate'); // writes public/daily.json + last-good.json + daily.js (+ archive)
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
   FRONTEND ROUTES
   ======================= */

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
