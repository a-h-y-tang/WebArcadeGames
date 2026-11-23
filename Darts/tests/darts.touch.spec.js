const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Darts on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Darts'); });

    test('fits the screen with a throw button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, ' ')).toBeVisible();
    });

    test('the throw button locks the aim and throws', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => phase)).toBe('y');
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => totalDarts)).toBe(1);
    });

    test('tapping the board throws there', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await T.tapAt(page, page.locator('#canvas'), 0.5, 0.5);
        await expect.poll(() => page.evaluate(() => totalDarts)).toBe(1);
    });
});
