const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Bible Words on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BibleWords'); });

    test('fits the screen and says tap, not Space', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText('Press Space');
    });

    test('tapping the on-screen keyboard types letters', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const k = await page.evaluate(() => keyRects.find((r) => /^[a-zA-Z]$/.test(r.key)));
        await T.tapCanvas(page, page.locator('#canvas'), k.x + k.w / 2, k.y + k.h / 2);
        await expect.poll(() => page.evaluate(() => current.length)).toBe(1);
    });
});
