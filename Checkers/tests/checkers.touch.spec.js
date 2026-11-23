const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Checkers on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Checkers'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tap a piece then a square to move', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const move = await page.evaluate(() => {
            for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
                const p = board[r][c];
                if (p !== RED) continue;
                for (const dc of [-1, 1]) {
                    const nr = r - 1, nc = c + dc;
                    if (nr >= 0 && nc >= 0 && nc < 8 && !board[nr][nc]) return { r, c, nr, nc };
                }
            }
            return null;
        });
        expect(move).not.toBeNull();
        await T.tapCanvas(page, page.locator('#canvas'), move.c * 70 + 35, move.r * 70 + 35);
        await T.tapCanvas(page, page.locator('#canvas'), move.nc * 70 + 35, move.nr * 70 + 35);
        await expect.poll(() => page.evaluate(({ nr, nc }) => !!board[nr][nc], move)).toBe(true);
    });

    test('has an on-screen button for the R key (new game / restart)', async ({ page }) => {
        await expect(T.control(page, 'r')).toBeVisible();
    });
});
