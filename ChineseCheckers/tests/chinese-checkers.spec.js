const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

const ROW_COUNTS = [1, 2, 3, 4, 13, 12, 11, 10, 9, 10, 11, 12, 13, 4, 3, 2, 1];

// --------------------------------------------------------------------------
// Helpers. The canvas draws 1:1 at the default viewport, so a hole's centre in
// board coordinates doubles as a click position.
// --------------------------------------------------------------------------
const id = (page, r, u) => page.evaluate(([r, u]) => holeAt(r, u), [r, u]);

async function clickHole(page, r, u) {
    const pos = await page.evaluate(([r, u]) => holeCentre(holeAt(r, u)), [r, u]);
    await page.locator('#canvas').click({ position: pos });
}

async function clickHoleId(page, holeId) {
    const pos = await page.evaluate((i) => holeCentre(i), holeId);
    await page.locator('#canvas').click({ position: pos });
}

// Who sits where, as "r,u:side" strings, so a whole position compares as text.
const snapshot = (page) =>
    page.evaluate(() =>
        HOLES.filter((h) => board[h.id]).map((h) => `${h.r},${h.u}:${board[h.id]}`).join(' ')
    );

const destinations = (page, r, u) =>
    page.evaluate(
        ([r, u]) =>
            legalDestinations(holeAt(r, u))
                .map((i) => `${HOLES[i].r},${HOLES[i].u}`)
                .sort(),
        [r, u]
    );

// Place an exact position for a test: coordinates are [r, u] pairs.
async function setup(page, player, cpu, turn = 'player') {
    await page.evaluate(
        ([player, cpu, turn]) =>
            setupPosition({
                player: player.map(([r, u]) => holeAt(r, u)),
                cpu: cpu.map(([r, u]) => holeAt(r, u)),
                turn,
            }),
        [player, cpu, turn]
    );
}

const waitForPlayerTurn = (page) =>
    expect.poll(() => page.evaluate(() => (winner ? 'over' : turn)), { timeout: 5000 }).not.toBe('cpu');

