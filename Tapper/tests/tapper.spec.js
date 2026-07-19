const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.clear(); } catch (e) { /* ignore */ }
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tapper', async ({ page }) => {
            await expect(page).toHaveTitle(/Tapper/);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to play', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/serve|pour|drink/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives display starts at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('wave display starts at 1', async ({ page }) => {
            await expect(page.locator('#wave')).toHaveText('1');
        });

        test('canvas is 480×640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '480');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('idle state before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('there are four lanes', async ({ page }) => {
            const n = await page.evaluate(() => LANES);
            expect(n).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay and starts', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('game resets score, lives and wave on start', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                return { score, lives, wave };
            });
            expect(r.score).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.wave).toBe(1);
        });

        test('the first wave has patrons queued to arrive', async ({ page }) => {
            await page.locator('#btn-start').click();
            const n = await page.evaluate(() => patronsToSpawn);
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender lane movement
    // -----------------------------------------------------------------------
    test.describe('bartender lanes', () => {
        test('ArrowDown moves the bartender down a lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { bartenderLane = 0; });
            await page.keyboard.press('ArrowDown');
            const lane = await page.evaluate(() => bartenderLane);
            expect(lane).toBe(1);
        });

        test('ArrowUp moves the bartender up a lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { bartenderLane = 2; });
            await page.keyboard.press('ArrowUp');
            const lane = await page.evaluate(() => bartenderLane);
            expect(lane).toBe(1);
        });

        test('the bartender cannot move above the top lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { bartenderLane = 0; });
            await page.keyboard.press('ArrowUp');
            const lane = await page.evaluate(() => bartenderLane);
            expect(lane).toBe(0);
        });

        test('the bartender cannot move below the bottom lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { bartenderLane = LANES - 1; });
            await page.keyboard.press('ArrowDown');
            const lane = await page.evaluate(() => bartenderLane);
            expect(lane).toBe(3); // LANES - 1
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test('spawnPatron adds a patron in a valid lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patrons = [];
                patronsToSpawn = 5;
                spawnPatron();
                return { n: patrons.length, lane: patrons[0].lane, toSpawn: patronsToSpawn };
            });
            expect(r.n).toBe(1);
            expect(r.lane).toBeGreaterThanOrEqual(0);
            expect(r.lane).toBeLessThan(4);
            expect(r.toSpawn).toBe(4);
        });

        test('patrons advance to the right over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                mugs = [];
                patrons = [{ lane: 0, x: 100, vx: 40 }];
                update(0.1);
                return patrons.length ? patrons[0].x : null;
            });
            expect(r).toBeGreaterThan(100);
        });

        test('patrons spawn automatically on the arrival timer', async ({ page }) => {
            await page.locator('#btn-start').click();
            const n = await page.evaluate(() => {
                state = 'paused';
                patrons = [];
                mugs = [];
                patronsToSpawn = 10;
                for (let i = 0; i < 120; i++) update(0.05);
                return patrons.length + (10 - patronsToSpawn);
            });
            expect(n).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Mugs (pouring)
    // -----------------------------------------------------------------------
    test.describe('pouring mugs', () => {
        test('pour adds a mug in the bartender lane sliding left', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                mugs = [];
                bartenderLane = 2;
                pour();
                return { n: mugs.length, lane: mugs[0].lane, vx: mugs[0].vx };
            });
            expect(r.n).toBe(1);
            expect(r.lane).toBe(2);
            expect(r.vx).toBeLessThan(0);
        });

        test('Space pours a mug while running', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { mugs = []; });
            await page.keyboard.press(' ');
            const n = await page.evaluate(() => mugs.length);
            expect(n).toBe(1);
        });

        test('mugs slide left over time', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                patrons = [];
                mugs = [{ lane: 0, x: 300, vx: -260 }];
                update(0.1);
                return mugs.length ? mugs[0].x : null;
            });
            expect(r).toBeLessThan(300);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a mug catching a patron serves it and scores', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                score = 0; wave = 1;
                patrons = [{ lane: 1, x: 300, vx: 0 }];
                mugs = [{ lane: 1, x: 312, vx: -260 }];
                update(0.1); // mug slides into the patron
                return { patrons: patrons.length, mugs: mugs.length, score };
            });
            expect(r.patrons).toBe(0); // served & gone
            expect(r.mugs).toBe(0);    // mug consumed
            expect(r.score).toBe(10);  // 10 * wave(1)
        });

        test('a served patron is worth 10 × wave', async ({ page }) => {
            await page.locator('#btn-start').click();
            const score = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                score = 0; wave = 3;
                patrons = [{ lane: 0, x: 200, vx: 0 }];
                mugs = [{ lane: 0, x: 212, vx: -260 }];
                update(0.1);
                return score;
            });
            expect(score).toBe(30);
        });

        test('a mug only serves patrons in its own lane', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                patrons = [{ lane: 2, x: 300, vx: 0 }]; // different lane
                mugs = [{ lane: 0, x: 312, vx: -260 }];
                update(0.1);
                return { patrons: patrons.length };
            });
            expect(r.patrons).toBe(1); // untouched
        });

        test('the score display updates in the DOM after a serve', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                score = 0; wave = 1;
                patrons = [{ lane: 0, x: 200, vx: 0 }];
                mugs = [{ lane: 0, x: 212, vx: -260 }];
                update(0.1);
            });
            await expect(page.locator('#score')).toHaveText('10');
        });

        test('a mug reaching the left wall is discarded without penalty', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                lives = 3;
                patrons = [];
                mugs = [{ lane: 0, x: 5, vx: -260 }]; // already at the wall
                update(0.1);
                return { mugs: mugs.length, lives };
            });
            expect(r.mugs).toBe(0);   // discarded
            expect(r.lives).toBe(3);  // no penalty
        });
    });

    // -----------------------------------------------------------------------
    // Danger line — patrons reaching the counter
    // -----------------------------------------------------------------------
    test.describe('patrons reaching the counter', () => {
        test('a patron reaching the counter end costs a life', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                lives = 3;
                mugs = [];
                patrons = [{ lane: 0, x: DANGER_X + 1, vx: 20 }];
                update(0.1);
                return { lives, patrons: patrons.length };
            });
            expect(r.lives).toBe(2);
            expect(r.patrons).toBe(0); // removed
        });

        test('the lives display updates in the DOM after a life is lost', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'paused';
                patronsToSpawn = 0;
                lives = 3;
                mugs = [];
                patrons = [{ lane: 0, x: DANGER_X + 1, vx: 20 }];
                update(0.1);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                state = 'running';
                patronsToSpawn = 0;
                lives = 1;
                mugs = [];
                patrons = [{ lane: 0, x: DANGER_X + 1, vx: 20 }];
                update(0.1);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing a wave advances to the next wave', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                state = 'running';
                wave = 1;
                patronsToSpawn = 0; // no more to arrive
                patrons = [{ lane: 0, x: 200, vx: 0 }]; // last patron, served this step
                mugs = [{ lane: 0, x: 212, vx: -260 }];
                update(0.1);
                return { wave, toSpawn: patronsToSpawn };
            });
            expect(r.wave).toBe(2);
            expect(r.toSpawn).toBeGreaterThan(0);
        });

        test('patrons get faster each wave', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                startGame();
                state = 'paused';
                const s0 = patronSpeed;
                nextWave();
                return { s0, s1: patronSpeed };
            });
            expect(r.s1).toBeGreaterThan(r.s0);
        });

        test('the wave display updates in the DOM', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                state = 'running';
                wave = 1;
                patronsToSpawn = 0;
                patrons = [{ lane: 0, x: 200, vx: 0 }];
                mugs = [{ lane: 0, x: 212, vx: -260 }];
                update(0.1);
            });
            await expect(page.locator('#wave')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Game over & best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over shows the overlay with "Game Over"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 5; endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Game Over/i);
        });

        test('best score rises to match a higher score on game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => { best = 0; score = 210; endGame(); return best; });
            expect(best).toBeGreaterThanOrEqual(210);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { best = 0; score = 130; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('tapper-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(130);
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 2; endGame(); });
            await expect(page.locator('#btn-start')).toHaveText(/Play Again/i);
        });

        test('restarting resets score, lives and wave', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 99; lives = 0; wave = 7; endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#wave')).toHaveText('1');
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
            await expect(page.locator('#overlay-title')).toContainText(/Paused/i);
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('patrons do not advance while paused', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                patrons = [{ lane: 0, x: 100, vx: 40 }];
            });
            await page.keyboard.press('p');
            const before = await page.evaluate(() => patrons.length ? patrons[0].x : null);
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => patrons.length ? patrons[0].x : null);
            expect(after).toBe(before);
        });
    });
});
