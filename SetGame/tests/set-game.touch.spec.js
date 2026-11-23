const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Set on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SetGame'); });

    test('fits the screen with a hint button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'h')).toBeVisible();
        await expect(page.getByText(/press Space/i)).toHaveCount(0);
    });

    test('tapping cards selects them and Hint highlights a set', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pt = await T.findCanvasPoint(page, '(x, y) => cardIndexAt(x * CANVAS_W / document.querySelector("canvas").width, y * CANVAS_H / document.querySelector("canvas").height)', 0);
        await T.tapCanvas(page, page.locator('canvas'), pt[0], pt[1]);
        await expect.poll(() => page.evaluate(() => selected.length)).toBe(1);
        await T.tapControl(page, 'h');
        await expect.poll(() => page.evaluate(() => hintCells.length)).toBeGreaterThan(0);
    });
});
