const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Nonogram on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Nonogram'); });

    test('fits the screen with touch instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|WASD/i);
    });

    test('tap fills a square; touch and hold marks one', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => game.state)).toBe('playing');
        await T.tapCanvas(page, page.locator('#canvas'), 104 + 16, 104 + 16);
        await expect.poll(() => page.evaluate(() => game.grid[0][0])).toBe(1);
        const pt = await T.canvasToPage(page.locator('#canvas'), 104 + 48, 104 + 16);
        const s = await page.context().newCDPSession(page);
        await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 4 }] });
        await page.waitForTimeout(650);
        await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(() => game.grid[0][1])).toBe(2);
    });
});
