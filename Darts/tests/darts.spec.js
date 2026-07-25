const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Darts (501)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Darts', async ({ page }) => {
            await expect(page).toHaveTitle('Darts');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press Space', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Space');
        });

        test('remaining starts at 501', async ({ page }) => {
            await expect(page.locator('#remaining')).toHaveText('501');
        });

        test('darts thrown starts at 0', async ({ page }) => {
            await expect(page.locator('#darts')).toHaveText('0');
        });

        test('best starts as a dash when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state starts idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
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

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('aim phase starts on x', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => phase)).toBe('x');
        });
    });

    // -----------------------------------------------------------------------
    // Board scoring geometry (pure scoreDart)
    // -----------------------------------------------------------------------
    test.describe('board scoring', () => {
        async function score(page, fx, fy) {
            // fx, fy are offsets from the centre expressed in fractions of R
            return page.evaluate(({ fx, fy }) => scoreDart(CX + fx * R, CY + fy * R),
                { fx, fy });
        }

        test('centre is a 50 bullseye', async ({ page }) => {
            const s = await score(page, 0, 0);
            expect(s.value).toBe(50);
        });

        test('just outside the bull is a 25', async ({ page }) => {
            const s = await score(page, 0, -0.07); // r = 0.07 → outer bull
            expect(s.value).toBe(25);
        });

        test('top single sector is 20', async ({ page }) => {
            const s = await score(page, 0, -0.5);
            expect(s.value).toBe(20);
            expect(s.mult).toBe(1);
        });

        test('top triple sector is 60', async ({ page }) => {
            const s = await score(page, 0, -0.6);
            expect(s.value).toBe(60);
            expect(s.mult).toBe(3);
        });

        test('top double sector is 40', async ({ page }) => {
            const s = await score(page, 0, -0.98);
            expect(s.value).toBe(40);
            expect(s.mult).toBe(2);
        });

        test('3 o\'clock sector is 6', async ({ page }) => {
            const s = await score(page, 0.5, 0);
            expect(s.value).toBe(6);
        });

        test('9 o\'clock sector is 11', async ({ page }) => {
            const s = await score(page, -0.5, 0);
            expect(s.value).toBe(11);
        });

        test('6 o\'clock sector is 3', async ({ page }) => {
            const s = await score(page, 0, 0.5);
            expect(s.value).toBe(3);
        });

        test('outside the board is a miss worth 0', async ({ page }) => {
            const s = await score(page, 1.2, 0);
            expect(s.value).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Throwing and scoring
    // -----------------------------------------------------------------------
    test.describe('throwing', () => {
        test('a single 20 subtracts 20 from the total', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => throwDart(CX, CY - 0.5 * R)); // single 20
            await expect(page.locator('#remaining')).toHaveText('481');
        });

        test('throwing increments the dart count', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => throwDart(CX, CY - 0.5 * R));
            await expect(page.locator('#darts')).toHaveText('1');
        });

        test('a turn is three darts, then resets', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                throwDart(CX, CY - 0.5 * R);
                throwDart(CX, CY - 0.5 * R);
                throwDart(CX, CY - 0.5 * R);
            });
            expect(await page.evaluate(() => dartsThisTurn)).toBe(0);
            await expect(page.locator('#darts')).toHaveText('3');
        });

        test('clicking the board throws a dart', async ({ page }) => {
            await page.keyboard.press('Space');
            const box = await page.locator('#canvas').boundingBox();
            // click near the centre → scores, dart count rises
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            const darts = parseInt(await page.locator('#darts').textContent(), 10);
            expect(darts).toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Bust rules (double-out)
    // -----------------------------------------------------------------------
    test.describe('bust rules', () => {
        test('overshooting below zero busts and reverts the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 10; turnStart = 10; dartsThisTurn = 0; });
            await page.evaluate(() => throwDart(CX, CY - 0.5 * R)); // 20 > 10
            await expect(page.locator('#remaining')).toHaveText('10');
        });

        test('landing on 1 busts (cannot finish on a double)', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 21; turnStart = 21; dartsThisTurn = 0; });
            await page.evaluate(() => throwDart(CX, CY - 0.5 * R)); // 20 → leaves 1
            await expect(page.locator('#remaining')).toHaveText('21');
        });

        test('finishing on a single busts', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 20; turnStart = 20; dartsThisTurn = 0; });
            await page.evaluate(() => throwDart(CX, CY - 0.5 * R)); // single 20 → 0 but not a double
            await expect(page.locator('#remaining')).toHaveText('20');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('finishing on a double reaches zero and ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; });
            await page.evaluate(() => throwDart(CX, CY - 0.98 * R)); // double 20 = 40
            await expect(page.locator('#remaining')).toHaveText('0');
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('finishing on the bullseye wins', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 50; turnStart = 50; dartsThisTurn = 0; });
            await page.evaluate(() => throwDart(CX, CY)); // bull 50 counts as a double
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('win overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; throwDart(CX, CY - 0.98 * R); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('won');
        });

        test('Play Again button appears after a win', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; throwDart(CX, CY - 0.98 * R); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Best score persistence
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best updates to the darts used on a win', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; totalDarts = 8; throwDart(CX, CY - 0.98 * R); });
            await expect(page.locator('#best')).toHaveText('9'); // 8 prior + the finishing dart
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; totalDarts = 8; throwDart(CX, CY - 0.98 * R); });
            const stored = await page.evaluate(() => localStorage.getItem('darts-best'));
            expect(parseInt(stored, 10)).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('restarting resets remaining and dart count', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { remaining = 40; turnStart = 40; dartsThisTurn = 0; throwDart(CX, CY - 0.98 * R); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('Space'); // start again
            await expect(page.locator('#remaining')).toHaveText('501');
            await expect(page.locator('#darts')).toHaveText('0');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Two-stage aim
    // -----------------------------------------------------------------------
    test.describe('two-stage aim', () => {
        test('Space locks the horizontal aim, moving to phase y', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.keyboard.press('Space'); // lock x
            expect(await page.evaluate(() => phase)).toBe('y');
        });

        test('a second Space releases a dart and returns to phase x', async ({ page }) => {
            await page.keyboard.press('Space'); // start
            await page.keyboard.press('Space'); // lock x
            await page.keyboard.press('Space'); // throw
            const darts = parseInt(await page.locator('#darts').textContent(), 10);
            expect(darts).toBeGreaterThanOrEqual(1);
            expect(await page.evaluate(() => phase)).toBe('x');
        });
    });
});
