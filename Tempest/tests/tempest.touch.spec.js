const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Tempest on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Tempest'); });

    test('fits the screen with rotate, fire, zap and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'z', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('rotate, fire, zap and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const l0 = await page.evaluate(() => player.lane);
        await T.tapControl(page, 'ArrowRight');
        await expect.poll(() => page.evaluate(() => player.lane)).not.toBe(l0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await page.evaluate(() => { window.__zap = 0; const f = superzap; superzap = () => { __zap++; return f(); }; });
        await T.tapControl(page, 'z');
        await expect.poll(() => page.evaluate(() => __zap)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
