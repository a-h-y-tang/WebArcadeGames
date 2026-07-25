const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Word Blaster', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Start from a clean high-score every test.
        await page.evaluate(() => localStorage.removeItem('wordblaster-best'));
        await page.reload();
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Word Blaster', async ({ page }) => {
            await expect(page).toHaveTitle('Word Blaster');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('start');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('canvas has the configured size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            const [w, h] = await page.evaluate(() => [WIDTH, HEIGHT]);
            await expect(canvas).toHaveAttribute('width', String(w));
            await expect(canvas).toHaveAttribute('height', String(h));
        });

        test('no words on screen while idle', async ({ page }) => {
            const n = await page.evaluate(() => words.length);
            expect(n).toBe(0);
        });

        test('state is idle', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('WORD_LIST is non-empty lowercase words', async ({ page }) => {
            const ok = await page.evaluate(() =>
                Array.isArray(WORD_LIST) &&
                WORD_LIST.length > 0 &&
                WORD_LIST.every(w => /^[a-z]+$/.test(w))
            );
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a letter key starts the game', async ({ page }) => {
            await page.keyboard.press('a');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting resets score and lives', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Spawning words
    // -----------------------------------------------------------------------
    test.describe('spawning words', () => {
        test('spawnWord adds a word with the expected shape', async ({ page }) => {
            await page.locator('#btn-start').click();
            const w = await page.evaluate(() => {
                words.length = 0;
                spawnWord('hello', 100);
                return words[0];
            });
            expect(w.text).toBe('hello');
            expect(w.typed).toBe(0);
            expect(w.x).toBe(100);
            expect(typeof w.y).toBe('number');
            expect(typeof w.speed).toBe('number');
        });

        test('new words start at or above the top', async ({ page }) => {
            await page.locator('#btn-start').click();
            const y = await page.evaluate(() => {
                words.length = 0;
                spawnWord('meteor', 50);
                return words[0].y;
            });
            expect(y).toBeLessThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Falling / physics
    // -----------------------------------------------------------------------
    test.describe('falling', () => {
        test('update advances a word downward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                words.length = 0;
                spawnWord('fall', 100);
                words[0].y = 0;
                words[0].speed = 100; // px/s
                const before = words[0].y;
                update(1000); // 1 second -> +100px
                return words[0].y - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a word crossing the danger line costs a life', async ({ page }) => {
            await page.locator('#btn-start').click();
            const result = await page.evaluate(() => {
                words.length = 0;
                lives = 3;
                spawnWord('doomed', 100);
                words[0].y = DANGER_Y - 1;
                words[0].speed = 1000;
                update(1000); // shoots well past the danger line
                return { lives, remaining: words.length };
            });
            expect(result.lives).toBe(2);
            expect(result.remaining).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                words.length = 0;
                lives = 1;
                spawnWord('boom', 100);
                words[0].y = DANGER_Y;
                words[0].speed = 1000;
                update(1000);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Typing
    // -----------------------------------------------------------------------
    test.describe('typing', () => {
        test('typing the first letter locks onto a word', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('cat', 100);
                words[0].y = 100;
            });
            await page.keyboard.press('c');
            const r = await page.evaluate(() => ({
                active: activeWord === words[0],
                typed: words[0] ? words[0].typed : -1,
            }));
            expect(r.active).toBe(true);
            expect(r.typed).toBe(1);
        });

        test('completing a word destroys it and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                score = 0;
                spawnWord('cat', 100);
                words[0].y = 100;
            });
            await page.keyboard.press('c');
            await page.keyboard.press('a');
            await page.keyboard.press('t');
            const r = await page.evaluate(() => ({
                remaining: words.length,
                score,
                active: activeWord,
            }));
            expect(r.remaining).toBe(0);
            expect(r.score).toBe(30); // 3 letters * 10
            expect(r.active).toBe(null);
        });

        test('a wrong key does not advance the active word', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('cat', 100);
                words[0].y = 100;
            });
            await page.keyboard.press('c'); // typed = 1
            await page.keyboard.press('z'); // wrong -> ignored
            const typed = await page.evaluate(() => words[0].typed);
            expect(typed).toBe(1);
        });

        test('nearest-to-bottom word is chosen on a first-letter match', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('sun', 100);
                words[0].y = 50;   // higher up
                spawnWord('star', 300);
                words[1].y = 400;  // nearer the bottom
            });
            await page.keyboard.press('s');
            const idx = await page.evaluate(() => words.indexOf(activeWord));
            expect(idx).toBe(1); // the lower 'star'
        });

        test('while a word is active, other words are not targeted', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('ab', 100);
                words[0].y = 100;
                spawnWord('cd', 300);
                words[1].y = 100;
            });
            await page.keyboard.press('a'); // lock 'ab'
            await page.keyboard.press('c'); // belongs to 'cd' — ignored, 'ab' still active
            const r = await page.evaluate(() => ({
                active: words.indexOf(activeWord),
                typedAb: words[0].typed,
                typedCd: words[1].typed,
            }));
            expect(r.active).toBe(0);
            expect(r.typedAb).toBe(1);
            expect(r.typedCd).toBe(0);
        });

        test('completing the active word frees targeting for the next', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('go', 100);
                words[0].y = 100;
                spawnWord('hi', 300);
                words[1].y = 100;
            });
            await page.keyboard.press('g');
            await page.keyboard.press('o'); // 'go' destroyed
            await page.keyboard.press('h'); // now can target 'hi'
            const r = await page.evaluate(() => ({
                remaining: words.length,
                activeText: activeWord ? activeWord.text : null,
            }));
            expect(r.remaining).toBe(1);
            expect(r.activeText).toBe('hi');
        });

        test('typing does nothing when no word matches', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                activeWord = null;
                spawnWord('cat', 100);
                words[0].y = 100;
            });
            await page.keyboard.press('q'); // no word starts with q
            const r = await page.evaluate(() => ({
                active: activeWord,
                typed: words[0].typed,
            }));
            expect(r.active).toBe(null);
            expect(r.typed).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('Esc pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('Esc resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('words do not fall while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                words.length = 0;
                spawnWord('frozen', 100);
                words[0].y = 100;
                words[0].speed = 100;
            });
            await page.keyboard.press('Escape');
            const before = await page.evaluate(() => words[0].y);
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => words[0].y);
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('endGame shows the game-over overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates when score is higher', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 120; endGame(); });
            await expect(page.locator('#best')).toHaveText('120');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 200; endGame(); });
            const stored = await page.evaluate(() =>
                parseInt(localStorage.getItem('wordblaster-best'), 10));
            expect(stored).toBe(200);
        });

        test('restarting after game over resets state', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 50; endGame(); });
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });
});
