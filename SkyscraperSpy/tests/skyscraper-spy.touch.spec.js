const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Skyscraper Spy on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SkyscraperSpy'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('walk, fire and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.touchDown(page, T.control(page, 'ArrowLeft'));
        await expect.poll(() => page.evaluate(() => keys.left)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => keys.left)).toBe(false);
        await page.evaluate(() => { window.__shots = 0; const f = shoot; shoot = () => { __shots++; return f(); }; });
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => __shots)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
