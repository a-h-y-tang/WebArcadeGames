const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Light Cycles on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LightCycles'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('arrows start and turn; swipes turn', async ({ page }) => {
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await expect.poll(() => page.evaluate(() => player.dir === DIRS.up || player.nextDir === DIRS.up)).toBe(true);
        await T.swipe(page, page.locator('#canvas'), 'right');
        await expect.poll(() => page.evaluate(() => player.dir === DIRS.right || player.nextDir === DIRS.right)).toBe(true);
    });
});
