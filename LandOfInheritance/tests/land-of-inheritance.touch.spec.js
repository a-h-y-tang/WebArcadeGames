const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Land of Inheritance on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LandOfInheritance'); });

    test('fits the screen with touch instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('p.hint')).not.toContainText(/Keyboard|Mouse|click/);
    });

    test('dragging corner to corner marks a field', async ({ page }) => {
        const pts = await page.evaluate(() => {
            const f = puzzle.solution.find((q) => q.w * q.h > 1);
            const at = (r, c) => [ORIGIN_X + cellSize * (c + 0.5), ORIGIN_Y + cellSize * (r + 0.5)];
            return { a: at(f.r, f.c), b: at(f.r + f.h - 1, f.c + f.w - 1) };
        });
        await T.dragCanvas(page, page.locator('#canvas'), pts.a, pts.b);
        await expect.poll(() => page.evaluate(() => regions.length)).toBe(1);
    });
});
