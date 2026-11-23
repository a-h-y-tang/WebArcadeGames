const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Stained Glass Hop on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'StainedGlassHop'); });

    test('fits the screen with four diagonal hop buttons and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/arrow key|WASD/)).toHaveCount(0);
        await expect(page.getByText('Q*bert')).toHaveCount(0);
    });

    test('a hop button starts the game and hops', async ({ page }) => {
        await T.tapControl(page, 'ArrowDown');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.evaluate(() => { autoSpawn = false; });
        await page.waitForTimeout(400);
        await T.tapControl(page, 'ArrowRight');
        await expect.poll(() => page.evaluate(() => qbert.r)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
