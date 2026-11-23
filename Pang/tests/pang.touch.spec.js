const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pang on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Pang'); });

    test('fits the screen with move, fire and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the pad moves and fire shoots the harpoon', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => getState().state)).toBe('playing');
        const x0 = await page.evaluate(() => getState().playerX);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => getState().playerX)).toBeLessThan(x0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => getState().harpoonActive)).toBe(true);
    });
});
