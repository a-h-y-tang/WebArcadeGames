import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Audits games.json against the game folders in the repository and checks that
// every game can be found through the browser's search and category filter.
interface Game {
  id: string;
  name: string;
  description: string;
  category: string;
  dir: string;
  path: string;
  thumbnail: string;
}

const repoRoot = join(__dirname, '../..');
const games: Game[] = JSON.parse(
  readFileSync(join(__dirname, '../src/assets/games.json'), 'utf8')
);
const CATEGORIES = ['Action', 'Puzzle', 'Strategy', 'Board Game', 'Cards & Dice', 'Sports'];

test.describe('Catalogue data', () => {
  test('lists every game folder in the repository', () => {
    const folders = readdirSync(repoRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(repoRoot, d.name, 'index.html')))
      .map((d) => d.name);
    const listed = new Set(games.map((g) => g.dir));
    expect(folders.filter((f) => !listed.has(f))).toEqual([]);
  });

  test('every entry links to its folder index.html, which exists', () => {
    const bad = games.filter(
      (g) =>
        g.path !== `games/${g.dir}/index.html` ||
        !existsSync(join(repoRoot, g.dir, 'index.html'))
    );
    expect(bad.map((g) => g.name)).toEqual([]);
  });

  test('every entry has a thumbnail file that exists', () => {
    const bad = games.filter(
      (g) =>
        !g.thumbnail.startsWith(`games/${g.dir}/`) ||
        !existsSync(join(repoRoot, g.thumbnail.replace(/^games\//, '')))
    );
    expect(bad.map((g) => g.name)).toEqual([]);
  });

  test('ids and names are unique', () => {
    const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dupes(games.map((g) => g.id))).toEqual([]);
    expect(dupes(games.map((g) => g.name.toLowerCase()))).toEqual([]);
  });

  test('every game uses one of the known categories', () => {
    expect(games.filter((g) => !CATEGORIES.includes(g.category)).map((g) => g.name)).toEqual([]);
  });

  // Games that were filed under the wrong category.
  const expected: Record<string, string> = {
    Farkle: 'Cards & Dice',
    Yahtzee: 'Cards & Dice',
    'Mahjong Solitaire': 'Puzzle',
    Hnefatafl: 'Board Game',
    'Fox and Hounds': 'Board Game',
    'Pill Drop': 'Puzzle',
    'Peg Blast': 'Puzzle',
    'Peg Pop': 'Puzzle',
    'Air Hockey': 'Sports',
    'Marble Shooter': 'Puzzle',
    'Marble Spiral': 'Puzzle',
  };
  for (const [name, category] of Object.entries(expected)) {
    test(`${name} is filed under ${category}`, () => {
      expect(games.find((g) => g.name === name)?.category).toBe(category);
    });
  }
});

test.describe('Finding games in the browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-game-card')).toHaveCount(games.length);
  });

  test('every game can be found by searching its name', async ({ page }) => {
    const search = page.locator('input[placeholder="Search games..."]');
    const notFound: string[] = [];
    for (const game of games) {
      await search.fill(game.name);
      const titles = await page.locator('app-game-card h3').allTextContents();
      if (!titles.map((t) => t.trim()).includes(game.name)) notFound.push(game.name);
    }
    expect(notFound).toEqual([]);
  });

  test('search ignores case and surrounding spaces', async ({ page }) => {
    await page.locator('input[placeholder="Search games..."]').fill('  nOAH\'S DOVE ');
    await expect(page.locator('app-game-card h3')).toHaveText(["Noah's Dove"]);
  });

  for (const category of CATEGORIES) {
    test(`the ${category} filter shows exactly the ${category} games`, async ({ page }) => {
      await page.getByRole('button', { name: category, exact: true }).click();
      const shown = (await page.locator('app-game-card h3').allTextContents()).map((t) => t.trim());
      const want = games.filter((g) => g.category === category).map((g) => g.name);
      expect(shown.sort()).toEqual(want.sort());
    });
  }

  test('each card opens its own game', async ({ page }) => {
    const hrefs = await page.locator('app-game-card').evaluateAll((cards) => cards.length);
    expect(hrefs).toBe(games.length);
    const game = games.find((g) => g.name === 'Chariot of Fire')!;
    await page.locator('app-game-card', { hasText: game.name }).locator('button').click();
    await expect(page).toHaveURL(new RegExp(`/${game.path}$`));
  });
});
