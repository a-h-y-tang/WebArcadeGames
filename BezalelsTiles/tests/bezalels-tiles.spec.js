const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const FIGURE_NAMES = [
    'The Cornerstone',
    'The Tent of Meeting',
    "Noah's Ark",
    'The House on the Rock',
    'The Fish',
    'The Breastplate Jewel',
    'The Fishing Boat',
    'The Dove',
];

// ---------------------------------------------------------------------------
// Helpers. The canvas is drawn 1:1 at the default viewport, so canvas
// coordinates returned by the game double as mouse positions once the canvas
// box offset is added.
// ---------------------------------------------------------------------------
async function canvasOrigin(page) {
    const box = await page.locator('#canvas').boundingBox();
    return { x: box.x, y: box.y };
}

async function pieceState(page, id) {
    return page.evaluate((id) => {
        const p = pieceById(id);
        return { id: p.id, x: p.x, y: p.y, rot: p.rot, flip: p.flip, inTray: p.inTray };
    }, id);
}

// Drag a tile so that its bounding box lands on lattice point (x, y).
async function dragPieceTo(page, id, x, y) {
    const origin = await canvasOrigin(page);
    const info = await page.evaluate(([id, x, y]) => {
        const box = pieceBox(id);
        const grab = pieceGrabPoint(id);
        const target = latticeToPixel(x, y);
        return {
            grab,
            drop: { x: target.x + (grab.x - box.x), y: target.y + (grab.y - box.y) },
        };
    }, [id, x, y]);
    await page.mouse.move(origin.x + info.grab.x, origin.y + info.grab.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + (info.grab.x + info.drop.x) / 2, origin.y + (info.grab.y + info.drop.y) / 2);
    await page.mouse.move(origin.x + info.drop.x, origin.y + info.drop.y);
    await page.mouse.up();
}

// Drag a tile to a raw canvas pixel position (used for dropping off the board).
async function dragPieceToPixel(page, id, px, py) {
    const origin = await canvasOrigin(page);
    const grab = await page.evaluate((id) => pieceGrabPoint(id), id);
    await page.mouse.move(origin.x + grab.x, origin.y + grab.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + (grab.x + px) / 2, origin.y + (grab.y + py) / 2);
    await page.mouse.move(origin.x + px, origin.y + py);
    await page.mouse.up();
}

async function clickPiece(page, id) {
    const origin = await canvasOrigin(page);
    const grab = await page.evaluate((id) => pieceGrabPoint(id), id);
    await page.mouse.click(origin.x + grab.x, origin.y + grab.y);
}

// Lay every tile of the stored solution through the game's own placement call.
async function solveWithSolution(page) {
    await page.evaluate(() => {
        figureSolution().forEach((s) => placePiece(s.id, s));
        draw();
    });
}

