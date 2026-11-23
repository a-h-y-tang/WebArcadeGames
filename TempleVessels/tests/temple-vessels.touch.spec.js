const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Temple Vessels on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TempleVessels'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'x', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('run, dig and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.evaluate(() => { window.__dug = []; const f = dig; dig = (d) => { __dug.push(d); return f(d); }; });
        await T.tapControl(page, 'z');
        await T.tapControl(page, 'x');
        await expect.poll(() => page.evaluate(() => __dug)).toEqual([-1, 1]);
        await T.touchDown(page, T.control(page, 'ArrowRight'));
        await expect.poll(() => page.evaluate(() => heldKeys.has('arrowright'))).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => heldKeys.size)).toBe(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
