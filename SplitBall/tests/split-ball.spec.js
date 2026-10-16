const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with time and the ball set under the spec's control: the rAF
// loop stops advancing the simulation and the randomly placed balls are
// cleared, so each spec places exactly the balls it cares about.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        balls.length = 0;
    });

// A ball parked in the middle of a cell with no velocity. Used to keep a region
// occupied (so it is not captured) without introducing any timing dependence.
const parkBall = (page, col, row) =>
    page.evaluate(([c, r]) => addBall((c + 0.5) * TILE, (r + 0.5) * TILE, 0, 0), [col, row]);

const cell = (page, col, row) => page.evaluate(([c, r]) => grid[r][c], [col, row]);

// Canvas-relative page coordinates for the centre of a cell, honouring any CSS
// scaling of the canvas.
const cellPoint = async (page, col, row) => {
    const box = await page.locator('#canvas').boundingBox();
    const tile = await page.evaluate(() => TILE);
    const scale = box.width / (await page.evaluate(() => COLS * TILE));
    return { x: box.x + (col + 0.5) * tile * scale, y: box.y + (row + 0.5) * tile * scale };
};

test.describe('Split Ball', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Split Ball', async ({ page }) => {
            await expect(page).toHaveTitle('Split Ball');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the grid size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [COLS, ROWS, TILE])).toEqual([30, 20, 24]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level, lives and fill', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#filled')).toHaveText('0%');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('splitball-best', '4100'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4100');
        });

        test('no balls before starting', async ({ page }) => {
            expect(await page.evaluate(() => balls.length)).toBe(0);
        });

        test('the border is solid and the interior is open', async ({ page }) => {
            const probe = await page.evaluate(() => ({
                topLeft: grid[0][0],
                topMiddle: grid[0][15],
                bottomMiddle: grid[ROWS - 1][15],
                leftMiddle: grid[10][0],
                rightMiddle: grid[10][COLS - 1],
                interior: grid[10][15],
            }));
            expect(probe).toEqual({
                topLeft: 1,
                topMiddle: 1,
                bottomMiddle: 1,
                leftMiddle: 1,
                rightMiddle: 1,
                interior: 0,
            });
        });

        test('the interior is 504 cells and starts 0% filled', async ({ page }) => {
            expect(await page.evaluate(() => INTERIOR_CELLS)).toBe(504);
            expect(await page.evaluate(() => percentFilled())).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                addBall(200, 200, 120, 120);
                const { x, y } = balls[0];
                for (let i = 0; i < 30; i++) step(1 / 60);
                return balls[0].x !== x || balls[0].y !== y;
            });
            expect(moved).toBe(false);
        });

        test('no wall can be built while idle', async ({ page }) => {
            expect(await page.evaluate(() => buildWall(15, 10))).toBe(false);
            expect(await page.evaluate(() => wall)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('startGame() moves to the playing state', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('level 1 starts with two balls', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => balls.length)).toBe(2);
        });

        test('score, level and lives are reset on start', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                level = 5;
                lives = 1;
                startGame();
            });
            expect(await page.evaluate(() => [score, level, lives])).toEqual([0, 1, 3]);
        });

        test('the overlay hides once the game starts', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('balls spawn inside the open interior, moving diagonally', async ({ page }) => {
            await page.evaluate(() => startGame());
            const ok = await page.evaluate(() =>
                balls.every((b) => {
                    const c = Math.floor(b.x / TILE);
                    const r = Math.floor(b.y / TILE);
                    return grid[r][c] === 0 && Math.abs(b.vx) > 0 && Math.abs(b.vy) > 0;
                })
            );
            expect(ok).toBe(true);
        });

        test('a fresh game is 0% filled', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => percentFilled())).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Ball physics
    // -----------------------------------------------------------------------
    test.describe('balls', () => {
        test('a ball travels at its velocity', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall(360, 240, 120, 0));
            await advance(page, 30);
            const b = await page.evaluate(() => ({ x: balls[0].x, y: balls[0].y }));
            expect(b.x).toBeCloseTo(360 + 60, 1);
            expect(b.y).toBeCloseTo(240, 5);
        });

        test('a ball bounces off the right wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall((COLS - 2) * TILE, 240, 180, 0));
            await advance(page, 60);
            const b = await page.evaluate(() => ({ x: balls[0].x, vx: balls[0].vx }));
            expect(b.vx).toBeLessThan(0);
            expect(b.x).toBeLessThan(29 * 24); // still inside the right border
        });

        test('a ball bounces off the top wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall(360, 2 * TILE, 0, -180));
            await advance(page, 60);
            const b = await page.evaluate(() => ({ y: balls[0].y, vy: balls[0].vy }));
            expect(b.vy).toBeGreaterThan(0);
            expect(b.y).toBeGreaterThan(24); // back below the top border
        });

        test('a corner hit reverses both axes', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall(2 * TILE, 2 * TILE, -150, -150));
            await advance(page, 60);
            expect(await page.evaluate(() => [balls[0].vx > 0, balls[0].vy > 0])).toEqual([
                true,
                true,
            ]);
        });

        test('bouncing preserves speed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall(100, 100, -140, -140));
            const before = await page.evaluate(() => Math.hypot(balls[0].vx, balls[0].vy));
            await advance(page, 300);
            const after = await page.evaluate(() => Math.hypot(balls[0].vx, balls[0].vy));
            expect(after).toBeCloseTo(before, 6);
        });

        test('balls never end a frame inside a solid cell', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            const escaped = await page.evaluate(() => {
                for (let i = 0; i < 1200; i++) {
                    step(1 / 60);
                    for (const b of balls) {
                        const c = Math.floor(b.x / TILE);
                        const r = Math.floor(b.y / TILE);
                        if (grid[r] === undefined || grid[r][c] !== 0) return true;
                    }
                }
                return false;
            });
            expect(escaped).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Building walls
    // -----------------------------------------------------------------------
    test.describe('walls', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
            // Park a ball in each half so no capture fires during these specs.
            await parkBall(page, 4, 10);
            await parkBall(page, 25, 10);
        });

        test('building marks the origin cell pending', async ({ page }) => {
            expect(await page.evaluate(() => buildWall(15, 10))).toBe(true);
            expect(await cell(page, 15, 10)).toBe(2);
        });

        test('a new wall is vertical by default', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 10));
            expect(await page.evaluate(() => wall.axis)).toBe('v');
        });

        test('only one wall can grow at a time', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 10));
            expect(await page.evaluate(() => buildWall(12, 10))).toBe(false);
            expect(await cell(page, 12, 10)).toBe(0);
        });

        test('a wall cannot start on a solid cell', async ({ page }) => {
            expect(await page.evaluate(() => buildWall(0, 0))).toBe(false);
            expect(await page.evaluate(() => wall)).toBeNull();
        });

        test('a wall grows in both directions', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 12);
            const pending = await page.evaluate(() => {
                let above = 0;
                let below = 0;
                for (let r = 0; r < ROWS; r++) {
                    if (grid[r][15] !== 2) continue;
                    if (r < 10) above++;
                    if (r > 10) below++;
                }
                return { above, below };
            });
            expect(pending.above).toBeGreaterThan(0);
            expect(pending.below).toBeGreaterThan(0);
        });

        test('growth is frame-rate independent', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 32, 1 / 64);
            const coarse = await page.evaluate(() => wall.cells.length);
            await page.evaluate(() => {
                wall = null;
                resetLevel();
                addBall((4 + 0.5) * TILE, (10 + 0.5) * TILE, 0, 0);
                addBall((25 + 0.5) * TILE, (10 + 0.5) * TILE, 0, 0);
                buildWall(15, 10);
            });
            await advance(page, 64, 1 / 128);
            expect(await page.evaluate(() => wall.cells.length)).toBe(coarse);
        });

        test('a completed vertical wall fills its whole column', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => wall)).toBeNull();
            const solid = await page.evaluate(() => {
                for (let r = 1; r < ROWS - 1; r++) if (grid[r][15] !== 1) return false;
                return true;
            });
            expect(solid).toBe(true);
        });

        test('a horizontal wall fills its whole row', async ({ page }) => {
            await page.evaluate(() => {
                // The inherited balls sit on row 10, which is the row this wall
                // grows along; park them clear of it.
                balls.length = 0;
                addBall(15.5 * TILE, 4.5 * TILE, 0, 0);
                addBall(15.5 * TILE, 16.5 * TILE, 0, 0);
                toggleOrientation();
                buildWall(15, 10);
            });
            expect(await page.evaluate(() => wall.axis)).toBe('h');
            await advance(page, 180);
            const solid = await page.evaluate(() => {
                for (let c = 1; c < COLS - 1; c++) if (grid[10][c] !== 1) return false;
                return true;
            });
            expect(solid).toBe(true);
        });

        test('a wall started against the border only grows one way', async ({ page }) => {
            await page.evaluate(() => buildWall(15, 1));
            await advance(page, 6);
            const above = await page.evaluate(() => grid[0][15]);
            expect(above).toBe(1);
            expect(await page.evaluate(() => wall.heads.filter((h) => h.blocked).length)).toBe(1);
        });

        test('a ball reaching the wall shatters it instead of bouncing', async ({ page }) => {
            await page.evaluate(() => {
                balls.length = 0;
                addBall(10 * TILE, 10.5 * TILE, 240, 0);
                buildWall(15, 10);
            });
            await advance(page, 40);
            expect(await page.evaluate(() => wall)).toBeNull();
            expect(await page.evaluate(() => lives)).toBe(2);
            // Not deflected: it keeps going and crosses the vacated column.
            expect(await page.evaluate(() => balls[0].vx)).toBeGreaterThan(0);
            expect(await page.evaluate(() => balls[0].x)).toBeGreaterThan(16 * 24);
        });
    });

    // -----------------------------------------------------------------------
    // Capturing territory
    // -----------------------------------------------------------------------
    test.describe('capture', () => {
        test('a sealed region with no ball is filled', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await cell(page, 20, 5)).toBe(1);
            expect(await cell(page, 4, 10)).toBe(0);
        });

        test('capturing raises the fill percentage', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            // Column 15 (18 cells) plus columns 16..28 (13 x 18 = 234) of 504.
            expect(await page.evaluate(() => percentFilled())).toBeCloseTo((252 / 504) * 100, 5);
        });

        test('capturing scores five points per cell', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => score)).toBe(234 * 5);
        });

        test('a region holding a ball is never captured', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await parkBall(page, 25, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await cell(page, 20, 5)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('a ball only overlapping the column by its edge still blocks it', async ({ page }) => {
            await startQuiet(page);
            // Centre sits in column 16; the 7 px radius reaches back into 15.
            await page.evaluate(() => addBall(16 * TILE + 3, 10.5 * TILE, 0, 0));
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => wall)).toBeNull();
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await cell(page, 20, 5)).toBe(0);
            expect(await cell(page, 4, 4)).toBe(0);
        });

        test('captured cells are flagged for the renderer', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => captured[5][20])).toBe(true);
            expect(await page.evaluate(() => captured[5][15])).toBe(false);
        });

        test('the HUD shows the new fill percentage and score', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            await expect(page.locator('#filled')).toHaveText('50%');
            await expect(page.locator('#score')).toHaveText('1170');
        });
    });

    // -----------------------------------------------------------------------
    // Losing a wall, and a life
    // -----------------------------------------------------------------------
    test.describe('hitting a growing wall', () => {
        test('a ball in the wall’s path destroys it', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 15, 14);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => wall)).toBeNull();
            expect(await cell(page, 15, 10)).toBe(0);
            expect(await cell(page, 15, 12)).toBe(0);
        });

        test('losing a wall costs a life', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 15, 14);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('territory already captured survives a lost wall', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 180);
            const filled = await page.evaluate(() => percentFilled());
            await page.evaluate(() => {
                addBall((8 + 0.5) * TILE, (14 + 0.5) * TILE, 0, 0);
                buildWall(8, 10);
            });
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => percentFilled())).toBeCloseTo(filled, 5);
        });

        test('the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addBall((15 + 0.5) * TILE, (14 + 0.5) * TILE, 0, 0);
                buildWall(15, 10);
            });
            await advance(page, 180);
            expect(await page.evaluate(() => [state, lives])).toEqual(['over', 0]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText(/game over/i);
        });

        test('game over records a new best score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                score = 7200;
                addBall((15 + 0.5) * TILE, (14 + 0.5) * TILE, 0, 0);
                buildWall(15, 10);
            });
            await advance(page, 180);
            expect(await page.evaluate(() => window.localStorage.getItem('splitball-best'))).toBe(
                '7200'
            );
            await expect(page.locator('#best')).toHaveText('7200');
        });

        test('Space restarts after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                addBall((15 + 0.5) * TILE, (14 + 0.5) * TILE, 0, 0);
                buildWall(15, 10);
            });
            await advance(page, 180);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives, score])).toEqual(['playing', 3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Clearing a level
    // -----------------------------------------------------------------------
    test.describe('level clear', () => {
        // Ball parked at column 2; a wall at column 8 seals columns 9..28,
        // which is 360 cells, plus the 18-cell wall: 378 / 504 = exactly 75%.
        const clearLevel = async (page) => {
            await startQuiet(page);
            await parkBall(page, 2, 10);
            await page.evaluate(() => buildWall(8, 10));
            await advance(page, 180);
        };

        test('reaching 75% clears the level', async ({ page }) => {
            await clearLevel(page);
            expect(await page.evaluate(() => percentFilled())).toBeGreaterThanOrEqual(75);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the overlay announces the cleared level', async ({ page }) => {
            await clearLevel(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText(/level 1 clear/i);
        });

        test('clearing awards a level bonus', async ({ page }) => {
            await clearLevel(page);
            expect(await page.evaluate(() => score)).toBe(360 * 5 + 250);
        });

        test('step() is inert while the level-clear overlay is up', async ({ page }) => {
            await clearLevel(page);
            const before = await page.evaluate(() => percentFilled());
            await advance(page, 60);
            expect(await page.evaluate(() => percentFilled())).toBe(before);
        });

        test('Space starts the next level with a fresh arena', async ({ page }) => {
            await clearLevel(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, level])).toEqual(['playing', 2]);
            expect(await page.evaluate(() => percentFilled())).toBe(0);
        });

        test('each level adds a ball and some speed', async ({ page }) => {
            await clearLevel(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => balls.length)).toBe(3);
            const speed = await page.evaluate(() => Math.hypot(balls[0].vx, balls[0].vy));
            expect(speed).toBeCloseTo(await page.evaluate(() => BALL_SPEED + 12), 5);
        });

        test('lives carry over to the next level', async ({ page }) => {
            await clearLevel(page);
            await page.evaluate(() => (lives = 2));
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses the game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toHaveText(/paused/i);
        });

        test('a paused game does not advance', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => addBall(360, 240, 150, 150));
            await page.keyboard.press('p');
            const before = await page.evaluate(() => [balls[0].x, balls[0].y]);
            await advance(page, 60);
            expect(await page.evaluate(() => [balls[0].x, balls[0].y])).toEqual(before);
        });

        test('P resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('pausing is ignored while idle', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no wall can be built while paused', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => buildWall(15, 10))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Feedback
    // -----------------------------------------------------------------------
    test.describe('feedback', () => {
        test('a shattered wall leaves a flash behind', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 15, 14);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 20);
            expect(await page.evaluate(() => wall)).toBeNull();
            expect(await page.evaluate(() => effects.length)).toBe(1);
            expect(await page.evaluate(() => effects[0].cells.length)).toBeGreaterThan(1);
        });

        test('the flash fades out', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 15, 14);
            await page.evaluate(() => buildWall(15, 10));
            await advance(page, 20);
            await advance(page, 60);
            expect(await page.evaluate(() => effects.length)).toBe(0);
        });

        test('the help line names the fill target', async ({ page }) => {
            await expect(page.locator('.help')).toContainText('75%');
        });

        test('autoplay runs without page errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(String(e)));
            page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
            await page.evaluate(() => startGame());
            // Let the real requestAnimationFrame loop run: this exercises draw(),
            // which the hand-stepped specs never assert on.
            await page.waitForTimeout(600);
            await page.evaluate(() => {
                buildWall(cursor.col, cursor.row);
            });
            await page.waitForTimeout(600);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('moving the mouse moves the aim cursor', async ({ page }) => {
            await startQuiet(page);
            const point = await cellPoint(page, 12, 7);
            await page.mouse.move(point.x, point.y);
            expect(await page.evaluate(() => [cursor.col, cursor.row])).toEqual([12, 7]);
        });

        test('clicking builds a wall at the cursor', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await parkBall(page, 25, 10);
            const point = await cellPoint(page, 12, 7);
            await page.mouse.click(point.x, point.y);
            expect(await page.evaluate(() => wall && wall.col)).toBe(12);
        });

        test('X toggles the wall orientation', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => orientation)).toBe('v');
            await page.keyboard.press('x');
            expect(await page.evaluate(() => orientation)).toBe('h');
            await page.keyboard.press('x');
            expect(await page.evaluate(() => orientation)).toBe('v');
        });

        test('right-clicking toggles the orientation without a context menu', async ({ page }) => {
            await startQuiet(page);
            const point = await cellPoint(page, 12, 7);
            await page.mouse.click(point.x, point.y, { button: 'right' });
            expect(await page.evaluate(() => orientation)).toBe('h');
            expect(await page.evaluate(() => wall)).toBeNull();
        });

        test('the arrow keys nudge the cursor one cell', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cursor.col = 10;
                cursor.row = 10;
            });
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => [cursor.col, cursor.row])).toEqual([11, 9]);
        });

        test('the cursor stays inside the interior', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                cursor.col = 1;
                cursor.row = 1;
            });
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => [cursor.col, cursor.row])).toEqual([1, 1]);
        });

        test.describe('touch', () => {
            test.use({ hasTouch: true });

            test('tapping builds a wall at the tapped cell', async ({ page }) => {
                await startQuiet(page);
                await parkBall(page, 4, 10);
                await parkBall(page, 25, 10);
                const point = await cellPoint(page, 12, 7);
                await page.touchscreen.tap(point.x, point.y);
                expect(await page.evaluate(() => wall && [wall.col, wall.row])).toEqual([12, 7]);
            });
        });

        test('Space builds a wall while playing', async ({ page }) => {
            await startQuiet(page);
            await parkBall(page, 4, 10);
            await parkBall(page, 25, 10);
            await page.evaluate(() => {
                cursor.col = 18;
                cursor.row = 6;
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => wall && wall.col)).toBe(18);
        });
    });
});
