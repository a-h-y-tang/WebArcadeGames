const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The canvas is drawn at 600x600 but may be laid out smaller, so clicks are
// scaled from board pixels into CSS pixels.
async function clickPoint(page, point) {
    const canvas = page.locator('#canvas');
    const box = await canvas.boundingBox();
    const width = await page.evaluate(() => canvas.width);
    const scale = box.width / width;
    await canvas.click({ position: { x: point.x * scale, y: point.y * scale } });
}

async function clickPilgrim(page, player, index) {
    const point = await page.evaluate(
        ([p, i]) => pilgrimPoint(p, i),
        [player, index]
    );
    await clickPoint(page, point);
}

// Starts a game and forces the board into a known position.
async function setup(page, opts = {}) {
    await page.evaluate((o) => {
        startGame();
        aiDelay = 0;
        autoPlay = false;
        if (o.pilgrims) pilgrims = o.pilgrims.map((row) => row.slice());
        if (o.current !== undefined) current = o.current;
        if (o.dice) diceQueue = o.dice.slice();
        sixStreak = 0;
        draw();
    }, opts);
}

const HOME_ROW = [-1, -1, -1, -1];
const allHome = () => [HOME_ROW.slice(), HOME_ROW.slice(), HOME_ROW.slice(), HOME_ROW.slice()];

async function snapshot(page) {
    return page.evaluate(() => ({
        pilgrims: pilgrims.map((row) => row.slice()),
        current,
        phase,
        die,
        winner,
        sixStreak,
    }));
}

