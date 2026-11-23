const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Sky Climber on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SkyClimber'); });

    test('fits the screen with a pad for each hand', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('the two pads move the two hands', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapControl(page, 'w');
        await expect.poll(() => page.evaluate(() => leftHand.row)).toBe(1);
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => rightHand.row)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
