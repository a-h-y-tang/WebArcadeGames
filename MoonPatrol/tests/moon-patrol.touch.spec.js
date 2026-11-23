const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Moon Patrol on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MoonPatrol'); });

    test('fits the screen with jump, fire and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of [' ', 'f', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/Press Enter/);
    });

    test('jump starts and jumps; fire fires', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => buggy.onGround)).toBe(false);
        await expect.poll(() => page.evaluate(() => buggy.onGround)).toBe(true);
        const fired = await page.evaluate(() => { window.__fired = 0; const f = fire; fire = (...a) => { window.__fired++; return f(...a); }; return 0; });
        await T.tapControl(page, 'f');
        expect(await page.evaluate(() => window.__fired)).toBe(1);
    });
});
