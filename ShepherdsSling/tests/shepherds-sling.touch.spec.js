const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Shepherd's Sling on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ShepherdsSling'); });

    test('fits the screen with up/down, sling and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('ride the basket, sling a stone and pause', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => basket.y);
        await T.hold(page, T.control(page, 'ArrowDown'), 300);
        expect(await page.evaluate(() => basket.y)).toBeGreaterThan(y0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => arrows.length)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
