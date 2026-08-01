const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Every logic test drives the game by hand, so the AI is switched off in the
// shared setup. The handful of tests that care about the AI turn it back on
// explicitly.
test.describe('Quoridor', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => { autoAI = false; });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Quoridor', async ({ page }) => {
            await expect(page).toHaveTitle('Quoridor');
        });

        test('canvas is 560x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/start|space/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('board is 9x9 with 10 walls each', async ({ page }) => {
            const cfg = await page.evaluate(() => ({ size: BOARD_SIZE, walls: WALLS_PER_PLAYER }));
            expect(cfg.size).toBe(9);
            expect(cfg.walls).toBe(10);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('pawns start on opposite middle edges', async ({ page }) => {
            const p = await page.evaluate(() => { startGame(); return pawns.map((x) => ({ ...x })); });
            expect(p[0]).toEqual({ r: 8, c: 4 });
            expect(p[1]).toEqual({ r: 0, c: 4 });
        });

        test('each player starts with 10 walls and no walls are on the board', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { left: [...wallsLeft], placed: walls.length }; });
            expect(s.left).toEqual([10, 10]);
            expect(s.placed).toBe(0);
        });

        test('the human player moves first', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return turn; })).toBe(0);
        });

        test('goal rows are opposite', async ({ page }) => {
            const g = await page.evaluate(() => [goalRow(0), goalRow(1)]);
            expect(g).toEqual([0, 8]);
        });

        test('HUD shows the walls remaining', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#walls-0')).toHaveText('10');
            await expect(page.locator('#walls-1')).toHaveText('10');
        });
    });

    // -----------------------------------------------------------------------
    // Pawn movement
    // -----------------------------------------------------------------------
    test.describe('pawn movement', () => {
        test('from the starting square there are three legal moves', async ({ page }) => {
            const moves = await page.evaluate(() => { startGame(); return legalMoves(0); });
            expect(moves).toHaveLength(3);
            expect(moves).toEqual(expect.arrayContaining([
                { r: 7, c: 4 }, { r: 8, c: 3 }, { r: 8, c: 5 },
            ]));
        });

        test('a pawn in open space has four legal moves', async ({ page }) => {
            const moves = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 4, c: 4 };
                return legalMoves(0);
            });
            expect(moves).toHaveLength(4);
        });

        test('diagonal steps are illegal', async ({ page }) => {
            const ok = await page.evaluate(() => { startGame(); return isLegalMove(0, 7, 3); });
            expect(ok).toBe(false);
        });

        test('moving updates the pawn and passes the turn', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const moved = movePawn(7, 4);
                return { moved, pawn: { ...pawns[0] }, turn };
            });
            expect(s.moved).toBe(true);
            expect(s.pawn).toEqual({ r: 7, c: 4 });
            expect(s.turn).toBe(1);
        });

        test('an illegal move is rejected and keeps the turn', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const moved = movePawn(0, 0);
                return { moved, pawn: { ...pawns[0] }, turn };
            });
            expect(s.moved).toBe(false);
            expect(s.pawn).toEqual({ r: 8, c: 4 });
            expect(s.turn).toBe(0);
        });

        test('a pawn cannot move through a wall', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                placeWall(7, 4, 'h'); // spans the two cells north of the player
                return isLegalMove(0, 7, 4);
            });
            expect(ok).toBe(false);
        });

        test('a pawn cannot move onto the square the opponent occupies', async ({ page }) => {
            const moves = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 5, c: 4 };
                pawns[1] = { r: 4, c: 4 };
                return legalMoves(0);
            });
            expect(moves).not.toContainEqual({ r: 4, c: 4 });
        });

        test('a pawn jumps straight over an adjacent opponent', async ({ page }) => {
            const moves = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 5, c: 4 };
                pawns[1] = { r: 4, c: 4 };
                return legalMoves(0);
            });
            expect(moves).toContainEqual({ r: 3, c: 4 });
        });

        test('a wall behind the opponent turns the jump into two diagonals', async ({ page }) => {
            const moves = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 5, c: 4 };
                pawns[1] = { r: 4, c: 4 };
                placeWall(3, 4, 'h'); // between rows 3 and 4, covering column 4
                return legalMoves(0);
            });
            expect(moves).not.toContainEqual({ r: 3, c: 4 });
            expect(moves).toContainEqual({ r: 4, c: 3 });
            expect(moves).toContainEqual({ r: 4, c: 5 });
        });

        test('the board edge behind the opponent also allows diagonals', async ({ page }) => {
            const moves = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 1, c: 4 };
                pawns[1] = { r: 0, c: 4 };
                return legalMoves(0);
            });
            expect(moves).toContainEqual({ r: 0, c: 3 });
            expect(moves).toContainEqual({ r: 0, c: 5 });
        });

        test('arrow keys move the pawn', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => ({ ...pawns[0] }))).toEqual({ r: 7, c: 4 });
        });
    });

    // -----------------------------------------------------------------------
    // Walls
    // -----------------------------------------------------------------------
    test.describe('walls', () => {
        test('placing a wall records it and spends one from the stock', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const ok = placeWall(4, 4, 'h');
                return { ok, walls: walls.map((w) => ({ ...w })), left: [...wallsLeft], turn };
            });
            expect(s.ok).toBe(true);
            expect(s.walls).toEqual([{ r: 4, c: 4, o: 'h' }]);
            expect(s.left).toEqual([9, 10]);
            expect(s.turn).toBe(1);
        });

        test('a wall blocks movement between the cells it separates', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'h');
                return [
                    isBlocked(4, 4, 5, 4),
                    isBlocked(4, 5, 5, 5),
                    isBlocked(4, 6, 5, 6),
                ];
            });
            expect(blocked).toEqual([true, true, false]);
        });

        test('a vertical wall blocks horizontal movement only', async ({ page }) => {
            const blocked = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'v');
                return [
                    isBlocked(4, 4, 4, 5),
                    isBlocked(5, 4, 5, 5),
                    isBlocked(4, 4, 5, 4),
                ];
            });
            expect(blocked).toEqual([true, true, false]);
        });

        test('two walls cannot share a slot', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'h');
                return canPlaceWall(4, 4, 'v');
            });
            expect(ok).toBe(false);
        });

        test('walls of the same orientation cannot overlap', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'h');
                return {
                    overlapRight: canPlaceWall(4, 5, 'h'),
                    overlapLeft: canPlaceWall(4, 3, 'h'),
                    clear: canPlaceWall(4, 6, 'h'),
                    otherRow: canPlaceWall(5, 4, 'h'),
                };
            });
            expect(res.overlapRight).toBe(false);
            expect(res.overlapLeft).toBe(false);
            expect(res.clear).toBe(true);
            expect(res.otherRow).toBe(true);
        });

        test('vertical walls cannot overlap vertically', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'v');
                return {
                    above: canPlaceWall(3, 4, 'v'),
                    below: canPlaceWall(5, 4, 'v'),
                    clear: canPlaceWall(6, 4, 'v'),
                    sameRow: canPlaceWall(4, 5, 'v'),
                };
            });
            expect(res.above).toBe(false);
            expect(res.below).toBe(false);
            expect(res.clear).toBe(true);
            expect(res.sameRow).toBe(true);
        });

        test('slots outside the 8x8 groove grid are rejected', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                return [canPlaceWall(-1, 0, 'h'), canPlaceWall(8, 0, 'h'), canPlaceWall(0, 8, 'v')];
            });
            expect(res).toEqual([false, false, false]);
        });

        test('a wall that would seal a player off is illegal', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                // Box the human pawn into the bottom-left corner: the last wall
                // of the pen would leave it with no route to row 0.
                pawns[0] = { r: 8, c: 0 };
                placeWall(7, 0, 'h');
                return { blocked: canPlaceWall(7, 0, 'v'), sealing: canPlaceWall(7, 1, 'v') };
            });
            expect(res.sealing).toBe(false);
        });

        test('a rejected wall is not recorded and does not spend stock', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'h');
                const ok = placeWall(4, 5, 'h');
                return { ok, count: walls.length, left: [...wallsLeft] };
            });
            expect(s.ok).toBe(false);
            expect(s.count).toBe(1);
            expect(s.left).toEqual([9, 10]);
        });

        test('a player with no walls left cannot place one', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                wallsLeft[0] = 0;
                return { can: canPlaceWall(4, 4, 'h'), placed: placeWall(4, 4, 'h'), count: walls.length };
            });
            expect(res.can).toBe(false);
            expect(res.placed).toBe(false);
            expect(res.count).toBe(0);
        });

        test('the HUD wall counter drops when a wall is placed', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeWall(4, 4, 'h'); });
            await expect(page.locator('#walls-0')).toHaveText('9');
        });
    });

    // -----------------------------------------------------------------------
    // Pathfinding
    // -----------------------------------------------------------------------
    test.describe('pathfinding', () => {
        test('both pawns start eight steps from their goal', async ({ page }) => {
            const d = await page.evaluate(() => { startGame(); return [shortestPath(0), shortestPath(1)]; });
            expect(d).toEqual([8, 8]);
        });

        test('a wall in the way lengthens the shortest path', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const before = shortestPath(0);
                placeWall(7, 3, 'h');
                placeWall(7, 5, 'h');
                return { before, after: shortestPath(0) };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('every player always has a path during a legal game', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                placeWall(4, 0, 'h');
                placeWall(4, 2, 'h');
                placeWall(4, 4, 'h');
                placeWall(4, 6, 'h');
                return hasPath(0) && hasPath(1);
            });
            expect(ok).toBe(true);
        });

        test('a pawn already on its goal row is zero steps away', async ({ page }) => {
            const d = await page.evaluate(() => { startGame(); pawns[0] = { r: 0, c: 4 }; return shortestPath(0); });
            expect(d).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('reaching the far row wins the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 1, c: 4 };
                pawns[1] = { r: 8, c: 0 };
                movePawn(0, 4);
                return { state, winner };
            });
            expect(s.state).toBe('over');
            expect(s.winner).toBe(0);
        });

        test('the opponent wins by reaching row 8', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pawns[1] = { r: 7, c: 2 };
                turn = 1;
                movePawn(8, 2);
                return { state, winner };
            });
            expect(s.state).toBe('over');
            expect(s.winner).toBe(1);
        });

        test('the overlay announces the winner', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 1, c: 4 };
                pawns[1] = { r: 8, c: 0 };
                movePawn(0, 4);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('no moves are accepted after the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pawns[0] = { r: 1, c: 4 };
                pawns[1] = { r: 8, c: 0 };
                movePawn(0, 4);
                return { moved: movePawn(0, 3), placed: placeWall(4, 4, 'h') };
            });
            expect(s.moved).toBe(false);
            expect(s.placed).toBe(false);
        });

        test('a new game clears the board', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placeWall(4, 4, 'h');
                movePawn(0, 0); // ignored, keeps the state dirty
                startGame();
                return { walls: walls.length, left: [...wallsLeft], turn, state, winner };
            });
            expect(s).toEqual({ walls: 0, left: [10, 10], turn: 0, state: 'playing', winner: null });
        });

        test('the New Game button restarts', async ({ page }) => {
            await page.evaluate(() => { startGame(); placeWall(4, 4, 'h'); });
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => walls.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Computer opponent
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test('the AI takes its turn and hands play back', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const before = { ...pawns[1] };
                aiMove();
                return { before, after: { ...pawns[1] }, turn, walls: walls.length };
            });
            const acted = s.walls === 1 || s.after.r !== s.before.r || s.after.c !== s.before.c;
            expect(acted).toBe(true);
            expect(s.turn).toBe(0);
        });

        test('the AI advances toward its goal from the opening position', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                const before = shortestPath(1);
                aiMove();
                return { before, after: shortestPath(1) };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('the AI moves automatically after the player when enabled', async ({ page }) => {
            await page.evaluate(() => { autoAI = true; startGame(); movePawn(7, 4); });
            await expect.poll(async () => page.evaluate(() => turn)).toBe(0);
            expect(await page.evaluate(() => pawns[1].r !== 0 || walls.length === 1)).toBe(true);
        });

        test('a full self-played game keeps both players connected to their goals', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame();
                let connected = true;
                for (let i = 0; i < 40 && state === 'playing'; i++) {
                    // The human side simply walks its own shortest path.
                    const best = legalMoves(0)
                        .map((m) => {
                            const save = { ...pawns[0] };
                            pawns[0] = m;
                            const d = shortestPath(0);
                            pawns[0] = save;
                            return { m, d };
                        })
                        .sort((a, b) => a.d - b.d)[0];
                    movePawn(best.m.r, best.m.c);
                    if (state !== 'playing') break;
                    aiMove();
                    if (!hasPath(0) || !hasPath(1)) { connected = false; break; }
                }
                return { connected, state, winner };
            });
            expect(res.connected).toBe(true);
            expect(res.state).toBe('over');
            expect([0, 1]).toContain(res.winner);
        });

        test('the AI never places a wall that seals anyone in', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 12 && state === 'playing'; i++) {
                    turn = 1;
                    aiMove();
                    if (!hasPath(0) || !hasPath(1)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse & keyboard interaction with the canvas
    // -----------------------------------------------------------------------
    test.describe('canvas interaction', () => {
        test('clicking a highlighted square moves the pawn', async ({ page }) => {
            await page.evaluate(() => startGame());
            const pt = await page.evaluate(() => cellCenter(7, 4));
            await page.locator('#canvas').click({ position: { x: pt.x, y: pt.y } });
            expect(await page.evaluate(() => ({ ...pawns[0] }))).toEqual({ r: 7, c: 4 });
        });

        test('clicking an illegal square does nothing', async ({ page }) => {
            await page.evaluate(() => startGame());
            const pt = await page.evaluate(() => cellCenter(2, 2));
            await page.locator('#canvas').click({ position: { x: pt.x, y: pt.y } });
            expect(await page.evaluate(() => ({ ...pawns[0] }))).toEqual({ r: 8, c: 4 });
            expect(await page.evaluate(() => walls.length)).toBe(0);
        });

        test('clicking a groove places a wall in the current orientation', async ({ page }) => {
            await page.evaluate(() => { startGame(); wallOrientation = 'h'; });
            const pt = await page.evaluate(() => slotCenter(4, 4));
            await page.locator('#canvas').click({ position: { x: pt.x, y: pt.y } });
            expect(await page.evaluate(() => walls.map((w) => ({ ...w })))).toEqual([{ r: 4, c: 4, o: 'h' }]);
        });

        test('R toggles the wall orientation', async ({ page }) => {
            await page.evaluate(() => { startGame(); wallOrientation = 'h'; });
            await page.keyboard.press('r');
            expect(await page.evaluate(() => wallOrientation)).toBe('v');
            await page.keyboard.press('r');
            expect(await page.evaluate(() => wallOrientation)).toBe('h');
        });

        test('the orientation button toggles too and shows the mode', async ({ page }) => {
            await page.evaluate(() => { startGame(); wallOrientation = 'h'; updateHud(); });
            await page.locator('#btn-orientation').click();
            expect(await page.evaluate(() => wallOrientation)).toBe('v');
            await expect(page.locator('#btn-orientation')).toContainText(/vertical/i);
        });

        test('points map back to the cell and groove they sit in', async ({ page }) => {
            const res = await page.evaluate(() => {
                const c = cellCenter(3, 6);
                const s = slotCenter(2, 5);
                return { cell: cellFromPoint(c.x, c.y), slot: slotFromPoint(s.x, s.y) };
            });
            expect(res.cell).toEqual({ r: 3, c: 6 });
            expect(res.slot).toEqual({ r: 2, c: 5 });
        });
    });
});
