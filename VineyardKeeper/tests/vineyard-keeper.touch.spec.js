const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Vineyard Keeper on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'VineyardKeeper'); });

    test('fits the screen with a d-pad, flick and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Space|WASD/)).toHaveCount(0);
    });

    test('move, flick and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => player.x)).toBe(x0 - 1);
        await page.evaluate(() => { window.__flicks = 0; const f = fire; fire = () => { __flicks++; return f(); }; });
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => __flicks)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
