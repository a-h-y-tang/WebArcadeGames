const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Dino Run on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'DinoRun'); });

    test('fits the screen with jump and duck buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of [' ', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tapping the desert jumps; holding duck ducks', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapAt(page, page.locator('#canvas'), 0.6, 0.5);
        await expect.poll(() => page.evaluate(() => dino.onGround)).toBe(false);
        await expect.poll(() => page.evaluate(() => dino.onGround)).toBe(true);
        await T.touchDown(page, T.control(page, 'ArrowDown'));
        await expect.poll(() => page.evaluate(() => dino.ducking)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => dino.ducking)).toBe(false);
    });
});
