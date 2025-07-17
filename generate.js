const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
  const url = `https://bible-api.com/${encodeURIComponent(reference)}`;
  const response = await axios.get(url);
  return response.data.text.trim();
}

async function generateContext(reference, text) {
  const prompt = `Explain this Bible verse using only the biblical context. Be concise (max 3 short paragraphs). Include:
- Pretext (what comes before)
- Context (surrounding verse)
- Post-text (what follows)
Also, identify 1–2 key Greek words (or Hebrew for OT), showing:
- The English word
- The original word
- A short meaning

Respond in clean HTML using <p>, <strong>, <ul>, <li>, and <em> tags.
Avoid personal opinions or life application. This is to help memorize and quote the verse accurately.

${reference} - "${text}"`;

  const chat = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });

  return chat.choices[0].message.content.trim();
}

async function generateDailyVerse() {
  const reference = getRandomVerseReference();
  const text = await fetchVerseText(reference);
  const context = await generateContext(reference, text);
  const date = new Date().toISOString().split('T')[0];

  const verse = {
    date,
    reference,
    text,
    context
  };

  fs.mkdirSync(path.join(process.cwd(), 'public'), { recursive: true });
  const jsContent = `window.dailyVerse = ${JSON.stringify(verse, null, 2)};`;
  const outputPath = path.join(process.cwd(), 'public', 'daily.js');
  fs.writeFileSync(outputPath, jsContent);

  console.log('✅ Verse generated and saved to public/daily.js');
}

module.exports = generateDailyVerse;

if (require.main === module) {
  generateDailyVerse();
}
