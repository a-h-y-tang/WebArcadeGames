const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Road Rush on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RoadRush'); });

    test('fits the screen with lane and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('buttons and swipes change lanes', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const l0 = await page.evaluate(() => player.lane);
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => player.lane)).toBe(Math.max(0, l0 - 1));
        const l1 = await page.evaluate(() => player.lane);
        await T.swipe(page, page.locator('#canvas'), 'right');
        await expect.poll(() => page.evaluate(() => player.lane)).toBe(l1 + 1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
