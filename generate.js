// generate.js
// -------------------------------------------------------------
// Generates the "daily verse" payload with doctrine guardrails,
// an edification filter, retries, atomic writes, and an archive.
// Writes:
//   public/daily.json
//   public/last-good.json
//   public/daily.js
//   public/archive/YYYY-MM-DD.json
//   public/archive/index.json
//
// Env: OPENAI_API_KEY
// Deps: axios, luxon, openai

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { DateTime } = require('luxon');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Doctrine guardrails ----------
const DOCTRINE_GUARDRAILS = `
You must align with these beliefs while staying biblically faithful and contextual:
- Scripture is interpreted in context (book, author, audience, covenant), not proof-texted.
- The Trinity: Father, Son, and Holy Spirit—co-equal, co-eternal.
- The gifts of the Spirit continue today; they have not ceased. Speaking in tongues is a valid gift.
- Explanations should edify, encourage obedience to Christ, and avoid sensationalism.
- No denial of the Spirit's present work; no cessationism; no contradictions to the above.
`;

// ---------- Quick blocklist ----------
const BLOCKLIST = new Set([
  'Matthew 27:5', // Judas’ suicide
  'Judges 19:25',
  '2 Samuel 13:14',
]);

// ---------- Friendly fallback verses ----------
const WHITELIST_DEFAULTS = [
  'Philippians 4:6-7',
  'Proverbs 3:5-6',
  'Romans 8:28',
  'Psalm 23:1-4',
  'Psalm 91:1-2',
  'Psalm 121:1-2',
  'Isaiah 41:10',
  'Matthew 11:28-30',
  'John 3:16',
  'Ephesians 3:20',
  'Joshua 1:9',
];

// ---------- Verse map (NT set + Psalms) ----------
const verseMap = {
  Matthew: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  Mark: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  Luke: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  John: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  Acts: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  Romans: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians': [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2 Corinthians': [24,17,18,18,21,18,16,24,15,18,33,21,14],
  Galatians: [24,21,29,31,26,18],
  Ephesians: [23,22,21,32,33,24],
  Philippians: [30,30,21,23],
  Colossians: [29,23,25,18],
  '1 Thessalonians': [10,20,13,18,28],
  '2 Thessalonians': [12,17,18],
  '1 Timothy': [20,15,16,16,25,21],
  '2 Timothy': [18,26,17,22],
  Titus: [16,15,15],
  Philemon: [25],
  Hebrews: [14,18,19,16,14,20,28,13,28,39,40,29,25],
  James: [27,26,18,17,20],
  '1 Peter': [25,25,22,19,14],
  '2 Peter': [21,22,18],
  '1 John': [10,29,24,21,21],
  '2 John': [13],
  '3 John': [15],
  Jude: [25],
  Psalms: [
    6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,
    28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,
    5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,
    48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,14,10,8,12,15,21,
    10,20,14,9,6
  ]
};

