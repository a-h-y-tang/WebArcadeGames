const { test, expect } = require('@playwright/test');
const { openGame, expectPhoneReady, tapControl, swipe, control } = require('../../shared/test-helpers/touch');

test.describe('Lost Sheep on a phone', () => {
    test.beforeEach(async ({ page }) => {
        await openGame(page, 'LostSheep');
    });

    test('fits the screen and shows a d-pad and pause button', async ({ page }) => {
        await expectPhoneReady(page);
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'p']) {
            await expect(control(page, key)).toBeVisible();
        }
        await expect(page.locator('#overlay-sub')).not.toContainText('arrow key');
    });

    test('the d-pad starts the game and steers', async ({ page }) => {
        await tapControl(page, 'ArrowDown');
        await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        await page.waitForFunction(() => dir.y === 1);
        await tapControl(page, 'ArrowLeft');
        await page.waitForFunction(() => dir.x === -1);
    });

    test('swiping on the field steers', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        await swipe(page, page.locator('#canvas'), 'up');
        await page.waitForFunction(() => dir.y === -1);
    });

    test('the pause button pauses and resumes', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('paused');
        await tapControl(page, 'p');
        await expect.poll(() => page.evaluate(() => state)).toBe('running');
    });
});
