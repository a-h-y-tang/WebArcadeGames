const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pyramid Solitaire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PyramidSolitaire'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('.help .tc-hint')).toContainText('tap the stock');
    });

    test('tapping the stock deals a card', async ({ page }) => {
        const n = await page.evaluate(() => stock.length);
        const p = await page.evaluate(() => [STOCK_X + CARD_W / 2, PILE_Y + CARD_H / 2]);
        await T.tapCanvas(page, page.locator('#canvas'), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => stock.length)).toBe(n - 1);
    });
});
