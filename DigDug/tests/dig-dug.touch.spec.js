const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Dig Dug on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'DigDug'); });

    test('fits the screen with a d-pad, pump and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('an arrow starts, the pad digs and pump fires the harpoon', async ({ page }) => {
        await T.tapControl(page, 'ArrowDown');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const p0 = await page.evaluate(() => player.r + ',' + player.c);
        await T.hold(page, T.control(page, 'ArrowDown'), 400);
        expect(await page.evaluate(() => player.r + ',' + player.c)).not.toBe(p0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => harpoon.cells.length + harpoon.timer)).toBeGreaterThan(0);
    });
});
