const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Gleaning Fields on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'GleaningFields'); });

    test('fits the screen with a d-pad and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('an arrow starts, the pad and swipes steer', async ({ page }) => {
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, 'ArrowRight');
        expect(await page.evaluate(() => pac.nextDir)).toMatchObject({ dx: 1 });
        await T.swipe(page, page.locator('#canvas'), 'left');
        expect(await page.evaluate(() => pac.nextDir)).toMatchObject({ dx: -1 });
    });
});
