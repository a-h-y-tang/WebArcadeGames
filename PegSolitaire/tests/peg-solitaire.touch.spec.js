const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Peg Solitaire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PegSolitaire'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tap a peg, then the hole to jump into', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        // Classic opening: the peg two above the centre jumps down into it.
        await T.tapCanvas(page, page.locator('#canvas'), 3 * 60 + 30, 1 * 60 + 30);
        await T.tapCanvas(page, page.locator('#canvas'), 3 * 60 + 30, 3 * 60 + 30);
        await expect.poll(() => page.evaluate(() => score)).toBe(1);
    });
});
