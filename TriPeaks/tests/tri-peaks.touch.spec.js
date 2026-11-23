const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('TriPeaks on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TriPeaks'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['n']) await expect(T.control(page, k)).toBeVisible();
        for (const el of await page.getByText(/Click/).all()) await expect(el).toBeHidden();
    });

    test('tap the stock to flip a card, and New deals again', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const n = await page.evaluate(() => stock.length);
        await T.tapCanvas(page, page.locator('#canvas'), 276 + 32, 328 + 45);
        await expect.poll(() => page.evaluate(() => stock.length)).toBe(n - 1);
        await T.tapControl(page, 'n');
        await expect.poll(() => page.evaluate(() => stock.length)).toBe(n);
    });
});
