const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const verseMap = {
  "John": [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  "Colossians": [29, 23, 25, 18],
  "Ephesians": [23, 22, 21, 32, 33, 24],
  // Add more books as needed...
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

  const jsContent = `window.dailyVerse = ${JSON.stringify(verse, null, 2)};`;
  const outputPath = path.join(__dirname, 'public', 'daily.js');
  fs.writeFileSync(outputPath, jsContent);

  console.log('✅ Verse generated and saved to public/daily.js');
}

module.exports = generateDailyVerse;
