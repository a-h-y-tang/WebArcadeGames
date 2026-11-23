const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Fifteen Puzzle on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FifteenPuzzle'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|arrow keys/i);
    });

    test('tapping a tile next to the gap slides it', async ({ page }) => {
        const idx = await page.evaluate(() => (blankIndex % 4 > 0 ? blankIndex - 1 : blankIndex + 1));
        const p = await page.evaluate((i) => { const t = tileXY(i); return { x: t.x + TILE / 2, y: t.y + TILE / 2 }; }, idx);
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await expect.poll(() => page.evaluate(() => moves)).toBe(1);
    });

    test('swiping slides a tile', async ({ page }) => {
        for (const d of ['left', 'right', 'up', 'down']) {
            await T.swipe(page, page.locator('#canvas'), d);
            if (await page.evaluate(() => moves) > 0) break;
        }
        expect(await page.evaluate(() => moves)).toBeGreaterThan(0);
    });
});
