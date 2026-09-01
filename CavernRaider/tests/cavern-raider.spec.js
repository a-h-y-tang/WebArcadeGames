const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Cavern Raider', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // `CENTRE()` parks the ship in the middle of the cave at its current
        // column, so a test that is not about crashing never crashes by
        // accident while the world scrolls underneath it.
        await page.evaluate(() => {
            window.CENTRE = () => {
                const wx = world.scrollX + ship.x;
                ship.y = (ceilingAt(wx) + floorAt(wx)) / 2;
            };
        });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Cavern Raider', async ({ page }) => {
            await expect(page).toHaveTitle('Cavern Raider');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 720x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('HUD starts at zero score, full lives and full fuel', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText(String(await page.evaluate(() => START_LIVES)));
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#fuel-bar')).toHaveAttribute('style', /width:\s*100(\.\d+)?%/);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = world.scrollX;
                for (let i = 0; i < 30; i++) step(0.016);
                return world.scrollX !== before;
            });
            expect(moved).toBe(false);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('cavern-raider-best', '1234'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });
    });

    // -----------------------------------------------------------------------
    // Terrain generation
    // -----------------------------------------------------------------------
    test.describe('terrain', () => {
        test('the same seed always produces the same cave', async ({ page }) => {
            const same = await page.evaluate(() => {
                const read = () => {
                    setSeed(99);
                    return Array.from({ length: 200 }, (_, i) => terrainColumn(i).ceiling + ':' + terrainColumn(i).floor);
                };
                const a = read();
                const b = read();
                return JSON.stringify(a) === JSON.stringify(b);
            });
            expect(same).toBe(true);
        });

        test('different seeds produce different caves', async ({ page }) => {
            const differ = await page.evaluate(() => {
                const read = (s) => {
                    setSeed(s);
                    return Array.from({ length: 200 }, (_, i) => terrainColumn(i).ceiling + ':' + terrainColumn(i).floor);
                };
                return JSON.stringify(read(1)) !== JSON.stringify(read(2));
            });
            expect(differ).toBe(true);
        });

        test('every column leaves a flyable gap inside the canvas', async ({ page }) => {
            const bad = await page.evaluate(() => {
                setSeed(7);
                const problems = [];
                for (let i = 0; i < 1200; i++) {
                    const c = terrainColumn(i);
                    if (c.floor - c.ceiling < MIN_GAP) problems.push(['gap', i]);
                    if (c.ceiling < 0 || c.floor > CANVAS_H) problems.push(['bounds', i]);
                }
                return problems.slice(0, 5);
            });
            expect(bad).toEqual([]);
        });

        test('the cave changes shape as it goes along', async ({ page }) => {
            const distinct = await page.evaluate(() => {
                setSeed(3);
                const seen = new Set();
                for (let i = 0; i < 400; i++) seen.add(terrainColumn(i).ceiling);
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(5);
        });

        test('the first columns are wide open so the ship starts safe', async ({ page }) => {
            const ok = await page.evaluate(() => {
                setSeed(11);
                for (let i = 0; i < 20; i++) {
                    const c = terrainColumn(i);
                    if (c.floor - c.ceiling < SAFE_GAP) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('ceilingAt / floorAt read the column covering a world x', async ({ page }) => {
            const match = await page.evaluate(() => {
                setSeed(5);
                const wx = 12 * 40 + 3;
                const col = terrainColumn(40);
                return ceilingAt(wx) === col.ceiling && floorAt(wx) === col.floor;
            });
            expect(match).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('pressing Space starts the run and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('clicking the start button starts the run', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world scrolls forward once running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 10; i++) step(0.016);
            });
            expect(await page.evaluate(() => world.scrollX)).toBeGreaterThan(0);
        });

        test('the ship starts alive, centred in the cave and with full fuel', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { alive: ship.alive, fuel, lives, y: ship.y, x: ship.x };
            });
            expect(s.alive).toBe(true);
            expect(s.fuel).toBeCloseTo(100, 5);
            expect(s.y).toBeGreaterThan(0);
            expect(s.x).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Flying the ship
    // -----------------------------------------------------------------------
    test.describe('ship control', () => {
        test('steering up moves the ship up', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const before = ship.y;
                steer(0, -1);
                for (let i = 0; i < 10; i++) step(0.016);
                return before - ship.y;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('steering down moves the ship down', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const before = ship.y;
                steer(0, 1);
                for (let i = 0; i < 10; i++) step(0.016);
                return ship.y - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('steering forward and back moves the ship across the screen', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const start = ship.x;
                steer(1, 0);
                for (let i = 0; i < 20; i++) { step(0.016); CENTRE(); }
                const forward = ship.x;
                steer(-1, 0);
                for (let i = 0; i < 40; i++) { step(0.016); CENTRE(); }
                return { start, forward, back: ship.x };
            });
            expect(d.forward).toBeGreaterThan(d.start);
            expect(d.back).toBeLessThan(d.forward);
        });

        test('the ship cannot fly off the left or right of the screen', async ({ page }) => {
            const bounds = await page.evaluate(() => {
                startGame();
                steer(-1, 0);
                for (let i = 0; i < 400; i++) { step(0.016); CENTRE(); }
                const left = ship.x;
                steer(1, 0);
                for (let i = 0; i < 800; i++) { step(0.016); CENTRE(); }
                return { left, right: ship.x };
            });
            expect(bounds.left).toBeGreaterThanOrEqual(0);
            expect(bounds.right).toBeLessThanOrEqual(720);
        });

        test('releasing the controls stops the ship drifting', async ({ page }) => {
            const drift = await page.evaluate(() => {
                startGame();
                steer(0, -1);
                for (let i = 0; i < 5; i++) step(0.016);
                steer(0, 0);
                const y = ship.y;
                for (let i = 0; i < 20; i++) step(0.016);
                return Math.abs(ship.y - y);
            });
            expect(drift).toBeLessThan(0.001);
        });

        test('arrow keys steer the ship', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('ArrowUp');
            const dy = await page.evaluate(() => {
                const before = ship.y;
                for (let i = 0; i < 10; i++) step(0.016);
                return before - ship.y;
            });
            await page.keyboard.up('ArrowUp');
            expect(dy).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Weapons
    // -----------------------------------------------------------------------
    test.describe('weapons', () => {
        test('firing spawns a bullet ahead of the ship', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                fire();
                return { count: bullets.length, x: bullets[0].x, shipX: world.scrollX + ship.x };
            });
            expect(b.count).toBe(1);
            expect(b.x).toBeGreaterThanOrEqual(b.shipX);
        });

        test('bullets travel forward through the cave', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                CENTRE();
                fire();
                const start = bullets[0].x;
                for (let i = 0; i < 5; i++) step(0.016);
                return bullets.length ? bullets[0].x - start : 999;
            });
            expect(d).toBeGreaterThan(0);
        });

        test('the gun has a cooldown so holding fire does not flood the screen', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 20; i++) fire();
                return bullets.length;
            });
            expect(count).toBe(1);
        });

        test('bullets are dropped once they leave the screen', async ({ page }) => {
            const left = await page.evaluate(() => {
                startGame();
                CENTRE();
                fire();
                for (let i = 0; i < 400; i++) { step(0.016); CENTRE(); }
                return bullets.length;
            });
            expect(left).toBe(0);
        });

        test('dropping a bomb spawns a bomb that falls', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                CENTRE();
                dropBomb();
                const b = bombs[0];
                const start = { x: b.x, y: b.y };
                for (let i = 0; i < 8; i++) step(0.016);
                return bombs.length ? { dx: bombs[0].x - start.x, dy: bombs[0].y - start.y } : null;
            });
            expect(d.dy).toBeGreaterThan(0);
            expect(d.dx).toBeGreaterThan(0);
        });

        test('bombs have their own cooldown', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 10; i++) dropBomb();
                return bombs.length;
            });
            expect(count).toBe(1);
        });

        test('weapons do nothing when the game is not running', async ({ page }) => {
            const counts = await page.evaluate(() => {
                fire();
                dropBomb();
                return { b: bullets.length, m: bombs.length };
            });
            expect(counts).toEqual({ b: 0, m: 0 });
        });

        test('bullets are absorbed by the cave wall', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                CENTRE();
                fire();
                // Drag the shot up into the roof; it should be swallowed by the
                // rock. Well inside, so the shot is still buried after the
                // fraction of a column it travels during the step.
                bullets[0].y = ceilingAt(bullets[0].x) - 20;
                step(0.004);
                return bullets.length;
            });
            expect(gone).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Targets
    // -----------------------------------------------------------------------
    test.describe('targets', () => {
        test('a bullet destroys a rocket and scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                CENTRE();
                const before = score;
                const wx = world.scrollX + ship.x + 60;
                entities.length = 0;
                entities.push(makeEntity('rocket', wx));
                fire();
                bullets[0].x = wx;
                bullets[0].y = entities[0].y - 6;
                step(0.001);
                return { alive: entities[0].alive, gain: score - before };
            });
            expect(r.alive).toBe(false);
            expect(r.gain).toBeGreaterThanOrEqual(50);
        });

        test('a bomb destroys a fuel tank, scores and refuels', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                CENTRE();
                fuel = 40;
                const before = score;
                const wx = world.scrollX + ship.x + 60;
                entities.length = 0;
                entities.push(makeEntity('fuel', wx));
                dropBomb();
                bombs[0].x = wx;
                bombs[0].y = entities[0].y - 4;
                step(0.001);
                return { alive: entities[0].alive, gain: score - before, fuel };
            });
            expect(r.alive).toBe(false);
            expect(r.gain).toBeGreaterThanOrEqual(30);
            expect(r.fuel).toBeGreaterThan(40);
        });

        test('refuelling never overfills the tank', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                CENTRE();
                fuel = 98;
                const wx = world.scrollX + ship.x + 60;
                entities.length = 0;
                entities.push(makeEntity('fuel', wx));
                fire();
                bullets[0].x = wx;
                bullets[0].y = entities[0].y - 6;
                step(0.001);
                return fuel;
            });
            expect(f).toBeLessThanOrEqual(100);
        });

        test('a destroyed target cannot be hit twice', async ({ page }) => {
            const gain = await page.evaluate(() => {
                startGame();
                CENTRE();
                const wx = world.scrollX + ship.x + 60;
                entities.length = 0;
                entities.push(makeEntity('rocket', wx));
                entities[0].alive = false;
                const before = score;
                fire();
                bullets[0].x = wx;
                bullets[0].y = entities[0].y - 6;
                step(0.001);
                return score - before;
            });
            expect(gain).toBe(0);
        });

        test('a rocket launches when the ship gets close', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                CENTRE();
                const wx = world.scrollX + ship.x + 80;
                entities.length = 0;
                entities.push(makeEntity('rocket', wx));
                const startY = entities[0].y;
                for (let i = 0; i < 30; i++) { step(0.016); CENTRE(); }
                return { launched: entities[0].launched, rose: startY - entities[0].y };
            });
            expect(r.launched).toBe(true);
            expect(r.rose).toBeGreaterThan(0);
        });

        test('a distant rocket stays on the ground', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                CENTRE();
                entities.length = 0;
                entities.push(makeEntity('rocket', world.scrollX + ship.x + 3000));
                for (let i = 0; i < 10; i++) { step(0.016); CENTRE(); }
                return entities[0].launched;
            });
            expect(launched).toBe(false);
        });

        test('fuel tanks never launch', async ({ page }) => {
            const launched = await page.evaluate(() => {
                startGame();
                CENTRE();
                entities.length = 0;
                entities.push(makeEntity('fuel', world.scrollX + ship.x + 60));
                for (let i = 0; i < 40; i++) { step(0.016); CENTRE(); }
                return entities[0].launched;
            });
            expect(launched).toBe(false);
        });

        test('the cave is populated with rockets and fuel tanks as you fly', async ({ page }) => {
            const kinds = await page.evaluate(() => {
                setSeed(21);
                startGame();
                for (let i = 0; i < 900; i++) { step(0.016); CENTRE(); }
                return { rockets: spawnCount.rocket, fuel: spawnCount.fuel, live: entities.length };
            });
            expect(kinds.rockets).toBeGreaterThan(0);
            expect(kinds.fuel).toBeGreaterThan(0);
            expect(kinds.live).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Fuel
    // -----------------------------------------------------------------------
    test.describe('fuel', () => {
        test('fuel burns down as you fly', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                const before = fuel;
                for (let i = 0; i < 60; i++) { step(0.016); CENTRE(); }
                return before - fuel;
            });
            expect(f).toBeGreaterThan(0);
        });

        test('the fuel gauge shrinks as fuel burns', async ({ page }) => {
            // Sampled inside the page: the real animation loop keeps burning
            // fuel, so the gauge has to be read in the same tick it is set.
            const style = await page.evaluate(() => {
                startGame();
                fuel = 50;
                step(0.001);
                return document.getElementById('fuel-bar').getAttribute('style');
            });
            expect(style).toMatch(/width:\s*(49\.9|50(\.\d+)?)%/);
        });

        test('running out of fuel costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                CENTRE();
                const before = lives;
                fuel = 0.001;
                for (let i = 0; i < 5; i++) step(0.016);
                return { lost: before - lives, alive: ship.alive };
            });
            expect(r.lost).toBe(1);
            expect(r.alive).toBe(false);
        });

        test('a fresh life comes with a fresh tank', async ({ page }) => {
            const f = await page.evaluate(() => {
                startGame();
                CENTRE();
                fuel = 0.001;
                step(0.016);
                for (let i = 0; i < 90; i++) step(0.016); // wait out the respawn
                return { fuel, alive: ship.alive };
            });
            expect(f.alive).toBe(true);
            expect(f.fuel).toBeGreaterThan(90);
        });
    });

    // -----------------------------------------------------------------------
    // Crashing
    // -----------------------------------------------------------------------
    test.describe('crashing', () => {
        test('flying into the roof costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = lives;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
                return { lost: before - lives, alive: ship.alive };
            });
            expect(r.lost).toBe(1);
            expect(r.alive).toBe(false);
        });

        test('flying into the floor costs a life', async ({ page }) => {
            const lost = await page.evaluate(() => {
                startGame();
                const before = lives;
                ship.y = floorAt(world.scrollX + ship.x) - 1;
                step(0.016);
                return before - lives;
            });
            expect(lost).toBe(1);
        });

        test('hitting a rocket costs a life', async ({ page }) => {
            const lost = await page.evaluate(() => {
                startGame();
                CENTRE();
                const before = lives;
                entities.length = 0;
                const e = makeEntity('rocket', world.scrollX + ship.x);
                e.y = ship.y + e.h / 2;
                entities.push(e);
                step(0.001);
                return before - lives;
            });
            expect(lost).toBe(1);
        });

        test('the ship respawns in clear air after a crash', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
                // Just past the respawn delay: the new ship should be sitting
                // in clear air before the player has had to fly it anywhere.
                for (let i = 0; i < 90; i++) step(0.016);
                const wx = world.scrollX + ship.x;
                return { alive: ship.alive, y: ship.y, ceiling: ceilingAt(wx), floor: floorAt(wx) };
            });
            expect(r.alive).toBe(true);
            expect(r.y).toBeGreaterThan(r.ceiling);
            expect(r.y).toBeLessThan(r.floor);
        });

        test('one crash only costs one life even across several steps', async ({ page }) => {
            const lost = await page.evaluate(() => {
                startGame();
                const before = lives;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                for (let i = 0; i < 20; i++) step(0.016);
                return before - lives;
            });
            expect(lost).toBe(1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
                return { state, lives };
            });
            expect(r.state).toBe('over');
            expect(r.lives).toBe(0);
        });

        test('game over shows the overlay and freezes the world', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            const frozen = await page.evaluate(() => {
                const before = world.scrollX;
                for (let i = 0; i < 20; i++) step(0.016);
                return world.scrollX === before;
            });
            expect(frozen).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & progression
    // -----------------------------------------------------------------------
    test.describe('scoring and progression', () => {
        test('distance flown adds to the score', async ({ page }) => {
            const gain = await page.evaluate(() => {
                startGame();
                const before = score;
                for (let i = 0; i < 120; i++) { step(0.016); CENTRE(); }
                return score - before;
            });
            expect(gain).toBeGreaterThan(0);
        });

        test('the HUD shows the live score', async ({ page }) => {
            const hud = await page.evaluate(() => {
                startGame();
                CENTRE();
                for (let i = 0; i < 120; i++) { step(0.016); CENTRE(); }
                return { shown: document.getElementById('score').textContent, score };
            });
            expect(Number(hud.shown)).toBe(hud.score);
            expect(hud.score).toBeGreaterThan(0);
        });

        test('the cave gets faster as the level climbs', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                startGame();
                const first = scrollSpeed();
                world.scrollX = LEVEL_DIST * 3 + 10;
                step(0.001);
                return { first, later: scrollSpeed(), level };
            });
            expect(speeds.level).toBe(4);
            expect(speeds.later).toBeGreaterThan(speeds.first);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                score = 777;
                killScore = 777;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
            });
            const best = await page.evaluate(() => window.localStorage.getItem('cavern-raider-best'));
            expect(Number(best)).toBeGreaterThanOrEqual(777);
            await expect(page.locator('#best')).toHaveText(String(Number(best)));
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('cavern-raider-best', '5000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                lives = 1;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
            });
            const best = await page.evaluate(() => window.localStorage.getItem('cavern-raider-best'));
            expect(best).toBe('5000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes the run', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the world does not move while paused', async ({ page }) => {
            const frozen = await page.evaluate(() => {
                startGame();
                togglePause();
                const before = world.scrollX;
                for (let i = 0; i < 20; i++) step(0.016);
                return world.scrollX === before;
            });
            expect(frozen).toBe(true);
        });

        test('restarting resets score, lives, fuel and the world', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60; i++) { step(0.016); CENTRE(); }
                killScore = 400;
                lives = 1;
                fuel = 12;
                startGame();
                return { score, lives, fuel, scrollX: world.scrollX, level, bullets: bullets.length };
            });
            expect(after.score).toBe(0);
            expect(after.lives).toBe(await page.evaluate(() => START_LIVES));
            expect(after.fuel).toBe(100);
            expect(after.scrollX).toBe(0);
            expect(after.level).toBe(1);
            expect(after.bullets).toBe(0);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                ship.y = ceilingAt(world.scrollX + ship.x) + 1;
                step(0.016);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const px = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a long run stays stable and keeps the ship inside the cave', async ({ page }) => {
            const r = await page.evaluate(() => {
                setSeed(4);
                startGame();
                for (let i = 0; i < 1500; i++) { step(1 / 60); CENTRE(); }
                draw();
                const wx = world.scrollX + ship.x;
                return {
                    state,
                    lives,
                    y: ship.y,
                    ceiling: ceilingAt(wx),
                    floor: floorAt(wx),
                    bullets: bullets.length,
                    entities: entities.length,
                };
            });
            expect(r.state).toBe('running');
            expect(r.y).toBeGreaterThan(r.ceiling);
            expect(r.y).toBeLessThan(r.floor);
            expect(r.entities).toBeLessThan(400);
        });
    });
});
