const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Columns on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Columns'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('an arrow starts, the pad moves and taps shuffle the column', async ({ page }) => {
        await T.tapControl(page, 'ArrowDown');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const c0 = await page.evaluate(() => piece.col);
        await T.tapControl(page, 'ArrowLeft');
        expect(await page.evaluate(() => piece.col)).toBe(c0 - 1);
        const cells = await page.evaluate(() => piece.cells.join());
        await T.tapAt(page, page.locator('#canvas'), 0.5, 0.5);
        expect(await page.evaluate(() => piece.cells.join())).not.toBe(cells);
    });
});
