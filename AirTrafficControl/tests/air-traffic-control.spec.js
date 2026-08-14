const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/** Start a shift and clear the randomly spawned traffic so a test owns the sky. */
async function startClean(page) {
    await page.evaluate(() => {
        startGame();
        aircraft.length = 0;
        spawnTimer = 999;
    });
}

test.describe('Air Traffic Control', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Air Traffic Control', async ({ page }) => {
            await expect(page).toHaveTitle('Air Traffic Control');
        });

        test('scope is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, best and traffic start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#traffic')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no aircraft are in the air', async ({ page }) => {
            expect(await page.evaluate(() => aircraft.length)).toBe(0);
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                const before = { x: aircraft[0].x, y: aircraft[0].y };
                for (let i = 0; i < 30; i++) step(0.016);
                return aircraft[0].x !== before.x || aircraft[0].y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('air-traffic-control-best', '17'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('17');
        });
    });

    // -----------------------------------------------------------------------
    // The airfield
    // -----------------------------------------------------------------------
    test.describe('destinations', () => {
        test('jets are sent to the runway, helicopters to the helipad', async ({ page }) => {
            const dests = await page.evaluate(() => ({
                jet: destinationFor('jet').type,
                heli: destinationFor('heli').type,
            }));
            expect(dests.jet).toBe('jet');
            expect(dests.heli).toBe('heli');
        });

        test('both destinations sit inside the scope', async ({ page }) => {
            const ok = await page.evaluate(() => DESTINATIONS.every((d) => (
                d.x > 0 && d.x < CANVAS_W && d.y > 0 && d.y < CANVAS_H
            )));
            expect(ok).toBe(true);
        });

        test('the runway and the helipad are far apart', async ({ page }) => {
            const gap = await page.evaluate(() => {
                const [a, b] = DESTINATIONS;
                return Math.hypot(a.x - b.x, a.y - b.y);
            });
            expect(gap).toBeGreaterThan(200);
        });

        test('destinations are clear of the boundary an aircraft bounces off', async ({ page }) => {
            const ok = await page.evaluate(() => DESTINATIONS.every((d) => (
                d.x > EDGE_MARGIN + LANDING_RADIUS && d.x < CANVAS_W - EDGE_MARGIN - LANDING_RADIUS
                && d.y > EDGE_MARGIN + LANDING_RADIUS && d.y < CANVAS_H - EDGE_MARGIN - LANDING_RADIUS
            )));
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a shift
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a shift opens with one aircraft already inbound', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => aircraft.length)).toBe(1);
            await expect(page.locator('#traffic')).toHaveText('1');
        });

        test('starting resets the score', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 9; startGame(); });
            expect(await page.evaluate(() => score)).toBe(0);
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Aircraft
    // -----------------------------------------------------------------------
    test.describe('aircraft', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('a spawned aircraft joins the traffic list with a unique id', async ({ page }) => {
            const ids = await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                const b = spawnAircraft({ type: 'heli', x: 400, y: 100, heading: 0 });
                return { count: aircraft.length, same: a.id === b.id };
            });
            expect(ids.count).toBe(2);
            expect(ids.same).toBe(false);
        });

        test('jets fly faster than helicopters', async ({ page }) => {
            const speeds = await page.evaluate(() => ({
                jet: spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 }).speed,
                heli: spawnAircraft({ type: 'heli', x: 400, y: 100, heading: 0 }).speed,
                jetConst: JET_SPEED,
                heliConst: HELI_SPEED,
            }));
            expect(speeds.jet).toBe(speeds.jetConst);
            expect(speeds.heli).toBe(speeds.heliConst);
            expect(speeds.jet).toBeGreaterThan(speeds.heli);
        });

        test('aircraft in the air have distinct callsigns', async ({ page }) => {
            const res = await page.evaluate(() => {
                setSeed(6);
                for (let i = 0; i < 7; i++) spawnAircraft();
                const signs = aircraft.map((c) => c.callsign);
                return { count: signs.length, unique: new Set(signs).size };
            });
            expect(res.count).toBeGreaterThan(1);
            expect(res.unique).toBe(res.count);
        });

        test('a new aircraft has no flight path', async ({ page }) => {
            const len = await page.evaluate(() => (
                spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 }).path.length
            ));
            expect(len).toBe(0);
        });

        test('random arrivals appear inside the scope near an edge', async ({ page }) => {
            const ok = await page.evaluate(() => {
                setSeed(3);
                for (let i = 0; i < 40; i++) {
                    aircraft.length = 0;
                    const c = spawnAircraft();
                    const inside = c.x >= 0 && c.x <= CANVAS_W && c.y >= 0 && c.y <= CANVAS_H;
                    const nearEdge = Math.min(c.x, CANVAS_W - c.x, c.y, CANVAS_H - c.y) <= 40;
                    if (!inside || !nearEdge) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('random arrivals head into the scope, not out of it', async ({ page }) => {
            const ok = await page.evaluate(() => {
                setSeed(11);
                for (let i = 0; i < 40; i++) {
                    aircraft.length = 0;
                    const c = spawnAircraft();
                    const toCentre = Math.atan2(CANVAS_H / 2 - c.y, CANVAS_W / 2 - c.x);
                    let diff = Math.abs(((c.heading - toCentre + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
                    if (diff > Math.PI / 2) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('random arrivals are one of the two known types', async ({ page }) => {
            const types = await page.evaluate(() => {
                setSeed(5);
                const seen = new Set();
                for (let i = 0; i < 60; i++) { aircraft.length = 0; seen.add(spawnAircraft().type); }
                return [...seen].sort();
            });
            expect(types).toEqual(['heli', 'jet']);
        });

        test('a seeded run reproduces the same arrivals', async ({ page }) => {
            const runs = await page.evaluate(() => {
                const sample = () => {
                    setSeed(99);
                    const out = [];
                    for (let i = 0; i < 6; i++) {
                        aircraft.length = 0;
                        const c = spawnAircraft();
                        out.push([c.type, Math.round(c.x), Math.round(c.y), c.heading.toFixed(4)].join(':'));
                    }
                    return out;
                };
                return [sample(), sample()];
            });
            expect(runs[0]).toEqual(runs[1]);
            expect(new Set(runs[0]).size).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('an aircraft with no path flies straight ahead', async ({ page }) => {
            const after = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 240, heading: 0 });
                for (let i = 0; i < 10; i++) step(0.1);
                return { x: c.x, y: c.y };
            });
            expect(after.x).toBeCloseTo(200 + 62, 1);
            expect(after.y).toBeCloseTo(240, 3);
        });

        test('distance covered matches speed multiplied by time', async ({ page }) => {
            const d = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'heli', x: 300, y: 100, heading: Math.PI / 2 });
                step(2);
                return c.y - 100;
            });
            expect(d).toBeCloseTo(80, 3);
        });

        test('an aircraft turns onto its path and flies to the waypoint', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                setPath(c, [{ x: 100, y: 300 }]);
                step(1);
                return { x: c.x, y: c.y, heading: c.heading, left: c.path.length };
            });
            expect(res.x).toBeCloseTo(100, 3);
            expect(res.y).toBeCloseTo(162, 1);
            expect(res.heading).toBeCloseTo(Math.PI / 2, 3);
            expect(res.left).toBe(1);
        });

        test('a waypoint is consumed once it is reached', async ({ page }) => {
            const left = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                setPath(c, [{ x: 140, y: 100 }, { x: 240, y: 100 }]);
                step(1);
                return c.path.length;
            });
            expect(left).toBe(1);
        });

        test('one frame can cross several closely spaced waypoints', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                setPath(c, [
                    { x: 110, y: 100 }, { x: 120, y: 100 }, { x: 130, y: 100 },
                    { x: 140, y: 100 }, { x: 400, y: 100 },
                ]);
                step(1);
                return { left: c.path.length, x: c.x };
            });
            expect(res.left).toBe(1);
            expect(res.x).toBeCloseTo(162, 1);
        });

        test('an aircraft that finishes its path keeps flying on the last heading', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: Math.PI });
                setPath(c, [{ x: 100, y: 140 }]);
                for (let i = 0; i < 20; i++) step(0.1);
                return { x: c.x, y: c.y, left: c.path.length };
            });
            expect(res.left).toBe(0);
            expect(res.x).toBeCloseTo(100, 1);
            expect(res.y).toBeCloseTo(100 + 62 * 2, 1);
        });

        test('aircraft reflect off the scope boundary and stay inside', async ({ page }) => {
            const inside = await page.evaluate(() => {
                setSeed(2);
                for (const h of [0, Math.PI, Math.PI / 2, -Math.PI / 2, 0.7, 2.4]) {
                    aircraft.length = 0;
                    const c = spawnAircraft({ type: 'jet', x: 360, y: 240, heading: h });
                    for (let i = 0; i < 600; i++) {
                        step(0.05);
                        if (c.x < 0 || c.x > CANVAS_W || c.y < 0 || c.y > CANVAS_H) return false;
                    }
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('reflecting off a wall reverses the crossing component only', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: CANVAS_W - EDGE_MARGIN - 5, y: 240, heading: 0 });
                step(1);
                return { x: c.x, heading: c.heading };
            });
            expect(res.x).toBeLessThan(720);
            expect(Math.abs(Math.cos(res.heading))).toBeCloseTo(1, 3);
            expect(Math.cos(res.heading)).toBeLessThan(0);
        });

        test('paths drawn outside the scope are clamped inside it', async ({ page }) => {
            const pts = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                setPath(c, [{ x: -50, y: -80 }, { x: 5000, y: 9000 }]);
                return c.path.map((p) => [p.x, p.y]);
            });
            for (const [x, y] of pts) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(720);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(y).toBeLessThanOrEqual(480);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Drawing flight paths
    // -----------------------------------------------------------------------
    test.describe('drawing paths', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('pressing on an aircraft starts a drawing', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(202, 203);
                return { drawing: drawing !== null, id: drawing && drawing.id, craft: c.id };
            });
            expect(res.drawing).toBe(true);
            expect(res.id).toBe(res.craft);
        });

        test('pressing empty sky starts nothing', async ({ page }) => {
            const started = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(600, 400);
                return drawing !== null;
            });
            expect(started).toBe(false);
        });

        test('pressing just outside the grab radius starts nothing', async ({ page }) => {
            const started = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(200 + GRAB_RADIUS + 4, 200);
                return drawing !== null;
            });
            expect(started).toBe(false);
        });

        test('dragging collects waypoints that are far enough apart', async ({ page }) => {
            const n = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(200, 200);
                for (let x = 210; x <= 400; x += 10) dragDraw(x, 200);
                return drawing.points.length;
            });
            expect(n).toBe(21);
        });

        test('samples closer than the minimum spacing are ignored', async ({ page }) => {
            const n = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(200, 200);
                for (let i = 0; i < 20; i++) dragDraw(200 + i * 0.5, 200);
                return drawing.points.length;
            });
            expect(n).toBe(2);
        });

        test('releasing commits the path to the aircraft', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(200, 200);
                dragDraw(260, 200);
                dragDraw(320, 260);
                endDraw();
                return { drawing, len: c.path.length, last: c.path[c.path.length - 1] };
            });
            expect(res.drawing).toBe(null);
            expect(res.len).toBeGreaterThanOrEqual(2);
            expect(res.last).toEqual({ x: 320, y: 260 });
        });

        test('a new path replaces the old one', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                setPath(c, [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }]);
                beginDraw(200, 200);
                dragDraw(300, 200);
                endDraw();
                return c.path.map((p) => p.x);
            });
            expect(res).not.toContain(10);
            expect(res[res.length - 1]).toBe(300);
        });

        test('a click without a drag clears the flight path', async ({ page }) => {
            const len = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                setPath(c, [{ x: 300, y: 300 }]);
                beginDraw(200, 200);
                endDraw();
                return c.path.length;
            });
            expect(len).toBe(0);
        });

        test('a drawing for an aircraft that lands mid-drag is dropped safely', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                beginDraw(200, 200);
                dragDraw(300, 200);
                aircraft.length = 0;
                endDraw();
                return { drawing, count: aircraft.length };
            });
            expect(res.drawing).toBe(null);
            expect(res.count).toBe(0);
        });

        test('dragging with the mouse on the canvas routes an aircraft', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.evaluate(() => { spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 }); });
            await page.mouse.move(box.x + 200, box.y + 200);
            await page.mouse.down();
            for (let x = 210; x <= 400; x += 20) await page.mouse.move(box.x + x, box.y + 300);
            await page.mouse.up();
            const res = await page.evaluate(() => ({
                len: aircraft[0].path.length,
                drawing,
            }));
            expect(res.len).toBeGreaterThan(1);
            expect(res.drawing).toBe(null);
        });

        test('drawing is ignored while the game is not running', async ({ page }) => {
            const started = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                state = 'over';
                beginDraw(200, 200);
                return drawing !== null;
            });
            expect(started).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Landing
    // -----------------------------------------------------------------------
    test.describe('landing', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('a jet that reaches the runway lands and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = destinationFor('jet');
                const c = spawnAircraft({ type: 'jet', x: d.x - 40, y: d.y, heading: 0 });
                setPath(c, [{ x: d.x, y: d.y }]);
                for (let i = 0; i < 20; i++) step(0.1);
                return { score, traffic: aircraft.length };
            });
            expect(res.score).toBe(1);
            expect(res.traffic).toBe(0);
            await expect(page.locator('#score')).toHaveText('1');
            await expect(page.locator('#traffic')).toHaveText('0');
        });

        test('a helicopter that reaches the helipad lands and scores', async ({ page }) => {
            const score = await page.evaluate(() => {
                const d = destinationFor('heli');
                const c = spawnAircraft({ type: 'heli', x: d.x, y: d.y - 30, heading: Math.PI / 2 });
                setPath(c, [{ x: d.x, y: d.y }]);
                for (let i = 0; i < 20; i++) step(0.1);
                return score;
            });
            expect(score).toBe(1);
        });

        test('a helicopter over the runway does not land', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = destinationFor('jet');
                const c = spawnAircraft({ type: 'heli', x: d.x, y: d.y, heading: 0 });
                step(0.016);
                return { score, traffic: aircraft.length, alive: aircraft.includes(c) };
            });
            expect(res.score).toBe(0);
            expect(res.traffic).toBe(1);
            expect(res.alive).toBe(true);
        });

        test('an aircraft just outside the landing radius stays airborne', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = destinationFor('jet');
                const c = spawnAircraft({ type: 'jet', x: d.x, y: d.y - LANDING_RADIUS - 2, heading: -Math.PI / 2 });
                c.speed = 0;
                step(0.016);
                return { score, traffic: aircraft.length };
            });
            expect(res.score).toBe(0);
            expect(res.traffic).toBe(1);
        });

        test('a landing leaves a brief marker on the pad', async ({ page }) => {
            const res = await page.evaluate(() => {
                const d = destinationFor('jet');
                spawnAircraft({ type: 'jet', x: d.x, y: d.y, heading: 0 });
                step(0.016);
                return { count: flashes.length, at: flashes[0] && { x: flashes[0].x, y: flashes[0].y } };
            });
            expect(res.count).toBe(1);
            expect(res.at).toEqual(await page.evaluate(() => ({
                x: destinationFor('jet').x, y: destinationFor('jet').y,
            })));
        });

        test('landing markers fade away', async ({ page }) => {
            const left = await page.evaluate(() => {
                const d = destinationFor('heli');
                spawnAircraft({ type: 'heli', x: d.x, y: d.y, heading: 0 });
                step(0.016);
                for (let i = 0; i < 60; i++) step(0.05);
                return flashes.length;
            });
            expect(left).toBe(0);
        });

        test('a fresh shift starts with no landing markers', async ({ page }) => {
            const left = await page.evaluate(() => {
                const d = destinationFor('jet');
                spawnAircraft({ type: 'jet', x: d.x, y: d.y, heading: 0 });
                step(0.016);
                startGame();
                return flashes.length;
            });
            expect(left).toBe(0);
        });

        test('landings raise the best score', async ({ page }) => {
            await page.evaluate(() => {
                const d = destinationFor('jet');
                for (let i = 0; i < 3; i++) {
                    const c = spawnAircraft({ type: 'jet', x: d.x, y: d.y, heading: 0 });
                    step(0.016);
                }
            });
            await expect(page.locator('#score')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('3');
            const stored = await page.evaluate(() => window.localStorage.getItem('air-traffic-control-best'));
            expect(stored).toBe('3');
        });

        test('a lower score does not overwrite the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('air-traffic-control-best', '25'));
            await page.reload();
            await startClean(page);
            await page.evaluate(() => {
                const d = destinationFor('jet');
                spawnAircraft({ type: 'jet', x: d.x, y: d.y, heading: 0 });
                step(0.016);
            });
            await expect(page.locator('#best')).toHaveText('25');
        });
    });

    // -----------------------------------------------------------------------
    // Separation and crashes
    // -----------------------------------------------------------------------
    test.describe('separation', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('aircraft that touch collide and end the shift', async ({ page }) => {
            const res = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                spawnAircraft({ type: 'heli', x: 300 + SEPARATION_RADIUS - 4, y: 240, heading: Math.PI });
                step(0.016);
                return { state, crash: crashAt };
            });
            expect(res.state).toBe('over');
            expect(res.crash).not.toBe(null);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the overlay explains the crash', async ({ page }) => {
            await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                spawnAircraft({ type: 'jet', x: 305, y: 240, heading: 0 });
                step(0.016);
            });
            await expect(page.locator('#overlay-title')).toContainText(/crash|collision|lost/i);
        });

        test('aircraft closer than the alert radius raise a warning but keep flying', async ({ page }) => {
            const res = await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                a.speed = 0;
                const b = spawnAircraft({ type: 'heli', x: 300 + ALERT_RADIUS - 6, y: 240, heading: 0 });
                b.speed = 0;
                step(0.016);
                return { state, a: a.alert, b: b.alert };
            });
            expect(res.state).toBe('running');
            expect(res.a).toBe(true);
            expect(res.b).toBe(true);
        });

        test('well separated aircraft raise no warning', async ({ page }) => {
            const res = await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                a.speed = 0;
                const b = spawnAircraft({ type: 'jet', x: 600, y: 400, heading: 0 });
                b.speed = 0;
                step(0.016);
                return { state, a: a.alert, b: b.alert };
            });
            expect(res.state).toBe('running');
            expect(res.a).toBe(false);
            expect(res.b).toBe(false);
        });

        test('a warning clears once the aircraft separate again', async ({ page }) => {
            const res = await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 300, y: 240, heading: Math.PI });
                const b = spawnAircraft({ type: 'jet', x: 300 + ALERT_RADIUS - 6, y: 240, heading: 0 });
                step(0.016);
                const flagged = a.alert && b.alert;
                for (let i = 0; i < 60; i++) step(0.05);
                return { flagged, after: a.alert || b.alert };
            });
            expect(res.flagged).toBe(true);
            expect(res.after).toBe(false);
        });

        test('the HUD shows a proximity warning', async ({ page }) => {
            await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                a.speed = 0;
                const b = spawnAircraft({ type: 'heli', x: 300 + ALERT_RADIUS - 6, y: 240, heading: 0 });
                b.speed = 0;
                step(0.016);
            });
            await expect(page.locator('#warning')).toHaveClass(/visible/);
        });

        test('an aircraft never collides with itself', async ({ page }) => {
            const s = await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                for (let i = 0; i < 10; i++) step(0.1);
                return state;
            });
            expect(s).toBe('running');
        });

        test('an aircraft that has landed cannot cause a crash', async ({ page }) => {
            const s = await page.evaluate(() => {
                const d = destinationFor('jet');
                spawnAircraft({ type: 'jet', x: d.x, y: d.y, heading: 0 });
                spawnAircraft({ type: 'heli', x: d.x + 2, y: d.y, heading: 0 });
                step(0.016);
                return state;
            });
            expect(s).toBe('running');
        });

        test('stepping after a crash changes nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                const a = spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                spawnAircraft({ type: 'jet', x: 305, y: 240, heading: 0 });
                step(0.016);
                const at = { x: a.x, y: a.y };
                for (let i = 0; i < 30; i++) step(0.05);
                return a.x === at.x && a.y === at.y;
            });
            expect(res).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Arrivals
    // -----------------------------------------------------------------------
    test.describe('arrivals', () => {
        test.beforeEach(async ({ page }) => startClean(page));

        test('traffic arrives as time passes', async ({ page }) => {
            const n = await page.evaluate(() => {
                setSeed(4);
                spawnTimer = 0.1;
                for (let i = 0; i < 400; i++) step(0.05);
                return aircraft.length;
            });
            expect(n).toBeGreaterThan(1);
        });

        test('no more than MAX_TRAFFIC aircraft are in the air', async ({ page }) => {
            const n = await page.evaluate(() => {
                setSeed(8);
                spawnTimer = 0;
                let peak = 0;
                for (let i = 0; i < 3000; i++) {
                    step(0.05);
                    peak = Math.max(peak, aircraft.length);
                    if (state !== 'running') { state = 'running'; aircraft.forEach((c) => { c.alert = false; }); }
                }
                return peak;
            });
            expect(n).toBeLessThanOrEqual(7);
        });

        test('arrivals speed up as the score climbs', async ({ page }) => {
            const res = await page.evaluate(() => {
                score = 0;
                const start = spawnInterval();
                score = 10;
                const later = spawnInterval();
                score = 500;
                return { start, later, floor: spawnInterval() };
            });
            expect(res.start).toBe(4.5);
            expect(res.later).toBeLessThan(res.start);
            expect(res.floor).toBe(1.8);
        });

        test('the HUD traffic count tracks the aircraft in the air', async ({ page }) => {
            await page.evaluate(() => {
                spawnAircraft({ type: 'jet', x: 100, y: 100, heading: 0 });
                spawnAircraft({ type: 'heli', x: 500, y: 400, heading: 0 });
                step(0.016);
            });
            await expect(page.locator('#traffic')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                aircraft.length = 0;
                const c = spawnAircraft({ type: 'jet', x: 200, y: 200, heading: 0 });
                togglePause();
                for (let i = 0; i < 30; i++) step(0.05);
                return c.x !== 200;
            });
            expect(moved).toBe(false);
        });

        test('P does nothing before the first shift starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Game over and restart
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                score = 4;
                spawnAircraft({ type: 'jet', x: 300, y: 240, heading: 0 });
                spawnAircraft({ type: 'jet', x: 305, y: 240, heading: 0 });
                step(0.016);
            });
        });

        test('the final score is shown on the overlay', async ({ page }) => {
            await expect(page.locator('#overlay-score')).toContainText('4');
        });

        test('the best score is saved on a crash', async ({ page }) => {
            expect(await page.evaluate(() => window.localStorage.getItem('air-traffic-control-best'))).toBe('4');
            await expect(page.locator('#best')).toHaveText('4');
        });

        test('Space starts a fresh shift', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ state, score, crash: crashAt, traffic: aircraft.length }));
            expect(res.state).toBe('running');
            expect(res.score).toBe(0);
            expect(res.crash).toBe(null);
            expect(res.traffic).toBe(1);
        });

        test('a restart clears any half-drawn path', async ({ page }) => {
            const d = await page.evaluate(() => { startGame(); return drawing; });
            expect(d).toBe(null);
        });

        test('the best score survives into the next shift', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#best')).toHaveText('4');
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the scope is drawn on the canvas', async ({ page }) => {
            const painted = await page.evaluate(() => {
                draw();
                const d = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('aircraft and their paths are drawn', async ({ page }) => {
            const changed = await page.evaluate(() => {
                startGame();
                aircraft.length = 0;
                draw();
                const ctx2 = canvas.getContext('2d');
                const before = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const c = spawnAircraft({ type: 'jet', x: 360, y: 240, heading: 0 });
                setPath(c, [{ x: 500, y: 300 }]);
                draw();
                const after = ctx2.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) return true;
                return false;
            });
            expect(changed).toBe(true);
        });

        test('the animation loop keeps running without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => state === 'running' || state === 'over')).toBe(true);
        });
    });
});
