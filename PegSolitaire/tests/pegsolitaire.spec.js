const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Peg Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Peg Solitaire', async ({ page }) => {
            await expect(page).toHaveTitle('Peg Solitaire');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Click');
        });

        test('canvas is 420×420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '420');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('board is 7×7', async ({ page }) => {
            const dims = await page.evaluate(() => ({
                rows: board.length, cols: board[0].length,
            }));
            expect(dims).toEqual({ rows: 7, cols: 7 });
        });

        test('the four corners are not real holes', async ({ page }) => {
            const holes = await page.evaluate(() => ({
                tl: isHole(0, 0), tr: isHole(0, 6),
                bl: isHole(6, 0), br: isHole(6, 6),
                centre: isHole(3, 3), armTop: isHole(0, 3),
            }));
            expect(holes).toEqual({
                tl: false, tr: false, bl: false, br: false,
                centre: true, armTop: true,
            });
        });

        test('there are 33 holes', async ({ page }) => {
            const n = await page.evaluate(() => {
                let count = 0;
                for (let r = 0; r < 7; r++)
                    for (let c = 0; c < 7; c++) if (isHole(r, c)) count++;
                return count;
            });
            expect(n).toBe(33);
        });

        test('the centre starts empty', async ({ page }) => {
            const centre = await page.evaluate(() => board[3][3]);
            expect(centre).toBe(0);
        });

        test('there are 32 pegs at the start', async ({ page }) => {
            const pegs = await page.evaluate(() => pegsLeft());
            expect(pegs).toBe(32);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('pegs-left readout starts at 32', async ({ page }) => {
            await expect(page.locator('#pegs')).toHaveText('32');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is playing after start', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('a key press starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Moves
    // -----------------------------------------------------------------------
    test.describe('moves', () => {
        test('there are exactly 4 opening moves (all into the centre)', async ({ page }) => {
            const moves = await page.evaluate(() => allMoves());
            expect(moves.length).toBe(4);
            const targets = moves.map(m => `${m.to.r},${m.to.c}`);
            expect(new Set(targets)).toEqual(new Set(['3,3']));
        });

        test('the peg at (1,3) can jump to the centre', async ({ page }) => {
            const ok = await page.evaluate(
                () => movesFrom(1, 3).some(t => t.r === 3 && t.c === 3)
            );
            expect(ok).toBe(true);
        });

        test('jumpTarget reports the jumped middle cell', async ({ page }) => {
            const mid = await page.evaluate(() => jumpTarget(1, 3, 3, 3));
            expect(mid).toEqual({ r: 2, c: 3 });
        });

        test('a peg with no empty landing has no moves', async ({ page }) => {
            // At the start only the centre is empty, so an edge peg is boxed in.
            const moves = await page.evaluate(() => movesFrom(0, 3).length);
            expect(moves).toBe(0);
        });

        test('a diagonal jump is illegal', async ({ page }) => {
            const mid = await page.evaluate(() => jumpTarget(1, 1, 3, 3));
            expect(mid).toBeNull();
        });

        test('applying a jump removes the middle peg', async ({ page }) => {
            const res = await page.evaluate(() => {
                applyJump(1, 3, 3, 3);
                return {
                    from: board[1][3], mid: board[2][3], to: board[3][3],
                    pegs: pegsLeft(),
                };
            });
            expect(res.from).toBe(0); // source now empty
            expect(res.mid).toBe(0);  // jumped peg removed
            expect(res.to).toBe(1);   // peg landed
            expect(res.pegs).toBe(31);
        });

        test('applying a jump increments the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { applyJump(1, 3, 3, 3); updateHud(); });
            await expect(page.locator('#score')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Click interaction
    // -----------------------------------------------------------------------
    test.describe('click interaction', () => {
        test('clicking a peg selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => handleClick(1, 3));
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual({ r: 1, c: 3 });
        });

        test('select then click a legal target performs the jump', async ({ page }) => {
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => {
                handleClick(1, 3); // select peg
                handleClick(3, 3); // jump into centre
                return { centre: board[3][3], mid: board[2][3], sel: selected };
            });
            expect(res.centre).toBe(1);
            expect(res.mid).toBe(0);
            expect(res.sel).toBeNull();
        });

        test('clicking the canvas over a peg selects it', async ({ page }) => {
            await page.locator('#btn-start').click();
            // Peg (1,3): x = 3*60 + 30 = 210, y = 1*60 + 30 = 90
            await page.locator('#canvas').click({ position: { x: 210, y: 90 } });
            const sel = await page.evaluate(() => selected);
            expect(sel).toEqual({ r: 1, c: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game ends when no moves remain', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                for (let r = 0; r < 7; r++)
                    for (let c = 0; c < 7; c++)
                        if (isHole(r, c)) board[r][c] = 0;
                board[3][3] = 1; // a single, stranded peg
                checkGameEnd();
                return state;
            });
            expect(s).toBe('over');
        });

        test('a single remaining peg shows "Solved"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                for (let r = 0; r < 7; r++)
                    for (let c = 0; c < 7; c++)
                        if (isHole(r, c)) board[r][c] = 0;
                board[3][3] = 1;
                checkGameEnd();
            });
            await expect(page.locator('#overlay-title')).toContainText('Solved');
        });

        test('several stranded pegs show "Stuck"', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                for (let r = 0; r < 7; r++)
                    for (let c = 0; c < 7; c++)
                        if (isHole(r, c)) board[r][c] = 0;
                // Two pegs too far apart to jump.
                board[0][2] = 1;
                board[6][4] = 1;
                checkGameEnd();
            });
            await expect(page.locator('#overlay-title')).toContainText('Stuck');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets to 32 pegs and score 0', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { applyJump(1, 3, 3, 3); updateHud(); endGame(); });
            await page.locator('#btn-start').click();
            await expect(page.locator('#pegs')).toHaveText('32');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best tracks the most pegs removed and persists', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                // Clear to a single peg -> 31 removed.
                for (let r = 0; r < 7; r++)
                    for (let c = 0; c < 7; c++)
                        if (isHole(r, c)) board[r][c] = 0;
                board[3][3] = 1;
                score = 31;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBe(31);
            const stored = await page.evaluate(
                () => localStorage.getItem('peg-solitaire-best')
            );
            expect(parseInt(stored)).toBe(31);
        });
    });
});
