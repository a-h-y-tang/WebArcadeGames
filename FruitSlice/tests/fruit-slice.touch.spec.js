const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Fruit Slice on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FruitSlice'); });

    test('fits the screen with a pause button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
    });

    test('a finger swipe draws the blade and pause works', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.drag(page, page.locator('#canvas'), [0.2, 0.5], [0.8, 0.5]);
        expect(await page.evaluate(() => trail.length)).toBeGreaterThan(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
