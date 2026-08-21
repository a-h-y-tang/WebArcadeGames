const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with patron spawning switched off, so the specs decide exactly
// which patrons exist. Specs about spawning leave it on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        patrons.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });

// Step in small batches until a condition holds in the page, so specs never
// have to guess an exact frame count.
const advanceUntil = async (page, predicate, batches = 60, perBatch = 10) => {
    for (let i = 0; i < batches; i++) {
        if (await page.evaluate(predicate)) return true;
        await advance(page, perBatch);
    }
    return page.evaluate(predicate);
};

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against game state before advancing.
const pressAndSettle = async (page, key, predicate, arg) => {
    await page.keyboard.press(key);
    await page.waitForFunction(predicate, arg);
};

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible with a prompt', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '3300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3300');
        });

        test('there are four lanes with increasing y positions', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANES }, (_, i) => laneY(i))
            );
            expect(ys).toHaveLength(4);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
            expect(Math.max(...ys)).toBeLessThan(480);
        });

        test('stepping while idle does nothing', async ({ page }) => {
            await page.evaluate(() => {
                patrons.push(makePatron(0));
            });
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
            await pressAndSettle(page, 'Space', () => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await pressAndSettle(page, 'Enter', () => state === 'running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('a fresh game resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 4;
                startGame();
            });
            expect(await page.evaluate(() => ({ score, lives, level }))).toEqual({
                score: 0,
                lives: 3,
                level: 1,
            });
        });

        test('the bartender starts on the top lane at the tap end', async ({ page }) => {
            await startQuiet(page);
            const b = await page.evaluate(() => ({ lane: bartender.lane, x: bartender.x }));
            expect(b.lane).toBe(0);
            expect(b.x).toBeGreaterThan(320);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown moves down a lane', async ({ page }) => {
            await pressAndSettle(page, 'ArrowDown', () => bartender.lane === 1);
        });

        test('ArrowUp moves back up a lane', async ({ page }) => {
            await pressAndSettle(page, 'ArrowDown', () => bartender.lane === 1);
            await pressAndSettle(page, 'ArrowUp', () => bartender.lane === 0);
        });

        test('S and W also move between lanes', async ({ page }) => {
            await pressAndSettle(page, 's', () => bartender.lane === 1);
            await pressAndSettle(page, 'w', () => bartender.lane === 0);
        });

        test('cannot move above the top lane', async ({ page }) => {
            await pressAndSettle(page, 'ArrowUp', () => bartender.lane === 0);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('cannot move below the bottom lane', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = LANES - 1;
            });
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => bartender.lane === LANES - 1)).toBe(true);
        });

        test('the bartender y follows its lane', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 2;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => bartender.y)).toBeCloseTo(
                await page.evaluate(() => laneY(2)),
                1
            );
        });

        test('lane keys do nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                bartender.lane = 0;
            });
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space serves a mug on the current lane', async ({ page }) => {
            await pressAndSettle(page, 'Space', () => mugs.length === 1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(0);
        });

        test('a served mug starts at the tap end', async ({ page }) => {
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs[0].x)).toBeGreaterThan(500);
        });

        test('a served mug slides left', async ({ page }) => {
            await page.evaluate(() => serve());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('serving on lane 2 puts the mug on lane 2', async ({ page }) => {
            await page.evaluate(() => {
                bartender.lane = 2;
                serve();
            });
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('separate presses serve separate mugs', async ({ page }) => {
            await page.evaluate(() => {
                serve();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('serving does nothing while paused', async ({ page }) => {
            await page.evaluate(() => {
                state = 'paused';
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a mug that runs off the bar is smashed and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                serve();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a spawned patron enters at the far end of its lane', async ({ page }) => {
            await page.evaluate(() => spawnPatron(1));
            const p = await page.evaluate(() => ({ lane: patrons[0].lane, x: patrons[0].x }));
            expect(p.lane).toBe(1);
            expect(p.x).toBeLessThan(120);
        });

        test('patrons advance toward the tap', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(before);
        });

        test('patrons move faster on later levels', async ({ page }) => {
            const speedAt = (lvl) =>
                page.evaluate((l) => {
                    level = l;
                    return patronSpeed();
                }, lvl);
            expect(await speedAt(3)).toBeGreaterThan(await speedAt(1));
        });

        test('a patron reaching the tap costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = GRAB_X - 2;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('spawning is capped at one patron per lane while one is walking', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                spawnPatron(0);
                spawnPatron(0);
                return patrons.map((p) => p.lane);
            });
            expect(lanes).toEqual([0]);
        });

        test('patrons spawn over time when spawning is enabled', async ({ page }) => {
            await page.evaluate(() => {
                spawnEnabled = true;
                spawnTimer = 0.05;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Mug meets patron
    // -----------------------------------------------------------------------
    test.describe('mug hits patron', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug on the patron lane pushes the patron back', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(300);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a hit patron records a drink', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 300;
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].drinks)).toBe(1);
        });

        test('a mug passes patrons on other lanes', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(2);
                patrons[0].x = 300;
                serve(); // bartender is on lane 0
            });
            await advance(page, 90);
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(300);
        });

        test('pushing a patron off the bar scores and clears them', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = BAR_LEFT + 10;
                serve();
            });
            await advance(page, 300);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
            expect(await page.evaluate(() => served)).toBe(1);
        });

        test('a departing patron takes mugs still in flight on their lane', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = BAR_LEFT + 10;
                serve();
                serve(); // a second soda already on its way down the bar
            });
            await advanceUntil(page, () => served === 1);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('mugs on other lanes survive a patron leaving', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = BAR_LEFT + 10;
                serve();
                mugs[0].x = 80; // about to reach the patron
                bartender.lane = 2;
                serve(); // unrelated soda still near the tap on lane 2
            });
            await advanceUntil(page, () => served === 1);
            expect(await page.evaluate(() => mugs.map((m) => m.lane))).toEqual([2]);
        });

        test('a served patron slides an empty mug back', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = BAR_LEFT + 10;
                serve();
            });
            // Stop as soon as the empty appears — left running it would reach
            // the bartender and be caught.
            await advanceUntil(page, () => empties.length > 0);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides toward the tap', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0));
            const before = await page.evaluate(() => empties[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('catching an empty mug on the right lane scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(0);
                bartender.lane = 0;
            });
            await advance(page, 300);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score === SCORE_CATCH)).toBe(true);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('missing an empty mug costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(3);
                bartender.lane = 0;
            });
            await advance(page, 300);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the player can switch lanes in time to catch a mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnEmpty(2);
                bartender.lane = 0;
            });
            await advance(page, 90);
            await page.evaluate(() => {
                bartender.lane = 2;
            });
            await advance(page, 300);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_CATCH));
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serving a patron awards the serve score', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(1);
                patrons[0].x = BAR_LEFT + 5;
                bartender.lane = 1;
                serve();
            });
            await advance(page, 300);
            const expected = await page.evaluate(() => SCORE_SERVE);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(expected);
        });

        test('the HUD score updates', async ({ page }) => {
            await page.evaluate(() => {
                addScore(250);
            });
            await expect(page.locator('#score')).toHaveText('250');
        });

        test('the best score is kept in localStorage after a game over', async ({ page }) => {
            await page.evaluate(() => {
                addScore(777);
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(
                await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))
            ).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('level 1 has a serve target', async ({ page }) => {
            expect(await page.evaluate(() => levelTarget)).toBeGreaterThan(0);
        });

        test('serving the target number of patrons advances the level', async ({ page }) => {
            await page.evaluate(() => {
                served = levelTarget;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('later levels need more patrons served', async ({ page }) => {
            const first = await page.evaluate(() => levelTarget);
            await page.evaluate(() => {
                served = levelTarget;
            });
            await advance(page, 5);
            expect(await page.evaluate(() => levelTarget)).toBeGreaterThan(first);
        });

        test('the level does not advance while mugs are still in play', async ({ page }) => {
            await page.evaluate(() => {
                served = levelTarget;
                spawnEmpty(0);
            });
            await advance(page, 5);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('the HUD level updates on level up', async ({ page }) => {
            await page.evaluate(() => {
                served = levelTarget;
            });
            await advance(page, 5);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                spawnEmpty(1);
                serve();
                loseLife();
            });
            const counts = await page.evaluate(() => [
                patrons.length,
                mugs.length,
                empties.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('the HUD lives count updates', async ({ page }) => {
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                addScore(420);
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('420');
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await pressAndSettle(page, 'Space', () => state === 'running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('stepping after game over does nothing', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
                spawnPatron(0);
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await pressAndSettle(page, 'p', () => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await pressAndSettle(page, 'p', () => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                state = 'paused';
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });

        test('P does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
            });
            await page.keyboard.press('p');
            await page.waitForTimeout(50);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, 640, 480).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing a running game with entities does not throw', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                spawnPatron(0);
                spawnPatron(1);
                spawnEmpty(2);
                serve();
                step(1 / 60);
                draw();
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the animation loop advances a live game on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                spawnEnabled = false;
                patrons.length = 0;
                mugs.length = 0;
                empties.length = 0;
                spawnPatron(0);
                patrons[0].x = 200;
            });
            const before = await page.evaluate(() => patrons[0].x);
            await page.waitForFunction((x) => patrons[0].x > x + 1, before, { timeout: 5000 });
        });
    });
});
