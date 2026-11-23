const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Skeet Shooter on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'SkeetShooter'); });

    test('fits the screen with a pause button and tap wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(T.control(page, 'p')).toBeVisible();
        await expect(page.getByText(/click/i)).toHaveCount(0);
    });

    test('tapping the field shoots where you tap', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.evaluate(() => { window.__shot = null; const f = fireAt; fireAt = (x, y) => { __shot = [x, y]; return f(x, y); }; });
        await T.tapCanvas(page, page.locator('#canvas'), 350, 200);
        const shot = await page.evaluate(() => __shot);
        expect(Math.abs(shot[0] - 350)).toBeLessThan(3);
        expect(Math.abs(shot[1] - 200)).toBeLessThan(3);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
