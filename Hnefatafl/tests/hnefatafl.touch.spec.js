const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Hnefatafl on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Hnefatafl'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tap a gold piece, then a highlighted square, to move', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await page.waitForFunction(() => state === 'playing' && turn === 'defenders' && !aiPending, null, { timeout: 8000 });
        const size = await page.evaluate(() => SIZE);
        const box = await page.locator('#canvas').boundingBox();
        const at = (c, r) => [box.x + (c + 0.5) * box.width / size, box.y + (r + 0.5) * box.height / size];
        let moved = false;
        for (let r = 0; r < size && !moved; r++) for (let c = 0; c < size && !moved; c++) {
            await page.touchscreen.tap(...at(c, r));
            const h = await page.evaluate(() => highlight.slice(0, 1));
            if (h.length) {
                await page.touchscreen.tap(...at(h[0].c, h[0].r));
                await expect.poll(() => page.evaluate(() => turn !== 'defenders' || aiPending)).toBe(true);
                moved = true;
            }
        }
        expect(moved).toBe(true);
    });
});
