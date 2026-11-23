const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Mastermind on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Mastermind'); });

    test('fits the screen with delete and check buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['Backspace', 'Enter']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/Keys 1|any key/);
    });

    test('tap colours, delete one, then check the guess', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        for (let i = 0; i < 5; i++) {
            const s = await page.evaluate((n) => swatchRect(n % COLORS.length), i);
            await T.tapCanvas(page, page.locator('#canvas'), s.x + s.w / 2, s.y + s.h / 2);
        }
        expect(await page.evaluate(() => current.length)).toBe(4);
        await T.tapControl(page, 'Backspace');
        expect(await page.evaluate(() => current.length)).toBe(3);
        const s = await page.evaluate(() => swatchRect(5));
        await T.tapCanvas(page, page.locator('#canvas'), s.x + s.w / 2, s.y + s.h / 2);
        await T.tapControl(page, 'Enter');
        await expect.poll(() => page.evaluate(() => guesses.length)).toBe(1);
    });
});
