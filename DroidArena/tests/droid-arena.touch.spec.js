const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Droid Arena on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'DroidArena'); });

    test('fits the screen with move and aim pads', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the left pad moves and the right pad shoots, at the same time', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.touchDown(page, T.control(page, 'a'), 1);
        await T.touchDown(page, T.control(page, 'ArrowUp'), 2);
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await page.waitForTimeout(200);
        await T.touchUp(page, 2);
        await T.touchUp(page, 1);
        expect(await page.evaluate(() => player.x)).toBeLessThan(x0);
        expect(await page.evaluate(() => player.aimY)).toBe(-1);
    });
});
