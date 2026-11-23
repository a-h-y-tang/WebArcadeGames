const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Marble Loop on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MarbleLoop'); });

    test('fits the screen with swap and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['s', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('drag to aim, lift to fire, swap swaps', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const a0 = await page.evaluate(() => launcher.angle);
        await page.waitForFunction(() => fireTimer <= 0, null, { timeout: 3000 }).catch(() => {});
        await T.drag(page, page.locator('#canvas'), [0.5, 0.3], [0.2, 0.2]);
        expect(await page.evaluate(() => launcher.angle)).not.toBe(a0);
        await expect.poll(() => page.evaluate(() => shotsFired)).toBeGreaterThan(0);
        const cur = await page.evaluate(() => [launcher.current, launcher.next]);
        await T.tapControl(page, 's');
        expect(await page.evaluate(() => [launcher.current, launcher.next])).toEqual([cur[1], cur[0]]);
    });
});
