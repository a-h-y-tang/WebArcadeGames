const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Force an exact position without touching the DOM event flow, so tests assert
// the rules deterministically.
async function setPosition(page, foxRC, houndsRC, turn = 'fox') {
    await page.evaluate(({ f, h, t }) => {
        fox = { r: f[0], c: f[1] };
        hounds = h.map(([r, c]) => ({ r, c }));
        turn = t;
        state = 'playing';
        selected = null;
        render();
    }, { f: foxRC, h: houndsRC, t: turn });
}

test.describe('Fox and Hounds', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state / DOM
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions Fox', async ({ page }) => {
            await expect(page).toHaveTitle(/Fox/i);
        });

        test('start overlay is visible before starting', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal (fox / hounds)', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/fox/i);
        });

        test('game state is idle before start', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('canvas has fixed pixel dimensions', async ({ page }) => {
            const c = page.locator('#canvas');
            expect(parseInt(await c.getAttribute('width'))).toBeGreaterThan(0);
            expect(parseInt(await c.getAttribute('height'))).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Board setup
    // -----------------------------------------------------------------------
    test.describe('setup', () => {
        test('starts with four hounds on the top row', async ({ page }) => {
            await page.locator('#btn-start').click();
            const rows = await page.evaluate(() => hounds.map(h => h.r));
            expect(rows).toHaveLength(4);
            expect(rows.every(r => r === 0)).toBe(true);
        });

        test('the fox starts on the bottom row', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => fox.r)).toBe(7);
        });

        test('the fox moves first', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => turn)).toBe('fox');
        });

        test('every starting piece is on a dark square', async ({ page }) => {
            await page.locator('#btn-start').click();
            const allDark = await page.evaluate(() =>
                isDark(fox.r, fox.c) && hounds.every(h => isDark(h.r, h.c)));
            expect(allDark).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Geometry
    // -----------------------------------------------------------------------
    test.describe('board queries', () => {
        test('isDark matches the (r+c) odd rule', async ({ page }) => {
            const r = await page.evaluate(() => [isDark(0, 1), isDark(0, 0), isDark(7, 4), isDark(2, 2)]);
            expect(r).toEqual([true, false, true, false]);
        });

        test('inBounds rejects off-board cells', async ({ page }) => {
            const r = await page.evaluate(() => [inBounds(0, 0), inBounds(7, 7), inBounds(-1, 3), inBounds(8, 0)]);
            expect(r).toEqual([true, true, false, false]);
        });

        test('pieceAt reports fox, hound and empty', async ({ page }) => {
            await setPosition(page, [4, 3], [[2, 5]]);
            const r = await page.evaluate(() => [pieceAt(4, 3), pieceAt(2, 5), pieceAt(6, 1)]);
            expect(r).toEqual(['fox', 'hound', null]);
        });
    });

    // -----------------------------------------------------------------------
    // Movement rules
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('a fox in open space has four diagonal moves', async ({ page }) => {
            await setPosition(page, [4, 3], [[0, 1], [0, 5], [0, 7]]);
            const n = await page.evaluate(() => legalMovesFrom(4, 3).length);
            expect(n).toBe(4);
        });

        test('a fox in a corner has a single move', async ({ page }) => {
            await setPosition(page, [7, 0], [[0, 1], [0, 3], [0, 5], [0, 7]]);
            const moves = await page.evaluate(() => legalMovesFrom(7, 0));
            expect(moves).toEqual([{ r: 6, c: 1 }]);
        });

        test('a hound may only move forward (down the board)', async ({ page }) => {
            await setPosition(page, [7, 4], [[4, 3]], 'hounds');
            const moves = await page.evaluate(() => legalMovesFrom(4, 3));
            const rows = moves.map(m => m.r);
            expect(rows.every(r => r === 5)).toBe(true);
            expect(moves).toHaveLength(2);
        });

        test('a hound cannot move backward', async ({ page }) => {
            await setPosition(page, [7, 4], [[4, 3]], 'hounds');
            const canGoBack = await page.evaluate(() =>
                legalMovesFrom(4, 3).some(m => m.r < 4));
            expect(canGoBack).toBe(false);
        });

        test('a piece cannot move onto an occupied square', async ({ page }) => {
            // Fox at (4,3) with a hound blocking the (3,2) and (3,4) squares above.
            await setPosition(page, [4, 3], [[3, 2], [3, 4]]);
            const moves = await page.evaluate(() => legalMovesFrom(4, 3));
            const rows = moves.map(m => m.r);
            expect(rows.every(r => r === 5)).toBe(true);   // only the two below are free
        });
    });

    // -----------------------------------------------------------------------
    // tryMove
    // -----------------------------------------------------------------------
    test.describe('tryMove', () => {
        test('a legal fox move relocates the fox and passes the turn', async ({ page }) => {
            await setPosition(page, [4, 3], [[0, 1], [0, 5], [0, 7]]);
            const [ok, foxPos, t] = await page.evaluate(() => {
                const r = tryMove({ r: 4, c: 3 }, { r: 3, c: 2 });
                return [r, fox, turn];
            });
            expect(ok).toBe(true);
            expect(foxPos).toEqual({ r: 3, c: 2 });
            expect(t).toBe('hounds');
        });

        test('an illegal (non-adjacent) move is rejected', async ({ page }) => {
            await setPosition(page, [4, 3], [[0, 1], [0, 5], [0, 7]]);
            const [ok, foxPos] = await page.evaluate(() => {
                const r = tryMove({ r: 4, c: 3 }, { r: 1, c: 6 });
                return [r, fox];
            });
            expect(ok).toBe(false);
            expect(foxPos).toEqual({ r: 4, c: 3 });
        });

        test('you cannot move the other side\'s piece', async ({ page }) => {
            // It is the fox's turn; trying to move a hound must fail.
            await setPosition(page, [4, 3], [[2, 5]], 'fox');
            const ok = await page.evaluate(() => tryMove({ r: 2, c: 5 }, { r: 3, c: 6 }));
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('the fox reaching the top row wins for the fox', async ({ page }) => {
            await setPosition(page, [1, 2], [[5, 4], [5, 0], [3, 6]]);
            const st = await page.evaluate(() => {
                tryMove({ r: 1, c: 2 }, { r: 0, c: 1 });
                return state;
            });
            expect(st).toBe('fox');
        });

        test('a fox with no move on its turn loses to the hounds', async ({ page }) => {
            // Fox cornered at (7,0); a hound on (6,1) blocks its only square.
            await setPosition(page, [7, 0], [[6, 1], [0, 3], [0, 5]], 'fox');
            const st = await page.evaluate(() => { resolveTurn(); return state; });
            expect(st).toBe('hounds');
        });

        test('hounds with no move pass the turn back to the fox', async ({ page }) => {
            // All hounds jammed against the bottom edge with no forward square.
            await setPosition(page, [4, 3], [[7, 0], [7, 2], [7, 4], [7, 6]], 'hounds');
            const t = await page.evaluate(() => { resolveTurn(); return turn; });
            expect(t).toBe('fox');
        });
    });

    // -----------------------------------------------------------------------
    // Starting & interaction
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('clicking Start hides the overlay and enters play', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the turn indicator names the side to move', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#turn')).toContainText(/fox/i);
        });
    });

    test.describe('clicking', () => {
        test('clicking a fox then a highlighted square moves it', async ({ page }) => {
            await page.locator('#btn-start').click();
            // Fox starts at (7,4); a legal move is (6,3).
            const box = await page.locator('#canvas').boundingBox();
            const from = await page.evaluate(() => cellCenter(7, 4));
            const to = await page.evaluate(() => cellCenter(6, 3));
            await page.mouse.click(box.x + from.x, box.y + from.y);
            await page.mouse.click(box.x + to.x, box.y + to.y);
            const [foxPos, t] = await page.evaluate(() => [fox, turn]);
            expect(foxPos).toEqual({ r: 6, c: 3 });
            expect(t).toBe('hounds');
        });
    });

    test.describe('restart', () => {
        test('R restarts to a fresh game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { fox = { r: 2, c: 3 }; turn = 'hounds'; state = 'playing'; });
            await page.keyboard.press('r');
            const [foxR, t, st, hn] = await page.evaluate(() => [fox.r, turn, state, hounds.length]);
            expect(foxR).toBe(7);
            expect(t).toBe('fox');
            expect(st).toBe('playing');
            expect(hn).toBe(4);
        });
    });
});
