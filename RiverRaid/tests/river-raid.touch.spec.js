const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('River Raid on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RiverRaid'); });

    test('fits the screen with a d-pad, fire and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('fire starts, the pad steers, fire shoots and pause pauses', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => player.x)).toBeLessThan(x0);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => missiles.length)).toBeGreaterThan(0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
