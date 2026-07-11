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

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('your wins start at 0', async ({ page }) => {
            await expect(page.locator('#you')).toHaveText('0');
        });

        test('cpu wins start at 0', async ({ page }) => {
            await expect(page.locator('#cpu')).toHaveText('0');
        });

        test('round starts at 1', async ({ page }) => {
            await expect(page.locator('#round')).toHaveText('1');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 480×480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('grid is COLS×ROWS with matching CELL size', async ({ page }) => {
            const info = await page.evaluate(() => ({
                cols: COLS, rows: ROWS, cell: CELL,
                gridRows: occupied.length, gridCols: occupied[0].length,
            }));
            expect(info.gridRows).toBe(info.rows);
            expect(info.gridCols).toBe(info.cols);
            expect(info.cols * info.cell).toBe(480);
        });

        test('player spawns on the left facing right', async ({ page }) => {
            const p = await page.evaluate(() => ({ x: player.x, dx: player.dir.dx, dy: player.dir.dy, alive: player.alive }));
            expect(p.x).toBe(5);
            expect(p.dx).toBe(1);
            expect(p.dy).toBe(0);
            expect(p.alive).toBe(true);
        });

        test('cpu spawns on the right facing left', async ({ page }) => {
            const c = await page.evaluate(() => ({ x: cpu.x, dx: cpu.dir.dx, dy: cpu.dir.dy, alive: cpu.alive, cols: COLS }));
            expect(c.x).toBe(c.cols - 6);
            expect(c.dx).toBe(-1);
            expect(c.dy).toBe(0);
            expect(c.alive).toBe(true);
        });

        test('both spawn cells are marked occupied', async ({ page }) => {
            const marks = await page.evaluate(() => ({
                p: occupied[player.y][player.x],
                c: occupied[cpu.y][cpu.x],
            }));
            expect(marks.p).toBe(1);
            expect(marks.c).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('an arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('round is 1 after starting', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#round')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('a step advances the player one cell forward', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => player.x);
            await page.evaluate(() => step());
            const after = await page.evaluate(() => player.x);
            expect(after).toBe(before + 1);
        });

        test('a step advances the cpu one cell forward', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => cpu.x);
            await page.evaluate(() => step());
            const after = await page.evaluate(() => cpu.x);
            expect(after).toBe(before - 1);
        });

        test('a trail is left behind the player', async ({ page }) => {
            await page.keyboard.press('Space');
            const oldCell = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.evaluate(() => step());
            const stillThere = await page.evaluate(
                ([c]) => occupied[c.y][c.x] === 1, [oldCell]
            );
            expect(stillThere).toBe(true);
        });

        test('each step fills two more cells while both cycles live', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => occupied.flat().filter(v => v !== 0).length);
            await page.evaluate(() => step());
            const after = await page.evaluate(() => occupied.flat().filter(v => v !== 0).length);
            expect(after).toBe(before + 2);
        });
    });

    // -----------------------------------------------------------------------
    // Turning
    // -----------------------------------------------------------------------
    test.describe('turning', () => {
        test('ArrowUp turns the player upward', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowUp');
            const y0 = await page.evaluate(() => player.y);
            await page.evaluate(() => step());
            const p = await page.evaluate(() => ({ y: player.y, dy: player.dir.dy }));
            expect(p.dy).toBe(-1);
            expect(p.y).toBe(y0 - 1);
        });

        test('a 180° reversal is ignored', async ({ page }) => {
            await page.keyboard.press('Space');
            // Player travels right; queue a left (reverse) turn.
            await page.evaluate(() => { player.pendingDir = { dx: -1, dy: 0 }; step(); });
            const dx = await page.evaluate(() => player.dir.dx);
            expect(dx).toBe(1); // still moving right, reversal rejected
        });

        test('a queued turn only applies on the next step', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.pendingDir = { dx: 0, dy: 1 }; });
            const dyBefore = await page.evaluate(() => player.dir.dy);
            expect(dyBefore).toBe(0); // not applied yet
            await page.evaluate(() => step());
            const dyAfter = await page.evaluate(() => player.dir.dy);
            expect(dyAfter).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions and rounds
    // -----------------------------------------------------------------------
    test.describe('collisions and rounds', () => {
        test('driving into a wall loses the round to the cpu', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                player.x = COLS - 1; player.y = 0; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null;
                cpu.x = 0; cpu.y = ROWS - 1; cpu.dir = { dx: 0, dy: -1 }; cpu.pendingDir = null;
                step();
            });
            expect(await page.evaluate(() => player.alive)).toBe(false);
            await expect(page.locator('#cpu')).toHaveText('1');
        });

        test('driving into your own trail loses the round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                player.x = 10; player.y = 10; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null;
                occupied[10][11] = 1; // own trail directly ahead
                cpu.x = 30; cpu.y = 30; cpu.dir = { dx: 0, dy: 1 }; cpu.pendingDir = null;
                step();
            });
            expect(await page.evaluate(() => player.alive)).toBe(false);
        });

        test("driving into the cpu's trail loses the round", async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                player.x = 10; player.y = 10; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null;
                occupied[10][11] = 2; // cpu trail directly ahead
                cpu.x = 30; cpu.y = 30; cpu.dir = { dx: 0, dy: 1 }; cpu.pendingDir = null;
                step();
            });
            expect(await page.evaluate(() => player.alive)).toBe(false);
            await expect(page.locator('#cpu')).toHaveText('1');
        });

        test('boxing the cpu in wins you the round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
                cpu.x = 0; cpu.y = 0; cpu.dir = { dx: -1, dy: 0 }; cpu.pendingDir = null; cpu.alive = true;
                occupied[0][0] = 2;
                occupied[1][0] = 1; // block the only open turn (downward)
                player.x = 20; player.y = 20; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null; player.alive = true;
                occupied[20][20] = 1;
                step();
            });
            expect(await page.evaluate(() => cpu.alive)).toBe(false);
            expect(await page.evaluate(() => player.alive)).toBe(true);
            await expect(page.locator('#you')).toHaveText('1');
        });

        test('a head-on smash is a tie with no points awarded', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
                player.x = 10; player.y = 10; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null; player.alive = true;
                cpu.x = 12; cpu.y = 10; cpu.dir = { dx: -1, dy: 0 }; cpu.pendingDir = null; cpu.alive = true;
                occupied[10][10] = 1; occupied[10][12] = 2;
                step();
            });
            const r = await page.evaluate(() => ({ p: player.alive, c: cpu.alive, w: lastRoundWinner }));
            expect(r.p).toBe(false);
            expect(r.c).toBe(false);
            expect(r.w).toBe('tie');
            await expect(page.locator('#you')).toHaveText('0');
            await expect(page.locator('#cpu')).toHaveText('0');
        });

        test('a decided round enters the roundover state', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                player.x = COLS - 1; player.y = 0; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null;
                cpu.x = 0; cpu.y = ROWS - 1; cpu.dir = { dx: 0, dy: -1 }; cpu.pendingDir = null;
                step();
            });
            expect(await page.evaluate(() => state)).toBe('roundover');
        });

        test('nextRound resets the arena but keeps the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { youWins = 2; cpuWins = 1; round = 3; nextRound(); });
            const s = await page.evaluate(() => ({
                round, youWins, cpuWins, state,
                px: player.x, pAlive: player.alive, cAlive: cpu.alive,
                filled: occupied.flat().filter(v => v !== 0).length,
            }));
            expect(s.round).toBe(4);
            expect(s.youWins).toBe(2);
            expect(s.cpuWins).toBe(1);
            expect(s.px).toBe(5);
            expect(s.pAlive).toBe(true);
            expect(s.cAlive).toBe(true);
            expect(s.filled).toBe(2);
            expect(s.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // CPU AI
    // -----------------------------------------------------------------------
    test.describe('cpu ai', () => {
        test('the cpu turns to avoid an immediate wall', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
                cpu.x = COLS - 1; cpu.y = 10; cpu.dir = { dx: 1, dy: 0 }; cpu.pendingDir = null; cpu.alive = true;
                occupied[10][COLS - 1] = 2;
                player.x = 20; player.y = 30; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null; player.alive = true;
                occupied[30][20] = 1;
                step();
            });
            const c = await page.evaluate(() => ({ alive: cpu.alive, dx: cpu.dir.dx }));
            expect(c.alive).toBe(true);
            expect(c.dx).toBe(0); // no longer driving into the wall
        });

        test('the cpu keeps going straight when the path is clear', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
                cpu.x = 20; cpu.y = 20; cpu.dir = { dx: -1, dy: 0 }; cpu.pendingDir = null; cpu.alive = true;
                occupied[20][20] = 2;
                player.x = 5; player.y = 5; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null; player.alive = true;
                occupied[5][5] = 1;
                step();
            });
            const c = await page.evaluate(() => ({ x: cpu.x, dx: cpu.dir.dx }));
            expect(c.dx).toBe(-1);
            expect(c.x).toBe(19);
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

        test('the cycles do not move while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(); });
            const after = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(after).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Match / game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('reaching the target wins the match for you', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                youWins = TARGET_WINS - 1;
                occupied = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
                cpu.x = 0; cpu.y = 0; cpu.dir = { dx: -1, dy: 0 }; cpu.pendingDir = null; cpu.alive = true;
                occupied[0][0] = 2; occupied[1][0] = 1;
                player.x = 20; player.y = 20; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null; player.alive = true;
                occupied[20][20] = 1;
                step();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay-title')).toContainText('You Win');
        });

        test('the cpu reaching the target ends the match', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                cpuWins = TARGET_WINS - 1;
                player.x = COLS - 1; player.y = 0; player.dir = { dx: 1, dy: 0 }; player.pendingDir = null;
                cpu.x = 0; cpu.y = ROWS - 1; cpu.dir = { dx: 0, dy: -1 }; cpu.pendingDir = null;
                step();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay-title')).toContainText('CPU');
        });

        test('overlay is shown at game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets the score and round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { youWins = 3; cpuWins = 5; round = 8; endGame(); });
            await page.keyboard.press('Space');
            await expect(page.locator('#you')).toHaveText('0');
            await expect(page.locator('#cpu')).toHaveText('0');
            await expect(page.locator('#round')).toHaveText('1');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('best updates at game over if your wins are higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { youWins = 3; endGame(); });
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThanOrEqual(3);
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { youWins = 4; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('tron-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(4);
        });
    });
});
