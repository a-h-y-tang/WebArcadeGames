const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const PIECES_JS = 9;

test.describe("Nine Men's Morris", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test("page title is Nine Men's Morris", async ({ page }) => {
            await expect(page).toHaveTitle("Nine Men's Morris");
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/Press|Click/);
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board starts with 24 empty points', async ({ page }) => {
            const info = await page.evaluate(() => ({
                len: board.length,
                empties: board.filter(c => c === 0).length,
            }));
            expect(info.len).toBe(24);
            expect(info.empties).toBe(24);
        });

        test('each player starts with nine pieces in hand', async ({ page }) => {
            const info = await page.evaluate(() => ({ w: hand[1], b: hand[2], pieces: PIECES_PER_PLAYER }));
            expect(info.w).toBe(PIECES_JS);
            expect(info.b).toBe(PIECES_JS);
            expect(info.pieces).toBe(PIECES_JS);
        });

        test('white moves first', async ({ page }) => {
            expect(await page.evaluate(() => turn)).toBe(1);
        });

        test('there is no winner yet', async ({ page }) => {
            expect(await page.evaluate(() => winner)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Board data integrity
    // -----------------------------------------------------------------------
    test.describe('board data', () => {
        test('there are 24 points with coordinates', async ({ page }) => {
            const ok = await page.evaluate(
                () => POINTS.length === 24 && POINTS.every(p => typeof p.x === 'number' && typeof p.y === 'number')
            );
            expect(ok).toBe(true);
        });

        test('there are 16 mills, each three valid points', async ({ page }) => {
            const ok = await page.evaluate(() =>
                MILLS.length === 16 &&
                MILLS.every(m => m.length === 3 && m.every(i => i >= 0 && i < 24))
            );
            expect(ok).toBe(true);
        });

        test('adjacency is symmetric and in range', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let a = 0; a < 24; a++) {
                    for (const b of ADJ[a]) {
                        if (b < 0 || b >= 24) return false;
                        if (!ADJ[b].includes(a)) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('a fresh game has an empty board, full hands, and white to move', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => ({
                empties: board.filter(c => c === 0).length,
                w: hand[1], b: hand[2], turn, winner,
            }));
            expect(info).toEqual({ empties: 24, w: 9, b: 9, turn: 1, winner: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Placing phase
    // -----------------------------------------------------------------------
    test.describe('placing phase', () => {
        test('placing puts a piece down, spends a hand piece, and passes the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                const ok = place(5);
                return { ok, cell: board[5], hand: hand[1], turn };
            });
            expect(info.ok).toBe(true);
            expect(info.cell).toBe(1);
            expect(info.hand).toBe(8);
            expect(info.turn).toBe(2);
        });

        test('placing on an occupied point is rejected', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board[5] = 2;
                const before = { hand: hand[1], turn };
                const ok = place(5);
                return { ok, cell: board[5], sameHand: hand[1] === before.hand, sameTurn: turn === before.turn };
            });
            expect(info.ok).toBe(false);
            expect(info.cell).toBe(2);
            expect(info.sameHand).toBe(true);
            expect(info.sameTurn).toBe(true);
        });

        test('completing a mill requires a removal and keeps the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                // White already owns two of the mill [0,1,2]; place the third.
                board[0] = 1; board[1] = 1;
                turn = 1;
                place(2);
                return { mustRemove, turn };
            });
            expect(info.mustRemove).toBe(true);
            expect(info.turn).toBe(1); // turn does not pass until a piece is removed
        });

        test('wouldFormMill detects a completing point', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board[3] = 1; board[4] = 1; // mill [3,4,5]
                return { yes: wouldFormMill(5, 1), no: wouldFormMill(6, 1) };
            });
            expect(info.yes).toBe(true);
            expect(info.no).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Removing a piece
    // -----------------------------------------------------------------------
    test.describe('removing after a mill', () => {
        test('removing an opponent piece clears the mill flag and passes the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board[0] = 1; board[1] = 1;
                board[10] = 2; // a lone black piece, not in a mill
                turn = 1;
                place(2);          // white forms a mill
                const ok = remove(10);
                return { ok, cell: board[10], mustRemove, turn };
            });
            expect(info.ok).toBe(true);
            expect(info.cell).toBe(0);
            expect(info.mustRemove).toBe(false);
            expect(info.turn).toBe(2);
        });

        test('a piece inside a mill cannot be removed while a free piece exists', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                // Black owns a full mill [9,10,11] plus one free piece at 5.
                board[9] = 2; board[10] = 2; board[11] = 2; board[5] = 2;
                mustRemove = true; turn = 1;
                const protectedResult = remove(10); // 10 is in a mill → illegal
                const freeResult = remove(5);        // 5 is free → legal
                return { protectedResult, tenStill: board[10], freeResult, fiveGone: board[5] };
            });
            expect(info.protectedResult).toBe(false);
            expect(info.tenStill).toBe(2);
            expect(info.freeResult).toBe(true);
            expect(info.fiveGone).toBe(0);
        });

        test('a mill piece can be removed when every opponent piece is in a mill', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board[9] = 2; board[10] = 2; board[11] = 2; // the only black pieces, all in one mill
                mustRemove = true; turn = 1;
                const ok = remove(10);
                return { ok, cell: board[10] };
            });
            expect(info.ok).toBe(true);
            expect(info.cell).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving phase
    // -----------------------------------------------------------------------
    test.describe('moving phase', () => {
        test('a player with an empty hand is in the moving phase', async ({ page }) => {
            await page.keyboard.press('Space');
            const phase = await page.evaluate(() => {
                hand[1] = 0;
                return phaseOf(1);
            });
            expect(phase).toBe('moving');
        });

        test('a piece slides to an adjacent empty point', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board[4] = 1; // 4 is adjacent to 5
                turn = 1;
                const ok = move(4, 5);
                return { ok, from: board[4], to: board[5], turn };
            });
            expect(info.ok).toBe(true);
            expect(info.from).toBe(0);
            expect(info.to).toBe(1);
            expect(info.turn).toBe(2);
        });

        test('a non-adjacent move is rejected when not flying', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board[0] = 1; board[3] = 1; board[6] = 1; board[8] = 1; // 4 pieces → not flying
                turn = 1;
                const ok = move(0, 5); // 5 is not adjacent to 0
                return { ok, still: board[0], dest: board[5] };
            });
            expect(info.ok).toBe(false);
            expect(info.still).toBe(1);
            expect(info.dest).toBe(0);
        });

        test('a player with three pieces may fly anywhere', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board[0] = 1; board[1] = 1; board[2] = 1; // exactly 3 → flying
                turn = 1;
                const flying = isFlying(1);
                const ok = move(0, 23); // 23 not adjacent to 0, allowed while flying
                return { flying, ok, dest: board[23] };
            });
            expect(info.flying).toBe(true);
            expect(info.ok).toBe(true);
            expect(info.dest).toBe(1);
        });

        test('forming a mill by moving requires a removal', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board[0] = 1; board[1] = 1; // need 2 to complete mill [0,1,2]
                board[13] = 1;              // 13 is adjacent to 14; move 14? no — set up a mover
                board[5] = 1;               // 5 adjacent to 4; not used
                // Put a mover adjacent to 2: point 14 is adjacent to 2.
                board[14] = 1;
                turn = 1;
                move(14, 2); // completes [0,1,2]
                return { mustRemove, cell: board[2] };
            });
            expect(info.mustRemove).toBe(true);
            expect(info.cell).toBe(1);
        });

        test('moveTargets lists only adjacent empty destinations when not flying', async ({ page }) => {
            await page.keyboard.press('Space');
            const targets = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board.fill(0);
                board[0] = 1; board[3] = 1; board[6] = 1; board[8] = 1; // 4 pieces, not flying
                return moveTargets(1).map(m => m.join('-')).sort();
            });
            // From 0 → 1, 9. From 3 → 4, 10. From 6 → 7, 11. From 8 → 7, 12.
            expect(targets).toEqual(['0-1', '0-9', '3-10', '3-4', '6-11', '6-7', '8-12', '8-7'].sort());
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('reducing the opponent to two pieces wins the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                hand[1] = 0; hand[2] = 0;
                board.fill(0);
                board[5] = 2; board[12] = 2; board[21] = 2; // black has exactly 3, none in a mill
                board[0] = 1; board[1] = 1; board[9] = 1; board[16] = 1; // white
                mustRemove = true; turn = 1;
                const ok = remove(5); // black down to 2
                return { ok, winner, state };
            });
            expect(info.ok).toBe(true);
            expect(info.winner).toBe(1);
            expect(info.state).toBe('over');
        });

        test('a player who cannot move loses', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board.fill(0);
                // White is boxed in: pieces 0,1,2,3 with every neighbour occupied by black.
                board[0] = 1; board[1] = 1; board[2] = 1; board[3] = 1;
                board[9] = 2; board[4] = 2; board[14] = 2; board[10] = 2;
                hand[1] = 0; hand[2] = 0;
                turn = 1; state = 'playing'; winner = 0;
                checkStalemate();
                return { winner, state, moves: moveTargets(1).length };
            });
            expect(info.moves).toBe(0);
            expect(info.winner).toBe(2);
            expect(info.state).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // The computer opponent (deterministic)
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test('the AI places a piece on its turn during the placing phase', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board.fill(0);
                board[6] = 1; board[17] = 1; // scattered white, no threat
                hand[1] = 7; hand[2] = 7;
                turn = 2;
                aiTakeTurn();
                return { blacks: board.filter(c => c === 2).length, blackHand: hand[2], turn };
            });
            expect(info.blacks).toBe(1);
            expect(info.blackHand).toBe(6);
            expect(info.turn).toBe(1); // turn returns to white
        });

        test('the AI completes its own mill when it can', async ({ page }) => {
            await page.keyboard.press('Space');
            const info = await page.evaluate(() => {
                board.fill(0);
                board[0] = 2; board[1] = 2; // black threatens mill at 2
                board[5] = 1; board[17] = 1; // harmless white
                hand[1] = 5; hand[2] = 5;
                turn = 2;
                aiTakeTurn();
                return { cell: board[2], whites: board.filter(c => c === 1).length };
            });
            expect(info.cell).toBe(2);          // black took the mill point
            expect(info.whites).toBe(1);        // and removed a white piece
        });

        test('the AI blocks the opponent from completing a mill', async ({ page }) => {
            await page.keyboard.press('Space');
            const cell = await page.evaluate(() => {
                board.fill(0);
                board[0] = 1; board[1] = 1; // white threatens mill at 2
                board[12] = 2;              // a lone black piece, no black threat
                hand[1] = 5; hand[2] = 5;
                turn = 2;
                aiTakeTurn();
                return board[2];
            });
            expect(cell).toBe(2); // black blocked the point
        });
    });

    // -----------------------------------------------------------------------
    // Clicking (integration)
    // -----------------------------------------------------------------------
    test.describe('clicking the board', () => {
        test('clicking an empty point places a white piece', async ({ page }) => {
            await page.keyboard.press('Space');
            const p = await page.evaluate(() => POINTS[4]);
            await page.locator('#canvas').click({ position: { x: p.x, y: p.y } });
            const info = await page.evaluate(() => ({ cell: board[4], whites: board.filter(c => c === 1).length }));
            expect(info.cell).toBe(1);
            expect(info.whites).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Game over overlay
    // -----------------------------------------------------------------------
    test.describe('game over overlay', () => {
        test('the overlay announces the winner', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { winner = 1; state = 'over'; showResult(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/You Win|Win/);
        });

        test('a Play Again button restarts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { winner = 2; state = 'over'; showResult(); });
            await expect(page.locator('#btn-start')).toHaveText(/Play Again/);
            await page.locator('#btn-start').click();
            const info = await page.evaluate(() => ({ state, empties: board.filter(c => c === 0).length }));
            expect(info.state).toBe('playing');
            expect(info.empties).toBe(24);
        });
    });
});
