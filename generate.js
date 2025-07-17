const fs = require('fs');
const path = require('path');

const dailyVerse = {
  date: new Date().toISOString().split('T')[0],
  reference: "John 5:16",
  text: "For God so loved the world...",
  context: "Jesus is speaking to Nicodemus about being born again. This verse highlights God's love and the promise of eternal life to those who believe."
};

const outputPath = path.join(__dirname, 'public', 'daily.js');
const jsContent = `window.dailyVerse = ${JSON.stringify(dailyVerse, null, 2)};`;

fs.writeFileSync(outputPath, jsContent);
console.log('✅ daily.js has been generated');
