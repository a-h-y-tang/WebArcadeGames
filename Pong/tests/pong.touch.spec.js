const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pong on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Pong'); });

    test('fits the screen with up/down and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('drag or the buttons move the paddle', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.drag(page, page.locator('#canvas'), [0.1, 0.5], [0.1, 0.15]);
        const y1 = await page.evaluate(() => player.y);
        expect(y1).toBeLessThan(150);
        await T.hold(page, T.control(page, 'ArrowDown'), 300);
        expect(await page.evaluate(() => player.y)).toBeGreaterThan(y1);
    });
});
