const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Sliding Puzzle on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SlidingPuzzle'); });

    test('fits the screen and talks about tapping', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.getByText(/Arrow keys/)).toHaveCount(0);
    });

    test('tapping a tile next to the gap slides it, and so does a swipe', async ({ page }) => {
        const t = await page.evaluate(() => {
            const b = blankPos(), r = rowOf(b), c = colOf(b);
            return { r, c: c > 0 ? c - 1 : c + 1 };
        });
        await T.tapCanvas(page, page.locator('#canvas'), t.c * 120 + 60, t.r * 120 + 60);
        await expect.poll(() => page.evaluate(() => moves)).toBe(1);
        // The gap is now where we tapped; swipe a neighbour into it.
        const dir = t.c > 0 ? 'right' : 'left';
        await T.swipe(page, page.locator('#canvas'), dir);
        await expect.poll(() => page.evaluate(() => moves)).toBe(2);
    });
});
