const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Reversi on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Reversi'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|R for a new/i);
    });

    test('tapping a legal square plays there', async ({ page }) => {
        // d3 (row 2, col 3) is a legal opening move for black.
        await T.tapCanvas(page, page.locator('#canvas'), 3 * 60 + 30, 2 * 60 + 30);
        await expect.poll(() => page.evaluate(() => game.board[2][3])).not.toBe(0);
    });
});
