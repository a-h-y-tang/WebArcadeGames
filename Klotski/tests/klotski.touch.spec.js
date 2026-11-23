const { test, expect } = require('@playwright/test');
const T = require('../../shared/test-helpers/touch');

test.describe('Klotski on a phone', () => {
    test.beforeEach(async ({ page }) => { await T.openGame(page, 'Klotski'); });

    test('fits the screen with a d-pad', async ({ page }) => {
        await T.expectPhoneReady(page);
        await expect(page.locator('body')).not.toContainText(/click|arrow keys/i);
    });

    test('tap a block, then swipe or use the pad to slide it', async ({ page }) => {
        await page.locator('#btn-start').tap();
        await expect.poll(() => page.evaluate(() => state)).toBe('playing');
        // The bottom-middle pair of small blocks can always slide sideways or up.
        const piece = await page.evaluate(() => {
            const occupied = (r, c) => pieces.some((p) => r >= p.r && r < p.r + p.h && c >= p.c && c < p.c + p.w);
            for (const p of pieces) {
                if (p.w !== 1 || p.h !== 1) continue;
                for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                    const r = p.r + dr, c = p.c + dc;
                    if (r >= 0 && r < 5 && c >= 0 && c < 4 && !occupied(r, c)) return { ...p, dr, dc };
                }
            }
        });
        await T.tapCanvas(page, page.locator('#canvas'), (piece.c + 0.5) * 100, (piece.r + 0.5) * 100);
        expect(await page.evaluate(() => selected)).toBe(piece.id);
        const key = piece.dr ? (piece.dr < 0 ? 'ArrowUp' : 'ArrowDown') : (piece.dc < 0 ? 'ArrowLeft' : 'ArrowRight');
        await T.tapControl(page, key);
        await expect.poll(() => page.evaluate(() => moveCount)).toBe(1);
    });
});
