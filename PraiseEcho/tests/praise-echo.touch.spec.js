const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Praise Echo on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PraiseEcho'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|press 1|Press Space/i);
    });

    test('tapping the right pad echoes the melody', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await page.waitForFunction(() => state === 'input', null, { timeout: 8000 });
        const pad = await page.evaluate(() => sequence[0]);
        const p = await T.findCanvasPoint(page, '(x, y) => padAtPoint(x, y)', pad, '#canvas');
        await T.tapCanvas(page, page.locator('#canvas'), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => playerPos > 0 || score > 0)).toBe(true);
    });
});
