const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Chariot of Fire on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ChariotOfFire'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('fire starts, the pad steers and climbs, fire shoots', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const s0 = await page.evaluate(() => ({ ...ship }));
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        await T.hold(page, T.control(page, 'ArrowUp'), 300);
        const s1 = await page.evaluate(() => ({ ...ship }));
        expect(s1.x).not.toBe(s0.x);
        expect(s1.alt).not.toBe(s0.alt);
        await T.touchDown(page, T.control(page, ' '));
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await T.touchUp(page);
    });
});
