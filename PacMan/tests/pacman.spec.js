const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Pac-Man', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pac-Man', async ({ page }) => {
            await expect(page).toHaveTitle('Pac-Man');
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

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 456×504', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '456');
            await expect(canvas).toHaveAttribute('height', '504');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('pac starts at its maze spawn point', async ({ page }) => {
            const ok = await page.evaluate(
                () => pac.col === PAC_START.col && pac.row === PAC_START.row
            );
            expect(ok).toBe(true);
        });

        test('ghosts are spawned from the maze', async ({ page }) => {
            const info = await page.evaluate(() => ({
                count: ghosts.length,
                homes: GHOST_HOMES.length,
            }));
            expect(info.homes).toBeGreaterThan(0);
            expect(info.count).toBe(info.homes);
        });

        test('the maze is fully stocked with pellets', async ({ page }) => {
            const dots = await page.evaluate(() => dotsLeft);
            expect(dots).toBeGreaterThan(100);
        });

        test('there are exactly four power pellets', async ({ page }) => {
            const power = await page.evaluate(() => {
                let n = 0;
                for (let r = 0; r < ROWS; r++)
                    for (let c = 0; c < COLS; c++) if (pellets[r][c] === 2) n++;
                return n;
            });
            expect(power).toBe(4);
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

        test('arrow key dismisses overlay', async ({ page }) => {
            await page.keyboard.press('ArrowLeft');
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

        test('pac is placed at spawn on start', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return pac.col === PAC_START.col && pac.row === PAC_START.row &&
                    ghosts.length === GHOST_HOMES.length;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pac movement
    // -----------------------------------------------------------------------
    test.describe('pac movement', () => {
        test('pac moves in the direction it faces', async ({ page }) => {
            const col = await page.evaluate(() => {
                startGame();
                ghosts = [];
                pac.col = 9; pac.row = 17;
                pac.dir = { dx: -1, dy: 0 };
                pac.nextDir = { dx: -1, dy: 0 };
                moveOnce();
                return pac.col;
            });
            expect(col).toBe(8);
        });

        test('pac cannot move into a wall', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame();
                ghosts = [];
                pac.col = 9; pac.row = 17; // up & down are walls here
                pac.dir = { dx: 0, dy: -1 };
                pac.nextDir = { dx: 0, dy: -1 };
                moveOnce();
                return { col: pac.col, row: pac.row };
            });
            expect(pos).toEqual({ col: 9, row: 17 });
        });

        test('pac turns at an intersection when a new direction opens', async ({ page }) => {
            const pos = await page.evaluate(() => {
                startGame();
                ghosts = [];
                pac.col = 4; pac.row = 4; // a four-way junction
                pac.dir = { dx: 1, dy: 0 };   // heading right
                pac.nextDir = { dx: 0, dy: 1 }; // want to turn down
                moveOnce();
                return { col: pac.col, row: pac.row };
            });
            expect(pos).toEqual({ col: 4, row: 5 });
        });
    });

    // -----------------------------------------------------------------------
    // Pellets
    // -----------------------------------------------------------------------
    test.describe('pellets', () => {
        test('eating a pellet scores points and reduces the count', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                ghosts = [];
                score = 0;
                pac.col = 9; pac.row = 17;
                pac.dir = { dx: -1, dy: 0 };
                pac.nextDir = { dx: -1, dy: 0 };
                pellets[17][8] = 1; // ensure a pellet to eat on the left
                const before = dotsLeft;
                moveOnce();
                return { score, eaten: pellets[17][8], delta: before - dotsLeft };
            });
            expect(r.score).toBe(10);
            expect(r.eaten).toBe(0);
            expect(r.delta).toBe(1);
        });

        test('eating a power pellet makes ghosts frightened', async ({ page }) => {
            const fright = await page.evaluate(() => {
                startGame();
                ghosts = [];
                frightTimer = 0;
                pellets[3][1] = 2; // power pellet just above
                pac.col = 1; pac.row = 4;
                pac.dir = { dx: 0, dy: -1 };
                pac.nextDir = { dx: 0, dy: -1 };
                moveOnce();
                return frightTimer;
            });
            expect(fright).toBeGreaterThan(0);
        });

        test('a power pellet scores more than a normal pellet', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                ghosts = [];
                score = 0;
                pellets[3][1] = 2;
                pac.col = 1; pac.row = 4;
                pac.dir = { dx: 0, dy: -1 };
                pac.nextDir = { dx: 0, dy: -1 };
                moveOnce();
                return score;
            });
            expect(r).toBe(50);
        });
    });

    // -----------------------------------------------------------------------
    // Ghosts
    // -----------------------------------------------------------------------
    test.describe('ghosts', () => {
        test('ghosts move as the world ticks', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                frightTimer = 1e9; // keep them frightened so pac can't die
                for (let i = 0; i < 4; i++) moveOnce();
                return ghosts.some(g => g.col !== g.home.col || g.row !== g.home.row);
            });
            expect(moved).toBe(true);
        });

        test('eating a frightened ghost scores 200 and sends it home as eyes', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                frightTimer = 5000;
                ghosts[0].eaten = false;
                ghosts[0].col = pac.col;
                ghosts[0].row = pac.row;
                handleCollisions();
                return { score, eaten: ghosts[0].eaten };
            });
            expect(r.score).toBe(200);
            expect(r.eaten).toBe(true);
        });

        test('colliding with a normal ghost costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                lives = 3;
                frightTimer = 0;
                ghosts[0].eaten = false;
                ghosts[0].col = pac.col;
                ghosts[0].row = pac.row;
                handleCollisions();
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('an eaten ghost (eyes) does not hurt pac', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                lives = 3;
                frightTimer = 0;
                ghosts[0].eaten = true; // just eyes
                ghosts[0].col = pac.col;
                ghosts[0].row = pac.row;
                handleCollisions();
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('eyes revive into a normal ghost at home', async ({ page }) => {
            const revived = await page.evaluate(() => {
                startGame();
                const g = ghosts[0];
                g.eaten = true;
                g.col = g.home.col;
                g.row = g.home.row;
                moveGhost(g);
                return g.eaten;
            });
            expect(revived).toBe(false);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                frightTimer = 0;
                ghosts[0].eaten = false;
                ghosts[0].col = pac.col;
                ghosts[0].row = pac.row;
                handleCollisions();
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Clearing the maze
    // -----------------------------------------------------------------------
    test.describe('clearing the maze', () => {
        test('eating the last pellet advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                ghosts = [];
                for (let rr = 0; rr < ROWS; rr++)
                    for (let cc = 0; cc < COLS; cc++) pellets[rr][cc] = 0;
                pac.col = 9; pac.row = 17;
                pac.dir = { dx: -1, dy: 0 };
                pac.nextDir = { dx: -1, dy: 0 };
                pellets[17][8] = 1; // the final pellet
                dotsLeft = 1;
                moveOnce();
                return { level, dots: dotsLeft };
            });
            expect(r.level).toBe(2);
            expect(r.dots).toBeGreaterThan(100); // maze restocked
        });

        test('a cleared maze is fully restocked', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const original = dotsLeft;
                nextLevel();
                return { original, after: dotsLeft };
            });
            expect(r.after).toBe(r.original);
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

        test('nothing moves while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const same = await page.evaluate(() => {
                const p0 = { c: pac.col, r: pac.row };
                const g0 = ghosts.map(g => ({ c: g.col, r: g.row }));
                step(500);
                const pSame = pac.col === p0.c && pac.row === p0.r;
                const gSame = ghosts.every((g, i) => g.col === g0[i].c && g.row === g0[i].r);
                return pSame && gSame;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score shows points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999; lives = 1; level = 5;
                endGame();
                startGame();
                return { score, lives, level };
            });
            expect(r).toEqual({ score: 0, lives: 3, level: 1 });
        });

        test('best score updates on game over if higher', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame();
                score = 555;
                endGame();
                return best;
            });
            expect(best).toBeGreaterThanOrEqual(555);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('pacman-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(777);
        });
    });
});
