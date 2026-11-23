const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Slime Volley on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SlimeVolley'); });

    test('fits the screen with move, jump and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('move, jump and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        await page.waitForTimeout(300);
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => player.y)).toBeLessThan(await page.evaluate(() => GROUND_Y));
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
