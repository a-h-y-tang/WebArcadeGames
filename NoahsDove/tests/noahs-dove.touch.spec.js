const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Noah's Dove on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'NoahsDove'); });

    test('fits the screen with a pause button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/Space/);
    });

    test('tapping starts and flaps', async ({ page }) => {
        await T.tapAt(page, page.locator('#overlay'), 0.5, 0.3);
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.waitForTimeout(250);
        await T.tapAt(page, page.locator('#canvas'), 0.5, 0.5);
        expect(await page.evaluate(() => bird.vy)).toBeLessThan(0);
    });
});
