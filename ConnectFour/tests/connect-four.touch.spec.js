const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Connect Four on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ConnectFour'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|press 1/i);
    });

    test('tapping a column drops a disc', async ({ page }) => {
        await T.tapCanvas(page, page.locator('#canvas'), 80 * 3 + 40, 240);
        await expect.poll(() => page.evaluate(() => board.flat().filter(Boolean).length)).toBeGreaterThan(0);
    });
});
