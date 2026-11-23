const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Scramble on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Scramble'); });

    test('fits the screen with a pad, fire, bomb and pause', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'b', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Press Space/)).toHaveCount(0);
    });

    test('fly, shoot, bomb and pause with the buttons', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const y0 = await page.evaluate(() => ship.y);
        await T.hold(page, T.control(page, 'ArrowUp'), 300);
        expect(await page.evaluate(() => ship.y)).toBeLessThan(y0);
        await page.evaluate(() => { window.__shots = 0; const f = fireLaser, b = dropBomb;
            fireLaser = () => { __shots++; return f(); }; dropBomb = () => { __shots += 10; return b(); }; });
        await T.tapControl(page, ' ');
        await T.tapControl(page, 'b');
        await expect.poll(() => page.evaluate(() => __shots)).toBe(11);
        await T.tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
    });
});
