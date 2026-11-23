const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Mini Golf on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MiniGolf'); });

    test('fits the screen with aim pad, putt and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('drag back from the ball and let go to putt', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const b = await page.evaluate(() => ({ x: ball.x, y: ball.y }));
        await T.dragCanvas(page, page.locator('#canvas'), [b.x, b.y], [b.x - 60, b.y + 80]);
        await expect.poll(() => page.evaluate(() => strokes)).toBe(1);
    });

    test('or aim with the pad and press Putt', async ({ page }) => {
        await page.locator('#btn-start').tap();
        const a0 = await page.evaluate(() => aim.angle);
        await T.tapControl(page, 'ArrowLeft', 2);
        expect(await page.evaluate(() => aim.angle)).not.toBe(a0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => strokes)).toBe(1);
    });
});
