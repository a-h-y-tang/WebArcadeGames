const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Roll a list of pin counts in sequence.
async function rollMany(page, counts) {
    return page.evaluate((cs) => {
        newGame();
        for (const c of cs) roll(c);
        return { rolls: rolls.slice(), frame, over, frames: frameScores(rolls), total: totalScore() };
    }, counts);
}

test.describe('Bowling', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => newGame());
    });

    // -----------------------------------------------------------------------
    // Page / DOM
    // -----------------------------------------------------------------------
    test.describe('page & DOM', () => {
        test('title is Bowling', async ({ page }) => {
            await expect(page).toHaveTitle('Bowling');
        });

        test('canvas exists', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveCount(1);
        });

        test('start overlay is visible initially', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('has a start button', async ({ page }) => {
            await expect(page.locator('#btn-start')).toBeVisible();
        });

        test('a scorecard is rendered', async ({ page }) => {
            await expect(page.locator('#scorecard')).toHaveCount(1);
        });
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('starts on frame 1, ball 1, not over', async ({ page }) => {
            const s = await page.evaluate(() => ({ frame, ballInFrame, over, rolls: rolls.length }));
            expect(s.frame).toBe(1);
            expect(s.ballInFrame).toBe(1);
            expect(s.over).toBe(false);
            expect(s.rolls).toBe(0);
        });

        test('all ten pins stand at the start', async ({ page }) => {
            const n = await page.evaluate(() => standingPins().length);
            expect(n).toBe(10);
        });

        test('there are exactly 10 pins defined in a valid triangle', async ({ page }) => {
            const rows = await page.evaluate(() => {
                const byRow = {};
                for (const p of PINS) byRow[p.row] = (byRow[p.row] || 0) + 1;
                return byRow;
            });
            expect(rows).toEqual({ 0: 1, 1: 2, 2: 3, 3: 4 });
        });
    });

    // -----------------------------------------------------------------------
    // Scoring engine (the classic kata)
    // -----------------------------------------------------------------------
    test.describe('scoring engine', () => {
        test('a gutter game scores 0', async ({ page }) => {
            const r = await rollMany(page, Array(20).fill(0));
            expect(r.total).toBe(0);
            expect(r.over).toBe(true);
            expect(r.frames[9]).toBe(0);
        });

        test('all ones scores 20', async ({ page }) => {
            const r = await rollMany(page, Array(20).fill(1));
            expect(r.total).toBe(20);
        });

        test('a spare is 10 plus the next ball', async ({ page }) => {
            // 5,5 (spare) then 3 -> frame 1 = 13; then 3,0 -> frame 2 = 16
            const r = await rollMany(page, [5, 5, 3, 0, ...Array(16).fill(0)]);
            expect(r.frames[0]).toBe(13);
            expect(r.frames[1]).toBe(16);
        });

        test('a strike is 10 plus the next two balls', async ({ page }) => {
            // strike then 4,3 -> frame 1 = 17; frame 2 = 17 + 7 = 24
            const r = await rollMany(page, [10, 4, 3, ...Array(16).fill(0)]);
            expect(r.frames[0]).toBe(17);
            expect(r.frames[1]).toBe(24);
        });

        test('a perfect game scores 300 in exactly 12 rolls', async ({ page }) => {
            const r = await rollMany(page, Array(12).fill(10));
            expect(r.total).toBe(300);
            expect(r.over).toBe(true);
            expect(r.rolls).toHaveLength(12);
            expect(r.frames[9]).toBe(300);
        });

        test('all spares of 5 then a bonus 5 scores 150', async ({ page }) => {
            const counts = [];
            for (let i = 0; i < 10; i++) counts.push(5, 5);
            counts.push(5); // 10th-frame bonus ball
            const r = await rollMany(page, counts);
            expect(r.total).toBe(150);
            expect(r.rolls).toHaveLength(21);
        });

        test('a known mixed game scores correctly', async ({ page }) => {
            // A well-known sample game that scores 133.
            const counts = [1, 4, 4, 5, 6, 4, 5, 5, 10, 0, 1, 7, 3, 6, 4, 10, 2, 8, 6];
            const r = await rollMany(page, counts);
            expect(r.total).toBe(133);
        });

        test('cumulative score is blank for an unresolved strike', async ({ page }) => {
            // Strike on frame 1 with no following balls yet -> frame 1 pending.
            const r = await page.evaluate(() => {
                newGame();
                roll(10);
                return frameScores(rolls);
            });
            expect(r[0]).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Frame / ball flow
    // -----------------------------------------------------------------------
    test.describe('frame flow', () => {
        test('a strike advances to the next frame after one ball', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                roll(10);
                return { frame, ballInFrame };
            });
            expect(s.frame).toBe(2);
            expect(s.ballInFrame).toBe(1);
        });

        test('an open frame uses two balls before advancing', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                roll(3);
                const afterFirst = { frame, ballInFrame };
                roll(4);
                const afterSecond = { frame, ballInFrame };
                return { afterFirst, afterSecond };
            });
            expect(s.afterFirst).toEqual({ frame: 1, ballInFrame: 2 });
            expect(s.afterSecond).toEqual({ frame: 2, ballInFrame: 1 });
        });

        test('the 10th frame grants a third ball after a strike', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                for (let i = 0; i < 9; i++) roll(10); // 9 strikes -> frame 10
                const atTenth = frame;
                roll(10); // strike in 10th
                roll(10); // bonus 1
                const beforeThird = over;
                roll(10); // bonus 2
                return { atTenth, beforeThird, over, rolls: rolls.length };
            });
            expect(s.atTenth).toBe(10);
            expect(s.beforeThird).toBe(false);
            expect(s.over).toBe(true);
            expect(s.rolls).toBe(12);
        });

        test('the 10th frame grants no third ball on an open frame', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                for (let i = 0; i < 9; i++) { roll(0); roll(0); } // 9 open frames
                roll(3);
                roll(4); // open 10th, no bonus
                return { over, rolls: rolls.length };
            });
            expect(s.over).toBe(true);
            expect(s.rolls).toBe(20);
        });

        test('rolling is ignored once the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                for (let i = 0; i < 20; i++) roll(0);
                const before = rolls.length;
                const accepted = roll(5);
                return { before, accepted, after: rolls.length };
            });
            expect(s.before).toBe(20);
            expect(s.accepted).toBe(false);
            expect(s.after).toBe(20);
        });
    });

    // -----------------------------------------------------------------------
    // Pin physics (knockPins / bowl)
    // -----------------------------------------------------------------------
    test.describe('pin physics', () => {
        test('a centred ball is a strike', async ({ page }) => {
            const n = await page.evaluate(() => {
                const standing = new Set(PINS.map((p) => p.id));
                return knockPins(0, standing).size;
            });
            expect(n).toBe(10);
        });

        test('a ball far into the gutter knocks nothing down', async ({ page }) => {
            const n = await page.evaluate(() => {
                const standing = new Set(PINS.map((p) => p.id));
                return knockPins(AIM_RANGE * 1.5, standing).size;
            });
            expect(n).toBe(0);
        });

        test('knockPins is deterministic for the same input', async ({ page }) => {
            const eq = await page.evaluate(() => {
                const s1 = new Set(PINS.map((p) => p.id));
                const s2 = new Set(PINS.map((p) => p.id));
                const a = [...knockPins(0.4, s1)].sort((x, y) => x - y);
                const b = [...knockPins(0.4, s2)].sort((x, y) => x - y);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(eq).toBe(true);
        });

        test('bowl() records the pins knocked down and can produce a strike', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                bowl(0); // aim dead centre
                return { rolls: rolls.slice(), frame };
            });
            expect(s.rolls[0]).toBe(10);
            expect(s.frame).toBe(2);
        });

        test('a second ball can pick up the spare on remaining pins', async ({ page }) => {
            const s = await page.evaluate(() => {
                newGame();
                bowl(0.85);       // edge hit: knocks only some pins
                const first = rolls[0];
                bowl(-0.85);      // opposite edge on remaining pins
                return { first, rolls: rolls.slice() };
            });
            expect(s.first).toBeGreaterThan(0);
            expect(s.first).toBeLessThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------
    test.describe('UI', () => {
        test('clicking start hides the overlay and enters aiming state', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the scorecard total updates after bowling', async ({ page }) => {
            await page.evaluate(() => {
                newGame();
                startGame();
                bowl(0);   // strike
                bowl(-0.9);
                bowl(0.9);
            });
            const shown = await page.locator('#total').textContent();
            expect(Number(shown)).toBeGreaterThan(0);
        });
    });
});
