const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Flow on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Flow'); });

    test('fits the screen and says tap', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|any key/i);
    });

    test('dragging from a dot draws a pipe', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        const pts = await page.evaluate(() => {
            const cell = canvas.width / size;
            for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
                if (endpointColor[r][c] == null || endpointColor[r][c] < 0) continue;
                for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nc >= 0 && nr < size && nc < size && (endpointColor[nr][nc] == null || endpointColor[nr][nc] < 0)) {
                        return { from: [(c + 0.5) * cell, (r + 0.5) * cell], to: [(nc + 0.5) * cell, (nr + 0.5) * cell] };
                    }
                }
            }
        });
        await T.dragCanvas(page, page.locator('#canvas'), pts.from, pts.to);
        await expect.poll(() => page.evaluate(() => JSON.stringify(paths).match(/\d+/g).length)).toBeGreaterThan(2);
    });
});
