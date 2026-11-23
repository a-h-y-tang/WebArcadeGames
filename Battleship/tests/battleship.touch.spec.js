const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Battleship on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Battleship'); });

    test('fits the screen', async ({ page }) => {
        await T.expectPhoneReady(page);
    });

    test('rotate button turns the ship, taps place the fleet and fire', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('placing');
        await expect(page.locator('#hint')).toContainText('tap');
        await T.tapControl(page, 'r');
        expect(await page.evaluate(() => orient)).toBe('v');
        await T.tapControl(page, 'r');
        const cell = await page.evaluate(() => ({ x: RX + CELL * 0.5, y: BY + CELL * 0.5 }));
        await T.tapCanvas(page, page.locator('#canvas'), cell.x, cell.y);
        await expect.poll(() => page.evaluate(() => placingIndex)).toBe(1);
        await page.locator('#btn-random').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const e = await page.evaluate(() => ({ x: LX + CELL * 4.5, y: BY + CELL * 4.5 }));
        await T.tapCanvas(page, page.locator('#canvas'), e.x, e.y);
        await expect.poll(() => page.evaluate(() => shotsFired)).toBe(1);
    });
});
