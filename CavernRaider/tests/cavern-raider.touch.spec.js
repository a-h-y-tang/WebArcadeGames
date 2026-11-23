const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Cavern Raider on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'CavernRaider'); });

    test('fits the screen with a d-pad, laser, bomb and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'x', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('laser starts, the pad flies and bomb drops a bomb', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => ship.y);
        await T.hold(page, T.control(page, 'ArrowUp'), 300);
        expect(await page.evaluate(() => ship.y)).toBeLessThan(y0);
        await T.tapControl(page, 'x');
        await expect.poll(() => page.evaluate(() => bombs.length)).toBeGreaterThan(0);
    });
});
