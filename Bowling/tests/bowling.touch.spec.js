const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Bowling on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Bowling'); });

    test('fits the screen with aim and bowl buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ']) await expect(T.control(page, k)).toBeVisible();
    });

    test('aim with the buttons or a drag, then bowl', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('aiming');
        await T.tapControl(page, 'ArrowLeft', 2);
        expect(await page.evaluate(() => aim)).toBeLessThan(0);
        await T.drag(page, page.locator('#canvas'), [0.3, 0.8], [0.8, 0.8]);
        expect(await page.evaluate(() => aim)).toBeGreaterThan(0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => animating)).toBe(true);
    });
});
