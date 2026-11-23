const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Minesweeper on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Minesweeper'); });

    test('fits the screen with touch instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|any key/i);
    });

    test('tap reveals; touch and hold flags', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapCanvas(page, page.locator('#canvas'), CELL(4), CELL(4));
        await expect.poll(() => page.evaluate(() => board.flat().filter((c) => c.revealed).length)).toBeGreaterThan(0);
        const hidden = await page.evaluate(() => {
            for (let r = 0; r < board.length; r++) for (let c = 0; c < board[0].length; c++) if (!board[r][c].revealed) return { r, c };
        });
        const pt = await T.canvasToPage(page.locator('#canvas'), CELL(hidden.c), CELL(hidden.r));
        const s = await page.context().newCDPSession(page);
        await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 4 }] });
        await page.waitForTimeout(650);
        await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(({ r, c }) => board[r][c].flagged, hidden)).toBe(true);
        expect(await page.evaluate(({ r, c }) => board[r][c].revealed, hidden)).toBe(false);
    });
});
function CELL(i) { return 40 * i + 20; }
