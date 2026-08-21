const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt). The
// real animation loop keeps running in the page, but with spawning frozen it
// has nothing to do, so the specs stay reproducible.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with the patron spawner switched off, so every spec controls
// exactly which patrons exist. Specs that are about the spawner turn it on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        patrons.length = 0;
        pending = 0;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so row changes are confirmed against game state before continuing.
const pressRow = async (page, key, expectedRow) => {
    await page.keyboard.press(key);
    await page.waitForFunction((r) => bartender.row === r, expectedRow);
};

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => localStorage.removeItem('tapper-best'));
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('there are four counters', async ({ page }) => {
            expect(await page.evaluate(() => ROW_Y.length)).toBe(4);
        });

        test('the bar is empty', async ({ page }) => {
            const counts = await page.evaluate(() => [
                mugs.length,
                emptyMugs.length,
                patrons.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('step does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('starting resets score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                level = 4;
                lives = 1;
                startGame();
            });
            expect(await page.evaluate(() => [score, level, lives])).toEqual([0, 1, 3]);
        });

        test('the bartender starts on the bottom counter', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => bartender.row)).toBe(3);
        });

        test('a wave of patrons is queued', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => pending + patrons.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowUp moves up one counter', async ({ page }) => {
            await pressRow(page, 'ArrowUp', 2);
            await pressRow(page, 'ArrowUp', 1);
        });

        test('ArrowDown moves back down one counter', async ({ page }) => {
            await pressRow(page, 'ArrowUp', 2);
            await pressRow(page, 'ArrowDown', 3);
        });

        test('W and S also move between counters', async ({ page }) => {
            await pressRow(page, 'w', 2);
            await pressRow(page, 's', 3);
        });

        test('cannot move above the top counter', async ({ page }) => {
            await pressRow(page, 'ArrowUp', 2);
            await pressRow(page, 'ArrowUp', 1);
            await pressRow(page, 'ArrowUp', 0);
            await page.keyboard.press('ArrowUp');
            await advance(page, 5);
            expect(await page.evaluate(() => bartender.row)).toBe(0);
        });

        test('cannot move below the bottom counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => bartender.row)).toBe(3);
        });

        test('movement is ignored when the game is over', async ({ page }) => {
            await page.evaluate(() => {
                state = 'over';
                bartender.row = 2;
            });
            await page.keyboard.press('ArrowUp');
            await advance(page, 5);
            expect(await page.evaluate(() => bartender.row)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space pours a mug on the current counter', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].row)).toBe(3);
        });

        test('a poured mug starts at the right end of the counter', async ({ page }) => {
            await page.evaluate(() => pour());
            const [x, right] = await page.evaluate(() => [mugs[0].x, COUNTER_RIGHT]);
            expect(x).toBeLessThanOrEqual(right);
            expect(x).toBeGreaterThan(right - 40);
        });

        test('a poured mug slides left', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before - 50);
        });

        test('the pour cooldown blocks an instant second mug', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring is allowed again after the cooldown', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('mugs can be poured onto different counters', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await pressRow(page, 'ArrowUp', 2);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.map((m) => m.row))).toEqual([3, 2]);
        });

        test('pouring does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a spawned patron stands at the left end of its counter', async ({ page }) => {
            await page.evaluate(() => spawnPatron(1));
            const [row, x, left] = await page.evaluate(() => [
                patrons[0].row,
                patrons[0].x,
                COUNTER_LEFT,
            ]);
            expect(row).toBe(1);
            expect(x).toBeGreaterThanOrEqual(left);
            expect(x).toBeLessThan(left + 40);
        });

        test('a patron advances toward the bartender', async ({ page }) => {
            await page.evaluate(() => spawnPatron(1));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(before);
        });

        test('patrons walk faster on later levels', async ({ page }) => {
            const walk = async (lvl) =>
                page.evaluate((l) => {
                    startGame();
                    spawnEnabled = false;
                    patrons.length = 0;
                    pending = 0;
                    level = l;
                    spawnPatron(0);
                    const from = patrons[0].x;
                    for (let i = 0; i < 60; i++) step(1 / 60);
                    return patrons[0].x - from;
                }, lvl);
            const slow = await walk(1);
            const fast = await walk(5);
            expect(fast).toBeGreaterThan(slow);
        });

        test('a patron reaching the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(2);
                patrons[0].x = GRAB_X - 4;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a mug pushes the patron it reaches back toward the door', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                patrons[0].x = 400;
                pour();
            });
            await page.waitForFunction(() => patrons.length === 0 || patrons[0].x < 400);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(400);
        });

        test('a served patron sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                patrons[0].x = 400;
                pour();
            });
            // Asserted inside the wait: the empty mug is caught a moment later,
            // so reading it back in a second round-trip would race the loop.
            await page.waitForFunction(() => emptyMugs.length === 1 && emptyMugs[0].row === 3);
        });

        test('the full mug is consumed when it reaches a patron', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                patrons[0].x = 400;
                pour();
            });
            await page.waitForFunction(() => emptyMugs.length === 1);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a drinking patron does not advance', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                patrons[0].x = 400;
                pour();
            });
            await page.waitForFunction(() => patrons[0].drinkTimer > 0);
            // Hold the drink open so the assertion measures the freeze, not how
            // fast the round-trip was.
            const x = await page.evaluate(() => {
                patrons[0].drinkTimer = 5;
                return patrons[0].x;
            });
            await advance(page, 20);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(x, 5);
        });

        test('a mug hits the nearest patron, not the one behind it', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                spawnPatron(3);
                patrons[0].x = 200;
                patrons[1].x = 450;
                pour();
            });
            await page.waitForFunction(() => patrons[1].x < 450);
            // The patron behind kept walking forward; it was never pushed back.
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThanOrEqual(200);
        });

        test('a patron pushed past the door is served and scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                pour();
            });
            await page.waitForFunction(() => patrons.length === 0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        // These run to completion inside one evaluate: the trailing mugs they
        // set up would otherwise reach the end of their counter in real time
        // and shatter before the assertion could read them back.
        const serveWithTrailing = (page, extraMugs) =>
            page.evaluate((extra) => {
                spawnPatron(3);
                mugs.push({ row: 3, x: PATRON_SPAWN_X + 30 });   // about to land
                for (const m of extra) mugs.push(m);
                for (let i = 0; i < 60 && patrons.length; i++) step(1 / 60);
                return { served: patrons.length === 0, mugs: mugs.map((m) => m.row), score };
            }, extraMugs);

        test('a departing patron takes one trailing mug with them', async ({ page }) => {
            const after = await serveWithTrailing(page, [{ row: 3, x: 300 }]);
            expect(after.served).toBe(true);
            expect(after.mugs).toEqual([]);
        });

        test('the trailing mug is a tip on top of the serve', async ({ page }) => {
            const plain = await serveWithTrailing(page, []);
            await startQuiet(page);
            const tipped = await serveWithTrailing(page, [{ row: 3, x: 300 }]);
            expect(tipped.score).toBeGreaterThan(plain.score);
        });

        test('taking a trailing mug costs no life', async ({ page }) => {
            await serveWithTrailing(page, [{ row: 3, x: 300 }]);
            await advance(page, 240);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('only one trailing mug goes out the door', async ({ page }) => {
            const after = await serveWithTrailing(page, [
                { row: 3, x: 300 },
                { row: 3, x: 340 },
            ]);
            expect(after.mugs).toEqual([3]);
        });

        test('a trailing mug on another counter is untouched', async ({ page }) => {
            const after = await serveWithTrailing(page, [{ row: 0, x: 300 }]);
            expect(after.mugs).toEqual([0]);
        });

        test('the served counter reflects satisfied patrons', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(3);
                pour();
            });
            await page.waitForFunction(() => served === 1);
            await expect(page.locator('#served')).toContainText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides toward the bartender', async ({ page }) => {
            await page.evaluate(() => {
                emptyMugs.push({ row: 0, x: 200 });
            });
            await advance(page, 20);
            expect(await page.evaluate(() => emptyMugs[0].x)).toBeGreaterThan(200);
        });

        test('the bartender catches an empty mug on their counter', async ({ page }) => {
            await page.evaluate(() => {
                score = 0;
                emptyMugs.push({ row: 3, x: 500 });
            });
            await page.waitForFunction(() => emptyMugs.length === 0 || score > 0);
            await advance(page, 120);
            expect(await page.evaluate(() => emptyMugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty mug on another counter shatters and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                emptyMugs.push({ row: 0, x: 500 });
            });
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => emptyMugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Wasted mugs
    // -----------------------------------------------------------------------
    test.describe('wasted mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug poured down an empty counter shatters', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 240);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life clears the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                spawnPatron(1);
                pour();
            });
            await advance(page, 240);
            const counts = await page.evaluate(() => [
                mugs.length,
                emptyMugs.length,
                patrons.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('two disasters in one frame only cost one life', async ({ page }) => {
            await page.evaluate(() => {
                mugs.push({ row: 0, x: COUNTER_LEFT + 1 });
                mugs.push({ row: 1, x: COUNTER_LEFT + 1 });
                step(1 / 60);
            });
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 420;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('420');
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => localStorage.getItem('tapper-best'))).toBe('777');
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the simulation is frozen after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                lives = 1;
                loseLife();
                spawnPatron(0);
            });
            const x = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(x, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing the wave advances the level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(3);
                pour();
            });
            await page.waitForFunction(() => level === 2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('clearing the wave awards a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(3);
                pour();
            });
            await page.waitForFunction(() => level === 2);
            expect(await page.evaluate(() => score)).toBeGreaterThan(100);
        });

        test('the next wave is larger than the last', async ({ page }) => {
            const sizes = await page.evaluate(() => [waveSize(1), waveSize(2), waveSize(3)]);
            expect(sizes[1]).toBeGreaterThan(sizes[0]);
            expect(sizes[2]).toBeGreaterThan(sizes[1]);
        });

        test('a level in progress does not advance early', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                pending = 2;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Spawner
    // -----------------------------------------------------------------------
    test.describe('spawner', () => {
        test('patrons arrive over time', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 600);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });

        test('the spawner draws down the pending queue', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => pending);
            await advance(page, 600);
            expect(await page.evaluate(() => pending)).toBeLessThan(before);
        });

        test('spawning is reproducible for a given seed', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    for (let i = 0; i < 900; i++) step(1 / 60);
                    return patrons.map((p) => p.row).join(',');
                });
            expect(await run()).toBe(await run());
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            const x = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(x, 5);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button resumes from pause without resetting', async ({ page }) => {
            await page.evaluate(() => {
                score = 250;
                togglePause();
            });
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(250);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                pour();
                emptyMugs.push({ row: 1, x: 300 });
                draw();
            });
            const painted = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const { data } = ctx.getImageData(0, 0, 640, 480);
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(5);
        });
    });
});
