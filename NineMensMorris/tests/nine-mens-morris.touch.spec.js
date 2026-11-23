const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Nine Men's Morris on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'NineMensMorris'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|Press Space/i);
    });

    test('tapping a point places a piece', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapCanvas(page, page.locator('#canvas'), 50, 50);
        await expect.poll(() => page.evaluate(() => board[0])).toBeTruthy();
    });
});
