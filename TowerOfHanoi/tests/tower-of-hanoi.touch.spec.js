const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Tower of Hanoi on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TowerOfHanoi'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of []) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Click|R to reset/)).toHaveCount(0);
    });

    test('tap a peg, then another, to move a disk', async ({ page }) => {
        const cv = page.locator('#canvas');
        await T.tapCanvas(page, cv, 100, 200);
        await expect.poll(() => page.evaluate(() => selected)).toBe(0);
        await T.tapCanvas(page, cv, 500, 200);
        await expect.poll(() => page.evaluate(() => moves)).toBe(1);
        expect(await page.evaluate(() => pegs[2].length)).toBe(1);
    });
});
