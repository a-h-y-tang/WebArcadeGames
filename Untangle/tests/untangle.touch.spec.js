const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Untangle on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Untangle'); });

    test('fits the screen without keyboard wording', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('#btn-reset')).toHaveText('Reset');
        await expect(page.locator('#btn-next')).toHaveText('Next');
        await expect(page.locator('#controls-hint')).not.toContainText('N next');
    });

    test('dragging a dot moves it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        const n = await page.evaluate(() => ({ x: nodes[0].x, y: nodes[0].y }));
        const to = { x: n.x + 40, y: n.y + 30 };
        await T.dragCanvas(page, page.locator('#canvas'), [n.x, n.y], [to.x, to.y]);
        const after = await page.evaluate(() => ({ x: nodes[0].x, y: nodes[0].y }));
        expect(Math.abs(after.x - to.x)).toBeLessThan(4);
        expect(Math.abs(after.y - to.y)).toBeLessThan(4);
    });
});
