const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Light Up on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LightUp'); });

    test('fits the screen with next and reset buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['n', 'r']) await expect(T.control(page, k)).toBeVisible();
    });

    test('tap places a bulb, hold places a mark', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const cells = await page.evaluate(() => {
            const out = [];
            for (let r = 0; r < wall.length; r++) for (let c = 0; c < wall.length; c++) if (!wall[r][c]) out.push([r, c]);
            return out.slice(0, 2);
        });
        const hit = '(x, y) => { const a = cellAt(x, y); return a ? [a.r, a.c] : undefined; }';
        const p1 = await T.findCanvasPoint(page, hit, cells[0], '#canvas');
        const p2 = await T.findCanvasPoint(page, hit, cells[1], '#canvas');
        await T.tapCanvas(page, page.locator('#canvas'), p1[0], p1[1]);
        await expect.poll(() => page.evaluate(([r, c]) => bulbs[r][c], cells[0])).toBe(true);
        const pt = await T.canvasToPage(page.locator('#canvas'), p2[0], p2[1]);
        await page.mouse.move(0, 0);
        const s = await page.context().newCDPSession(page);
        await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y, id: 3 }] });
        await page.waitForTimeout(650);
        await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => page.evaluate(([r, c]) => marks[r][c], cells[1])).toBe(true);
        expect(await page.evaluate(([r, c]) => bulbs[r][c], cells[1])).toBeFalsy();
    });
});
