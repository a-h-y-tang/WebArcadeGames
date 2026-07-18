const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Bomberman', () => {
    // Each Playwright test runs in an isolated browser context, so localStorage
    // starts empty and no manual clearing is needed.
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Bomberman', async ({ page }) => {
            await expect(page).toHaveTitle('Bomberman');
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

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 520x440 (13x11 tiles)', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid is built with a solid border and interior pillars', async ({ page }) => {
            const info = await page.evaluate(() => ({
                rows: grid.length,
                cols: grid[0].length,
                topLeftBorder: grid[0][0],
                pillar: grid[2][2],       // even row & even col = pillar
                bottomRight: grid[ROWS - 1][COLS - 1],
            }));
            expect(info.rows).toBe(11);
            expect(info.cols).toBe(13);
            expect(info.topLeftBorder).toBe('wall');
            expect(info.pillar).toBe('wall');
            expect(info.bottomRight).toBe('wall');
        });

        test('the player spawn corner is clear', async ({ page }) => {
            const info = await page.evaluate(() => ({
                col: player.col, row: player.row,
                here: grid[player.row][player.col],
                right: grid[1][2],
                down: grid[2][1],
            }));
            expect(info).toEqual({ col: 1, row: 1, here: 'empty', right: 'empty', down: 'empty' });
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('pressing Space starts the game', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pressing an arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('level 1 spawns 3 enemies', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => enemies.length)).toBe(3);
        });

        test('starting resets score, lives, level and player position', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return { score, lives, level, col: player.col, row: player.row,
                    range: player.range, maxBombs: player.maxBombs };
            });
            expect(info).toEqual({ score: 0, lives: 3, level: 1, col: 1, row: 1, range: 1, maxBombs: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moving right advances the player one tile', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                movePlayer(1, 0);
                return { col: player.col, row: player.row };
            });
            expect(info).toEqual({ col: 2, row: 1 });
        });

        test('moving down advances the player one tile', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                movePlayer(0, 1);
                return { col: player.col, row: player.row };
            });
            expect(info).toEqual({ col: 1, row: 2 });
        });

        test('cannot move into the border wall', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                movePlayer(-1, 0); // into (0,1) border
                movePlayer(0, -1); // into (1,0) border
                return { col: player.col, row: player.row };
            });
            expect(info).toEqual({ col: 1, row: 1 });
        });

        test('cannot move into a brick', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                grid[1][2] = 'brick'; // brick to the right of spawn
                movePlayer(1, 0);
                return { col: player.col, row: player.row };
            });
            expect(info).toEqual({ col: 1, row: 1 });
        });

        test('cannot move onto a bomb', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                placeBomb();          // bomb on (1,1)
                movePlayer(1, 0);     // step off to (2,1)
                movePlayer(-1, 0);    // try to move back onto the bomb
                return { col: player.col, row: player.row };
            });
            expect(info).toEqual({ col: 2, row: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Bombs & explosions
    // -----------------------------------------------------------------------
    test.describe('bombs', () => {
        test('placeBomb drops a bomb on the player tile', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                placeBomb();
                return { count: bombs.length, col: bombs[0].col, row: bombs[0].row };
            });
            expect(info).toEqual({ count: 1, col: 1, row: 1 });
        });

        test('only one bomb allowed by default (maxBombs = 1)', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                placeBomb();
                movePlayer(1, 0);
                placeBomb(); // over the limit
                return bombs.length;
            });
            expect(n).toBe(1);
        });

        test('cannot stack two bombs on the same tile', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                player.maxBombs = 3;
                placeBomb();
                placeBomb();
                return bombs.length;
            });
            expect(n).toBe(1);
        });

        test('bomb explodes after its fuse', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                placeBomb();
                step(BOMB_FUSE - 100); // not yet
                const before = { bombs: bombs.length, ex: explosions.length };
                step(200);             // now it detonates
                return { before, bombs: bombs.length, ex: explosions.length };
            });
            expect(info.before).toEqual({ bombs: 1, ex: 0 });
            expect(info.bombs).toBe(0);
            expect(info.ex).toBeGreaterThan(0);
        });

        test('explosion clears after its lifetime', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                placeBomb();
                step(BOMB_FUSE + 1);      // detonate
                step(BLAST_LIFE + 1);     // blast expires
                return explosions.length;
            });
            expect(n).toBe(0);
        });

        test('blast destroys an adjacent brick and scores 10', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                const c = player.col, r = player.row;
                grid[r][c + 1] = 'brick';
                const s0 = score;
                placeBomb();
                step(BOMB_FUSE + 1);
                return { cell: grid[r][c + 1], delta: score - s0 };
            });
            expect(info.cell).toBe('empty');
            expect(info.delta).toBe(10);
        });

        test('a pillar wall stops the blast, so a brick behind it survives', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                // Stand on (1,2); the (2,2) pillar sits immediately to the right.
                player.col = 1; player.row = 2; player.range = 5;
                grid[2][3] = 'brick';   // (col 3, row 2) — directly behind the pillar
                placeBomb();
                step(BOMB_FUSE + 1);
                return { pillar: grid[2][2], behind: grid[2][3] };
            });
            expect(info.pillar).toBe('wall');   // pillar is indestructible
            expect(info.behind).toBe('brick');  // blast never reached past the wall
        });

        test('a blast triggers a chain reaction on another bomb', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                bombs.length = 0;
                // clear a horizontal corridor on row 1
                for (let c = 1; c <= 5; c++) if (grid[1][c] !== 'wall') grid[1][c] = 'empty';
                bombs.push({ col: 1, row: 1, fuse: 0, range: 5 });     // detonates now
                bombs.push({ col: 4, row: 1, fuse: 5000, range: 1 });  // long fuse
                step(16);
                return bombs.length;
            });
            expect(n).toBe(0); // both gone: the first chained the second
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('an enemy caught in a blast is destroyed and scores 100', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                const n0 = enemies.length;
                const s0 = score;
                const e = spawnEnemy(player.col, player.row + 1); // on (1,2)
                e.moveCooldown = 1e9; // keep it still
                grid[player.row + 1][player.col] = 'empty';
                placeBomb();
                step(BOMB_FUSE + 1);
                return { n0, count: enemies.length, delta: score - s0 };
            });
            expect(info.count).toBe(info.n0);      // the extra enemy we added is gone
            expect(info.delta).toBe(100);
        });

        test('walking into an enemy costs a life', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 0;
                const e = spawnEnemy(player.col, player.row);
                e.moveCooldown = 1e9;
                step(16);
                return { lives };
            });
            expect(info.lives).toBe(2);
        });

        test('an invulnerable player is not hurt by an enemy', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                player.invuln = 5000;
                const e = spawnEnemy(player.col, player.row);
                e.moveCooldown = 1e9;
                step(16);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                player.invuln = 0;
                const e = spawnEnemy(player.col, player.row);
                e.moveCooldown = 1e9;
                step(16);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Power-ups
    // -----------------------------------------------------------------------
    test.describe('power-ups', () => {
        test('destroying a brick reveals a hidden power-up', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.invuln = 1e9;
                const c = player.col, r = player.row;
                grid[r][c + 1] = 'brick';
                brickPowerups[`${c + 1},${r}`] = 'flame';
                placeBomb();
                step(BOMB_FUSE + 1);
                return {
                    count: powerups.length,
                    type: powerups[0] && powerups[0].type,
                    at: powerups[0] && `${powerups[0].col},${powerups[0].row}`,
                };
            });
            expect(info.count).toBe(1);
            expect(info.type).toBe('flame');
            expect(info.at).toBe('2,1');
        });

        test('collecting a flame power-up increases blast range and scores 50', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                const r0 = player.range;
                const s0 = score;
                powerups.push({ col: player.col, row: player.row, type: 'flame' });
                step(16);
                return { range: player.range, r0, delta: score - s0, count: powerups.length };
            });
            expect(info.range).toBe(info.r0 + 1);
            expect(info.delta).toBe(50);
            expect(info.count).toBe(0);
        });

        test('collecting an extra-bomb power-up increases the bomb limit', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                const m0 = player.maxBombs;
                powerups.push({ col: player.col, row: player.row, type: 'extraBomb' });
                step(16);
                return { max: player.maxBombs, m0, count: powerups.length };
            });
            expect(info.max).toBe(info.m0 + 1);
            expect(info.count).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level progression
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing all enemies advances to the next level', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                step(16);
                return { level, enemies: enemies.length };
            });
            expect(info.level).toBe(2);
            expect(info.enemies).toBeGreaterThan(0);
        });

        test('level 2 spawns 4 enemies and resets the player to the corner', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                player.col = 5; player.row = 5;
                enemies.length = 0;
                step(16);
                return { count: enemies.length, col: player.col, row: player.row };
            });
            expect(info.count).toBe(4);
            expect(info).toMatchObject({ col: 1, row: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('paused overlay shows Paused', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('Paused');
        });

        test('step does nothing while paused', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                placeBomb();
                pauseGame();
                const fuse0 = bombs[0].fuse;
                step(1000);
                return { fuse0, fuse1: bombs[0].fuse };
            });
            expect(info.fuse1).toBe(info.fuse0);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('overlay shows Game Over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('Game Over');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('pressing Space after game over restarts with score 0', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 400; endGame(); });
            await page.keyboard.press(' ');
            const info = await page.evaluate(() => ({ state, score }));
            expect(info.state).toBe('running');
            expect(info.score).toBe(0);
        });

        test('best score updates on game over when score is higher', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                score = 250;
                endGame();
                return { best, stored: localStorage.getItem('bomberman-best') };
            });
            expect(info.best).toBe(250);
            expect(info.stored).toBe('250');
        });

        test('best score persists across reloads', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 640; endGame(); });
            await page.reload();
            await expect(page.locator('#best')).toHaveText('640');
        });
    });
});
