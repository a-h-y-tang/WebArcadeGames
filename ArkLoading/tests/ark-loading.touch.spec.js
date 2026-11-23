const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Ark Loading on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'ArkLoading'); });

    test('fits the screen with a d-pad', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the d-pad and swipes walk Noah around', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => window.state)).not.toBe('start');
        const moved = async () => page.evaluate(() => ({ x: player.x, y: player.y }));
        let before = await moved();
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
            await T.tapControl(page, k);
            const now = await moved();
            if (now.x !== before.x || now.y !== before.y) { before = null; break; }
        }
        expect(before, 'some d-pad direction moved the player').toBeNull();
        before = await moved();
        for (const d of ['left', 'right', 'up', 'down']) {
            await T.swipe(page, page.locator('#canvas'), d);
            const now = await moved();
            if (now.x !== before.x || now.y !== before.y) { before = null; break; }
        }
        expect(before, 'some swipe moved the player').toBeNull();
    });
});
