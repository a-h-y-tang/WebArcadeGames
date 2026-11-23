const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Burger Time on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BurgerTime'); });

    test('fits the screen with a d-pad, pepper and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('pepper starts, the pad walks and pepper sprays', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pos = () => page.evaluate(() => chef.x + ',' + chef.y);
        const p0 = await pos();
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        await T.hold(page, T.control(page, 'ArrowRight'), 150);
        expect(await pos()).not.toBe(p0);
        const n = await page.evaluate(() => peppers);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => peppers)).toBe(n - 1);
    });
});
