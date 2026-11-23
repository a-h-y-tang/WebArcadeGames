const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Flood It on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FloodIt'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|press 1/i);
    });

    test('tapping a colour floods', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pick = await page.evaluate(() => (grid[0][0] + 1) % NCOLORS);
        const moves = await page.evaluate(() => movesLeft);
        await page.locator('#palette button, #palette > *').nth(pick).tap();
        await expect.poll(() => page.evaluate(() => movesLeft)).toBe(moves - 1);
    });
});
