const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Galaga on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Galaga'); });

    test('fits the screen with move, fire and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad flies and fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => player.x)).toBeLessThan(x0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => playerBullets.length)).toBeGreaterThan(0);
    });
});
