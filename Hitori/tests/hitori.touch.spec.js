const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Hitori on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Hitori'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping a cell shades it', async ({ page }) => {
        const p = await T.findCanvasPoint(page, '(x, y) => { const a = cellAt(x, y); return a ? [a[0], a[1]] : undefined; }', [1, 1]);
        await T.tapCanvas(page, page.locator('canvas').first(), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => shade[1][1])).not.toBe(0);
    });
});
