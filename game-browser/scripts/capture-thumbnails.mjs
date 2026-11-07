// Captures a screenshot.png for every catalogued game that has no thumbnail yet
// and records it in games.json. Usage: node scripts/capture-thumbnails.mjs
// (run from game-browser/; uses the Playwright Chromium already installed).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const catalogue = join(here, '../src/assets/games.json');
const games = JSON.parse(readFileSync(catalogue, 'utf8'));
const todo = games.filter((g) => !g.thumbnail);

const app = express().use(express.static(repoRoot));
const server = createServer(app).listen(0);
const base = `http://localhost:${server.address().port}`;

const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(preinstalled) ? { executablePath: preinstalled } : {});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
for (const game of todo) {
  await page.goto(`${base}/${game.dir}/index.html`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(repoRoot, game.dir, 'screenshot.png') });
  game.thumbnail = `games/${game.dir}/screenshot.png`;
  console.log(`captured ${game.name}`);
}
await browser.close();
server.close();

writeFileSync(catalogue, JSON.stringify(games, null, 2) + '\n');
console.log(`Captured ${todo.length} thumbnails`);
