const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Artillery Duel', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Artillery Duel', async ({ page }) => {
            await expect(page).toHaveTitle('Artillery Duel');
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

        test('round starts at 1', async ({ page }) => {
            await expect(page.locator('#round')).toHaveText('1');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('both tanks rest on the ground at distinct x positions', async ({ page }) => {
            const res = await page.evaluate(() => ({
                py: player.y, cy: cpu.y, g: GROUND_Y, px: player.x, cx: cpu.x,
            }));
            expect(res.py).toBe(res.g);
            expect(res.cy).toBe(res.g);
            expect(res.px === res.cx).toBe(false);
        });

        test('no shell is in the air before starting', async ({ page }) => {
            expect(await page.evaluate(() => shell)).toBeNull();
        });

        test('it is the player\'s turn to start', async ({ page }) => {
            expect(await page.evaluate(() => turn)).toBe('player');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay and starts', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('an arrow key also starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Aiming
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('ArrowUp raises the barrel angle', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => angle);
            await page.keyboard.press('ArrowUp');
            const after = await page.evaluate(() => angle);
            expect(after).toBeGreaterThan(before);
        });

        test('ArrowDown lowers the barrel angle', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => angle);
            await page.keyboard.press('ArrowDown');
            const after = await page.evaluate(() => angle);
            expect(after).toBeLessThan(before);
        });

        test('ArrowRight increases power', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => power);
            await page.keyboard.press('ArrowRight');
            const after = await page.evaluate(() => power);
            expect(after).toBeGreaterThan(before);
        });

        test('ArrowLeft decreases power', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => power);
            await page.keyboard.press('ArrowLeft');
            const after = await page.evaluate(() => power);
            expect(after).toBeLessThan(before);
        });

        test('angle is clamped at its maximum', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                angle = ANGLE_MAX;
                aimAngle(+1);
                return { angle, max: ANGLE_MAX };
            });
            expect(res.angle).toBe(res.max);
        });

        test('power is clamped at its minimum', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                power = POWER_MIN;
                aimPower(-1);
                return { power, min: POWER_MIN };
            });
            expect(res.power).toBe(res.min);
        });
    });

    // -----------------------------------------------------------------------
    // Firing & projectile physics
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('Space fires a player-owned shell', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.keyboard.press('Space'); // fire
            const owner = await page.evaluate(() => (shell ? shell.owner : null));
            expect(owner).toBe('player');
        });

        test('a second fire is ignored while a shell is in the air', async ({ page }) => {
            await page.keyboard.press('Space');
            const same = await page.evaluate(() => {
                turn = 'player'; shell = null;
                fireShell();
                const first = shell;
                first._mark = 1;
                fireShell(); // must be ignored
                return shell === first && shell._mark === 1;
            });
            expect(same).toBe(true);
        });

        test('a player launch heads up and to the right', async ({ page }) => {
            await page.keyboard.press('Space');
            const v = await page.evaluate(() => launchVelocity(45, 60, 1));
            expect(v.vx).toBeGreaterThan(0);
            expect(v.vy).toBeLessThan(0);
        });

        test('gravity pulls a shell downward over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                wind = 0;
                shell = { x: 150, y: 120, vx: 0.1, vy: -0.3, owner: 'player' };
                const vy0 = shell.vy;
                step(20);
                return { vy0, vy: shell.vy };
            });
            expect(res.vy).toBeGreaterThan(res.vy0);
        });

        test('a moving shell travels horizontally', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                wind = 0;
                shell = { x: 150, y: 120, vx: 0.25, vy: -0.3, owner: 'player' };
                const x0 = shell.x;
                step(20);
                return { x0, x: shell.x };
            });
            expect(res.x).toBeGreaterThan(res.x0);
        });

        test('wind accelerates the shell sideways', async ({ page }) => {
            await page.keyboard.press('Space');
            const vx = await page.evaluate(() => {
                wind = 0.001;
                shell = { x: 250, y: 120, vx: 0, vy: -0.3, owner: 'player' };
                step(20);
                return shell.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Shot outcomes
    // -----------------------------------------------------------------------
    test.describe('shot outcomes', () => {
        test('a player shell hitting the CPU wins the round', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                aiEnabled = false; wind = 0; turn = 'player';
                const s0 = score, r0 = round;
                shell = { x: cpu.x, y: GROUND_Y - 6, vx: 0, vy: 0, owner: 'player' };
                step(1);
                return { s0, r0, score, round, state, shell };
            });
            expect(res.score).toBe(res.s0 + 1);
            expect(res.round).toBe(res.r0 + 1);
            expect(res.state).toBe('running');
            expect(res.shell).toBeNull();
        });

        test('a player shell landing on the ground passes the turn to the CPU', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                aiEnabled = false; wind = 0; turn = 'player';
                shell = { x: 250, y: GROUND_Y - 1, vx: 0.05, vy: 0.5, owner: 'player' };
                step(30);
                return { shell, turn };
            });
            expect(res.shell).toBeNull();
            expect(res.turn).toBe('cpu');
        });

        test('a CPU shell hitting the player ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                aiEnabled = false; wind = 0; turn = 'cpu';
                shell = { x: player.x, y: GROUND_Y - 6, vx: 0, vy: 0, owner: 'cpu' };
                step(1);
                return state;
            });
            expect(s).toBe('over');
        });

        test('a shell flying off the side is a miss', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                aiEnabled = false; wind = 0; turn = 'player';
                shell = { x: WIDTH - 5, y: 120, vx: 1, vy: 0, owner: 'player' };
                step(60);
                return { shell, turn };
            });
            expect(res.shell).toBeNull();
            expect(res.turn).toBe('cpu');
        });
    });

    // -----------------------------------------------------------------------
    // CPU
    // -----------------------------------------------------------------------
    test.describe('cpu', () => {
        test('cpuAim returns a legal angle and power', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                const a = cpuAim();
                return {
                    a, aMin: ANGLE_MIN, aMax: ANGLE_MAX, pMin: POWER_MIN, pMax: POWER_MAX,
                };
            });
            expect(res.a.angle).toBeGreaterThanOrEqual(res.aMin);
            expect(res.a.angle).toBeLessThanOrEqual(res.aMax);
            expect(res.a.power).toBeGreaterThanOrEqual(res.pMin);
            expect(res.a.power).toBeLessThanOrEqual(res.pMax);
        });

        test('firing on the CPU turn produces a CPU-owned shell', async ({ page }) => {
            await page.keyboard.press('Space');
            const owner = await page.evaluate(() => {
                turn = 'cpu'; shell = null;
                fireShell();
                return shell ? shell.owner : null;
            });
            expect(owner).toBe('cpu');
        });
    });

    // -----------------------------------------------------------------------
    // Rounds & scoring
    // -----------------------------------------------------------------------
    test.describe('rounds', () => {
        test('winning a round increments score and round and clears the shell', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                shell = { x: 1, y: 1, vx: 0, vy: 0, owner: 'player' };
                const s0 = score, r0 = round;
                winRound();
                return { s0, r0, score, round, shell, turn };
            });
            expect(res.score).toBe(res.s0 + 1);
            expect(res.round).toBe(res.r0 + 1);
            expect(res.shell).toBeNull();
            expect(res.turn).toBe('player');
        });

        test('best score updates when the score climbs', async ({ page }) => {
            await page.keyboard.press('Space');
            const best = await page.evaluate(() => {
                score = 4;
                winRound();
                return best;
            });
            expect(best).toBeGreaterThanOrEqual(5);
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

        test('the pause overlay shows "Paused"', async ({ page }) => {
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

        test('nothing advances while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            const same = await page.evaluate(() => {
                wind = 0;
                shell = { x: 150, y: 120, vx: 0.3, vy: -0.3, owner: 'player' };
                togglePause();
                const before = { x: shell.x, y: shell.y };
                step(50);
                return before.x === shell.x && before.y === shell.y;
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('the button reads "Play Again" after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets score and round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 9; round = 7;
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#round')).toHaveText('1');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 12;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('artillery-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(12);
        });
    });
});
