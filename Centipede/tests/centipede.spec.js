const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Centipede', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Centipede', async ({ page }) => {
            await expect(page).toHaveTitle('Centipede');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Space');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 500×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('grid constants are exposed', async ({ page }) => {
            const dims = await page.evaluate(() => ({ cols: COLS, rows: ROWS, cell: CELL }));
            expect(dims.cols * dims.cell).toBe(500);
            expect(dims.rows * dims.cell).toBe(600);
        });

        test('player zone is the bottom rows', async ({ page }) => {
            const zone = await page.evaluate(() => ({ top: PLAYER_TOP, rows: ROWS }));
            expect(zone.top).toBeGreaterThan(0);
            expect(zone.top).toBeLessThan(zone.rows);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses overlay and starts', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('a move key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('shooter starts in the player zone', async ({ page }) => {
            await page.keyboard.press('Space');
            const p = await page.evaluate(() => ({ ...player }));
            const top = await page.evaluate(() => PLAYER_TOP);
            expect(p.y).toBeGreaterThanOrEqual(top);
        });

        test('centipede spawns with several segments', async ({ page }) => {
            await page.keyboard.press('Space');
            const len = await page.evaluate(() => centipede.length);
            expect(len).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Shooter movement
    // -----------------------------------------------------------------------
    test.describe('shooter movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('ArrowRight moves the shooter right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('ArrowLeft moves the shooter left', async ({ page }) => {
            await page.evaluate(() => { player.x = 12; });
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => player.x);
            expect(after).toBe(11);
        });

        test('D key (WASD) moves the shooter right', async ({ page }) => {
            const before = await page.evaluate(() => player.x);
            await page.keyboard.press('d');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('shooter cannot move past the right edge', async ({ page }) => {
            await page.evaluate(() => { player.x = COLS - 1; });
            await page.keyboard.press('ArrowRight');
            const x = await page.evaluate(() => player.x);
            expect(x).toBe(await page.evaluate(() => COLS - 1));
        });

        test('shooter cannot move past the left edge', async ({ page }) => {
            await page.evaluate(() => { player.x = 0; });
            await page.keyboard.press('ArrowLeft');
            const x = await page.evaluate(() => player.x);
            expect(x).toBe(0);
        });

        test('shooter cannot leave the player zone going up', async ({ page }) => {
            await page.evaluate(() => { player.y = PLAYER_TOP; });
            await page.keyboard.press('ArrowUp');
            const y = await page.evaluate(() => player.y);
            expect(y).toBe(await page.evaluate(() => PLAYER_TOP));
        });

        test('shooter cannot move below the bottom row', async ({ page }) => {
            await page.evaluate(() => { player.y = ROWS - 1; });
            await page.keyboard.press('ArrowDown');
            const y = await page.evaluate(() => player.y);
            expect(y).toBe(await page.evaluate(() => ROWS - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space'); // start
        });

        test('Space fires a bullet', async ({ page }) => {
            // Clear the field so the bullet doesn't immediately hit anything
            await page.evaluate(() => { centipede = []; clearMushrooms(); });
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => bullets.length);
            expect(n).toBe(1);
        });

        test('a fired bullet travels upward', async ({ page }) => {
            await page.evaluate(() => { centipede = []; clearMushrooms(); });
            await page.keyboard.press('Space');
            const y0 = await page.evaluate(() => bullets[0].y);
            await page.waitForTimeout(250);
            const later = await page.evaluate(() => (bullets[0] ? bullets[0].y : -999));
            expect(later).toBeLessThan(y0);
        });

        test('only one bullet is on screen at a time', async ({ page }) => {
            await page.evaluate(() => { centipede = []; clearMushrooms(); });
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => bullets.length);
            expect(n).toBeLessThanOrEqual(1);
        });

        test('a bullet chips a mushroom and dies', async ({ page }) => {
            await page.evaluate(() => {
                centipede = [];
                clearMushrooms();
                // full-health mushroom directly above the shooter
                mushrooms[player.y - 2][player.x] = 4;
            });
            const hp0 = await page.evaluate(() => mushrooms[player.y - 2][player.x]);
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            const hp1 = await page.evaluate(() => mushrooms[player.y - 2][player.x]);
            const nb = await page.evaluate(() => bullets.length);
            expect(hp1).toBe(hp0 - 1);
            expect(nb).toBe(0);
        });

        test('destroying a mushroom scores 1 point', async ({ page }) => {
            await page.evaluate(() => {
                centipede = [];
                clearMushrooms();
                mushrooms[player.y - 2][player.x] = 1; // one hit left
            });
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            const gone = await page.evaluate(() => mushrooms[player.y - 2][player.x]);
            const score = parseInt(await page.locator('#score').textContent(), 10);
            expect(gone).toBe(0);
            expect(score).toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Centipede behaviour
    // -----------------------------------------------------------------------
    test.describe('centipede', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the centipede advances horizontally over time', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                centipede = [{ x: 5, y: 2, dir: 1 }];
            });
            const x0 = await page.evaluate(() => centipede[0].x);
            await page.waitForTimeout(400);
            const x1 = await page.evaluate(() => centipede[0].x);
            expect(x1).not.toBe(x0);
        });

        test('the centipede reverses and drops at a wall', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                centipede = [{ x: COLS - 1, y: 2, dir: 1 }];
            });
            await page.waitForTimeout(400);
            const seg = await page.evaluate(() => ({ ...centipede[0] }));
            expect(seg.y).toBeGreaterThan(2); // dropped a row
            expect(seg.dir).toBe(-1);          // reversed
        });

        test('the centipede drops and reverses at a mushroom', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                centipede = [{ x: 5, y: 2, dir: 1 }];
                mushrooms[2][6] = 4; // block the cell to the right
            });
            await page.waitForTimeout(400);
            const seg = await page.evaluate(() => ({ ...centipede[0] }));
            expect(seg.dir).toBe(-1);
            expect(seg.y).toBeGreaterThan(2);
        });

        test('shooting a segment removes it and scores 10', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                bullets = [];
                // Target segment directly above the shooter, plus a decoy far away
                // so clearing the target doesn't trigger a wave respawn.
                centipede = [
                    { x: player.x, y: player.y - 2, dir: 1 },
                    { x: 0, y: 1, dir: 1 },
                ];
            });
            const before = parseInt(await page.locator('#score').textContent(), 10);
            const len0 = await page.evaluate(() => centipede.length);
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            const len = await page.evaluate(() => centipede.length);
            const after = parseInt(await page.locator('#score').textContent(), 10);
            expect(len).toBe(len0 - 1); // exactly the target segment was removed
            expect(after).toBeGreaterThanOrEqual(before + 10);
        });

        test('a destroyed segment leaves a mushroom behind', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                bullets = [];
                centipede = [{ x: player.x, y: player.y - 2, dir: 1 }];
            });
            await page.keyboard.press('Space');
            await page.waitForTimeout(300);
            // a mushroom now exists somewhere in the column near where it died
            const total = await page.evaluate(() => {
                let t = 0;
                for (let y = 0; y < ROWS; y++)
                    for (let x = 0; x < COLS; x++)
                        if (mushrooms[y][x] > 0) t++;
                return t;
            });
            expect(total).toBeGreaterThanOrEqual(1);
        });

        test('clearing the centipede advances to the next level', async ({ page }) => {
            const lvl0 = await page.evaluate(() => level);
            await page.evaluate(() => {
                clearMushrooms();
                bullets = [];
                centipede = [{ x: player.x, y: player.y - 2, dir: 1 }];
            });
            await page.keyboard.press('Space');
            await page.waitForTimeout(400);
            const lvl1 = await page.evaluate(() => level);
            const len = await page.evaluate(() => centipede.length);
            expect(lvl1).toBe(lvl0 + 1);
            expect(len).toBeGreaterThan(0); // a fresh centipede spawned
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a segment reaching the shooter costs a life', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                bullets = [];
                // segment one cell to the left of the shooter, moving right into it
                centipede = [{ x: player.x - 1, y: player.y, dir: 1 }];
            });
            const lives0 = await page.evaluate(() => lives);
            await page.waitForTimeout(400);
            const lives1 = await page.evaluate(() => lives);
            expect(lives1).toBe(lives0 - 1);
        });

        test('game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                bullets = [];
                lives = 1;
                livesEl.textContent = lives;
                centipede = [{ x: player.x - 1, y: player.y, dir: 1 }];
            });
            await page.waitForTimeout(400);
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting after game over resets score to 0', async ({ page }) => {
            await page.evaluate(() => { score = 10; scoreEl.textContent = score; endGame(); });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('pause overlay shows Paused', async ({ page }) => {
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the centipede does not move while paused', async ({ page }) => {
            await page.evaluate(() => {
                clearMushrooms();
                centipede = [{ x: 5, y: 2, dir: 1 }];
            });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ ...centipede[0] }));
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => ({ ...centipede[0] }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best updates on game over when score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 42; scoreEl.textContent = score; endGame(); });
            await expect(page.locator('#best')).toHaveText('42');
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 55; scoreEl.textContent = score; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('centipede-best'));
            expect(parseInt(stored, 10)).toBe(55);
        });
    });
});
