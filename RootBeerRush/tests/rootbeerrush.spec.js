const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
// The game never reads wall-clock time inside step(), so the specs can run a
// whole level in a few milliseconds without racing requestAnimationFrame.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with patron spawning switched off so specs that are not about
// spawning stay in full control of what is on the bar.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

// Chromium can report a synthetic key as delivered before the page listener has
// run, so lane changes are confirmed against game state before continuing.
const pressLane = async (page, key, expectedLane) => {
    await page.keyboard.press(key);
    await page.waitForFunction((lane) => barkeep.lane === lane, expectedLane);
};

test.describe('Root Beer Rush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Root Beer Rush', async ({ page }) => {
            await expect(page).toHaveTitle('Root Beer Rush');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and served count', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
            await expect(page.locator('#target')).not.toBeEmpty();
        });

        test('the bar has four lanes', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('no patrons, mugs or empties on the bar', async ({ page }) => {
            const counts = await page.evaluate(() => [patrons.length, mugs.length, empties.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('stepping while idle does not spawn anything', async ({ page }) => {
            await advance(page, 300);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('clicking Start runs the game and hides the overlay', async ({ page }) => {
            await page.click('#btn-start');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('a fresh run resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 5;
                startGame();
            });
            const snap = await page.evaluate(() => ({ score, lives, level, served: served }));
            expect(snap).toEqual({ score: 0, lives: 3, level: 1, served: 0 });
        });

        test('barkeep starts on the top lane', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Barkeep movement
    // -----------------------------------------------------------------------
    test.describe('barkeep movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a lane', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
        });

        test('ArrowUp moves back up a lane', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowUp', 0);
        });

        test('w and s also move the barkeep', async ({ page }) => {
            await pressLane(page, 's', 1);
            await pressLane(page, 'w', 0);
        });

        test('cannot move above the top lane', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await advance(page, 5);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });

        test('cannot move below the bottom lane', async ({ page }) => {
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => barkeep.lane)).toBe(3);
        });

        test('the barkeep cannot change lanes before the game starts', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                barkeep.lane = 0;
            });
            await page.keyboard.press('ArrowDown');
            await advance(page, 5);
            expect(await page.evaluate(() => barkeep.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring and sliding mugs
    // -----------------------------------------------------------------------
    test.describe('pouring mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space slides a mug down the barkeep lane', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(0);
        });

        test('a mug starts at the barkeep end of the bar', async ({ page }) => {
            await page.evaluate(() => pour());
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeGreaterThan(400);
            expect(x).toBeLessThanOrEqual(500);
        });

        test('mugs slide toward the far end of the bar', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
        });

        test('a mug is poured into the lane the barkeep is standing in', async ({ page }) => {
            await pressLane(page, 'ArrowDown', 1);
            await pressLane(page, 'ArrowDown', 2);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a pour cooldown stops mugs stacking on the same frame', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring is allowed again after the cooldown elapses', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 20);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('pouring does nothing while the game is not running', async ({ page }) => {
            await page.evaluate(() => {
                state = 'over';
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

        test('spawnPatron adds a patron at the far end of a lane', async ({ page }) => {
            await page.evaluate(() => spawnPatron(2));
            const p = await page.evaluate(() => ({ lane: patrons[0].lane, x: patrons[0].x }));
            expect(p.lane).toBe(2);
            expect(p.x).toBeLessThan(100);
        });

        test('patrons walk toward the barkeep', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 120);
            const after = await page.evaluate(() => patrons[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('patrons walk faster on later levels', async ({ page }) => {
            const slow = await page.evaluate(() => patronSpeed(1));
            const fast = await page.evaluate(() => patronSpeed(4));
            expect(fast).toBeGreaterThan(slow);
        });

        test('patrons spawn automatically once spawning is enabled', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
            });
            await advance(page, 60 * 5);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });

        test('a level stops spawning once its patron quota is reached', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnTimer = 0;
            });
            await advance(page, 60 * 90);
            expect(await page.evaluate(() => spawned)).toBeLessThanOrEqual(
                await page.evaluate(() => target)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug that reaches a patron is consumed and scores points', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                pour();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('a served patron is pushed back down the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                pour();
            });
            await advance(page, 60);
            const x = await page.evaluate(() => (patrons[0] ? patrons[0].x : -1));
            expect(x).toBeLessThan(300);
        });

        test('a patron drinks before walking back', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                pour();
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 10; i++) step(1 / 60);
                return patrons.length > 0 && patrons[0].mode === 'drinking';
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });

        test('a drinking patron slides an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                pour();
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 20; i++) step(1 / 60);
                return empties.length > 0;
            });
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
        });

        test('a patron pushed off the far end leaves and counts as served', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                pour();
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 20; i++) step(1 / 60);
                return served > 0;
            });
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(100);
        });

        test('the HUD served counter follows the game state', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(1);
                barkeep.lane = 1;
                pour();
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 20; i++) step(1 / 60);
                return served > 0;
            });
            await expect(page.locator('#served')).toHaveText('1');
        });

        test('a shoved patron sweeps the queue behind them back too', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                spawnPatron(0);
                patrons[0].x = 320;
                patrons[1].x = 220;
                pour();
            });
            await advance(page, 60);
            const xs = await page.evaluate(() => patrons.map((p) => p.x).sort((a, b) => b - a));
            expect(xs[0]).toBeLessThan(320);
            expect(xs[1]).toBeLessThan(220);
        });

        test('one mug can clear a bunched-up lane', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(1);
                spawnPatron(1);
                patrons[0].x = 150;
                patrons[1].x = 110;
                barkeep.lane = 1;
                pour();
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 20; i++) step(1 / 60);
                return served >= 2 || state !== 'running';
            });
            expect(await page.evaluate(() => served)).toBe(2);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('walking patrons queue instead of overlapping', async ({ page }) => {
            // The leader nurses their drink, so the one behind walks up and has
            // to stop rather than walking through them.
            await page.evaluate(() => {
                spawnPatron(0);
                spawnPatron(0);
                patrons[0].x = 300;
                patrons[0].mode = 'drinking';
                patrons[0].drinkT = 999;
                patrons[1].x = 200;
            });
            await advance(page, 60 * 5);
            const follower = await page.evaluate(() => patrons[1].x);
            const gap = await page.evaluate(() => patrons[0].x - patrons[1].x);
            expect(follower).toBeGreaterThan(200);
            expect(gap).toBeGreaterThanOrEqual(await page.evaluate(() => PATRON_GAP) - 0.5);
        });

        test('mugs only reach patrons in their own lane', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(2);
                patrons[0].x = 300;
                barkeep.lane = 0;
                pour();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => patrons.length)).toBe(1);
            expect(await page.evaluate(() => patrons[0].mode)).toBe('walking');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('empties slide back toward the barkeep', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 200));
            const before = await page.evaluate(() => empties[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('an empty caught by the barkeep scores points', async ({ page }) => {
            await page.evaluate(() => {
                barkeep.lane = 1;
                score = 0;
                spawnEmpty(1, 200);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 30; i++) step(1 / 60);
                return empties.length === 0;
            });
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty missed by the barkeep costs a life', async ({ page }) => {
            await page.evaluate(() => {
                barkeep.lane = 0;
                spawnEmpty(3, 200);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 30; i++) step(1 / 60);
                return lives < 3;
            });
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives
    // -----------------------------------------------------------------------
    test.describe('losing lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug that runs off the far end costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await page.waitForFunction(() => {
                for (let i = 0; i < 30; i++) step(1 / 60);
                return lives < 3 || mugs.length === 0;
            });
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a patron that reaches the barkeep costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = GRAB_X - 2;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('losing a life pauses the round and clears the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                spawnPatron(1);
                patrons[0].x = GRAB_X - 2;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 60 * 3);
            const counts = await page.evaluate(() => [patrons.length, mugs.length, empties.length]);
            expect(counts).toEqual([0, 0, 0]);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                spawnPatron(0);
                patrons[0].x = GRAB_X - 2;
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 60 * 4; i++) step(1 / 60);
                return state === 'over';
            });
            expect(await page.evaluate(() => lives)).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game can be restarted after a game over', async ({ page }) => {
            await page.evaluate(() => {
                state = 'over';
                showOverlay('GAME OVER', '', 'Press Space to play again');
            });
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('later levels ask for more patrons', async ({ page }) => {
            const first = await page.evaluate(() => levelTarget(1));
            const later = await page.evaluate(() => levelTarget(3));
            expect(later).toBeGreaterThan(first);
        });

        test('later levels spawn patrons more often', async ({ page }) => {
            const early = await page.evaluate(() => spawnInterval(1));
            const late = await page.evaluate(() => spawnInterval(4));
            expect(late).toBeLessThan(early);
        });

        test('clearing the quota advances to the next level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = target;
                served = target;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await advance(page, 60 * 3);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a cleared level awards a bonus and resets the counters', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => {
                spawned = target;
                served = target;
                return score;
            });
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => score)).toBeGreaterThan(before);
            expect(await page.evaluate(() => served)).toBe(0);
            expect(await page.evaluate(() => spawned)).toBe(0);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a level is not cleared while patrons are still on the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = target;
                served = target;
                spawnPatron(0);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes the game', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                togglePause();
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });

        test('the overlay explains how to resume', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / persistence
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the HUD score element tracks the score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                addScore(250);
            });
            await expect(page.locator('#score')).toHaveText('250');
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                addScore(1234);
            });
            const stored = await page.evaluate(() => localStorage.getItem('rootbeerrush-best'));
            expect(Number(stored)).toBe(1234);
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('a stored best score is shown on reload', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('rootbeerrush-best', '4321'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4321');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn, not blank', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(4);
        });

        test('drawing a busy bar does not throw', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let lane = 0; lane < LANES; lane++) {
                    spawnPatron(lane);
                    spawnEmpty(lane, 200);
                    barkeep.lane = lane;
                    barkeep.pourCd = 0;
                    pour();
                }
                for (let i = 0; i < 120; i++) {
                    step(1 / 60);
                    draw();
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('no console errors during a run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (err) => errors.push(err.message));
            await page.goto(GAME_URL);
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 30; i++) step(1 / 60);
            });
            expect(errors).toEqual([]);
        });
    });
});
