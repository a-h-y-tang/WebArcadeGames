const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Breastplate Gems on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BreastplateGems'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
    });

    test('tapping a gem selects it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).not.toBe('idle');
        await T.tapCanvas(page, page.locator('#canvas'), 30 + 60 * 2, 30 + 60 * 3);
        expect(await page.evaluate(() => selected)).toEqual({ r: 3, c: 2 });
    });
});
