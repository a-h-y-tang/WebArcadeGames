const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `seconds` in fixed `dt` slices, inside the page.
// Every physics test drives time this way so nothing depends on the wall clock.
async function advance(page, seconds, dt = 1 / 60) {
    await page.evaluate(([seconds, dt]) => {
        const frames = Math.round(seconds / dt);
        for (let i = 0; i < frames; i++) step(dt);
    }, [seconds, dt]);
}

// Put the skier on an empty slope: a started game with the course stripped of
// everything, so a test can drop in the one gate / tree / ramp it cares about.
async function emptySlope(page) {
    await page.evaluate(() => {
        startGame();
        course.gates = [];
        course.obstacles = [];
        course.ramps = [];
        resetInput();
    });
}

test.describe('Alpine Ski', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => setAutoStep(false));
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Alpine Ski', async ({ page }) => {
            await expect(page).toHaveTitle('Alpine Ski');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 600x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('alpine-ski-best', '3400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3400');
        });

        test('stepping while idle does not move the skier', async ({ page }) => {
            const y = await page.evaluate(() => { step(0.5); return skier.y; });
            expect(y).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a run starts on course 1 with a clean scoreboard', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, gatesCleared, gatesMissed, crashes, streak };
            });
            expect(s).toEqual({ level: 1, score: 0, gatesCleared: 0, gatesMissed: 0, crashes: 0, streak: 0 });
        });

        test('the skier spawns centred at the top of the course, stationary', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { x: skier.x, y: skier.y, speed: skier.speed, angle: skier.angle, start: START_X };
            });
            expect(s.x).toBe(s.start);
            expect(s.y).toBe(0);
            expect(s.speed).toBe(0);
            expect(s.angle).toBe(0);
        });

        test('the clock starts at the course time limit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { timeLeft, limit: course.timeLimit };
            });
            expect(s.timeLeft).toBe(s.limit);
            expect(s.limit).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Course generation
    // -----------------------------------------------------------------------
    test.describe('course generation', () => {
        test('a course is seeded, so the same level generates the same gates', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = generateCourse(2).gates.map((g) => [g.y, g.x, g.width]);
                const b = generateCourse(2).gates.map((g) => [g.y, g.x, g.width]);
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('different levels generate different courses', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = JSON.stringify(generateCourse(1).gates.map((g) => g.x));
                const b = JSON.stringify(generateCourse(3).gates.map((g) => g.x));
                return a === b;
            });
            expect(same).toBe(false);
        });

        test('gates run down the course in order and stop before the finish', async ({ page }) => {
            const g = await page.evaluate(() => {
                const c = generateCourse(1);
                return { ys: c.gates.map((x) => x.y), length: c.length };
            });
            expect(g.ys.length).toBeGreaterThan(5);
            for (let i = 1; i < g.ys.length; i++) expect(g.ys[i]).toBeGreaterThan(g.ys[i - 1]);
            expect(g.ys[g.ys.length - 1]).toBeLessThan(g.length);
        });

        test('every gate fits inside the slope', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const c = generateCourse(2);
                return c.gates.filter((g) => g.x - g.width / 2 < 0 || g.x + g.width / 2 > CANVAS_W).length;
            });
            expect(bad).toBe(0);
        });

        test('gates alternate sides of the slope', async ({ page }) => {
            const sides = await page.evaluate(() => generateCourse(1).gates.map((g) => Math.sign(g.x - CANVAS_W / 2)));
            for (let i = 1; i < sides.length; i++) expect(sides[i]).not.toBe(sides[i - 1]);
        });

        test('later courses are longer and their gates are narrower', async ({ page }) => {
            const c = await page.evaluate(() => [1, 2, 3].map((n) => {
                const g = generateCourse(n);
                return { length: g.length, width: g.gates[0].width };
            }));
            expect(c[1].length).toBeGreaterThan(c[0].length);
            expect(c[2].length).toBeGreaterThan(c[1].length);
            expect(c[1].width).toBeLessThan(c[0].width);
            expect(c[2].width).toBeLessThan(c[1].width);
        });

        test('no obstacle blocks the line through a gate', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                let hits = 0;
                for (const n of [1, 2, 3]) {
                    const c = generateCourse(n);
                    for (const o of c.obstacles) {
                        for (const g of c.gates) {
                            if (Math.abs(o.y - g.y) > GATE_CLEARANCE) continue;
                            if (Math.abs(o.x - g.x) < g.width / 2 + GATE_CLEARANCE) hits++;
                        }
                    }
                }
                return hits;
            });
            expect(blocked).toBe(0);
        });

        test('courses carry obstacles and ramps', async ({ page }) => {
            const c = await page.evaluate(() => {
                const g = generateCourse(3);
                return { obstacles: g.obstacles.length, ramps: g.ramps.length };
            });
            expect(c.obstacles).toBeGreaterThan(10);
            expect(c.ramps).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Steering
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('holding left carves left', async ({ page }) => {
            await emptySlope(page);
            const s = await page.evaluate(() => { input.left = true; return null; });
            await advance(page, 0.5);
            const r = await page.evaluate(() => ({ angle: skier.angle, x: skier.x }));
            expect(s).toBeNull();
            expect(r.angle).toBeLessThan(0);
            expect(r.x).toBeLessThan(300);
        });

        test('holding right carves right', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { input.right = true; });
            await advance(page, 0.5);
            const r = await page.evaluate(() => ({ angle: skier.angle, x: skier.x }));
            expect(r.angle).toBeGreaterThan(0);
            expect(r.x).toBeGreaterThan(300);
        });

        test('the heading is clamped to MAX_ANGLE', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { input.right = true; });
            await advance(page, 5);
            const r = await page.evaluate(() => ({ angle: skier.angle, max: MAX_ANGLE }));
            expect(r.angle).toBeCloseTo(r.max, 5);
        });

        test('the skier is clamped inside the snow banks', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { input.left = true; input.tuck = true; });
            await advance(page, 12);
            const r = await page.evaluate(() => ({ x: skier.x, margin: EDGE_MARGIN }));
            expect(r.x).toBeGreaterThanOrEqual(r.margin);
        });

        test('arrow keys drive the same input the tests use', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(true);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(false);
        });

        test('A and D steer as well as the arrow keys', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.down('a');
            expect(await page.evaluate(() => input.left)).toBe(true);
            await page.keyboard.up('a');
            await page.keyboard.down('d');
            expect(await page.evaluate(() => input.right)).toBe(true);
        });

        test('losing focus releases the controls', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            expect(await page.evaluate(() => input.left)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Speed
    // -----------------------------------------------------------------------
    test.describe('speed', () => {
        test('the skier accelerates from a standing start', async ({ page }) => {
            await emptySlope(page);
            await advance(page, 1);
            const speed = await page.evaluate(() => skier.speed);
            expect(speed).toBeGreaterThan(0);
        });

        test('speed settles at the base speed when running straight', async ({ page }) => {
            await emptySlope(page);
            await advance(page, 8);
            const r = await page.evaluate(() => ({ speed: skier.speed, base: BASE_SPEED }));
            expect(r.speed).toBeCloseTo(r.base, 0);
        });

        test('tucking is faster than running straight', async ({ page }) => {
            await emptySlope(page);
            await advance(page, 6);
            const plain = await page.evaluate(() => skier.speed);
            await page.evaluate(() => { input.tuck = true; });
            await advance(page, 6);
            const tucked = await page.evaluate(() => ({ speed: skier.speed, max: TUCK_SPEED }));
            expect(tucked.speed).toBeGreaterThan(plain);
            expect(tucked.speed).toBeCloseTo(tucked.max, 0);
        });

        test('the snowplough brakes hard', async ({ page }) => {
            await emptySlope(page);
            await advance(page, 6);
            const before = await page.evaluate(() => skier.speed);
            await page.evaluate(() => { input.brake = true; });
            await advance(page, 4);
            const after = await page.evaluate(() => skier.speed);
            expect(after).toBeLessThan(before / 2);
        });

        test('carving hard costs speed', async ({ page }) => {
            const straight = await page.evaluate(async () => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                for (let i = 0; i < 480; i++) step(1 / 60);
                return skier.speed;
            });
            const carving = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                input.right = true;
                for (let i = 0; i < 480; i++) step(1 / 60);
                return skier.speed;
            });
            expect(carving).toBeLessThan(straight);
        });

        test('descent rate follows the heading', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { skier.speed = 200; skier.angle = 0; });
            const straightDrop = await page.evaluate(() => {
                const y0 = skier.y;
                step(0.1);
                return skier.y - y0;
            });
            await page.evaluate(() => { skier.speed = 200; skier.angle = MAX_ANGLE; input.right = true; });
            const carvedDrop = await page.evaluate(() => {
                const y0 = skier.y;
                step(0.1);
                return skier.y - y0;
            });
            expect(carvedDrop).toBeLessThan(straightDrop);
        });
    });

    // -----------------------------------------------------------------------
    // Gates
    // -----------------------------------------------------------------------
    test.describe('gates', () => {
        async function oneGate(page, gateX = 300, width = 120) {
            await emptySlope(page);
            await page.evaluate(([gateX, width]) => {
                course.gates = [{ y: skier.y + 100, x: gateX, width, passed: false, missed: false, side: 1 }];
                skier.speed = 200;
            }, [gateX, width]);
        }

        test('skiing between the flags clears the gate', async ({ page }) => {
            await oneGate(page);
            await advance(page, 1);
            const r = await page.evaluate(() => ({
                cleared: gatesCleared, missed: gatesMissed, streak, score, gate: course.gates[0].passed,
            }));
            expect(r.cleared).toBe(1);
            expect(r.missed).toBe(0);
            expect(r.streak).toBe(1);
            expect(r.score).toBeGreaterThanOrEqual(100);
            expect(r.gate).toBe(true);
        });

        test('a cleared gate scores GATE_POINTS on the first gate', async ({ page }) => {
            await oneGate(page);
            await advance(page, 1);
            const r = await page.evaluate(() => ({ score, points: GATE_POINTS }));
            expect(r.score).toBe(r.points);
        });

        test('skiing outside the flags misses the gate', async ({ page }) => {
            await oneGate(page, 80, 60);
            await advance(page, 1);
            const r = await page.evaluate(() => ({
                cleared: gatesCleared, missed: gatesMissed, streak, gate: course.gates[0].missed,
            }));
            expect(r.cleared).toBe(0);
            expect(r.missed).toBe(1);
            expect(r.streak).toBe(0);
            expect(r.gate).toBe(true);
        });

        test('a missed gate costs seconds off the clock', async ({ page }) => {
            await oneGate(page, 80, 60);
            const before = await page.evaluate(() => timeLeft);
            await advance(page, 1);
            const r = await page.evaluate(() => ({ now: timeLeft, penalty: MISS_PENALTY }));
            // 1 second of running plus the penalty.
            expect(before - r.now).toBeCloseTo(1 + r.penalty, 1);
        });

        test('a gate is only counted once', async ({ page }) => {
            await oneGate(page);
            await advance(page, 3);
            expect(await page.evaluate(() => gatesCleared)).toBe(1);
        });

        test('a gate is not counted before the skier reaches it', async ({ page }) => {
            await oneGate(page);
            await advance(page, 0.2);
            const r = await page.evaluate(() => ({ cleared: gatesCleared, missed: gatesMissed, y: skier.y }));
            expect(r.y).toBeLessThan(100);
            expect(r.cleared).toBe(0);
            expect(r.missed).toBe(0);
        });

        test('a gate is caught even at a speed that would step past it', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => {
                course.gates = [{ y: 500, x: 300, width: 120, passed: false, missed: false, side: 1 }];
                skier.speed = 260;
                step(4); // one enormous frame straight over the gate
            });
            expect(await page.evaluate(() => gatesCleared)).toBe(1);
        });

        test('a streak multiplies gate points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                course.obstacles = []; course.ramps = [];
                course.gates = [0, 1, 2].map((i) => ({
                    y: 120 + i * 120, x: 300, width: 160, passed: false, missed: false, side: 1,
                }));
                skier.speed = 220;
                const scores = [];
                let last = 0;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (score !== last) { scores.push(score - last); last = score; }
                }
                return { scores, points: GATE_POINTS };
            });
            expect(r.scores.length).toBe(3);
            expect(r.scores[0]).toBe(r.points);
            expect(r.scores[1]).toBe(r.points * 2);
            expect(r.scores[2]).toBe(r.points * 3);
        });

        test('the multiplier is capped', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                course.obstacles = []; course.ramps = [];
                course.gates = [];
                for (let i = 0; i < 9; i++) {
                    course.gates.push({ y: 120 + i * 120, x: 300, width: 160, passed: false, missed: false, side: 1 });
                }
                skier.speed = 240;
                const gains = [];
                let last = 0;
                for (let i = 0; i < 700; i++) {
                    step(1 / 60);
                    if (score !== last) { gains.push(score - last); last = score; }
                }
                return { max: Math.max(...gains), cap: GATE_POINTS * MAX_MULTIPLIER };
            });
            expect(r.max).toBe(r.cap);
        });

        test('missing a gate resets the multiplier', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                course.obstacles = []; course.ramps = [];
                course.gates = [
                    { y: 120, x: 300, width: 160, passed: false, missed: false, side: 1 },
                    { y: 240, x: 300, width: 160, passed: false, missed: false, side: 1 },
                    { y: 360, x: 40, width: 40, passed: false, missed: false, side: -1 },
                    { y: 480, x: 300, width: 160, passed: false, missed: false, side: 1 },
                ];
                skier.speed = 220;
                const gains = [];
                let last = 0;
                for (let i = 0; i < 400; i++) {
                    step(1 / 60);
                    if (score !== last) { gains.push(score - last); last = score; }
                }
                return { gains, points: GATE_POINTS };
            });
            expect(r.gains).toEqual([r.points, r.points * 2, r.points]);
        });
    });

    // -----------------------------------------------------------------------
    // Obstacles and crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        async function oneTree(page) {
            await emptySlope(page);
            await page.evaluate(() => {
                course.obstacles = [{ y: skier.y + 100, x: skier.x, r: 10, type: 'tree' }];
                skier.speed = 200;
            });
        }

        test('hitting a tree crashes the skier', async ({ page }) => {
            await oneTree(page);
            await advance(page, 1);
            const r = await page.evaluate(() => ({ crashes, speed: skier.speed, timer: skier.crashTimer }));
            expect(r.crashes).toBe(1);
            expect(r.speed).toBe(0);
            expect(r.timer).toBeGreaterThan(0);
        });

        test('a crash resets the streak', async ({ page }) => {
            await oneTree(page);
            await page.evaluate(() => { streak = 4; });
            await advance(page, 1);
            expect(await page.evaluate(() => streak)).toBe(0);
        });

        test('a downed skier does not move', async ({ page }) => {
            await oneTree(page);
            await advance(page, 1);
            const y1 = await page.evaluate(() => skier.y);
            await advance(page, 0.5);
            const y2 = await page.evaluate(() => skier.y);
            expect(y2).toBe(y1);
        });

        test('the skier gets up after CRASH_TIME', async ({ page }) => {
            await oneTree(page);
            await advance(page, 1);
            await page.evaluate(() => { for (let i = 0; i < 120; i++) step(CRASH_TIME / 60); });
            const r = await page.evaluate(() => ({ timer: skier.crashTimer, crashed: isCrashed() }));
            expect(r.timer).toBe(0);
            expect(r.crashed).toBe(false);
        });

        test('steering is dead while down', async ({ page }) => {
            await oneTree(page);
            await advance(page, 1);
            const before = await page.evaluate(() => { input.right = true; return skier.angle; });
            await advance(page, 0.3);
            expect(await page.evaluate(() => skier.angle)).toBe(before);
        });

        test('the same tree is not hit twice', async ({ page }) => {
            await oneTree(page);
            await advance(page, 5);
            expect(await page.evaluate(() => crashes)).toBe(1);
        });

        test('a tree off the racing line is missed cleanly', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => {
                course.obstacles = [{ y: skier.y + 100, x: skier.x + 120, r: 10, type: 'tree' }];
                skier.speed = 200;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => crashes)).toBe(0);
        });

        test('a tree is not tunnelled through in a long frame', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => {
                course.obstacles = [{ y: 400, x: skier.x, r: 10, type: 'tree' }];
                skier.speed = 260;
                step(3);
            });
            expect(await page.evaluate(() => crashes)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Ramps and air
    // -----------------------------------------------------------------------
    test.describe('ramps', () => {
        async function oneRamp(page) {
            await emptySlope(page);
            await page.evaluate(() => {
                course.ramps = [{ y: skier.y + 100, x: skier.x, w: 70 }];
                skier.speed = 200;
            });
        }

        test('hitting a ramp puts the skier in the air', async ({ page }) => {
            await oneRamp(page);
            await advance(page, 1);
            const r = await page.evaluate(() => ({ air: isAirborne(), timer: skier.airTimer }));
            expect(r.air).toBe(true);
            expect(r.timer).toBeGreaterThan(0);
        });

        test('a faster skier flies longer', async ({ page }) => {
            const slow = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = [];
                course.ramps = [{ y: 100, x: skier.x, w: 70 }];
                skier.speed = 120;
                for (let i = 0; i < 90; i++) step(1 / 60);
                return skier.airTimer;
            });
            const fast = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = [];
                course.ramps = [{ y: 100, x: skier.x, w: 70 }];
                skier.speed = 260;
                for (let i = 0; i < 40; i++) step(1 / 60);
                return skier.airTimer;
            });
            expect(fast).toBeGreaterThan(slow);
        });

        test('a skier in the air sails over obstacles', async ({ page }) => {
            await oneRamp(page);
            await page.evaluate(() => { course.obstacles = [{ y: skier.y + 160, x: skier.x, r: 10, type: 'tree' }]; });
            await advance(page, 1.2);
            const r = await page.evaluate(() => ({ crashes, air: isAirborne() }));
            expect(r.crashes).toBe(0);
            expect(r.air).toBe(true);
        });

        test('landing pays for the air time', async ({ page }) => {
            await oneRamp(page);
            await advance(page, 0.8);
            const mid = await page.evaluate(() => score);
            await advance(page, 4);
            const r = await page.evaluate(() => ({ score, air: isAirborne() }));
            expect(r.air).toBe(false);
            expect(r.score).toBeGreaterThan(mid);
        });

        test('gates still count while airborne', async ({ page }) => {
            await oneRamp(page);
            await page.evaluate(() => {
                course.gates = [{ y: skier.y + 160, x: skier.x, width: 140, passed: false, missed: false, side: 1 }];
            });
            await advance(page, 1);
            const r = await page.evaluate(() => ({ cleared: gatesCleared, air: isAirborne() }));
            expect(r.air).toBe(true);
            expect(r.cleared).toBe(1);
        });

        test('steering is weaker in the air', async ({ page }) => {
            const ground = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.speed = 200; input.right = true;
                for (let i = 0; i < 12; i++) step(1 / 60);
                return skier.angle;
            });
            const air = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.speed = 200; skier.airTimer = 2; skier.airDuration = 2; input.right = true;
                for (let i = 0; i < 12; i++) step(1 / 60);
                return skier.angle;
            });
            expect(air).toBeGreaterThan(0);
            expect(air).toBeLessThan(ground);
        });
    });

    // -----------------------------------------------------------------------
    // The clock
    // -----------------------------------------------------------------------
    test.describe('the clock', () => {
        test('the clock counts down while running', async ({ page }) => {
            await emptySlope(page);
            const before = await page.evaluate(() => timeLeft);
            await advance(page, 2);
            const after = await page.evaluate(() => timeLeft);
            expect(before - after).toBeCloseTo(2, 1);
        });

        test('running out of time ends the run', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { timeLeft = 0.2; });
            await advance(page, 1);
            const r = await page.evaluate(() => ({ state, won, timeLeft }));
            expect(r.state).toBe('gameover');
            expect(r.won).toBe(false);
            expect(r.timeLeft).toBe(0);
        });

        test('the game over overlay explains the timeout', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { timeLeft = 0.2; step(1); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/time/i);
        });

        test('the clock is shown in the HUD', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { timeLeft = 12.4; updateHud(); });
            await expect(page.locator('#time')).toHaveText('12.4');
        });
    });

    // -----------------------------------------------------------------------
    // Finishing
    // -----------------------------------------------------------------------
    test.describe('finishing', () => {
        async function skiToFinish(page) {
            await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.y = course.length - 20;
                skier.speed = 200;
                for (let i = 0; i < 60; i++) step(1 / 60);
            });
        }

        test('crossing the line finishes the course', async ({ page }) => {
            await skiToFinish(page);
            expect(await page.evaluate(() => state)).toBe('finished');
        });

        test('finishing pays a finish bonus plus the time left', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.y = course.length - 20;
                skier.speed = 200;
                timeLeft = 10;
                const before = score;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { gained: score - before, finish: FINISH_POINTS, bonus: TIME_BONUS, left: timeLeft };
            });
            expect(r.gained).toBe(r.finish + Math.round(r.left * r.bonus));
        });

        test('the finish overlay reports the course time', async ({ page }) => {
            await skiToFinish(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/course|finish/i);
            await expect(page.locator('#overlay-score')).toContainText(/\d/);
        });

        test('Space moves on to the next course', async ({ page }) => {
            await skiToFinish(page);
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, level, y: skier.y, x: skier.x }));
            expect(r.state).toBe('running');
            expect(r.level).toBe(2);
            expect(r.y).toBe(0);
            expect(r.x).toBe(300);
        });

        test('score carries across courses but the clock resets', async ({ page }) => {
            await skiToFinish(page);
            const before = await page.evaluate(() => score);
            await page.evaluate(() => nextCourse());
            const r = await page.evaluate(() => ({ score, timeLeft, limit: course.timeLimit }));
            expect(r.score).toBe(before);
            expect(r.timeLeft).toBe(r.limit);
        });

        test('finishing the last course wins the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = COURSE_COUNT;
                loadCourse(COURSE_COUNT);
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.y = course.length - 20;
                skier.speed = 200;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { state, won };
            });
            expect(r.state).toBe('gameover');
            expect(r.won).toBe(true);
        });

        test('a won game says so on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                level = COURSE_COUNT;
                loadCourse(COURSE_COUNT);
                course.gates = []; course.obstacles = []; course.ramps = [];
                skier.y = course.length - 20;
                skier.speed = 200;
                for (let i = 0; i < 60; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay-title')).toContainText(/won|champion|winner/i);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Escape pauses', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('a paused game does not tick', async ({ page }) => {
            await emptySlope(page);
            await advance(page, 1);
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ y: skier.y, t: timeLeft }));
            await advance(page, 1);
            const after = await page.evaluate(() => ({ y: skier.y, t: timeLeft }));
            expect(after).toEqual(before);
        });

        test('the pause overlay is visible while paused', async ({ page }) => {
            await emptySlope(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('pausing is ignored when the game is not running', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Scoreboard / HUD
    // -----------------------------------------------------------------------
    test.describe('HUD and best score', () => {
        test('the HUD shows score, course and gates', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { score = 1234; gatesCleared = 7; level = 2; updateHud(); });
            await expect(page.locator('#score')).toHaveText('1234');
            await expect(page.locator('#level')).toHaveText('2');
            await expect(page.locator('#gates')).toHaveText('7');
        });

        test('the best score is kept when a run ends', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { score = 2500; timeLeft = 0.1; step(0.5); });
            const stored = await page.evaluate(() => window.localStorage.getItem('alpine-ski-best'));
            expect(Number(stored)).toBe(2500);
            await expect(page.locator('#best')).toHaveText('2500');
        });

        test('a worse run does not lower the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('alpine-ski-best', '9000'));
            await page.reload();
            await page.evaluate(() => setAutoStep(false));
            await emptySlope(page);
            await page.evaluate(() => { score = 100; timeLeft = 0.1; step(0.5); });
            expect(await page.evaluate(() => Number(window.localStorage.getItem('alpine-ski-best')))).toBe(9000);
        });

        test('restarting after a run clears the score but keeps the best', async ({ page }) => {
            await emptySlope(page);
            await page.evaluate(() => { score = 800; timeLeft = 0.1; step(0.5); });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, level, best }));
            expect(r.state).toBe('running');
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.best).toBe(800);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke tests
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const blank = await page.evaluate(() => {
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
                return true;
            });
            expect(blank).toBe(false);
        });

        test('a full run draws without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                input.tuck = true;
                for (let i = 0; i < 1800; i++) { step(1 / 60); draw(); }
            });
            expect(errors).toEqual([]);
        });
    });
});
