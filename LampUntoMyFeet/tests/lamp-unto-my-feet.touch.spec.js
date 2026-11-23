const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Lamp unto My Feet on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'LampUntoMyFeet'); });

    test('fits the screen and hides keyboard-only help', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('.help')).not.toContainText(/click/i);
        await expect(page.getByText('move cursor')).toBeHidden();
        await expect(page.getByText(/rotate$/)).toBeHidden();
    });

    test('tapping a mirror rotates it', async ({ page }) => {
        const m = await page.evaluate(() => {
            for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
                const k = grid[r][c];
                if ((k.kind === 'mirror' || k.kind === 'splitter') && !k.fixed) return { r, c, state: k.state, x: (c + 0.5) * TILE, y: (r + 0.5) * TILE };
            }
        });
        await T.tapCanvas(page, page.locator('#canvas'), m.x, m.y);
        await expect.poll(() => page.evaluate(({ r, c }) => grid[r][c].state, m)).not.toBe(m.state);
    });
});
