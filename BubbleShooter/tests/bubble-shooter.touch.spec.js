const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Bubble Shooter on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BubbleShooter'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
    });

    test('drag to aim, lift to fire', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('ready');
        const a0 = await page.evaluate(() => shooter.angle);
        await T.drag(page, page.locator('#canvas'), [0.5, 0.6], [0.15, 0.4]);
        expect(await page.evaluate(() => shooter.angle)).not.toBe(a0);
        await expect.poll(() => page.evaluate(() => shotsFired)).toBe(1);
    });
});
