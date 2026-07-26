const express = require('express');
const path = require('path');

const app = express();

// Serve games from parent directory
// /games/2048/index.html -> parent_dir/2048/index.html
app.use('/games', express.static(path.join(__dirname, '..')));

// Also serve root to catch any direct access
app.use('/', express.static(path.join(__dirname, '..')));

// Start server on port 3001
app.listen(3001, () => {
  console.log('Game files server running on http://localhost:3001');
});