// ---------- tiny retry helper ----------
async function withRetries(fn, { tries = 3, delayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

// ---------- atomic JSON write ----------
function writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

// ---------- Deterministic picker ----------
function pickReferenceFor(dateISO, offset = 0) {
  const h = crypto.createHash('sha256').update(`${dateISO}#${offset}`).digest();
  const books = Object.keys(verseMap);
  const book = books[h[0] % books.length];
  const chapterIndex = h[1] % verseMap[book].length;
  const chapter = chapterIndex + 1;
  const maxVerses = verseMap[book][chapterIndex];
  const verse = (h[2] % maxVerses) + 1;
  return `${book} ${chapter}:${verse}`;
}

// ---------- Bible API fetch (with retries) ----------
async function fetchVerseText(reference) {
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=web`;
  return await withRetries(async () => {
    const response = await axios.get(url, { timeout: 15000 });
    const text = String(response?.data?.text || '').trim();
    if (!text) throw new Error('empty_bible_text');
    return text;
  }, { tries: 3, delayMs: 700 });
}

// ---------- Suitability classifier (with retries) ----------
async function classifySuitability(reference, text) {
  const prompt = `
Return STRICT JSON ONLY (no markdown).
Decide if this verse is suitable for daily edification/memorization — even when explained with its immediate pretext and post-text.
Allow if the central message can be clearly edifying once the surrounding context is explained.
Disqualify only if the focus is primarily suicide/sexual violence/graphic murder, curses/punishments without hope,
genealogies/inventories/measurements, or content likely to distress without clear pastoral application.

Schema:
{"safe": true|false, "category": "edifying|neutral|non_edifying", "reason": "short phrase"}
`.trim();

  return await withRetries(async () => {
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a strict JSON classifier.' },
        { role: 'user', content: `${prompt}\n\n${reference}\n"${text}"` }
      ],
    });
    try { return JSON.parse(chat.choices[0].message.content); }
    catch { throw new Error('classifier_parse_error'); }
  }, { tries: 2, delayMs: 800 });
}

// ---------- Explainer (HTML) guarded by doctrine (with retries) ----------
async function generateContext(reference, text) {
  const prompt = `Explain this Bible verse using only biblical context. Keep it pastoral, faithful, concise.
Return clean HTML with EXACTLY these sections (no inline styles, no scripts):

<h2>Summary</h2>
<p>1–2 sentence summary of the verse.</p>

<h3>Extended Verse</h3>
<p>Suggest a short surrounding passage (e.g., "Philemon 1:18–21") that best frames the verse.</p>

<h3>Explanation</h3>
<ul>
  <li><strong>Pretext</strong>: What happens immediately before (1–3 verses).</li>
  <li><strong>Context</strong>: What this verse is saying and why it matters.</li>
  <li><strong>Cultural Context</strong>: <em>If applicable</em>, explain cultural practices in Bible times that differ from today (e.g., "holy kiss"), and clarify the timeless principle for believers now.</li>
  <li><strong>Post-text</strong>: What happens right after (1–3 verses).</li>
</ul>

<h3>Key Greek Words</h3>
<ul>
  <li><strong>[word]</strong> (Greek) – brief meaning for this verse.</li>
  <li><strong>[word]</strong> (Greek) – brief meaning for this verse.</li>
</ul>

Only include biblically faithful content. No external links.

Reference: ${reference}
Text: "${text}"`;

  return await withRetries(async () => {
    const chat = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      messages: [
        { role: 'system', content: DOCTRINE_GUARDRAILS },
        { role: 'user', content: prompt }
      ],
    });
    const html = chat.choices[0].message.content?.trim();
    if (!html) throw new Error('empty_context');
    return html;
  }, { tries: 2, delayMs: 800 });
}

// ---------- Main ----------
async function generateDailyVerse() {
  try {
    const MAX_TRIES = 20;
   // const today = DateTime.now().setZone('America/Toronto').toISODate(); // ← daily key (no test offset)
    const today = DateTime.now().setZone('America/Toronto').plus({ days: 1 }).toISODate();

    let reference = null;
    let text = null;
    let rating = null;

    for (let offset = 0; offset < MAX_TRIES; offset++) {
      const candidate = pickReferenceFor(today, offset);
      if (BLOCKLIST.has(candidate)) continue;

      const t = await fetchVerseText(candidate).catch(() => null);
      if (!t) continue;

      const r = await classifySuitability(candidate, t).catch(() => ({ safe: false }));
      if (r && r.safe) {
        reference = candidate;
        text = t;
        rating = r;
        break;
      }
    }

    if (!reference) {
      reference = WHITELIST_DEFAULTS[crypto.randomBytes(1)[0] % WHITELIST_DEFAULTS.length];
      text = await fetchVerseText(reference).catch(() => reference);
      rating = { safe: true, category: 'edifying', reason: 'fallback_whitelist' };
    }

    const context = await generateContext(reference, text);

    const payload = {
      date: today,
      reference,
      text,
      context,
      rating,
      translation: 'WEB',
    };

    // ---- paths ----
    const publicDir    = path.join(process.cwd(), 'public');
    const dailyPath    = path.join(publicDir, 'daily.json');
    const lastGoodPath = path.join(publicDir, 'last-good.json');
    const dailyJsPath  = path.join(publicDir, 'daily.js');

    // ---- ARCHIVE: save snapshot + rolling index (last 30) ----
    const archiveDir   = path.join(publicDir, 'archive');
    const dayPath      = path.join(archiveDir, `${payload.date}.json`);
    const indexPath    = path.join(archiveDir, 'index.json');

    fs.mkdirSync(archiveDir, { recursive: true });
    writeJsonAtomic(dayPath, payload);

    let idx = [];
    try { idx = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch {}
    idx = idx.filter(x => x.date !== payload.date);
    idx.unshift({ date: payload.date, reference: payload.reference });
    idx = idx.slice(0, 30);
    writeJsonAtomic(indexPath, idx);

    // ---- atomic JSON writes for "today" + last-good ----
    writeJsonAtomic(dailyPath, payload);
    writeJsonAtomic(lastGoodPath, payload);

    // legacy JS global (non-atomic is fine here)
    fs.writeFileSync(dailyJsPath, `window.dailyVerse = ${JSON.stringify(payload, null, 2)};`);

    console.log(`✅ ${today} | ${reference} | ${rating?.reason || 'ok'}`);
  } catch (err) {
    console.error('❌ Failed to generate daily verse:', err?.stack || err);
  }
}

module.exports = generateDailyVerse;

if (require.main === module) {
  generateDailyVerse();
}
