const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('RallyChase on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RallyChase'); });

    test('fits the screen with a d-pad, smoke and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('smoke starts, arrows and swipes steer, smoke lays smoke', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const d0 = await page.evaluate(() => JSON.stringify(car.want));
        for (const k of ['ArrowDown', 'ArrowLeft']) await T.tapControl(page, k);
        const d1 = await page.evaluate(() => JSON.stringify(car.want));
        await T.swipe(page, page.locator('#canvas'), 'up');
        const d2 = await page.evaluate(() => JSON.stringify(car.want));
        expect(new Set([d0, d1, d2]).size).toBeGreaterThan(1);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => smokes.length)).toBeGreaterThan(0);
    });
});
