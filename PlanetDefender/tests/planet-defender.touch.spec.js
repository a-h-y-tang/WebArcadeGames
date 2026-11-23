const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Planet Defender on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PlanetDefender'); });

    test('fits the screen with a d-pad, laser, bomb and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'b', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('laser starts, the pad flies and laser fires', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => ship.y);
        await T.hold(page, T.control(page, 'ArrowDown'), 300);
        expect(await page.evaluate(() => ship.y)).toBeGreaterThan(y0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => bullets.length)).toBeGreaterThan(0);
    });
});
