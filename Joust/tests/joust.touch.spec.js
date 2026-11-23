const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Joust on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Joust'); });

    test('fits the screen with steer, flap and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('flap starts and lifts, the pad steers', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => player.vy)).toBeLessThan(0);
        await T.touchDown(page, T.control(page, 'ArrowRight'));
        await expect.poll(() => page.evaluate(() => input.right)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => input.right)).toBe(false);
    });
});
