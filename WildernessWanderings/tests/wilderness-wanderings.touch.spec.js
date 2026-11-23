const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Wilderness Wanderings on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'WildernessWanderings'); });

    test('fits the screen with a d-pad', async ({ page }) => {
        await T.expectPhoneReady(page);
        for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await expect(T.control(page, k)).toBeVisible();
        await expect(page.getByText(/Arrow keys|Press/)).toHaveCount(0);
    });

    test('the pad and swipes walk through open passages', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const dirs = await page.evaluate(() => Object.keys(MOVES).filter((k) => k.startsWith('Arrow') && !maze[player.y][player.x].walls[MOVES[k].wall]));
        const start = await page.evaluate(() => [player.x, player.y]);
        await T.tapControl(page, dirs[0]);
        await expect.poll(() => page.evaluate(() => [player.x, player.y])).not.toEqual(start);
        const pos = await page.evaluate(() => [player.x, player.y]);
        const back = { ArrowUp: 'down', ArrowDown: 'up', ArrowLeft: 'right', ArrowRight: 'left' }[dirs[0]];
        await T.swipe(page, page.locator('#canvas'), back);
        await expect.poll(() => page.evaluate(() => [player.x, player.y])).toEqual(start);
        expect(pos).not.toEqual(start);
    });
});
