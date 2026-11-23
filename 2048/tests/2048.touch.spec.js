const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('2048 on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, '2048'); });

    test('fits the screen with touch instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('#overlay-sub')).toContainText('Swipe');
    });

    test('swiping the board slides the tiles', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const before = await page.evaluate(() => JSON.stringify(grid));
        for (const dir of ['left', 'right', 'up', 'down']) {
            await T.swipe(page, page.locator('#canvas'), dir);
        }
        expect(await page.evaluate(() => JSON.stringify(grid))).not.toBe(before);
    });

    test('a swipe starts a new game too', async ({ page }) => {
        await T.swipe(page, page.locator('#canvas'), 'left');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
    });
});
