const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Ski Slalom on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SkiSlalom'); });

    test('fits the screen with carve, tuck and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('carve, tuck and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => skier.x);
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => skier.x)).toBeGreaterThan(x0);
        await T.touchDown(page, T.control(page, 'ArrowDown'));
        await expect.poll(() => page.evaluate(() => tucking)).toBe(true);
        await T.touchUp(page);
        await expect.poll(() => page.evaluate(() => tucking)).toBe(false);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
