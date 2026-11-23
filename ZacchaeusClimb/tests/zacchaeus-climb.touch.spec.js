const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Zacchaeus Climb on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ZacchaeusClimb'); });

    test('fits the screen with steering and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('steer and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.touchDown(page, T.control(page, 'ArrowLeft'));
        await expect.poll(() => page.evaluate(() => keys.ArrowLeft)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => keys.ArrowLeft)).toBe(false);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
