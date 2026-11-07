import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Runs against the real production output (dist/game-browser/browser), served
// as plain static files the way Vercel or Cloudflare Pages would serve it.
const games: { name: string; path: string; thumbnail: string }[] = JSON.parse(
  readFileSync(join(__dirname, '../src/assets/games.json'), 'utf8')
);

test('production home page lists every game', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-game-card')).toHaveCount(games.length);
});

test('every game in the catalogue is served by the production build', async ({ request }) => {
  const missing: string[] = [];
  for (const game of games) {
    const res = await request.get('/' + game.path);
    if (res.status() !== 200) missing.push(`${game.name} -> /${game.path} (${res.status()})`);
  }
  expect(missing).toEqual([]);
});

test('every thumbnail is served by the production build', async ({ request }) => {
  const missing: string[] = [];
  for (const game of games.filter((g) => g.thumbnail)) {
    const res = await request.get('/' + game.thumbnail);
    if (res.status() !== 200) missing.push(`${game.name} -> /${game.thumbnail} (${res.status()})`);
  }
  expect(missing).toEqual([]);
});

test('clicking Play opens a working game page', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('app-game-card', { hasText: games[1].name }).first();
  const [response] = await Promise.all([
    page.waitForNavigation(),
    card.locator('button:has-text("Play")').click(),
  ]);
  expect(response?.status()).toBe(200);
  expect(page.url()).toContain('/' + games[1].path);
});
