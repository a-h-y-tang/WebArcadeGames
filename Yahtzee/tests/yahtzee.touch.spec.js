const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Yahtzee on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Yahtzee'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.getByText(/click|Press Space/)).toHaveCount(0);
    });

    test('Roll, tap a die to hold, tap a row to score', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.locator('#btn-roll').tap();
        await expect.poll(() => page.evaluate(() => rollsLeft)).toBe(2);
        const d = await page.evaluate(() => ({ x: dieX(0) + DIE_SIZE / 2, y: DIE_Y + DIE_SIZE / 2 }));
        await T.tapCanvas(page, page.locator('canvas'), d.x, d.y);
        await expect.poll(() => page.evaluate(() => held[0])).toBe(true);
        await page.locator('#card-body tr, tbody tr').filter({ hasText: /Chance/ }).first().tap();
        await expect.poll(() => page.evaluate(() => scores.chance)).not.toBeNull();
    });
});
