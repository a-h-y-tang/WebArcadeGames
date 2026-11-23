const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Curling on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Curling'); });

    test('fits the screen with aim, power, handle and throw buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'h', ' ']) await expect(T.control(page, k)).toBeVisible();
    });

    test('aim by drag or buttons, set power, then throw', async ({ page }) => {
        await T.tapControl(page, ' ');
        await page.waitForFunction(() => playerReady(), null, { timeout: 8000 });
        await T.drag(page, page.locator('#canvas'), [0.5, 0.4], [0.2, 0.3]);
        expect(await page.evaluate(() => aim)).toBeLessThan(0);
        await T.tapControl(page, 'ArrowRight', 3);
        const p0 = await page.evaluate(() => power);
        await T.tapControl(page, 'ArrowUp');
        expect(await page.evaluate(() => power)).toBeGreaterThan(p0);
        const h0 = await page.evaluate(() => handle);
        await T.tapControl(page, 'h');
        expect(await page.evaluate(() => handle)).toBe(-h0);
        const n = await page.evaluate(() => stonesThrown);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => stonesThrown)).toBe(n + 1);
    });
});
