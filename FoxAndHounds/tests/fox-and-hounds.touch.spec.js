const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Fox and Hounds on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FoxAndHounds'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click/i);
    });

    test('tapping your piece picks it up', async ({ page }) => {
        await page.locator('#btn-start').tap();
        const who = await page.evaluate(() => (turn === 'fox' ? fox : hounds[0]));
        await page.waitForTimeout(100);
        const p = await page.evaluate(({ r, c }) => ({ x: PAD + (c + 0.5) * CELL, y: PAD + (r + 0.5) * CELL }), who);
        await T.tapCanvas(page, page.locator('#canvas'), p.x, p.y);
        await expect.poll(() => page.evaluate(() => selected)).toEqual({ r: who.r, c: who.c });
    });

    test('has an on-screen button for the R key (new game / restart)', async ({ page }) => {
        await expect(T.control(page, 'r')).toBeVisible();
    });
});
