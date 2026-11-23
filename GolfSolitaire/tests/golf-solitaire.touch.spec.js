const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Golf Solitaire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'GolfSolitaire'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|press Space|N for a new/i);
    });

    test('tapping the stock flips a card', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const n = await page.evaluate(() => stock.length);
        await T.tapCanvas(page, page.locator('#canvas'), ...(await page.evaluate(() => [STOCK_X + CARD_W / 2, PILE_Y + CARD_H / 2])));
        await expect.poll(() => page.evaluate(() => stock.length)).toBe(n - 1);
    });
});
