const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Walls of Jericho on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'WallsOfJericho'); });

    test('fits the screen with steering and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space|Space to launch/)).toHaveCount(0);
    });

    test('drag and the buttons move the paddle, and pause pauses', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.drag(page, page.locator('#canvas'), [0.5, 0.9], [0.15, 0.9]);
        const x1 = await page.evaluate(() => paddle.x);
        expect(x1).toBeLessThan(await page.evaluate(() => WIDTH / 3));
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => paddle.x)).toBeGreaterThan(x1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
