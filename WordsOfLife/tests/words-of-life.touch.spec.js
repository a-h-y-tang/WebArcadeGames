const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Words of Life on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'WordsOfLife'); });

    test('fits the screen with a letter keypad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['q', 'a', 'm', 'Escape']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Type|Esc to|Press any/)).toHaveCount(0);
    });

    test('tapping letters types into the falling word', async ({ page }) => {
        await T.tapControl(page, 'a');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await expect.poll(() => page.evaluate(() => words.length)).toBeGreaterThan(0);
        const ch = await page.evaluate(() => words[0].text[0]);
        await T.tapControl(page, ch);
        await expect.poll(() => page.evaluate(() => activeWord && activeWord.typed)).toBe(1);
        await T.tapControl(page, 'Escape');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
