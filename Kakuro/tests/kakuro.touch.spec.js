const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Kakuro on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Kakuro'); });

    test('fits the screen with a 1-9 keypad', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['1', '5', '9', 'Backspace']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tap a white cell, then a number', async ({ page }) => {
        const cell = await page.evaluate(() => {
            for (let r = 0; r < gridRows; r++) for (let c = 0; c < gridCols; c++) if (grid[r][c].type === 'white') return { r, c };
        });
        await T.tapCanvas(page, page.locator('#canvas'), (cell.c + 0.5) * 54, (cell.r + 0.5) * 54);
        expect(await page.evaluate(() => selected)).toEqual(cell);
        await T.tapControl(page, '7');
        expect(await page.evaluate(({ r, c }) => grid[r][c].value, cell)).toBe(7);
        await T.tapControl(page, 'Backspace');
        expect(await page.evaluate(({ r, c }) => grid[r][c].value, cell)).toBeFalsy();
    });
});
