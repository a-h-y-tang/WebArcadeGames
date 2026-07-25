const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Ultimate Tic-Tac-Toe', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('uttt-score'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state / DOM
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Ultimate Tic-Tac-Toe', async ({ page }) => {
            await expect(page).toHaveTitle('Ultimate Tic-Tac-Toe');
        });

        test('canvas has the documented dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '540');
            await expect(canvas).toHaveAttribute('height', '540');
        });

        test('there are 9 mini-boards of 9 empty cells each', async ({ page }) => {
            const info = await page.evaluate(() => ({
                minis: boards.length,
                cells: boards[0].length,
                empty: boards.every(b => b.every(c => c === 0)),
                macro: macro.length,
                macroEmpty: macro.every(m => m === 0),
            }));
            expect(info.minis).toBe(9);
            expect(info.cells).toBe(9);
            expect(info.empty).toBe(true);
            expect(info.macro).toBe(9);
            expect(info.macroEmpty).toBe(true);
        });

        test('X moves first with a free board choice', async ({ page }) => {
            const s = await page.evaluate(() => ({ p: currentPlayer, active: activeBoard }));
            expect(s.p).toBe(1);
            expect(s.active).toBe(-1);
        });

        test('state is playing and there is no winner', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, winner }));
            expect(s.state).toBe('playing');
            expect(s.winner).toBe(0);
        });

        test('the status line names X', async ({ page }) => {
            await expect(page.locator('#status')).toContainText(/X/);
        });

        test('the score counters start at 0', async ({ page }) => {
            await expect(page.locator('#x-wins')).toHaveText('0');
            await expect(page.locator('#o-wins')).toHaveText('0');
            await expect(page.locator('#draws')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Line / mini-board logic
    // -----------------------------------------------------------------------
    test.describe('line and mini-board logic', () => {
        test('lineWinner detects a row, column, and diagonal', async ({ page }) => {
            const r = await page.evaluate(() => ({
                row: lineWinner([1, 1, 1, 0, 0, 0, 0, 0, 0]),
                col: lineWinner([2, 0, 0, 2, 0, 0, 2, 0, 0]),
                diag: lineWinner([1, 0, 0, 0, 1, 0, 0, 0, 1]),
                anti: lineWinner([0, 0, 2, 0, 2, 0, 2, 0, 0]),
                none: lineWinner([1, 2, 1, 2, 1, 2, 2, 1, 2]),
                empty: lineWinner([0, 0, 0, 0, 0, 0, 0, 0, 0]),
            }));
            expect(r.row).toBe(1);
            expect(r.col).toBe(2);
            expect(r.diag).toBe(1);
            expect(r.anti).toBe(2);
            expect(r.none).toBe(0);
            expect(r.empty).toBe(0);
        });

        test('miniWinner reads a mini-board and updateMacro records it', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                boards[4] = [1, 1, 1, 0, 0, 0, 0, 0, 0]; // X wins mini-board 4
                const w = miniWinner(4);
                updateMacro(4);
                return { w, macro: macro[4] };
            });
            expect(r.w).toBe(1);
            expect(r.macro).toBe(1);
        });

        test('a full mini-board with no line is a draw (macro value 3)', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                boards[0] = [1, 2, 1, 1, 2, 2, 2, 1, 1]; // full, no three in a row
                const full = isMiniFull(0);
                const w = miniWinner(0);
                updateMacro(0);
                return { full, w, macro: macro[0] };
            });
            expect(r.full).toBe(true);
            expect(r.w).toBe(0);
            expect(r.macro).toBe(3);
        });

        test('macroWinner detects three mini-boards in a row', async ({ page }) => {
            const w = await page.evaluate(() => {
                newGame();
                macro[0] = 2; macro[1] = 2; macro[2] = 2;
                return macroWinner();
            });
            expect(w).toBe(2);
        });

        test('a drawn mini-board does not count toward a macro line', async ({ page }) => {
            const w = await page.evaluate(() => {
                newGame();
                macro[0] = 1; macro[1] = 3; macro[2] = 1; // middle is a draw
                return macroWinner();
            });
            expect(w).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Legality / forced board
    // -----------------------------------------------------------------------
    test.describe('legal moves', () => {
        test('the first move is legal in any board', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                return { a: isLegal(0, 0), b: isLegal(8, 8), c: isLegal(4, 4), n: legalMoves().length };
            });
            expect(r.a).toBe(true);
            expect(r.b).toBe(true);
            expect(r.c).toBe(true);
            expect(r.n).toBe(81);
        });

        test('a move sends the opponent to the matching mini-board', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                applyMove(0, 5, 1); // X plays cell 5 in board 0 -> O forced to board 5
                return { active: activeBoard, player: currentPlayer };
            });
            expect(r.active).toBe(5);
            expect(r.player).toBe(2);
        });

        test('when forced, only cells in the active board are legal', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                applyMove(0, 5, 1); // O forced to board 5
                return {
                    inActive: isLegal(5, 0),
                    outside: isLegal(3, 0),
                    occupied: isLegal(0, 5),
                    onlyBoard5: legalMoves().every(([b]) => b === 5),
                    count: legalMoves().length,
                };
            });
            expect(r.inActive).toBe(true);
            expect(r.outside).toBe(false);
            expect(r.occupied).toBe(false);
            expect(r.onlyBoard5).toBe(true);
            expect(r.count).toBe(9);
        });

        test('being sent to a decided board grants a free choice', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[5] = 1;                 // board 5 already decided
                boards[5] = [1, 1, 1, 0, 0, 0, 0, 0, 0];
                applyMove(0, 5, 1);           // X sends O to decided board 5
                return { active: activeBoard, freeElsewhere: isLegal(3, 0) };
            });
            expect(r.active).toBe(-1);
            expect(r.freeElsewhere).toBe(true);
        });

        test('a cell inside a decided mini-board is never legal', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[2] = 1;
                return isLegal(2, 3);
            });
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Human move flow
    // -----------------------------------------------------------------------
    test.describe('human move', () => {
        test('humanMove places an X and hands the turn to O', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                humanMove(4, 4);
                return { cell: boards[4][4], player: currentPlayer };
            });
            expect(r.cell).toBe(1);
            expect(r.player).toBe(2);
        });

        test('humanMove ignores an illegal (out-of-active-board) click', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                applyMove(0, 5, 1);   // O to move, forced to board 5
                currentPlayer = 1;    // pretend it is X to move but still forced to 5
                humanMove(3, 0);      // illegal: not board 5
                return { cell: boards[3][0], player: currentPlayer };
            });
            expect(r.cell).toBe(0);
            expect(r.player).toBe(1);
        });

        test('humanMove is ignored once the game is over', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                state = 'won'; winner = 2;
                humanMove(0, 0);
                return boards[0][0];
            });
            expect(r).toBe(0);
        });

        test('winning three mini-boards in a row wins the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[0] = 1; macro[1] = 1;          // X already owns boards 0 and 1
                boards[2] = [1, 1, 0, 0, 0, 0, 0, 0, 0]; // one move from winning board 2
                activeBoard = -1; currentPlayer = 1;
                humanMove(2, 2);                      // completes board 2 -> macro row 0-1-2
                return { state, winner, macro2: macro[2], line: winLine };
            });
            expect(r.macro2).toBe(1);
            expect(r.state).toBe('won');
            expect(r.winner).toBe(1);
            expect(r.line).not.toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // AI behaviour (deterministic)
    // -----------------------------------------------------------------------
    test.describe('AI', () => {
        test('chooseAiMove returns a legal move', async ({ page }) => {
            const ok = await page.evaluate(() => {
                newGame();
                applyMove(4, 0, 1);          // X moves, O forced to board 0
                const [b, c] = chooseAiMove();
                return isLegal(b, c);
            });
            expect(ok).toBe(true);
        });

        test('AI takes an immediate game-winning move', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[0] = 2; macro[1] = 2;               // O owns boards 0 and 1
                boards[2] = [2, 2, 0, 0, 0, 0, 0, 0, 0];  // O one move from board 2
                activeBoard = -1; currentPlayer = 2;
                return chooseAiMove();                    // must be (2,2) to win the game
            });
            expect(r).toEqual([2, 2]);
        });

        test('aiMove plays an O and returns the turn to X', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                applyMove(4, 0, 1);   // X moved; O to move, forced to board 0
                aiMove();
                const os = boards.flat().filter(v => v === 2).length;
                return { os, player: currentPlayer, state };
            });
            expect(r.os).toBe(1);
            expect(r.player).toBe(1);
            expect(r.state).toBe('playing');
        });

        test('AI wins the game via aiMove', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[3] = 2; macro[4] = 2;
                boards[5] = [2, 2, 0, 0, 0, 0, 0, 0, 0];
                activeBoard = -1; currentPlayer = 2;
                aiMove();
                return { state, winner };
            });
            expect(r.state).toBe('won');
            expect(r.winner).toBe(2);
        });

        test('AI never plays inside a decided mini-board', async ({ page }) => {
            const ok = await page.evaluate(() => {
                newGame();
                macro[0] = 1;
                boards[0] = [1, 1, 1, 0, 0, 0, 0, 0, 0];
                activeBoard = -1; currentPlayer = 2;
                const [b] = chooseAiMove();
                return b !== 0;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Draw
    // -----------------------------------------------------------------------
    test.describe('draw', () => {
        test('a full macro board with no line is a draw', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                // Decide all nine mini-boards with no macro three-in-a-row.
                const pattern = [1, 2, 1, 2, 2, 1, 1, 1, 2];
                for (let b = 0; b < 9; b++) macro[b] = pattern[b];
                const full = isMacroFull();
                const w = macroWinner();
                return { full, w };
            });
            expect(r.full).toBe(true);
            expect(r.w).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring / persistence
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('an X win increments the X counter and persists', async ({ page }) => {
            await page.evaluate(() => {
                newGame();
                macro[0] = 1; macro[1] = 1;
                boards[2] = [1, 1, 0, 0, 0, 0, 0, 0, 0];
                activeBoard = -1; currentPlayer = 1;
                humanMove(2, 2); // X wins the game
            });
            await expect(page.locator('#x-wins')).toHaveText('1');
            const stored = await page.evaluate(() => localStorage.getItem('uttt-score'));
            expect(stored).toContain('1');

            const restored = await page.evaluate(() => {
                localStorage.setItem('uttt-score', JSON.stringify({ x: 4, o: 2, draws: 1 }));
                loadScores();
                renderScores();
                return { x: scores.x, o: scores.o, draws: scores.draws, dom: document.getElementById('x-wins').textContent };
            });
            expect(restored).toEqual({ x: 4, o: 2, draws: 1, dom: '4' });
        });

        test('newGame clears the boards but keeps the score', async ({ page }) => {
            const r = await page.evaluate(() => {
                newGame();
                macro[0] = 1; macro[1] = 1;
                boards[2] = [1, 1, 0, 0, 0, 0, 0, 0, 0];
                activeBoard = -1; currentPlayer = 1;
                humanMove(2, 2);            // X win -> score 1
                const before = scores.x;
                newGame();
                return {
                    before,
                    after: scores.x,
                    empty: boards.every(b => b.every(c => c === 0)),
                    macroEmpty: macro.every(m => m === 0),
                    state,
                    player: currentPlayer,
                    active: activeBoard,
                };
            });
            expect(r.before).toBe(1);
            expect(r.after).toBe(1);
            expect(r.empty).toBe(true);
            expect(r.macroEmpty).toBe(true);
            expect(r.state).toBe('playing');
            expect(r.player).toBe(1);
            expect(r.active).toBe(-1);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('clicking a cell places an X there', async ({ page }) => {
            await page.evaluate(() => newGame());
            const canvas = page.locator('#canvas');
            const box = await canvas.boundingBox();
            // Cell (b=4, c=4) centre: x = (4%3)*180 + (4%3)*60 + 30 = 180+60+30 = 270.
            await page.mouse.click(box.x + 270, box.y + 270);
            const cell = await page.evaluate(() => boards[4][4]);
            expect(cell).toBe(1);
        });

        test('pressing R starts a new game', async ({ page }) => {
            await page.evaluate(() => { newGame(); boards[0][0] = 1; });
            await page.keyboard.press('r');
            const empty = await page.evaluate(() => boards.every(b => b.every(c => c === 0)));
            expect(empty).toBe(true);
        });

        test('the New Game button resets the boards', async ({ page }) => {
            await page.evaluate(() => { newGame(); boards[8][8] = 2; });
            await page.locator('#btn-new').click();
            const empty = await page.evaluate(() => boards.every(b => b.every(c => c === 0)));
            expect(empty).toBe(true);
        });
    });
});
