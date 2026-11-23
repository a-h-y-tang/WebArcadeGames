const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Pool on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Pool'); });

    test('fits the screen with touch help', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('.help .tc-hint')).toBeVisible();
    });

    test('touch to aim, hold to charge, let go to shoot', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await page.waitForFunction(() => state !== 'idle' && !balls.some((b) => Math.hypot(b.vx || 0, b.vy || 0) > 0.01), null, { timeout: 5000 });
        const target = await page.evaluate(() => { const b = balls.find((b) => b !== cue && !b.potted); return [b.x, b.y]; });
        const pt = await T.canvasToPage(page.locator('#canvas'), target[0], target[1]);
        const s = await page.context().newCDPSession(page);
        await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 5 }] });
        await expect.poll(() => page.evaluate(() => charging)).toBe(true);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => power)).toBeGreaterThan(0);
        await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(() => Math.hypot(cue.vx, cue.vy))).toBeGreaterThan(0);
    });
});
