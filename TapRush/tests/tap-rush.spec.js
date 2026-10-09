const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a wave and freeze the animation loop so a test can place patrons and
// mugs itself and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Clear the bar and hold the wave open: nothing on any counter, no new patrons
// released, and no wave-complete the moment the last entity is gone.
async function clearBar(page) {
    await page.evaluate(() => {
        wave.remaining = Number.POSITIVE_INFINITY;
        wave.timer = Number.POSITIVE_INFINITY;
        patrons.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });
}

// Clear the bar and empty the queue, so the wave is one step from complete.
async function drainWave(page) {
    await page.evaluate(() => {
        wave.remaining = 0;
        wave.timer = Number.POSITIVE_INFINITY;
        patrons.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Put one patron on the bar in a known place and state.
async function addPatron(page, patron) {
    await page.evaluate((p) => {
        patrons.push({
            lane: p.lane,
            x: p.x,
            thirst: p.thirst,
            phase: p.phase || 'advancing',
            timer: 0,
        });
    }, patron);
}

test.describe('Tap Rush', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tap Rush', async ({ page }) => {
            await expect(page).toHaveTitle('Tap Rush');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('the game starts idle with an empty bar', async ({ page }) => {
            const snapshot = await page.evaluate(() => ({
                state,
                patrons: patrons.length,
                mugs: mugs.length,
                empties: empties.length,
            }));
            expect(snapshot).toEqual({ state: 'idle', patrons: 0, mugs: 0, empties: 0 });
        });

        test('the bar has four lanes with increasing centre lines', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, i) => laneY(i))
            );
            expect(ys).toHaveLength(4);
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
            expect(Math.min(...ys)).toBeGreaterThan(0);
            expect(Math.max(...ys)).toBeLessThan(480);
        });

        test('the serving end sits left of the door end', async ({ page }) => {
            const { left, right } = await page.evaluate(() => ({
                left: BAR_LEFT,
                right: BAR_RIGHT,
            }));
            expect(left).toBeLessThan(right);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game resets score, lives and level', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                level = 7;
                startGame();
            });
            expect(await page.evaluate(() => ({ score, lives, level }))).toEqual({
                score: 0,
                lives: 3,
                level: 1,
            });
        });

        test('a fresh game queues a wave of patrons', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => wave.remaining)).toBeGreaterThan(0);
        });

        test('the bartender starts in a valid lane', async ({ page }) => {
            await startFrozen(page);
            const lane = await page.evaluate(() => bartender.lane);
            expect(lane).toBeGreaterThanOrEqual(0);
            expect(lane).toBeLessThan(4);
        });

        test('the wave releases patrons as time passes', async ({ page }) => {
            await startFrozen(page);
            await step(page, 1200); // 10 seconds
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });

        test('patrons enter at the door end', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                patrons.length = 0;
                spawnPatron(2);
            });
            const p = await page.evaluate(() => patrons[0]);
            expect(p.lane).toBe(2);
            expect(p.x).toBeGreaterThanOrEqual(await page.evaluate(() => BAR_RIGHT));
            expect(p.thirst).toBeGreaterThan(0);
            expect(p.phase).toBe('advancing');
        });
    });

    // -----------------------------------------------------------------------
    // Moving the bartender
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => setLane(0));
        });

        test('ArrowDown moves down one lane', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('ArrowUp moves back up one lane', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('S and W also move the bartender', async ({ page }) => {
            await page.keyboard.press('KeyS');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('KeyW');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('movement is clamped at the top lane', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('movement is clamped at the bottom lane', async ({ page }) => {
            await page.evaluate(() => setLane(LANE_COUNT - 1));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('setLane clamps out-of-range lanes', async ({ page }) => {
            expect(await page.evaluate(() => {
                setLane(99);
                return bartender.lane;
            })).toBe(3);
            expect(await page.evaluate(() => {
                setLane(-4);
                return bartender.lane;
            })).toBe(0);
        });

        test('holding a key repeats the lane change over time', async ({ page }) => {
            await page.keyboard.down('ArrowDown');
            await step(page, 240); // 2 seconds of held key
            await page.keyboard.up('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('the bartender cannot move while the game is idle', async ({ page }) => {
            await page.evaluate(() => {
                state = 'idle';
                setLane(1);
            });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
            await page.evaluate(() => setLane(1));
        });

        test('pour puts a full mug at the serving end of the current lane', async ({ page }) => {
            await page.evaluate(() => pour());
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(1);
            expect(mug.x).toBeCloseTo(await page.evaluate(() => BAR_LEFT), 0);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('Space pours while the game is running', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a second pour in the same instant is refused', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring works again once the cooldown has elapsed', async ({ page }) => {
            await page.evaluate(() => pour());
            await step(page, 60); // half a second
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a poured mug slides toward the door', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await step(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('a mug keeps to its own lane', async ({ page }) => {
            await page.evaluate(() => pour());
            await page.evaluate(() => setLane(3));
            await step(page, 30);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(1);
        });

        test('a mug that reaches the door smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            const lives0 = await page.evaluate(() => lives);
            await step(page, 600);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(lives0 - 1);
        });

        test('pouring is refused while paused', async ({ page }) => {
            await page.evaluate(() => {
                state = 'paused';
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
            await startFrozen(page);
            await clearBar(page);
        });

        test('an advancing patron walks toward the serving end', async ({ page }) => {
            await addPatron(page, { lane: 0, x: 500, thirst: 1 });
            await step(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(500);
        });

        test('a patron who reaches the bartender costs a life and leaves', async ({ page }) => {
            await addPatron(page, { lane: 0, x: 120, thirst: 1 });
            const lives0 = await page.evaluate(() => lives);
            await step(page, 600);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(lives0 - 1);
        });

        test('a mug reaching a patron is caught and scores points', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await addPatron(page, { lane: 2, x: 300, thirst: 1 });
            await page.evaluate(() => pour());
            await step(page, 400);
            const result = await page.evaluate(() => ({ score, mugs: mugs.length }));
            expect(result.score).toBeGreaterThan(0);
            expect(result.mugs).toBe(0);
        });

        test('catching a mug knocks the patron back toward the door', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await addPatron(page, { lane: 2, x: 300, thirst: 1 });
            const moved = await page.evaluate(() => {
                pour();
                const start = patrons[0].x;
                for (let i = 0; i < 400 && patrons.length && patrons[0].phase === 'advancing'; i++) {
                    physicsStep(1 / 120);
                }
                return patrons.length ? patrons[0].x - start : null;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a served patron drinks before it moves again', async ({ page }) => {
            await page.evaluate(() => setLane(2));
            await addPatron(page, { lane: 2, x: 300, thirst: 1 });
            const phase = await page.evaluate(() => {
                pour();
                for (let i = 0; i < 400 && mugs.length; i++) physicsStep(1 / 120);
                return patrons.length ? patrons[0].phase : null;
            });
            expect(phase).toBe('drinking');
        });

        test('a patron with two thirsts needs two mugs', async ({ page }) => {
            await page.evaluate(() => setLane(1));
            await addPatron(page, { lane: 1, x: 420, thirst: 2 });
            const afterOne = await page.evaluate(() => {
                pour();
                for (let i = 0; i < 400 && mugs.length; i++) physicsStep(1 / 120);
                return { thirst: patrons[0].thirst, empties: empties.length };
            });
            expect(afterOne.thirst).toBe(1);
            expect(afterOne.empties).toBe(0);

            const afterTwo = await page.evaluate(() => {
                for (let i = 0; i < 200; i++) physicsStep(1 / 120); // finish drinking
                pour();
                for (let i = 0; i < 600 && mugs.length; i++) physicsStep(1 / 120);
                return { thirst: patrons[0].thirst, phase: patrons[0].phase };
            });
            expect(afterTwo.thirst).toBe(0);
        });

        test('a fully served patron sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => setLane(0));
            await addPatron(page, { lane: 0, x: 400, thirst: 1 });
            const after = await page.evaluate(() => {
                pour();
                for (let i = 0; i < 600 && empties.length === 0; i++) physicsStep(1 / 120);
                return { empties: empties.length, lane: empties[0] && empties[0].lane };
            });
            expect(after.empties).toBe(1);
            expect(after.lane).toBe(0);
        });

        test('a fully served patron walks out of the door and scores', async ({ page }) => {
            await page.evaluate(() => setLane(0));
            await addPatron(page, { lane: 0, x: 400, thirst: 1, phase: 'leaving' });
            const before = await page.evaluate(() => score);
            await step(page, 900);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThan(before);
        });

        test('a drinking patron does not walk', async ({ page }) => {
            await addPatron(page, { lane: 0, x: 400, thirst: 1, phase: 'drinking' });
            await page.evaluate(() => {
                patrons[0].timer = 10; // a long drink
            });
            await step(page, 30);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(400, 1);
        });

        test('patrons never leave the canvas while advancing', async ({ page }) => {
            await addPatron(page, { lane: 3, x: 560, thirst: 3 });
            const escaped = await page.evaluate(() => {
                for (let i = 0; i < 1200; i++) {
                    physicsStep(1 / 120);
                    for (const p of patrons) if (p.x < 0 || p.x > W) return p.x;
                }
                return null;
            });
            expect(escaped).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
        });

        test('an empty mug slides back toward the bartender', async ({ page }) => {
            await page.evaluate(() => empties.push({ lane: 1, x: 400 }));
            await step(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeLessThan(400);
        });

        test('an empty mug caught in the right lane scores and costs no life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(1);
                empties.push({ lane: 1, x: 300 });
            });
            const before = await page.evaluate(() => ({ score, lives }));
            await step(page, 600);
            const after = await page.evaluate(() => ({ score, lives, empties: empties.length }));
            expect(after.empties).toBe(0);
            expect(after.lives).toBe(before.lives);
            expect(after.score).toBeGreaterThan(before.score);
        });

        test('an empty mug missed in the wrong lane costs a life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(3);
                empties.push({ lane: 0, x: 300 });
            });
            const before = await page.evaluate(() => ({ score, lives }));
            await step(page, 600);
            const after = await page.evaluate(() => ({ score, lives, empties: empties.length }));
            expect(after.empties).toBe(0);
            expect(after.lives).toBe(before.lives - 1);
            expect(after.score).toBe(before.score);
        });

        test('an empty mug is never left stranded on the bar', async ({ page }) => {
            await page.evaluate(() => {
                setLane(3);
                empties.push({ lane: 0, x: 580 });
            });
            await step(page, 1200);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
            await clearBar(page);
        });

        test('the HUD reflects a lost life', async ({ page }) => {
            await page.evaluate(() => {
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await page.evaluate(() => {
                score = 450;
                lives = 1;
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
            });
            await expect(page.locator('#overlay-score')).toContainText('450');
        });

        test('nothing moves once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
                patrons.push({ lane: 0, x: 400, thirst: 1, phase: 'advancing', timer: 0 });
                for (let i = 0; i < 120; i++) physicsStep(1 / 120);
            });
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(400, 1);
        });

        test('the best score survives a reload', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
            });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('Space after a game over starts a new game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                setLane(3);
                empties.push({ lane: 0, x: 200 });
                for (let i = 0; i < 600; i++) physicsStep(1 / 120);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({
                state: 'running',
                lives: 3,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing the bar completes the wave and banks a bonus', async ({ page }) => {
            await startFrozen(page);
            await drainWave(page);
            await step(page, 2);
            const after = await page.evaluate(() => ({ state, score }));
            expect(after.state).toBe('wavecomplete');
            expect(after.score).toBeGreaterThan(0);
        });

        test('the next wave starts after the break and raises the level', async ({ page }) => {
            await startFrozen(page);
            await drainWave(page);
            await step(page, 600); // through the break
            const after = await page.evaluate(() => ({ state, level, queued: wave.remaining }));
            expect(after.level).toBe(2);
            expect(after.state).toBe('running');
            expect(after.queued).toBeGreaterThan(0);
        });

        test('a later wave queues more patrons than the first', async ({ page }) => {
            const counts = await page.evaluate(() => {
                startGame();
                autoRun = false;
                const first = wave.remaining;
                level = 4;
                startWave();
                return { first, later: wave.remaining };
            });
            expect(counts.later).toBeGreaterThan(counts.first);
        });

        test('a later wave makes patrons thirstier', async ({ page }) => {
            const thirsts = await page.evaluate(() => {
                startGame();
                autoRun = false;
                const first = wave.thirst;
                level = 5;
                startWave();
                return { first, later: wave.thirst };
            });
            expect(thirsts.later).toBeGreaterThan(thirsts.first);
            expect(thirsts.later).toBeLessThanOrEqual(3);
        });

        test('lives are not refilled between waves', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 2;
            });
            await drainWave(page);
            await step(page, 600);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a wave replays the same lanes for the same level', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                const run = () => {
                    startGame();
                    autoRun = false;
                    lives = 99; // survive long enough for the whole queue to spawn
                    level = 3;
                    startWave();
                    for (let i = 0; i < 6000 && wave.remaining > 0; i++) physicsStep(1 / 120);
                    return spawnLog.slice(0, 5);
                };
                return { a: run(), b: run() };
            });
            expect(lanes.a.length).toBe(5);
            expect(lanes.a).toEqual(lanes.b);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the game and shows the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused bar does not move', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                patrons.length = 0;
                patrons.push({ lane: 0, x: 400, thirst: 1, phase: 'advancing', timer: 0 });
            });
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => patrons[0].x);
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 1);
        });

        test('P does nothing on the title screen', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the idle canvas is painted, not blank', async ({ page }) => {
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, W, H).data;
                const first = [data[0], data[1], data[2]].join(',');
                for (let i = 4; i < data.length; i += 4) {
                    if ([data[i], data[i + 1], data[i + 2]].join(',') !== first) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the canvas keeps repainting while the bar is busy', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                patrons.length = 0;
                spawnPatron(1);
                pour();
            });
            const first = await page.locator('#canvas').screenshot();
            await page.waitForTimeout(200);
            const second = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(first, second)).not.toBe(0);
        });

        test('moving the bartender changes what is drawn', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                autoRun = false;
                wave.remaining = 0;
                wave.timer = Number.POSITIVE_INFINITY;
                patrons.length = 0;
                setLane(0);
                draw();
            });
            const top = await page.locator('#canvas').screenshot();
            await page.evaluate(() => {
                setLane(3);
                draw();
            });
            const bottom = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(top, bottom)).not.toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // A real, unassisted game
    // -----------------------------------------------------------------------
    test.describe('playing for real', () => {
        test('a greedy bartender serves patrons and scores points', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                // Chase whatever is most urgent: an incoming empty first,
                // otherwise the patron closest to the bar. Pour when lined up.
                for (let i = 0; i < 12000 && state !== 'gameover'; i++) {
                    const empty = empties.slice().sort((a, b) => a.x - b.x)[0];
                    const patron = patrons
                        .filter((p) => p.phase === 'advancing')
                        .sort((a, b) => a.x - b.x)[0];
                    const target = empty || patron;
                    if (target) {
                        if (target.lane !== bartender.lane) setLane(target.lane);
                        else if (patron && patron.lane === bartender.lane) pour();
                    }
                    physicsStep(1 / 120);
                }
                return { score, state, level, lives };
            });
            expect(result.score).toBeGreaterThan(0);
            expect(['running', 'wavecomplete', 'gameover']).toContain(result.state);
        });

        test('a hands-off game eventually ends rather than hanging', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 12000 && state !== 'gameover'; i++) physicsStep(1 / 120);
                return { state, lives };
            });
            expect(result.state).toBe('gameover');
            expect(result.lives).toBe(0);
        });

        test('long play never leaves a mug or patron off the bar', async ({ page }) => {
            const stray = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 6000 && state !== 'gameover'; i++) {
                    if (i % 90 === 0) {
                        setLane(i % LANE_COUNT);
                        pour();
                    }
                    physicsStep(1 / 120);
                    for (const m of mugs) if (m.x < 0 || m.x > W) return { kind: 'mug', x: m.x };
                    for (const e of empties) if (e.x < 0 || e.x > W) return { kind: 'empty', x: e.x };
                    for (const p of patrons) if (p.x < 0 || p.x > W) return { kind: 'patron', x: p.x };
                }
                return null;
            });
            expect(stray).toBeNull();
        });

        test('the score never goes backwards', async ({ page }) => {
            const dropped = await page.evaluate(() => {
                startGame();
                autoRun = false;
                let last = score;
                for (let i = 0; i < 6000 && state !== 'gameover'; i++) {
                    if (i % 70 === 0) pour();
                    physicsStep(1 / 120);
                    if (score < last) return { score, last };
                    last = score;
                }
                return null;
            });
            expect(dropped).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Tap Rush', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'tap-rush');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Tap Rush');
            expect(entry.dir).toBe('TapRush');
            expect(entry.path).toBe('games/TapRush/index.html');
            expect(entry.thumbnail).toBe('games/TapRush/screenshot.png');
            expect(entry.category).toBe('Action');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'tap-rush');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'TapRush/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Tap Rush\s*\|\s*\[TapRush\/\]\(TapRush\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'TapRush/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'TapRush/DESIGN.md'))).toBe(true);
        });
    });
});
