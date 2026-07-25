const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Xonix', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // ---------------------------------------------------------------------
    // Initial state / UI
    // ---------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Xonix', async ({ page }) => {
            await expect(page).toHaveTitle('Xonix');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas is 600×450', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '450');
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#percent')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            expect(Number(await page.locator('#target').textContent())).toBe(75);
        });

        test('new game builds a bordered grid with a player on land', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
                playerTile: grid[player.y][player.x],
                LAND: TILE.LAND,
                enemyCount: enemies.length,
            }));
            expect(info.rows).toBe(30);
            expect(info.cols).toBe(40);
            expect(info.playerTile).toBe(info.LAND);
            expect(info.enemyCount).toBeGreaterThan(0);
        });

        test('the outer border is all land', async ({ page }) => {
            const allBorderLand = await page.evaluate(() => {
                const R = grid.length, C = grid[0].length;
                for (let x = 0; x < C; x++) if (grid[0][x] !== TILE.LAND || grid[R - 1][x] !== TILE.LAND) return false;
                for (let y = 0; y < R; y++) if (grid[y][0] !== TILE.LAND || grid[y][C - 1] !== TILE.LAND) return false;
                return true;
            });
            expect(allBorderLand).toBe(true);
        });

        test('state is ready before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });
    });

    // ---------------------------------------------------------------------
    // Starting
    // ---------------------------------------------------------------------
    test.describe('starting', () => {
        test('Start button runs the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a movement key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // ---------------------------------------------------------------------
    // Drawing a trail
    // ---------------------------------------------------------------------
    test.describe('drawing', () => {
        test('moving from land into the sea starts a trail', async ({ page }) => {
            const res = await page.evaluate(() => {
                loadMap([
                    '#P##',
                    '#..#',
                    '#..#',
                    '####',
                ].join('\n'));
                const moved = movePlayer(0, 1);
                return { moved, drawing, tile: grid[1][1], TRAIL: TILE.TRAIL, py: player.y };
            });
            expect(res.moved).toBe(true);
            expect(res.drawing).toBe(true);
            expect(res.tile).toBe(res.TRAIL);
            expect(res.py).toBe(1);
        });

        test('crossing your own trail costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                loadMap([
                    '#P##',
                    '#..#',
                    '#..#',
                    '####',
                ].join('\n'), { lives: 3 });
                movePlayer(0, 1); // (1,1) trail
                movePlayer(0, 1); // (1,2) trail
                const before = lives;
                movePlayer(0, -1); // back onto trail at (1,1) -> death
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });
    });

    // ---------------------------------------------------------------------
    // Capture (flood fill)
    // ---------------------------------------------------------------------
    test.describe('capture', () => {
        test('sealing a trail fills the enemy-free pocket', async ({ page }) => {
            const res = await page.evaluate(() => {
                loadMap([
                    '#######',
                    '#e.T..#',
                    '#..T..#',
                    '#..T..#',
                    '#######',
                ].join('\n'));
                sealTrail();
                const L = TILE.LAND, S = TILE.SEA;
                return {
                    trailNowLand: grid[1][3] === L,
                    rightCaptured: grid[1][4] === L && grid[2][5] === L,
                    leftStillSea: grid[1][1] === S && grid[2][2] === S,
                };
            });
            expect(res.trailNowLand).toBe(true);
            expect(res.rightCaptured).toBe(true);
            expect(res.leftStillSea).toBe(true);
        });

        test('capture increases the claimed percentage', async ({ page }) => {
            const pct = await page.evaluate(() => {
                loadMap([
                    '#######',
                    '#e.T..#',
                    '#..T..#',
                    '#..T..#',
                    '#######',
                ].join('\n'));
                sealTrail();
                return percent;
            });
            expect(pct).toBeGreaterThan(0);
        });

        test('reaching the target percentage wins', async ({ page }) => {
            const st = await page.evaluate(() => {
                // No enemy: the whole sea gets captured -> 100% -> win.
                loadMap([
                    '#####',
                    '#...#',
                    '#####',
                ].join('\n'));
                state = 'running';
                floodCapture();
                return state;
            });
            expect(st).toBe('won');
        });
    });

    // ---------------------------------------------------------------------
    // Enemies
    // ---------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy bounces off a wall', async ({ page }) => {
            const res = await page.evaluate(() => {
                loadMap([
                    '####',
                    '#.e#',
                    '#..#',
                    '####',
                ].join('\n'), { enemyVel: [1, 1] });
                enemyStep();
                const e = enemies[0];
                return { x: e.x, y: e.y, dx: e.dx, dy: e.dy };
            });
            // right wall reflects dx to -1; it moves down-left to (1,2)
            expect(res.dx).toBe(-1);
            expect(res.dy).toBe(1);
            expect(res.x).toBe(1);
            expect(res.y).toBe(2);
        });

        test('an enemy stays within the sea (never enters land)', async ({ page }) => {
            const ok = await page.evaluate(() => {
                loadMap([
                    '#####',
                    '#...#',
                    '#...#',
                    '#...#',
                    '#####',
                ].join('\n'), { enemyVel: [1, 1] });
                enemies.length = 0;
                enemies.push({ x: 2, y: 2, dx: 1, dy: 1 });
                for (let i = 0; i < 40; i++) {
                    enemyStep();
                    const e = enemies[0];
                    if (grid[e.y][e.x] === TILE.LAND) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('an enemy touching the trail costs a life', async ({ page }) => {
            const res = await page.evaluate(() => {
                loadMap([
                    '####',
                    '#T.#',
                    '#e.#',
                    '####',
                ].join('\n'), { lives: 3, enemyVel: [0, -1] });
                const before = lives;
                enemyStep(); // enemy moves up into the trail
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });
    });

    // ---------------------------------------------------------------------
    // Lives & game over
    // ---------------------------------------------------------------------
    test.describe('lives', () => {
        test('losing the last life ends the game', async ({ page }) => {
            const st = await page.evaluate(() => {
                loadMap([
                    '#P##',
                    '#..#',
                    '#..#',
                    '####',
                ].join('\n'), { lives: 1 });
                movePlayer(0, 1);
                movePlayer(0, 1);
                movePlayer(0, -1); // hit own trail with 1 life -> lost
                return state;
            });
            expect(st).toBe('lost');
        });

        test('losing a life clears the current trail', async ({ page }) => {
            const noTrail = await page.evaluate(() => {
                loadMap([
                    '#P##',
                    '#..#',
                    '#..#',
                    '####',
                ].join('\n'), { lives: 3 });
                movePlayer(0, 1);
                movePlayer(0, 1);
                movePlayer(0, -1); // death, trail reverts
                for (const row of grid) for (const c of row) if (c === TILE.TRAIL) return false;
                return true;
            });
            expect(noTrail).toBe(true);
        });
    });

    // ---------------------------------------------------------------------
    // Live controls
    // ---------------------------------------------------------------------
    test.describe('live controls', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('R restarts to a fresh game', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('r');
            const info = await page.evaluate(() => ({ state, lives, percent }));
            expect(info.state).toBe('running');
            expect(info.lives).toBe(3);
            expect(info.percent).toBe(0);
        });
    });
});
