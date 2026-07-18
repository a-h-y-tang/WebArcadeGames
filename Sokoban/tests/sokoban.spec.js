const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Load a small, fully-known test level so movement/pushing assertions are
// exact. Layout (row, col):
//   0: # # # # #
//   1: # @ $ . #   player at (1,1), crate at (1,2), goal at (1,3)
//   2: # # # # #
const TEST_LEVEL = ['#####', '#@$.#', '#####'];

async function loadTest(page) {
    await page.evaluate((rows) => window.loadCustomLevel(rows), TEST_LEVEL);
}

test.describe('Sokoban', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sokoban', async ({ page }) => {
            await expect(page).toHaveTitle('Sokoban');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('crate');
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('moves and pushes start at zero', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pushes')).toHaveText('0');
        });

        test('level indicator starts at level 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => ({
                move: typeof window.move,
                undo: typeof window.undo,
                reset: typeof window.reset,
                loadLevel: typeof window.loadLevel,
                isSolved: typeof window.isSolved,
                loadCustomLevel: typeof window.loadCustomLevel,
            }));
            expect(api).toEqual({
                move: 'function',
                undo: 'function',
                reset: 'function',
                loadLevel: 'function',
                isSolved: 'function',
                loadCustomLevel: 'function',
            });
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a move key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => window.state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Movement mechanics (on the known test level)
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
            await loadTest(page);
        });

        test('player starts at the level start cell', async ({ page }) => {
            const p = await page.evaluate(() => ({ x: window.player.x, y: window.player.y }));
            expect(p).toEqual({ x: 1, y: 1 });
        });

        test('moving into open floor steps the player', async ({ page }) => {
            // Move up into a wall first is blocked; instead verify a valid step.
            // On the test level the only open neighbour is the crate to the
            // right, so use a dedicated corridor level for a plain step.
            await page.evaluate(() => window.loadCustomLevel(['#####', '#@  #', '#####']));
            const moved = await page.evaluate(() => window.move(1, 0));
            const p = await page.evaluate(() => ({ x: window.player.x, y: window.player.y }));
            expect(moved).toBe(true);
            expect(p).toEqual({ x: 2, y: 1 });
        });

        test('moving into a wall is rejected and nothing changes', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: window.player.x, y: window.player.y }));
            const moved = await page.evaluate(() => window.move(0, -1)); // up into wall
            const after = await page.evaluate(() => ({ x: window.player.x, y: window.player.y }));
            expect(moved).toBe(false);
            expect(after).toEqual(before);
        });

        test('a rejected move does not increment counters', async ({ page }) => {
            await page.evaluate(() => window.move(0, -1)); // into wall
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pushes')).toHaveText('0');
        });

        test('a valid step increments moves but not pushes', async ({ page }) => {
            await page.evaluate(() => window.loadCustomLevel(['#####', '#@  #', '#####']));
            await page.evaluate(() => window.move(1, 0));
            await expect(page.locator('#moves')).toHaveText('1');
            await expect(page.locator('#pushes')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Pushing mechanics
    // -----------------------------------------------------------------------
    test.describe('pushing', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
            await loadTest(page);
        });

        test('pushing a crate into open floor moves both crate and player', async ({ page }) => {
            const moved = await page.evaluate(() => window.move(1, 0)); // push right
            const s = await page.evaluate(() => ({
                px: window.player.x, py: window.player.y,
                crates: window.crates.map((c) => [c.x, c.y]),
            }));
            expect(moved).toBe(true);
            expect([s.px, s.py]).toEqual([2, 1]);          // player took crate's cell
            expect(s.crates).toEqual([[3, 1]]);            // crate slid onto the goal
        });

        test('pushing a crate onto a goal solves the test level', async ({ page }) => {
            await page.evaluate(() => window.move(1, 0));
            const solved = await page.evaluate(() => window.isSolved());
            expect(solved).toBe(true);
        });

        test('a push increments both moves and pushes', async ({ page }) => {
            await page.evaluate(() => window.move(1, 0));
            await expect(page.locator('#moves')).toHaveText('1');
            await expect(page.locator('#pushes')).toHaveText('1');
        });

        test('cannot push a crate into a wall', async ({ page }) => {
            // Crate directly against a wall: player @, crate $, wall #.
            await page.evaluate(() => window.loadCustomLevel(['#####', '#@$#.', '#####']));
            const moved = await page.evaluate(() => window.move(1, 0));
            const s = await page.evaluate(() => ({
                px: window.player.x,
                crates: window.crates.map((c) => [c.x, c.y]),
            }));
            expect(moved).toBe(false);
            expect(s.px).toBe(1);
            expect(s.crates).toEqual([[2, 1]]);
        });

        test('cannot push two crates at once', async ({ page }) => {
            // @ $ $ .  — pushing right would need to shove two crates.
            await page.evaluate(() => window.loadCustomLevel(['######', '#@$$.#', '######']));
            const moved = await page.evaluate(() => window.move(1, 0));
            const crates = await page.evaluate(() => window.crates.map((c) => [c.x, c.y]).sort());
            expect(moved).toBe(false);
            expect(crates).toEqual([[2, 1], [3, 1]]);
        });
    });

    // -----------------------------------------------------------------------
    // Undo / reset
    // -----------------------------------------------------------------------
    test.describe('undo and reset', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
            await loadTest(page);
        });

        test('undo reverts a push exactly', async ({ page }) => {
            await page.evaluate(() => window.move(1, 0)); // push crate onto goal
            await page.evaluate(() => window.undo());
            const s = await page.evaluate(() => ({
                px: window.player.x, py: window.player.y,
                crates: window.crates.map((c) => [c.x, c.y]),
            }));
            expect([s.px, s.py]).toEqual([1, 1]);
            expect(s.crates).toEqual([[2, 1]]);
        });

        test('undo restores the move and push counters', async ({ page }) => {
            await page.evaluate(() => window.move(1, 0));
            await page.evaluate(() => window.undo());
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pushes')).toHaveText('0');
        });

        test('undo with empty history is a no-op', async ({ page }) => {
            const ok = await page.evaluate(() => window.undo());
            expect(ok).toBe(false);
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('reset restores the starting position and clears counters', async ({ page }) => {
            await page.evaluate(() => window.move(1, 0));
            await page.evaluate(() => window.reset());
            const s = await page.evaluate(() => ({
                px: window.player.x, py: window.player.y,
                crates: window.crates.map((c) => [c.x, c.y]),
            }));
            expect([s.px, s.py]).toEqual([1, 1]);
            expect(s.crates).toEqual([[2, 1]]);
            await expect(page.locator('#moves')).toHaveText('0');
            await expect(page.locator('#pushes')).toHaveText('0');
        });

        test('the U key triggers an undo', async ({ page }) => {
            await page.evaluate(() => window.loadCustomLevel(['#####', '#@  #', '#####']));
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#moves')).toHaveText('1');
            await page.keyboard.press('u');
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('the R key resets the level', async ({ page }) => {
            await page.evaluate(() => window.loadCustomLevel(['#####', '#@  #', '#####']));
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#moves')).toHaveText('1');
            await page.keyboard.press('r');
            await expect(page.locator('#moves')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Winning and level progression
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('#btn-start').click();
        });

        test('solving a level shows the win overlay', async ({ page }) => {
            await loadTest(page);
            await page.evaluate(() => window.move(1, 0));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/solved|complete|win/i);
        });

        test('after solving, state is not running', async ({ page }) => {
            await loadTest(page);
            await page.evaluate(() => window.move(1, 0));
            const s = await page.evaluate(() => window.state);
            expect(s).not.toBe('running');
        });

        test('there is more than one built-in level', async ({ page }) => {
            const n = await page.evaluate(() => window.LEVELS.length);
            expect(n).toBeGreaterThan(1);
        });

        test('loadLevel switches the current level and resets counters', async ({ page }) => {
            await page.evaluate(() => window.move(0, -1)); // maybe blocked, irrelevant
            await page.evaluate(() => window.loadLevel(1));
            await expect(page.locator('#level')).toHaveText('2');
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('every built-in level is internally consistent', async ({ page }) => {
            // Each level must have at least one crate and an equal number of
            // crates and goals, and exactly one player — otherwise it is
            // unsolvable / malformed.
            const report = await page.evaluate(() => {
                return window.LEVELS.map((rows) => {
                    let crates = 0, goals = 0, players = 0;
                    for (const row of rows) {
                        for (const ch of row) {
                            if (ch === '$') crates++;
                            else if (ch === '.') goals++;
                            else if (ch === '*') { crates++; goals++; }
                            else if (ch === '@') players++;
                            else if (ch === '+') { players++; goals++; }
                        }
                    }
                    return { crates, goals, players };
                });
            });
            for (const lvl of report) {
                expect(lvl.players).toBe(1);
                expect(lvl.crates).toBeGreaterThan(0);
                expect(lvl.crates).toBe(lvl.goals);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a best-moves value is recorded after solving a level', async ({ page }) => {
            await page.locator('#btn-start').click();
            await loadTest(page);
            await page.evaluate(() => window.move(1, 0)); // solve in 1 move
            const best = await page.evaluate(() => window.localStorage.getItem('sokoban.best.custom'));
            expect(best).toBe('1');
        });
    });
});
