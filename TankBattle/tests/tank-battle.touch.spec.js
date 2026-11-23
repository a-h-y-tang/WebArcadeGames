const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Tank Battle on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TankBattle'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('drive, fire and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const p0 = await page.evaluate(() => [player.x, player.y]);
        await T.hold(page, T.control(page, 'ArrowUp'), 400);
        expect(await page.evaluate(() => [player.x, player.y])).not.toEqual(p0);
        await page.evaluate(() => { window.__fired = 0; const f = fire; fire = (t) => { if (t === player) __fired++; return f(t); }; });
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => __fired)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
