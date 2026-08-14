const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation by `seconds` worth of 60 fps frames.
const RUN = (seconds) => `for (let i = 0; i < ${Math.round(seconds * 60)}; i++) step(1 / 60);`;

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

        test('canvas is 480x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero', async ({ page }) => {
            await expect(page.locator('#time')).toHaveText('0.00');
            await expect(page.locator('#gates')).toHaveText(`0/${await page.evaluate(() => GATE_COUNT)}`);
            await expect(page.locator('#penalty')).toHaveText('0.0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { x: skier.x, y: skier.y, t: elapsed };
                for (let i = 0; i < 60; i++) step(1 / 60);
                return skier.x !== before.x || skier.y !== before.y || elapsed !== before.t;
            });
            expect(moved).toBe(false);
        });

        test('best time loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('ski-slalom-best', '42.5'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('42.50');
        });

        test('best time shows a dash when there is no record', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('--');
        });
    });

    // -----------------------------------------------------------------------
    // Course generation
    // -----------------------------------------------------------------------
    test.describe('course generation', () => {
        test('a course has GATE_COUNT gates going down the hill', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                return {
                    count: gates.length,
                    expected: GATE_COUNT,
                    ys: gates.map((g) => g.y),
                };
            });
            expect(info.count).toBe(info.expected);
            for (let i = 1; i < info.ys.length; i++) {
                expect(info.ys[i]).toBeGreaterThan(info.ys[i - 1]);
            }
        });

        test('every gate fits inside the slope', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame(7);
                return gates.every((g) => g.x - GATE_HALF >= 0 && g.x + GATE_HALF <= CANVAS_W);
            });
            expect(ok).toBe(true);
        });

        test('gate colours alternate blue and red', async ({ page }) => {
            const colours = await page.evaluate(() => {
                startGame(3);
                return gates.map((g) => g.side);
            });
            colours.forEach((side, i) => expect(side).toBe(i % 2 === 0 ? 'blue' : 'red'));
        });

        test('the finish line is below the last gate', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(2);
                return { finish: FINISH_Y, last: gates[gates.length - 1].y };
            });
            expect(info.finish).toBeGreaterThan(info.last);
        });

        test('the same seed always builds the same course', async ({ page }) => {
            const same = await page.evaluate(() => {
                const snap = () => JSON.stringify({ gates, trees });
                startGame(99);
                const a = snap();
                startGame(99);
                return a === snap();
            });
            expect(same).toBe(true);
        });

        test('different seeds build different courses', async ({ page }) => {
            const differs = await page.evaluate(() => {
                startGame(1);
                const a = JSON.stringify(gates);
                startGame(2);
                return a !== JSON.stringify(gates);
            });
            expect(differs).toBe(true);
        });

        test('no tree blocks the corridor of a gate', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                const hits = [];
                for (let seed = 1; seed <= 12; seed++) {
                    startGame(seed);
                    for (const tree of trees) {
                        for (const gate of gates) {
                            const near = Math.abs(tree.y - gate.y) < GATE_CLEAR_Y;
                            const inside = Math.abs(tree.x - gate.x) < GATE_HALF + GATE_CLEAR_X;
                            if (near && inside) hits.push({ seed, tree, gate });
                        }
                    }
                }
                return hits;
            });
            expect(blocked).toEqual([]);
        });

        test('the course has trees to dodge', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame(5);
                return trees.length;
            });
            expect(count).toBeGreaterThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the run', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the skier starts at the top, centred and stationary', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame(1);
                return { x: skier.x, y: skier.y, speed: skier.speed, heading: skier.heading, w: CANVAS_W };
            });
            expect(s.x).toBeCloseTo(s.w / 2, 5);
            expect(s.y).toBe(0);
            expect(s.speed).toBe(0);
            expect(s.heading).toBe(0);
        });

        test('starting resets the clock, gates and penalties', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame(1);
                for (let i = 0; i < 120; i++) step(1 / 60);
                startGame(1);
                return { elapsed, passed, missed, penalty, crashes };
            });
            expect(after).toEqual({ elapsed: 0, passed: 0, missed: 0, penalty: 0, crashes: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Steering and speed
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('holding left turns the skier left', async ({ page }) => {
            const heading = await page.evaluate(() => {
                startGame(1);
                steer(-1);
                for (let i = 0; i < 20; i++) step(1 / 60);
                return skier.heading;
            });
            expect(heading).toBeLessThan(0);
        });

        test('holding right turns the skier right', async ({ page }) => {
            const heading = await page.evaluate(() => {
                startGame(1);
                steer(1);
                for (let i = 0; i < 20; i++) step(1 / 60);
                return skier.heading;
            });
            expect(heading).toBeGreaterThan(0);
        });

        test('the turn is clamped to MAX_ANGLE', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                steer(1);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { heading: skier.heading, max: MAX_ANGLE };
            });
            expect(info.heading).toBeCloseTo(info.max, 5);
        });

        test('letting go re-centres the skis toward the fall line', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                steer(-1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                const turned = skier.heading;
                steer(0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { turned, released: skier.heading };
            });
            expect(info.turned).toBeLessThan(0);
            expect(info.released).toBeGreaterThan(info.turned);
            expect(info.released).toBeLessThanOrEqual(0);
        });

        test('arrow keys steer, releasing them stops the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowRight');
            const turning = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) step(1 / 60);
                return skier.heading;
            });
            expect(turning).toBeGreaterThan(0);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => skier.turn)).toBe(0);
        });

        test('A and D steer as well as the arrows', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('KeyA');
            expect(await page.evaluate(() => skier.turn)).toBe(-1);
            await page.keyboard.up('KeyA');
            await page.keyboard.down('KeyD');
            expect(await page.evaluate(() => skier.turn)).toBe(1);
        });
    });

    test.describe('speed', () => {
        test('the skier accelerates from a standstill', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame(1);
                const out = [];
                for (let i = 0; i < 60; i++) {
                    step(1 / 60);
                    if (i % 20 === 19) out.push(skier.speed);
                }
                return out;
            });
            expect(speeds[0]).toBeGreaterThan(0);
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('running the fall line tops out at MAX_SPEED', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                skier.x = 20;           // hug the edge, away from the trees
                for (let i = 0; i < 600; i++) { skier.x = 20; step(1 / 60); }
                return { speed: skier.speed, max: MAX_SPEED };
            });
            expect(info.speed).toBeGreaterThan(info.max * 0.98);
            expect(info.speed).toBeLessThanOrEqual(info.max + 1e-6);
        });

        test('carving across the hill is slower than running it straight', async ({ page }) => {
            const info = await page.evaluate(() => {
                // Both runs are pinned to the same tree-free lane near the edge,
                // so the only difference between them is the ski angle.
                const settle = (turn) => {
                    startGame(1);
                    steer(turn);
                    for (let i = 0; i < 600; i++) { skier.x = 24; step(1 / 60); }
                    return skier.speed;
                };
                return { straight: settle(0), carved: settle(1) };
            });
            expect(info.carved).toBeLessThan(info.straight * 0.75);
        });

        test('a turned skier travels sideways as well as down', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const x0 = skier.x;
                steer(1);
                for (let i = 0; i < 90; i++) step(1 / 60);
                return { dx: skier.x - x0, y: skier.y };
            });
            expect(info.dx).toBeGreaterThan(0);
            expect(info.y).toBeGreaterThan(0);
        });

        test('the skier cannot leave the slope and is slowed at the edge', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                steer(-1);
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { x: skier.x, speed: skier.speed, edge: EDGE_MARGIN, cap: EDGE_SPEED };
            });
            expect(info.x).toBeGreaterThanOrEqual(info.edge - 1e-6);
            expect(info.speed).toBeLessThanOrEqual(info.cap + 1e-6);
        });
    });

    // -----------------------------------------------------------------------
    // Gates
    // -----------------------------------------------------------------------
    test.describe('gates', () => {
        test('skiing between the poles counts as a pass', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const gate = gates[0];
                setSkier(gate.x, gate.y - 30);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { passed, missed, penalty };
            });
            expect(info.passed).toBe(1);
            expect(info.missed).toBe(0);
            expect(info.penalty).toBe(0);
        });

        test('missing a gate adds a time penalty', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const gate = gates[0];
                const outside = gate.x + GATE_HALF + 30 < CANVAS_W - EDGE_MARGIN
                    ? gate.x + GATE_HALF + 30
                    : gate.x - GATE_HALF - 30;
                setSkier(outside, gate.y - 30);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { passed, missed, penalty, each: MISS_PENALTY };
            });
            expect(info.passed).toBe(0);
            expect(info.missed).toBe(1);
            expect(info.penalty).toBe(info.each);
        });

        test('grazing the inside of a pole still counts', async ({ page }) => {
            const passed = await page.evaluate(() => {
                startGame(4);
                const gate = gates[0];
                setSkier(gate.x + GATE_HALF - 2, gate.y - 20);
                for (let i = 0; i < 40; i++) step(1 / 60);
                return window.passed;
            });
            expect(passed).toBe(1);
        });

        test('each gate is only scored once', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const gate = gates[0];
                setSkier(gate.x, gate.y - 20);
                for (let i = 0; i < 40; i++) step(1 / 60);
                const first = passed;
                setSkier(gate.x, gate.y - 20);   // ski the same gate again
                for (let i = 0; i < 40; i++) step(1 / 60);
                return { first, second: passed };
            });
            expect(info.first).toBe(1);
            expect(info.second).toBe(1);
        });

        test('the HUD shows gates passed and the penalty', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                setSkier(gates[0].x, gates[0].y - 20);
                for (let i = 0; i < 40; i++) step(1 / 60);
            });
            await expect(page.locator('#gates')).toHaveText(`1/${await page.evaluate(() => GATE_COUNT)}`);
            await expect(page.locator('#penalty')).toHaveText('0.0');

            await page.evaluate(() => {
                const gate = gates[1];
                setSkier(gate.x - GATE_HALF - 40, gate.y - 20);
                for (let i = 0; i < 40; i++) step(1 / 60);
            });
            await expect(page.locator('#penalty')).toHaveText('3.0');
        });
    });

    // -----------------------------------------------------------------------
    // Trees and crashes
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('hitting a tree stops the skier', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const tree = trees[0];
                setSkier(tree.x, tree.y - 12);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { speed: skier.speed, crashes, timer: crashTimer };
            });
            expect(info.crashes).toBe(1);
            expect(info.speed).toBe(0);
            expect(info.timer).toBeGreaterThan(0);
        });

        test('a crashed skier stays put but the clock keeps running', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const tree = trees[0];
                setSkier(tree.x, tree.y - 12);
                for (let i = 0; i < 30; i++) step(1 / 60);
                const at = { x: skier.x, y: skier.y, t: elapsed };
                for (let i = 0; i < 20; i++) step(1 / 60);
                return { at, x: skier.x, y: skier.y, t: elapsed };
            });
            expect(info.x).toBeCloseTo(info.at.x, 6);
            expect(info.y).toBeCloseTo(info.at.y, 6);
            expect(info.t).toBeGreaterThan(info.at.t);
        });

        test('the skier gets up after CRASH_TIME and skis on', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const tree = trees[0];
                setSkier(tree.x, tree.y - 12);
                const frames = Math.ceil((CRASH_TIME + 0.6) * 60);
                for (let i = 0; i < frames; i++) step(1 / 60);
                return { timer: crashTimer, speed: skier.speed };
            });
            expect(info.timer).toBe(0);
            expect(info.speed).toBeGreaterThan(0);
        });

        test('a tree that has been knocked over cannot be hit again', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const tree = trees[0];
                setSkier(tree.x, tree.y - 12);
                for (let i = 0; i < 30; i++) step(1 / 60);
                const first = crashes;
                setSkier(tree.x, tree.y - 12);          // ski into the same trunk again
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { first, second: crashes, knocked: tree.hit };
            });
            expect(info.first).toBe(1);
            expect(info.second).toBe(1);
            expect(info.knocked).toBe(true);
        });

        test('the HUD counts crashes', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                const tree = trees[0];
                setSkier(tree.x, tree.y - 12);
                for (let i = 0; i < 30; i++) step(1 / 60);
            });
            await expect(page.locator('#crashes')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Finishing
    // -----------------------------------------------------------------------
    test.describe('finishing', () => {
        test('crossing the finish line ends the run', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { state, y: skier.y, finish: FINISH_Y };
            });
            expect(info.state).toBe('finished');
            expect(info.y).toBeGreaterThanOrEqual(info.finish);
        });

        test('the clock stops at the finish', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
                const t = elapsed;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { t, after: elapsed };
            });
            expect(info.after).toBe(info.t);
        });

        test('the final time is the clock plus penalties', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { total: finalTime(), elapsed, penalty };
            });
            expect(info.penalty).toBeGreaterThan(0);   // every gate was skipped
            expect(info.total).toBeCloseTo(info.elapsed + info.penalty, 6);
        });

        test('the finish overlay reports the run', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/finish/i);
            await expect(page.locator('#overlay-score')).toContainText(/\d+\.\d\d/);
        });

        test('a finished run is recorded as the best time', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { stored: window.localStorage.getItem('ski-slalom-best'), total: finalTime() };
            });
            expect(Number(best.stored)).toBeCloseTo(best.total, 6);
        });

        test('only a faster run replaces the best time', async ({ page }) => {
            const stored = await page.evaluate(() => {
                window.localStorage.setItem('ski-slalom-best', '1');
                bestTime = 1;
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return window.localStorage.getItem('ski-slalom-best');
            });
            expect(Number(stored)).toBe(1);
        });

        test('Space starts a fresh run after finishing', async ({ page }) => {
            await page.evaluate(() => {
                startGame(1);
                setSkier(CANVAS_W / 2, FINISH_Y - 30);
                for (let i = 0; i < 120; i++) step(1 / 60);
            });
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => ({ state, elapsed, passed }));
            expect(info.state).toBe('running');
            expect(info.elapsed).toBeLessThan(0.5);   // the live loop is already ticking
            expect(info.passed).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                for (let i = 0; i < 60; i++) step(1 / 60);
                togglePause();
                const at = { y: skier.y, t: elapsed };
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { at, y: skier.y, t: elapsed };
            });
            expect(info.y).toBe(info.at.y);
            expect(info.t).toBe(info.at.t);
        });

        test('the pause overlay is shown and hidden again', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // A whole run
    // -----------------------------------------------------------------------
    test.describe('a whole run', () => {
        test('the clock ticks up in real time while running', async ({ page }) => {
            const elapsed = await page.evaluate(() => {
                startGame(1);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return window.elapsed;
            });
            expect(elapsed).toBeCloseTo(2, 1);
        });

        test('an autopilot can ski every gate on several courses', async ({ page }) => {
            const runs = await page.evaluate(() => {
                const results = [];
                for (const seed of [1, 2, 3, 4, 5]) {
                    startGame(seed);
                    let guard = 0;
                    while (state === 'running' && guard++ < 60 * 120) {
                        // Aim at the next gate, steering off where the skier will
                        // be in 0.35 s rather than where it is, so the turn is
                        // unwound before the poles instead of after them.
                        const gate = gates[Math.min(passed + missed, gates.length - 1)];
                        const target = skier.y < gate.y ? gate.x : CANVAS_W / 2;
                        const lead = skier.x + Math.sin(skier.heading) * skier.speed * 0.35;
                        const dx = target - lead;
                        steer(Math.abs(dx) < 8 ? 0 : Math.sign(dx));
                        step(1 / 60);
                    }
                    results.push({ seed, state, passed, missed, total: finalTime() });
                }
                return results;
            });
            for (const run of runs) {
                expect(run.state, `seed ${run.seed} finished`).toBe('finished');
                expect(run.missed, `seed ${run.seed} missed no gate`).toBe(0);
                expect(run.total, `seed ${run.seed} time`).toBeGreaterThan(5);
                expect(run.total, `seed ${run.seed} time`).toBeLessThan(90);
            }
        });

        test('a straight-lining run misses gates and is penalised', async ({ page }) => {
            const run = await page.evaluate(() => {
                startGame(6);
                let guard = 0;
                while (state === 'running' && guard++ < 60 * 120) step(1 / 60);
                return { state, missed, penalty, elapsed, total: finalTime() };
            });
            expect(run.state).toBe('finished');
            expect(run.missed).toBeGreaterThan(0);
            expect(run.total).toBeGreaterThan(run.elapsed);
        });

        test('the simulation is deterministic for a given seed and inputs', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                const run = () => {
                    startGame(8);
                    for (let i = 0; i < 600; i++) {
                        steer(i % 120 < 60 ? 1 : -1);
                        step(1 / 60);
                    }
                    return JSON.stringify({ x: skier.x, y: skier.y, passed, missed, crashes, elapsed });
                };
                return [run(), run()];
            });
            expect(a).toBe(b);
        });

        test('stepping at 30 fps and at 120 fps agree', async ({ page }) => {
            const info = await page.evaluate(() => {
                const run = (fps) => {
                    startGame(1);
                    steer(1);
                    for (let i = 0; i < 4 * fps; i++) step(1 / fps);
                    return { x: skier.x, y: skier.y };
                };
                return { slow: run(30), fast: run(120) };
            });
            expect(info.slow.x).toBeCloseTo(info.fast.x, 0);
            expect(info.slow.y).toBeCloseTo(info.fast.y, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn on', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame(1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const colours = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return colours.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('the view follows the skier down the hill', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame(1);
                const before = cameraY();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { before, after: cameraY(), screenY: skier.y - cameraY(), fixed: SKIER_SCREEN_Y };
            });
            expect(info.after).toBeGreaterThan(info.before);
            expect(info.screenY).toBeCloseTo(info.fixed, 6);
        });
    });
});
