const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Feast of Booths on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FeastOfBooths'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping a square cycles its mark', async ({ page }) => {
        const target = await page.evaluate(() => {
            for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
                if (!puzzle.trees.some((t) => (Array.isArray(t) ? t[0] === r && t[1] === c : t.r === r && t.c === c))) {
                    return { r, c, x: ORIGIN + (c + 0.5) * cellSize, y: ORIGIN + (r + 0.5) * cellSize };
                }
            }
        });
        await T.tapCanvas(page, page.locator('#canvas'), target.x, target.y);
        await expect.poll(() => page.evaluate(({ r, c }) => marks[r][c], target)).not.toBe(0);
    });
});
