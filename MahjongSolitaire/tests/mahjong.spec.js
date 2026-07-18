const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Put the game into 'playing' so clickTile() reacts, without needing the overlay.
async function play(page) {
    await page.locator('#btn-start').click();
    await page.evaluate(() => { state = 'playing'; });
}

test.describe('Mahjong Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions Mahjong', async ({ page }) => {
            await expect(page).toHaveTitle(/Mahjong/i);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains how to play', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/match/i);
        });

        test('canvas exists with sane dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('a board is dealt on load', async ({ page }) => {
            expect(await page.evaluate(() => tiles.length)).toBe(64);
        });

        test('the tiles-remaining HUD shows 64', async ({ page }) => {
            await expect(page.locator('#remaining')).toHaveText('64');
        });
    });

    // -----------------------------------------------------------------------
    // The deal
    // -----------------------------------------------------------------------
    test.describe('the deal', () => {
        test('every tile has a face', async ({ page }) => {
            const allFaced = await page.evaluate(() => tiles.every(t => t.face != null));
            expect(allFaced).toBe(true);
        });

        test('each face appears exactly four times', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const m = {};
                for (const t of tiles) m[t.face] = (m[t.face] || 0) + 1;
                return Object.values(m);
            });
            expect(counts.length).toBe(16);
            expect(counts.every(c => c === 4)).toBe(true);
        });

        test('the three layers hold 40, 18 and 6 tiles', async ({ page }) => {
            const perLayer = await page.evaluate(() => {
                const m = {};
                for (const t of tiles) m[t.layer] = (m[t.layer] || 0) + 1;
                return m;
            });
            expect(perLayer[0]).toBe(40);
            expect(perLayer[1]).toBe(18);
            expect(perLayer[2]).toBe(6);
        });

        test('there is at least one legal move at the start', async ({ page }) => {
            expect(await page.evaluate(() => anyMovesLeft())).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Free-tile rules
    // -----------------------------------------------------------------------
    test.describe('free tiles', () => {
        test('a tile with an open side and nothing on top is free', async ({ page }) => {
            await play(page);
            const free = await page.evaluate(() => {
                tiles = [{ id: 0, layer: 0, r: 0, c: 0, face: 'A', removed: false }];
                return isFree(tiles[0]);
            });
            expect(free).toBe(true);
        });

        test('a covered tile is not free', async ({ page }) => {
            await play(page);
            const free = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'A', removed: false },
                    { id: 1, layer: 1, r: 0, c: 0, face: 'B', removed: false }, // sits on top
                ];
                return isFree(tiles[0]);
            });
            expect(free).toBe(false);
        });

        test('a tile blocked on both sides is not free', async ({ page }) => {
            await play(page);
            const free = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'A', removed: false },
                    { id: 1, layer: 0, r: 0, c: 1, face: 'B', removed: false }, // middle
                    { id: 2, layer: 0, r: 0, c: 2, face: 'C', removed: false },
                ];
                return isFree(tiles[1]);
            });
            expect(free).toBe(false);
        });

        test('opening one side frees a previously blocked tile', async ({ page }) => {
            await play(page);
            const free = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'A', removed: false },
                    { id: 1, layer: 0, r: 0, c: 1, face: 'B', removed: false },
                    { id: 2, layer: 0, r: 0, c: 2, face: 'C', removed: true }, // right side gone
                ];
                return isFree(tiles[1]);
            });
            expect(free).toBe(true);
        });

        test('a removed tile is never free', async ({ page }) => {
            await play(page);
            const free = await page.evaluate(() => {
                tiles = [{ id: 0, layer: 0, r: 0, c: 0, face: 'A', removed: true }];
                return isFree(tiles[0]);
            });
            expect(free).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Matching & removal
    // -----------------------------------------------------------------------
    test.describe('matching and removal', () => {
        test('removePair marks both tiles removed and drops the count', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                const before = remaining();
                const [a, b] = [tiles[0], tiles.find(t => t.id !== tiles[0].id)];
                removePair(a, b);
                return { before, after: remaining(), aGone: a.removed, bGone: b.removed };
            });
            expect(r.after).toBe(r.before - 2);
            expect(r.aGone).toBe(true);
            expect(r.bGone).toBe(true);
        });

        test('clicking two matching free tiles clears them', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                // two isolated, matching, free tiles
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                const before = remaining();
                clickTile(0);
                clickTile(1);
                return { before, after: remaining() };
            });
            expect(r.before).toBe(2);
            expect(r.after).toBe(0);
        });

        test('clicking two non-matching tiles moves the selection instead of removing', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'Y', removed: false },
                ];
                selected = null;
                clickTile(0);
                clickTile(1);
                return { selected, after: remaining() };
            });
            expect(r.after).toBe(2);      // nothing removed
            expect(r.selected).toBe(1);   // selection moved to the second tile
        });

        test('clicking a blocked tile does nothing', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 0, c: 1, face: 'X', removed: false }, // middle, blocked
                    { id: 2, layer: 0, r: 0, c: 2, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(1); // blocked
                return { selected };
            });
            expect(r.selected).toBe(null);
        });

        test('clicking the selected tile again deselects it', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                tiles = [{ id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false }];
                selected = null;
                clickTile(0);
                const first = selected;
                clickTile(0);
                return { first, second: selected };
            });
            expect(r.first).toBe(0);
            expect(r.second).toBe(null);
        });

        test('the remaining HUD updates after a removal', async ({ page }) => {
            await play(page);
            await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1);
            });
            await expect(page.locator('#remaining')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Solvability — the whole point of the generator
    // -----------------------------------------------------------------------
    test.describe('solvability', () => {
        test('the recorded solution plan has 32 pairs', async ({ page }) => {
            expect(await page.evaluate(() => solutionPlan.length)).toBe(32);
        });

        test('replaying the solution plan clears the whole board', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (const [a, b] of solutionPlan) {
                    const ta = tiles[a], tb = tiles[b];
                    if (ta.removed || tb.removed) return 'already removed';
                    if (!isFree(ta) || !isFree(tb)) return 'pair not free';
                    if (ta.face !== tb.face) return 'faces differ';
                    removePair(ta, tb);
                }
                return remaining();
            });
            expect(ok).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Hints & moves-left
    // -----------------------------------------------------------------------
    test.describe('hints and dead ends', () => {
        test('findHint returns a matching free pair when one exists', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                const hint = findHint();
                return { hint, faceMatch: tiles[hint[0]].face === tiles[hint[1]].face };
            });
            expect(r.hint).not.toBeNull();
            expect(r.faceMatch).toBe(true);
        });

        test('anyMovesLeft is false when no free pair matches', async ({ page }) => {
            await play(page);
            const moves = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'Y', removed: false },
                ];
                return anyMovesLeft();
            });
            expect(moves).toBe(false);
        });

        test('running out of moves puts the game in the stuck state', async ({ page }) => {
            await play(page);
            const s = await page.evaluate(() => {
                // three tiles: remove a matching pair leaves one lone tile -> no moves
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                    { id: 2, layer: 0, r: 4, c: 7, face: 'Z', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1); // clears the X pair, lone Z remains
                return state;
            });
            expect(s).toBe('stuck');
        });
    });

    // -----------------------------------------------------------------------
    // Undo
    // -----------------------------------------------------------------------
    test.describe('undo', () => {
        test('undo restores the most recently removed pair', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1);
                const cleared = remaining();
                undo();
                return { cleared, restored: remaining() };
            });
            expect(r.cleared).toBe(0);
            expect(r.restored).toBe(2);
        });

        test('undo does nothing when no moves have been made', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                const before = remaining();
                undo();
                return { before, after: remaining() };
            });
            expect(r.after).toBe(r.before);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('clearing the last pair wins the game', async ({ page }) => {
            await play(page);
            const s = await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1);
                return state;
            });
            expect(s).toBe('won');
        });

        test('the overlay shows a win message', async ({ page }) => {
            await play(page);
            await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('a best time is written to localStorage on a win', async ({ page }) => {
            await play(page);
            await page.evaluate(() => {
                tiles = [
                    { id: 0, layer: 0, r: 0, c: 0, face: 'X', removed: false },
                    { id: 1, layer: 0, r: 2, c: 4, face: 'X', removed: false },
                ];
                selected = null;
                clickTile(0); clickTile(1);
            });
            const stored = await page.evaluate(() => localStorage.getItem('mahjong-best'));
            expect(stored).not.toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Starting / new game
    // -----------------------------------------------------------------------
    test.describe('starting and new game', () => {
        test('Start button dismisses the overlay and begins play', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('New Game re-deals a full 64-tile board', async ({ page }) => {
            await play(page);
            const n = await page.evaluate(() => {
                tiles.forEach(t => t.removed = true); // empty the board
                newGame();
                return remaining();
            });
            expect(n).toBe(64);
        });

        test('New Game clears any selection and history', async ({ page }) => {
            await play(page);
            const r = await page.evaluate(() => {
                clickTile(tiles.find(t => isFree(t)).id); // select something
                newGame();
                return { selected, undoLen: undoStack.length };
            });
            expect(r.selected).toBe(null);
            expect(r.undoLen).toBe(0);
        });
    });
});
