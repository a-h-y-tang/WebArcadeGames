const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Slitherlink on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Slitherlink'); });

    test('fits the screen with restart and next buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['r', 'n']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/right-click/)).toHaveCount(0);
    });

    test('tapping an edge cycles line, blocked and clear', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const p = await page.evaluate(() => { const [a, b] = edgeEndpoints('H:0:0'); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; });
        const cv = page.locator('#canvas');
        await T.tapCanvas(page, cv, p.x, p.y);
        await expect.poll(() => page.evaluate(() => edges['H:0:0'] === LINE)).toBe(true);
        await page.waitForTimeout(350);
        await T.tapCanvas(page, cv, p.x, p.y);
        await expect.poll(() => page.evaluate(() => edges['H:0:0'] === CROSS)).toBe(true);
        await T.tapControl(page, 'n');
        await expect.poll(() => page.evaluate(() => level)).toBe(1);
    });
});
