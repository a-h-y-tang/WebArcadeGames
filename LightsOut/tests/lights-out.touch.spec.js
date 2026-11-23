const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Lights Out on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LightsOut'); });

    test('fits the screen with new and reset buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['n', 'r']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tapping a tile flips it; reset restores the board', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const g0 = await page.evaluate(() => JSON.stringify(grid));
        await T.tapCanvas(page, page.locator('#canvas'), 120, 120);
        await expect.poll(() => page.evaluate(() => moves)).toBe(1);
        expect(await page.evaluate(() => JSON.stringify(grid))).not.toBe(g0);
        await T.tapControl(page, 'r');
        await expect.poll(() => page.evaluate(() => JSON.stringify(grid))).toBe(g0);
    });
});
