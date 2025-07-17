const express = require('express');
const path = require('path');
const fs = require('fs');
const generateVerse = require('./generate'); // function that saves daily.js directly

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure "public" folder exists before generating
fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });

// Generate verse on startup
generateVerse();

// Serve static files (like daily.js) from "public"
app.use(express.static(path.join(__dirname, 'public')));

// Optional health check route
app.get('/', (_, res) => {
  res.send('📖 Daily Verse Service is running.');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
