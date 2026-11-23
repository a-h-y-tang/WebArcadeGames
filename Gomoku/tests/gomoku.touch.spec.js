const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Gomoku on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Gomoku'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping an intersection places a stone', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapCanvas(page, page.locator('#canvas'), 32 + 34 * 7, 32 + 34 * 7);
        await expect.poll(() => page.evaluate(() => board[7][7])).not.toBe(0);
    });
});