test.describe('Chinese Checkers', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
        await page.waitForFunction(() => typeof HOLES !== 'undefined' && HOLES.length > 0);
    });

    test.afterEach(() => {
        expect(errors).toEqual([]);
    });

    // ------------------------------------------------------------------
    // The board
    // ------------------------------------------------------------------
    test.describe('the board', () => {
        test('page title and heading name the game', async ({ page }) => {
            await expect(page).toHaveTitle('Chinese Checkers');
            await expect(page.locator('h1')).toHaveText('Chinese Checkers');
        });

        test('the canvas is present and sized', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            expect(box.width).toBeGreaterThan(300);
            expect(box.height).toBeGreaterThan(300);
        });

        test('the star has 121 holes', async ({ page }) => {
            expect(await page.evaluate(() => HOLES.length)).toBe(121);
        });

        test('the rows hold 1, 2, 3, 4, 13 ... 13, 4, 3, 2, 1 holes', async ({ page }) => {
            const counts = await page.evaluate(() =>
                Array.from({ length: 17 }, (_, r) => HOLES.filter((h) => h.r === r).length)
            );
            expect(counts).toEqual(ROW_COUNTS);
        });

        test('each hole has a unique id matching its index', async ({ page }) => {
            expect(await page.evaluate(() => HOLES.every((h, i) => h.id === i))).toBe(true);
        });

        test('the six points hold ten holes each and the hexagon sixty-one', async ({ page }) => {
            const zones = await page.evaluate(() => {
                const count = {};
                for (const h of HOLES) count[h.zone] = (count[h.zone] || 0) + 1;
                return count;
            });
            expect(zones).toEqual({ north: 10, ne: 10, se: 10, south: 10, sw: 10, nw: 10, hex: 61 });
        });

        test('holeAt returns -1 off the board', async ({ page }) => {
            const offBoard = await page.evaluate(() => [holeAt(-1, 0), holeAt(17, 0), holeAt(8, 10), holeAt(0, 2)]);
            expect(offBoard).toEqual([-1, -1, -1, -1]);
        });

        test('every hole lies inside the canvas', async ({ page }) => {
            const outside = await page.evaluate(() =>
                HOLES.filter((h) => h.x < 10 || h.y < 10 || h.x > canvas.width - 10 || h.y > canvas.height - 10).length
            );
            expect(outside).toBe(0);
        });

        test('the star is symmetric top to bottom', async ({ page }) => {
            const asymmetric = await page.evaluate(() => HOLES.filter((h) => holeAt(16 - h.r, h.u) === -1).length);
            expect(asymmetric).toBe(0);
        });
    });

    // ------------------------------------------------------------------
    // Lattice geometry: steps and jumps
    // ------------------------------------------------------------------
    test.describe('lattice', () => {
        test('the middle hole has six neighbours, a point tip has two', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                middle: NEIGHBOURS[holeAt(8, 0)].filter((n) => n >= 0).length,
                northTip: NEIGHBOURS[holeAt(0, 0)].filter((n) => n >= 0).length,
                southTip: NEIGHBOURS[holeAt(16, 0)].filter((n) => n >= 0).length,
            }));
            expect(counts).toEqual({ middle: 6, northTip: 2, southTip: 2 });
        });

        test('neighbours are all the same distance apart', async ({ page }) => {
            const spread = await page.evaluate(() => {
                const ds = [];
                for (const h of HOLES) {
                    for (const n of NEIGHBOURS[h.id]) {
                        if (n >= 0) ds.push(Math.hypot(HOLES[n].x - h.x, HOLES[n].y - h.y));
                    }
                }
                return Math.max(...ds) - Math.min(...ds);
            });
            expect(spread).toBeLessThan(0.001);
        });

        test('being a neighbour is mutual', async ({ page }) => {
            const broken = await page.evaluate(() =>
                HOLES.filter((h) =>
                    NEIGHBOURS[h.id].some((n, d) => n >= 0 && NEIGHBOURS[n][d ^ 1] !== h.id)
                ).length
            );
            expect(broken).toBe(0);
        });

        test('a jump lands two holes away in the same direction', async ({ page }) => {
            const ok = await page.evaluate(() =>
                HOLES.every((h) =>
                    JUMPS[h.id].every((j, d) => {
                        if (j < 0) return true;
                        const mid = NEIGHBOURS[h.id][d];
                        if (mid < 0) return false;
                        return NEIGHBOURS[mid][d] === j;
                    })
                )
            );
            expect(ok).toBe(true);
        });
    });

    // ------------------------------------------------------------------
    // Opening position
    // ------------------------------------------------------------------
    test.describe('opening position', () => {
        test('ten green pegs fill the south point and ten amber the north', async ({ page }) => {
            const state = await page.evaluate(() => ({
                player: HOLES.filter((h) => board[h.id] === 'player').map((h) => h.zone),
                cpu: HOLES.filter((h) => board[h.id] === 'cpu').map((h) => h.zone),
                empty: HOLES.filter((h) => !board[h.id]).length,
            }));
            expect(state.player).toEqual(Array(10).fill('south'));
            expect(state.cpu).toEqual(Array(10).fill('north'));
            expect(state.empty).toBe(101);
        });

        test('the player moves first and nothing is won yet', async ({ page }) => {
            expect(await page.evaluate(() => [turn, winner, moves])).toEqual(['player', null, 0]);
        });

        test('the HUD shows an empty home for both sides', async ({ page }) => {
            await expect(page.locator('#home-player')).toHaveText('0 / 10');
            await expect(page.locator('#home-cpu')).toHaveText('0 / 10');
        });

        test('the home counters follow the pegs that have arrived', async ({ page }) => {
            await setup(page, [[0, 0], [1, -1], [1, 1], [8, 0]], [[16, 0], [15, 1]]);
            await expect(page.locator('#home-player')).toHaveText('3 / 10');
            await expect(page.locator('#home-cpu')).toHaveText('2 / 10');
        });

        test('the status line asks the player to move', async ({ page }) => {
            await expect(page.locator('#status')).toContainText(/your move/i);
        });

        test('each front peg has exactly two steps forward', async ({ page }) => {
            for (const u of [-3, -1, 1, 3]) {
                expect(await destinations(page, 13, u)).toEqual([`12,${u - 1}`, `12,${u + 1}`].sort());
            }
        });

        test('a peg in the second row can already jump out of the point', async ({ page }) => {
            expect(await destinations(page, 14, 0)).toEqual(['12,-2', '12,2']);
        });

        test('a peg buried in the point has nowhere to go', async ({ page }) => {
            expect(await destinations(page, 16, 0)).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // Selecting and moving
    // ------------------------------------------------------------------
    test.describe('selecting', () => {
        test('clicking your own peg selects it', async ({ page }) => {
            await clickHole(page, 13, 1);
            expect(await page.evaluate(() => selected)).toBe(await id(page, 13, 1));
        });

        test('clicking it again deselects it', async ({ page }) => {
            await clickHole(page, 13, 1);
            await clickHole(page, 13, 1);
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('the computer’s pegs cannot be selected', async ({ page }) => {
            await clickHole(page, 3, 1);
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking an empty hole selects nothing', async ({ page }) => {
            await clickHole(page, 8, 0);
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('a peg can still be picked up when the canvas is scaled down', async ({ page }) => {
            await page.setViewportSize({ width: 380, height: 760 });
            const target = await id(page, 13, 1);
            const pos = await page.evaluate((i) => {
                const rect = canvas.getBoundingClientRect();
                const centre = holeCentre(i);
                return {
                    x: (centre.x * rect.width) / canvas.width,
                    y: (centre.y * rect.height) / canvas.height,
                };
            }, target);
            await page.locator('#canvas').click({ position: pos });
            expect(await page.evaluate(() => selected)).toBe(target);
        });

        test('Escape clears the selection', async ({ page }) => {
            await clickHole(page, 13, 1);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => selected)).toBe(null);
        });
    });

    test.describe('moving', () => {
        test('a step moves the peg and hands the turn over', async ({ page }) => {
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            const state = await page.evaluate(([from, to]) => ({
                from: board[from],
                to: board[to],
                moves,
            }), [await id(page, 13, 1), await id(page, 12, 0)]);
            expect(state.from).toBe(null);
            expect(state.to).toBe('player');
            expect(state.moves).toBe(1);
        });

        test('a click on a hole that is not a destination moves nothing', async ({ page }) => {
            const before = await snapshot(page);
            await clickHole(page, 13, 1);
            await clickHole(page, 8, 0);
            expect(await snapshot(page)).toBe(before);
            expect(await page.evaluate(() => moves)).toBe(0);
        });

        test('a peg cannot move while it is the computer’s turn', async ({ page }) => {
            await setup(page, [[8, 0]], [[0, 0]], 'cpu');
            await clickHole(page, 8, 0);
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('the move counter and the status line follow the game', async ({ page }) => {
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await expect(page.locator('#moves')).toHaveText('1');
            await waitForPlayerTurn(page);
            await expect(page.locator('#status')).toContainText(/your move/i);
        });
    });

    // ------------------------------------------------------------------
    // Jumps and chains
    // ------------------------------------------------------------------
    test.describe('jumping', () => {
        test('a peg jumps over a neighbour into the empty hole beyond', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2]]);
            expect(await destinations(page, 8, 0)).toContain('8,4');
        });

        test('a peg may jump over its own side as well', async ({ page }) => {
            await setup(page, [[8, 0], [8, 2]], [[0, 0]]);
            expect(await destinations(page, 8, 0)).toContain('8,4');
        });

        test('no jump when the landing hole is taken', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2], [8, 4]]);
            expect(await destinations(page, 8, 0)).not.toContain('8,4');
        });

        test('no jump over an empty hole', async ({ page }) => {
            await setup(page, [[8, 0]], [[0, 0]]);
            expect(await destinations(page, 8, 0)).not.toContain('8,4');
        });

        test('a jump can be followed by another jump in the same turn', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2], [8, 6]]);
            await clickHole(page, 8, 0);
            await clickHole(page, 8, 4);
            const mid = await page.evaluate(() => ({ selected, turn, chain: chain.length }));
            expect(mid.turn).toBe('player');
            expect(mid.selected).toBe(await id(page, 8, 4));
            expect(mid.chain).toBeGreaterThan(1);
            expect(await destinations(page, 8, 4)).toEqual(['8,8']);
            await clickHole(page, 8, 8);
            expect(await snapshot(page)).toContain('8,8:player');
        });

        test('a chain may not come back to a hole it has left', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2], [8, 6]]);
            await clickHole(page, 8, 0);
            await clickHole(page, 8, 4);
            expect(await destinations(page, 8, 4)).not.toContain('8,0');
        });

        test('a chain counts as one move and can be ended early', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2], [8, 6]]);
            await clickHole(page, 8, 0);
            await clickHole(page, 8, 4);
            await page.keyboard.press('Escape');
            const state = await page.evaluate(() => ({ turn, moves, selected }));
            expect(state).toEqual({ turn: 'cpu', moves: 1, selected: null });
        });

        test('a step is not allowed once the peg has jumped', async ({ page }) => {
            await setup(page, [[8, 0]], [[8, 2], [8, 6]]);
            await clickHole(page, 8, 0);
            await clickHole(page, 8, 4);
            const dests = await destinations(page, 8, 4);
            expect(dests).not.toContain('7,3');
            expect(dests).not.toContain('9,3');
        });
    });

    // ------------------------------------------------------------------
    // Winning
    // ------------------------------------------------------------------
    test.describe('winning', () => {
        const northButOne = [[0, 0], [1, -1], [1, 1], [2, -2], [2, 0], [2, 2], [3, -3], [3, -1], [3, 1]];

        test('filling the north point with all ten pegs wins', async ({ page }) => {
            await setup(page, [...northButOne, [4, 4]], [[12, 0]]);
            await clickHole(page, 4, 4);
            await clickHole(page, 3, 3);
            expect(await page.evaluate(() => winner)).toBe('player');
            await expect(page.locator('#overlay')).toBeVisible();
            await expect(page.locator('#overlay-title')).toContainText(/you win/i);
            await expect(page.locator('#home-player')).toHaveText('10 / 10');
        });

        test('a full north point still wins when the computer squats in it', async ({ page }) => {
            await setup(page, [...northButOne.slice(1), [4, 4], [12, 0]], [[0, 0]]);
            await clickHole(page, 4, 4);
            await clickHole(page, 3, 3);
            expect(await page.evaluate(() => winner)).toBe('player');
            await expect(page.locator('#overlay-title')).toContainText(/you win/i);
        });

        test('the computer wins by filling the south point', async ({ page }) => {
            const southButOne = [[16, 0], [15, -1], [15, 1], [14, -2], [14, 0], [14, 2], [13, -3], [13, -1], [13, 1]];
            await setup(page, [[4, 0]], [...southButOne, [12, 4]], 'cpu');
            await expect.poll(() => page.evaluate(() => winner), { timeout: 5000 }).toBe('cpu');
            await expect(page.locator('#overlay-title')).toContainText(/computer wins/i);
            await expect(page.locator('#home-cpu')).toHaveText('10 / 10');
        });

        test('no more moves are accepted after the game is over', async ({ page }) => {
            await setup(page, [...northButOne, [4, 4]], [[12, 0]]);
            await clickHole(page, 4, 4);
            await clickHole(page, 3, 3);
            const after = await snapshot(page);
            // The overlay covers the board, so go at the input handler directly.
            await page.evaluate(() => {
                activate(holeAt(3, 3));
                activate(holeAt(4, 4));
            });
            expect(await snapshot(page)).toBe(after);
            expect(await page.evaluate(() => [selected, legalDestinations(holeAt(3, 3))])).toEqual([null, []]);
        });
    });

    // ------------------------------------------------------------------
    // The computer player
    // ------------------------------------------------------------------
    test.describe('the computer', () => {
        test('replies with a move of its own', async ({ page }) => {
            const before = await snapshot(page);
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            const after = await snapshot(page);
            expect(after).not.toBe(before);
            const cpuMoved = await page.evaluate(() => HOLES.filter((h) => board[h.id] === 'cpu' && h.zone !== 'north').length);
            expect(cpuMoved).toBeGreaterThan(0);
        });

        test('still has ten pegs after it moves — nothing is ever captured', async ({ page }) => {
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            const counts = await page.evaluate(() => ({
                player: HOLES.filter((h) => board[h.id] === 'player').length,
                cpu: HOLES.filter((h) => board[h.id] === 'cpu').length,
            }));
            expect(counts).toEqual({ player: 10, cpu: 10 });
        });

        test('moves its pegs down the board over several turns', async ({ page }) => {
            const depth = () => page.evaluate(() => HOLES.filter((h) => board[h.id] === 'cpu').reduce((s, h) => s + h.r, 0));
            const before = await depth();
            for (const [from, to] of [[[13, 1], [12, 0]], [[13, -1], [12, -2]], [[13, 3], [12, 2]]]) {
                await clickHoleId(page, await id(page, ...from));
                await clickHoleId(page, await id(page, ...to));
                await waitForPlayerTurn(page);
            }
            expect(await depth()).toBeGreaterThan(before);
        });

        test('takes a long jump chain when one is on offer', async ({ page }) => {
            // A ladder of pegs lets the amber peg ride from row 4 down to row 12
            // in one turn, which is far deeper than any single step.
            await setup(page, [[5, -3], [7, -1], [9, 1], [11, 3]], [[4, -4]], 'cpu');
            await expect.poll(() => page.evaluate(() => turn), { timeout: 5000 }).toBe('player');
            expect(await snapshot(page)).toContain('12,4:cpu');
        });

        test('plays the same game twice from the same seed', async ({ page, browser }) => {
            const play = async (p) => {
                await p.goto(GAME_URL);
                await p.waitForFunction(() => typeof HOLES !== 'undefined');
                await p.evaluate(() => {
                    rngSeed = 12345;
                    newGame();
                });
                await clickHole(p, 13, 1);
                await clickHole(p, 12, 0);
                await expect.poll(() => p.evaluate(() => turn), { timeout: 5000 }).toBe('player');
                return snapshot(p);
            };
            const first = await play(page);
            const other = await browser.newPage();
            const second = await play(other);
            await other.close();
            expect(second).toBe(first);
        });
    });

    // ------------------------------------------------------------------
    // Controls
    // ------------------------------------------------------------------
    test.describe('controls', () => {
        test('New Game puts every peg back', async ({ page }) => {
            const opening = await snapshot(page);
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            await page.locator('#btn-new').click();
            expect(await snapshot(page)).toBe(opening);
            expect(await page.evaluate(() => [turn, moves, winner])).toEqual(['player', 0, null]);
        });

        test('Undo takes back the player’s move and the computer’s reply', async ({ page }) => {
            const opening = await snapshot(page);
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            await page.locator('#btn-undo').click();
            expect(await snapshot(page)).toBe(opening);
            expect(await page.evaluate(() => [turn, moves])).toEqual(['player', 0]);
        });

        test('Undo does nothing on the opening position', async ({ page }) => {
            const opening = await snapshot(page);
            await page.locator('#btn-undo').click();
            expect(await snapshot(page)).toBe(opening);
        });

        test('the difficulty button switches between Gentle and Keen', async ({ page }) => {
            const label = page.locator('#btn-difficulty');
            await expect(label).toContainText(/gentle/i);
            await label.click();
            await expect(label).toContainText(/keen/i);
            expect(await page.evaluate(() => difficulty)).toBe('keen');
            await label.click();
            await expect(label).toContainText(/gentle/i);
        });

        test('N starts a new game and U undoes', async ({ page }) => {
            const opening = await snapshot(page);
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            await page.keyboard.press('u');
            expect(await snapshot(page)).toBe(opening);
            await clickHole(page, 13, 1);
            await clickHole(page, 12, 0);
            await waitForPlayerTurn(page);
            await page.keyboard.press('n');
            expect(await snapshot(page)).toBe(opening);
        });

        test('the rules are written on the page', async ({ page }) => {
            await expect(page.locator('#rules')).toContainText(/jump/i);
            await expect(page.locator('#rules')).toContainText(/ten/i);
        });
    });

    // ------------------------------------------------------------------
    // Keyboard play
    // ------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('the cursor starts on the player’s side of the board', async ({ page }) => {
            expect(await page.evaluate(() => HOLES[cursor].zone)).toBe('south');
        });

        test('an arrow key moves the cursor to a neighbouring hole', async ({ page }) => {
            await page.evaluate(() => setCursor(holeAt(16, 0)));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => HOLES[cursor].r)).toBe(15);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => HOLES[cursor].r)).toBe(16);
        });

        test('left and right walk along a row', async ({ page }) => {
            await page.evaluate(() => setCursor(holeAt(8, 0)));
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => [HOLES[cursor].r, HOLES[cursor].u])).toEqual([8, 2]);
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => [HOLES[cursor].r, HOLES[cursor].u])).toEqual([8, 0]);
        });

        test('the cursor stays on the board at the edges', async ({ page }) => {
            await page.evaluate(() => setCursor(holeAt(0, 0)));
            for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => [HOLES[cursor].r, HOLES[cursor].u])).toEqual([0, 0]);
        });

        test('Space selects a peg and moves it', async ({ page }) => {
            await setup(page, [[8, 0]], [[0, 0]]);
            await page.evaluate(() => setCursor(holeAt(8, 0)));
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => selected)).toBe(await id(page, 8, 0));
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press(' ');
            const state = await page.evaluate(() => ({ empty: board[holeAt(8, 0)], turn, moves }));
            expect(state.empty).toBe(null);
            expect(state.moves).toBe(1);
        });

        test('Space on an empty hole that is no destination does nothing', async ({ page }) => {
            await setup(page, [[8, 0]], [[0, 0]]);
            await page.evaluate(() => setCursor(holeAt(4, 0)));
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => [selected, moves])).toEqual([null, 0]);
        });
    });
});
