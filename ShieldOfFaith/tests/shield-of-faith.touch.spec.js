const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Shield of Faith on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ShieldOfFaith'); });

    test('fits the screen with a pause button and tap wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.getByText(/Click|Press Space/)).toHaveCount(0);
    });

    test('tapping the sky raises a shield', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapCanvas(page, page.locator('#canvas'), 300, 150);
        await expect.poll(() => page.evaluate(() => interceptors.length)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
