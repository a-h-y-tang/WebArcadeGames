const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Air Traffic Control on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'AirTrafficControl'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
    });

    test('dragging from an aircraft routes it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.waitForFunction(() => aircraft.length > 0);
        const c = await page.evaluate(() => ({ x: aircraft[0].x, y: aircraft[0].y }));
        await T.dragCanvas(page, page.locator('#canvas'), [c.x, c.y], [360, 240], 12);
        expect(await page.evaluate(() => aircraft[0].path.length)).toBeGreaterThan(0);
    });
});
