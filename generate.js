const fs = require('fs');
const path = require('path');

function generateVerse() {
  const dailyVerse = {
    date: new Date().toISOString().split('T')[0],
    reference: "John 5:24",
    text: "Very truly I tell you, whoever hears my word and believes him who sent me has eternal life and will not be judged but has crossed over from death to life.",
    context: "Jesus is speaking to the Jews who were persecuting Him. He affirms His authority and explains the spiritual resurrection and eternal life that comes from believing in Him."
  };

  const outputPath = path.join(__dirname, 'public', 'daily.js');
  const jsContent = `window.dailyVerse = ${JSON.stringify(dailyVerse, null, 2)};`;

  // Ensure 'public' folder exists
  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath));
  }

  fs.writeFileSync(outputPath, jsContent);
  console.log('✅ daily.js has been generated');
}

module.exports = generateVerse;
