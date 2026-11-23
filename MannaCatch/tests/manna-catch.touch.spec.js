const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Manna Catch on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'MannaCatch'); });

    test('fits the screen with move and pause buttons and touch help', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowLeft', 'ArrowRight', 'p']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.locator('.help .tc-hint')).toBeVisible();
        await expect(page.getByText('mouse to slide')).toBeHidden();
    });

    test('drag a finger or use the buttons to move the baskets', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.drag(page, page.locator('#canvas'), [0.5, 0.8], [0.15, 0.8]);
        const x1 = await page.evaluate(() => player.x);
        expect(x1).toBeLessThan(200);
        await T.hold(page, T.control(page, 'ArrowRight'), 300);
        expect(await page.evaluate(() => player.x)).toBeGreaterThan(x1);
    });
});
