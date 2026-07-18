const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Handy fixed card ids used across tests. A card id is its four attributes
// (count, colour, shape, shading) read as base-3 digits:
//   id = count*27 + colour*9 + shape*3 + shading
// So 0 = (0,0,0,0), 1 = (0,0,0,1), 2 = (0,0,0,2), 40 = (1,1,1,1),
//    80 = (2,2,2,2), 79 = (2,2,2,1).
// {0,1,2}   -> Set (all attrs same except shading, which is all-different)
// {0,40,80} -> Set (every attribute all-different)
// {0,40,79} -> not a Set (shading is 0,1,1)

test.describe('Set', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Set', async ({ page }) => {
            await expect(page).toHaveTitle('Set');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/set|trio|space/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => board.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('set-best', '42'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('42');
        });
    });

    // -----------------------------------------------------------------------
    // The Set rule (pure logic)
    // -----------------------------------------------------------------------
    test.describe('the Set rule', () => {
        test('recognises an all-different Set', async ({ page }) => {
            expect(await page.evaluate(() => isSet(0, 40, 80))).toBe(true);
        });

        test('recognises a one-attribute-different Set', async ({ page }) => {
            expect(await page.evaluate(() => isSet(0, 1, 2))).toBe(true);
        });

        test('rejects a non-Set', async ({ page }) => {
            expect(await page.evaluate(() => isSet(0, 40, 79))).toBe(false);
        });

        test('rejects a trio with two equal cards and one different', async ({ page }) => {
            // (0,0,0,0), (0,0,0,0), (0,0,0,1): shading sums to 1, not a Set.
            expect(await page.evaluate(() => isSet(0, 0, 1))).toBe(false);
        });

        test('findSetIndices returns indices that form a real Set', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const cards = [0, 40, 79, 1, 2, 13];
                const idx = findSetIndices(cards);
                if (!idx) return false;
                return isSet(cards[idx[0]], cards[idx[1]], cards[idx[2]]);
            });
            expect(ok).toBe(true);
        });

        test('findSetIndices returns null when there is no Set', async ({ page }) => {
            // Two cards can never contain a Set.
            const res = await page.evaluate(() => findSetIndices([0, 1]));
            expect(res).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting deals twelve unique cards', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                return { len: board.length, unique: new Set(board).size };
            });
            expect(result.len).toBe(12);
            expect(result.unique).toBe(12);
        });

        test('the dealt board always contains a Set', async ({ page }) => {
            const hasSet = await page.evaluate(() => {
                startGame();
                return boardHasSet();
            });
            expect(hasSet).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Selection
    // -----------------------------------------------------------------------
    test.describe('selection', () => {
        test('clicking a card selects it; clicking again deselects it', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                selected = [];
                selectCard(2);
                const afterFirst = selected.length;
                selectCard(2);
                const afterSecond = selected.length;
                return { afterFirst, afterSecond };
            });
            expect(result.afterFirst).toBe(1);
            expect(result.afterSecond).toBe(0);
        });

        test('a valid Set scores, counts and is cleared from the board', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                board = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                deck = []; // no replacements, so the board simply shrinks
                selected = [];
                const scoreBefore = score;
                selectCard(0);
                selectCard(1);
                selectCard(2);
                return {
                    scoreBefore,
                    score,
                    setsFound,
                    len: board.length,
                    stillHasZero: board.includes(0),
                    selected: selected.length,
                };
            });
            expect(result.score).toBeGreaterThan(result.scoreBefore);
            expect(result.setsFound).toBe(1);
            expect(result.len).toBe(9);
            expect(result.stillHasZero).toBe(false);
            expect(result.selected).toBe(0);
        });

        test('a valid Set is replaced from the deck to keep twelve cards', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                board = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                deck = [30, 31, 32]; // available replacements
                selected = [];
                selectCard(0);
                selectCard(1);
                selectCard(2);
                return { len: board.length, hasOld: board.includes(0) };
            });
            expect(result.len).toBe(12);
            expect(result.hasOld).toBe(false);
        });

        test('an invalid trio records a mistake and clears without shrinking the board', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                board = [0, 40, 79, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                deck = [];
                selected = [];
                selectCard(0);
                selectCard(1);
                selectCard(2); // 0,40,79 is not a Set
                return { mistakes, len: board.length, selected: selected.length };
            });
            expect(result.mistakes).toBe(1);
            expect(result.len).toBe(12);
            expect(result.selected).toBe(0);
        });

        test('the mistake penalty never drives the score below zero', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                board = [0, 40, 79, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                deck = [];
                selected = [];
                score = 0;
                selectCard(0);
                selectCard(1);
                selectCard(2);
                return score;
            });
            expect(s).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Ending the game
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('deck empty and no Set on the board ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                deck = [];
                board = [0, 1, 40]; // not a Set, and only three cards
                maybeEndGame();
                return state;
            });
            expect(s).toBe('over');
        });

        test('a Set still on the board keeps the game running', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                deck = [];
                board = [0, 1, 2]; // a Set
                maybeEndGame();
                return state;
            });
            expect(s).toBe('running');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 15;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('15');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 21;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('set-best'));
            expect(parseInt(stored, 10)).toBe(21);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('set-best', '99'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 5;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('99');
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('restart resets score, board and state', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                score = 30;
                selected = [0, 1];
                endGame();
                startGame();
                return { score, len: board.length, state, selected: selected.length };
            });
            expect(result.score).toBe(0);
            expect(result.len).toBe(12);
            expect(result.state).toBe('running');
            expect(result.selected).toBe(0);
        });
    });
});
