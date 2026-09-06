const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game with a quiet battlefield: no enemies on the board and none
// queued to spawn, so tests can position pieces without the AI interfering.
async function startQuiet(page) {
    await page.evaluate(() => {
        startGame();
        enemies.length = 0;
        bullets.length = 0;
        enemiesToSpawn = 0;
        spawnTimer = 999;
        player.invuln = 0;
    });
}

test.describe('Tank Battle', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tank Battle', async ({ page }) => {
            await expect(page).toHaveTitle('Tank Battle');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 480x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies or bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tankbattle-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the battlefield is a 15x15 grid', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => grid.length)).toBe(15);
            expect(await page.evaluate(() => grid[0].length)).toBe(15);
        });

        test('the base is alive at the bottom centre', async ({ page }) => {
            await page.keyboard.press('Space');
            const eagle = await page.evaluate(() => ({ alive: base.alive, cx: base.cx, cy: base.cy }));
            expect(eagle.alive).toBe(true);
            expect(eagle.cx).toBe(7);
            expect(eagle.cy).toBe(14);
        });

        test('the base is protected by a brick fort', async ({ page }) => {
            await page.keyboard.press('Space');
            const allBrick = await page.evaluate(() =>
                [[6, 13], [7, 13], [8, 13], [6, 14], [8, 14]].every(([cx, cy]) => tileAt(cx, cy) === T_BRICK)
            );
            expect(allBrick).toBe(true);
        });

        test('the player tank starts alive on its spawn cell', async ({ page }) => {
            await page.keyboard.press('Space');
            const p = await page.evaluate(() => ({ x: player.x, y: player.y, alive: player.alive }));
            expect(p.alive).toBe(true);
            expect(p.x).toBeCloseTo(4 * 32 + 16, 5);
            expect(p.y).toBeCloseTo(14 * 32 + 16, 5);
        });

        test('the level starts with a full complement of enemies to destroy', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => ({
                left: enemiesLeft,
                toSpawn: enemiesToSpawn,
                forLevel: enemiesForLevel(),
            }));
            expect(info.left).toBe(info.forLevel);
            expect(info.toSpawn).toBe(info.forLevel);
        });

        test('the enemy counter is shown in the HUD', async ({ page }) => {
            await page.keyboard.press('Space');
            const left = await page.evaluate(() => enemiesLeft);
            await expect(page.locator('#enemies')).toHaveText(String(left));
        });
    });

    // -----------------------------------------------------------------------
    // Player movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('ArrowRight drives the player right', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => step(0.5));
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
            expect(await page.evaluate(() => player.dir)).toBe('right');
        });

        test('ArrowUp drives the player up', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.x = 32 * 4 + 16; player.y = 32 * 10 + 16; });
            const before = await page.evaluate(() => player.y);
            await page.keyboard.down('ArrowUp');
            await page.evaluate(() => step(0.4));
            expect(await page.evaluate(() => player.y)).toBeLessThan(before);
            expect(await page.evaluate(() => player.dir)).toBe('up');
        });

        test('WASD also drives the tank', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.down('a');
            await page.evaluate(() => step(0.2));
            expect(await page.evaluate(() => player.dir)).toBe('left');
        });

        test('releasing the key stops the tank', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => step(0.2));
            await page.keyboard.up('ArrowRight');
            const x = await page.evaluate(() => player.x);
            await page.evaluate(() => step(0.5));
            expect(await page.evaluate(() => player.x)).toBeCloseTo(x, 5);
        });

        test('the tank cannot drive through the left wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.x = 16; player.y = 32 * 14 + 16; player.dir = 'left'; });
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => step(1.0));
            expect(await page.evaluate(() => player.x)).toBeGreaterThanOrEqual(14);
        });

        test('the tank cannot drive through the bottom wall', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.down('ArrowDown');
            await page.evaluate(() => step(1.0));
            expect(await page.evaluate(() => player.y)).toBeLessThanOrEqual(480 - 14);
        });

        test('steel blocks the tank', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                setTile(4, 7, T_STEEL);
            });
            await page.keyboard.down('ArrowUp');
            await page.evaluate(() => step(1.0));
            expect(await page.evaluate(() => player.y)).toBeGreaterThan(32 * 7 + 16);
        });

        test('brick blocks the tank', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                setTile(4, 9, T_BRICK);
            });
            await page.keyboard.down('ArrowDown');
            await page.evaluate(() => step(1.0));
            expect(await page.evaluate(() => player.y)).toBeLessThan(32 * 9 + 16);
        });

        test('the base cannot be driven over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                setTile(7, 12, T_EMPTY);
                setTile(7, 13, T_EMPTY);
                player.x = 32 * 7 + 16;
                player.y = 32 * 12 + 16;
            });
            await page.keyboard.down('ArrowDown');
            await page.evaluate(() => step(1.5));
            expect(await page.evaluate(() => player.y)).toBeLessThan(32 * 14);
        });

        test('turning snaps the tank onto the perpendicular lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 7; // off-centre horizontally
                player.y = 32 * 10 + 16;
                player.dir = 'right';
            });
            await page.keyboard.down('ArrowUp');
            await page.evaluate(() => step(0.05));
            expect(await page.evaluate(() => player.x)).toBeCloseTo(32 * 4 + 16, 5);
        });
    });

    // -----------------------------------------------------------------------
    // Firing
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('Space fires a shell while running', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            const b = await page.evaluate(() => bullets.map((b) => ({ owner: b.owner, dir: b.dir })));
            expect(b.length).toBe(1);
            expect(b[0].owner).toBe('player');
        });

        test('the shell travels in the tank facing direction', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.dir = 'up'; fire(player); });
            const y0 = await page.evaluate(() => bullets[0].y);
            await page.evaluate(() => step(0.1));
            expect(await page.evaluate(() => bullets[0].y)).toBeLessThan(y0);
        });

        test('only one player shell can be in flight', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.dir = 'up'; fire(player); fire(player); fire(player); });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('a shell destroys a brick and is consumed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                player.dir = 'up';
                setTile(4, 6, T_BRICK);
                fire(player);
            });
            await page.evaluate(() => step(0.4));
            expect(await page.evaluate(() => tileAt(4, 6))).toBe(await page.evaluate(() => T_EMPTY));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shell is stopped by steel without destroying it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                player.dir = 'up';
                setTile(4, 6, T_STEEL);
                fire(player);
            });
            await page.evaluate(() => step(0.4));
            expect(await page.evaluate(() => tileAt(4, 6))).toBe(await page.evaluate(() => T_STEEL));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a shell that reaches the edge disappears', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let cy = 0; cy < 15; cy++) setTile(4, cy, T_EMPTY);
                player.x = 32 * 4 + 16;
                player.y = 32 * 12 + 16;
                player.dir = 'up';
                fire(player);
            });
            await page.evaluate(() => step(3));
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Combat
    // -----------------------------------------------------------------------
    test.describe('combat', () => {
        test('a player shell destroys an enemy and scores points', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => enemiesLeft);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                player.dir = 'up';
                for (let cy = 0; cy < 15; cy++) setTile(4, cy, T_EMPTY);
                spawnEnemy({ cx: 4, cy: 6 });
                fire(player);
            });
            await page.evaluate(() => step(0.5));
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => enemiesLeft)).toBe(before - 1);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('scoring a kill awards pointsPerKill', async ({ page }) => {
            await startQuiet(page);
            const pts = await page.evaluate(() => {
                enemiesLeft = 5;
                const e = spawnEnemy({ cx: 4, cy: 6 });
                const p = pointsPerKill();
                killEnemy(e);
                return { p, score };
            });
            expect(pts.score).toBe(pts.p);
        });

        test('an enemy shell destroys the player and costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                player.invuln = 0;
                for (let cy = 0; cy < 15; cy++) setTile(4, cy, T_EMPTY);
                const e = spawnEnemy({ cx: 4, cy: 5 });
                e.dir = 'down';
                fire(e);
            });
            await page.evaluate(() => step(0.6));
            expect(await page.evaluate(() => player.alive)).toBe(false);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the player respawns after a short delay with brief invulnerability', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => killPlayer());
            expect(await page.evaluate(() => player.alive)).toBe(false);
            await page.evaluate(() => step(2.0));
            expect(await page.evaluate(() => player.alive)).toBe(true);
            expect(await page.evaluate(() => player.invuln)).toBeGreaterThan(0);
            expect(await page.evaluate(() => player.x)).toBeCloseTo(4 * 32 + 16, 5);
        });

        test('an invulnerable player shrugs off a shell', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.x = 32 * 4 + 16;
                player.y = 32 * 8 + 16;
                player.invuln = 5;
                spawnBullet({ x: player.x, y: player.y - 20, dir: 'down', owner: 'enemy' });
            });
            await page.evaluate(() => step(0.3));
            expect(await page.evaluate(() => player.alive)).toBe(true);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('friendly fire is off — enemy shells pass through enemies', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let cy = 0; cy < 15; cy++) setTile(4, cy, T_EMPTY);
                spawnEnemy({ cx: 4, cy: 8 });
                spawnBullet({ x: 32 * 4 + 16, y: 32 * 6 + 16, dir: 'down', owner: 'enemy' });
            });
            await page.evaluate(() => step(0.4));
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('a shell that hits the base ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                setTile(7, 12, T_EMPTY);
                setTile(7, 13, T_EMPTY);
                spawnBullet({ x: 32 * 7 + 16, y: 32 * 12 + 16, dir: 'down', owner: 'enemy' });
            });
            await page.evaluate(() => step(0.5));
            expect(await page.evaluate(() => base.alive)).toBe(false);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { killPlayer(); killPlayer(); killPlayer(); });
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 900; killPlayer(); killPlayer(); killPlayer(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('900');
        });

        test('the best score is persisted after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 1500; killPlayer(); killPlayer(); killPlayer(); });
            await expect(page.locator('#best')).toHaveText('1500');
            expect(await page.evaluate(() => localStorage.getItem('tankbattle-best'))).toBe('1500');
        });
    });

    // -----------------------------------------------------------------------
    // Levels and spawning
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('destroying every enemy advances to the next level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                enemiesLeft = 1;
                const e = spawnEnemy({ cx: 4, cy: 4 });
                killEnemy(e);
            });
            expect(await page.evaluate(() => level)).toBe(2);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('a new level restocks enemies and rebuilds the battlefield', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                enemiesLeft = 1;
                killEnemy(spawnEnemy({ cx: 4, cy: 4 }));
            });
            const info = await page.evaluate(() => ({
                left: enemiesLeft,
                toSpawn: enemiesToSpawn,
                forLevel: enemiesForLevel(),
                bullets: bullets.length,
                fort: tileAt(7, 13),
            }));
            expect(info.left).toBe(info.forLevel);
            expect(info.toSpawn).toBe(info.forLevel);
            expect(info.bullets).toBe(0);
            expect(info.fort).toBe(await page.evaluate(() => T_BRICK));
        });

        test('later levels are harder', async ({ page }) => {
            const harder = await page.evaluate(() => {
                startGame();
                const l1 = { n: enemiesForLevel(), s: enemySpeed(), p: pointsPerKill() };
                level = 4;
                const l4 = { n: enemiesForLevel(), s: enemySpeed(), p: pointsPerKill() };
                return { l1, l4 };
            });
            expect(harder.l4.n).toBeGreaterThan(harder.l1.n);
            expect(harder.l4.s).toBeGreaterThan(harder.l1.s);
            expect(harder.l4.p).toBeGreaterThan(harder.l1.p);
        });

        test('the same level always builds the same battlefield', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                buildLevel(3);
                const a = JSON.stringify(grid);
                buildLevel(3);
                const b = JSON.stringify(grid);
                buildLevel(4);
                const c = JSON.stringify(grid);
                return { equal: a === b, different: a !== c };
            });
            expect(same.equal).toBe(true);
            expect(same.different).toBe(true);
        });

        test('every level leaves open lanes so the map is navigable', async ({ page }) => {
            const clear = await page.evaluate(() => {
                startGame();
                for (let lv = 1; lv <= 6; lv++) {
                    buildLevel(lv);
                    for (let cy = 0; cy < ROWS; cy++) {
                        if (tileAt(0, cy) !== T_EMPTY) return false;   // left lane
                        if (tileAt(14, cy) !== T_EMPTY) return false;  // right lane
                    }
                }
                return true;
            });
            expect(clear).toBe(true);
        });
    });

    test.describe('enemy spawning', () => {
        test('enemies roll onto the field over time', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => step(6));
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('no more than maxActive enemies are on the field at once', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => step(20));
            const info = await page.evaluate(() => ({ n: enemies.length, max: maxActive() }));
            expect(info.n).toBeLessThanOrEqual(info.max);
        });

        test('spawning stops once the level quota is used up', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { enemiesToSpawn = 0; spawnTimer = 0; });
            await page.evaluate(() => step(10));
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('enemies shoot back', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                // an even column / odd row is always an open lane, so the shell
                // has clear air whichever way the AI turns first
                const e = spawnEnemy({ cx: 6, cy: 3 });
                e.fireTimer = 0;
            });
            await page.evaluate(() => step(0.2));
            expect(await page.evaluate(() => bullets.filter((b) => b.owner === 'enemy').length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause and restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay reports the paused state', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('a paused game does not advance', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { player.x = 32 * 4 + 16; player.y = 32 * 8 + 16; });
            await page.keyboard.press('p');
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => step(1));
            expect(await page.evaluate(() => player.x)).toBeCloseTo(32 * 4 + 16, 5);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 700; killPlayer(); killPlayer(); killPlayer(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas paints something after starting', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => step(0.2));
            const painted = await page.evaluate(() => {
                draw();
                const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.evaluate(() => step(5));
            expect(errors).toEqual([]);
        });
    });
});
