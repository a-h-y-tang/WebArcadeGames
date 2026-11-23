const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Ophir Gold on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'OphirGold'); });

    test('fits the screen with a d-pad, dig and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'z', 'x', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('the pad runs and the dig buttons dig', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const pos = () => page.evaluate(() => JSON.stringify([player.x, player.y, player.c, player.r]));
        const p0 = await pos();
        await T.hold(page, T.control(page, 'ArrowLeft'), 350);
        await T.hold(page, T.control(page, 'ArrowRight'), 150);
        expect(await pos()).not.toBe(p0);
        await page.evaluate(() => { window.__digs = []; const f = dig; dig = (d) => { window.__digs.push(d); return f(d); }; });
        await T.tapControl(page, 'z');
        await T.tapControl(page, 'x');
        expect(await page.evaluate(() => window.__digs)).toEqual([-1, 1]);
    });
});
