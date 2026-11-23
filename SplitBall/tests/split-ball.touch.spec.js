const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Split Ball on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SplitBall'); });

    test('fits the screen with turn and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['x', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Right click/)).toBeHidden();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('Turn flips the wall, and dragging then lifting builds one', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapControl(page, 'x');
        await expect.poll(() => page.evaluate(() => orientation)).toBe('h');
        await page.evaluate(() => { window.__built = 0; const f = placeWall; placeWall = () => { __built++; return f(); }; });
        await T.dragCanvas(page, page.locator('#canvas'), [24 * 3 + 12, 24 * 3 + 12], [24 * 6 + 12, 24 * 5 + 12]);
        await expect.poll(() => page.evaluate(() => __built)).toBe(1);
        expect(await page.evaluate(() => [cursor.col, cursor.row])).toEqual([6, 5]);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
