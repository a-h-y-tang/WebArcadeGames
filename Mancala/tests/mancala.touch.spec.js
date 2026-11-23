const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Mancala on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Mancala'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|press 1/i);
    });

    test('tapping one of your pits sows it', async ({ page }) => {
        const c = await page.evaluate(() => pitCenter(2));
        const before = await page.evaluate(() => JSON.stringify(board));
        await T.tapCanvas(page, page.locator('#canvas'), c.x, c.y);
        await expect.poll(() => page.evaluate(() => JSON.stringify(board))).not.toBe(before);
    });
});
