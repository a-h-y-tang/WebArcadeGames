const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Farkle', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Farkle', async ({ page }) => {
            await expect(page).toHaveTitle('Farkle');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('total score starts at 0', async ({ page }) => {
            await expect(page.locator('#total')).toHaveText('0');
        });

        test('best shows a dash when unset', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('target is 10000', async ({ page }) => {
            await expect(page.locator('#target')).toHaveText('10000');
            const t = await page.evaluate(() => WIN_TARGET);
            expect(t).toBe(10000);
        });

        test('state is ready before start', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('ready');
        });

        test('canvas has expected size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '150');
        });
    });

    // -----------------------------------------------------------------------
    // scoreDice — the pure scoring core
    // -----------------------------------------------------------------------
    test.describe('scoreDice', () => {
        async function score(page, dice) {
            return page.evaluate(d => scoreDice(d), dice);
        }

        test('single 1 scores 100 and uses all dice', async ({ page }) => {
            expect(await score(page, [1])).toEqual({ score: 100, allUsed: true });
        });

        test('single 5 scores 50', async ({ page }) => {
            expect(await score(page, [5])).toEqual({ score: 50, allUsed: true });
        });

        test('a lone 2 scores nothing and is not all used', async ({ page }) => {
            expect(await score(page, [2])).toEqual({ score: 0, allUsed: false });
        });

        test('1 and 5 together score 150, all used', async ({ page }) => {
            expect(await score(page, [1, 5])).toEqual({ score: 150, allUsed: true });
        });

        test('1 with a 2 scores 100 but is not all used', async ({ page }) => {
            const r = await score(page, [1, 2]);
            expect(r.score).toBe(100);
            expect(r.allUsed).toBe(false);
        });

        test('2-3-4 scores nothing', async ({ page }) => {
            expect(await score(page, [2, 3, 4])).toEqual({ score: 0, allUsed: false });
        });

        test('three 1s score 1000', async ({ page }) => {
            expect(await score(page, [1, 1, 1])).toEqual({ score: 1000, allUsed: true });
        });

        test('three 2s score 200', async ({ page }) => {
            expect(await score(page, [2, 2, 2])).toEqual({ score: 200, allUsed: true });
        });

        test('three 6s score 600', async ({ page }) => {
            expect(await score(page, [6, 6, 6])).toEqual({ score: 600, allUsed: true });
        });

        test('four of a kind scores 1000', async ({ page }) => {
            expect(await score(page, [3, 3, 3, 3])).toEqual({ score: 1000, allUsed: true });
        });

        test('five of a kind scores 2000', async ({ page }) => {
            expect(await score(page, [4, 4, 4, 4, 4])).toEqual({ score: 2000, allUsed: true });
        });

        test('six of a kind scores 3000', async ({ page }) => {
            expect(await score(page, [2, 2, 2, 2, 2, 2])).toEqual({ score: 3000, allUsed: true });
        });

        test('straight 1-6 scores 1500', async ({ page }) => {
            expect(await score(page, [1, 2, 3, 4, 5, 6])).toEqual({ score: 1500, allUsed: true });
        });

        test('three pairs score 1500', async ({ page }) => {
            expect(await score(page, [2, 2, 4, 4, 6, 6])).toEqual({ score: 1500, allUsed: true });
        });

        test('three 1s plus a 5 score 1050, all used', async ({ page }) => {
            expect(await score(page, [1, 1, 1, 5])).toEqual({ score: 1050, allUsed: true });
        });

        test('mixed roll scores the scoring dice only, not all used', async ({ page }) => {
            // 1(100) + three 2s(200) + 5(50) = 350; the lone 3 is unused.
            const r = await score(page, [1, 2, 2, 2, 3, 5]);
            expect(r.score).toBe(350);
            expect(r.allUsed).toBe(false);
        });

        test('two triplets score as two threes-of-a-kind', async ({ page }) => {
            // three 2s (200) + three 3s (300) = 500, all six used.
            expect(await score(page, [2, 2, 2, 3, 3, 3])).toEqual({ score: 500, allUsed: true });
        });
    });

    // -----------------------------------------------------------------------
    // hasScore
    // -----------------------------------------------------------------------
    test.describe('hasScore', () => {
        test('a roll with a 1 has score', async ({ page }) => {
            expect(await page.evaluate(() => hasScore([2, 3, 4, 6, 1]))).toBe(true);
        });

        test('a roll of 2-3-3-4-6 has no score (farkle)', async ({ page }) => {
            expect(await page.evaluate(() => hasScore([2, 3, 3, 4, 6]))).toBe(false);
        });

        test('a triple makes a roll score', async ({ page }) => {
            expect(await page.evaluate(() => hasScore([3, 3, 3, 4, 6])).valueOf()).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('start', () => {
        test('startGame moves to playing with six dice and turn 1', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                return { state, turnNumber, remainingDice, turnPhase, totalScore, turnScore };
            });
            expect(r.state).toBe('playing');
            expect(r.turnNumber).toBe(1);
            expect(r.remainingDice).toBe(6);
            expect(r.turnPhase).toBe('await-roll');
            expect(r.totalScore).toBe(0);
            expect(r.turnScore).toBe(0);
        });

        test('overlay hides after starting', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Rolling
    // -----------------------------------------------------------------------
    test.describe('roll', () => {
        test('a scoring roll enters the select phase', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 2, 3, 3, 4, 6]; // has a 1
                roll();
                return { turnPhase, dice };
            });
            expect(r.turnPhase).toBe('select');
            expect(r.dice).toEqual([1, 2, 3, 3, 4, 6]);
        });

        test('a farkle roll ends the turn and clears turn score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                turnScore = 450;                 // pretend points were accrued
                rollNDice = () => [2, 3, 3, 4, 6]; // no scoring dice
                roll();
                return { turnPhase, turnScore, turnNumber, state };
            });
            expect(r.turnScore).toBe(0);
            expect(r.turnNumber).toBe(2);       // advanced to next turn
            expect(r.turnPhase).toBe('await-roll');
            expect(r.state).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Selecting and setting aside
    // -----------------------------------------------------------------------
    test.describe('set aside', () => {
        test('toggleSelect only works in the select phase', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame(); // await-roll phase
                toggleSelect(0);
                return selected[0] === true;
            });
            expect(r).toBe(false);
        });

        test('setting aside scoring dice adds to the turn score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 5, 2, 3, 4, 6];
                roll();          // select phase
                toggleSelect(0); // the 1
                toggleSelect(1); // the 5
                const ok = setAside();
                return { ok, turnScore, remainingDice, turnPhase };
            });
            expect(r.ok).toBe(true);
            expect(r.turnScore).toBe(150);
            expect(r.remainingDice).toBe(4); // 6 - 2 set aside
            expect(r.turnPhase).toBe('await-roll');
        });

        test('setting aside a non-scoring selection is rejected', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 2, 3, 3, 4, 6];
                roll();
                toggleSelect(1); // the 2 — does not score
                const ok = setAside();
                return { ok, turnScore, turnPhase };
            });
            expect(r.ok).toBe(false);
            expect(r.turnScore).toBe(0);
            expect(r.turnPhase).toBe('select'); // still choosing
        });

        test('an empty selection cannot be set aside', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 2, 3, 3, 4, 6];
                roll();
                return setAside();
            });
            expect(r).toBe(false);
        });

        test('setting aside all six dice grants hot dice (reset to six)', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 1, 1, 5, 5, 5];
                roll();
                for (let i = 0; i < 6; i++) toggleSelect(i);
                const ok = setAside();
                return { ok, turnScore, remainingDice };
            });
            expect(r.ok).toBe(true);
            expect(r.turnScore).toBe(1500); // three 1s (1000) + three 5s (500)
            expect(r.remainingDice).toBe(6); // hot dice
        });
    });

    // -----------------------------------------------------------------------
    // Banking
    // -----------------------------------------------------------------------
    test.describe('bank', () => {
        test('banking adds the turn score to the total and ends the turn', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                rollNDice = () => [1, 5, 2, 3, 4, 6];
                roll();
                toggleSelect(0);
                toggleSelect(1);
                setAside();       // turnScore 150
                bank();
                return { totalScore, turnScore, turnNumber, turnPhase };
            });
            expect(r.totalScore).toBe(150);
            expect(r.turnScore).toBe(0);
            expect(r.turnNumber).toBe(2);
            expect(r.turnPhase).toBe('await-roll');
        });

        test('cannot bank with no turn score', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                bank();
                return { totalScore, turnNumber };
            });
            expect(r.totalScore).toBe(0);
            expect(r.turnNumber).toBe(1); // no turn consumed
        });

        test('reaching the target wins and records the best turn count', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                totalScore = 9900;
                turnNumber = 7;
                rollNDice = () => [1, 5, 2, 3, 4, 6];
                roll();
                toggleSelect(0); // 1 -> 100
                setAside();      // turnScore 100 -> total would be 10000
                bank();
                return { state, totalScore, best };
            });
            expect(r.state).toBe('over');
            expect(r.totalScore).toBe(10000);
            expect(r.best).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // Buttons / keyboard
    // -----------------------------------------------------------------------
    test.describe('input wiring', () => {
        test('Roll button rolls the dice', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.locator('#btn-roll').click();
            const phase = await page.evaluate(() => turnPhase);
            // Either it scored (select) or farkled (await-roll) — but dice were rolled.
            const dice = await page.evaluate(() => dice.length);
            expect(dice).toBe(6);
            expect(['select', 'await-roll']).toContain(phase);
        });

        test('R key rolls', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { rollNDice = () => [1, 2, 3, 3, 4, 6]; });
            await page.locator('body').press('r');
            const phase = await page.evaluate(() => turnPhase);
            expect(phase).toBe('select');
        });
    });
});
