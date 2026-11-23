const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Asteroids on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Asteroids'); });

    test('fits the screen and shows rotate, thrust, fire and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts the game, then rotate, thrust and fire work by touch', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a0 = await page.evaluate(() => ship.angle);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => ship.angle)).not.toBe(a0);
        await T.hold(page, T.control(page, 'ArrowUp'), 300);
        expect(await page.evaluate(() => Math.hypot(ship.vx, ship.vy))).toBeGreaterThan(0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        expect(await page.evaluate(() => keys.left || keys.right || keys.thrust)).toBe(false);
    });

    test('pause button pauses', async ({ page }) => {
        await T.tapControl(page, ' ');
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
