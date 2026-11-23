const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Defender on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Defender'); });

    test('fits the screen with a d-pad, fire, bomb and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'b', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad flies and fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => player.y);
        await T.hold(page, T.control(page, 'ArrowDown'), 300);
        expect(await page.evaluate(() => player.y)).toBeGreaterThan(y0);
        await T.hold(page, T.control(page, 'ArrowLeft'), 200);
        expect(await page.evaluate(() => player.dir)).toBe(-1);
        await T.touchDown(page, T.control(page, ' '));
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await T.touchUp(page);
    });
});
