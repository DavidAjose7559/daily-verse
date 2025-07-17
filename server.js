const express = require('express');
const fs = require('fs');
const path = require('path');
const { generateVerse } = require('./generate'); // Your verse generator function

const app = express();
const PORT = process.env.PORT || 3000;
const VERSE_PATH = path.join(__dirname, 'public', 'daily.js');

function generateAndSaveVerse() {
  const verseData = generateVerse(); // Assuming this returns a JS object
  const jsContent = `window.dailyVerse = ${JSON.stringify(verseData)};`;

  fs.writeFileSync(VERSE_PATH, jsContent);
  console.log('✅ New verse generated and saved');
}

// Make sure "public" folder exists
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });

// Generate once on startup
generateAndSaveVerse();

// Serve static files like daily.js
app.use(express.static(path.join(__dirname, 'public')));

// Optional: A health route
app.get('/', (_, res) => {
  res.send('Daily Verse Service is running.');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
