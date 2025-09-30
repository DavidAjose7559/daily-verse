// generate.js
// ------------------------------
// Generates the "daily verse" payload, with an edification gate.
// Writes: public/daily.json and public/daily.js
//
// Env: OPENAI_API_KEY
//
// Optional file: verseMap.json (format: { "Genesis": [31,25,24,...], "Exodus": [...] })
// If verseMap.json is missing, we fall back to WHITELIST_DEFAULTS.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { DateTime } = require('luxon');

// --- OpenAI client ---
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Try to load verseMap.json if present ---
let verseMap = null;
try {
  const vmPath = path.join(process.cwd(), 'verseMap.json');
  if (fs.existsSync(vmPath)) {
    verseMap = JSON.parse(fs.readFileSync(vmPath, 'utf8'));
  }
} catch (_) {
  verseMap = null;
}

// --- Edification controls ---
const BLOCKLIST = new Set([
  // Add references you never want to surface for daily memorization:
  "Matthew 27:5",     // Judas’ suicide
  "Judges 19:25",
  "2 Samuel 13:14",
  // expand as needed...
]);

// Good “memory” candidates if everything else fails (or if you skip verseMap.json)
const WHITELIST_DEFAULTS = [
  "Philippians 4:6-7",
  "Proverbs 3:5-6",
  "Romans 8:28",
  "Psalm 23:1",
  "Isaiah 41:10",
  "Matthew 11:28-30",
  "John 3:16",
  "Ephesians 3:20",
  "Joshua 1:9",
  "Psalm 27:1",
  "Romans 12:2",
  "Galatians 2:20",
];

// --- Explainer prompt (explain only, no selection logic) ---
const EXPLAIN_PROMPT = `
Explain this Bible verse using only biblical context. Keep it pastoral, faithful, concise.
Return clean HTML with:
- <h2> one-line summary (what it says)
- <p> what it reveals about God/Christ
- <p> how a believer can live this today
- <ul> 2–3 cross-references (list items: just references)
No inline styles, no scripts, no external links.
`;

// --- Helper: deterministic hashing pick ---
function shaPick(bytes) {
  return crypto.createHash('sha256').update(bytes).digest();
}

function pickFromWhitelist(dateISO, offset = 0) {
  const h = shaPick(`${dateISO}#w#${offset}`);
  const idx = h[0] % WHITELIST_DEFAULTS.length;
  return WHITELIST_DEFAULTS[idx];
}

function pickFromVerseMap(dateISO, offset = 0) {
  // Requires verseMap (book -> [chapters verseCounts])
  const h = shaPick(`${dateISO}#vm#${offset}`);
  const books = Object.keys(verseMap);
  const bookIdx = h[0] % books.length;
  const book = books[bookIdx];

  const chapterIdx = h[1] % verseMap[book].length; // 0-based
  const chapter = chapterIdx + 1;

  const maxVerses = verseMap[book][chapterIdx];
  const verse = (h[2] % maxVerses) + 1;

  return `${book} ${chapter}:${verse}`;
}

function pickCandidate(dateISO, offset = 0) {
  if (verseMap && typeof verseMap === 'object') {
    return pickFromVerseMap(dateISO, offset);
  }
  return pickFromWhitelist(dateISO, offset);
}

// --- Bible API fetch ---
async function fetchVerseText(reference) {
  // Bible API: https://bible-api.com/<ref>?translation=web
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=web`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    if (res && res.data && res.data.text) {
      return String(res.data.text).trim();
    }
  } catch (_) {}
  return null;
}

// --- Edification classifier (strict JSON) ---
async function classifySuitability(reference, text) {
  const prompt = `
Return STRICT JSON ONLY (no markdown, no prose).
Is this verse suitable for daily edification/memorization (authority, encouragement, learning)?
Disqualify if mainly about suicide/rape/murder descriptions, curses/punishments without hope,
genealogies/inventories/measurements, or content likely to distress without broader context.

Schema:
{"safe": true|false, "category": "edifying|neutral|non_edifying", "reason": "short phrase"}
  `.trim();

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a strict JSON classifier.' },
        { role: 'user', content: `${prompt}\n\n${reference}\n"${text}"` },
      ],
    });
    const raw = resp.choices?.[0]?.message?.content || '{}';
    return JSON.parse(raw);
  } catch (_) {
    return { safe: false, category: 'non_edifying', reason: 'classifier_error' };
  }
}

// --- Context HTML generator (explain only) ---
async function generateContextHtml(reference, text) {
  const messages = [
    { role: 'system', content: 'You are a concise, biblically faithful pastor-teacher.' },
    { role: 'user', content: `${EXPLAIN_PROMPT}\n\nReference: ${reference}\nText:\n${text}` },
  ];

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    max_tokens: 600,
    messages,
  });

  const html = resp.choices?.[0]?.message?.content?.trim() || '';
  return html;
}

// --- Main entry ---
async function generateDailyVerse() {
  // Local date for stability
  const today = DateTime.now().setZone('America/Toronto').toISODate();

  // Try up to N deterministic alternatives (bumping offset) until one passes the gate
  const MAX_TRIES = 15;
  let reference = null;
  let text = null;
  let rating = null;
  let picked = false;

  for (let offset = 0; offset < MAX_TRIES; offset++) {
    reference = pickCandidate(today, offset);

    // blocklist shortcut
    if (BLOCKLIST.has(reference)) continue;

    text = await fetchVerseText(reference);
    if (!text) continue;

    rating = await classifySuitability(reference, text);
    if (rating?.safe) {
      picked = true;
      break;
    }
  }

  // Fallback: from whitelist (guaranteed)
  if (!picked) {
    reference = pickFromWhitelist(today, 777); // arbitrary offset for fallback
    text = await fetchVerseText(reference) || reference; // worst-case: put ref as text
    rating = { safe: true, category: 'edifying', reason: 'fallback_whitelist' };
  }

  // Generate pastoral context (HTML)
  const context = await generateContextHtml(reference, text);

  const payload = {
    date: today,
    reference,
    text,
    context,
    rating, // helpful while testing
    translation: 'WEB', // Bible API default
  };

  // Ensure /public exists
  const outDir = path.join(process.cwd(), 'public');
  fs.mkdirSync(outDir, { recursive: true });

  // Write JSON
  const jsonPath = path.join(outDir, 'daily.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  // Write legacy JS global (if your page still loads it)
  const jsPath = path.join(outDir, 'daily.js');
  fs.writeFileSync(jsPath, `window.dailyVerse=${JSON.stringify(payload)};`);

  console.log(`✅ Generated daily verse for ${today}: ${reference}`);
}

// If invoked directly: run once
if (require.main === module) {
  generateDailyVerse().catch(err => {
    console.error('❌ generateDailyVerse failed:', err?.stack || err);
    process.exit(1);
  });
}

module.exports = generateDailyVerse;
