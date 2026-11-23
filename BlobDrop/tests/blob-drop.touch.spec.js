const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Blob Drop on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'BlobDrop'); });

    test('fits the screen with move, rotate, drop and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('drop starts, then move, rotate and drop the pair by touch', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => getState().phase)).toBe('playing');
        const c0 = await page.evaluate(() => current.pivot.c);
        await T.tapControl(page, 'ArrowLeft');
        expect(await page.evaluate(() => current.pivot.c)).toBe(c0 - 1);
        const o0 = await page.evaluate(() => current.orientation);
        await T.tapControl(page, 'ArrowUp');
        expect(await page.evaluate(() => current.orientation)).not.toBe(o0);
        const filled = () => page.evaluate(() => getGrid().flat().filter(Boolean).length);
        await T.tapControl(page, ' ');
        await expect.poll(filled).toBeGreaterThan(0);
    });
});
