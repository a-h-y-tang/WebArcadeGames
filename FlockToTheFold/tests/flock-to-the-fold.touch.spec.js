const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Flock to the Fold on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FlockToTheFold'); });

    test('fits the screen with pause and restart buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['p', 'r']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/click|Press Space/i);
    });

    test('pick an ability and tap a sheep to give it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await page.locator('.ability[data-ability="blocker"]').tap();
        await page.waitForFunction(() => critters.some((c) => c.alive && !c.saved && c.onGround !== false), null, { timeout: 8000 });
        await page.evaluate(() => { window.__pause = true; });
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        await T.tapControl(page, 'p');
        const c = await page.evaluate(() => { const k = critters.find((c) => c.alive && !c.saved); return { x: (k.x + 0.5) * CELL, y: (k.y + 0.5) * CELL }; });
        await T.tapCanvas(page, page.locator('#canvas'), c.x, c.y);
        await expect.poll(() => page.evaluate(() => critters.some((c) => c.ability === 'blocker'))).toBe(true);
    });
});
