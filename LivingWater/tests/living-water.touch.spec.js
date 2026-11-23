const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Living Water on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LivingWater'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('#controls-hint')).not.toContainText(/click|WASD/i);
    });

    test('tapping a cell lays a pipe', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        const p = await page.evaluate(() => {
            for (let r = 0; r < window.grid.length; r++) for (let c = 0; c < window.grid[0].length; c++) if (!window.grid[r][c]) return cellCenter(r, c);
        });
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await expect.poll(() => page.evaluate(() => window.grid.flat().filter((g) => g && !g.source && g.type !== 'source').length)).toBeGreaterThan(0);
    });
});
