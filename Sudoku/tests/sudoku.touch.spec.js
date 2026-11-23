const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Sudoku on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Sudoku'); });

    test('fits the screen with a number keypad', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['1', '5', '9', 'Backspace']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tap a cell, then a number to fill it, and ⌫ to clear', async ({ page }) => {
        const cell = await page.evaluate(() => {
            for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!given[r][c]) return { r, c };
        });
        await T.tapCanvas(page, page.locator('#canvas'), cell.c * 56 + 28, cell.r * 56 + 28);
        await expect.poll(() => page.evaluate(() => selected && [selected.r, selected.c])).toEqual([cell.r, cell.c]);
        await T.tapControl(page, '7');
        await expect.poll(() => page.evaluate((p) => board[p.r][p.c], cell)).toBe(7);
        await T.tapControl(page, 'Backspace');
        await expect.poll(() => page.evaluate((p) => board[p.r][p.c], cell)).toBe(0);
    });
});
