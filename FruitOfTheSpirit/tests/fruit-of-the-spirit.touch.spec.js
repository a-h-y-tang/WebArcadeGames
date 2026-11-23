const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Fruit of the Spirit on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'FruitOfTheSpirit'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|Press Space/i);
    });

    test('tapping a fruit selects it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
        await T.tapCanvas(page, page.locator('#canvas'), CELL_X(2), CELL_X(1));
        expect(await page.evaluate(() => selected)).toEqual({ r: 1, c: 2 });
    });
});
function CELL_X(i) { return 60 * i + 30; }
