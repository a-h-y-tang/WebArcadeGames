const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pill Drop on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PillDrop'); });

    test('fits the screen with move, rotate, drop and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('move, rotate and drop the capsule by touch', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await page.evaluate(() => { autoDrop = false; });
        const c0 = await page.evaluate(() => capsule.c);
        await T.tapControl(page, 'ArrowLeft');
        expect(await page.evaluate(() => capsule.c)).toBe(c0 - 1);
        const o0 = await page.evaluate(() => capsule.orient);
        await T.tapControl(page, 'ArrowUp');
        expect(await page.evaluate(() => capsule.orient)).not.toBe(o0);
        const n = await page.evaluate(() => grid.flat().filter((g) => g && g.kind === 'capsule').length);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => grid.flat().filter((g) => g && g.kind === 'capsule').length)).toBeGreaterThan(n);
    });
});
