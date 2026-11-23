const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Hashi on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Hashi'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|R restart/i);
    });

    test('dragging between two islands builds a bridge', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pair = await page.evaluate(() => [0, neighbors[0][0]]);
        const hit = '(x, y) => { const { r, c } = pointerToCell(x, y); return islandIndexAt(r, c); }';
        const a = await T.findCanvasPoint(page, hit, pair[0], '#canvas');
        const b = await T.findCanvasPoint(page, hit, pair[1], '#canvas');
        await T.dragCanvas(page, page.locator('#canvas'), a, b);
        await expect.poll(() => page.evaluate(() => Object.keys(bridges).length)).toBe(1);
    });
});
