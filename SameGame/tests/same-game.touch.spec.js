const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('SameGame on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SameGame'); });

    test('fits the screen and talks about tapping', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.getByText(/Click/)).toHaveCount(0);
    });

    test('tapping a group clears it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const cell = await page.evaluate(() => {
            for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++)
                if (board[r][c] !== null && groupAt(r, c).length >= 2) return { r, c };
        });
        await T.tapCanvas(page, page.locator('#canvas'), cell.c * 36 + 18, cell.r * 36 + 18);
        await expect.poll(() => page.evaluate(() => score)).toBeGreaterThan(0);
    });
});
