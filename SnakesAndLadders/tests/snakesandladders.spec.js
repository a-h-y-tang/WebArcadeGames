const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Player 0 = You (human), player 1 = Computer.

test.describe('Snakes and Ladders', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Snakes and Ladders', async ({ page }) => {
            await expect(page).toHaveTitle('Snakes and Ladders');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('both tokens start on square 0 with the human to move', async ({ page }) => {
            const s = await page.evaluate(() => ({
                positions: positions.slice(),
                currentPlayer, phase, winner,
            }));
            expect(s).toEqual({
                positions: [0, 0], currentPlayer: 0, phase: 'idle', winner: null,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Board layout
    // -----------------------------------------------------------------------
    test.describe('board', () => {
        test('has the standard ladders and snakes', async ({ page }) => {
            const maps = await page.evaluate(() => ({
                ladders: LADDERS, snakes: SNAKES,
            }));
            expect(maps.ladders['1']).toBe(38);
            expect(maps.ladders['28']).toBe(84);
            expect(maps.ladders['80']).toBe(100);
            expect(maps.snakes['16']).toBe(6);
            expect(maps.snakes['98']).toBe(78);
            expect(Object.keys(maps.ladders).length).toBe(9);
            expect(Object.keys(maps.snakes).length).toBe(10);
        });

        test('ladders always go up and snakes always go down', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (const [k, v] of Object.entries(LADDERS)) if (v <= +k) return false;
                for (const [k, v] of Object.entries(SNAKES)) if (v >= +k) return false;
                return true;
            });
            expect(ok).toBe(true);
        });

        test('applyJump climbs ladders, slides snakes, leaves plain squares', async ({ page }) => {
            const r = await page.evaluate(() => ({
                ladderFoot: applyJump(1),   // ladder 1 -> 38
                snakeHead: applyJump(16),   // snake 16 -> 6
                plain: applyJump(5),        // nothing
                topLadder: applyJump(80),   // 80 -> 100
            }));
            expect(r).toEqual({ ladderFoot: 38, snakeHead: 6, plain: 5, topLadder: 100 });
        });
    });

    // -----------------------------------------------------------------------
    // Move computation (pure logic)
    // -----------------------------------------------------------------------
    test.describe('computeMove', () => {
        test('a plain move with no jump just advances', async ({ page }) => {
            // 5 + 1 = 6, square 6 is plain.
            expect(await page.evaluate(() => computeMove(5, 1))).toBe(6);
        });

        test('landing on a ladder foot climbs it', async ({ page }) => {
            // 0 + 1 = 1, ladder 1 -> 38.
            expect(await page.evaluate(() => computeMove(0, 1))).toBe(38);
        });

        test('landing on a snake head slides down', async ({ page }) => {
            // 10 + 6 = 16, snake 16 -> 6.
            expect(await page.evaluate(() => computeMove(10, 6))).toBe(6);
        });

        test('an exact roll to 100 wins the square', async ({ page }) => {
            expect(await page.evaluate(() => computeMove(97, 3))).toBe(100);
        });

        test('overshooting 100 does not move at all', async ({ page }) => {
            expect(await page.evaluate(() => computeMove(98, 5))).toBe(98);
        });

        test('square 100 has no jump', async ({ page }) => {
            expect(await page.evaluate(() => computeMove(99, 1))).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Dice
    // -----------------------------------------------------------------------
    test.describe('rollDie', () => {
        test('random rolls stay within 1..6', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 300; i++) {
                    const r = rollDie();
                    if (r < 1 || r > 6 || r !== Math.floor(r)) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('forcedRolls are consumed in order', async ({ page }) => {
            const rolls = await page.evaluate(() => {
                forcedRolls = [3, 6, 1];
                return [rollDie(), rollDie(), rollDie()];
            });
            expect(rolls).toEqual([3, 6, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Turn flow (deterministic via forcedRolls)
    // -----------------------------------------------------------------------
    test.describe('takeTurn', () => {
        test('a turn moves the current player and passes the turn', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                forcedRolls = [2]; // 0 + 2 = 2 (plain)
                takeTurn();
                return { positions: positions.slice(), currentPlayer };
            });
            expect(s).toEqual({ positions: [2, 0], currentPlayer: 1 });
        });

        test('consecutive turns alternate between the two players', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                forcedRolls = [2, 3]; // you -> 2, cpu -> 3
                takeTurn();
                takeTurn();
                return { positions: positions.slice(), currentPlayer };
            });
            expect(s).toEqual({ positions: [2, 3], currentPlayer: 0 });
        });

        test('a turn that overshoots 100 keeps the position', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                positions[0] = 98;
                forcedRolls = [4]; // 98 + 4 = 102 -> stay
                takeTurn();
                return { pos: positions[0], currentPlayer };
            });
            expect(s).toEqual({ pos: 98, currentPlayer: 1 });
        });

        test('landing exactly on 100 wins and ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                positions[0] = 97;
                forcedRolls = [3]; // -> 100
                takeTurn();
                return { pos: positions[0], winner, phase };
            });
            expect(s).toEqual({ pos: 100, winner: 0, phase: 'over' });
        });

        test('no moves are accepted once the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                positions[1] = 97;
                currentPlayer = 1;
                forcedRolls = [3]; // cpu wins
                takeTurn();
                const afterWinner = winner;
                // Try to take another turn — should be ignored.
                forcedRolls = [4];
                takeTurn();
                return { winner: afterWinner, posYou: positions[0], phase };
            });
            expect(s).toEqual({ winner: 1, posYou: 0, phase: 'over' });
        });
    });

    // -----------------------------------------------------------------------
    // UI interaction
    // -----------------------------------------------------------------------
    test.describe('UI', () => {
        test('clicking Roll moves the human token and records the roll', async ({ page }) => {
            await page.evaluate(() => { startGame(); forcedRolls = [2, 2, 2, 2]; });
            await page.click('#btn-roll');
            const s = await page.evaluate(() => ({ pos: positions[0], lastRoll }));
            expect(s.pos).toBe(2);
            expect(s.lastRoll).toBe(2);
        });

        test('the winner is announced on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                positions[0] = 94;
                forcedRolls = [6]; // 94 + 6 = 100 -> you win
                takeTurn();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('the win count persists across a reload', async ({ page }) => {
            await page.evaluate(() => {
                localStorage.setItem('snakes-and-ladders-wins', '4');
            });
            await page.reload();
            const best = await page.evaluate(() => document.getElementById('best').textContent);
            expect(best).toBe('4');
        });
    });
});
