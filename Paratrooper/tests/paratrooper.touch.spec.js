const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Paratrooper on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Paratrooper'); });

    test('fits the screen with turn, fire and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad turns the cannon and fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a0 = await page.evaluate(() => turret.angle);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => turret.angle)).not.toBe(a0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => bullets.length)).toBeGreaterThan(0);
    });
});
