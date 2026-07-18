const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Light Cycles', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Light Cycles', async ({ page }) => {
            await expect(page).toHaveTitle('Light Cycles');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to steer', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('steer');
        });

        test('player score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-player')).toHaveText('0');
        });

        test('CPU score starts at 0', async ({ page }) => {
            await expect(page.locator('#score-cpu')).toHaveText('0');
        });

        test('best streak starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600×600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('the grid is 30×30 cells', async ({ page }) => {
            const r = await page.evaluate(() => ({ cols: COLS, rows: ROWS }));
            expect(r.cols).toBe(30);
            expect(r.rows).toBe(30);
        });

        test('the player starts on the left, the CPU on the right', async ({ page }) => {
            const r = await page.evaluate(() => ({ px: player.x, cx: cpu.x, C: COLS }));
            expect(r.px).toBeLessThan(r.C / 2);
            expect(r.cx).toBeGreaterThan(r.C / 2);
        });

        test('the player starts heading right, the CPU heading left', async ({ page }) => {
            const r = await page.evaluate(() => ({
                pdx: player.dir.dx, pdy: player.dir.dy,
                cdx: cpu.dir.dx, cdy: cpu.dir.dy,
            }));
            expect(r.pdx).toBe(1);
            expect(r.pdy).toBe(0);
            expect(r.cdx).toBe(-1);
            expect(r.cdy).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('a steer key dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('both cycles are alive after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({ p: player.alive, c: cpu.alive }));
            expect(r.p).toBe(true);
            expect(r.c).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Steering
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('ArrowUp steers the player up', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('ArrowUp');
            const d = await page.evaluate(() => ({ dx: player.dir.dx, dy: player.dir.dy }));
            expect(d.dx).toBe(0);
            expect(d.dy).toBe(-1);
        });

        test('ArrowDown steers the player down', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('ArrowDown');
            const d = await page.evaluate(() => ({ dx: player.dir.dx, dy: player.dir.dy }));
            expect(d.dx).toBe(0);
            expect(d.dy).toBe(1);
        });

        test('W steers the player up', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('w');
            const d = await page.evaluate(() => player.dir.dy);
            expect(d).toBe(-1);
        });

        test('the player cannot reverse directly into itself', async ({ page }) => {
            await page.locator('#btn-start').click();
            // player starts heading right; pressing Left is a direct reverse
            await page.keyboard.press('ArrowLeft');
            const d = await page.evaluate(() => ({ dx: player.dir.dx, dy: player.dir.dy }));
            expect(d.dx).toBe(1); // unchanged, still heading right
            expect(d.dy).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Movement & trails
    // -----------------------------------------------------------------------
    test.describe('movement and trails', () => {
        test('a step advances the player one cell in its direction', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                const x0 = player.x, y0 = player.y;
                step();
                return { x0, y0, x1: player.x, y1: player.y };
            });
            expect(r.x1).toBe(r.x0 + 1); // player heads right
            expect(r.y1).toBe(r.y0);
        });

        test('moving leaves a trail on the grid', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                step();
                return { marked: grid[player.y][player.x], id: player.id };
            });
            expect(r.marked).toBe(r.id);
        });

        test('a step advances the CPU one cell in its direction', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false; // CPU just goes straight
                resetRound();
                const x0 = cpu.x;
                step();
                return { x0, x1: cpu.x };
            });
            expect(r.x1).toBe(r.x0 - 1); // CPU heads left
        });

        test('update() steps the simulation after enough time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                const x0 = player.x;
                update(STEP_INTERVAL * 1.5);
                return { x0, x1: player.x };
            });
            expect(r.x1).toBeGreaterThan(r.x0);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('the player crashing into a wall gives the CPU a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                playerScore = 0; cpuScore = 0;
                // player at the left wall heading further left → out of bounds
                player.x = 0; player.y = 15; player.dir = DIRS.left;
                // CPU somewhere open, heading into empty space
                cpu.x = 15; cpu.y = 15; cpu.dir = DIRS.up;
                step();
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(0);
            expect(r.c).toBe(1);
        });

        test('the player crashing into a trail gives the CPU a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                playerScore = 0; cpuScore = 0;
                player.x = 5; player.y = 15; player.dir = DIRS.right;
                grid[15][6] = 2; // an enemy trail cell directly ahead
                cpu.x = 15; cpu.y = 15; cpu.dir = DIRS.up; // safe
                step();
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(0);
            expect(r.c).toBe(1);
        });

        test('the CPU crashing into a wall gives the player a point', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false; // so the CPU does not dodge
                resetRound();
                playerScore = 0; cpuScore = 0;
                cpu.x = COLS - 1; cpu.y = 15; cpu.dir = DIRS.right; // into the right wall
                player.x = 5; player.y = 5; player.dir = DIRS.down; // safe
                step();
                return { p: playerScore, c: cpuScore };
            });
            expect(r.p).toBe(1);
            expect(r.c).toBe(0);
        });

        test('a head-on collision is a draw (no point scored)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = false;
                resetRound();
                playerScore = 0; cpuScore = 0;
                player.x = 10; player.y = 15; player.dir = DIRS.right;
                cpu.x = 12; cpu.y = 15; cpu.dir = DIRS.left; // both aim for (11,15)
                step();
                return { p: playerScore, c: cpuScore, pa: player.alive, ca: cpu.alive };
            });
            expect(r.p).toBe(0);
            expect(r.c).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & rounds
    // -----------------------------------------------------------------------
    test.describe('scoring and rounds', () => {
        test('a player round win increments the player score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                cpu.alive = false; player.alive = true; // CPU crashed
                resolveRound();
                return playerScore;
            });
            expect(s).toBe(1);
        });

        test('the board resets and both cycles revive after a round', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                cpu.alive = false; player.alive = true;
                resolveRound();
                return { pa: player.alive, ca: cpu.alive };
            });
            expect(r.pa).toBe(true);
            expect(r.ca).toBe(true);
        });

        test('the score display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0;
                cpu.alive = false; player.alive = true;
                resolveRound();
            });
            await expect(page.locator('#score-player')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Best streak
    // -----------------------------------------------------------------------
    test.describe('best streak', () => {
        test('winning several rounds raises the best streak', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0; streak = 0; bestStreak = 0;
                for (let n = 0; n < 3; n++) {
                    cpu.alive = false; player.alive = true;
                    resolveRound();
                }
                return bestStreak;
            });
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('the best streak persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0; streak = 0; bestStreak = 0;
                cpu.alive = false; player.alive = true;
                resolveRound();
            });
            const stored = await page.evaluate(() => localStorage.getItem('light-cycles-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('losing a round resets the current streak', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                playerScore = 0; cpuScore = 0; streak = 3;
                player.alive = false; cpu.alive = true; // player crashed
                resolveRound();
                return streak;
            });
            expect(s).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Winning the match
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('reaching the winning score ends the match', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'paused';
                playerScore = WIN_SCORE - 1; cpuScore = 0;
                cpu.alive = false; player.alive = true;
                resolveRound();
                return state;
            });
            expect(s).toBe('over');
        });

        test('winning shows a "You Win" overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                playerScore = WIN_SCORE - 1; cpuScore = 0;
                cpu.alive = false; player.alive = true;
                resolveRound();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('losing shows a "Game Over" overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                cpuScore = WIN_SCORE - 1; playerScore = 0;
                player.alive = false; cpu.alive = true;
                resolveRound();
            });
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the Play Again button appears after the match ends', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endMatch('player'));
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets both scores to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { playerScore = 3; cpuScore = 4; endMatch('cpu'); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score-player')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const s = await page.evaluate(() => state);
            expect(s).toBe('paused');
        });

        test('the pause overlay shows "Paused"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('the cycles do not move while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // The CPU opponent
    // -----------------------------------------------------------------------
    test.describe('the CPU opponent', () => {
        test('the CPU turns to avoid crashing into a wall', async ({ page }) => {
            await page.locator('#btn-start').click();
            const alive = await page.evaluate(() => {
                state = 'paused';
                aiEnabled = true;
                resetRound();
                // put the CPU one cell from the right wall, heading straight into it
                cpu.x = COLS - 1; cpu.y = 15; cpu.dir = DIRS.right;
                // keep the player far away and safe
                player.x = 2; player.y = 2; player.dir = DIRS.down;
                step();
                return cpu.alive;
            });
            expect(alive).toBe(true); // it should have turned instead of crashing
        });
    });
});
