const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Locust Swarm on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LocustSwarm'); });

    test('fits the screen with move, smoke and pause buttons', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', ' ', 'p']) await expect(T.control(page, k)).toBeVisible();
    });

    test('smoke starts, the pad moves and smoke puffs', async ({ page }) => {
        await T.tapControl(page, ' ');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        const x0 = await page.evaluate(() => player.x);
        await T.hold(page, T.control(page, 'ArrowLeft'), 300);
        expect(await page.evaluate(() => player.x)).toBeLessThan(x0);
        expect(await page.evaluate(() => player.dir)).toBe(0);
        await T.tapControl(page, ' ');
        expect(await page.evaluate(() => playerBullets.length)).toBeGreaterThan(0);
    });
});
