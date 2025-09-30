// generate.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- (optional) quick blocklist for verses you never want ---
const BLOCKLIST = new Set([
  "Matthew 27:5",
  // add more as needed
]);

// --- your existing verse map (kept exactly as you had it) ---
const verseMap = {
  "Matthew": [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
  "Mark": [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  "Luke": [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
  "John": [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  "Acts": [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],
  "Romans": [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  "1 Corinthians": [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  "2 Corinthians": [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  "Galatians": [24, 21, 29, 31, 26, 18],
  "Ephesians": [23, 22, 21, 32, 33, 24],
  "Philippians": [30, 30, 21, 23],
  "Colossians": [29, 23, 25, 18],
  "1 Thessalonians": [10, 20, 13, 18, 28],
  "2 Thessalonians": [12, 17, 18],
  "1 Timothy": [20, 15, 16, 16, 25, 21],
  "2 Timothy": [18, 26, 17, 22],
  "Titus": [16, 15, 15],
  "Philemon": [25],
  "Hebrews": [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  "James": [27, 26, 18, 17, 20],
  "1 Peter": [25, 25, 22, 19, 14],
  "2 Peter": [21, 22, 18],
  "1 John": [10, 29, 24, 21, 21],
  "2 John": [13],
  "3 John": [15],
  "Jude": [25]
};

function getRandomVerseReference() {
  const books = Object.keys(verseMap);
  const book = books[Math.floor(Math.random() * books.length)];
  const chapterIndex = Math.floor(Math.random() * verseMap[book].length);
  const chapter = chapterIndex + 1;
  const maxVerses = verseMap[book][chapterIndex];
  const verse = Math.floor(Math.random() * maxVerses) + 1;
  return `${book} ${chapter}:${verse}`;
}

async function fetchVerseText(reference) {
  const url = `https://bible-api.com/${encodeURIComponent(reference)}?translation=web`;
  const response = await axios.get(url, { timeout: 15000 });
  return response.data.text.trim();
}

// ---- NEW: suitability classifier (strict JSON) ----
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

  try {
    return JSON.parse(chat.choices[0].message.content);
  } catch {
    return { safe: false, category: 'non_edifying', reason: 'parse_error' };
  }
}

// ---- your explainer, kept — but “explain only” ----
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

  const chat = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return chat.choices[0].message.content.trim();
}

async function generateDailyVerse() {
  try {
    const MAX_TRIES = 20;
    let reference, text, rating;

    // loop: pick -> fetch -> classify; if unsafe, pick again
    for (let i = 0; i < MAX_TRIES; i++) {
      reference = getRandomVerseReference();
      if (BLOCKLIST.has(reference)) continue;

      text = await fetchVerseText(reference);
      if (!text) continue;

      rating = await classifySuitability(reference, text);
      if (rating.safe) break;
      reference = null; // force another try
    }

    // if we somehow failed MAX_TRIES times, fall back to a friendly default
    if (!reference) {
      reference = "Philippians 4:6-7";
      text = await fetchVerseText(reference);
      rating = { safe: true, category: 'edifying', reason: 'fallback' };
    }

    const context = await generateContext(reference, text);
    const date = new Date().toISOString().split('T')[0];

    const verse = { date, reference, text, context, rating, translation: 'WEB' };

    // ensure public dir exists
    const publicDir = path.join(process.cwd(), 'public');
    fs.mkdirSync(publicDir, { recursive: true });

    // 1) JS global (backward compatibility)
    const jsContent = `window.dailyVerse = ${JSON.stringify(verse, null, 2)};`;
    fs.writeFileSync(path.join(publicDir, 'daily.js'), jsContent);

    // 2) JSON payload for /api/daily
    fs.writeFileSync(path.join(publicDir, 'daily.json'), JSON.stringify(verse, null, 2));

    console.log(`✅ ${date} | ${reference} | ${rating?.reason || 'ok'}`);
  } catch (err) {
    console.error('❌ Failed to generate daily verse:', err?.message || err);
  }
}

module.exports = generateDailyVerse;

if (require.main === module) {
  generateDailyVerse();
}
