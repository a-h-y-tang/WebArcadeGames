const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Every test that needs the plane in the air starts the run with a fixed seed so
// the procedurally generated canyon — and everything spawned in it — is exactly
// the same from one run to the next.
const SEED = 1234;

test.describe('Canyon Raider', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Canyon Raider', async ({ page }) => {
            await expect(page).toHaveTitle('Canyon Raider');
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

        test('HUD starts at zero score, three lives, section 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#section')).toHaveText('1');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does not scroll the canyon', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = scroll;
                for (let i = 0; i < 30; i++) step(0.016);
                return scroll !== before;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('canyon-raider-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the run and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the tank starts full', async ({ page }) => {
            const full = await page.evaluate((seed) => {
                startGame(seed);
                return fuel === MAX_FUEL;
            }, SEED);
            expect(full).toBe(true);
        });

        test('the plane starts inside the river', async ({ page }) => {
            const ok = await page.evaluate((seed) => {
                startGame(seed);
                const b = riverBoundsAtWorld(planeWorldY());
                return plane.x > b.left && plane.x < b.right;
            }, SEED);
            expect(ok).toBe(true);
        });

        test('the same seed generates the same canyon', async ({ page }) => {
            const [a, b] = await page.evaluate((seed) => {
                const sample = () => {
                    startGame(seed);
                    for (let i = 0; i < 400; i++) step(0.016);
                    return rows.slice(0, 60).map((r) => `${Math.round(r.left)}:${Math.round(r.right)}`).join(',');
                };
                return [sample(), sample()];
            }, SEED);
            expect(a).toBe(b);
            expect(a.length).toBeGreaterThan(0);
        });

        test('different seeds generate different canyons', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                const sample = (seed) => {
                    startGame(seed);
                    return rows.slice(0, 60).map((r) => `${Math.round(r.left)}:${Math.round(r.right)}`).join(',');
                };
                return [sample(11), sample(99)];
            });
            expect(a).not.toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // The canyon itself
    // -----------------------------------------------------------------------
    test.describe('canyon', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((seed) => startGame(seed), SEED);
        });

        test('every generated row is a valid river inside the canvas', async ({ page }) => {
            const bad = await page.evaluate(() => {
                for (let i = 0; i < 900; i++) step(0.016);
                return rows.filter((r) => (
                    r.left < 0 || r.right > CANVAS_W ||
                    r.right - r.left < MIN_RIVER_W || r.right - r.left > MAX_RIVER_W
                )).length;
            });
            expect(bad).toBe(0);
        });

        test('the canyon scrolls at the current speed', async ({ page }) => {
            const delta = await page.evaluate(() => {
                const before = scroll;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return scroll - before;
            });
            expect(delta).toBeGreaterThan(0);
        });

        test('rows are generated ahead of the plane as it flies', async ({ page }) => {
            const grew = await page.evaluate(() => {
                const before = rows.length;
                for (let i = 0; i < 600; i++) step(0.016);
                return rows.length > before;
            });
            expect(grew).toBe(true);
        });

        test('distance flown is tracked in the HUD', async ({ page }) => {
            await page.evaluate(() => { for (let i = 0; i < 300; i++) step(0.016); });
            const shown = await page.locator('#distance').textContent();
            expect(Number(shown)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((seed) => startGame(seed), SEED);
        });

        test('left and right steer the plane', async ({ page }) => {
            const { left, right } = await page.evaluate(() => {
                const start = plane.x;
                movePlane(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                const left = plane.x;
                movePlane(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { left: left < start, right: plane.x > left };
            });
            expect(left).toBe(true);
            expect(right).toBe(true);
        });

        test('arrow keys steer the plane', async ({ page }) => {
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => {
                window.__x0 = plane.x;
                for (let i = 0; i < 15; i++) step(0.016);
            });
            await page.keyboard.up('ArrowLeft');
            const moved = await page.evaluate(() => plane.x < window.__x0);
            expect(moved).toBe(true);
        });

        test('the plane cannot leave the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                movePlane(-1);
                for (let i = 0; i < 600; i++) { plane.crashed = false; step(0.016); }
                return plane.x >= PLANE_W / 2;
            });
            expect(inside).toBe(true);
        });

        test('throttle up and down clamp to the speed limits', async ({ page }) => {
            // Fly a clear canyon dead centre so the run is about the throttle
            // and nothing else.
            const { fast, slow } = await page.evaluate(() => {
                const cruise = (frames) => {
                    for (let i = 0; i < frames; i++) {
                        entities.length = 0;
                        const b = riverBoundsAtWorld(planeWorldY());
                        plane.x = (b.left + b.right) / 2;
                        step(0.016);
                    }
                };
                setThrottle(1);
                cruise(300);
                const fast = scrollSpeed;
                setThrottle(-1);
                cruise(600);
                return { fast, slow: scrollSpeed };
            });
            expect(fast).toBeCloseTo(await page.evaluate(() => MAX_SPEED), 1);
            expect(slow).toBeCloseTo(await page.evaluate(() => MIN_SPEED), 1);
        });

        test('firing adds a bullet, up to the on-screen limit', async ({ page }) => {
            const counts = await page.evaluate(() => {
                fire();
                const one = bullets.length;
                for (let i = 0; i < 20; i++) fire();
                return { one, many: bullets.length };
            });
            expect(counts.one).toBe(1);
            expect(counts.many).toBeLessThanOrEqual(await page.evaluate(() => MAX_BULLETS));
        });

        test('bullets fly up the screen and expire off the top', async ({ page }) => {
            const gone = await page.evaluate(() => {
                fire();
                const y0 = screenY(bullets[0].worldY);
                for (let i = 0; i < 20; i++) step(0.016);
                const rose = bullets.length === 0 || screenY(bullets[0].worldY) < y0;
                for (let i = 0; i < 300; i++) step(0.016);
                return rose && bullets.length === 0;
            });
            expect(gone).toBe(true);
        });

        test('P pauses and resumes, and a paused game does not scroll', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            const frozen = await page.evaluate(() => {
                const before = scroll;
                for (let i = 0; i < 30; i++) step(0.016);
                return scroll === before;
            });
            expect(frozen).toBe(true);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((seed) => startGame(seed), SEED);
        });

        test('fuel burns down while flying', async ({ page }) => {
            const drained = await page.evaluate(() => {
                const before = fuel;
                for (let i = 0; i < 120; i++) step(0.016);
                return fuel < before;
            });
            expect(drained).toBe(true);
        });

        test('flying over a depot refuels the plane', async ({ page }) => {
            const gained = await page.evaluate(() => {
                fuel = MAX_FUEL * 0.4;
                const before = fuel;
                spawnEntityAt('fuel', plane.x, planeWorldY());
                for (let i = 0; i < 10; i++) step(0.016);
                return fuel > before;
            });
            expect(gained).toBe(true);
        });

        test('refuelling never overfills the tank', async ({ page }) => {
            const capped = await page.evaluate(() => {
                fuel = MAX_FUEL;
                spawnEntityAt('fuel', plane.x, planeWorldY());
                for (let i = 0; i < 10; i++) step(0.016);
                return fuel <= MAX_FUEL;
            });
            expect(capped).toBe(true);
        });

        test('the fuel gauge shrinks as the tank empties', async ({ page }) => {
            const width = async () => page.locator('#fuel-bar').evaluate((el) => el.style.width);
            const full = await width();
            await page.evaluate(() => { fuel = MAX_FUEL * 0.25; updateHud(); });
            const low = await width();
            expect(parseFloat(full)).toBeGreaterThan(parseFloat(low));
        });

        test('running dry costs a life', async ({ page }) => {
            const after = await page.evaluate(() => {
                fuel = 0.01;
                for (let i = 0; i < 20; i++) step(0.016);
                return { lives, state };
            });
            expect(after.lives).toBe(2);
            expect(after.state).toBe('crashed');
        });
    });

    // -----------------------------------------------------------------------
    // Shooting things
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((seed) => startGame(seed), SEED);
        });

        test('a bullet destroys a ship and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                const ship = spawnEntityAt('ship', plane.x, planeWorldY() + 160);
                ship.vx = 0;
                const before = score;
                fire();
                for (let i = 0; i < 60; i++) step(0.008);
                return { alive: ship.alive, gain: score - before };
            });
            expect(res.alive).toBe(false);
            expect(res.gain).toBe(await page.evaluate(() => SHIP_SCORE));
        });

        test('a bullet destroys a helicopter and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                const chopper = spawnEntityAt('chopper', plane.x, planeWorldY() + 160);
                chopper.vx = 0;
                const before = score;
                fire();
                for (let i = 0; i < 60; i++) step(0.008);
                return { alive: chopper.alive, gain: score - before };
            });
            expect(res.alive).toBe(false);
            expect(res.gain).toBe(await page.evaluate(() => CHOPPER_SCORE));
        });

        test('a bullet destroys a fuel depot and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                const depot = spawnEntityAt('fuel', plane.x, planeWorldY() + 160);
                const before = score;
                fire();
                for (let i = 0; i < 60; i++) step(0.008);
                return { alive: depot.alive, gain: score - before };
            });
            expect(res.alive).toBe(false);
            expect(res.gain).toBe(await page.evaluate(() => FUEL_SCORE));
        });

        test('one bullet only destroys one target', async ({ page }) => {
            const kills = await page.evaluate(() => {
                entities.length = 0;
                const a = spawnEntityAt('ship', plane.x, planeWorldY() + 150);
                const b = spawnEntityAt('ship', plane.x, planeWorldY() + 160);
                a.vx = 0; b.vx = 0;
                fire();
                for (let i = 0; i < 40; i++) step(0.008);
                return [a.alive, b.alive].filter((alive) => alive === false).length;
            });
            expect(kills).toBe(1);
        });

        test('ships patrol between the banks without leaving the river', async ({ page }) => {
            const escaped = await page.evaluate(() => {
                entities.length = 0;
                const ship = spawnEntityAt('ship', plane.x, planeWorldY() + 320);
                ship.vx = Math.abs(ship.vx) || 60;
                let bad = 0;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (!ship.alive) break;
                    const b = riverBoundsAtWorld(ship.worldY);
                    if (ship.x - ship.w / 2 < b.left - 1 || ship.x + ship.w / 2 > b.right + 1) bad++;
                }
                return bad;
            });
            expect(escaped).toBe(0);
        });

        test('destroying a bridge scores and opens the next section', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                const bridge = spawnEntityAt('bridge', CANVAS_W / 2, planeWorldY() + 200);
                const beforeScore = score;
                const beforeSection = section;
                plane.x = bridge.x;
                fire();
                for (let i = 0; i < 80; i++) step(0.008);
                return { alive: bridge.alive, gain: score - beforeScore, section: section - beforeSection };
            });
            expect(res.alive).toBe(false);
            expect(res.gain).toBe(await page.evaluate(() => BRIDGE_SCORE));
            expect(res.section).toBe(1);
        });

        test('the score shows in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                entities.length = 0;
                const ship = spawnEntityAt('ship', plane.x, planeWorldY() + 160);
                ship.vx = 0;
                fire();
                for (let i = 0; i < 60; i++) step(0.008);
            });
            const shown = Number(await page.locator('#score').textContent());
            expect(shown).toBe(await page.evaluate(() => score));
        });

        test('the section counter shows in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                entities.length = 0;
                const bridge = spawnEntityAt('bridge', CANVAS_W / 2, planeWorldY() + 200);
                plane.x = bridge.x;
                fire();
                for (let i = 0; i < 80; i++) step(0.008);
            });
            await expect(page.locator('#section')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Crashing
    // -----------------------------------------------------------------------
    test.describe('crashes', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate((seed) => startGame(seed), SEED);
        });

        test('flying into a canyon wall costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                plane.x = 4;
                step(0.016);
                return { lives, state };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('crashed');
        });

        test('flying into a ship costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                const ship = spawnEntityAt('ship', plane.x, planeWorldY());
                ship.vx = 0;
                step(0.016);
                return { lives, state };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('crashed');
        });

        test('flying into a bridge costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                entities.length = 0;
                spawnEntityAt('bridge', CANVAS_W / 2, planeWorldY());
                step(0.016);
                return { lives, state };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('crashed');
        });

        test('the canyon stops scrolling during a crash', async ({ page }) => {
            const frozen = await page.evaluate(() => {
                plane.x = 4;
                step(0.016);
                const before = scroll;
                for (let i = 0; i < 10; i++) step(0.016);
                return scroll === before;
            });
            expect(frozen).toBe(true);
        });

        test('the plane respawns safely with a full tank', async ({ page }) => {
            const res = await page.evaluate(() => {
                fuel = MAX_FUEL * 0.3;
                plane.x = 4;
                step(0.016);
                for (let i = 0; i < 200; i++) step(0.016);
                const b = riverBoundsAtWorld(planeWorldY());
                // The tank is refilled on respawn, then burns normally again.
                return { state, refilled: fuel > MAX_FUEL * 0.8, inside: plane.x > b.left && plane.x < b.right };
            });
            expect(res.state).toBe('running');
            expect(res.refilled).toBe(true);
            expect(res.inside).toBe(true);
        });

        test('the lives counter shows in the HUD', async ({ page }) => {
            await page.evaluate(() => { plane.x = 4; step(0.016); });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing every life ends the run', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (let life = 0; life < 3; life++) {
                    plane.x = 4;
                    step(0.016);
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                return { state, lives };
            });
            expect(res.state).toBe('over');
            expect(res.lives).toBe(0);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the best score is saved when the run ends', async ({ page }) => {
            const saved = await page.evaluate(() => {
                score = 777;
                for (let life = 0; life < 3; life++) {
                    plane.x = 4;
                    step(0.016);
                    for (let i = 0; i < 200; i++) step(0.016);
                }
                return window.localStorage.getItem('canyon-raider-best');
            });
            expect(Number(saved)).toBeGreaterThanOrEqual(777);
        });
    });

    // -----------------------------------------------------------------------
    // Restarting
    // -----------------------------------------------------------------------
    test.describe('restarting', () => {
        test('Space after a game over starts a fresh run', async ({ page }) => {
            await page.evaluate((seed) => {
                startGame(seed);
                score = 500;
                for (let life = 0; life < 3; life++) {
                    plane.x = 4;
                    step(0.016);
                    for (let i = 0; i < 200; i++) step(0.016);
                }
            }, SEED);
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ state, score, lives, section, fuel, max: MAX_FUEL }));
            expect(res.state).toBe('running');
            expect(res.score).toBe(0);
            expect(res.lives).toBe(3);
            expect(res.section).toBe(1);
            // A live frame or two may have burned a sliver of fuel already.
            expect(res.fuel).toBeGreaterThan(res.max * 0.95);
        });
    });
});
