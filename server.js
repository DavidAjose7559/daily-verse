// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const generateVerse = require('./generate'); // writes public/daily.js + public/daily.json

const app = express();
const PORT = process.env.PORT || 3000;

// --- ensure /public exists ---
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// --- CORS: allow reads from GitHub Pages (and anywhere while testing) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');      // relax for now; tighten later if you want
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  next();
});

// --- static files (/daily.js, /daily.json, /style.css, etc.) ---
app.use(express.static(PUBLIC_DIR));

// --- JSON API for the client ---
app.get('/api/daily', (req, res) => {
  try {
    const jsonPath = path.join(PUBLIC_DIR, 'daily.json');
    const data = fs.readFileSync(jsonPath, 'utf8');
    res.set('Cache-Control', 'no-store');
    res.type('application/json').send(data);
  } catch (err) {
    res.status(503).json({ error: 'Daily verse not ready yet.' });
  }
});

// --- simple health check (optional) ---
app.get('/', (req, res) => {
  res.type('text/plain').send('📖 Daily Verse Service is running.');
});

// --- generate on boot + every minute (testing) ---
(async function boot() {
  try {
    await generateVerse();
  } catch (e) {
    console.error('Initial generation failed:', e?.message || e);
  }
  setInterval(async () => {
    try {
      await generateVerse();
    } catch (e) {
      console.error('Periodic generation failed:', e?.message || e);
    }
  }, 60 * 1000);
})();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
