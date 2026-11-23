const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Stacker on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Stacker'); });

    test('fits the screen with a pause button', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.getByText(/press Space/i)).toHaveCount(0);
    });

    test('tapping the tower drops the block, and pause pauses', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const n = await page.evaluate(() => tower.length);
        await T.tapAt(page, page.locator('#canvas'));
        await expect.poll(() => page.evaluate((n0) => tower.length > n0 || state === 'over', n)).toBe(true);
        if (await page.evaluate(() => state) === 'running') {
            await T.tapControl(page, 'p');
            await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        }
    });
});
