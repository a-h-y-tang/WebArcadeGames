// Static server for the production build, with no fallbacks or proxies, so a
// missing file is a real 404 just as it would be on the hosting provider.
const express = require('express');
const path = require('path');

const port = Number(process.env.PORT || 4300);
const app = express();
app.use(express.static(path.join(__dirname, '../dist/game-browser/browser')));
app.listen(port, () => console.log(`Serving production build on http://localhost:${port}`));
