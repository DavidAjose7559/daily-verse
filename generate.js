// generate.js
// --------------------------------------------------------------
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
const BLOCKLIST = new Set(['Matthew 27:5','Judges 19:25','2 Samuel 13:14']);

// ---------- Friendly fallback verses ----------
const WHITELIST_DEFAULTS = [
  'Philippians 4:6-7','Proverbs 3:5-6','Romans 8:28','Psalm 23:1-4','Psalm 91:1-2',
  'Psalm 121:1-2','Isaiah 41:10','Matthew 11:28-30','John 3:16','Ephesians 3:20','Joshua 1:9',
];

// ---------- Verse map (NT set + Psalms) ----------
const verseMap = {
  Matthew:[25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20],
  Mark:[45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20],
  Luke:[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53],
  John:[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25],
  Acts:[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31],
  Romans:[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27],
  '1 Corinthians':[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24],
  '2 Corinthians':[24,17,18,18,21,18,16,24,15,18,33,21,14],
  Galatians:[24,21,29,31,26,18],
  Ephesians:[23,22,21,32,33,24],
  Philippians:[30,30,21,23],
  Colossians:[29,23,25,18],
  '1 Thessalonians':[10,20,13,18,28],
  '2 Thessalonians':[12,17,18],
  '1 Timothy':[20,15,16,16,25,21],
  '2 Timothy':[18,26,17,22],
  Titus:[16,15,15],
  Philemon:[25],
  Hebrews:[14,18,19,16,14,20,28,13,28,39,40,29,25],
  James:[27,26,18,17,20],
  '1 Peter':[25,25,22,19,14],
  '2 Peter':[21,22,18],
  '1 John':[10,29,24,21,21],
  '2 John':[13],
  '3 John':[15],
  Jude:[25],
  Psalms:[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,
    28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,
    5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,
    48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,14,10,8,12,15,21,10,20,14,9,6]
};

// ---------- helpers ----------
async function withRetries(fn, { tries = 3, delayMs = 800 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < tries - 1) await new Promise(r => setTimeout(r, delayMs * (2 ** i))); }
  }
  throw lastErr;
}

function writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

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

function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

const BOOK_EXPANSIONS = {
  Co:'Corinthians', Cor:'Corinthians', Pt:'Peter', Pet:'Peter', Pe:'Peter',
  Tim:'Timothy', Thes:'Thessalonians', Thess:'Thessalonians', Jn:'John', Jhn:'John',
  Sam:'Samuel', Kgs:'Kings', Chr:'Chronicles', Chron:'Chronicles'
};