test.describe('Up to Jerusalem', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
        // Deterministic start for every test.
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Up to Jerusalem', async ({ page }) => {
            await expect(page).toHaveTitle('Up to Jerusalem');
        });

        test('canvas is 600x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('shows the Psalm 122 verse', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('house of the LORD');
        });

        test('start overlay is visible and prompts for Space', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText('Space');
        });

        test('phase is ready before the game starts', async ({ page }) => {
            expect(await page.evaluate(() => phase)).toBe('ready');
        });

        test('there are four pilgrim families', async ({ page }) => {
            expect(await page.evaluate(() => FAMILIES.length)).toBe(4);
            await expect(page.locator('#families .family')).toHaveCount(4);
        });

        test('you travel with the family from Nazareth', async ({ page }) => {
            const first = await page.evaluate(() => FAMILIES[0]);
            expect(first.name).toBe('Nazareth');
            expect(await page.evaluate(() => HUMAN)).toBe(0);
        });

        test('every family starts with four pilgrims at home', async ({ page }) => {
            const p = await page.evaluate(() => pilgrims);
            expect(p.length).toBe(4);
            expect(p.every((row) => row.length === 4 && row.every((s) => s === -1))).toBe(true);
        });

        test('no die has been rolled', async ({ page }) => {
            expect(await page.evaluate(() => die)).toBe(0);
            await expect(page.locator('#die')).toHaveText('–');
        });

        test('wins counter starts at zero', async ({ page }) => {
            await expect(page.locator('#wins')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Board geometry
    // -----------------------------------------------------------------------
    test.describe('the board', () => {
        test('the shared road is 52 distinct cells', async ({ page }) => {
            const road = await page.evaluate(() => ROAD);
            expect(road.length).toBe(52);
            expect(new Set(road.map((c) => `${c.r},${c.c}`)).size).toBe(52);
        });

        test('every road cell is inside the 15x15 board', async ({ page }) => {
            const road = await page.evaluate(() => ROAD);
            const bad = road.filter((c) => c.r < 0 || c.r > 14 || c.c < 0 || c.c > 14);
            expect(bad).toEqual([]);
        });

        test('the road is a closed loop that only ever steps to a touching cell', async ({ page }) => {
            const road = await page.evaluate(() => ROAD);
            const steps = [];
            for (let i = 0; i < road.length; i++) {
                const a = road[i];
                const b = road[(i + 1) % road.length];
                steps.push(Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c)) === 1
                    ? Math.abs(a.r - b.r) + Math.abs(a.c - b.c)
                    : 99);
            }
            expect(steps.filter((d) => d === 99)).toEqual([]);
            // Four corner steps cut across between arms, as on a printed board.
            expect(steps.filter((d) => d === 2).length).toBe(4);
        });

        test('the four start cells are 13 apart', async ({ page }) => {
            expect(await page.evaluate(() => START)).toEqual([0, 13, 26, 39]);
        });

        test('each family has a five cell ascent', async ({ page }) => {
            const ascents = await page.evaluate(() => ASCENT);
            expect(ascents.length).toBe(4);
            expect(ascents.every((a) => a.length === 5)).toBe(true);
        });

        test('each ascent starts next to the road cell 50 steps from that start', async ({ page }) => {
            const bad = await page.evaluate(() =>
                FAMILIES.map((f, p) => {
                    const gate = ROAD[(START[p] + 50) % 52];
                    const first = ASCENT[p][0];
                    return Math.abs(gate.r - first.r) + Math.abs(gate.c - first.c) === 1 ? null : p;
                }).filter((x) => x !== null)
            );
            expect(bad).toEqual([]);
        });

        test('each ascent ends next to the temple courts', async ({ page }) => {
            const bad = await page.evaluate(() =>
                ASCENT.map((a, p) => {
                    const last = a[4];
                    // The temple courts fill the middle three-by-three block.
                    let touches = false;
                    for (let r = 6; r <= 8; r++) {
                        for (let c = 6; c <= 8; c++) {
                            if (Math.abs(last.r - r) + Math.abs(last.c - c) === 1) touches = true;
                        }
                    }
                    return touches ? null : p;
                }).filter((x) => x !== null)
            );
            expect(bad).toEqual([]);
        });

        test('eight road cells are safe: the four starts and four wells', async ({ page }) => {
            const safe = await page.evaluate(() => [...SAFE].sort((a, b) => a - b));
            expect(safe).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
        });

        test('a pilgrim path runs road, ascent, then temple', async ({ page }) => {
            const map = await page.evaluate(() => ({
                start: stepTo(0, 0),
                roadStart: ROAD[START[0]],
                gate: stepTo(0, 50),
                roadGate: ROAD[(START[0] + 50) % 52],
                firstAscent: stepTo(0, 51),
                ascent0: ASCENT[0][0],
                lastAscent: stepTo(0, 55),
                ascent4: ASCENT[0][4],
                temple: TEMPLE,
            }));
            expect(map.start).toEqual(map.roadStart);
            expect(map.gate).toEqual(map.roadGate);
            expect(map.firstAscent).toEqual(map.ascent0);
            expect(map.lastAscent).toEqual(map.ascent4);
            expect(map.temple).toBe(56);
        });

        test('each family travels the same distance to the temple', async ({ page }) => {
            const lengths = await page.evaluate(() =>
                FAMILIES.map((f, p) => {
                    let n = 0;
                    for (let s = 0; s <= TEMPLE; s++) if (stepTo(p, s)) n++;
                    return n;
                })
            );
            expect(lengths).toEqual([57, 57, 57, 57]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => phase)).toBe('roll');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => phase)).toBe('roll');
        });

        test('Nazareth, the family you travel with, goes first', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => current)).toBe(0);
            await expect(page.locator('#turn')).toHaveText('Nazareth');
        });

        test('the status line invites you to roll', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#status')).toContainText(/roll/i);
        });

        test('New Game puts every pilgrim back home', async ({ page }) => {
            await setup(page, { pilgrims: [[0, 5, 10, 20], HOME_ROW, HOME_ROW, HOME_ROW] });
            await page.locator('#btn-new').click();
            const p = await page.evaluate(() => pilgrims);
            expect(p.every((row) => row.every((s) => s === -1))).toBe(true);
            expect(await page.evaluate(() => current)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rolling and setting out
    // -----------------------------------------------------------------------
    test.describe('setting out from home', () => {
        test('a pilgrim only sets out on a six', async ({ page }) => {
            await setup(page, { pilgrims: allHome() });
            const counts = await page.evaluate(() =>
                [1, 2, 3, 4, 5, 6].map((d) => legalMoves(0, d).length)
            );
            expect(counts).toEqual([0, 0, 0, 0, 0, 1]);
        });

        test('four identical "set out" moves are offered as one', async ({ page }) => {
            await setup(page, { pilgrims: allHome() });
            const moves = await page.evaluate(() => legalMoves(0, 6));
            expect(moves.length).toBe(1);
            expect(moves[0].from).toBe(-1);
            expect(moves[0].to).toBe(0);
        });

        test('a roll that cannot be used passes the turn on', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), dice: [3] });
            await page.evaluate(() => rollDie());
            const s = await snapshot(page);
            expect(s.current).toBe(1);
            expect(s.phase).toBe('roll');
            await expect(page.locator('#status')).toContainText(/no/i);
        });

        test('setting out lands the pilgrim on the family start cell', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), dice: [6] });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, 6)[0]);
            });
            const s = await snapshot(page);
            expect(s.pilgrims[0][0]).toBe(0);
            const cell = await page.evaluate(() => stepTo(0, 0));
            const startCell = await page.evaluate(() => ROAD[START[0]]);
            expect(cell).toEqual(startCell);
        });

        test('a six earns another roll', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), dice: [6] });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, 6)[0]);
            });
            const s = await snapshot(page);
            expect(s.current).toBe(0);
            expect(s.phase).toBe('roll');
        });

        test('three sixes in a row forfeit the turn', async ({ page }) => {
            await setup(page, { pilgrims: [[0, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [6, 6, 6] });
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) {
                    rollDie();
                    if (phase === 'move') applyMove(legalMoves(current, die)[0]);
                }
            });
            const s = await snapshot(page);
            expect(s.current).toBe(1);
            expect(s.phase).toBe('roll');
            await expect(page.locator('#status')).toContainText(/three sixes/i);
        });
    });

    // -----------------------------------------------------------------------
    // Moving along the road
    // -----------------------------------------------------------------------
    test.describe('moving along the road', () => {
        test('a pilgrim advances exactly the die value', async ({ page }) => {
            await setup(page, { pilgrims: [[3, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [4] });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            expect((await snapshot(page)).pilgrims[0][0]).toBe(7);
        });

        test('each pilgrim on the road is a separate choice', async ({ page }) => {
            await setup(page, { pilgrims: [[2, 9, 20, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const moves = await page.evaluate(() => legalMoves(0, 3));
            expect(moves.map((m) => m.from).sort((a, b) => a - b)).toEqual([2, 9, 20]);
        });

        test('a pilgrim walks off the road into the ascent', async ({ page }) => {
            await setup(page, { pilgrims: [[49, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const move = await page.evaluate(() => legalMoves(0, 3)[0]);
            expect(move.to).toBe(52);
            const cell = await page.evaluate(() => stepTo(0, 52));
            const ascent = await page.evaluate(() => ASCENT[0][1]);
            expect(cell).toEqual(ascent);
        });

        test('the temple must be reached exactly', async ({ page }) => {
            await setup(page, { pilgrims: [[52, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const exact = await page.evaluate(() => legalMoves(0, 4));
            const over = await page.evaluate(() => legalMoves(0, 5));
            expect(exact.length).toBe(1);
            expect(exact[0].to).toBe(56);
            expect(over).toEqual([]);
        });

        test('a pilgrim in the temple never moves again', async ({ page }) => {
            await setup(page, { pilgrims: [[56, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const moves = await page.evaluate(() => [1, 2, 3, 4, 5, 6].flatMap((d) => legalMoves(0, d)));
            expect(moves.filter((m) => m.from === 56)).toEqual([]);
        });

        test('two pilgrims of one family may camp on the same cell', async ({ page }) => {
            await setup(page, { pilgrims: [[5, 2, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [3] });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die).find((m) => m.from === 2));
            });
            const s = await snapshot(page);
            expect(s.pilgrims[0][0]).toBe(5);
            expect(s.pilgrims[0][1]).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Captures
    // -----------------------------------------------------------------------
    test.describe('captures', () => {
        test('landing on a lone opponent sends it home', async ({ page }) => {
            // Nazareth pilgrim at path 17 -> road 17; Jericho pilgrim at path 4 -> road 17.
            await setup(page, {
                pilgrims: [[14, -1, -1, -1], [4, -1, -1, -1], HOME_ROW, HOME_ROW],
                dice: [3],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.pilgrims[0][0]).toBe(17);
            expect(s.pilgrims[1][0]).toBe(-1);
            await expect(page.locator('#status')).toContainText(/home/i);
        });

        test('a capture earns another roll', async ({ page }) => {
            await setup(page, {
                pilgrims: [[14, -1, -1, -1], [4, -1, -1, -1], HOME_ROW, HOME_ROW],
                dice: [3],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.current).toBe(0);
            expect(s.phase).toBe('roll');
        });

        test('a pilgrim standing on a well cannot be sent home', async ({ page }) => {
            // Road 21 is a well. Nazareth path 21 == road 21; Jericho path 8 == road 21.
            await setup(page, {
                pilgrims: [[18, -1, -1, -1], [8, -1, -1, -1], HOME_ROW, HOME_ROW],
                dice: [3],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.pilgrims[0][0]).toBe(21);
            expect(s.pilgrims[1][0]).toBe(8);
        });

        test('a pilgrim on its own start cell cannot be sent home', async ({ page }) => {
            // Road 13 is Jericho's start cell; Nazareth path 13 == road 13.
            await setup(page, {
                pilgrims: [[10, -1, -1, -1], [0, -1, -1, -1], HOME_ROW, HOME_ROW],
                dice: [3],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.pilgrims[0][0]).toBe(13);
            expect(s.pilgrims[1][0]).toBe(0);
        });

        test('a camp of two cannot be sent home', async ({ page }) => {
            await setup(page, {
                pilgrims: [[14, -1, -1, -1], [4, 4, -1, -1], HOME_ROW, HOME_ROW],
                dice: [3],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.pilgrims[1]).toEqual([4, 4, -1, -1]);
        });

        test('pilgrims in an ascent are out of reach', async ({ page }) => {
            const safe = await page.evaluate(() => {
                pilgrims = [[51, -1, -1, -1], [51, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
                return legalMoves(0, 1).every((m) => m.captures.length === 0);
            });
            expect(safe).toBe(true);
        });

        test('no capture happens on your own camp', async ({ page }) => {
            await setup(page, { pilgrims: [[5, 2, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const move = await page.evaluate(() => legalMoves(0, 3).find((m) => m.from === 2));
            expect(move.captures).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('reaching Jerusalem', () => {
        test('the family with all four pilgrims in the temple wins', async ({ page }) => {
            await setup(page, {
                pilgrims: [[56, 56, 56, 55], HOME_ROW, HOME_ROW, HOME_ROW],
                dice: [1],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.phase).toBe('over');
            expect(s.winner).toBe(0);
        });

        test('winning shows the feast overlay', async ({ page }) => {
            await setup(page, {
                pilgrims: [[56, 56, 56, 55], HOME_ROW, HOME_ROW, HOME_ROW],
                dice: [1],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/Jerusalem/i);
        });

        test('your wins are remembered', async ({ page }) => {
            await setup(page, {
                pilgrims: [[56, 56, 56, 55], HOME_ROW, HOME_ROW, HOME_ROW],
                dice: [1],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            await expect(page.locator('#wins')).toHaveText('1');
            await page.reload();
            await expect(page.locator('#wins')).toHaveText('1');
        });

        test('a computer family can win too', async ({ page }) => {
            await setup(page, {
                pilgrims: [HOME_ROW, [56, 56, 56, 55], HOME_ROW, HOME_ROW],
                current: 1,
                dice: [1],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(1, die)[0]);
            });
            const s = await snapshot(page);
            expect(s.winner).toBe(1);
            await expect(page.locator('#wins')).toHaveText('0');
            await expect(page.locator('#overlay-title')).toContainText('Jericho');
        });

        test('no move is possible once the feast has begun', async ({ page }) => {
            await setup(page, {
                pilgrims: [[56, 56, 56, 55], HOME_ROW, HOME_ROW, HOME_ROW],
                dice: [1, 6],
            });
            await page.evaluate(() => {
                rollDie();
                applyMove(legalMoves(0, die)[0]);
            });
            const before = await snapshot(page);
            await page.keyboard.press('Space');
            const after = await snapshot(page);
            expect(after.pilgrims).toEqual(before.pilgrims);
        });
    });

    // -----------------------------------------------------------------------
    // Playing with the mouse and keyboard
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('the Roll button rolls the die', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), dice: [6] });
            await page.locator('#btn-roll').click();
            expect(await page.evaluate(() => die)).toBe(6);
            await expect(page.locator('#die')).toHaveText('6');
        });

        test('Space rolls the die on your turn', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), dice: [6] });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => phase)).toBe('move');
        });

        test('clicking a pilgrim moves it', async ({ page }) => {
            await setup(page, { pilgrims: [[4, 30, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [3] });
            await page.keyboard.press('Space');
            await clickPilgrim(page, 0, 1);
            expect((await snapshot(page)).pilgrims[0][1]).toBe(33);
        });

        test('clicking an immovable pilgrim does nothing', async ({ page }) => {
            await setup(page, { pilgrims: [[4, 56, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [3] });
            await page.keyboard.press('Space');
            await clickPilgrim(page, 0, 1);
            const s = await snapshot(page);
            expect(s.pilgrims[0]).toEqual([4, 56, -1, -1]);
            expect(s.phase).toBe('move');
        });

        test('number keys pick a pilgrim', async ({ page }) => {
            await setup(page, { pilgrims: [[4, 30, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [2] });
            await page.keyboard.press('Space');
            await page.keyboard.press('2');
            expect((await snapshot(page)).pilgrims[0][1]).toBe(32);
        });

        test('Enter takes the first legal move', async ({ page }) => {
            await setup(page, { pilgrims: [[4, -1, -1, -1], HOME_ROW, HOME_ROW, HOME_ROW], dice: [2] });
            await page.keyboard.press('Space');
            await page.keyboard.press('Enter');
            expect((await snapshot(page)).pilgrims[0][0]).toBe(6);
        });

        test('N starts a new game', async ({ page }) => {
            await setup(page, { pilgrims: [[20, 20, 20, 20], HOME_ROW, HOME_ROW, HOME_ROW] });
            await page.keyboard.press('n');
            const p = await page.evaluate(() => pilgrims);
            expect(p[0]).toEqual([-1, -1, -1, -1]);
        });

        test('you cannot roll during a computer family turn', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), current: 1, dice: [6] });
            await expect(page.locator('#btn-roll')).toBeDisabled();
            await page.keyboard.press('Space');
            await page.keyboard.press('Enter');
            await page.evaluate(() => humanRoll());
            const s = await snapshot(page);
            expect(s.die).toBe(0);
            expect(s.current).toBe(1);
        });

        test('the Roll button is disabled when it is not your turn', async ({ page }) => {
            await setup(page, { pilgrims: allHome(), current: 2 });
            await expect(page.locator('#btn-roll')).toBeDisabled();
        });

        test('the family panel counts pilgrims at home and in the temple', async ({ page }) => {
            await setup(page, { pilgrims: [[56, 56, 20, -1], HOME_ROW, HOME_ROW, HOME_ROW] });
            const family = page.locator('#families .family').first();
            await expect(family.locator('.fhome')).toHaveText('1');
            await expect(family.locator('.ftemple')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // The computer families
    // -----------------------------------------------------------------------
    test.describe('the computer families', () => {
        test('a computer prefers a capture', async ({ page }) => {
            // Jericho's pilgrim at path 4 stands on road 17; three on is road 20,
            // where Nazareth's pilgrim (path 20) waits on an unsafe cell.
            await setup(page, {
                pilgrims: [[20, -1, -1, -1], [4, 20, -1, -1], HOME_ROW, HOME_ROW],
                current: 1,
            });
            const move = await page.evaluate(() => bestMove(1, legalMoves(1, 3)));
            expect(move.from).toBe(4);
            expect(move.captures.length).toBe(1);
        });

        test('a computer prefers reaching the temple', async ({ page }) => {
            await setup(page, {
                pilgrims: [HOME_ROW, [53, 20, -1, -1], HOME_ROW, HOME_ROW],
                current: 1,
            });
            const move = await page.evaluate(() => bestMove(1, legalMoves(1, 3)));
            expect(move.to).toBe(56);
        });

        test('a computer sets out from home when a six is rolled', async ({ page }) => {
            await setup(page, { pilgrims: [HOME_ROW, HOME_ROW, HOME_ROW, HOME_ROW], current: 1 });
            const move = await page.evaluate(() => bestMove(1, legalMoves(1, 6)));
            expect(move.from).toBe(-1);
        });

        test('the computer families take their turns and hand play back to you', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                aiDelay = 0;
                diceQueue = [3];
                rollDie();
            });
            await expect
                .poll(async () => (await snapshot(page)).current, { timeout: 5000 })
                .toBe(0);
            expect((await snapshot(page)).phase).toBe('roll');
        });

        test('the computer never leaves the board in an illegal state', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                autoPlay = false;
                aiDelay = 0;
                let guard = 0;
                while (phase !== 'over' && guard++ < 40000) {
                    if (phase === 'roll') rollDie();
                    else if (phase === 'move') {
                        const moves = legalMoves(current, die);
                        applyMove(bestMove(current, moves));
                    }
                }
                const flat = pilgrims.flat();
                return {
                    phase,
                    winner,
                    guard,
                    count: flat.length,
                    inRange: flat.every((s) => s === -1 || (s >= 0 && s <= 56)),
                    finished: pilgrims.map((row) => row.filter((s) => s === 56).length),
                };
            });
            expect(result.phase).toBe('over');
            expect(result.count).toBe(16);
            expect(result.inRange).toBe(true);
            expect(result.winner).not.toBeNull();
            expect(result.finished[result.winner]).toBe(4);
            expect(errors).toEqual([]);
        });

        test('three full games finish without error', async ({ page }) => {
            const winners = await page.evaluate(() => {
                const out = [];
                for (let game = 0; game < 3; game++) {
                    startGame();
                    autoPlay = false;
                    aiDelay = 0;
                    let guard = 0;
                    while (phase !== 'over' && guard++ < 40000) {
                        if (phase === 'roll') rollDie();
                        else applyMove(bestMove(current, legalMoves(current, die)));
                    }
                    out.push(winner);
                }
                return out;
            });
            expect(winners.every((w) => w !== null && w >= 0 && w <= 3)).toBe(true);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Page furniture
    // -----------------------------------------------------------------------
    test.describe('the page', () => {
        test('explains the rules', async ({ page }) => {
            await expect(page.locator('#rules')).toContainText(/six/i);
            await expect(page.locator('#rules')).toContainText(/temple/i);
        });

        test('names all four pilgrim families', async ({ page }) => {
            const names = await page.locator('#families .fname').allTextContents();
            expect(names.map((n) => n.trim())).toEqual(['Nazareth', 'Jericho', 'Beersheba', 'Joppa']);
        });

        test('the canvas has an accessible label', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('aria-label', /board/i);
        });

        test('the status line is a live region', async ({ page }) => {
            await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite');
        });
    });
});
