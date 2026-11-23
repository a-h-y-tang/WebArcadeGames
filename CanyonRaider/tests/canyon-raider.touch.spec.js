const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Canyon Raider on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'CanyonRaider'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad steers and fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => plane.x);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => plane.x)).toBeLessThan(x0);
        await T.touchDown(page, T.control(page, ' '));
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await T.touchUp(page);
    });
});
