const express = require('express');
const app = express();
const path = require('path');

app.use(express.static(path.join(__dirname, '.'))); // Serves daily.js

app.get('/', (req, res) => {
  res.send('🪄 Daily Verse API is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
