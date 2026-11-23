const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Quoridor on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Quoridor'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('.help')).not.toContainText(/click/i);
        await expect(page.getByText('rotate wall')).toBeHidden();
    });

    test('tapping a glowing square moves the pawn', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const p = await T.findCanvasPoint(page, '(x, y) => { const c = cellFromPoint(x, y); return c ? [c.r, c.c] : undefined; }', [7, 4], '#canvas');
        await T.tapCanvas(page, page.locator('#canvas'), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => pawns[0])).toEqual({ r: 7, c: 4 });
    });
});
