const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Ark Builder on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ArkBuilder'); });

    test('fits the screen with touch instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText('Press space');
    });

    test('tapping the yard drops a block', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.waitForTimeout(300);
        await T.tapAt(page, page.locator('#canvas'));
        await expect.poll(() => page.evaluate(() => tower.length)).toBeGreaterThan(1);
    });
});
