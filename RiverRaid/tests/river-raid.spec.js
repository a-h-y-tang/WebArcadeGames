const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, best and section start at their base values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#section')).toHaveText('1');
        });

        test('lives and fuel start full', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#fuel')).toHaveText('100%');
        });

        test('canvas is 480x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no entities or missiles before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ e: entities.length, m: missiles.length }));
            expect(counts.e).toBe(0);
            expect(counts.m).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('riverraid-best', '4820'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4820');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
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

        test('starting resets score, lives, fuel, section and distance', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, lives, fuel, section, distance, max: MAX_FUEL, start: START_LIVES };
            });
            expect(s.score).toBe(0);
            expect(s.lives).toBe(s.start);
            expect(s.fuel).toBe(s.max);
            expect(s.section).toBe(1);
            expect(s.distance).toBe(0);
        });

        test('the jet starts centred in the river', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const b = riverBoundsAt(distance);
                return { x: player.x, mid: (b.left + b.right) / 2 };
            });
            expect(Math.abs(s.x - s.mid)).toBeLessThan(2);
        });

        test('terrain is generated ahead of the jet on start', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return terrain.length * ROW_H > CANVAS_H;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Procedural river
    // -----------------------------------------------------------------------
    test.describe('the river', () => {
        test('river bounds have the left bank before the right bank', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let y = 0; y < 4000; y += 37) {
                    const b = riverBoundsAt(y);
                    if (!(b.left < b.right)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('river width stays within the configured limits', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let y = 0; y < 4000; y += 17) {
                    const b = riverBoundsAt(y);
                    const w = b.right - b.left;
                    if (w < MIN_RIVER_W - 1 || w > MAX_RIVER_W + 1) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the banks never leave the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let y = 0; y < 4000; y += 13) {
                    const b = riverBoundsAt(y);
                    if (b.left < 0 || b.right > CANVAS_W) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the river meanders rather than running straight', async ({ page }) => {
            const spread = await page.evaluate(() => {
                startGame();
                let min = Infinity;
                let max = -Infinity;
                for (let y = 0; y < 4000; y += 20) {
                    const b = riverBoundsAt(y);
                    min = Math.min(min, b.left);
                    max = Math.max(max, b.left);
                }
                return max - min;
            });
            expect(spread).toBeGreaterThan(10);
        });

        test('a bridge spans the river at each section boundary', async ({ page }) => {
            const bridge = await page.evaluate(() => {
                startGame();
                ensureTerrain(SECTION_ROWS * ROW_H + CANVAS_H);
                const b = entities.find((e) => e.type === 'bridge');
                if (!b) return null;
                const bounds = riverBoundsAt(b.worldY);
                return { w: b.w, riverW: bounds.right - bounds.left, worldY: b.worldY };
            });
            expect(bridge).not.toBeNull();
            expect(bridge.worldY).toBeGreaterThan(0);
            expect(bridge.w).toBeGreaterThanOrEqual(bridge.riverW);
        });

        test('enemies and depots appear along the course', async ({ page }) => {
            const types = await page.evaluate(() => {
                startGame();
                ensureTerrain(8000);
                return [...new Set(entities.map((e) => e.type))];
            });
            expect(types).toContain('fuel');
            expect(types.some((t) => t === 'heli' || t === 'ship' || t === 'jet')).toBe(true);
        });

        test('spawned entities sit inside the river', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                ensureTerrain(8000);
                return entities.every((e) => {
                    if (e.type === 'bridge') return true;
                    const b = riverBoundsAt(e.worldY);
                    return e.x - e.w / 2 >= b.left - 1 && e.x + e.w / 2 <= b.right + 1;
                });
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Flying
    // -----------------------------------------------------------------------
    test.describe('flying', () => {
        test('distance grows as time passes', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20; i++) step(0.016);
                return distance;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('the throttle changes how fast the jet flies', async ({ page }) => {
            const s = await page.evaluate(() => {
                const run = (throttle) => {
                    startGame();
                    setThrottle(throttle);
                    for (let i = 0; i < 20; i++) step(0.016);
                    return distance;
                };
                return { slow: run(-1), normal: run(0), fast: run(1) };
            });
            expect(s.slow).toBeLessThan(s.normal);
            expect(s.fast).toBeGreaterThan(s.normal);
        });

        test('moving left decreases the jet x', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setPlayerX(240);
                movePlayer(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { x: player.x };
            });
            expect(s.x).toBeLessThan(240);
        });

        test('moving right increases the jet x', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setPlayerX(240);
                movePlayer(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { x: player.x };
            });
            expect(s.x).toBeGreaterThan(240);
        });

        test('the jet cannot leave the canvas', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                // ignore bank crashes for this check
                player.invuln = 999;
                setPlayerX(240);
                movePlayer(-1);
                let minX = Infinity;
                for (let i = 0; i < 200; i++) { step(0.016); minX = Math.min(minX, player.x); }
                movePlayer(1);
                let maxX = -Infinity;
                for (let i = 0; i < 400; i++) { step(0.016); maxX = Math.max(maxX, player.x); }
                return { minX, maxX, w: CANVAS_W, pw: player.w };
            });
            expect(s.minX).toBeGreaterThanOrEqual(s.pw / 2 - 0.001);
            expect(s.maxX).toBeLessThanOrEqual(s.w - s.pw / 2 + 0.001);
        });

        test('ArrowLeft key steers the jet', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.invuln = 999; setPlayerX(240); });
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => player.x)).toBeLessThan(240);
        });

        test('enemies move and stay inside the river', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                const heli = spawnEntity('heli', riverBoundsAt(distance + 300).left + 40, distance + 300);
                const startX = heli.x;
                let moved = false;
                for (let i = 0; i < 120; i++) {
                    step(0.016);
                    if (Math.abs(heli.x - startX) > 1) moved = true;
                    const b = riverBoundsAt(heli.worldY);
                    if (heli.x - heli.w / 2 < b.left - 1 || heli.x + heli.w / 2 > b.right + 1) {
                        return { inBounds: false, moved };
                    }
                }
                return { inBounds: true, moved };
            });
            expect(s.inBounds).toBe(true);
            expect(s.moved).toBe(true);
        });

        test('entities left behind the jet are culled', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                const ship = spawnEntity('ship', 240, distance + 20);
                player.invuln = 999;
                for (let i = 0; i < 200; i++) step(0.016);
                return entities.includes(ship);
            });
            expect(count).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel burns as the jet flies', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = fuel;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: fuel };
            });
            expect(s.after).toBeLessThan(s.before);
        });

        test('the fuel readout tracks the tank', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                // pause first so the animation loop cannot burn fuel mid-assertion
                togglePause();
                fuel = MAX_FUEL / 2;
                updateHud();
            });
            await expect(page.locator('#fuel')).toHaveText('50%');
        });

        test('flying over a depot refuels the jet', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                fuel = 20;
                setPlayerX(240);
                spawnEntity('fuel', 240, distance + 4);
                const before = fuel;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: fuel };
            });
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('refuelling never overfills the tank', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                fuel = MAX_FUEL - 1;
                setPlayerX(240);
                spawnEntity('fuel', 240, distance + 4);
                for (let i = 0; i < 20; i++) step(0.016);
                return { fuel, max: MAX_FUEL };
            });
            expect(s.fuel).toBe(s.max);
        });

        test('a fuel depot never crashes the jet', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                spawnEntity('fuel', 240, distance + 4);
                for (let i = 0; i < 20; i++) step(0.016);
                return { lives, state };
            });
            expect(s.lives).toBe(3);
            expect(s.state).toBe('running');
        });

        test('running dry costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                fuel = 0.01;
                for (let i = 0; i < 5; i++) step(0.016);
                return { lives, fuel };
            });
            expect(s.lives).toBe(2);
            expect(s.fuel).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing launches a missile from the jet', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setPlayerX(200);
                const fired = fire();
                return { fired, count: missiles.length, x: missiles[0].x };
            });
            expect(s.fired).toBe(true);
            expect(s.count).toBe(1);
            expect(s.x).toBe(200);
        });

        test('only one missile can be in flight', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fire();
                const second = fire();
                return { second, count: missiles.length };
            });
            expect(s.second).toBe(false);
            expect(s.count).toBe(1);
        });

        test('firing does nothing before the game starts', async ({ page }) => {
            const s = await page.evaluate(() => ({ fired: fire(), count: missiles.length }));
            expect(s.fired).toBe(false);
            expect(s.count).toBe(0);
        });

        test('Space fires once the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => missiles.length)).toBe(1);
        });

        test('missiles travel up the river', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fire();
                const before = missiles[0].worldY;
                step(0.05);
                return { before, after: missiles[0].worldY };
            });
            expect(s.after).toBeGreaterThan(s.before);
        });

        test('a missile leaving the view is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                player.invuln = 999;
                fire();
                for (let i = 0; i < 150; i++) step(0.016);
                return missiles.length;
            });
            expect(count).toBe(0);
        });

        test('shooting a helicopter scores its value', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const heli = spawnEntity('heli', 240, distance + 60);
                heli.vx = 0;
                fire();
                for (let i = 0; i < 20; i++) step(0.016);
                return { score, alive: entities.includes(heli), pts: POINTS.heli };
            });
            expect(s.alive).toBe(false);
            expect(s.score).toBe(s.pts);
        });

        test('shooting a ship scores its value', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const ship = spawnEntity('ship', 240, distance + 60);
                ship.vx = 0;
                fire();
                for (let i = 0; i < 20; i++) step(0.016);
                return { score, alive: entities.includes(ship), pts: POINTS.ship };
            });
            expect(s.alive).toBe(false);
            expect(s.score).toBe(s.pts);
        });

        test('shooting a depot scores its value', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const depot = spawnEntity('fuel', 240, distance + 60);
                fire();
                for (let i = 0; i < 20; i++) step(0.016);
                return { score, alive: entities.includes(depot), pts: POINTS.fuel };
            });
            expect(s.alive).toBe(false);
            expect(s.score).toBe(s.pts);
        });

        test('a missile is spent on the target it hits', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const a = spawnEntity('heli', 240, distance + 60);
                a.vx = 0;
                const b = spawnEntity('heli', 240, distance + 90);
                b.vx = 0;
                fire();
                for (let i = 0; i < 6; i++) step(0.016);
                return { missiles: missiles.length, first: entities.includes(a), second: entities.includes(b) };
            });
            expect(s.missiles).toBe(0);
            expect(s.first).toBe(false);
            expect(s.second).toBe(true);
        });

        test('a missile that strays into the bank is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                player.invuln = 999;
                fire();
                // nudge the shot into the bank the river bends into
                missiles[0].x = riverBoundsAt(missiles[0].worldY).left - 4;
                step(0.016);
                return missiles.length;
            });
            expect(count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('flying into the bank costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                const b = riverBoundsAt(distance);
                setPlayerX(b.left - 10);
                step(0.016);
                return { lives, state };
            });
            expect(s.lives).toBe(2);
            expect(s.state).toBe('running');
        });

        test('hitting a helicopter costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const heli = spawnEntity('heli', 240, distance + 4);
                heli.vx = 0;
                step(0.016);
                return lives;
            });
            expect(s).toBe(2);
        });

        test('a crash clears missiles in flight', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                fire();
                const b = riverBoundsAt(distance);
                setPlayerX(b.left - 10);
                step(0.016);
                return missiles.length;
            });
            expect(count).toBe(0);
        });

        test('respawning re-centres the jet and refills the tank', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                fuel = 30;
                const b = riverBoundsAt(distance);
                setPlayerX(b.left - 10);
                step(0.016);
                const mid = (riverBoundsAt(distance).left + riverBoundsAt(distance).right) / 2;
                return { x: player.x, mid, fuel, max: MAX_FUEL };
            });
            expect(Math.abs(s.x - s.mid)).toBeLessThan(2);
            expect(s.fuel).toBe(s.max);
        });

        test('a crash grants brief invulnerability', async ({ page }) => {
            const invuln = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                const b = riverBoundsAt(distance);
                setPlayerX(b.left - 10);
                step(0.016);
                return player.invuln;
            });
            expect(invuln).toBeGreaterThan(0);
        });

        test('an invulnerable jet does not crash again', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                player.invuln = 5;
                setPlayerX(240);
                const heli = spawnEntity('heli', 240, distance + 4);
                heli.vx = 0;
                for (let i = 0; i < 10; i++) step(0.016);
                return window.lives;
            });
            expect(lives).toBe(3);
        });

        test('invulnerability wears off', async ({ page }) => {
            const invuln = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                player.invuln = 0.05;
                for (let i = 0; i < 10; i++) step(0.016);
                return player.invuln;
            });
            expect(invuln).toBe(0);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                lives = 1;
                const b = riverBoundsAt(distance);
                setPlayerX(b.left - 10);
                step(0.016);
                return { state, lives };
            });
            expect(s.state).toBe('over');
            expect(s.lives).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bridges and sections
    // -----------------------------------------------------------------------
    test.describe('bridges', () => {
        test('a standing bridge blocks the river', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                spawnEntity('bridge', 240, distance + 4);
                step(0.016);
                return window.lives;
            });
            expect(lives).toBe(2);
        });

        test('shooting a bridge scores big and advances the section', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                const bridge = spawnEntity('bridge', 240, distance + 60);
                fire();
                for (let i = 0; i < 10; i++) step(0.016);
                return { score, section, pts: POINTS.bridge, alive: entities.includes(bridge) };
            });
            expect(s.alive).toBe(false);
            expect(s.score).toBe(s.pts);
            expect(s.section).toBe(2);
        });

        test('a destroyed bridge no longer blocks the river', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                entities.length = 0;
                setPlayerX(240);
                spawnEntity('bridge', 240, distance + 60);
                fire();
                for (let i = 0; i < 60; i++) step(0.016);
                return { lives, state };
            });
            expect(s.lives).toBe(3);
            expect(s.state).toBe('running');
        });

        test('the section readout follows the section', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                section = 4;
                updateHud();
            });
            await expect(page.locator('#section')).toHaveText('4');
        });

        test('later sections fly faster at the same throttle', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setThrottle(0);
                const early = currentSpeed();
                section = 6;
                const late = currentSpeed();
                return { early, late };
            });
            expect(s.late).toBeGreaterThan(s.early);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 3140;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('3140');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 2200;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('riverraid-best'));
            expect(parseInt(stored, 10)).toBe(2200);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('riverraid-best', '99000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('99000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                endGame();
            });
            await expect(page.locator('#overlay-score')).toContainText('777');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the flight', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = distance;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: distance, state };
            });
            expect(s.after).toBe(s.before);
            expect(s.state).toBe('paused');
        });

        test('resuming lets the jet fly again', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                togglePause();
                togglePause();
                const before = distance;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: distance, state };
            });
            expect(s.after).toBeGreaterThan(s.before);
            expect(s.state).toBe('running');
        });

        test('P toggles pause', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pause does nothing when the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                endGame();
                togglePause();
                return state;
            });
            expect(s).toBe('over');
        });

        test('restarting resets the run', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 5000;
                section = 7;
                lives = 1;
                fuel = 5;
                spawnEntity('heli', 240, distance + 100);
                fire();
                endGame();
                startGame();
                return {
                    score, section, lives, fuel, distance,
                    entities: entities.length, missiles: missiles.length, state,
                };
            });
            expect(s.score).toBe(0);
            expect(s.section).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.fuel).toBe(100);
            expect(s.distance).toBe(0);
            expect(s.missiles).toBe(0);
            expect(s.state).toBe('running');
        });
    });
});
