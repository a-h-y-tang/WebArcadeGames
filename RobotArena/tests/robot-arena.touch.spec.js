const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Robot Arena on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RobotArena'); });

    test('fits the screen with move and shoot pads', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('move with one pad while shooting with the other', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.touchDown(page, T.control(page, 'd'), 1);
        await T.touchDown(page, T.control(page, 'ArrowUp'), 2);
        await page.waitForTimeout(400);
        await T.touchUp(page, 2);
        await T.touchUp(page, 1);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x0);
        expect(await page.evaluate(() => shotsFired)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
