const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Bomberman on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Bomberman'); });

    test('fits the screen with a d-pad, bomb and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('an arrow starts, the pad walks and Bomb drops a bomb', async ({ page }) => {
        await T.tapControl(page, 'ArrowRight');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => bombs.length)).toBe(1);
        const pos = () => page.evaluate(() => JSON.stringify([player.x, player.y]));
        const p0 = await pos();
        await T.hold(page, T.control(page, 'ArrowRight'), 350);
        await T.hold(page, T.control(page, 'ArrowDown'), 350);
        expect(await pos()).not.toBe(p0);
        expect(await page.evaluate(() => Object.values(keys).some(Boolean))).toBe(false);
    });
});
