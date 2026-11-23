const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Ultimate Tic-Tac-Toe on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'UltimateTicTacToe'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.getByText(/Click/)).toHaveCount(0);
    });

    test('tapping a cell plays X there', async ({ page }) => {
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const pt = await T.findCanvasPoint(page, '(x, y) => { const c = pixelToCell(x, y); return c && c[0] === 4 && c[1] === 4 ? 1 : undefined; }', 1);
        await T.tapCanvas(page, page.locator('canvas'), pt[0], pt[1]);
        await expect.poll(() => page.evaluate(() => boards[4][4] === X)).toBe(true);
    });
});
