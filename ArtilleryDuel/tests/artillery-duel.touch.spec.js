const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Artillery Duel on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ArtilleryDuel'); });

    test('fits the screen with aim and fire buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('aim with the pad and fire with the button', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a = await page.evaluate(() => angle);
        await T.tapControl(page, 'ArrowUp', 2);
        expect(await page.evaluate(() => angle)).toBeGreaterThan(a);
        const p = await page.evaluate(() => power);
        await T.hold(page, T.control(page, 'ArrowRight'), 700);
        expect(await page.evaluate(() => power)).toBeGreaterThan(p + 2);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => shell !== null || turn === 'cpu')).toBe(true);
    });
});
