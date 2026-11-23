const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Time Pilot on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TimePilot'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('turn, fire and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const h0 = await page.evaluate(() => player.heading);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => player.heading)).not.toBe(h0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => bullets.length)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
