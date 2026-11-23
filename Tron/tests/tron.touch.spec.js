const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Light Cycles duel (Tron) on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Tron'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space|W A S D/)).toHaveCount(0);
    });

    test('the pad and swipes steer, and pause pauses', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => player.dir.dy)).toBe(-1);
        await T.swipe(page, page.locator('#canvas'), 'right');
        await expect.poll(() => page.evaluate(() => player.dir.dx)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
