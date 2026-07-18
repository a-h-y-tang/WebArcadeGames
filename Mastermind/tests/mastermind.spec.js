const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a fresh game with a known secret so the tests are deterministic.
async function start(page, secret) {
    await page.keyboard.press('Enter');
    if (secret) await page.evaluate((s) => setSecret(s), secret);
}

// Enter a full guess row via the code API and submit it.
async function guess(page, code) {
    await page.evaluate((c) => {
        clearCurrent();
        for (const col of c) pickColor(col);
        submitGuess();
    }, code);
}

test.describe('Mastermind', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Mastermind', async ({ page }) => {
            await expect(page).toHaveTitle('Mastermind');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/start/i);
        });

        test('the game starts idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('canvas is 380×560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '380');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('there are 6 colours, a code length of 4 and 10 guesses', async ({ page }) => {
            const cfg = await page.evaluate(() => ({
                colors: COLORS.length, len: CODE_LENGTH, max: MAX_GUESSES,
            }));
            expect(cfg).toEqual({ colors: 6, len: 4, max: 10 });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('a key dismisses the overlay and starts playing', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh secret is a 4-peg code using colours 0..5', async ({ page }) => {
            await page.keyboard.press('Enter');
            const ok = await page.evaluate(() =>
                secret.length === CODE_LENGTH &&
                secret.every((c) => Number.isInteger(c) && c >= 0 && c < COLORS.length));
            expect(ok).toBe(true);
        });

        test('the board starts empty', async ({ page }) => {
            await page.keyboard.press('Enter');
            const s = await page.evaluate(() => ({ guesses: guesses.length, current: current.length }));
            expect(s).toEqual({ guesses: 0, current: 0 });
        });

        test('the first key press does not register a colour', async ({ page }) => {
            await page.keyboard.press('1'); // should only start the game
            const s = await page.evaluate(() => ({ state, current: current.length }));
            expect(s.state).toBe('playing');
            expect(s.current).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring — the pure black/white peg logic
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        async function score(page, guessCode, secretCode) {
            return page.evaluate(([g, s]) => scoreGuess(g, s), [guessCode, secretCode]);
        }

        test('an exact match scores 4 black, 0 white', async ({ page }) => {
            await start(page);
            expect(await score(page, [0, 1, 2, 3], [0, 1, 2, 3])).toEqual({ black: 4, white: 0 });
        });

        test('completely wrong colours score 0, 0', async ({ page }) => {
            await start(page);
            expect(await score(page, [0, 0, 0, 0], [1, 2, 3, 4])).toEqual({ black: 0, white: 0 });
        });

        test('right colours in the wrong places score whites', async ({ page }) => {
            await start(page);
            expect(await score(page, [3, 2, 1, 0], [0, 1, 2, 3])).toEqual({ black: 0, white: 4 });
        });

        test('a mix of blacks and whites is counted correctly', async ({ page }) => {
            await start(page);
            // secret 0,1,2,3 vs guess 0,2,1,4 -> pos0 black; 2&1 present wrong place -> 2 white
            expect(await score(page, [0, 2, 1, 4], [0, 1, 2, 3])).toEqual({ black: 1, white: 2 });
        });

        test('duplicate guess pegs are not double-counted', async ({ page }) => {
            await start(page);
            // secret has a single 0; guess has three 0s -> only one can be credited
            expect(await score(page, [0, 0, 0, 1], [0, 2, 3, 4])).toEqual({ black: 1, white: 0 });
        });

        test('duplicate secret pegs credit at most their count', async ({ page }) => {
            await start(page);
            // secret has two 5s; guess has two 5s but both out of place -> 2 white
            expect(await score(page, [5, 5, 1, 2], [1, 2, 5, 5])).toEqual({ black: 0, white: 4 });
        });
    });

    // -----------------------------------------------------------------------
    // Building a guess
    // -----------------------------------------------------------------------
    test.describe('building a guess', () => {
        test('picking a colour adds it to the current row', async ({ page }) => {
            await start(page);
            const cur = await page.evaluate(() => { pickColor(2); return [...current]; });
            expect(cur).toEqual([2]);
        });

        test('the current row cannot exceed the code length', async ({ page }) => {
            await start(page);
            const len = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) pickColor(0);
                return current.length;
            });
            expect(len).toBe(4);
        });

        test('remove deletes the last picked peg', async ({ page }) => {
            await start(page);
            const cur = await page.evaluate(() => {
                pickColor(1); pickColor(2); removeLast();
                return [...current];
            });
            expect(cur).toEqual([1]);
        });

        test('clear empties the current row', async ({ page }) => {
            await start(page);
            const len = await page.evaluate(() => {
                pickColor(1); pickColor(2); clearCurrent();
                return current.length;
            });
            expect(len).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Submitting a guess
    // -----------------------------------------------------------------------
    test.describe('submitting', () => {
        test('an incomplete guess cannot be submitted', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            const n = await page.evaluate(() => {
                pickColor(0); pickColor(1); // only 2 pegs
                submitGuess();
                return guesses.length;
            });
            expect(n).toBe(0);
        });

        test('a complete guess is recorded with its score', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            await guess(page, [0, 1, 3, 2]); // 2 black (0,1), 2 white (2,3)
            const row = await page.evaluate(() => guesses[0]);
            expect(row.code).toEqual([0, 1, 3, 2]);
            expect(row.black).toBe(2);
            expect(row.white).toBe(2);
        });

        test('the current row resets after a submit', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            await guess(page, [5, 5, 5, 5]);
            expect(await page.evaluate(() => current.length)).toBe(0);
        });

        test('the guesses-remaining counter decrements', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            await guess(page, [5, 5, 5, 5]);
            await expect(page.locator('#remaining')).toHaveText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('guessing the secret wins the game', async ({ page }) => {
            await start(page, [4, 2, 0, 5]);
            await guess(page, [4, 2, 0, 5]);
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('the win overlay is shown', async ({ page }) => {
            await start(page, [4, 2, 0, 5]);
            await guess(page, [4, 2, 0, 5]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|cracked|solved/i);
        });

        test('no further guesses are accepted after a win', async ({ page }) => {
            await start(page, [4, 2, 0, 5]);
            await guess(page, [4, 2, 0, 5]);
            await guess(page, [0, 0, 0, 0]);
            expect(await page.evaluate(() => guesses.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('running out of guesses loses the game', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            const s = await page.evaluate(() => {
                for (let i = 0; i < MAX_GUESSES; i++) {
                    clearCurrent();
                    for (let k = 0; k < CODE_LENGTH; k++) pickColor(5); // always wrong
                    submitGuess();
                }
                return state;
            });
            expect(s).toBe('lost');
        });

        test('the loss overlay reveals the secret', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            await page.evaluate(() => {
                for (let i = 0; i < MAX_GUESSES; i++) {
                    clearCurrent();
                    for (let k = 0; k < CODE_LENGTH; k++) pickColor(5);
                    submitGuess();
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|lost/i);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard & mouse input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('number keys 1-6 pick colours', async ({ page }) => {
            await start(page);
            await page.keyboard.press('1');
            await page.keyboard.press('4');
            expect(await page.evaluate(() => [...current])).toEqual([0, 3]);
        });

        test('Backspace removes the last peg', async ({ page }) => {
            await start(page);
            await page.keyboard.press('2');
            await page.keyboard.press('3');
            await page.keyboard.press('Backspace');
            expect(await page.evaluate(() => [...current])).toEqual([1]);
        });

        test('Enter submits a complete guess', async ({ page }) => {
            await start(page, [0, 1, 2, 3]);
            await page.keyboard.press('1');
            await page.keyboard.press('2');
            await page.keyboard.press('3');
            await page.keyboard.press('4');
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => guesses.length)).toBe(1);
        });

        test('clicking a palette swatch picks that colour', async ({ page }) => {
            await start(page);
            const rect = await page.evaluate(() => swatchRect(2));
            await page.locator('#canvas').click({
                position: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
            });
            expect(await page.evaluate(() => [...current])).toEqual([2]);
        });
    });

    // -----------------------------------------------------------------------
    // Restarting
    // -----------------------------------------------------------------------
    test.describe('restarting', () => {
        test('a key after a win starts a new game', async ({ page }) => {
            await start(page, [4, 2, 0, 5]);
            await guess(page, [4, 2, 0, 5]);
            await page.keyboard.press('Enter');
            const s = await page.evaluate(() => ({ state, guesses: guesses.length }));
            expect(s.state).toBe('playing');
            expect(s.guesses).toBe(0);
        });
    });
});
