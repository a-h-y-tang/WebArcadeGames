const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Take over the clock. The requestAnimationFrame loop keeps painting but stops
// stepping, so each spec owns the simulation, and random spawning is switched
// off so nothing wanders into the shot but what the spec puts there.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame(TERRAIN_SEED); // pin the river: a live game draws a fresh seed
        autoLoop = false;
        spawnEnabled = false;
        enemies.length = 0;
        depots.length = 0;
        bullets.length = 0;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so a held key is confirmed against the game state before stepping.
const hold = async (page, key) => {
    await page.keyboard.down(key);
    await page.waitForFunction((k) => heldKeys.has(k), key);
};

const release = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction((k) => !heldKeys.has(k), key);
};

// Drop an enemy into the river straight ahead of the jet, held still so the
// spec controls exactly when the two meet.
const spawnAhead = (page, kind, dy = 220) =>
    page.evaluate(([k, d]) => {
        const o = spawnEnemy(k, jet.x, jetWorldY() + d);
        o.vx = 0;
        return { x: o.x, y: o.y };
    }, [kind, dy]);

test.describe('River Raid', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is River Raid', async ({ page }) => {
            await expect(page).toHaveTitle('River Raid');
        });

        test('canvas is 480x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, section, lives and fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#section')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#fuel')).toHaveText('100');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('riverraid-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('nothing is in the air before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [
                enemies.length,
                depots.length,
                bullets.length,
            ]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await advance(page, 60);
            expect(await page.evaluate(() => scrollY)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the jet starts mid-river with a full tank', async ({ page }) => {
            await startQuiet(page);
            const s = await page.evaluate(() => {
                const b = riverBoundsAt(jetWorldY());
                return { x: jet.x, left: b.left, right: b.right, fuel, lives, score };
            });
            expect(s.x).toBeGreaterThan(s.left);
            expect(s.x).toBeLessThan(s.right);
            expect(s.fuel).toBe(100);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });

        test('terrain covers the whole screen at the start', async ({ page }) => {
            await startQuiet(page);
            const covered = await page.evaluate(
                () => rows.length * ROW_H >= CANVAS_H
            );
            expect(covered).toBe(true);
        });

        test('the river scrolls while running', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 60);
            // One simulated second of cruising covers exactly one second of river.
            const drift = await page.evaluate(() => Math.abs(scrollY - SPEED_NORMAL));
            expect(drift).toBeLessThan(0.5);
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('holding right banks the jet right', async ({ page }) => {
            const before = await page.evaluate(() => jet.x);
            await hold(page, 'ArrowRight');
            await advance(page, 20);
            expect(await page.evaluate(() => jet.x)).toBeGreaterThan(before);
            await release(page, 'ArrowRight');
        });

        test('holding left banks the jet left', async ({ page }) => {
            const before = await page.evaluate(() => jet.x);
            await hold(page, 'ArrowLeft');
            await advance(page, 20);
            expect(await page.evaluate(() => jet.x)).toBeLessThan(before);
            await release(page, 'ArrowLeft');
        });

        test('A and D also steer the jet', async ({ page }) => {
            const before = await page.evaluate(() => jet.x);
            await hold(page, 'd');
            await advance(page, 20);
            expect(await page.evaluate(() => jet.x)).toBeGreaterThan(before);
            await release(page, 'd');
        });

        test('the jet is clamped to the canvas', async ({ page }) => {
            const clamped = await page.evaluate(() => [
                clampJetX(-100),
                clampJetX(CANVAS_W + 100),
            ]);
            expect(clamped[0]).toBeGreaterThanOrEqual(0);
            expect(clamped[1]).toBeLessThanOrEqual(480);
        });

        test('throttle up scrolls the river faster', async ({ page }) => {
            await hold(page, 'ArrowUp');
            await advance(page, 60);
            const fast = await page.evaluate(() => scrollY);
            expect(fast).toBeGreaterThan(160);
            await release(page, 'ArrowUp');
        });

        test('throttle down scrolls the river slower', async ({ page }) => {
            await hold(page, 'ArrowDown');
            await advance(page, 60);
            const slow = await page.evaluate(() => scrollY);
            expect(slow).toBeLessThan(140);
            await release(page, 'ArrowDown');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space fires a shot', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => bullets.length === 1);
        });

        test('shots climb upstream ahead of the jet', async ({ page }) => {
            await page.evaluate(() => fire());
            const start = await page.evaluate(() => bullets[0].y - jetWorldY());
            await advance(page, 10);
            const later = await page.evaluate(() => bullets[0].y - jetWorldY());
            expect(later).toBeGreaterThan(start);
        });

        test('the gun has a cooldown', async ({ page }) => {
            const fired = await page.evaluate(() => {
                fire();
                fire();
                return bullets.length;
            });
            expect(fired).toBe(1);
        });

        test('the gun can fire again after the cooldown', async ({ page }) => {
            await page.evaluate(() => fire());
            await advance(page, 30);
            await page.evaluate(() => fire());
            expect(await page.evaluate(() => bullets.length)).toBe(2);
        });

        test('shots are dropped once they leave the top of the screen', async ({ page }) => {
            await page.evaluate(() => fire());
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Targets
    // -----------------------------------------------------------------------
    test.describe('targets', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        const TARGETS = [
            ['ship', 30],
            ['heli', 60],
            ['jet', 100],
            ['depot', 80],
        ];

        for (const [kind, points] of TARGETS) {
            test(`shooting a ${kind} scores ${points}`, async ({ page }) => {
                await spawnAhead(page, kind);
                await page.evaluate(() => fire());
                await advance(page, 30);
                const s = await page.evaluate(() => ({
                    score,
                    targets: enemies.length + depots.length,
                }));
                expect(s.score).toBe(points);
                expect(s.targets).toBe(0);
            });
        }

        test('enemies patrol across the river without leaving it', async ({ page }) => {
            const startX = await page.evaluate(() => {
                const e = spawnEnemy('heli', jet.x, jetWorldY() + 500);
                e.vx = 220;
                return e.x;
            });
            await advance(page, 60);
            const e = await page.evaluate(() => {
                const o = enemies[0];
                const b = riverBoundsAt(o.y);
                return { x: o.x, w: o.w, left: b.left, right: b.right };
            });
            expect(e.x).not.toBe(startX);
            expect(e.x - e.w / 2).toBeGreaterThanOrEqual(e.left - 0.5);
            expect(e.x + e.w / 2).toBeLessThanOrEqual(e.right + 0.5);
        });

        test('targets left behind are cleaned up', async ({ page }) => {
            await page.evaluate(() => spawnEnemy('ship', jet.x, jetWorldY() - 200));
            await advance(page, 120);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('flying into an enemy costs a life', async ({ page }) => {
            await spawnAhead(page, 'ship', 120);
            await advance(page, 90);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 120);
            const s = await page.evaluate(() => ({ lives, state }));
            expect(s.lives).toBe(2);
            expect(s.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('fuel burns while flying', async ({ page }) => {
            await advance(page, 120);
            const left = await page.evaluate(() => fuel);
            expect(left).toBeLessThan(100);
            expect(left).toBeGreaterThan(80);
        });

        test('the HUD tracks the tank', async ({ page }) => {
            await advance(page, 120);
            await expect(page.locator('#fuel')).not.toHaveText('100');
        });

        test('flying over a depot refuels the jet', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 40;
                const d = spawnEnemy('depot', jet.x, jetWorldY() + 120);
                d.vx = 0;
            });
            await advance(page, 90);
            expect(await page.evaluate(() => fuel)).toBeGreaterThan(40);
        });

        test('the tank never overfills', async ({ page }) => {
            await page.evaluate(() => {
                const d = spawnEnemy('depot', jet.x, jetWorldY() + 120);
                d.vx = 0;
            });
            await advance(page, 90);
            expect(await page.evaluate(() => fuel)).toBeLessThanOrEqual(100);
        });

        test('an empty tank costs a life and the jet refuels on respawn', async ({ page }) => {
            await page.evaluate(() => {
                fuel = 0.05;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 120);
            // The tank comes back full; the flight since the respawn has burned
            // a little of it back off.
            const s = await page.evaluate(() => ({ lives, fuel }));
            expect(s.lives).toBe(2);
            expect(s.fuel).toBeGreaterThan(90);
        });
    });

    // -----------------------------------------------------------------------
    // Bridges and sections
    // -----------------------------------------------------------------------
    test.describe('bridges', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a bridge closes each section of the river', async ({ page }) => {
            await page.evaluate(() => {
                scrollY = SECTION_ROWS * ROW_H - 500;
            });
            await advance(page, 1);
            const b = await page.evaluate(() => ({
                count: bridges.length,
                onSectionLine: bridges.length > 0 && bridges[0].y === SECTION_ROWS * ROW_H,
            }));
            expect(b.count).toBe(1);
            expect(b.onSectionLine).toBe(true);
        });

        test('shooting the bridge scores 500 and opens the next section', async ({ page }) => {
            await page.evaluate(() => {
                scrollY = SECTION_ROWS * ROW_H - 480;
            });
            await advance(page, 1);
            await page.evaluate(() => {
                jet.x = bridges[0].x + bridges[0].w / 2;
                fire();
            });
            await advance(page, 45);
            const s = await page.evaluate(() => ({ score, section, alive: bridges.length }));
            expect(s.score).toBe(500);
            expect(s.section).toBe(2);
            expect(s.alive).toBe(0);
        });

        test('flying into a standing bridge costs a life', async ({ page }) => {
            await page.evaluate(() => {
                scrollY = SECTION_ROWS * ROW_H - 260;
            });
            await advance(page, 90);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Crashing, lives and game over
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clipping the bank costs a life', async ({ page }) => {
            await page.evaluate(() => {
                jet.x = riverBoundsAt(jetWorldY()).left;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('dying');
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the jet respawns mid-river', async ({ page }) => {
            await page.evaluate(() => {
                jet.x = riverBoundsAt(jetWorldY()).right;
            });
            await advance(page, 130);
            const s = await page.evaluate(() => {
                const b = riverBoundsAt(jetWorldY());
                return { x: jet.x, left: b.left, right: b.right, state };
            });
            expect(s.state).toBe('running');
            expect(s.x).toBeGreaterThan(s.left);
            expect(s.x).toBeLessThan(s.right);
        });

        test('an island in the river is solid ground', async ({ page }) => {
            const crashed = await page.evaluate(() => {
                const wy = jetWorldY();
                const b = riverBoundsAt(wy);
                const island = { left: jet.x - 30, right: jet.x + 30 };
                rows[rowIndexAt(wy)].island = island;
                rows[rowIndexAt(wy) + 1].island = island;
                return hitsLand(jet.x, wy) && !hitsLand(b.left + 4 + JET_HW, wy);
            });
            expect(crashed).toBe(true);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                jet.x = riverBoundsAt(jetWorldY()).left;
            });
            await advance(page, 130);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is kept', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 2500;
                jet.x = riverBoundsAt(jetWorldY()).left;
            });
            await advance(page, 130);
            await expect(page.locator('#best')).toHaveText('2500');
            expect(await page.evaluate(() => localStorage.getItem('riverraid-best'))).toBe('2500');
        });

        test('a finished game can be restarted', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                score = 900;
                jet.x = riverBoundsAt(jetWorldY()).left;
            });
            await advance(page, 130);
            await page.evaluate(() => startGame());
            const s = await page.evaluate(() => ({ state, score, lives, section, scrollY }));
            expect(s).toEqual({ state: 'running', score: 0, lives: 3, section: 1, scrollY: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes the flight', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            const frozen = await page.evaluate(() => scrollY);
            await advance(page, 60);
            expect(await page.evaluate(() => scrollY)).toBe(frozen);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
            await advance(page, 60);
            expect(await page.evaluate(() => scrollY)).toBeGreaterThan(frozen);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain
    // -----------------------------------------------------------------------
    test.describe('terrain', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the river stays inside the canvas and keeps a flyable width', async ({ page }) => {
            await page.evaluate(() => ensureRows(400));
            const ok = await page.evaluate(() =>
                rows.every(
                    (r) =>
                        r.left >= 0 &&
                        r.right <= CANVAS_W &&
                        r.right - r.left >= MIN_RIVER &&
                        r.right - r.left <= MAX_RIVER
                )
            );
            expect(ok).toBe(true);
        });

        test('the banks meander instead of running straight', async ({ page }) => {
            await page.evaluate(() => ensureRows(400));
            const widths = await page.evaluate(() =>
                rows.map((r) => Math.round(r.right - r.left))
            );
            expect(new Set(widths).size).toBeGreaterThan(5);
        });

        test('the same seed always carves the same river', async ({ page }) => {
            const first = await page.evaluate(() => {
                ensureRows(120);
                return rows.slice(0, 120).map((r) => [r.left, r.right]);
            });
            await page.reload();
            await startQuiet(page);
            const second = await page.evaluate(() => {
                ensureRows(120);
                return rows.slice(0, 120).map((r) => [r.left, r.right]);
            });
            expect(second).toEqual(first);
        });

        test('each new flight carves a different river', async ({ page }) => {
            const shapes = await page.evaluate(() => {
                const sample = () => {
                    ensureRows(120);
                    return rows
                        .slice(0, 120)
                        .map((r) => `${Math.round(r.left)}:${Math.round(r.right)}`)
                        .join(',');
                };
                const out = [];
                for (let i = 0; i < 4; i++) {
                    startGame();
                    autoLoop = false;
                    spawnEnabled = false;
                    out.push(sample());
                }
                return out;
            });
            expect(new Set(shapes).size).toBeGreaterThan(1);
        });

        test('every island leaves a lane the jet actually fits through', async ({ page }) => {
            await page.evaluate(() => ensureRows(1200));
            const narrowest = await page.evaluate(() => {
                let min = Infinity;
                for (const r of rows) {
                    if (!r.island) continue;
                    min = Math.min(min, r.island.left - r.left, r.right - r.island.right);
                }
                return min;
            });
            // A 22px jet needs clearance, not a slot: squeezing past must be
            // possible without frame-perfect flying.
            expect(narrowest).toBeGreaterThan(2 * 11 + 12);
        });

        test('the river never closes off the lane the jet is sent down', async ({ page }) => {
            const ok = await page.evaluate(() => {
                ensureRows(1200);
                for (let wy = 100; wy < 1200 * ROW_H - 400; wy += 40) {
                    const x = safeCenter(wy);
                    // The lane chosen at wy has to still be open a few seconds later,
                    // give or take the steering the player does on the way.
                    for (let ahead = wy; ahead <= wy + 240; ahead += ROW_H) {
                        if (hitsLand(x, ahead) && hitsLand(x - 30, ahead) && hitsLand(x + 30, ahead)) {
                            return { wy, ahead, x };
                        }
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('fuel depots never leave an unflyable gap', async ({ page }) => {
            const gap = await page.evaluate(() => {
                // Fly the river, standing in for a player who never shoots a depot.
                let last = 0;
                let worst = 0;
                const seen = new Set();
                for (let f = 0; f < 60 * 240; f++) {
                    jet.x = safeCenter(jetWorldY());
                    fuel = FUEL_MAX;
                    bridges.forEach((b) => (b.alive = false));
                    step(1 / 60);
                    for (const d of depots) {
                        if (seen.has(d)) continue;
                        seen.add(d);
                        worst = Math.max(worst, d.y - last);
                        last = d.y;
                    }
                }
                return { worst, tankRange: (FUEL_MAX / FUEL_BURN) * SPEED_NORMAL };
            });
            expect(gap.worst).toBeLessThan(gap.tankRange);
        });

        test('islands only appear where the river is wide enough', async ({ page }) => {
            await page.evaluate(() => ensureRows(800));
            const ok = await page.evaluate(() =>
                rows.every(
                    (r) =>
                        !r.island ||
                        (r.island.left > r.left + 20 && r.island.right < r.right - 20)
                )
            );
            expect(ok).toBe(true);
        });
    });
});
