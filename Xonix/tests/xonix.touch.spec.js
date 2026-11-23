const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Xonix on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Xonix'); });

    test('fits the screen with a d-pad, restart and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'r', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Arrow keys/)).toHaveCount(0);
    });

    test('the pad and swipes steer, and pause pauses', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, 'ArrowDown');
        await expect.poll(() => page.evaluate(() => dir && dir.y)).toBe(1);
        await T.swipe(page, page.locator('#canvas'), 'right');
        await expect.poll(() => page.evaluate(() => dir && dir.x)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
