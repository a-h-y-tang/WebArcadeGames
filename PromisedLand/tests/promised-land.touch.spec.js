const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Promised Land on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'PromisedLand'); });

    test('fits the screen with a d-pad, slow and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('holding an arrow moves the marker and draws a line', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const p0 = await page.evaluate(() => [player.px, player.py]);
        await T.hold(page, T.control(page, 'ArrowLeft'), 400);
        const p1 = await page.evaluate(() => [player.px, player.py]);
        expect(p1).not.toEqual(p0);
        await T.touchDown(page, T.control(page, 'z'), 1);
        await T.touchDown(page, T.control(page, 'ArrowDown'), 2);
        await expect.poll(() => page.evaluate(() => drawSlow)).toBe(true);
        await T.touchUp(page, 2);
        await T.touchUp(page, 1);
    });
});
