const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Lunar Lander on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LunarLander'); });

    test('fits the screen with rotate, thrust and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('thrust starts, the pad rotates and thrust burns fuel', async ({ page }) => {
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a0 = await page.evaluate(() => lander.angle);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => lander.angle)).not.toBe(a0);
        const f0 = await page.evaluate(() => lander.fuel);
        await T.hold(page, T.control(page, 'ArrowUp'), 300);
        expect(await page.evaluate(() => lander.fuel)).toBeLessThan(f0);
    });
});