// ---------- MAIN VERSE cleaner ----------
// ---------- MAIN VERSE cleaner ----------
function cleanVerseText(text, reference) {
  let t = String(text || '').trim();

  const m = String(reference || '').match(/^(.+?)\s+(\d+):(\d+)$/) || [];
  const book = m[1] || '', chap = m[2] || '', vers = m[3] || '';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const parts = book.split(/\s+/);
  const numPrefix = /^[1-3]$/.test(parts[0]) ? parts[0] : '';
  const lastWord = parts.slice(-1)[0] || '';
  const lastAbbr3 = lastWord.slice(0, 3);
  const lastFull = BOOK_EXPANSIONS[lastWord] || lastWord;

  const patterns = [];
  if (book && chap && vers) {
    patterns.push(new RegExp(`^${esc(book)}\\s+${chap}\\s*:?\\s*${vers}\\s*[–—,:-]*\\s*`, 'i'));
    if (numPrefix) {
      patterns.push(new RegExp(`^${numPrefix}\\s*${esc(lastAbbr3)}\\w*\\s+${chap}\\s*:?\\s*${vers}\\s*[–—,:-]*\\s*`, 'i'));
      patterns.push(new RegExp(`^${esc(lastFull)}\\s+${chap}\\s*:?\\s*${vers}\\s*[–—,:-]*\\s*`, 'i'));
    }
  }

  for (let i = 0; i < 2; i++) {
    t = t.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/^(?:NLT\s*API|NLT)\s*[:\-]?\s*/i, '');
    for (const re of patterns) t = t.replace(re, '');
    t = t.replace(/^[,;\s]*NLT\d+\s*/i, '').replace(/^NLT\d+\s*/i, '');

    // Strip a leading verse number if present
    t = t.replace(/^[\[\(]?\d{1,3}[\]\)]?(?=[A-Za-z“"‘'])/, '')
         .replace(/^[\[\(]?\d{1,3}[\]\)]?\s+/, '');

    // Remove inline markers / superscripts
    t = t.replace(/\[[a-z]\d?\]/gi, '')
         .replace(/[†‡]/g, '')
         .replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]/g, '');

    // Remove bracketed editorial inserts
    t = t.replace(/\[[^\]]+\]/g, '');

    // Remove NLT footnote sentences (handles *7:24, *22–23a, *23b, etc.)
    t = t.replace(/\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+(?:Other|Some)\s+manuscripts[^.]*\.(?=\s|$)/gi, '')
         .replace(/\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+(?:Or|That\s+is|This\s+means)[^.]*\.(?=\s|$)/gi, '')
         .replace(/\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+[^.]*\.(?=\s|$)/gi, '');

    // Remove trailing cross-reference lines
    t = t.replace(/([”"'.!?])\s*\*.*$/, '$1')
         .replace(/\s*[*^]\s*\d{0,3}:\d{1,3}\s+[A-Za-z].*$/, '')
         .replace(/\s*[A-Z]\s*\d{0,3}:\d{1,3}\s+[A-Za-z].*$/, '');

    // Tidy punctuation
    t = t.replace(/\s+([,.;:!?])/g, '$1')
         .replace(/“\s+/g, '“')
         .replace(/\s+”/g, '”')
         .replace(/\s+([’'])/g, '$1')
         .replace(/([‘'])\s+/g, '$1')
         .replace(/\. +but\b/g, '. But') // fix case if footnote removed mid-sentence
         .trim();
  }

  return t;
}


// ---------- EXTENDED PASSAGE cleaner ----------
// ---------- EXTENDED PASSAGE cleaner ----------
function cleanPassageText(passagePlain) {
  let t = String(passagePlain || '');

  // Normalize whitespace early
  t = t.replace(/\u00A0/g, ' ');

  // 1) Remove any leading provider labels / metadata lines
  //    e.g., "NLT API", "NLT", "Jude 1:17-23, NLT"
  t = t.replace(/^NLT\s*API.*$/gmi, '')
       .replace(/^NLT.*$/gmi, '');

  // 2) Drop everything before the FIRST verse number.
  //    (This strips pericope headings like "A Call to Remain Faithful".)
  const firstVerseIdx = t.search(/(^|\n)\s*\d{1,3}\s*[A-Za-z“"‘']/);
  if (firstVerseIdx > -1) t = t.slice(firstVerseIdx).trim();

  // 3) Remove inline markers / superscripts / bracketed inserts
  t = t.replace(/\[[a-z]\d?\]/gi, '')            // [a], [b2]
       .replace(/[†‡]/g, '')                     // daggers
       .replace(/[\u00B9\u00B2\u00B3\u2070-\u209F]/g, '') // superscripts
       .replace(/\[[^\]]+\]/g, '');              // editorial [the] etc.

  // 4) Remove NLT-style footnote sentences, including:
  //    *20 ..., *22-23a ..., *23b ..., *7:24 ..., *7:24-25a ...
  const FN = /\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+[^.]*\.(?=\s|$)/gi;
  const FN_OTHER = /\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+(?:Other|Some)\s+manuscripts[^.]*\.(?=\s|$)/gi;
  const FN_OR = /\s*\*+\d+(?::\d+)?(?:-\d+(?::\d+)?)?[a-z]?\s+(?:Or|That\s+is|This\s+means)[^.]*\.(?=\s|$)/gi;
  t = t.replace(FN_OTHER, '').replace(FN_OR, '').replace(FN, '');

  // 5) Tidy spaces/newlines and punctuation
  t = t
    .replace(/[ \t]+\n/g, '\n')   // trim line ends
    .replace(/\n[ \t]+/g, '\n')   // trim line starts
    .replace(/[ \t]{2,}/g, ' ')   // collapse runs of spaces
    .replace(/\s+([,.;:!?])/g, '$1') // space before punctuation
    // If a footnote sat in the middle of a sentence we can get ". but"
    .replace(/\. +([a-z])/g, (_, c) => '. ' + c.toUpperCase())
    .trim();

  return t;
}


// ---------- Bible API fetch (NLT only) ----------
const NLT_API_KEY = process.env.NLT_API_KEY || 'TEST';

function parseRef(reference) {
  const m = String(reference || '').trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) return null;
  let [, book, chap, vers] = m;
  return { book: book.trim().replace(/\s+/g, ' '), chap, vers };
}

function buildNltCandidates(reference) {
  const p = parseRef(reference);
  if (!p) return [reference.replace(/\s+/g, '.')];
  const { book, chap, vers } = p;
  const words = book.split(' ');
  const first = words[0];
  const restWords = words.slice(1);
  const restNoSpaces = restWords.join('');
  const restDots = restWords.join('.');
  if (!/^[1-3]$/.test(first)) {
    return [`${words.join('.')}.${chap}:${vers}`, `${book.replace(/\s+/g, '')}.${chap}:${vers}`];
  }
  const n = first;
  return [
    `${n}${restNoSpaces}.${chap}:${vers}`,
    `${n}.${restNoSpaces}.${chap}:${vers}`,
    `${n}.${restDots}.${chap}:${vers}`,
    `${n}${restDots}.${chap}:${vers}`,
  ];
}

async function fetchVerseText(reference) {
  const url = 'https://api.nlt.to/api/passages';
  const candidates = buildNltCandidates(reference);
  let lastErr;
  for (const refForApi of candidates) {
    try {
      const params = { ref: refForApi, version: 'NLT', key: NLT_API_KEY };
      const resp = await axios.get(url, { params, timeout: 15000 });
      const data = resp?.data;
      const html = typeof data === 'string' ? data : (data?.html || data?.text || '');
      const plain = htmlToPlainText(html);
      const cleaned = cleanVerseText(plain, reference);
      if (cleaned) return cleaned;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('nlt_lookup_failed');
}

/* ========= Extended range helpers & fetcher ========= */
function parseRangeRef(reference) {
  const m = String(reference || '').trim().match(/^(.+?)\s+(\d+):(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  let [, book, chap, start, end] = m;
  return { book: book.trim().replace(/\s+/g, ' '), chap, start, end };
}
function buildNltCandidatesRange(reference) {
  const p = parseRangeRef(reference);
  if (!p) return [reference.replace(/\s+/g, '.').replace('–', '-')];
  const { book, chap, start, end } = p;
  const words = book.split(' ');
  const first = words[0];
  const restWords = words.slice(1);
  const restNoSpaces = restWords.join('');
  const restDots = restWords.join('.');
  if (!/^[1-3]$/.test(first)) {
    return [`${words.join('.')}.${chap}:${start}-${end}`, `${book.replace(/\s+/g, '')}.${chap}:${start}-${end}`];
  }
  const n = first;
  return [
    `${n}${restNoSpaces}.${chap}:${start}-${end}`,
    `${n}.${restNoSpaces}.${chap}:${start}-${end}`,
    `${n}.${restDots}.${chap}:${start}-${end}`,
    `${n}${restDots}.${chap}:${start}-${end}`,
  ];
}
async function fetchPassageText(referenceRange) {
  const url = 'https://api.nlt.to/api/passages';
  const candidates = buildNltCandidatesRange(referenceRange);
  let lastErr;
  for (const refForApi of candidates) {
    try {
      const params = { ref: refForApi, version: 'NLT', key: NLT_API_KEY };
      const resp = await axios.get(url, { params, timeout: 15000 });
      const data = resp?.data;
      const html = typeof data === 'string' ? data : (data?.html || data?.text || '');
      const plain = htmlToPlainText(html);
      const cleaned = cleanPassageText(plain); // <- remove headers/footnotes, keep verse numbers
      if (cleaned) return cleaned;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('nlt_range_lookup_failed');
}
/* ===================================================== */

// ---------- Classifier ----------
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

// ---------- Explainer ----------
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

/* =======================
   Paths & writers
   ======================= */
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const archiveDir = path.join(PUBLIC_DIR, 'archive');

function writeAll(payload) {
  const dailyPath    = path.join(PUBLIC_DIR, 'daily.json');
  const lastGoodPath = path.join(PUBLIC_DIR, 'last-good.json');
  const dailyJsPath  = path.join(PUBLIC_DIR, 'daily.js');
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

  writeJsonAtomic(dailyPath, payload);
  writeJsonAtomic(lastGoodPath, payload);
  fs.writeFileSync(dailyJsPath, `window.dailyVerse = ${JSON.stringify(payload, null, 2)};`);
}

/* =======================
   Public functions
   ======================= */
function capitalize(s){ return s ? s[0].toUpperCase() + s.slice(1) : s; }
function titleCase(s){ return String(s).replace(/\w\S*/g, w => w[0].toUpperCase()+w.slice(1)); }

function normalizeReferenceForDisplay(ref) {
  let m = String(ref || '').trim().match(/^([1-3])\s*([A-Za-z.]+)\s+(\d+):(\d+)$/);
  if (m) {
    const num = m[1], raw = m[2].replace(/\./g, ''), chap = m[3], vers = m[4];
    const full = BOOK_EXPANSIONS[raw] || raw;
    return `${num} ${capitalize(full)} ${chap}:${vers}`;
  }
  m = String(ref || '').trim().match(/^(.+?)\s+(\d+):(\d+)$/);
  if (m) return `${titleCase(m[1])} ${m[2]}:${m[3]}`;
  return ref;
}

async function generateForDate(dateISO, forcedReference = null) {
  const dateKey = dateISO;
  const MAX_TRIES = 20;

  let reference = forcedReference || null;
  let text = null;
  let rating = null;

  if (!reference) {
    for (let offset = 0; offset < MAX_TRIES; offset++) {
      const candidate = pickReferenceFor(dateKey, offset);
      if (BLOCKLIST.has(candidate)) continue;

      const t = await fetchVerseText(candidate).catch(() => null);
      if (!t) continue;

      const r = await classifySuitability(candidate, t).catch(() => ({ safe: false }));
      if (r && r.safe) { reference = candidate; text = t; rating = r; break; }
    }
    if (!reference) {
      reference = WHITELIST_DEFAULTS[crypto.randomBytes(1)[0] % WHITELIST_DEFAULTS.length];
      text = await fetchVerseText(reference).catch(() => reference);
      rating = { safe: true, category: 'edifying', reason: 'fallback_whitelist' };
    }
  } else {
    text = await fetchVerseText(reference);
    rating = { safe: true, category: 'edifying', reason: 'admin_override' };
  }

  const context = await generateContext(reference, text);

  // Extended passage
  let extendedRef = null;
  try {
    const m = context.match(/<h3>\s*Extended Verse\s*<\/h3>\s*<p>([^<]+)<\/p>/i);
    if (m) extendedRef = m[1].trim().replace(/\u2013/g, '-');
  } catch {}
  let extendedText = null;
  if (extendedRef) {
    try { extendedText = await fetchPassageText(extendedRef); } catch {}
  }

  const payload = {
    date: dateKey,
    reference: normalizeReferenceForDisplay(reference),
    text,
    context,
    rating,
    translation: 'NLT',
    extended: extendedRef ? { reference: extendedRef, text: extendedText } : null
  };

  writeAll(payload);
  console.log(`✅ generated ${dateKey} | ${reference} | ${rating?.reason || 'ok'}`);
  return payload;
}

async function generateDailyVerse() {
  try {
    const today = DateTime.now().setZone('America/Toronto').toISODate();
    const pre = path.join(archiveDir, `${today}.json`);
    if (fs.existsSync(pre)) {
      const payload = JSON.parse(fs.readFileSync(pre, 'utf8'));
      writeAll(payload);
      console.log(`✅ used pre-generated archive for ${today} | ${payload.reference}`);
      return;
    }
    await generateForDate(today, null);
  } catch (err) {
    console.error('❌ Failed to generate daily verse:', err?.stack || err);
  }
}

module.exports = { generateDailyVerse, generateForDate };

if (require.main === module) {
  generateDailyVerse();
}