test.describe("Bezalel's Tiles", () => {
    const errors = [];
    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test("page title is Bezalel's Tiles", async ({ page }) => {
            await expect(page).toHaveTitle("Bezalel's Tiles");
        });

        test('canvas is 640x540', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '540');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });

        test('all seven tiles start in the tray', async ({ page }) => {
            const tray = await page.evaluate(() => state.pieces.filter((p) => p.inTray).length);
            expect(tray).toBe(7);
        });

        test('the first figure is the Cornerstone', async ({ page }) => {
            await expect(page.locator('#figure-label')).toHaveText('The Cornerstone');
            expect(await page.evaluate(() => state.figure)).toBe(0);
        });

        test('the HUD starts at no figures finished and no hints', async ({ page }) => {
            await expect(page.locator('#solved-count')).toHaveText('0 / 8');
            await expect(page.locator('#hint-count')).toHaveText('0');
        });

        test('there is a button for each of the eight figures', async ({ page }) => {
            await expect(page.locator('.figure-btn')).toHaveCount(8);
            await expect(page.locator('.figure-btn')).toHaveText(FIGURE_NAMES);
            await expect(page.locator('.figure-btn').first()).toHaveClass(/active/);
        });

        test('the status line asks for all seven tiles', async ({ page }) => {
            await expect(page.locator('#status')).toContainText(/seven tiles/i);
        });

        test('the finished overlay is hidden', async ({ page }) => {
            await expect(page.locator('#overlay')).toBeHidden();
        });
    });

    // -------------------------------------------------------------------
    // Lattice geometry — the maths the whole game rests on
    // -------------------------------------------------------------------
    test.describe('lattice geometry', () => {
        test('the seven tiles cover 64 quarter triangles together', async ({ page }) => {
            const areas = await page.evaluate(() =>
                PIECES.map((p) => trianglesOfPolygon(transformPoints(p.pts, 0, false)).length));
            expect(areas).toEqual([16, 16, 8, 8, 8, 4, 4]);
            expect(areas.reduce((a, b) => a + b, 0)).toBe(64);
        });

        test('turning and flipping a tile never changes its area', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                for (const p of PIECES) {
                    const base = trianglesOfPolygon(transformPoints(p.pts, 0, false)).length;
                    for (let rot = 0; rot < 4; rot++) {
                        for (const flip of [false, true]) {
                            const n = trianglesOfPolygon(transformPoints(p.pts, rot, flip)).length;
                            if (n !== base) out.push(`${p.id} rot${rot} flip${flip}`);
                        }
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('tile corners stay on the lattice through every turn and flip', async ({ page }) => {
            const offLattice = await page.evaluate(() => {
                const out = [];
                for (const p of PIECES) {
                    for (let rot = 0; rot < 4; rot++) {
                        for (const flip of [false, true]) {
                            for (const [x, y] of transformPoints(p.pts, rot, flip)) {
                                if (!Number.isInteger(x) || !Number.isInteger(y)) out.push(p.id);
                            }
                        }
                    }
                }
                return out;
            });
            expect(offLattice).toEqual([]);
        });

        test('every figure has the area of the seven tiles', async ({ page }) => {
            const areas = await page.evaluate(() =>
                FIGURES.map((f) => trianglesOfPolygon(f.poly).length));
            expect(areas).toEqual(new Array(8).fill(64));
        });

        for (const [index, name] of FIGURE_NAMES.entries()) {
            test(`the stored solution for ${name} tiles it exactly`, async ({ page }) => {
                const result = await page.evaluate((i) => {
                    loadFigure(i);
                    const target = targetTriangles();
                    const solution = figureSolution();
                    const covered = [];
                    for (const s of solution) {
                        covered.push(...pieceTriangles({ ...s }));
                    }
                    return {
                        ids: solution.map((s) => s.id).sort(),
                        pieces: solution.length,
                        covered: covered.length,
                        unique: new Set(covered).size,
                        matches: new Set(covered).size === target.length &&
                            covered.every((t) => target.includes(t)),
                    };
                }, index);
                expect(result.pieces).toBe(7);
                expect(result.ids).toEqual(PIECE_IDS_SORTED);
                expect(result.covered).toBe(64);
                expect(result.unique).toBe(64);
                expect(result.matches).toBe(true);
            });
        }

        test('every figure sits inside the board', async ({ page }) => {
            const outside = await page.evaluate(() => {
                const bad = [];
                FIGURES.forEach((f, i) => {
                    loadFigure(i);
                    for (const [x, y] of figurePolygon()) {
                        if (x < 0 || y < 0 || x > BOARD.cols || y > BOARD.rows) bad.push(f.name);
                    }
                });
                return [...new Set(bad)];
            });
            expect(outside).toEqual([]);
        });

        test('laying a tile reports the triangles it covers', async ({ page }) => {
            const tris = await page.evaluate(() => {
                placePiece('small1', { x: 2, y: 2, rot: 0, flip: false });
                return pieceTriangles(pieceById('small1')).sort();
            });
            expect(tris).toEqual(['2,2,n', '2,2,e', '3,2,n', '3,2,w'].sort());
        });
    });

    // -------------------------------------------------------------------
    // Laying tiles with the mouse
    // -------------------------------------------------------------------
    test.describe('laying tiles with the mouse', () => {
        test('dragging a tile out of the tray lays it on the lattice', async ({ page }) => {
            await dragPieceTo(page, 'medium', 3, 2);
            const piece = await pieceState(page, 'medium');
            expect(piece.inTray).toBe(false);
            expect(piece).toMatchObject({ x: 3, y: 2 });
        });

        test('a laid tile always lands on whole lattice coordinates', async ({ page }) => {
            const origin = await canvasOrigin(page);
            const grab = await page.evaluate(() => pieceGrabPoint('square'));
            await page.mouse.move(origin.x + grab.x, origin.y + grab.y);
            await page.mouse.down();
            // Drop at a deliberately off-lattice pixel position.
            await page.mouse.move(origin.x + 213, origin.y + 97);
            await page.mouse.up();
            const piece = await pieceState(page, 'square');
            expect(piece.inTray).toBe(false);
            expect(Number.isInteger(piece.x) && Number.isInteger(piece.y)).toBe(true);
        });

        test('a tile dropped below the board goes back to the tray', async ({ page }) => {
            await dragPieceTo(page, 'large1', 1, 1);
            expect((await pieceState(page, 'large1')).inTray).toBe(false);
            await dragPieceToPixel(page, 'large1', 320, 500);
            expect((await pieceState(page, 'large1')).inTray).toBe(true);
        });

        test('a tile that would hang off the board goes back to the tray', async ({ page }) => {
            await dragPieceToPixel(page, 'large2', 630, 40);
            expect((await pieceState(page, 'large2')).inTray).toBe(true);
        });

        test('a laid tile can be dragged to a new place on the board', async ({ page }) => {
            await dragPieceTo(page, 'para', 2, 2);
            await dragPieceTo(page, 'para', 5, 4);
            expect(await pieceState(page, 'para')).toMatchObject({ x: 5, y: 4, inTray: false });
        });

        test('clicking a tile selects it', async ({ page }) => {
            await clickPiece(page, 'small2');
            expect(await page.evaluate(() => state.selected)).toBe('small2');
        });

        test('clicking empty board clears the selection', async ({ page }) => {
            await clickPiece(page, 'small2');
            const origin = await canvasOrigin(page);
            await page.mouse.click(origin.x + 100, origin.y + 300);
            expect(await page.evaluate(() => state.selected)).toBe(null);
        });
    });

    // -------------------------------------------------------------------
    // Keyboard
    // -------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('number keys select a tile', async ({ page }) => {
            await page.keyboard.press('3');
            expect(await page.evaluate(() => state.selected)).toBe(await page.evaluate(() => state.pieces[2].id));
        });

        test('an arrow key lifts a selected tray tile onto the board', async ({ page }) => {
            await page.keyboard.press('1');
            await page.keyboard.press('ArrowRight');
            const piece = await pieceState(page, await page.evaluate(() => state.pieces[0].id));
            expect(piece.inTray).toBe(false);
        });

        test('arrow keys move a laid tile one lattice unit', async ({ page }) => {
            await page.evaluate(() => { placePiece('medium', { x: 4, y: 3 }); state.selected = 'medium'; });
            await page.keyboard.press('ArrowRight');
            expect(await pieceState(page, 'medium')).toMatchObject({ x: 5, y: 3 });
            await page.keyboard.press('ArrowDown');
            expect(await pieceState(page, 'medium')).toMatchObject({ x: 5, y: 4 });
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            expect(await pieceState(page, 'medium')).toMatchObject({ x: 4, y: 3 });
        });

        test('arrow keys cannot push a tile off the board', async ({ page }) => {
            await page.evaluate(() => { placePiece('medium', { x: 0, y: 0 }); state.selected = 'medium'; });
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowUp');
            expect(await pieceState(page, 'medium')).toMatchObject({ x: 0, y: 0 });
        });

        test('R turns the selected tile a quarter turn', async ({ page }) => {
            await page.evaluate(() => { placePiece('large1', { x: 2, y: 2, rot: 0, flip: false }); state.selected = 'large1'; });
            await page.keyboard.press('r');
            expect((await pieceState(page, 'large1')).rot).toBe(1);
            await page.keyboard.press('Shift+R');
            expect((await pieceState(page, 'large1')).rot).toBe(0);
        });

        test('turning a tile changes the triangles it covers', async ({ page }) => {
            const changed = await page.evaluate(() => {
                placePiece('large1', { x: 2, y: 2, rot: 0, flip: false });
                const before = pieceTriangles(pieceById('large1')).sort().join('|');
                rotatePiece('large1', 1);
                const after = pieceTriangles(pieceById('large1')).sort().join('|');
                return before !== after;
            });
            expect(changed).toBe(true);
        });

        test('a turned tile stays on the board', async ({ page }) => {
            const inside = await page.evaluate(() => {
                placePiece('large1', { x: 0, y: 0, rot: 0, flip: false });
                rotatePiece('large1', 1);
                const p = pieceById('large1');
                const size = pieceSize(p);
                return p.x >= 0 && p.y >= 0 && p.x + size.w <= BOARD.cols && p.y + size.h <= BOARD.rows;
            });
            expect(inside).toBe(true);
        });

        test('F flips the selected tile', async ({ page }) => {
            await page.evaluate(() => { placePiece('para', { x: 3, y: 3, rot: 0, flip: false }); state.selected = 'para'; });
            await page.keyboard.press('f');
            expect((await pieceState(page, 'para')).flip).toBe(true);
        });

        test('flipping the parallelogram changes the triangles it covers', async ({ page }) => {
            const changed = await page.evaluate(() => {
                placePiece('para', { x: 3, y: 3, rot: 0, flip: false });
                const before = pieceTriangles(pieceById('para')).sort().join('|');
                flipPiece('para');
                const after = pieceTriangles(pieceById('para')).sort().join('|');
                return before !== after;
            });
            expect(changed).toBe(true);
        });

        test('Backspace sends the selected tile back to the tray', async ({ page }) => {
            await page.evaluate(() => { placePiece('square', { x: 2, y: 2 }); state.selected = 'square'; });
            await page.keyboard.press('Backspace');
            expect((await pieceState(page, 'square')).inTray).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Finishing a figure
    // -------------------------------------------------------------------
    test.describe('finishing a figure', () => {
        test('an unfinished figure is not solved', async ({ page }) => {
            await page.evaluate(() => {
                figureSolution().slice(0, 6).forEach((s) => placePiece(s.id, s));
            });
            expect(await page.evaluate(() => isSolved())).toBe(false);
        });

        test('overlapping tiles are reported and the figure is not finished', async ({ page }) => {
            const result = await page.evaluate(() => {
                const sol = figureSolution();
                sol.forEach((s) => placePiece(s.id, s));
                // Drop the second large triangle on top of the first.
                const first = sol.find((s) => s.id === 'large1');
                placePiece('large2', { ...first, id: 'large2' });
                return { overlaps: overlappingPieces().sort(), solved: isSolved() };
            });
            expect(result.overlaps).toEqual(['large1', 'large2']);
            expect(result.solved).toBe(false);
        });

        test('laying every tile of the solution finishes the figure', async ({ page }) => {
            await solveWithSolution(page);
            expect(await page.evaluate(() => isSolved())).toBe(true);
            await expect(page.locator('#overlay')).toBeVisible();
            await expect(page.locator('#status')).toContainText(/finished|well done|complete/i);
            await expect(page.locator('#solved-count')).toHaveText('1 / 8');
            await expect(page.locator('.figure-btn').first()).toHaveClass(/done/);
        });

        test('the finished overlay names the figure and shows its verse', async ({ page }) => {
            await solveWithSolution(page);
            await expect(page.locator('#overlay-title')).toContainText('The Cornerstone');
            await expect(page.locator('#overlay-verse')).not.toBeEmpty();
        });

        test('the overlay button moves on to the next figure', async ({ page }) => {
            await solveWithSolution(page);
            await page.locator('#btn-continue').click();
            await expect(page.locator('#figure-label')).toHaveText('The Tent of Meeting');
            await expect(page.locator('#overlay')).toBeHidden();
            expect(await page.evaluate(() => state.pieces.every((p) => p.inTray))).toBe(true);
        });

        test('a figure stays finished after moving on and coming back', async ({ page }) => {
            await solveWithSolution(page);
            await page.locator('#btn-continue').click();
            await page.locator('.figure-btn').first().click();
            await expect(page.locator('.figure-btn').first()).toHaveClass(/done/);
            await expect(page.locator('#solved-count')).toHaveText('1 / 8');
        });

        test('a figure can be finished with the mouse alone', async ({ page }) => {
            const solution = await page.evaluate(() => figureSolution());
            for (const s of solution) {
                await clickPiece(page, s.id);
                for (let i = 0; i < s.rot; i++) await page.keyboard.press('r');
                if (s.flip) await page.keyboard.press('f');
                await dragPieceTo(page, s.id, s.x, s.y);
            }
            expect(await page.evaluate(() => isSolved())).toBe(true);
            await expect(page.locator('#overlay')).toBeVisible();
        });
    });

    // -------------------------------------------------------------------
    // Hint, reset and moving between figures
    // -------------------------------------------------------------------
    test.describe('hint, reset and figure choice', () => {
        test('a hint lays one tile from the solution', async ({ page }) => {
            await page.locator('#btn-hint').click();
            const laid = await page.evaluate(() => state.pieces.filter((p) => !p.inTray).length);
            expect(laid).toBe(1);
            await expect(page.locator('#hint-count')).toHaveText('1');
            await expect(page.locator('#status')).toContainText(/hint/i);
        });

        test('a hinted tile sits where the solution wants it', async ({ page }) => {
            const ok = await page.evaluate(() => {
                hint();
                const laid = state.pieces.find((p) => !p.inTray);
                const want = figureSolution().find((s) => s.id === laid.id);
                return laid.x === want.x && laid.y === want.y && laid.rot === want.rot && laid.flip === want.flip;
            });
            expect(ok).toBe(true);
        });

        test('a hint clears any tile that was in its way', async ({ page }) => {
            const result = await page.evaluate(() => {
                const want = figureSolution()[0];
                // Put a different tile right where the first hint will go.
                const other = state.pieces.find((p) => p.id !== want.id);
                placePiece(other.id, { x: want.x, y: want.y, rot: want.rot, flip: want.flip });
                hint();
                return {
                    hinted: pieceById(want.id).inTray === false,
                    overlaps: overlappingPieces().length,
                };
            });
            expect(result.hinted).toBe(true);
            expect(result.overlaps).toBe(0);
        });

        test('seven hints finish the figure and the status says so', async ({ page }) => {
            for (let i = 0; i < 7; i++) await page.locator('#btn-hint').click();
            expect(await page.evaluate(() => isSolved())).toBe(true);
            await expect(page.locator('#status')).toContainText(/hint/i);
            await expect(page.locator('#hint-count')).toHaveText('7');
        });

        test('reset sends every tile back to the tray', async ({ page }) => {
            await solveWithSolution(page);
            await page.locator('#btn-reset').click();
            expect(await page.evaluate(() => state.pieces.every((p) => p.inTray))).toBe(true);
            expect(await page.evaluate(() => state.selected)).toBe(null);
            await expect(page.locator('#overlay')).toBeHidden();
        });

        test('Next figure loads the following figure with an empty board', async ({ page }) => {
            await page.locator('#btn-next').click();
            await expect(page.locator('#figure-label')).toHaveText('The Tent of Meeting');
            expect(await page.evaluate(() => state.pieces.every((p) => p.inTray))).toBe(true);
            await expect(page.locator('.figure-btn').nth(1)).toHaveClass(/active/);
        });

        test('Next figure wraps round from the last figure', async ({ page }) => {
            await page.locator('.figure-btn').nth(7).click();
            await page.locator('#btn-next').click();
            await expect(page.locator('#figure-label')).toHaveText('The Cornerstone');
        });

        test('a figure button loads that figure', async ({ page }) => {
            await page.locator('.figure-btn').nth(4).click();
            await expect(page.locator('#figure-label')).toHaveText('The Fish');
            expect(await page.evaluate(() => state.figure)).toBe(4);
        });

        test('every figure can be finished from its own stored solution', async ({ page }) => {
            for (let i = 0; i < 8; i++) {
                const solved = await page.evaluate((i) => {
                    loadFigure(i);
                    figureSolution().forEach((s) => placePiece(s.id, s));
                    return isSolved();
                }, i);
                expect(solved, FIGURE_NAMES[i]).toBe(true);
            }
            await expect(page.locator('#solved-count')).toHaveText('8 / 8');
        });

        test('the keyboard shortcuts for hint, next and reset work', async ({ page }) => {
            await page.keyboard.press('h');
            await expect(page.locator('#hint-count')).toHaveText('1');
            await page.keyboard.press('n');
            await expect(page.locator('#figure-label')).toHaveText('The Tent of Meeting');
            await page.evaluate(() => placePiece('medium', { x: 2, y: 2 }));
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state.pieces.every((p) => p.inTray))).toBe(true);
        });
    });
});

// The seven tiles, by id, sorted — used when checking stored solutions.
const PIECE_IDS_SORTED = ['large1', 'large2', 'medium', 'para', 'small1', 'small2', 'square'];
