const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Air Hockey on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'AirHockey'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('#tc-bar')).toHaveCount(0);
    });

    test('dragging a finger moves the mallet', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.dragCanvas(page, page.locator('#canvas'), [230, 600], [100, 520]);
        const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
        expect(p.x).toBeLessThan(140);
        expect(p.y).toBeLessThan(560);
    });
});
