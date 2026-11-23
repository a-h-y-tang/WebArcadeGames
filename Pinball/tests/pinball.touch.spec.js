const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pinball on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Pinball'); });

    test('fits the screen with flipper and launch buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ']) await expect(T.control(page, k)).toBeVisible();
    });

    test('launch, then hold both flippers at once', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => ball.held)).toBe(false);
        await T.touchDown(page, T.control(page, 'ArrowLeft'), 1);
        await T.touchDown(page, T.control(page, 'ArrowRight'), 2);
        await expect.poll(() => page.evaluate(() => leftFlipper.pressed && rightFlipper.pressed)).toBe(true);
        await T.touchUp(page, 1);
        await T.touchUp(page, 2);
        await expect.poll(() => page.evaluate(() => leftFlipper.pressed || rightFlipper.pressed)).toBe(false);
    });
});
