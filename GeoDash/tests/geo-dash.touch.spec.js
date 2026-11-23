const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Geo Dash on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'GeoDash'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
    });

    test('pick a level, then tap to jump', async ({ page }) => {
        page.on('dialog', (d) => d.dismiss());
        await page.locator('.level-card').first().tap();
        await expect.poll(() => page.evaluate(() => state.isMenuOpen)).toBe(false);
        await T.touchDown(page, page.locator('#gameCanvas'));
        await expect.poll(() => page.evaluate(() => state.hasStarted && state.isPressing)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => state.isPressing)).toBe(false);
    });
});
