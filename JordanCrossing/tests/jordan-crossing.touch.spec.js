const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Jordan Crossing on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'JordanCrossing'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('arrows, swipes and taps hop', async ({ page }) => {
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pos = () => page.evaluate(() => JSON.stringify([frog.col, frog.row, frog.x, frog.y]));
        let p = await pos();
        await T.tapControl(page, 'ArrowRight');
        await page.waitForTimeout(250);
        expect(await pos()).not.toBe(p);
        p = await pos();
        await T.swipe(page, page.locator('#canvas'), 'left');
        await page.waitForTimeout(250);
        expect(await pos()).not.toBe(p);
    });
});
