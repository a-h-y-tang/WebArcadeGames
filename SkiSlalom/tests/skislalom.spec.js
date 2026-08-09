const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no gates on the hill before starting', async ({ page }) => {
            expect(await page.evaluate(() => gates.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('ski-slalom-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
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

        test('a new game begins on run 1 with full lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { run, lives, score, gatesPassed, gatesMissed, start: START_LIVES };
            });
            expect(s.run).toBe(1);
            expect(s.lives).toBe(s.start);
            expect(s.score).toBe(0);
            expect(s.gatesPassed).toBe(0);
            expect(s.gatesMissed).toBe(0);
        });

        test('the skier starts at the top of the course, centred and stopped', async ({ page }) => {
            const skier = await page.evaluate(() => {
                startGame();
                return { x: skier.x, y: skier.y, speed: skier.speed, crashTimer: skier.crashTimer };
            });
            expect(skier.y).toBe(0);
            expect(skier.x).toBe(300);
            expect(skier.speed).toBe(0);
            expect(skier.crashTimer).toBe(0);
        });

        test('starting builds a full course of gates', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); return gates.length; });
            expect(n).toBe(await page.evaluate(() => GATES_PER_RUN));
        });
    });

    // -----------------------------------------------------------------------
    // Course generation
    // -----------------------------------------------------------------------
    test.describe('course generation', () => {
        test('gates are evenly spaced down the hill', async ({ page }) => {
            const ys = await page.evaluate(() => { startGame(); return gates.map((g) => g.y); });
            const spacing = await page.evaluate(() => GATE_SPACING);
            for (let i = 0; i < ys.length; i++) {
                expect(ys[i]).toBe(spacing * (i + 1));
            }
        });

        test('every gate opening sits inside the course edges', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return gates.every((g) => g.x - g.half >= 0 && g.x + g.half <= COURSE_W);
            });
            expect(ok).toBe(true);
        });

        test('the finish line lies beyond the last gate', async ({ page }) => {
            const { last, length } = await page.evaluate(() => {
                startGame();
                return { last: gates[gates.length - 1].y, length: courseLength() };
            });
            expect(length).toBeGreaterThan(last);
        });

        test('the same seed always builds the same course', async ({ page }) => {
            const same = await page.evaluate(() => {
                buildCourse(7);
                const a = JSON.stringify({ gates, trees });
                buildCourse(7);
                const b = JSON.stringify({ gates, trees });
                return a === b;
            });
            expect(same).toBe(true);
        });

        test('different seeds build different courses', async ({ page }) => {
            const differ = await page.evaluate(() => {
                buildCourse(1);
                const a = JSON.stringify(gates);
                buildCourse(2);
                const b = JSON.stringify(gates);
                return a !== b;
            });
            expect(differ).toBe(true);
        });

        test('gates get narrower on later runs, down to a floor', async ({ page }) => {
            const { early, late, floor, min } = await page.evaluate(() => ({
                early: gateHalf(1),
                late: gateHalf(4),
                floor: gateHalf(99),
                min: GATE_MIN_HALF,
            }));
            expect(late).toBeLessThan(early);
            expect(floor).toBe(min);
        });

        test('later runs put more trees on the hill', async ({ page }) => {
            const { first, later } = await page.evaluate(() => {
                buildCourse(1);
                const first = trees.length;
                buildCourse(4);
                return { first, later: trees.length };
            });
            expect(later).toBeGreaterThan(first);
        });

        test('no tree is planted inside a gate opening', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                let blocked = 0;
                for (let seed = 1; seed <= 6; seed++) {
                    buildCourse(seed);
                    for (const g of gates) {
                        for (const t of trees) {
                            const near = Math.abs(t.y - g.y) < TREE_R + SKIER_R;
                            const inside = Math.abs(t.x - g.x) < g.half;
                            if (near && inside) blocked++;
                        }
                    }
                }
                return blocked;
            });
            expect(blocked).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Skiing / movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the skier accelerates down the hill', async ({ page }) => {
            const { y, speed } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 30; i++) step(0.016);
                return { y: skier.y, speed: skier.speed };
            });
            expect(y).toBeGreaterThan(0);
            expect(speed).toBeGreaterThan(0);
        });

        test('cruising speed is capped', async ({ page }) => {
            const { speed, cap } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 400; i++) step(0.016);
                return { speed: skier.speed, cap: BASE_MAX };
            });
            expect(speed).toBeLessThanOrEqual(cap + 0.001);
            expect(speed).toBeGreaterThan(cap - 1);
        });

        test('tucking raises the top speed', async ({ page }) => {
            const { cruise, tucked } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                // Hold the skier at the top of the course so the run cannot end
                // while we are measuring how fast they get going.
                for (let i = 0; i < 400; i++) { step(0.016); skier.y = 0; }
                const cruise = skier.speed;
                setTuck(true);
                for (let i = 0; i < 400; i++) { step(0.016); skier.y = 0; }
                return { cruise, tucked: skier.speed };
            });
            expect(tucked).toBeGreaterThan(cruise);
        });

        test('steering left moves the skier left', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const before = skier.x;
                steer(-1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: skier.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('steering right moves the skier right', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const before = skier.x;
                steer(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: skier.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the skier cannot leave the left edge of the course', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                steer(-1);
                for (let i = 0; i < 400; i++) step(0.016);
                return skier.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the skier cannot leave the right edge of the course', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                steer(1);
                for (let i = 0; i < 400; i++) step(0.016);
                return { x: skier.x, w: COURSE_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('carving a turn costs speed', async ({ page }) => {
            const { straight, carving } = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 400; i++) step(0.016);
                const straight = skier.speed;
                steer(1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { straight, carving: skier.speed };
            });
            expect(carving).toBeLessThan(straight);
        });

        test('ArrowRight steers right and releasing it stops the turn', async ({ page }) => {
            await page.evaluate(() => { startGame(); trees.length = 0; });
            await page.keyboard.down('ArrowRight');
            const dirDown = await page.evaluate(() => steerDir);
            await page.keyboard.up('ArrowRight');
            const dirUp = await page.evaluate(() => steerDir);
            expect(dirDown).toBe(1);
            expect(dirUp).toBe(0);
        });

        test('ArrowDown tucks and releasing it stands the skier up', async ({ page }) => {
            await page.evaluate(() => { startGame(); trees.length = 0; });
            await page.keyboard.down('ArrowDown');
            const down = await page.evaluate(() => tucking);
            await page.keyboard.up('ArrowDown');
            const up = await page.evaluate(() => tucking);
            expect(down).toBe(true);
            expect(up).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Gates
    // -----------------------------------------------------------------------
    test.describe('gates', () => {
        test('skiing through a gate scores and counts it as passed', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const g = gates[0];
                setSkierX(g.x);
                skier.y = g.y - 20;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 20; i++) step(0.016);
                return { passed: gatesPassed, missed: gatesMissed, score, flag: gates[0].state };
            });
            expect(r.passed).toBe(1);
            expect(r.missed).toBe(0);
            expect(r.score).toBeGreaterThan(0);
            expect(r.flag).toBe('passed');
        });

        test('skiing outside a gate counts as a miss', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const g = gates[0];
                setSkierX(g.x > COURSE_W / 2 ? g.x - g.half - 40 : g.x + g.half + 40);
                skier.y = g.y - 20;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 20; i++) step(0.016);
                return { passed: gatesPassed, missed: gatesMissed, flag: gates[0].state };
            });
            expect(r.passed).toBe(0);
            expect(r.missed).toBe(1);
            expect(r.flag).toBe('missed');
        });

        test('a missed gate adds a time penalty', async ({ page }) => {
            const penalty = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const g = gates[0];
                setSkierX(g.x > COURSE_W / 2 ? g.x - g.half - 40 : g.x + g.half + 40);
                skier.y = g.y - 20;
                skier.speed = BASE_MAX;
                const before = elapsed;
                let steps = 0;
                while (gatesMissed === 0 && steps < 60) { step(0.016); steps++; }
                return elapsed - before - steps * 0.016;
            });
            expect(penalty).toBeCloseTo(await page.evaluate(() => MISS_PENALTY), 3);
        });

        test('a gate can only be scored once', async ({ page }) => {
            const passed = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const g = gates[0];
                setSkierX(g.x);
                skier.y = g.y - 20;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 20; i++) step(0.016);
                // rewind above the gate and ski through it a second time
                skier.y = g.y - 20;
                for (let i = 0; i < 20; i++) step(0.016);
                return gatesPassed;
            });
            expect(passed).toBe(1);
        });

        test('nextGate reports the next gate ahead of the skier', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = nextGate().y;
                skier.y = gates[0].y + 1;
                return { first, second: nextGate().y, expected: gates[1].y };
            });
            expect(r.first).toBe(await page.evaluate(() => gates[0].y));
            expect(r.second).toBe(r.expected);
        });

        test('gates passed are shown in the HUD as passed / total', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const g = gates[0];
                setSkierX(g.x);
                skier.y = g.y - 20;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 20; i++) step(0.016);
            });
            const total = await page.evaluate(() => GATES_PER_RUN);
            await expect(page.locator('#gates')).toHaveText(`1/${total}`);
        });
    });

    // -----------------------------------------------------------------------
    // Trees and crashes
    // -----------------------------------------------------------------------
    test.describe('crashes', () => {
        test('hitting a tree stops the skier dead', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                for (let i = 0; i < 20; i++) step(0.016);
                return { speed: skier.speed, crashTimer: skier.crashTimer };
            });
            expect(r.speed).toBe(0);
            expect(r.crashTimer).toBeGreaterThan(0);
        });

        test('a crash costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                for (let i = 0; i < 20; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe((await page.evaluate(() => START_LIVES)) - 1);
        });

        test('the skier does not move while sprawled in the snow', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                let steps = 0;
                while (skier.crashTimer === 0 && steps < 60) { step(0.016); steps++; }
                const y = skier.y;
                steer(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { y, after: skier.y, x: skier.x };
            });
            expect(r.after).toBe(r.y);
            expect(r.x).toBe(300);
        });

        test('the skier gets up and skis again once the crash clears', async ({ page }) => {
            const moving = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                for (let i = 0; i < 20; i++) step(0.016);
                const y = skier.y;
                for (let i = 0; i < 200; i++) step(0.016);
                return { crashTimer: skier.crashTimer, moved: skier.y > y };
            });
            expect(moving.crashTimer).toBe(0);
            expect(moving.moved).toBe(true);
        });

        test('the same tree cannot be hit twice', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                for (let i = 0; i < 400; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe((await page.evaluate(() => START_LIVES)) - 1);
        });

        test('a tree well clear of the skier is not a crash', async ({ page }) => {
            const crashTimer = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                setSkierX(100);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 500, y: 140, hit: false });
                for (let i = 0; i < 20; i++) step(0.016);
                return skier.crashTimer;
            });
            expect(crashTimer).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                lives = 1;
                setSkierX(300);
                skier.y = 100;
                skier.speed = BASE_MAX;
                trees.push({ x: 300, y: 140, hit: false });
                for (let i = 0; i < 20; i++) step(0.016);
                return { state, lives };
            });
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Finishing a run
    // -----------------------------------------------------------------------
    test.describe('finishing', () => {
        test('crossing the finish line starts the next run', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                let steps = 0;
                while (run === 1 && steps < 20) { step(0.016); steps++; }
                return { run, y: skier.y, elapsed, state };
            });
            expect(r.run).toBe(2);
            expect(r.y).toBe(0);
            expect(r.elapsed).toBe(0);
            expect(r.state).toBe('running');
        });

        test('finishing awards the finish bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                score = 0;
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 5; i++) step(0.016);
                return score;
            });
            expect(gained).toBeGreaterThanOrEqual(await page.evaluate(() => FINISH_BONUS));
        });

        test('a quicker run earns a bigger time bonus', async ({ page }) => {
            const { quick, slow } = await page.evaluate(() => ({
                quick: timeBonus(2),
                slow: timeBonus(parTime() - 1),
            }));
            expect(quick).toBeGreaterThan(slow);
        });

        test('a run slower than par earns no time bonus', async ({ page }) => {
            const bonus = await page.evaluate(() => timeBonus(parTime() + 30));
            expect(bonus).toBe(0);
        });

        test('finishing builds a fresh course', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                const before = JSON.stringify(gates);
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 5; i++) step(0.016);
                return {
                    changed: JSON.stringify(gates) !== before,
                    fresh: gates.every((g) => g.state === 'ahead'),
                    count: gates.length,
                };
            });
            expect(r.changed).toBe(true);
            expect(r.fresh).toBe(true);
            expect(r.count).toBe(await page.evaluate(() => GATES_PER_RUN));
        });

        test('finishing awards a bonus life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                lives = 2;
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 5; i++) step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('lives never exceed the maximum', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                lives = MAX_LIVES;
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 5; i++) step(0.016);
                return { lives, max: MAX_LIVES };
            });
            expect(r.lives).toBe(r.max);
        });

        test('the gate counter resets for the new run', async ({ page }) => {
            const passed = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                gatesPassed = 5;
                skier.y = courseLength() - 5;
                skier.speed = BASE_MAX;
                for (let i = 0; i < 5; i++) step(0.016);
                return gatesPassed;
            });
            expect(passed).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 1234; endGame(); });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 777; endGame(); });
            const stored = await page.evaluate(() => window.localStorage.getItem('ski-slalom-best'));
            expect(parseInt(stored, 10)).toBe(777);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('ski-slalom-best', '9000'));
            await page.reload();
            await page.evaluate(() => { startGame(); score = 10; endGame(); });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the run clock ticks while skiing', async ({ page }) => {
            const elapsed = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 60; i++) step(0.016);
                return elapsed;
            });
            expect(elapsed).toBeCloseTo(0.96, 2);
            await expect(page.locator('#time')).not.toHaveText('0.0');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the skier', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 20; i++) step(0.016);
                togglePause();
                const y = skier.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { y, after: skier.y, state };
            });
            expect(r.state).toBe('paused');
            expect(r.after).toBe(r.y);
        });

        test('resuming lets the skier run again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                trees.length = 0;
                for (let i = 0; i < 20; i++) step(0.016);
                togglePause();
                togglePause();
                const y = skier.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return skier.y > y;
            });
            expect(moved).toBe(true);
        });

        test('P toggles pause from the keyboard', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('restarting after game over resets the whole game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 5000;
                run = 4;
                lives = 1;
                gatesPassed = 9;
                gatesMissed = 3;
                elapsed = 40;
                endGame();
                startGame();
                return { score, run, lives, gatesPassed, gatesMissed, elapsed, state, y: skier.y };
            });
            expect(r.score).toBe(0);
            expect(r.run).toBe(1);
            expect(r.lives).toBe(await page.evaluate(() => START_LIVES));
            expect(r.gatesPassed).toBe(0);
            expect(r.gatesMissed).toBe(0);
            expect(r.elapsed).toBe(0);
            expect(r.state).toBe('running');
            expect(r.y).toBe(0);
        });
    });
});
