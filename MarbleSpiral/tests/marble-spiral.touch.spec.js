const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('MarbleSpiral on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MarbleSpiral'); });

    test('fits the screen with swap and pause buttons and touch help', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['s', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('.help .tc-hint')).toBeVisible();
    });

    test('drag to aim, lift to fire, swap swaps', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a0 = await page.evaluate(() => shooter.angle);
        await T.drag(page, page.locator('#canvas'), [0.5, 0.2], [0.15, 0.25]);
        expect(await page.evaluate(() => shooter.angle)).not.toBe(a0);
        await expect.poll(() => page.evaluate(() => shots.length)).toBeGreaterThan(0);
        await page.evaluate(() => { window.__swaps = 0; const f = swapBall; swapBall = (...a) => { window.__swaps++; return f(...a); }; });
        await T.tapControl(page, 's');
        expect(await page.evaluate(() => window.__swaps)).toBe(1);
    });
});
