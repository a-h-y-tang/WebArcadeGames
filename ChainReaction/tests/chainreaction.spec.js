const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Chain Reaction', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Chain Reaction', async ({ page }) => {
            await expect(page).toHaveTitle('Chain Reaction');
        });

        test('canvas is sized to the grid', async ({ page }) => {
            const canvas = page.locator('#canvas');
            const [rows, cols, cell] = await page.evaluate(() => [ROWS, COLS, CELL]);
            await expect(canvas).toHaveAttribute('width', String(cols * cell));
            await expect(canvas).toHaveAttribute('height', String(rows * cell));
        });

        test('starts in playing state, Red to move, no winner', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, current, winner, moveCount }));
            expect(s.state).toBe('playing');
            expect(s.current).toBe(0);
            expect(s.winner).toBe(null);
            expect(s.moveCount).toBe(0);
        });

        test('the board starts empty', async ({ page }) => {
            const empty = await page.evaluate(
                () => grid.flat().every(c => c.count === 0 && c.owner === null));
            expect(empty).toBe(true);
        });

        test('critical mass is 2 in corners, 3 on edges, 4 in the interior', async ({ page }) => {
            const [corner, edge, interior] = await page.evaluate(() => [
                criticalMass(0, 0),
                criticalMass(0, 1),
                criticalMass(1, 1),
            ]);
            expect(corner).toBe(2);
            expect(edge).toBe(3);
            expect(interior).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Placing orbs
    // -----------------------------------------------------------------------
    test.describe('placing orbs', () => {
        test('placing on an empty cell sets count and owner and passes the turn', async ({ page }) => {
            const r = await page.evaluate(() => applyMove(2, 2));
            const s = await page.evaluate(() => ({
                cell: grid[2][2], current, moveCount,
            }));
            expect(r).toBe(true);
            expect(s.cell.count).toBe(1);
            expect(s.cell.owner).toBe(0);
            expect(s.current).toBe(1);
            expect(s.moveCount).toBe(1);
        });

        test('a player cannot place on a cell owned by the opponent', async ({ page }) => {
            await page.evaluate(() => applyMove(2, 2)); // Red owns (2,2), now Blue's turn
            const can = await page.evaluate(() => canPlace(2, 2, 1));
            expect(can).toBe(false);
            const r = await page.evaluate(() => applyMove(2, 2)); // Blue tries Red's cell
            expect(r).toBe(false);
            const s = await page.evaluate(() => ({ owner: grid[2][2].owner, current }));
            expect(s.owner).toBe(0);   // unchanged
            expect(s.current).toBe(1); // still Blue's turn
        });

        test('a player can add an orb to their own cell', async ({ page }) => {
            await page.evaluate(() => applyMove(2, 2)); // Red
            await page.evaluate(() => applyMove(4, 4)); // Blue
            const r = await page.evaluate(() => applyMove(2, 2)); // Red again on own interior cell
            expect(r).toBe(true);
            expect(await page.evaluate(() => grid[2][2].count)).toBe(2);
        });

        test('out-of-range moves are rejected', async ({ page }) => {
            const bad = await page.evaluate(() => applyMove(-1, 0) || applyMove(0, COLS) || applyMove(ROWS, 0));
            expect(bad).toBe(false);
            expect(await page.evaluate(() => moveCount)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Explosions & chain reactions
    // -----------------------------------------------------------------------
    test.describe('explosions', () => {
        test('a corner explodes at 2 orbs, distributing to both neighbours', async ({ page }) => {
            await page.evaluate(() => applyMove(0, 0)); // Red corner, count 1
            await page.evaluate(() => applyMove(5, 5)); // Blue elsewhere
            await page.evaluate(() => applyMove(0, 0)); // Red corner -> count 2 -> explode
            const s = await page.evaluate(() => ({
                corner: grid[0][0],
                right: grid[0][1],
                down: grid[1][0],
            }));
            expect(s.corner.count).toBe(0);
            expect(s.right.count).toBe(1);
            expect(s.right.owner).toBe(0);
            expect(s.down.count).toBe(1);
            expect(s.down.owner).toBe(0);
        });

        test('an explosion captures an opponent orb it lands on', async ({ page }) => {
            await page.evaluate(() => applyMove(0, 0)); // Red corner
            await page.evaluate(() => applyMove(0, 1)); // Blue neighbour, count 1 owner 1
            await page.evaluate(() => applyMove(0, 0)); // Red corner -> explode into (0,1)
            const captured = await page.evaluate(() => grid[0][1]);
            expect(captured.owner).toBe(0);      // flipped to Red
            expect(captured.count).toBe(2);      // its orb + the pushed orb
        });

        test('total orb count is conserved across an explosion', async ({ page }) => {
            const total = () => page.evaluate(
                () => grid.flat().reduce((s, c) => s + c.count, 0));
            await page.evaluate(() => applyMove(0, 0)); // 1
            await page.evaluate(() => applyMove(5, 5)); // 1
            await page.evaluate(() => applyMove(0, 0)); // corner explodes; 3 orbs total remain
            expect(await total()).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('no win on the very first move even though the opponent has no orbs', async ({ page }) => {
            await page.evaluate(() => applyMove(2, 2)); // Red's first move
            const s = await page.evaluate(() => ({ state, winner }));
            expect(s.state).toBe('playing');
            expect(s.winner).toBe(null);
        });

        test('capturing the opponent\'s last orb wins the game', async ({ page }) => {
            await page.evaluate(() => {
                newGame();
                // Hand-build a near-final position: Blue has a single lone orb
                // adjacent to a Red corner that is about to explode into it.
                grid[0][0] = { count: 1, owner: 0 };
                grid[0][1] = { count: 1, owner: 1 }; // Blue's only orb
                current = 0;
                moveCount = 6; // past the opening guard
            });
            const r = await page.evaluate(() => applyMove(0, 0)); // corner -> 2 -> explode, captures (0,1)
            expect(r).toBe(true);
            const s = await page.evaluate(() => ({
                state, winner,
                red: cellsOwnedBy(0), blue: cellsOwnedBy(1),
            }));
            expect(s.blue).toBe(0);
            expect(s.red).toBeGreaterThan(0);
            expect(s.winner).toBe(0);
            expect(s.state).toBe('over');
        });

        test('no moves are accepted after the game is over', async ({ page }) => {
            await page.evaluate(() => { newGame(); state = 'over'; winner = 0; });
            const r = await page.evaluate(() => applyMove(3, 3));
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------
    test.describe('reset', () => {
        test('New Game button resets the board', async ({ page }) => {
            await page.evaluate(() => applyMove(1, 1));
            await page.locator('#btn-new').click();
            const s = await page.evaluate(() => ({
                state, current, moveCount, winner,
                empty: grid.flat().every(c => c.count === 0 && c.owner === null),
            }));
            expect(s.state).toBe('playing');
            expect(s.current).toBe(0);
            expect(s.moveCount).toBe(0);
            expect(s.winner).toBe(null);
            expect(s.empty).toBe(true);
        });

        test('pressing R resets the board', async ({ page }) => {
            await page.evaluate(() => applyMove(1, 1));
            await page.keyboard.press('r');
            expect(await page.evaluate(() => moveCount)).toBe(0);
            expect(await page.evaluate(() => grid[1][1].count)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Mouse interaction end-to-end
    // -----------------------------------------------------------------------
    test.describe('mouse play', () => {
        test('clicking the canvas places an orb in the clicked cell', async ({ page }) => {
            const cell = await page.evaluate(() => CELL);
            // Click roughly the middle of cell (row 1, col 2).
            await page.locator('#canvas').click({
                position: { x: 2 * cell + cell / 2, y: 1 * cell + cell / 2 },
            });
            const c = await page.evaluate(() => grid[1][2]);
            expect(c.count).toBe(1);
            expect(c.owner).toBe(0);
            expect(await page.evaluate(() => current)).toBe(1);
        });
    });
});
