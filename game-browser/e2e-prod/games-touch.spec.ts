import { test, expect, devices } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

// Every game in the production build must be playable on a phone: the shared
// touch layer loads from the deployed site and shows its on-screen controls or
// touch wording, and the page fits the screen without sideways scrolling.
const games: { name: string; path: string }[] = JSON.parse(
  readFileSync(join(__dirname, '../src/assets/games.json'), 'utf8')
);

const { defaultBrowserType, ...iPhone } = devices['iPhone 13'];
test.use(iPhone);
test.describe.configure({ mode: 'parallel' });

for (const game of games) {
  test(`${game.name} is ready for touch on an iPhone`, async ({ page }) => {
    const missing: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 400) missing.push(`${res.status()} ${res.url()}`);
    });
    await page.goto('/' + game.path);
    await expect
      .poll(() => page.evaluate(() => !!(window as any).TouchControls?.enabled), {
        message: 'the shared touch layer loads and switches on',
      })
      .toBe(true);
    // The layer zooms the page out to fit once it has laid out, so wait for that.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: 'no sideways scrolling',
      })
      .toBeLessThanOrEqual(1);
    expect(missing).toEqual([]);
  });
}
