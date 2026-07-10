const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tron Light Cycles', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tron Light Cycles', async ({ page }) => {
            await expect(page).toHaveTitle('Tron Light Cycles');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to steer', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('steer');
        });

        test('wins start at 0', async ({ page }) => {
            await expect(page.locator('#wins')).toHaveText('0');
        });

        test('losses start at 0', async ({ page }) => {
            await expect(page.locator('#losses')).toHaveText('0');
        });

        test('best streak starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 700×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '700');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('the grid is 70 columns by 50 rows of 10px cells', async ({ page }) => {
            const r = await page.evaluate(() => ({ c: COLS, r: ROWS, cell: CELL }));
            expect(r.c).toBe(70);
            expect(r.r).toBe(50);
            expect(r.cell).toBe(10);
        });

        test('the player starts on the left heading right', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: player.x, dir: player.dir, half: COLS / 2 }));
            expect(r.x).toBeLessThan(r.half);
            expect(r.dir).toEqual({ dx: 1, dy: 0 });
        });

        test('the CPU starts on the right heading left', async ({ page }) => {
            const r = await page.evaluate(() => ({ x: cpu.x, dir: cpu.dir, half: COLS / 2 }));
            expect(r.x).toBeGreaterThan(r.half);
            expect(r.dir).toEqual({ dx: -1, dy: 0 });
        });

        test('both cycles start on the middle row', async ({ page }) => {
            const r = await page.evaluate(() => ({ py: player.y, cy: cpu.y, mid: Math.floor(ROWS / 2) }));
            expect(r.py).toBe(r.mid);
            expect(r.cy).toBe(r.mid);
        });

        test('both cycles are alive at the start', async ({ page }) => {
            const r = await page.evaluate(() => ({ p: playerAlive, c: cpuAlive }));
            expect(r.p).toBe(true);
            expect(r.c).toBe(true);
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

        test('starting stamps both cycle heads into the grid as trail', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => ({
                p: cellAt(player.x, player.y),
                c: cellAt(cpu.x, cpu.y),
            }));
            expect(r.p).toBe(1);
            expect(r.c).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Movement — deterministic, driven through step()
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('a step advances the player one cell in its heading', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const x0 = player.x, y0 = player.y;
                step();
                return { x0, y0, x1: player.x, y1: player.y };
            });
            expect(r.x1).toBe(r.x0 + 1); // heading right
            expect(r.y1).toBe(r.y0);
        });

        test('the player leaves a trail behind it', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const x0 = player.x, y0 = player.y;
                step();
                return { behind: cellAt(x0, y0), ahead: cellAt(player.x, player.y) };
            });
            expect(r.behind).toBe(1); // old cell is now wall
            expect(r.ahead).toBe(1);  // new cell too
        });

        test('the CPU also moves one cell per step', async ({ page }) => {
            await page.locator('#btn-start').click();
            const moved = await page.evaluate(() => {
                state = 'paused';
                const x0 = cpu.x, y0 = cpu.y;
                step();
                return Math.abs(cpu.x - x0) + Math.abs(cpu.y - y0);
            });
            expect(moved).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Steering
    // -----------------------------------------------------------------------
    test.describe('steering', () => {
        test('ArrowUp turns the player upward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const y0 = player.y;
                queuePlayerTurn('up');
                step();
                return { y0, y1: player.y, x0: player.x };
            });
            expect(r.y1).toBe(r.y0 - 1); // up is negative y
        });

        test('ArrowDown turns the player downward', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                const y0 = player.y;
                queuePlayerTurn('down');
                step();
                return { y0, y1: player.y };
            });
            expect(r.y1).toBe(r.y0 + 1);
        });

        test('a 180° reversal is ignored (player keeps heading right)', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                queuePlayerTurn('left'); // player heads right → reversal, must be ignored
                step();
                return player.dir;
            });
            expect(r).toEqual({ dx: 1, dy: 0 });
        });

        test('the keyboard steers the live player', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { state = 'paused'; });
            await page.keyboard.press('ArrowUp');
            const dir = await page.evaluate(() => player.nextDir);
            expect(dir).toEqual({ dx: 0, dy: -1 });
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('driving into the right wall kills the player', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = COLS - 1; player.y = 5; // on the very edge, heading right
                player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return playerAlive;
            });
            expect(r).toBe(false);
        });

        test('driving into the top wall kills the player', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 5; player.y = 0;
                player.dir = DIRS.up; player.nextDir = DIRS.up;
                step();
                return playerAlive;
            });
            expect(r).toBe(false);
        });

        test('driving into an existing trail kills the player', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 20; player.y = 20;
                player.dir = DIRS.right; player.nextDir = DIRS.right;
                setCell(21, 20, 2); // an opponent wall directly ahead
                step();
                return playerAlive;
            });
            expect(r).toBe(false);
        });

        test('a surviving player stays alive after a safe step', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 20; player.y = 20;
                player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return playerAlive;
            });
            expect(r).toBe(true);
        });

        test('a head-on into the same cell kills both cycles', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                player.x = 30; player.y = 25; player.dir = DIRS.right; player.nextDir = DIRS.right;
                cpu.x = 32; cpu.y = 25; cpu.dir = DIRS.left; cpu.nextDir = DIRS.left;
                // both target cell (31,25)
                stopCpuThinking(); // freeze the AI so the head-on is deterministic
                step();
                return { p: playerAlive, c: cpuAlive };
            });
            expect(r.p).toBe(false);
            expect(r.c).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Round results and scoring
    // -----------------------------------------------------------------------
    test.describe('round results', () => {
        test('the CPU crashing gives the player a win', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                wins = 0;
                // send the CPU straight into the wall, keep the player safe
                cpu.x = COLS - 1; cpu.y = 40; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                stopCpuThinking();
                player.x = 5; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return { wins, state, alive: cpuAlive };
            });
            expect(r.alive).toBe(false);
            expect(r.wins).toBe(1);
            expect(r.state).toBe('over');
        });

        test('the player crashing counts as a loss', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                losses = 0;
                player.x = COLS - 1; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return { losses, state };
            });
            expect(r.losses).toBe(1);
            expect(r.state).toBe('over');
        });

        test('a win increments the streak and the best streak', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                streak = 0; bestStreak = 0;
                cpu.x = COLS - 1; cpu.y = 40; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                stopCpuThinking();
                player.x = 5; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return { streak, best: bestStreak };
            });
            expect(r.streak).toBe(1);
            expect(r.best).toBe(1);
        });

        test('the best streak persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                streak = 0; bestStreak = 0;
                cpu.x = COLS - 1; cpu.y = 40; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                stopCpuThinking();
                player.x = 5; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
            });
            const stored = await page.evaluate(() => localStorage.getItem('tron-best-streak'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(1);
        });

        test('a loss resets the streak to 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                streak = 4;
                player.x = COLS - 1; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
                return streak;
            });
            expect(r).toBe(0);
        });

        test('the HUD win count updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                wins = 0;
                cpu.x = COLS - 1; cpu.y = 40; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                stopCpuThinking();
                player.x = 5; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
            });
            await expect(page.locator('#wins')).toHaveText('1');
        });

        test('winning shows a "You Win" overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                cpu.x = COLS - 1; cpu.y = 40; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                stopCpuThinking();
                player.x = 5; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('losing shows a "Crashed" overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                player.x = COLS - 1; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step();
            });
            await expect(page.locator('#overlay-title')).toContainText('Crashed');
        });

        test('Play Again button is shown after a round ends', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endRound());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting clears the grid and revives both cycles', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                player.x = COLS - 1; player.y = 5; player.dir = DIRS.right; player.nextDir = DIRS.right;
                step(); // player crashes → over
            });
            await page.locator('#btn-start').click(); // play again
            const r = await page.evaluate(() => ({
                p: playerAlive, c: cpuAlive,
                filled: gridFilledCount(),
                state,
            }));
            expect(r.p).toBe(true);
            expect(r.c).toBe(true);
            expect(r.state).toBe('running');
            // only the two fresh cycle heads should occupy the grid
            expect(r.filled).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // The CPU opponent
    // -----------------------------------------------------------------------
    test.describe('the CPU opponent', () => {
        test('the CPU turns to avoid a wall instead of crashing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                // CPU one cell from the right wall, heading right → straight = death
                cpu.x = COLS - 1; cpu.y = 25; cpu.dir = DIRS.right; cpu.nextDir = DIRS.right;
                step();
                return cpuAlive;
            });
            expect(r).toBe(true); // it should have turned away
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

        test('pause overlay shows "Paused"', async ({ page }) => {
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
});
