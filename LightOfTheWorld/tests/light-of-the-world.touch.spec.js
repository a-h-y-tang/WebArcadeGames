const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Light of the World on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LightOfTheWorld'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|Press Space/i);
    });

    test('tapping a mirror turns it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const m = await page.evaluate(() => {
            for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
                if (grid[y][x] && grid[y][x].type === 'mirror' && !grid[y][x].fixed) return { x, y, o: grid[y][x].orient };
            }
        });
        await T.tapCanvas(page, page.locator('#canvas'), (m.x + 0.5) * 48, (m.y + 0.5) * 48);
        await expect.poll(() => page.evaluate(({ x, y }) => grid[y][x].orient, m)).not.toBe(m.o);
    });
});
