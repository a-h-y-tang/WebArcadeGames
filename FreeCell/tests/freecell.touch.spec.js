const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('FreeCell on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FreeCell'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tap selects a card and double-tap sends an ace home', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const p = await page.evaluate(() => {
            // Move an ace to the bottom of the first column.
            for (const col of tableau) {
                const i = col.findIndex((c) => c.rank === 1);
                if (i >= 0) { tableau[0].push(col.splice(i, 1)[0]); break; }
            }
            render();
            const k = tableau[0].length - 1;
            return { x: COL_X[0] + CARD_W / 2, y: TABLEAU_Y + k * FAN + CARD_H / 2, suit: tableau[0][k].suit };
        });
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await page.waitForTimeout(80);
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await expect.poll(() => page.evaluate((s) => found[s], p.suit)).toBe(1);
    });
});
