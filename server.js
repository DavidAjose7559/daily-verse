// server.js — prod hardening + midnight schedule (America/Toronto)
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DateTime } = require('luxon');
const generateVerse = require('./generate'); // writes public/daily.js + public/daily.json

const app = express();
const PORT = process.env.PORT || 3000;

// --- ensure /public exists ---
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// --- basic hardening ---
app.disable('x-powered-by');

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

// CORS (relaxed while testing; tighten to your domain in prod if you like)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');      // loosened for dev
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

// --- static files (/daily.js, /daily.json, /style.css, etc.) ---
app.use(express.static(PUBLIC_DIR));

// --- JSON API for the client ---
app.get('/api/daily', (req, res) => {
  try {
    const jsonPath = path.join(PUBLIC_DIR, 'daily.json');
    const data = fs.readFileSync(jsonPath, 'utf8');
    res.type('application/json').send(data); // no-store already set above
  } catch (err) {
    res.status(503).json({ error: 'Daily verse not ready yet.' });
  }
});

// --- simple health check (optional) ---
app.get('/healthz', (req, res) => {
  res.type('text/plain').send('ok');
});

// --- scheduling helpers ---
function msUntilNextMidnightToronto() {
  const now = DateTime.now().setZone('America/Toronto');
  const next = now.plus({ days: 1 }).startOf('day');
  return next.diff(now).as('milliseconds');
}

// --- generate on boot ---
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
