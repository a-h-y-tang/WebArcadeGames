const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Road Racer on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RoadRacer'); });

    test('fits the screen with steering and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the buttons steer and pause', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
