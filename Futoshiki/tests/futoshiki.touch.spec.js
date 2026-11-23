const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Futoshiki on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Futoshiki'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('#controls-hint')).not.toContainText(/click|type/i);
    });

    test('tap a cell, then a number button', async ({ page }) => {
        const cell = await page.evaluate(() => {
            for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!fixed[r][c]) return { r, c, x: cellX(c) + CELL / 2, y: cellY(r) + CELL / 2 };
        });
        await T.tapCanvas(page, page.locator('canvas').first(), cell.x, cell.y);
        expect(await page.evaluate(() => selected)).toEqual({ r: cell.r, c: cell.c });
        await page.locator('.num-btn[data-num="2"]').tap();
        expect(await page.evaluate(({ r, c }) => grid[r][c], cell)).toBe(2);
    });
});
