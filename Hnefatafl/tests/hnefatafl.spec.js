const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Hnefatafl', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Hnefatafl', async ({ page }) => {
            await expect(page).toHaveTitle('Hnefatafl');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas is 560×560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('board is 7×7', async ({ page }) => {
            const size = await page.evaluate(() => SIZE);
            expect(size).toBe(7);
        });

        test('newGame places the King on the throne', async ({ page }) => {
            const p = await page.evaluate(() => { newGame(); return pieceAt(3, 3); });
            expect(p).toBe(await page.evaluate(() => KING));
        });

        test('newGame has 8 attackers, 4 defenders, 1 king', async ({ page }) => {
            const counts = await page.evaluate(() => {
                newGame();
                let a = 0, d = 0, k = 0;
                for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
                    const p = pieceAt(c, r);
                    if (p === ATTACKER) a++;
                    else if (p === DEFENDER) d++;
                    else if (p === KING) k++;
                }
                return { a, d, k };
            });
            expect(counts).toEqual({ a: 8, d: 4, k: 1 });
        });

        test('defenders start orthogonally adjacent to the King', async ({ page }) => {
            const ok = await page.evaluate(() => {
                newGame();
                return [[3, 2], [3, 4], [2, 3], [4, 3]].every(([c, r]) => pieceAt(c, r) === DEFENDER);
            });
            expect(ok).toBe(true);
        });

        test('attackers start on the expected cross squares', async ({ page }) => {
            const ok = await page.evaluate(() => {
                newGame();
                const cells = [[3, 0], [3, 1], [3, 5], [3, 6], [0, 3], [1, 3], [5, 3], [6, 3]];
                return cells.every(([c, r]) => pieceAt(c, r) === ATTACKER);
            });
            expect(ok).toBe(true);
        });

        test('attackers move first', async ({ page }) => {
            const t = await page.evaluate(() => { newGame(); return turn; });
            expect(t).toBe('attackers');
        });

        test('state starts as playing', async ({ page }) => {
            const s = await page.evaluate(() => { newGame(); return state; });
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Movement rules
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('the King has no moves at the start (boxed in by defenders)', async ({ page }) => {
            const moves = await page.evaluate(() => { newGame(); return legalMovesFrom(3, 3); });
            expect(moves).toHaveLength(0);
        });

        test('a defender can slide along an open rank', async ({ page }) => {
            const moves = await page.evaluate(() => { newGame(); return legalMovesFrom(3, 2); });
            // defender at (3,2): up blocked by attacker (3,1), down by king (3,3);
            // can move left and right along row 2.
            expect(moves.length).toBeGreaterThan(0);
            expect(moves.every(m => m.r === 2)).toBe(true);
        });

        test('pieces cannot jump over others', async ({ page }) => {
            const legal = await page.evaluate(() => {
                newGame();               // attackers to move
                // attacker (3,0) is blocked downward by (3,1); it cannot reach (3,2).
                return move(3, 0, 3, 2);
            });
            expect(legal).toBe(false);
        });

        test('a move onto an occupied square is illegal', async ({ page }) => {
            const legal = await page.evaluate(() => {
                newGame();
                return move(0, 3, 1, 3); // (1,3) is another attacker
            });
            expect(legal).toBe(false);
        });

        test('a non-King piece may not stop on a corner', async ({ page }) => {
            const legal = await page.evaluate(() => {
                clearBoard();
                place(0, 2, ATTACKER);
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                return move(0, 2, 0, 0);
            });
            expect(legal).toBe(false);
        });

        test('a non-King piece may not stop on the throne', async ({ page }) => {
            const legal = await page.evaluate(() => {
                clearBoard();
                place(1, 3, ATTACKER);
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                return move(1, 3, 3, 3);
            });
            expect(legal).toBe(false);
        });

        test('a legal rook move updates the board', async ({ page }) => {
            const res = await page.evaluate(() => {
                newGame();
                const ok = move(0, 3, 0, 5); // attacker slides down the left file
                return { ok, from: pieceAt(0, 3), to: pieceAt(0, 5) };
            });
            expect(res.ok).toBe(true);
            expect(res.from).toBe(await page.evaluate(() => EMPTY));
            expect(res.to).toBe(await page.evaluate(() => ATTACKER));
        });

        test('a move switches the turn to the other side', async ({ page }) => {
            const t = await page.evaluate(() => {
                newGame();
                move(0, 3, 0, 5);
                return turn;
            });
            expect(t).toBe('defenders');
        });

        test('a side cannot move the other side\'s piece', async ({ page }) => {
            const legal = await page.evaluate(() => {
                newGame();               // attackers to move
                return move(3, 2, 2, 2); // (3,2) is a defender
            });
            expect(legal).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Captures
    // -----------------------------------------------------------------------
    test.describe('captures', () => {
        test('custodial capture removes a sandwiched soldier', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(1, 1, ATTACKER);
                place(2, 1, DEFENDER);
                place(5, 1, ATTACKER);
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                move(5, 1, 3, 1); // attacker lands right of the defender -> sandwich
                return pieceAt(2, 1);
            });
            expect(after).toBe(await page.evaluate(() => EMPTY));
        });

        test('a soldier is captured against a corner', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(0, 1, DEFENDER);
                place(6, 2, ATTACKER);
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                move(6, 2, 0, 2); // attacker below the defender, corner (0,0) above it
                return pieceAt(0, 1);
            });
            expect(after).toBe(await page.evaluate(() => EMPTY));
        });

        test('a soldier is captured against the throne', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(2, 3, DEFENDER);
                place(1, 5, ATTACKER);
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                move(1, 5, 1, 3); // attacker left of defender, throne (3,3) right of it
                return pieceAt(2, 3);
            });
            expect(after).toBe(await page.evaluate(() => EMPTY));
        });

        test('moving into a gap between two enemies is safe', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(1, 1, ATTACKER);
                place(3, 1, ATTACKER);
                place(2, 5, DEFENDER);
                place(5, 5, KING);
                turn = 'defenders'; state = 'playing';
                move(2, 5, 2, 1); // defender steps between two attackers
                return pieceAt(2, 1);
            });
            expect(after).toBe(await page.evaluate(() => DEFENDER));
        });

        test('the King is immune to custodial (2-sided) capture', async ({ page }) => {
            const res = await page.evaluate(() => {
                clearBoard();
                place(1, 1, ATTACKER);
                place(2, 1, KING);
                place(5, 1, ATTACKER);
                turn = 'attackers'; state = 'playing';
                move(5, 1, 3, 1); // king sandwiched left/right only
                return { piece: pieceAt(2, 1), state };
            });
            expect(res.piece).toBe(await page.evaluate(() => KING));
            expect(res.state).toBe('playing');
        });

        test('defenders can capture an attacker', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(1, 1, DEFENDER);
                place(2, 1, ATTACKER);
                place(5, 1, DEFENDER);
                place(5, 5, KING);
                turn = 'defenders'; state = 'playing';
                move(5, 1, 3, 1);
                return pieceAt(2, 1);
            });
            expect(after).toBe(await page.evaluate(() => EMPTY));
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('defenders win when the King reaches a corner', async ({ page }) => {
            const s = await page.evaluate(() => {
                clearBoard();
                place(0, 2, KING);
                place(5, 5, ATTACKER);
                turn = 'defenders'; state = 'playing';
                move(0, 2, 0, 0); // King slides into the corner refuge
                return state;
            });
            expect(s).toBe('defenders-win');
        });

        test('attackers win by surrounding the King on all four sides', async ({ page }) => {
            const s = await page.evaluate(() => {
                clearBoard();
                place(2, 2, KING);
                place(2, 1, ATTACKER);
                place(1, 2, ATTACKER);
                place(3, 2, ATTACKER);
                place(2, 5, ATTACKER); // will move to (2,3) to close the box
                turn = 'attackers'; state = 'playing';
                move(2, 5, 2, 3);
                return state;
            });
            expect(s).toBe('attackers-win');
        });

        test('a King on the edge is captured by three attackers', async ({ page }) => {
            const s = await page.evaluate(() => {
                clearBoard();
                place(0, 2, KING);        // against the left edge
                place(0, 1, ATTACKER);
                place(0, 3, ATTACKER);
                place(3, 2, ATTACKER);    // moves to (1,2) to complete
                turn = 'attackers'; state = 'playing';
                move(3, 2, 1, 2);
                return state;
            });
            expect(s).toBe('attackers-win');
        });

        test('no further moves are accepted once the game is over', async ({ page }) => {
            const legal = await page.evaluate(() => {
                clearBoard();
                place(0, 2, KING);
                place(5, 5, ATTACKER);
                turn = 'defenders'; state = 'playing';
                move(0, 2, 0, 0);        // defenders win
                return move(5, 5, 5, 4); // should be rejected
            });
            expect(legal).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // AI (attackers)
    // -----------------------------------------------------------------------
    test.describe('attacker AI', () => {
        test('aiMove plays a move and hands the turn back to defenders', async ({ page }) => {
            const t = await page.evaluate(() => {
                newGame();               // attackers to move
                aiMove();
                return turn;
            });
            expect(t).toBe('defenders');
        });

        test('aiMove is deterministic — same position, same move', async ({ page }) => {
            const { a, b } = await page.evaluate(() => {
                newGame(); const a = aiMove();
                newGame(); const b = aiMove();
                return { a, b };
            });
            expect(a).toEqual(b);
        });

        test('the AI takes an immediate King capture when available', async ({ page }) => {
            const s = await page.evaluate(() => {
                clearBoard();
                place(2, 2, KING);
                place(2, 1, ATTACKER);
                place(1, 2, ATTACKER);
                place(3, 2, ATTACKER);
                place(2, 5, ATTACKER);   // the winning move is (2,5)->(2,3)
                turn = 'attackers'; state = 'playing';
                aiMove();
                return state;
            });
            expect(s).toBe('attackers-win');
        });

        test('the AI captures a defender when it can', async ({ page }) => {
            const after = await page.evaluate(() => {
                clearBoard();
                place(1, 1, ATTACKER);
                place(2, 1, DEFENDER);
                place(6, 1, ATTACKER);   // (6,1)->(3,1) captures the defender
                place(5, 5, KING);
                turn = 'attackers'; state = 'playing';
                aiMove();
                return pieceAt(2, 1);
            });
            expect(after).toBe(await page.evaluate(() => EMPTY));
        });

        test('aiMove does nothing when it is not the attackers\' turn', async ({ page }) => {
            const res = await page.evaluate(() => {
                newGame();
                turn = 'defenders';
                return aiMove();
            });
            expect(res).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // UI flow
    // -----------------------------------------------------------------------
    test.describe('UI', () => {
        test('the Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });
});
