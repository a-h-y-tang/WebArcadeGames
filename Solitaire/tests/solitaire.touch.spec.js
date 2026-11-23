const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Solitaire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Solitaire'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tap the stock to draw, double-tap to send an ace home', async ({ page }) => {
        await page.evaluate(() => loadState({ stock: [{ rank: 1, suit: 'S' }], tableau: [[{ rank: 13, suit: 'H' }]] }));
        const cv = page.locator('#canvas');
        const s = await page.evaluate(() => stockRect());
        await T.tapCanvas(page, cv, s.x + s.w / 2, s.y + s.h / 2);
        await expect.poll(() => page.evaluate(() => waste.length)).toBe(1);
        const w = await page.evaluate(() => wasteRect());
        await page.waitForTimeout(350);
        await T.tapCanvas(page, cv, w.x + w.w / 2, w.y + w.h / 2);
        await page.waitForTimeout(80);
        await T.tapCanvas(page, cv, w.x + w.w / 2, w.y + w.h / 2);
        await expect.poll(() => page.evaluate(() => foundations.some((f) => f.length === 1))).toBe(true);
    });
});
