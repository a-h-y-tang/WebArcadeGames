import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Opens every game from the production build and fails on anything a player
// would hit straight away: a missing page or file, a script error, or a blank page.
const games: { name: string; path: string }[] = JSON.parse(
  readFileSync(join(__dirname, '../src/assets/games.json'), 'utf8')
);

test.describe.configure({ mode: 'parallel' });

for (const game of games) {
  test(`${game.name} loads without errors`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`script error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) problems.push(`${res.status()} ${res.url()}`);
    });
    page.on('requestfailed', (req) => problems.push(`failed request: ${req.url()}`));

    const response = await page.goto('/' + game.path);
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(1000);

    // Something must actually be drawn: a canvas or visible page content.
    const hasContent = await page.evaluate(
      () => !!document.querySelector('canvas') || document.body.innerText.trim().length > 0
    );
    expect(hasContent, 'page renders a canvas or some text').toBe(true);
    expect(problems).toEqual([]);
  });
}
