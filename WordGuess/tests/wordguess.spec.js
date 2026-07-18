const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Word Guess', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / static state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Word Guess', async ({ page }) => {
            await expect(page).toHaveTitle('Word Guess');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('streak starts at 0', async ({ page }) => {
            await expect(page.locator('#streak')).toHaveText('0');
        });

        test('best starts at 0 with empty localStorage', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 400x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are five columns and six rows', async ({ page }) => {
            const dims = await page.evaluate(() => ({ len: WORD_LEN, rows: MAX_ROWS }));
            expect(dims.len).toBe(5);
            expect(dims.rows).toBe(6);
        });

        test('the word list is non-empty and all words are five letters', async ({ page }) => {
            const ok = await page.evaluate(() =>
                WORDS.length > 0 && WORDS.every(w => w.length === WORD_LEN));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('overlay hides after starting', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the answer is a valid five-letter word from the list', async ({ page }) => {
            await page.keyboard.press(' ');
            const ok = await page.evaluate(() =>
                answer.length === WORD_LEN && WORDS.includes(answer));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring (evaluate) — pure logic
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('an exact match is all correct', async ({ page }) => {
            const marks = await page.evaluate(() => evaluate('crane', 'crane'));
            expect(marks).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);
        });

        test('a disjoint guess is all absent', async ({ page }) => {
            const marks = await page.evaluate(() => evaluate('fudgy', 'crank'));
            expect(marks).toEqual(['absent', 'absent', 'absent', 'absent', 'absent']);
        });

        test('present letters are marked when in the wrong position', async ({ page }) => {
            const marks = await page.evaluate(() => evaluate('react', 'crane'));
            // r(present) e(present) a(correct) c(present) t(absent)
            expect(marks).toEqual(['present', 'present', 'correct', 'present', 'absent']);
        });

        test('duplicate guessed letters respect the answer letter count', async ({ page }) => {
            // answer 'abbey' has two b's; guess 'bobby' has three b's.
            const marks = await page.evaluate(() => evaluate('bobby', 'abbey'));
            // b(present) o(absent) b(correct) b(absent) y(correct)
            expect(marks).toEqual(['present', 'absent', 'correct', 'absent', 'correct']);
        });
    });

    // -----------------------------------------------------------------------
    // Typing
    // -----------------------------------------------------------------------
    test.describe('typing', () => {
        test('typing letters fills the current row', async ({ page }) => {
            const cur = await page.evaluate(() => {
                startGame('crane');
                typeLetter('h');
                typeLetter('e');
                typeLetter('l');
                return current;
            });
            expect(cur).toBe('hel');
        });

        test('backspace removes the last letter', async ({ page }) => {
            const cur = await page.evaluate(() => {
                startGame('crane');
                typeLetter('a');
                typeLetter('b');
                backspace();
                return current;
            });
            expect(cur).toBe('a');
        });

        test('typing does not exceed the word length', async ({ page }) => {
            const cur = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'abcdefgh') typeLetter(ch);
                return current;
            });
            expect(cur.length).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Submitting guesses
    // -----------------------------------------------------------------------
    test.describe('submitting', () => {
        test('an incomplete guess is rejected', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                typeLetter('a');
                typeLetter('b');
                return submitGuess();
            });
            expect(res.ok).toBe(false);
            expect(res.invalid).toBe(true);
        });

        test('a word not in the list is rejected', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'zzzzz') typeLetter(ch);
                return { r: submitGuess(), rows: guesses.length };
            });
            expect(res.r.ok).toBe(false);
            expect(res.r.invalid).toBe(true);
            expect(res.rows).toBe(0);
        });

        test('a valid guess is accepted and recorded with marks', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'react') typeLetter(ch);
                const r = submitGuess();
                return { r, rows: guesses.length, current };
            });
            expect(res.r.ok).toBe(true);
            expect(res.r.marks.length).toBe(5);
            expect(res.rows).toBe(1);
            // The current row is cleared after a successful submit.
            expect(res.current).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // Win / lose
    // -----------------------------------------------------------------------
    test.describe('win and lose', () => {
        test('guessing the answer wins the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'crane') typeLetter(ch);
                const r = submitGuess();
                return { r, state };
            });
            expect(res.r.won).toBe(true);
            expect(res.state).toBe('won');
        });

        test('a win shows a congratulatory overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'crane') typeLetter(ch);
                submitGuess();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|nice|got it|splendid/i);
        });

        test('six wrong guesses lose the game and reveal the answer', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                for (let i = 0; i < 6; i++) {
                    for (const ch of 'moldy') typeLetter(ch);
                    submitGuess();
                }
                return { state, rows: guesses.length };
            });
            expect(res.state).toBe('lost');
            expect(res.rows).toBe(6);
            await expect(page.locator('#overlay-score')).toContainText(/crane/i);
        });

        test('no input is accepted after the game is over', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'crane') typeLetter(ch);
                submitGuess(); // win
                typeLetter('x'); // ignored
                return current;
            });
            expect(res).toBe('');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard hint state
    // -----------------------------------------------------------------------
    test.describe('keyboard hints', () => {
        test('letters gain their best discovered state', async ({ page }) => {
            const states = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'react') typeLetter(ch);
                submitGuess();
                return { a: keyState('a'), c: keyState('c'), t: keyState('t') };
            });
            expect(states.a).toBe('correct'); // 'a' is in the right spot
            expect(states.c).toBe('present'); // 'c' is in the word, wrong spot
            expect(states.t).toBe('absent'); // 't' not in the word
        });

        test('correct outranks a previous present for the same letter', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'react') typeLetter(ch); // 'r' is present (pos 0)
                submitGuess();
                for (const ch of 'brave') typeLetter(ch); // 'r' now correct (pos 1)
                submitGuess();
                return keyState('r');
            });
            expect(s).toBe('correct');
        });
    });

    // -----------------------------------------------------------------------
    // Streak persistence
    // -----------------------------------------------------------------------
    test.describe('streak', () => {
        test('a win increases the streak and best, and best persists', async ({ page }) => {
            await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'crane') typeLetter(ch);
                submitGuess();
            });
            await expect(page.locator('#streak')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('1');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1');
        });

        test('a loss resets the current streak to zero', async ({ page }) => {
            const streakAfter = await page.evaluate(() => {
                startGame('crane');
                for (const ch of 'crane') typeLetter(ch);
                submitGuess(); // win -> streak 1
                startGame('crane');
                for (let i = 0; i < 6; i++) {
                    for (const ch of 'moldy') typeLetter(ch);
                    submitGuess();
                }
                return streak;
            });
            expect(streakAfter).toBe(0);
        });
    });
});
