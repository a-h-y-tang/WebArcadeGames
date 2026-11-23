const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Noah's Ark Pairs on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'NoahsArkPairs'); });

    test('fits the screen with a pause button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
    });

    test('tapping a card flips it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const r = await page.evaluate(() => cardRect(5));
        await T.tapCanvas(page, page.locator('#canvas'), r.x + r.w / 2, r.y + r.h / 2);
        await expect.poll(() => page.evaluate(() => firstPick)).toBe(5);
    });
});
