const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Jacob's Ladder on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'JacobsLadder'); });

    test('fits the screen without keyboard wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/Space/);
    });

    test('the Roll button rolls', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => phase)).toBe('playing');
        await page.locator('#btn-roll').tap();
        await expect.poll(() => page.evaluate(() => lastRoll)).toBeGreaterThan(0);
    });
});
