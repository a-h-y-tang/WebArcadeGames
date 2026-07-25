const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Reset to a clean, empty, playing board with `player` to move.
async function freshBoard(page, player = 1) {
    await page.evaluate((p) => {
        for (let r = 0; r <= SIZE; r++)
            for (let c = 0; c < SIZE; c++) hEdges[r][c] = 0;
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c <= SIZE; c++) vEdges[r][c] = 0;
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++) boxes[r][c] = 0;
        scores[1] = 0;
        scores[2] = 0;
        winner = 0;
        currentPlayer = p;
        state = 'playing';
    }, player);
}

test.describe('Dots and Boxes', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Dots and Boxes', async ({ page }) => {
            await expect(page).toHaveTitle('Dots and Boxes');
        });

        test('grid is 4 boxes per side', async ({ page }) => {
            const s = await page.evaluate(() => SIZE);
            expect(s).toBe(4);
        });

        test('there are 16 boxes, all unclaimed', async ({ page }) => {
            const claimed = await page.evaluate(() =>
                boxes.flat().filter((v) => v !== 0).length
            );
            const totalBoxes = await page.evaluate(() => boxes.flat().length);
            expect(totalBoxes).toBe(16);
            expect(claimed).toBe(0);
        });

        test('no edges are drawn initially', async ({ page }) => {
            const drawn = await page.evaluate(
                () => hEdges.flat().filter(Boolean).length + vEdges.flat().filter(Boolean).length
            );
            expect(drawn).toBe(0);
        });

        test('blue (human) moves first', async ({ page }) => {
            const p = await page.evaluate(() => currentPlayer);
            expect(p).toBe(1);
        });

        test('scores start at zero', async ({ page }) => {
            const s = await page.evaluate(() => ({ ...scores }));
            expect(s[1]).toBe(0);
            expect(s[2]).toBe(0);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas exists', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveCount(1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('start button dismisses overlay and begins play', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Drawing edges
    // -----------------------------------------------------------------------
    test.describe('drawing edges', () => {
        test('drawing a lone edge completes no box and passes the turn', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            const completed = await page.evaluate(() => drawEdge('h', 0, 0));
            expect(completed).toBe(0);
            const p = await page.evaluate(() => currentPlayer);
            expect(p).toBe(2); // turn passed to red
        });

        test('the drawn edge is recorded with the current player as owner', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            await page.evaluate(() => drawEdge('v', 1, 2));
            const owner = await page.evaluate(() => vEdges[1][2]);
            expect(owner).toBe(1);
        });

        test('drawing an already-drawn edge is rejected (returns -1)', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            await page.evaluate(() => drawEdge('h', 0, 0));
            const again = await page.evaluate(() => {
                currentPlayer = 1;
                return drawEdge('h', 0, 0);
            });
            expect(again).toBe(-1);
        });

        test('edgeDrawn reflects state', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            const before = await page.evaluate(() => edgeDrawn('h', 2, 1));
            await page.evaluate(() => drawEdge('h', 2, 1));
            const after = await page.evaluate(() => edgeDrawn('h', 2, 1));
            expect(before).toBe(false);
            expect(after).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Completing boxes
    // -----------------------------------------------------------------------
    test.describe('completing boxes', () => {
        test('sidesOfBox counts drawn sides', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            await page.evaluate(() => {
                hEdges[0][0] = 1; // top of box (0,0)
                vEdges[0][0] = 1; // left of box (0,0)
            });
            const sides = await page.evaluate(() => sidesOfBox(0, 0));
            expect(sides).toBe(2);
        });

        test('completing a box claims it, scores a point, and grants another turn', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            // Pre-draw three sides of box (0,0): top, left, right. Bottom completes it.
            await page.evaluate(() => {
                hEdges[0][0] = 1;
                vEdges[0][0] = 1;
                vEdges[0][1] = 1;
            });
            const completed = await page.evaluate(() => {
                currentPlayer = 1;
                return drawEdge('h', 1, 0); // bottom of box (0,0)
            });
            expect(completed).toBe(1);
            const res = await page.evaluate(() => ({
                owner: boxes[0][0],
                score: scores[1],
                turn: currentPlayer,
            }));
            expect(res.owner).toBe(1);
            expect(res.score).toBe(1);
            expect(res.turn).toBe(1); // same player keeps the turn
        });

        test('a single edge can complete two boxes at once (double-cross)', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            // Box (0,0) needs its right side; box (0,1) needs its left side.
            // The shared vertical edge vEdges[0][1] completes both.
            await page.evaluate(() => {
                // box (0,0): top, bottom, left drawn
                hEdges[0][0] = 1; hEdges[1][0] = 1; vEdges[0][0] = 1;
                // box (0,1): top, bottom, right drawn
                hEdges[0][1] = 1; hEdges[1][1] = 1; vEdges[0][2] = 1;
            });
            const completed = await page.evaluate(() => {
                currentPlayer = 2;
                return drawEdge('v', 0, 1); // shared edge
            });
            expect(completed).toBe(2);
            const s = await page.evaluate(() => scores[2]);
            expect(s).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('isBoardFull is false at the start and true when all boxes claimed', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            const empty = await page.evaluate(() => isBoardFull());
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++) boxes[r][c] = 1;
            });
            const full = await page.evaluate(() => isBoardFull());
            expect(empty).toBe(false);
            expect(full).toBe(true);
        });

        test('finishing the last box ends the game and sets the winner', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            // Claim 15 boxes for blue, leave box (3,3) needing one side.
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (!(r === 3 && c === 3)) boxes[r][c] = 1;
                scores[1] = 15;
                scores[2] = 0;
                // Three sides of box (3,3): top, left, right. Bottom completes it.
                hEdges[3][3] = 2;
                vEdges[3][3] = 2;
                vEdges[3][4] = 2;
                currentPlayer = 2;
            });
            await page.evaluate(() => drawEdge('h', 4, 3)); // bottom of (3,3)
            const res = await page.evaluate(() => ({ state, winner, s1: scores[1], s2: scores[2] }));
            expect(res.state).toBe('over');
            expect(res.s2).toBe(1);
            expect(res.winner).toBe(1); // blue has 15 vs 1
        });

        test('an equal split is a draw (winner 0)', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            await page.evaluate(() => {
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        boxes[r][c] = (r === 3 && c === 3) ? 0 : ((r * SIZE + c) % 2 === 0 ? 1 : 2);
                // 15 boxes assigned; count them.
                scores[1] = boxes.flat().filter((v) => v === 1).length;
                scores[2] = boxes.flat().filter((v) => v === 2).length;
                // Make box (3,3) completable by whoever is losing so it evens out.
                hEdges[3][3] = 1; vEdges[3][3] = 1; vEdges[3][4] = 1;
                currentPlayer = scores[1] < scores[2] ? 1 : 2;
            });
            await page.evaluate(() => drawEdge('h', 4, 3));
            const res = await page.evaluate(() => ({ state, winner, s1: scores[1], s2: scores[2] }));
            expect(res.state).toBe('over');
            expect(res.s1).toBe(res.s2);
            expect(res.winner).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Computer opponent (deterministic)
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test('chooseAiMove returns a legal, undrawn edge', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 2);
            const move = await page.evaluate(() => chooseAiMove());
            expect(move).not.toBeNull();
            const drawn = await page.evaluate(
                (m) => edgeDrawn(m.type, m.r, m.c),
                move
            );
            expect(drawn).toBe(false);
        });

        test('computer takes an available box', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 2);
            // Box (1,1) has three sides; the AI should complete it.
            await page.evaluate(() => {
                hEdges[1][1] = 1; // top
                vEdges[1][1] = 1; // left
                vEdges[1][2] = 1; // right
            });
            const move = await page.evaluate(() => chooseAiMove());
            // The completing edge is the bottom: hEdges[2][1].
            expect(move).toEqual({ type: 'h', r: 2, c: 1 });
        });

        test('computer avoids giving away a box when a safe move exists', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 2);
            // Give box (0,0) two sides so that adding a third would be unsafe.
            await page.evaluate(() => {
                hEdges[0][0] = 1; // top of (0,0)
                vEdges[0][0] = 1; // left of (0,0)
            });
            const move = await page.evaluate(() => chooseAiMove());
            // The chosen edge must not raise any box to exactly three sides.
            const makesThree = await page.evaluate((m) => {
                edgeSet(m.type, m.r, m.c, 9); // temporarily mark drawn
                let bad = false;
                for (let r = 0; r < SIZE; r++)
                    for (let c = 0; c < SIZE; c++)
                        if (sidesOfBox(r, c) === 3) bad = true;
                edgeSet(m.type, m.r, m.c, 0); // revert
                return bad;
            }, move);
            expect(makesThree).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Full flow via mouse
    // -----------------------------------------------------------------------
    test.describe('gameplay via mouse', () => {
        test('clicking near an edge draws a line', async ({ page }) => {
            await page.locator('#btn-start').click();
            const box = await page.locator('#canvas').boundingBox();
            // Click near the top-left horizontal edge midpoint via game geometry.
            const pt = await page.evaluate(() => edgeMidpoint('h', 0, 0));
            await page.mouse.click(box.x + pt.x, box.y + pt.y);
            await expect
                .poll(async () =>
                    page.evaluate(
                        () => hEdges.flat().filter(Boolean).length + vEdges.flat().filter(Boolean).length
                    )
                )
                .toBeGreaterThanOrEqual(1);
        });

        test('after the human passes the turn, the computer responds', async ({ page }) => {
            await page.locator('#btn-start').click();
            const box = await page.locator('#canvas').boundingBox();
            const pt = await page.evaluate(() => edgeMidpoint('h', 0, 0));
            await page.mouse.click(box.x + pt.x, box.y + pt.y);
            // Human's lone edge completes no box → turn passes → AI draws at least one.
            await expect
                .poll(async () =>
                    page.evaluate(
                        () => hEdges.flat().filter(Boolean).length + vEdges.flat().filter(Boolean).length
                    )
                )
                .toBeGreaterThanOrEqual(2);
        });
    });

    // -----------------------------------------------------------------------
    // Restart
    // -----------------------------------------------------------------------
    test.describe('restart', () => {
        test('New Game button clears the board', async ({ page }) => {
            await page.locator('#btn-start').click();
            await freshBoard(page, 1);
            await page.evaluate(() => {
                hEdges[0][0] = 1;
                boxes[0][0] = 1;
                scores[1] = 1;
                winner = 1;
                endGame(); // shows the game-over overlay with the New Game button
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-start').click(); // New Game
            const res = await page.evaluate(() => ({
                edges: hEdges.flat().filter(Boolean).length + vEdges.flat().filter(Boolean).length,
                claimed: boxes.flat().filter(Boolean).length,
                s1: scores[1],
                s2: scores[2],
                state,
            }));
            expect(res.edges).toBe(0);
            expect(res.claimed).toBe(0);
            expect(res.s1).toBe(0);
            expect(res.s2).toBe(0);
            expect(res.state).toBe('playing');
        });
    });
});
