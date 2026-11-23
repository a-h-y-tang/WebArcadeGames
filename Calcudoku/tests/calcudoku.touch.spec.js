const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Calcudoku on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Calcudoku'); });

    test('fits the screen with a number keypad', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['1', '2', '3', '4', 'Backspace']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tap a cell, then a number to fill it and the eraser to clear it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapCanvas(page, page.locator('#canvas'), 84 * 1.5, 84 * 2.5);
        expect(await page.evaluate(() => selected)).toEqual({ r: 2, c: 1 });
        await T.tapControl(page, '3');
        expect(await page.evaluate(() => grid[2][1])).toBe(3);
        await T.tapControl(page, 'Backspace');
        expect(await page.evaluate(() => grid[2][1])).toBe(0);
    });

    test('has an on-screen button for the R key (new game / restart)', async ({ page }) => {
        await expect(T.control(page, 'r')).toBeVisible();
    });
});
