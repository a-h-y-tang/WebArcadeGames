const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start the game and clear the board to a known-empty sandbox so movement,
// digging, harpoon, rock and monster tests can set up exactly the cells they
// need without interference from the generated level.
async function startSandbox(page) {
    await page.keyboard.press('Space');
    await page.evaluate(() => {
        enemies.length = 0;
        rocks.length = 0;
        // Dig out an open middle so helpers have room to work.
        player.r = 5;
        player.c = 5;
        player.dir = 'right';
    });
}

test.describe('Dig Dug', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Dig Dug', async ({ page }) => {
            await expect(page).toHaveTitle('Dig Dug');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas matches the grid size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '390');
            await expect(canvas).toHaveAttribute('height', '450');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the grid has ROWS rows and COLS columns', async ({ page }) => {
            const dims = await page.evaluate(() => ({ rows: grid.length, cols: grid[0].length }));
            expect(dims.rows).toBe(15);
            expect(dims.cols).toBe(13);
        });

        test('the player starts inside the grid', async ({ page }) => {
            const ok = await page.evaluate(
                () => player.r >= 0 && player.r < ROWS && player.c >= 0 && player.c < COLS
            );
            expect(ok).toBe(true);
        });

        test('monsters are generated', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBeGreaterThan(0);
        });

        test('the player starts with START_LIVES lives', async ({ page }) => {
            const res = await page.evaluate(() => ({ lives, start: START_LIVES }));
            expect(res.lives).toBe(res.start);
        });

        test('the level starts at 1', async ({ page }) => {
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('an arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Movement & digging
    // -----------------------------------------------------------------------
    test.describe('movement and digging', () => {
        test('moving into soil digs a tunnel', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                grid[5][5] = true;   // player's cell is a tunnel
                grid[6][5] = false;  // solid soil below
                const moved = movePlayer('down');
                return { moved, dug: isDug(6, 5), r: player.r, c: player.c };
            });
            expect(res.moved).toBe(true);
            expect(res.dug).toBe(true);
            expect(res.r).toBe(6);
            expect(res.c).toBe(5);
        });

        test('the player cannot move off the grid', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                player.r = 0;
                player.c = 5;
                const moved = movePlayer('up');
                return { moved, r: player.r };
            });
            expect(res.moved).toBe(false);
            expect(res.r).toBe(0);
        });

        test('the player cannot move into a rock', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                rocks.push({ r: 5, c: 6, falling: false, fallAccum: 0, fell: false });
                const moved = movePlayer('right');
                return { moved, c: player.c };
            });
            expect(res.moved).toBe(false);
            expect(res.c).toBe(5);
        });

        test('moving updates the facing direction', async ({ page }) => {
            await startSandbox(page);
            const dir = await page.evaluate(() => {
                movePlayer('left');
                return player.dir;
            });
            expect(dir).toBe('left');
        });

        test('a held direction key moves the player over time', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                player.r = 5;
                player.c = 5;
                // Simulate the down direction being held, then advance the clock.
                keys['down'] = true;
                const before = player.r;
                step(PLAYER_STEP_MS + 5);
                keys['down'] = false;
                return { before, after: player.r };
            });
            expect(res.after).toBeGreaterThan(res.before);
        });
    });

    // -----------------------------------------------------------------------
    // Harpoon
    // -----------------------------------------------------------------------
    test.describe('harpoon', () => {
        test('pumping a monster in range inflates it', async ({ page }) => {
            await startSandbox(page);
            const inflate = await page.evaluate(() => {
                grid[5][6] = true; // tunnel between player and monster
                player.dir = 'right';
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                pump();
                return enemies[0].inflate;
            });
            expect(inflate).toBe(1);
        });

        test('enough pumps pop the monster and score points', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                grid[5][6] = true;
                player.dir = 'right';
                // A second, distant monster so popping the first is not a level clear.
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                enemies.push({ r: 0, c: 0, inflate: 0, spawnR: 0, spawnC: 0, ghostTimer: 0, lastPump: 0 });
                const before = { n: enemies.length, s: score };
                for (let i = 0; i < INFLATE_MAX; i++) pump();
                return { beforeN: before.n, afterN: enemies.length, beforeS: before.s, afterS: score };
            });
            expect(res.afterN).toBe(res.beforeN - 1);
            expect(res.afterS).toBeGreaterThan(res.beforeS);
        });

        test('the harpoon does not reach beyond its range', async ({ page }) => {
            await startSandbox(page);
            const inflate = await page.evaluate(() => {
                player.dir = 'right';
                // Open a long tunnel to the right.
                for (let c = 6; c < COLS; c++) grid[5][c] = true;
                enemies.push({
                    r: 5, c: 5 + HARPOON_RANGE + 1, inflate: 0,
                    spawnR: 5, spawnC: 5 + HARPOON_RANGE + 1, ghostTimer: 0, lastPump: 0,
                });
                pump();
                return enemies[0].inflate;
            });
            expect(inflate).toBe(0);
        });

        test('the harpoon cannot pass through soil', async ({ page }) => {
            await startSandbox(page);
            const inflate = await page.evaluate(() => {
                player.dir = 'right';
                grid[5][6] = false; // soil blocks the line
                grid[5][7] = true;
                enemies.push({ r: 5, c: 7, inflate: 0, spawnR: 5, spawnC: 7, ghostTimer: 0, lastPump: 0 });
                pump();
                return enemies[0].inflate;
            });
            expect(inflate).toBe(0);
        });

        test('an inflating monster does not move', async ({ page }) => {
            await startSandbox(page);
            const moved = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) grid[5][c] = true; // full corridor
                player.dir = 'right';
                const e = { r: 5, c: 6, inflate: 1, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 };
                enemies.push(e);
                const before = e.c;
                stepEnemies(ENEMY_STEP_MS + 5);
                return e.c !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Monsters
    // -----------------------------------------------------------------------
    test.describe('monsters', () => {
        test('a monster chases the player along a tunnel', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) grid[5][c] = true; // straight corridor
                player.r = 5;
                player.c = 1;
                const e = { r: 5, c: 10, inflate: 0, spawnR: 5, spawnC: 10, ghostTimer: 0, lastPump: 0 };
                enemies.push(e);
                const before = e.c;
                stepEnemies(ENEMY_STEP_MS + 5);
                return { before, after: e.c };
            });
            expect(res.after).toBeLessThan(res.before);
        });

        test('a monster catching the player costs a life', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) grid[5][c] = true;
                player.r = 5;
                player.c = 5;
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                const before = lives;
                stepEnemies(ENEMY_STEP_MS + 5);
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Falling rocks
    // -----------------------------------------------------------------------
    test.describe('falling rocks', () => {
        test('a rock falls when the ground below is dug away', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                const rock = { r: 5, c: 5, falling: false, fallAccum: 0, fell: false };
                rocks.push(rock);
                grid[6][5] = true; // tunnel below → unsupported
                stepRocks(ROCK_FALL_MS + 1);
                return rock.r;
            });
            expect(res).toBe(6);
        });

        test('a rock does not fall while supported by soil', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                const rock = { r: 5, c: 5, falling: false, fallAccum: 0, fell: false };
                rocks.push(rock);
                grid[6][5] = false; // solid soil below
                stepRocks(ROCK_FALL_MS * 5);
                return { r: rock.r, falling: rock.falling };
            });
            expect(res.r).toBe(5);
            expect(res.falling).toBe(false);
        });

        test('a falling rock crushes a monster', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                const rock = { r: 5, c: 5, falling: false, fallAccum: 0, fell: false };
                rocks.push(rock);
                grid[6][5] = true;
                enemies.push({ r: 6, c: 5, inflate: 0, spawnR: 6, spawnC: 5, ghostTimer: 0, lastPump: 0 });
                // keep another far enemy so this isn't a level clear
                enemies.push({ r: 0, c: 0, inflate: 0, spawnR: 0, spawnC: 0, ghostTimer: 0, lastPump: 0 });
                const before = { n: enemies.length, s: score };
                stepRocks(ROCK_FALL_MS + 1);
                return { beforeN: before.n, afterN: enemies.length, beforeS: before.s, afterS: score };
            });
            expect(res.afterN).toBe(res.beforeN - 1);
            expect(res.afterS).toBeGreaterThan(res.beforeS);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every monster advances to the next level', async ({ page }) => {
            await startSandbox(page);
            const res = await page.evaluate(() => {
                grid[5][6] = true;
                player.dir = 'right';
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                const before = level;
                for (let i = 0; i < INFLATE_MAX; i++) pump();
                return { before, after: level, enemies: enemies.length };
            });
            expect(res.after).toBe(res.before + 1);
            expect(res.enemies).toBeGreaterThan(0); // new level repopulated
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing the last life ends the game', async ({ page }) => {
            await startSandbox(page);
            const s = await page.evaluate(() => {
                lives = 1;
                for (let c = 0; c < COLS; c++) grid[5][c] = true;
                player.r = 5;
                player.c = 5;
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                stepEnemies(ENEMY_STEP_MS + 5);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 42; endGame(); });
            await expect(page.locator('#overlay-score')).toContainText('42');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 99;
                lives = 1;
                level = 4;
                endGame();
            });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ score, lives, level, state }));
            expect(res.score).toBe(0);
            expect(res.lives).toBe(await page.evaluate(() => START_LIVES));
            expect(res.level).toBe(1);
            expect(res.state).toBe('running');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 500; endGame(); });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(500);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 700; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('digdug-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(700);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the world does not advance while paused', async ({ page }) => {
            await startSandbox(page);
            await page.keyboard.press('p');
            const res = await page.evaluate(() => {
                for (let c = 0; c < COLS; c++) grid[5][c] = true;
                enemies.push({ r: 5, c: 8, inflate: 0, spawnR: 5, spawnC: 8, ghostTimer: 0, lastPump: 0 });
                const before = enemies[0].c;
                step(ENEMY_STEP_MS * 3);
                return { before, after: enemies[0].c };
            });
            expect(res.after).toBe(res.before);
        });

        test('pumping does nothing while paused', async ({ page }) => {
            await startSandbox(page);
            await page.keyboard.press('p');
            const inflate = await page.evaluate(() => {
                grid[5][6] = true;
                player.dir = 'right';
                enemies.push({ r: 5, c: 6, inflate: 0, spawnR: 5, spawnC: 6, ghostTimer: 0, lastPump: 0 });
                pump();
                return enemies[0].inflate;
            });
            expect(inflate).toBe(0);
        });
    });
});
