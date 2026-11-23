const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Mahjong Solitaire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MahjongSolitaire'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping a free tile selects it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const t = await page.evaluate(() => tiles.find((t) => !t.removed && isFree(t)));
        const p = await T.findCanvasPoint(page, '(x, y) => { const h = tileAtPoint(x, y); return h ? h.id : undefined; }', t.id, '#canvas');
        await T.tapCanvas(page, page.locator('#canvas'), p[0], p[1]);
        await expect.poll(() => page.evaluate(() => selected && (selected.id ?? selected))).toBe(t.id);
    });
});
