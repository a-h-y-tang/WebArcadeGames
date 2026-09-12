const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so every press is confirmed against the game's key state before the
// simulation is advanced. Without this the specs race the real animation loop.
const KEY_FLAG = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'brake',
    a: 'left',
    d: 'right',
    s: 'brake',
};

const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((flag) => keys[flag] === true, KEY_FLAG[key]);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction((flag) => keys[flag] === false, KEY_FLAG[key]);
};

// Start a run on a bare mountain: course generation off and nothing in the
// world, so a spec can place exactly the obstacle or gate it is about to test.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        obstacles.length = 0;
        gates.length = 0;
    });

const constants = (page) =>
    page.evaluate(() => ({
        CANVAS_W,
        CANVAS_H,
        MAX_ANGLE,
        GATE_HALF,
        GATE_POINTS,
        COMBO_MAX,
        CRASH_TIME,
        INVULN_TIME,
        JUMP_AIR,
        RAMP_AIR,
        START_LIVES,
        DIST_POINTS,
        PX_PER_METER,
        SKIER_SCREEN_Y,
        EDGE_MARGIN,
        CULL_BEHIND,
    }));

test.describe('Ski Slalom', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Ski Slalom', async ({ page }) => {
            await expect(page).toHaveTitle('Ski Slalom');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x620', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '620');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, distance, lives and combo', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#distance')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#combo')).toHaveText('x1');
        });

        test('the mountain is empty before the run starts', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                obstacles: obstacles.length,
                gates: gates.length,
            }));
            expect(counts).toEqual({ obstacles: 0, gates: 0 });
        });

        test('idle simulation does not move the skier', async ({ page }) => {
            const before = await page.evaluate(() => skier.y);
            await advance(page, 60);
            expect(await page.evaluate(() => skier.y)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space starts the run and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the run', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the skier starts centred, upright and airborne-free', async ({ page }) => {
            const { CANVAS_W } = await constants(page);
            await startQuiet(page);
            const s = await page.evaluate(() => ({ ...skier }));
            expect(s.x).toBe(CANVAS_W / 2);
            expect(s.angle).toBe(0);
            expect(s.air).toBe(0);
            // The page's own animation loop keeps running, so the skier has at
            // most a few frames of acceleration by the time this is read.
            expect(s.speed).toBeLessThan(30);
        });

        test('a fresh run has full lives, no score and no distance', async ({ page }) => {
            const { START_LIVES } = await constants(page);
            await startQuiet(page);
            const run = await page.evaluate(() => ({ score, lives, distance, combo }));
            expect(run).toEqual({ score: 0, lives: START_LIVES, distance: 0, combo: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Steering and speed
    // -----------------------------------------------------------------------
    test.describe('steering and speed', () => {
        test('holding right carves right and moves the skier right', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => skier.x);
            await hold(page, 'ArrowRight');
            await advance(page, 60);
            await release(page, 'ArrowRight');
            const s = await page.evaluate(() => ({ ...skier }));
            expect(s.angle).toBeGreaterThan(0);
            expect(s.x).toBeGreaterThan(x0);
        });

        test('holding left carves left and moves the skier left', async ({ page }) => {
            await startQuiet(page);
            const x0 = await page.evaluate(() => skier.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 60);
            await release(page, 'ArrowLeft');
            const s = await page.evaluate(() => ({ ...skier }));
            expect(s.angle).toBeLessThan(0);
            expect(s.x).toBeLessThan(x0);
        });

        test('A and D steer as well as the arrow keys', async ({ page }) => {
            await startQuiet(page);
            await hold(page, 'd');
            await advance(page, 30);
            await release(page, 'd');
            expect(await page.evaluate(() => skier.angle)).toBeGreaterThan(0);
        });

        test('the carve angle is clamped', async ({ page }) => {
            const { MAX_ANGLE } = await constants(page);
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 240);
            await release(page, 'ArrowRight');
            expect(await page.evaluate(() => skier.angle)).toBeCloseTo(MAX_ANGLE, 5);
        });

        test('pointing straight down descends faster than carving hard', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            const straight = await page.evaluate(() => skier.y);

            await startQuiet(page);
            await page.evaluate(() => {
                skier.angle = MAX_ANGLE;
            });
            await advance(page, 120);
            const carved = await page.evaluate(() => skier.y);

            expect(straight).toBeGreaterThan(carved * 1.5);
        });

        test('carving moves the skier sideways faster than pointing straight down', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            const straightX = await page.evaluate(() => Math.abs(skier.x - CANVAS_W / 2));

            await startQuiet(page);
            await page.evaluate(() => {
                skier.angle = MAX_ANGLE;
            });
            await advance(page, 120);
            const carvedX = await page.evaluate(() => Math.abs(skier.x - CANVAS_W / 2));

            expect(carvedX).toBeGreaterThan(straightX);
        });

        test('the brake sheds speed', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            const fast = await page.evaluate(() => skier.speed);
            await hold(page, 'ArrowDown');
            await advance(page, 60);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => skier.speed)).toBeLessThan(fast);
        });

        test('speed recovers once the brake is released', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            await hold(page, 'ArrowDown');
            await advance(page, 60);
            await release(page, 'ArrowDown');
            const slow = await page.evaluate(() => skier.speed);
            await advance(page, 90);
            expect(await page.evaluate(() => skier.speed)).toBeGreaterThan(slow);
        });

        test('the skier cannot leave the piste', async ({ page }) => {
            const { CANVAS_W, EDGE_MARGIN } = await constants(page);
            await startQuiet(page);
            await hold(page, 'ArrowRight');
            await advance(page, 600);
            await release(page, 'ArrowRight');
            expect(await page.evaluate(() => skier.x)).toBeCloseTo(CANVAS_W - EDGE_MARGIN, 5);

            await hold(page, 'ArrowLeft');
            await advance(page, 900);
            await release(page, 'ArrowLeft');
            expect(await page.evaluate(() => skier.x)).toBeCloseTo(EDGE_MARGIN, 5);
        });

        test('the run gets faster the further it goes', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 180);
            const early = await page.evaluate(() => skier.speed);
            await page.evaluate(() => {
                skier.y += 40000;
            });
            await advance(page, 600);
            expect(await page.evaluate(() => skier.speed)).toBeGreaterThan(early);
        });
    });

    // -----------------------------------------------------------------------
    // Distance and the HUD
    // -----------------------------------------------------------------------
    test.describe('distance', () => {
        test('descending increases the distance in metres', async ({ page }) => {
            const { PX_PER_METER } = await constants(page);
            await startQuiet(page);
            await advance(page, 120);
            const s = await page.evaluate(() => ({ y: skier.y, distance }));
            expect(s.distance).toBe(Math.floor(s.y / PX_PER_METER));
            expect(s.distance).toBeGreaterThan(0);
        });

        test('distance covered is worth score', async ({ page }) => {
            const { DIST_POINTS } = await constants(page);
            await startQuiet(page);
            await advance(page, 120);
            const run = await page.evaluate(() => ({ score, distance }));
            expect(run.score).toBe(run.distance * DIST_POINTS);
        });

        test('the HUD tracks score, distance and lives', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            // Pause first: the live animation loop would otherwise keep moving
            // the numbers on between reading them and asserting on the HUD.
            await page.keyboard.press('p');
            const run = await page.evaluate(() => ({ score, distance }));
            await expect(page.locator('#score')).toHaveText(String(run.score));
            await expect(page.locator('#distance')).toHaveText(String(run.distance));
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the camera keeps the skier at a fixed height on screen', async ({ page }) => {
            const { SKIER_SCREEN_Y } = await constants(page);
            await startQuiet(page);
            await advance(page, 200);
            const camera = await page.evaluate(() => skier.y - cameraY());
            expect(camera).toBeCloseTo(SKIER_SCREEN_Y, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Gates
    // -----------------------------------------------------------------------
    test.describe('gates', () => {
        test('skiing through a gate marks it passed and scores', async ({ page }) => {
            const { GATE_POINTS } = await constants(page);
            await startQuiet(page);
            const before = await page.evaluate(() => {
                addGate(skier.x, skier.y + 120);
                return score;
            });
            await advance(page, 120);
            const after = await page.evaluate(() => ({
                gate: gates[0].state,
                score,
                combo,
            }));
            expect(after.gate).toBe('passed');
            expect(after.score).toBeGreaterThanOrEqual(before + GATE_POINTS);
            expect(after.combo).toBe(2);
        });

        test('a gate just inside the flags still counts', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addGate(skier.x + GATE_HALF - 1, skier.y + 120);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => gates[0].state)).toBe('passed');
        });

        test('skiing outside the flags misses the gate', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addGate(skier.x + GATE_HALF + 30, skier.y + 120);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => gates[0].state)).toBe('missed');
        });

        test('a missed gate scores nothing', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                skier.angle = 0;
                addGate(skier.x + GATE_HALF + 30, skier.y + 120);
            });
            await advance(page, 120);
            const run = await page.evaluate(() => ({ score, distance }));
            expect(run.score).toBe(run.distance);
        });

        test('consecutive gates build the combo multiplier', async ({ page }) => {
            const { GATE_POINTS } = await constants(page);
            await startQuiet(page);
            // Gates are culled once they are well behind the skier, so hold on
            // to the objects themselves rather than reading the live array.
            await page.evaluate(() => {
                window.placed = [];
                for (let i = 1; i <= 3; i++) placed.push(addGate(skier.x, skier.y + i * 160));
            });
            await advance(page, 300);
            const run = await page.evaluate(() => ({
                combo,
                states: placed.map((g) => g.state),
                score,
                distance,
            }));
            expect(run.states).toEqual(['passed', 'passed', 'passed']);
            expect(run.combo).toBe(4);
            // 1x + 2x + 3x = 6 gate points, plus one point per metre descended.
            expect(run.score).toBe(6 * GATE_POINTS + run.distance);
        });

        test('the combo multiplier is capped', async ({ page }) => {
            const { COMBO_MAX } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                for (let i = 1; i <= COMBO_MAX + 4; i++) addGate(skier.x, skier.y + i * 150);
            });
            await advance(page, 1200);
            expect(await page.evaluate(() => combo)).toBe(COMBO_MAX);
        });

        test('missing a gate resets the combo', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                window.placed = [
                    addGate(skier.x, skier.y + 150),
                    addGate(skier.x + GATE_HALF + 40, skier.y + 300),
                ];
            });
            await advance(page, 300);
            const run = await page.evaluate(() => ({
                states: placed.map((g) => g.state),
                combo,
            }));
            expect(run.states).toEqual(['passed', 'missed']);
            expect(run.combo).toBe(1);
        });

        test('a gate is only scored once', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addGate(skier.x, skier.y + 100);
            });
            await advance(page, 120);
            const mid = await page.evaluate(() => ({ score, distance, combo }));
            await advance(page, 120);
            const end = await page.evaluate(() => ({ score, distance, combo }));
            expect(end.combo).toBe(mid.combo);
            expect(end.score - mid.score).toBe(end.distance - mid.distance);
        });

        test('the HUD shows the combo multiplier', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addGate(skier.x, skier.y + 120);
            });
            await advance(page, 120);
            await expect(page.locator('#combo')).toHaveText('x2');
        });
    });

    // -----------------------------------------------------------------------
    // Obstacles and crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('hitting a tree costs a life and stops the skier', async ({ page }) => {
            const { START_LIVES } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                return state === 'crashing';
            });
            const run = await page.evaluate(() => ({ lives, state, speed: skier.speed }));
            expect(run.lives).toBe(START_LIVES - 1);
            expect(run.state).toBe('crashing');
            expect(run.speed).toBe(0);
        });

        test('hitting a rock on the ground also crashes', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('rock', skier.x, skier.y + 150);
            });
            await advance(page, 300);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the mountain freezes during a crash', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                return state === 'crashing';
            });
            const y = await page.evaluate(() => skier.y);
            await advance(page, 30);
            expect(await page.evaluate(() => skier.y)).toBe(y);
        });

        test('the run resumes after the crash pause', async ({ page }) => {
            const { CRASH_TIME } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                return state === 'crashing';
            });
            await advance(page, Math.ceil(CRASH_TIME * 60) + 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a crash resets the combo', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                addGate(skier.x, skier.y + 120);
                addObstacle('tree', skier.x, skier.y + 1200);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => combo)).toBe(2);
            await advance(page, 400);
            expect(await page.evaluate(() => combo)).toBe(1);
        });

        test('the same tree cannot take two lives', async ({ page }) => {
            const { CRASH_TIME } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                return state === 'crashing';
            });
            await advance(page, Math.ceil(CRASH_TIME * 60) + 30);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the skier is briefly invulnerable after getting up', async ({ page }) => {
            const { CRASH_TIME, INVULN_TIME } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                return state === 'crashing';
            });
            await advance(page, Math.ceil(CRASH_TIME * 60) + 2);
            const invuln = await page.evaluate(() => skier.invuln);
            expect(invuln).toBeGreaterThan(0);
            expect(invuln).toBeLessThanOrEqual(INVULN_TIME);
            await page.evaluate(() => {
                addObstacle('tree', skier.x, skier.y + 20);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the third crash ends the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await advance(page, 400);
            const run = await page.evaluate(() => ({ state, lives }));
            expect(run).toEqual({ state: 'over', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|wipeout/i);
        });

        test('the final score is shown on the game over overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await advance(page, 400);
            const score = await page.evaluate(() => score);
            await expect(page.locator('#overlay-score')).toContainText(String(score));
        });

        test('the best score is remembered', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addObstacle('tree', skier.x, skier.y + 400);
            });
            await advance(page, 500);
            const run = await page.evaluate(() => ({
                score,
                best,
                stored: localStorage.getItem('skislalom-best'),
            }));
            expect(run.best).toBe(run.score);
            expect(run.stored).toBe(String(run.score));
            await expect(page.locator('#best')).toHaveText(String(run.score));
        });
    });

    // -----------------------------------------------------------------------
    // Jumping and air
    // -----------------------------------------------------------------------
    test.describe('jumping', () => {
        test('Space launches the skier into the air', async ({ page }) => {
            const { JUMP_AIR } = await constants(page);
            await startQuiet(page);
            await advance(page, 60);
            await page.keyboard.press('Space');
            const air = await page.evaluate(() => skier.air);
            expect(air).toBeGreaterThan(JUMP_AIR * 0.75);
            expect(air).toBeLessThanOrEqual(JUMP_AIR);
        });

        test('the skier lands again', async ({ page }) => {
            const { JUMP_AIR } = await constants(page);
            await startQuiet(page);
            await advance(page, 60);
            await page.keyboard.press('Space');
            await advance(page, Math.ceil(JUMP_AIR * 60) + 5);
            expect(await page.evaluate(() => skier.air)).toBe(0);
        });

        test('a jump clears a rock', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                skier.speed = 200;
                addObstacle('rock', skier.x, skier.y + 60);
                skier.air = JUMP_AIR;
            });
            await advance(page, 60);
            const run = await page.evaluate(() => ({ lives, state, y: skier.y }));
            expect(run.lives).toBe(3);
            expect(run.state).toBe('running');
            expect(run.y).toBeGreaterThan(60);
        });

        test('a jump does not clear a tree', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                skier.speed = 200;
                addObstacle('tree', skier.x, skier.y + 60);
                skier.air = JUMP_AIR;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('air time is worth score', async ({ page }) => {
            const { JUMP_AIR } = await constants(page);
            await startQuiet(page);
            await advance(page, 60);
            const before = await page.evaluate(() => ({ score, distance }));
            await page.keyboard.press('Space');
            await advance(page, Math.ceil(JUMP_AIR * 60) + 5);
            const after = await page.evaluate(() => ({ score, distance, lastAirBonus }));
            expect(after.lastAirBonus).toBeGreaterThan(0);
            expect(after.score - before.score).toBe(
                after.lastAirBonus + (after.distance - before.distance)
            );
        });

        test('you cannot jump while already airborne', async ({ page }) => {
            const { JUMP_AIR } = await constants(page);
            await startQuiet(page);
            await advance(page, 60);
            await page.keyboard.press('Space');
            await advance(page, 12);
            const mid = await page.evaluate(() => skier.air);
            await page.keyboard.press('Space');
            // A second press must not top the flight back up.
            expect(await page.evaluate(() => skier.air)).toBeLessThanOrEqual(mid);
            expect(mid).toBeLessThan(JUMP_AIR);
        });

        test('a ramp launches the skier further than a jump', async ({ page }) => {
            const { RAMP_AIR, JUMP_AIR } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                skier.speed = 200;
                addObstacle('ramp', skier.x, skier.y + 60);
            });
            await page.waitForFunction(() => {
                for (let i = 0; i < 120 && skier.air === 0; i++) step(1 / 60);
                return skier.air > 0;
            });
            const air = await page.evaluate(() => skier.air);
            expect(air).toBeGreaterThan(RAMP_AIR * 0.75);
            expect(air).toBeLessThanOrEqual(RAMP_AIR);
            expect(RAMP_AIR).toBeGreaterThan(JUMP_AIR);
        });

        test('a ramp cannot be re-triggered mid flight', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                skier.speed = 120;
                skier.air = RAMP_AIR;
                addObstacle('ramp', skier.x, skier.y + 40);
            });
            await advance(page, 30);
            const run = await page.evaluate(() => ({ air: skier.air, hit: obstacles[0].hit }));
            expect(run.air).toBeLessThan(await page.evaluate(() => RAMP_AIR));
            expect(run.hit).toBe(false);
        });

        test('braking has no effect in the air', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 120);
            await page.evaluate(() => {
                skier.air = RAMP_AIR;
            });
            const fast = await page.evaluate(() => skier.speed);
            await hold(page, 'ArrowDown');
            await advance(page, 30);
            await release(page, 'ArrowDown');
            expect(await page.evaluate(() => skier.speed)).toBeGreaterThanOrEqual(fast);
        });
    });

    // -----------------------------------------------------------------------
    // Course generation
    // -----------------------------------------------------------------------
    test.describe('the course', () => {
        test('a started run has a course ahead of the skier', async ({ page }) => {
            await page.evaluate(() => startGame());
            const counts = await page.evaluate(() => ({
                obstacles: obstacles.length,
                gates: gates.length,
            }));
            expect(counts.obstacles + counts.gates).toBeGreaterThan(0);
        });

        test('nothing is generated on top of the skier at the start', async ({ page }) => {
            const { SPAWN_START } = await page.evaluate(() => ({ SPAWN_START }));
            await page.evaluate(() => startGame());
            const minY = await page.evaluate(() =>
                Math.min(...obstacles.map((o) => o.y), ...gates.map((g) => g.y))
            );
            expect(minY).toBeGreaterThanOrEqual(SPAWN_START);
        });

        test('the course keeps filling in ahead as the skier descends', async ({ page }) => {
            await page.evaluate(() => startGame());
            await advance(page, 600);
            const ahead = await page.evaluate(() =>
                obstacles.filter((o) => o.y > skier.y).length + gates.filter((g) => g.y > skier.y).length
            );
            expect(ahead).toBeGreaterThan(0);
        });

        test('the course includes gates, trees, rocks and ramps', async ({ page }) => {
            const kinds = await page.evaluate(() => {
                startGame();
                const seen = new Set();
                for (let i = 0; i < 4000; i++) {
                    step(1 / 60);
                    obstacles.forEach((o) => seen.add(o.type));
                    if (gates.length) seen.add('gate');
                    if (state !== 'running') {
                        lives = 99;
                        state = 'running';
                        skier.invuln = 1;
                    }
                }
                return [...seen];
            });
            expect(kinds.sort()).toEqual(['gate', 'ramp', 'rock', 'tree']);
        });

        test('objects left behind are culled', async ({ page }) => {
            const { CULL_BEHIND } = await constants(page);
            await startQuiet(page);
            await page.evaluate(() => {
                addObstacle('tree', 40, skier.y - 10);
                addGate(300, skier.y - 10);
            });
            await page.evaluate((behind) => {
                skier.y += behind + 200;
                step(1 / 60);
            }, CULL_BEHIND);
            const counts = await page.evaluate(() => ({
                obstacles: obstacles.length,
                gates: gates.length,
            }));
            expect(counts).toEqual({ obstacles: 0, gates: 0 });
        });

        test('the same seed lays out the same course', async ({ page }) => {
            const layout = () =>
                page.evaluate(() => {
                    startGame();
                    rngSeed = 4242;
                    obstacles.length = 0;
                    gates.length = 0;
                    // The corridor chain is course state too: each row steps
                    // sideways from the one before it.
                    corridors.length = 0;
                    spawnY = skier.y + 100;
                    for (let i = 0; i < 600; i++) step(1 / 60);
                    return {
                        obstacles: obstacles.map((o) => [o.type, Math.round(o.x), Math.round(o.y)]),
                        gates: gates.map((g) => [Math.round(g.x), Math.round(g.y)]),
                    };
                });
            const first = await layout();
            const second = await layout();
            expect(second).toEqual(first);
            expect(first.obstacles.length + first.gates.length).toBeGreaterThan(0);
        });

        test('rows arrive more often the further you go', async ({ page }) => {
            // Rows are spaced in time, not pixels: the gap grows with the speed
            // cap, but not as fast, so the course arrives quicker and quicker.
            const interval = (metres) =>
                page.evaluate((d) => {
                    startGame();
                    distance = d;
                    return rowGap() / speedCap();
                }, metres);
            const early = await interval(0);
            const late = await interval(3000);
            expect(late).toBeLessThan(early);
            expect(late).toBeGreaterThan(0.2);
        });

        test('the run speeds up faster than the rows bunch up', async ({ page }) => {
            // A sanity floor on the difficulty ramp: the mountain must stay
            // skiable rather than becoming a wall of obstacles.
            const gap = (metres) =>
                page.evaluate((d) => {
                    startGame();
                    distance = d;
                    return rowGap();
                }, metres);
            expect(await gap(3000)).toBeGreaterThan(await gap(0));
        });

        test('every obstacle row leaves a clear corridor', async ({ page }) => {
            const { clear, CLEAR_HALF, SKIER_HW } = await page.evaluate(() => {
                startGame();
                rngSeed = 777;
                obstacles.length = 0;
                gates.length = 0;
                corridors.length = 0;
                spawnY = skier.y + 100;
                for (let i = 0; i < 3000; i++) step(1 / 60);
                const bad = [];
                for (const c of corridors) {
                    for (const o of obstacles) {
                        if (Math.abs(o.y - c.y) > 30) continue;
                        if (Math.abs(o.x - c.x) < CLEAR_HALF) bad.push([o.type, o.x, c.x]);
                    }
                }
                return { clear: bad, CLEAR_HALF, SKIER_HW };
            });
            // The corridor has to be wide enough to actually ski down.
            expect(CLEAR_HALF).toBeGreaterThan(SKIER_HW * 2);
            expect(clear).toEqual([]);
        });

        test('consecutive corridors stay within a carve of each other', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                rngSeed = 31337;
                corridors.length = 0;
                spawnY = skier.y + 100;
                for (let i = 0; i < 3000; i++) step(1 / 60);
                let max = 0;
                for (let i = 1; i < corridors.length; i++) {
                    max = Math.max(max, Math.abs(corridors[i].x - corridors[i - 1].x));
                }
                return { max, shift: CORRIDOR_SHIFT, rows: corridors.length };
            });
            expect(worst.rows).toBeGreaterThan(3);
            expect(worst.max).toBeLessThanOrEqual(worst.shift + 0.001);
        });

        test('gates sit on the corridor, so they can always be reached', async ({ page }) => {
            const offsets = await page.evaluate(() => {
                startGame();
                rngSeed = 5150;
                gates.length = 0;
                corridors.length = 0;
                spawnY = skier.y + 100;
                for (let i = 0; i < 3000; i++) step(1 / 60);
                return gates.map((g) => {
                    const c = corridors.find((c) => Math.abs(c.y - g.y) < 1);
                    return c ? Math.abs(c.x - g.x) : 999;
                });
            });
            expect(offsets.length).toBeGreaterThan(0);
            expect(Math.max(...offsets)).toBeLessThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('pausing freezes the mountain', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 60);
            await page.keyboard.press('p');
            const y = await page.evaluate(() => skier.y);
            await advance(page, 60);
            expect(await page.evaluate(() => skier.y)).toBe(y);
        });

        test('P resumes the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('pausing is ignored when idle', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('restarting after a wipeout resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addObstacle('tree', skier.x, skier.y + 150);
            });
            await advance(page, 400);
            expect(await page.evaluate(() => state)).toBe('over');
            await page.keyboard.press('Space');
            const run = await page.evaluate(() => ({
                state,
                score,
                lives,
                distance,
                combo,
                y: skier.y,
            }));
            expect(run.state).toBe('running');
            expect(run.score).toBe(0);
            expect(run.lives).toBe(3);
            expect(run.distance).toBe(0);
            expect(run.combo).toBe(1);
            // Restarting puts the skier back at the top of the mountain; the
            // live animation loop may have nudged them a few pixels by now.
            expect(run.y).toBeLessThan(20);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('a full run draws without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => {
                if (m.type() === 'error') errors.push(m.text());
            });
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 900; i++) {
                    step(1 / 60);
                    draw();
                }
            });
            expect(errors).toEqual([]);
        });

        test('the idle, paused and game over screens all draw', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            await page.evaluate(() => {
                draw();
                startGame();
                togglePause();
                draw();
                togglePause();
                lives = 1;
                addObstacle('tree', skier.x, skier.y + 60);
                for (let i = 0; i < 400; i++) {
                    step(1 / 60);
                    draw();
                }
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(errors).toEqual([]);
        });
    });
});
