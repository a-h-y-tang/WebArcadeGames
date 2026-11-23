const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Rush Hour on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'RushHour'); });

    test('fits the screen with restart and next buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['r', 'n']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tap a vehicle, then tap an empty cell on its line to slide it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        // Find a vehicle with an empty neighbour cell along its axis.
        const plan = await page.evaluate(() => {
            const g = buildGrid(vehicles);
            for (const v of vehicles) {
                const dr = v.orient === 'V' ? 1 : 0, dc = v.orient === 'H' ? 1 : 0;
                for (const [r, c] of [[v.r - dr, v.c - dc], [v.r + dr * v.len, v.c + dc * v.len]]) {
                    if (r >= 0 && r < 6 && c >= 0 && c < 6 && !g[r][c]) return { id: v.id, r: v.r, c: v.c, tr: r, tc: c };
                }
            }
        });
        const cv = page.locator('#canvas');
        await T.tapCanvas(page, cv, plan.c * 80 + 40, plan.r * 80 + 40);
        await expect.poll(() => page.evaluate(() => selectedId)).toBe(plan.id);
        await T.tapCanvas(page, cv, plan.tc * 80 + 40, plan.tr * 80 + 40);
        await expect.poll(() => page.evaluate(() => moves)).toBeGreaterThan(0);
        await T.tapControl(page, 'r');
        await expect.poll(() => page.evaluate(() => moves)).toBe(0);
    });
});
