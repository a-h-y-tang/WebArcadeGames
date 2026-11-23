const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Temple Stones on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TempleStones'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press any arrow/)).toHaveCount(0);
    });

    test('move, rotate, drop and pause with the buttons', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => current.x);
        await T.tapControl(page, 'ArrowLeft');
        await expect.poll(() => page.evaluate(() => current.x)).toBe(x0 - 1);
        await page.evaluate(() => { window.__rot = 0; const f = rotateCurrent; rotateCurrent = () => { __rot++; return f(); }; });
        await T.tapControl(page, 'ArrowUp');
        await expect.poll(() => page.evaluate(() => __rot)).toBe(1);
        const s0 = await page.evaluate(() => score);
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => score)).toBeGreaterThan(s0);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
