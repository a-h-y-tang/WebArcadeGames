const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Berzerk on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Berzerk'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad moves and fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => player.y);
        await T.hold(page, T.control(page, 'ArrowUp'), 250);
        expect(await page.evaluate(() => player.y)).toBeLessThan(y0);
        await T.touchDown(page, T.control(page, ' '));
        await expect.poll(() => page.evaluate(() => bullets.some((b) => b.owner === 'player'))).toBe(true);
        await T.touchUp(page);
    });
});
