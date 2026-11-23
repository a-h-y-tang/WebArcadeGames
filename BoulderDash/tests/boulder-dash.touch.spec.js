const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Boulder Dash on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BoulderDash'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the pad and swipes dig through the cave', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pos = () => page.evaluate(() => player.x + ',' + player.y);
        const p0 = await pos();
        for (const k of ['ArrowRight', 'ArrowDown']) await T.tapControl(page, k);
        const p1 = await pos();
        expect(p1).not.toBe(p0);
        await T.swipe(page, page.locator('#canvas'), 'left');
        expect(await pos()).not.toBe(p1);
    });
});
