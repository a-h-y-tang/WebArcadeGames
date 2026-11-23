const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Tower Defense on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'TowerDefense'); });

    test('fits the screen with touch controls and touch wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['r', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/click|Press Space/)).toHaveCount(0);
    });

    test('pick a tower, tap grass to build it, and pause', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const cell = await page.evaluate(() => {
            for (let r = 1; r < 15; r++) for (let c = 1; c < 20; c++) if (isBuildable(c, r)) return { c, r };
        });
        await T.tapCanvas(page, page.locator('#canvas'), cell.c * 32 + 16, cell.r * 32 + 16);
        await expect.poll(() => page.evaluate(() => towers.length)).toBe(1);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        await T.tapControl(page, 'r');
        await expect.poll(() => page.evaluate(() => towers.length)).toBe(0);
    });
});
