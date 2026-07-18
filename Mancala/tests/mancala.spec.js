const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: overwrite the whole board and current player inside the page.
async function setup(page, board, player) {
    await page.evaluate(({ b, p }) => {
        for (let i = 0; i < 14; i++) board[i] = b[i];
        currentPlayer = p;
        state = 'playing';
    }, { b: board, p: player });
}

test.describe('Mancala', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Mancala', async ({ page }) => {
            await expect(page).toHaveTitle('Mancala');
        });

        test('canvas is 700×300', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '700');
            await expect(canvas).toHaveAttribute('height', '300');
        });

        test('game starts in the playing state', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('board opens with four stones in every pit and empty stores', async ({ page }) => {
            const board = await page.evaluate(() => board.slice());
            expect(board).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
        });

        test('there are 48 stones in total', async ({ page }) => {
            const total = await page.evaluate(() => board.reduce((a, b) => a + b, 0));
            expect(total).toBe(48);
        });

        test('player 1 moves first', async ({ page }) => {
            expect(await page.evaluate(() => currentPlayer)).toBe(1);
        });

        test('stores live at indices 6 and 13', async ({ page }) => {
            const s = await page.evaluate(() => [P1_STORE, P2_STORE]);
            expect(s).toEqual([6, 13]);
        });
    });

    // -----------------------------------------------------------------------
    // Legality
    // -----------------------------------------------------------------------
    test.describe('legal moves', () => {
        test('a non-empty pit on your side is legal', async ({ page }) => {
            expect(await page.evaluate(() => legalMove(2))).toBe(true);
        });

        test('an empty pit is illegal', async ({ page }) => {
            await setup(page, [0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], 1);
            expect(await page.evaluate(() => legalMove(0))).toBe(false);
        });

        test("an opponent's pit is illegal", async ({ page }) => {
            expect(await page.evaluate(() => legalMove(8))).toBe(false); // player 1 to move
        });

        test('a store is never a legal move', async ({ page }) => {
            const s = await page.evaluate(() => [legalMove(6), legalMove(13)]);
            expect(s).toEqual([false, false]);
        });

        test('sowing an illegal pit changes nothing and returns false', async ({ page }) => {
            const res = await page.evaluate(() => {
                const before = board.slice();
                const ok = sow(8); // opponent pit
                return { ok, unchanged: JSON.stringify(before) === JSON.stringify(board) };
            });
            expect(res.ok).toBe(false);
            expect(res.unchanged).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Sowing mechanics
    // -----------------------------------------------------------------------
    test.describe('sowing', () => {
        test('stones are sown one per pit counter-clockwise', async ({ page }) => {
            await setup(page, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], 1);
            const board = await page.evaluate(() => { sow(0); return board.slice(); });
            // pit 0 emptied; pits 1-4 each +1; store 6 untouched here
            expect(board.slice(0, 7)).toEqual([0, 5, 5, 5, 5, 4, 0]);
        });

        test('landing the last stone in your store grants an extra turn', async ({ page }) => {
            await setup(page, [1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                const ok = sow(5); // one stone into store 6
                return { ok, store: board[6], player: currentPlayer, over: state };
            });
            expect(res.ok).toBe(true);
            expect(res.store).toBe(1);
            expect(res.player).toBe(1); // still player 1's turn
            expect(res.over).toBe('playing');
        });

        test('the turn passes to the opponent when you do not land in your store', async ({ page }) => {
            const player = await page.evaluate(() => { sow(0); return currentPlayer; });
            expect(player).toBe(2);
        });

        test("sowing skips the opponent's store", async ({ page }) => {
            // 8 stones from pit 5 wrap past the opponent store (13) into pit 0.
            // pit 0 already holds a stone, so the landing is not a capture.
            await setup(page, [1, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                sow(5);
                return { p2store: board[13], p1store: board[6] };
            });
            expect(res.p2store).toBe(0); // opponent store was skipped
            expect(res.p1store).toBe(1); // player 1's own store did get a stone
        });

        test('total stones are conserved across a sow', async ({ page }) => {
            await setup(page, [0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0], 1);
            const total = await page.evaluate(() => { sow(5); return board.reduce((a, b) => a + b, 0); });
            expect(total).toBe(9);
        });
    });

    // -----------------------------------------------------------------------
    // Captures
    // -----------------------------------------------------------------------
    test.describe('captures', () => {
        test('landing in your own empty pit captures the opposite pit', async ({ page }) => {
            // pit 1 has 1 stone -> lands in empty pit 2; opposite of pit 2 is pit 10 (5 stones).
            await setup(page, [2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 5, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                sow(1);
                return { store: board[6], pit2: board[2], opp: board[10], player: currentPlayer };
            });
            expect(res.store).toBe(6);   // 5 captured + 1 landing stone
            expect(res.pit2).toBe(0);
            expect(res.opp).toBe(0);
            expect(res.player).toBe(2);  // capture ends the turn
        });

        test('no capture when the opposite pit is empty', async ({ page }) => {
            await setup(page, [2, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                sow(1);
                return { store: board[6], pit2: board[2] };
            });
            expect(res.store).toBe(0);  // nothing captured
            expect(res.pit2).toBe(1);   // the lone stone stays put
        });

        test('no capture when the last stone lands on the opponent side', async ({ page }) => {
            // player 1 sows into an empty opponent pit -> not a capture.
            // pit 0 keeps player 1's side non-empty so the game does not end.
            await setup(page, [1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                sow(5); // lands in pit 8 (opponent)
                return { store: board[6], pit8: board[8] };
            });
            expect(res.store).toBe(1);  // only the pass-through stone in own store
            expect(res.pit8).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // End of game
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('emptying a side ends the game and sweeps the remainder', async ({ page }) => {
            // Player 1 plays their last stone; player 2 still has 3 stones in pit 8.
            await setup(page, [0, 0, 0, 0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0], 1);
            const res = await page.evaluate(() => {
                sow(5);
                return { state, p1: board[6], p2: board[13] };
            });
            expect(res.state).toBe('over');
            expect(res.p1).toBe(1);  // the stone that reached the store
            expect(res.p2).toBe(3);  // pit 8's stones swept into player 2's store
        });

        test('winner reflects the fuller store', async ({ page }) => {
            await setup(page, [0, 0, 0, 0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0], 1);
            const w = await page.evaluate(() => { sow(5); return winner(); });
            expect(w).toBe(2);
        });

        test('an equal split is a tie', async ({ page }) => {
            await setup(page, [0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 3], 1);
            // player 1 plays last stone into store -> store6=3; pits empty -> over; store13=3
            const w = await page.evaluate(() => { sow(5); return { state, w: winner(), p1: board[6], p2: board[13] }; });
            expect(w.state).toBe('over');
            expect(w.p1).toBe(3);
            expect(w.p2).toBe(3);
            expect(w.w).toBe(0);
        });

        test('game over reveals the overlay', async ({ page }) => {
            await setup(page, [0, 0, 0, 0, 0, 1, 0, 0, 3, 0, 0, 0, 0, 0], 1);
            await page.evaluate(() => sow(5));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // AI opponent
    // -----------------------------------------------------------------------
    test.describe('AI', () => {
        test('aiMove plays a legal pit for player 2', async ({ page }) => {
            await setup(page, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0], 2);
            const res = await page.evaluate(() => {
                const pit = aiMove();
                return { pit, emptied: board[pit] };
            });
            expect(res.pit).toBeGreaterThanOrEqual(7);
            expect(res.pit).toBeLessThanOrEqual(12);
            expect(res.emptied).toBe(0); // the chosen pit was emptied by sowing
        });

        test('aiMove prefers a move that lands in its own store (extra turn)', async ({ page }) => {
            // pit 12 has exactly 1 stone -> lands in store 13 -> extra turn.
            await setup(page, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 1, 0], 2);
            const res = await page.evaluate(() => {
                const pit = aiMove();
                return { pit, player: currentPlayer, store: board[13] };
            });
            expect(res.pit).toBe(12);
            expect(res.store).toBe(1);
            expect(res.player).toBe(2); // kept the turn
        });
    });

    // -----------------------------------------------------------------------
    // Controls / restart
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('pressing key 1 sows player 1 pit 0', async ({ page }) => {
            const emptied = await page.evaluate(() => {
                // ensure a clean, known board and turn
                for (let i = 0; i < 14; i++) board[i] = [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0][i];
                currentPlayer = 1;
                state = 'playing';
                return board[0];
            });
            expect(emptied).toBe(4);
            await page.keyboard.press('Digit1');
            expect(await page.evaluate(() => board[0])).toBe(0);
        });

        test('the New Game button resets the board', async ({ page }) => {
            await setup(page, [0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 28], 1);
            await page.locator('#btn-restart').click();
            const board = await page.evaluate(() => board.slice());
            expect(board).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
            expect(await page.evaluate(() => state)).toBe('playing');
        });
    });
});
