const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Chain Reaction on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ChainReaction'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping a cell drops an orb', async ({ page }) => {
        await T.tapCanvas(page, page.locator('canvas').first(), 10, 10);
        await expect.poll(() => page.evaluate(() => moveCount)).toBe(1);
    });
});
