const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe("Nehemiah's Wall on a phone", () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'NehemiahsWall'); });

    test('fits the screen with rotate and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['r', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText('move cursor')).toBeHidden();
    });

    test('tapping inside the walls places a catapult', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        expect(await page.evaluate(() => phase)).toBe('place');
        const p = await page.evaluate(() => ({ x: (cursor.col + 0.5) * CELL, y: (cursor.row + 0.5) * CELL }));
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await expect.poll(() => page.evaluate(() => cannons.length)).toBeGreaterThan(0);
    });
});
