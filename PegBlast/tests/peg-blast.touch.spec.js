const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('PegBlast on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PegBlast'); });

    test('fits the screen with a pause button and touch help', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.locator('.help .tc-hint')).toBeVisible();
    });

    test('drag to aim, lift to fire', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await page.waitForTimeout(200);
        const a0 = await page.evaluate(() => aimAngle);
        await T.drag(page, page.locator('#canvas'), [0.5, 0.5], [0.2, 0.6]);
        expect(await page.evaluate(() => aimAngle)).not.toBe(a0);
        await expect.poll(() => page.evaluate(() => state !== 'aiming')).toBe(true);
    });
});
