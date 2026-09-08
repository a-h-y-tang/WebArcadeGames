const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Every test drives the simulation itself through step(dt) instead of leaning on
// requestAnimationFrame, and turns the random customer arrivals off so the only
// things on the counters are the ones the test put there.
async function boot(page, { spawning = false, running = true } = {}) {
    await page.goto(GAME_URL);
    await page.evaluate(() => setAutoStep(false));
    if (running) await page.evaluate(() => startGame());
    await page.evaluate((on) => setSpawning(on), spawning);
}

const snapshot = (page) => page.evaluate(() => getState());
const config = (page) => page.evaluate(() => getConfig());
const step = (page, dt, times = 1) =>
    page.evaluate(({ dt, times }) => {
        for (let i = 0; i < times; i++) step(dt);
    }, { dt, times });

test.describe('Soda Tapper', () => {
    // -----------------------------------------------------------------------
    // Page shell
    // -----------------------------------------------------------------------
    test.describe('page shell', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page, { running: false });
        });

        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
        });

        test('canvas is present with the documented size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, wave 1 and three lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('help text lists the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText('P');
        });

        test('game is idle before the player starts', async ({ page }) => {
            expect((await snapshot(page)).state).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Start button starts the game and hides the overlay', async ({ page }) => {
            await boot(page, { running: false });
            await page.locator('#btn-start').click();
            expect((await snapshot(page)).state).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game from the title screen', async ({ page }) => {
            await boot(page, { running: false });
            await page.keyboard.press('Space');
            expect((await snapshot(page)).state).toBe('running');
        });

        test('a fresh game has no customers or mugs on the counters', async ({ page }) => {
            await boot(page);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.mugs).toHaveLength(0);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
        });

        test('the wave starts with customers still to arrive', async ({ page }) => {
            await boot(page);
            expect((await snapshot(page)).remaining).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('moving between counters', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('the jerk starts on the top counter', async ({ page }) => {
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('ArrowDown moves down one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(1);
        });

        test('ArrowUp moves back up one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect((await snapshot(page)).lane).toBe(1);
        });

        test('W and S also move between counters', async ({ page }) => {
            await page.keyboard.press('KeyS');
            expect((await snapshot(page)).lane).toBe(1);
            await page.keyboard.press('KeyW');
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('counters do not wrap at the top', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('counters do not wrap at the bottom', async ({ page }) => {
            const { LANES } = await config(page);
            for (let i = 0; i < LANES + 3; i++) await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(LANES - 1);
        });

        test('movement is ignored before the game starts', async ({ page }) => {
            await page.goto(GAME_URL);
            await page.evaluate(() => setAutoStep(false));
            await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('Space pours a mug on the current counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(1);
            expect(s.mugs[0].lane).toBe(1);
            expect(s.mugs[0].empty).toBe(false);
        });

        test('a poured mug starts at the tap end and travels left', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            await page.keyboard.press('Space');
            const before = (await snapshot(page)).mugs[0].x;
            expect(before).toBeGreaterThan(BAR_RIGHT - 40);
            await step(page, 0.1);
            const after = (await snapshot(page)).mugs[0].x;
            expect(after).toBeLessThan(before);
        });

        test('the pour cooldown stops a held key from flooding the counter', async ({ page }) => {
            await page.evaluate(() => { pour(); pour(); pour(); });
            expect((await snapshot(page)).mugs).toHaveLength(1);
        });

        test('a mug can be poured again after the cooldown elapses', async ({ page }) => {
            const { POUR_COOLDOWN } = await config(page);
            await page.evaluate(() => pour());
            await step(page, POUR_COOLDOWN + 0.02);
            await page.evaluate(() => pour());
            expect((await snapshot(page)).mugs).toHaveLength(2);
        });

        test('pouring does nothing while the game is not running', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.evaluate(() => pour());
            expect((await snapshot(page)).mugs).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('a customer walks toward the taps', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            const before = (await snapshot(page)).patrons[0].x;
            await step(page, 0.2, 5);
            expect((await snapshot(page)).patrons[0].x).toBeGreaterThan(before);
        });

        test('customers arrive on their own once spawning is on', async ({ page }) => {
            await page.evaluate(() => { setSeed(7); setSpawning(true); });
            await step(page, 0.1, 60);
            expect((await snapshot(page)).patrons.length).toBeGreaterThan(0);
        });

        test('a customer reaching the taps costs a life', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            await page.evaluate((x) => spawnPatron(0, x), BAR_RIGHT - 6);
            await step(page, 0.1, 20);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.patrons).toHaveLength(0);
        });

        test('losing a life clears the counters', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            await page.evaluate((x) => {
                spawnPatron(0, x);
                spawnPatron(2);
                pour();
            }, BAR_RIGHT - 6);
            await step(page, 0.1, 20);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.mugs).toHaveLength(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('a mug that meets a customer is drunk and shoves them back', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0, 300));
            await page.evaluate(() => pour());
            await step(page, 1 / 60, 240);
            const s = await snapshot(page);
            expect(s.mugs.filter((m) => !m.empty)).toHaveLength(0);
            expect(s.patrons[0].x).toBeLessThan(300);
        });

        test('a mug that meets nobody shatters at the open end and costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await step(page, 1 / 60, 300);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(0);
            expect(s.lives).toBe(2);
        });

        test('shoving a customer off the open end serves them and scores', async ({ page }) => {
            const { BAR_LEFT, PUSH_DISTANCE } = await config(page);
            await page.evaluate((x) => spawnPatron(0, x), BAR_LEFT + PUSH_DISTANCE / 2);
            await page.evaluate(() => pour());
            await step(page, 1 / 60, 400);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.score).toBeGreaterThan(0);
            expect(s.lives).toBe(3);
        });

        test('a served customer sends an empty mug back up the counter', async ({ page }) => {
            const { BAR_LEFT, PUSH_DISTANCE } = await config(page);
            await page.evaluate((x) => spawnPatron(0, x), BAR_LEFT + PUSH_DISTANCE / 2);
            await page.evaluate(() => pour());
            // Stop while the empty mug is still travelling back up the counter.
            await step(page, 1 / 60, 200);
            const s = await snapshot(page);
            const empties = s.mugs.filter((m) => m.empty);
            expect(empties).toHaveLength(1);
            expect(empties[0].lane).toBe(0);
        });

        test('a customer pauses to drink before walking on', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0, 300));
            await page.evaluate(() => pour());
            await step(page, 1 / 60, 120);
            const drinking = (await snapshot(page)).patrons[0];
            expect(drinking.drinking).toBe(true);
            const x = drinking.x;
            await step(page, 1 / 60, 5);
            expect((await snapshot(page)).patrons[0].x).toBeCloseTo(x, 1);
        });

        test('serving needs more than one mug when the customer is far from the end', async ({ page }) => {
            const { BAR_LEFT, PUSH_DISTANCE } = await config(page);
            await page.evaluate((x) => spawnPatron(0, x), BAR_LEFT + PUSH_DISTANCE * 3);
            await page.evaluate(() => pour());
            await step(page, 1 / 60, 400);
            expect((await snapshot(page)).patrons).toHaveLength(1);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('an empty mug caught in the right lane scores and keeps the life', async ({ page }) => {
            const { BAR_RIGHT, CATCH_POINTS } = await config(page);
            await page.evaluate((x) => spawnEmptyMug(0, x), BAR_RIGHT - 20);
            await step(page, 1 / 60, 60);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(0);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(CATCH_POINTS);
        });

        test('an empty mug on another counter shatters and costs a life', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            await page.evaluate((x) => spawnEmptyMug(2, x), BAR_RIGHT - 20);
            await step(page, 1 / 60, 60);
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.score).toBe(0);
        });

        test('an empty mug travels to the right', async ({ page }) => {
            await page.evaluate(() => spawnEmptyMug(0, 200));
            await step(page, 0.05);
            expect((await snapshot(page)).mugs[0].x).toBeGreaterThan(200);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every customer advances the wave and scores a bonus', async ({ page }) => {
            await boot(page);
            const { LEVEL_BONUS } = await config(page);
            await page.evaluate(() => setRemaining(0));
            await step(page, 1 / 60, 5);
            const s = await snapshot(page);
            expect(s.level).toBe(2);
            expect(s.score).toBeGreaterThanOrEqual(LEVEL_BONUS);
            expect(s.remaining).toBeGreaterThan(0);
        });

        test('a later wave sends more customers', async ({ page }) => {
            await boot(page);
            const first = (await snapshot(page)).remaining;
            await page.evaluate(() => setRemaining(0));
            await step(page, 1 / 60, 5);
            expect((await snapshot(page)).remaining).toBeGreaterThan(first);
        });

        test('the wave does not advance while a mug is still in play', async ({ page }) => {
            await boot(page);
            await page.evaluate(() => { setRemaining(0); pour(); });
            await step(page, 1 / 60, 5);
            expect((await snapshot(page)).level).toBe(1);
        });

        test('customers walk faster in later waves', async ({ page }) => {
            await boot(page);
            const slow = await page.evaluate(() => {
                spawnPatron(0, 100);
                const before = getState().patrons[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return getState().patrons[0].x - before;
            });
            const fast = await page.evaluate(() => {
                clearBoard();
                setRemaining(0);
                for (let i = 0; i < 5; i++) step(1 / 60);   // wave 2
                clearBoard();
                setRemaining(0);
                for (let i = 0; i < 5; i++) step(1 / 60);   // wave 3
                clearBoard();
                spawnPatron(0, 100);
                const before = getState().patrons[0].x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return getState().patrons[0].x - before;
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('P pauses the game and shows the overlay', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect((await snapshot(page)).state).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect((await snapshot(page)).state).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0, 200));
            await page.keyboard.press('KeyP');
            await step(page, 0.2, 10);
            expect((await snapshot(page)).patrons[0].x).toBeCloseTo(200, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await boot(page);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            for (let i = 0; i < 3; i++) {
                await page.evaluate((x) => spawnPatron(0, x), BAR_RIGHT - 6);
                await step(page, 0.1, 20);
            }
            const s = await snapshot(page);
            expect(s.lives).toBe(0);
            expect(s.state).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            for (let i = 0; i < 3; i++) {
                await page.evaluate((x) => spawnPatron(0, x), BAR_RIGHT - 6);
                await step(page, 0.1, 20);
            }
            await page.evaluate(() => spawnPatron(0, 100));
            const before = (await snapshot(page)).patrons[0].x;
            await step(page, 0.2, 10);
            expect((await snapshot(page)).patrons[0].x).toBeCloseTo(before, 1);
        });

        test('starting again resets score, lives and wave', async ({ page }) => {
            const { BAR_RIGHT } = await config(page);
            for (let i = 0; i < 3; i++) {
                await page.evaluate((x) => spawnPatron(0, x), BAR_RIGHT - 6);
                await step(page, 0.1, 20);
            }
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // HUD and best score
    // -----------------------------------------------------------------------
    test.describe('HUD and best score', () => {
        test('the HUD tracks score, lives and wave', async ({ page }) => {
            await boot(page);
            const { BAR_LEFT, PUSH_DISTANCE, SERVE_POINTS } = await config(page);
            await page.evaluate((x) => spawnPatron(0, x), BAR_LEFT + PUSH_DISTANCE / 2);
            await page.evaluate(() => pour());
            // Stop before the returning empty mug is caught, so only the serve scores.
            await step(page, 1 / 60, 200);
            await expect(page.locator('#score')).toHaveText(String(SERVE_POINTS));
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('the best score is remembered across reloads', async ({ page }) => {
            await boot(page);
            const { BAR_RIGHT, CATCH_POINTS } = await config(page);
            await page.evaluate((x) => spawnEmptyMug(0, x), BAR_RIGHT - 20);
            await step(page, 1 / 60, 60);
            // End the game so the best score is written out.
            for (let i = 0; i < 3; i++) {
                await page.evaluate((x) => spawnPatron(0, x), BAR_RIGHT - 6);
                await step(page, 0.1, 20);
            }
            await page.reload();
            await expect(page.locator('#best')).toHaveText(String(CATCH_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas draws the counters', async ({ page }) => {
            await boot(page, { running: false });
            const painted = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const { data } = ctx.getImageData(0, 0, 720, 460);
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(painted).toBeGreaterThan(3);
        });

        test('customers and mugs are drawn on the counters', async ({ page }) => {
            await boot(page);
            const blank = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                return ctx.getImageData(0, 0, 720, 460).data.join(',');
            });
            await page.evaluate(() => { spawnPatron(0, 300); spawnPatron(2, 200); pour(); });
            const painted = await page.evaluate(() => {
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                return ctx.getImageData(0, 0, 720, 460).data.join(',');
            });
            expect(painted).not.toBe(blank);
        });
    });
});
