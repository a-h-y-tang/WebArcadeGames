const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Hex on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Hex'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping a hex places a stone', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const p = await T.findCanvasPoint(page, '(x, y) => { const c = cellFromPoint(x, y); return c ? [c.r, c.c] : undefined; }', [3, 3], '#canvas');
        await T.tapCanvas(page, page.locator('#canvas'), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => moveCount)).toBeGreaterThan(0);
        expect(await page.evaluate(() => board[3][3])).not.toBe(0);
    });
});
