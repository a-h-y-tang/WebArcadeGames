const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pengo on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Pengo'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('#hint')).not.toContainText(/WASD/);
    });

    test('arrows and swipes move the penguin', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const pos = () => page.evaluate(() => JSON.stringify([player.x, player.y, player.r, player.c]));
        const moves = await page.evaluate(() => { window.__moves = []; const f = movePlayer; movePlayer = (dx, dy) => { window.__moves.push([dx, dy]); return f(dx, dy); }; return 0; });
        await T.tapControl(page, 'ArrowUp');
        await T.swipe(page, page.locator('#canvas'), 'left');
        expect(await page.evaluate(() => window.__moves)).toEqual([[-1, 0], [0, -1]]);
    });
});
