const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Gopher Wood on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'GopherWood'); });

    test('fits the screen with chop buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tapping a side or a chop button chops there', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapAt(page, page.locator('#canvas'), 0.85, 0.7);
        expect(await page.evaluate(() => player.side)).toBe('right');
        if (await page.evaluate(() => state) === 'running') {
            await T.tapControl(page, 'ArrowLeft');
            expect(await page.evaluate(() => player.side)).toBe('left');
        }
    });
});
