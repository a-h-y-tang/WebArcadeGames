const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Barrel Climb on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BarrelClimb'); });

    test('fits the screen with a d-pad, jump and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('jump starts the game, the pad walks and jump jumps', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowRight'), 400);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        await page.waitForTimeout(200);
        await T.touchDown(page, T.control(page, ' '));
        await expect.poll(() => page.evaluate(() => player.onGround)).toBe(false);
        await T.touchUp(page);
    });
});
