const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Frostbite on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Frostbite'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('arrows hop and walk; swipes hop', async ({ page }) => {
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        const hops = await page.evaluate(() => {
            window.__hops = [];
            const orig = hopVertical;
            hopVertical = (d) => { window.__hops.push(d); };
            return window.__hops;
        });
        expect(hops).toEqual([]);
        await T.tapControl(page, 'ArrowUp');
        await T.tapControl(page, 'ArrowDown');
        await T.swipe(page, page.locator('#canvas'), 'up');
        expect(await page.evaluate(() => window.__hops)).toEqual([-1, 1, -1]);
    });
});
