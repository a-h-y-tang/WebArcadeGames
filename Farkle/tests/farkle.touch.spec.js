const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Farkle on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Farkle'); });

    test('fits the screen without keyboard instructions', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|Space roll/i);
    });

    test('roll with the button and tap a die to select it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        // A 1 always scores, so the roll can't farkle and end the turn.
        await page.evaluate(() => { Math.random = () => 0; });
        await page.locator('#btn-roll').tap();
        await expect.poll(() => page.evaluate(() => turnPhase)).toBe('select');
        const r = await page.evaluate(() => dieRect(0));
        await T.tapCanvas(page, page.locator('#canvas'), r.x + r.w / 2, r.y + r.h / 2);
        expect(await page.evaluate(() => selected[0])).toBe(true);
    });
});
