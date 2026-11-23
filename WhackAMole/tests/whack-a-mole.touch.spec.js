const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Whack-a-Mole on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'WhackAMole'); });

    test('fits the screen with a pause button and tap wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.getByText(/Click|Press Space/)).toHaveCount(0);
    });

    test('tapping a hole whacks it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const h = await page.evaluate(() => { const h = holes[4]; h.state = 'up'; h.timer = 99; return { x: h.x, y: h.y }; });
        await T.tapCanvas(page, page.locator('#canvas'), h.x, h.y);
        await expect.poll(() => page.evaluate(() => score)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
