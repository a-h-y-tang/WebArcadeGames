const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Dots and Boxes on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'DotsAndBoxes'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping near a line draws it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapCanvas(page, page.locator('#canvas'), 45 + 45, 45);
        await expect.poll(() => page.evaluate(() => hEdges[0][0])).toBeTruthy();
    });
});
