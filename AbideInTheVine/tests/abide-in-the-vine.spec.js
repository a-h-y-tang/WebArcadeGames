const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Abide in the Vine', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Abide in the Vine', async ({ page }) => {
            await expect(page).toHaveTitle('Abide in the Vine');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('grid constants cover the canvas exactly', async ({ page }) => {
            const g = await page.evaluate(() => ({ cell: CELL, cols: COLS, rows: ROWS, w: CANVAS_W, h: CANVAS_H }));
            expect(g.cols * g.cell).toBe(g.w);
            expect(g.rows * g.cell).toBe(g.h);
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('score, fruit and best start at 0 on the HUD', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#fruit')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('abide-in-the-vine-best', '1234'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('the page shows the John 15 verse', async ({ page }) => {
            await expect(page.locator('.verse')).toContainText(/vine/i);
            await expect(page.locator('.verse')).toContainText(/John 15/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('an arrow key starts the game', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh run has a 4-cell vine heading right', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { len: vine.length, head: vine[0], dir: { ...dir }, score, fruit, level };
            });
            expect(s.len).toBe(4);
            expect(s.dir).toEqual({ x: 1, y: 0 });
            expect(s.score).toBe(0);
            expect(s.fruit).toBe(0);
            expect(s.level).toBe(1);
        });

        test('the vine body trails behind the tip in a straight line', async ({ page }) => {
            const cells = await page.evaluate(() => { startGame(); return vine.map((c) => ({ ...c })); });
            for (let i = 1; i < cells.length; i++) {
                expect(cells[i].y).toBe(cells[0].y);
                expect(cells[i].x).toBe(cells[0].x - i);
            }
        });

        test('a fresh run starts with one grape, no fig and no stones', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { grape: grape && { ...grape }, fig, stones: stones.length };
            });
            expect(s.grape).not.toBeNull();
            expect(s.fig).toBeNull();
            expect(s.stones).toBe(0);
        });

        test('the first grape is never on the vine', async ({ page }) => {
            const clash = await page.evaluate(() => {
                for (let i = 0; i < 40; i++) {
                    startGame();
                    if (vine.some((c) => c.x === grape.x && c.y === grape.y)) return true;
                }
                return false;
            });
            expect(clash).toBe(false);
        });

        test('restarting after a game over clears the score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 500;
                gameOver();
                startGame();
                return { state, score, len: vine.length };
            });
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.len).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('one tick moves the tip one cell in its direction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                const before = { ...vine[0] };
                advance();
                return { before, after: { ...vine[0] } };
            });
            expect(s.after.x).toBe(s.before.x + 1);
            expect(s.after.y).toBe(s.before.y);
        });

        test('the vine keeps its length while moving without fruit', async ({ page }) => {
            const len = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                for (let i = 0; i < 5; i++) advance();
                return vine.length;
            });
            expect(len).toBe(4);
        });

        test('the body follows the path the tip took', async ({ page }) => {
            const cells = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                setDirection(0, 1);
                advance();
                advance();
                return vine.map((c) => ({ ...c }));
            });
            // Two downward ticks: tip and the cell behind it share a column.
            expect(cells[0].x).toBe(cells[1].x);
            expect(cells[0].y).toBe(cells[1].y + 1);
        });

        test('setDirection turns the vine', async ({ page }) => {
            const after = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                const before = { ...vine[0] };
                setDirection(0, -1);
                advance();
                return { dy: vine[0].y - before.y, dx: vine[0].x - before.x };
            });
            expect(after).toEqual({ dx: 0, dy: -1 });
        });

        test('the vine cannot reverse straight back into itself', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                setDirection(-1, 0); // heading right: a reversal
                advance();
                return { ...dir };
            });
            expect(d).toEqual({ x: 1, y: 0 });
        });

        test('two turns queued in one tick both apply, in order', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                setDirection(0, 1);   // down
                setDirection(-1, 0);  // then left
                advance();
                const first = { ...dir };
                advance();
                return { first, second: { ...dir } };
            });
            expect(s.first).toEqual({ x: 0, y: 1 });
            expect(s.second).toEqual({ x: -1, y: 0 });
        });

        test('arrow keys steer the vine', async ({ page }) => {
            await page.evaluate(() => { startGame(); grape = { x: 0, y: 0 }; });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => { advance(); return { ...dir }; })).toEqual({ x: 0, y: 1 });
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => { advance(); return { ...dir }; })).toEqual({ x: -1, y: 0 });
        });

        test('WASD keys steer the vine', async ({ page }) => {
            await page.evaluate(() => { startGame(); grape = { x: 0, y: 0 }; });
            await page.keyboard.press('s');
            expect(await page.evaluate(() => { advance(); return { ...dir }; })).toEqual({ x: 0, y: 1 });
            await page.keyboard.press('d');
            expect(await page.evaluate(() => { advance(); return { ...dir }; })).toEqual({ x: 1, y: 0 });
        });

        test('step(dt) advances the vine once per tickMs', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                const start = vine[0].x;
                step((tickMs - 1) / 1000);
                const notYet = vine[0].x;
                step(2 / 1000);
                return { start, notYet, moved: vine[0].x };
            });
            expect(s.notYet).toBe(s.start);
            expect(s.moved).toBe(s.start + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Fruit, growth and scoring
    // -----------------------------------------------------------------------
    test.describe('gathering fruit', () => {
        test('gathering a grape scores 10 and counts the fruit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: vine[0].x + 1, y: vine[0].y };
                advance();
                return { score, fruit };
            });
            expect(s.score).toBe(10);
            expect(s.fruit).toBe(1);
        });

        test('gathering a grape grows the vine by three cells', async ({ page }) => {
            const len = await page.evaluate(() => {
                startGame();
                grape = { x: vine[0].x + 1, y: vine[0].y };
                advance();
                for (let i = 0; i < 3; i++) { grape = { x: 0, y: 0 }; advance(); }
                return vine.length;
            });
            expect(len).toBe(7);
        });

        test('a new grape appears somewhere free after one is gathered', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const old = { x: vine[0].x + 1, y: vine[0].y };
                grape = old;
                advance();
                return {
                    moved: grape.x !== old.x || grape.y !== old.y,
                    onVine: vine.some((c) => c.x === grape.x && c.y === grape.y),
                    inBounds: grape.x >= 0 && grape.x < COLS && grape.y >= 0 && grape.y < ROWS,
                };
            });
            expect(s.moved).toBe(true);
            expect(s.onVine).toBe(false);
            expect(s.inBounds).toBe(true);
        });

        test('the vine speeds up with every grape and stops at the floor', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const base = tickMs;
                fruit = 1; refreshSpeed();
                const one = tickMs;
                fruit = 500; refreshSpeed();
                return { base, one, fast: tickMs, min: TICK_MIN };
            });
            expect(s.one).toBeLessThan(s.base);
            expect(s.fast).toBe(s.min);
        });

        test('the level is one per five grapes gathered', async ({ page }) => {
            const levels = await page.evaluate(() => {
                startGame();
                return [0, 1, 4, 5, 9, 10, 14, 15].map((f) => { fruit = f; refreshLevel(); return level; });
            });
            expect(levels).toEqual([1, 1, 1, 2, 2, 3, 3, 4]);
        });

        test('a level-up adds trellis stones, away from the vine and the fruit', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fruit = 4;
                grape = { x: vine[0].x + 1, y: vine[0].y };
                advance(); // fifth grape -> level 2
                return {
                    level,
                    stones: stones.length,
                    onVine: stones.some((s) => vine.some((c) => c.x === s.x && c.y === s.y)),
                    onGrape: stones.some((s) => s.x === grape.x && s.y === grape.y),
                    inBounds: stones.every((s) => s.x >= 0 && s.x < COLS && s.y >= 0 && s.y < ROWS),
                };
            });
            expect(s.level).toBe(2);
            expect(s.stones).toBe(2);
            expect(s.onVine).toBe(false);
            expect(s.onGrape).toBe(false);
            expect(s.inBounds).toBe(true);
        });

        test('stones never pile up beyond the cap', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 40; i++) addStones();
                return stones.length;
            });
            expect(count).toBeLessThanOrEqual(16);
        });

        test('a fig appears every fourth grape and is worth 50 without growth', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                fruit = 3;
                grape = { x: vine[0].x + 1, y: vine[0].y };
                advance(); // fourth grape
                const appeared = fig !== null;
                const scoreBefore = score;
                growth = 0; // the grape's growth is already accounted for
                const lenBefore = vine.length;
                fig = { x: vine[0].x + 1, y: vine[0].y, ticks: 20 };
                grape = { x: 0, y: 0 };
                advance();
                return { appeared, gained: score - scoreBefore, grew: vine.length - lenBefore, fig };
            });
            expect(s.appeared).toBe(true);
            expect(s.gained).toBe(50);
            expect(s.grew).toBe(0);
            expect(s.fig).toBeNull();
        });

        test('a fig that is left alone expires', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                spawnFig();
                fig.ticks = 3;
                for (let i = 0; i < 4; i++) { grape = { x: 0, y: 0 }; advance(); }
                return fig === null;
            });
            expect(gone).toBe(true);
        });

        test('a fig is never placed on the vine, a stone or the grape', async ({ page }) => {
            const clash = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 50; i++) {
                    fig = null;
                    spawnFig();
                    if (!fig) continue;
                    if (vine.some((c) => c.x === fig.x && c.y === fig.y)) return 'vine';
                    if (stones.some((s) => s.x === fig.x && s.y === fig.y)) return 'stone';
                    if (grape.x === fig.x && grape.y === fig.y) return 'grape';
                }
                return 'clean';
            });
            expect(clash).toBe('clean');
        });
    });

    // -----------------------------------------------------------------------
    // Collisions and game over
    // -----------------------------------------------------------------------
    test.describe('tangling', () => {
        test('running into the right wall ends the run', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                for (let i = 0; i < COLS + 5; i++) advance();
                return { state, head: { ...vine[0] } };
            });
            expect(s.state).toBe('over');
            expect(s.head.x).toBeLessThan(await page.evaluate(() => COLS));
        });

        test('running into the top wall ends the run', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                setDirection(0, -1);
                for (let i = 0; i < ROWS + 5; i++) advance();
                return state;
            });
            expect(st).toBe('over');
        });

        test('running into a stone ends the run', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                stones = [{ x: vine[0].x + 1, y: vine[0].y }];
                advance();
                return state;
            });
            expect(st).toBe('over');
        });

        test('running into its own stem ends the run', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                // grow long enough to bite the stem, then loop back on it
                growth = 8;
                for (let i = 0; i < 8; i++) advance();
                setDirection(0, 1); advance();
                setDirection(-1, 0); advance();
                setDirection(0, -1); advance();
                setDirection(1, 0); advance();
                return state;
            });
            expect(st).toBe('over');
        });

        test('the tip may follow into the cell its tail is leaving', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                growth = 0;
                // a 4-cell vine turning in a tight square chases its own tail cell
                setDirection(0, 1); advance();
                setDirection(-1, 0); advance();
                setDirection(0, -1); advance();
                return state;
            });
            expect(st).toBe('running');
        });

        test('the game stops advancing once it is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                gameOver();
                const head = { ...vine[0] };
                for (let i = 0; i < 5; i++) { advance(); step(1); }
                return { head, after: { ...vine[0] }, state };
            });
            expect(s.after).toEqual(s.head);
            expect(s.state).toBe('over');
        });

        test('game over shows the overlay with the score', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 70; gameOver(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText('70');
        });

        test('a better score is stored as the best score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 320;
                gameOver();
                return { best, stored: window.localStorage.getItem('abide-in-the-vine-best') };
            });
            expect(s.best).toBe(320);
            expect(s.stored).toBe('320');
            await expect(page.locator('#best')).toHaveText('320');
        });

        test('a worse score does not replace the best score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('abide-in-the-vine-best', '900'));
            await page.reload();
            const best = await page.evaluate(() => { startGame(); score = 100; gameOver(); return best; });
            expect(best).toBe(900);
        });

        test('filling the whole garden wins the run', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                // leave no free cell for the next grape
                stones = [];
                for (let x = 0; x < COLS; x++) {
                    for (let y = 0; y < ROWS; y++) {
                        if (!vine.some((c) => c.x === x && c.y === y)) stones.push({ x, y });
                    }
                }
                fig = null;
                spawnGrape();
                return state;
            });
            expect(st).toBe('won');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes the run', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused vine does not move', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                togglePause();
                const head = { ...vine[0] };
                for (let i = 0; i < 10; i++) step(0.1);
                return { head, after: { ...vine[0] } };
            });
            expect(s.after).toEqual(s.head);
        });

        test('P does nothing before a run has started', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the Start button resumes a paused run', async ({ page }) => {
            await page.evaluate(() => { startGame(); togglePause(); });
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // HUD and rendering
    // -----------------------------------------------------------------------
    test.describe('HUD and rendering', () => {
        test('the HUD shows score, fruit and level as they change', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 240; fruit = 7; level = 2;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('240');
            await expect(page.locator('#fruit')).toHaveText('7');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                const first = [data[0], data[1], data[2]].join(',');
                for (let i = 4; i < data.length; i += 4) {
                    if ([data[i], data[i + 1], data[i + 2]].join(',') !== first) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('a long run of ticks never leaves the vine out of bounds or broken', async ({ page }) => {
            const bad = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 400 && state === 'running'; i++) {
                    if (i % 7 === 0) setDirection(0, 1);
                    if (i % 11 === 0) setDirection(1, 0);
                    if (i % 13 === 0) setDirection(0, -1);
                    advance();
                    for (const c of vine) {
                        if (c.x < 0 || c.x >= COLS || c.y < 0 || c.y >= ROWS) return 'out of bounds';
                    }
                    for (let j = 1; j < vine.length; j++) {
                        const d = Math.abs(vine[j].x - vine[j - 1].x) + Math.abs(vine[j].y - vine[j - 1].y);
                        if (d !== 1) return 'broken vine';
                    }
                }
                return 'ok';
            });
            expect(bad).toBe('ok');
        });

        test('no console errors while playing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
            await page.goto(GAME_URL);
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(600);
            await page.keyboard.press('ArrowRight');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });

        test('the real-time loop moves the vine on its own', async ({ page }) => {
            await page.evaluate(() => { startGame(); grape = { x: 0, y: 0 }; setDirection(0, 1); });
            const before = await page.evaluate(() => ({ ...vine[0] }));
            await page.waitForTimeout(500);
            const after = await page.evaluate(() => ({ ...vine[0] }));
            expect(after).not.toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    // Touch
    // -----------------------------------------------------------------------
    test.describe('touch controls', () => {
        test('a downward swipe steers the vine down', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                grape = { x: 0, y: 0 };
                const box = canvas.getBoundingClientRect();
                const cx = box.left + box.width / 2;
                const cy = box.top + box.height / 2;
                const touch = (type, x, y) => canvas.dispatchEvent(new TouchEvent(type, {
                    bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y })],
                    changedTouches: [new Touch({ identifier: 1, target: canvas, clientX: x, clientY: y })],
                }));
                touch('touchstart', cx, cy);
                touch('touchmove', cx, cy + 60);
                touch('touchend', cx, cy + 60);
                advance();
                return { ...dir };
            });
            expect(d).toEqual({ x: 0, y: 1 });
        });
    });
});
