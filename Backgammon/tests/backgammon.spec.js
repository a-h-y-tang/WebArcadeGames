const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a game, wipe the board and lay out an exact position with the computer
// disabled, so a test owns every checker on the table.
//   place = { w: { <point>: count }, b: { <point>: count },
//             barW, barB, offW, offB }
async function setup(page, place = {}, player = 'white') {
    await page.evaluate(
        ({ place, player }) => {
            startGame();
            aiEnabled = false;
            if (place.w || place.b) {
                pos.pts = new Array(24).fill(0);
                for (const [p, n] of Object.entries(place.w || {})) pos.pts[p - 1] = n;
                for (const [p, n] of Object.entries(place.b || {})) pos.pts[p - 1] = -n;
            }
            pos.barW = place.barW || 0;
            pos.barB = place.barB || 0;
            pos.offW = place.offW || 0;
            pos.offB = place.offB || 0;
            currentPlayer = player;
            state = 'rolling';
            dice = [];
            moves = [];
            selected = null;
            message = '';
            sync();
        },
        { place, player }
    );
}

// Roll a known pair of dice.
async function roll(page, values) {
    await page.evaluate((values) => {
        diceQueue = values.slice();
        rollDice();
    }, values);
}

// Click a point of the 900x560 board, wherever the canvas sits on the page and
// whatever it is scaled to.
async function clickBoard(page, x, y) {
    const box = await page.locator('#canvas').boundingBox();
    const scale = box.width / 900;
    await page.mouse.click(box.x + x * scale, box.y + y * scale);
}

const snapshot = (page) =>
    page.evaluate(() => ({
        pts: pos.pts.slice(),
        barW: pos.barW,
        barB: pos.barB,
        offW: pos.offW,
        offB: pos.offB,
        moves: moves.slice(),
        currentPlayer,
        state,
    }));

test.describe('Backgammon', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Backgammon', async ({ page }) => {
            await expect(page).toHaveTitle('Backgammon');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('state starts as ready', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('canvas is 900x560', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '900');
            await expect(canvas).toHaveAttribute('height', '560');
        });

        test('board has 24 points', async ({ page }) => {
            expect(await page.evaluate(() => pos.pts.length)).toBe(24);
        });

        test('opening position is the standard one', async ({ page }) => {
            expect(await page.evaluate(() => pos.pts.slice())).toEqual([
                -2, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, -5,
                5, 0, 0, 0, -3, 0, -5, 0, 0, 0, 0, 2,
            ]);
        });

        test('each side starts with fifteen checkers', async ({ page }) => {
            expect(await page.evaluate(() => ({
                white: checkerCount('white'),
                black: checkerCount('black'),
            }))).toEqual({ white: 15, black: 15 });
        });

        test('both pip counts start at 167', async ({ page }) => {
            expect(await page.evaluate(() => ({
                white: pipCount('white'),
                black: pipCount('black'),
            }))).toEqual({ white: 167, black: 167 });
        });

        test('nothing is on the bar or borne off', async ({ page }) => {
            expect(await page.evaluate(() => [pos.barW, pos.barB, pos.offW, pos.offB]))
                .toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Starting and restarting
    // -----------------------------------------------------------------------
    test.describe('starting a game', () => {
        test('Start hides the overlay and waits for a roll', async ({ page }) => {
            await page.click('#btn-start');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => ({ state, currentPlayer })))
                .toEqual({ state: 'rolling', currentPlayer: 'white' });
        });

        test('the roll button is enabled while waiting to roll', async ({ page }) => {
            await page.click('#btn-start');
            await expect(page.locator('#btn-roll')).toBeEnabled();
        });

        test('the roll button is disabled once dice are in hand', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [3, 5]);
            await expect(page.locator('#btn-roll')).toBeDisabled();
        });

        test('R restarts to the opening position', async ({ page }) => {
            await setup(page, { w: { 1: 15 }, offB: 4 });
            await page.keyboard.press('r');
            expect(await page.evaluate(() => ({
                pip: pipCount('white'),
                offB: pos.offB,
                state,
                player: currentPlayer,
            }))).toEqual({ pip: 167, offB: 0, state: 'rolling', player: 'white' });
        });
    });

    // -----------------------------------------------------------------------
    // Dice
    // -----------------------------------------------------------------------
    test.describe('dice', () => {
        test('a roll gives two moves', async ({ page }) => {
            await setup(page);
            await roll(page, [3, 5]);
            expect(await page.evaluate(() => ({ dice: dice.slice(), moves: moves.slice(), state })))
                .toEqual({ dice: [3, 5], moves: [3, 5], state: 'moving' });
        });

        test('doubles give four moves', async ({ page }) => {
            await setup(page);
            await roll(page, [4, 4]);
            expect(await page.evaluate(() => moves.slice())).toEqual([4, 4, 4, 4]);
        });

        test('real rolls only ever produce 1-6', async ({ page }) => {
            const values = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                const seen = [];
                for (let i = 0; i < 200; i++) {
                    const d = rollDie();
                    seen.push(d);
                }
                return seen;
            });
            expect(values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true);
            expect(new Set(values).size).toBe(6);
        });

        test('cannot roll while moves are still in hand', async ({ page }) => {
            await setup(page);
            await roll(page, [3, 5]);
            await roll(page, [1, 1]);
            expect(await page.evaluate(() => moves.slice())).toEqual([3, 5]);
        });
    });

    // -----------------------------------------------------------------------
    // Moving
    // -----------------------------------------------------------------------
    test.describe('moving', () => {
        test('white moves down the board', async ({ page }) => {
            await setup(page, { w: { 24: 2 } });
            await roll(page, [3, 5]);
            await page.evaluate(() => applyMove({ from: 23, to: 20, die: 3 }));
            const s = await snapshot(page);
            expect(s.pts[23]).toBe(1);
            expect(s.pts[20]).toBe(1);
            expect(s.moves).toEqual([5]);
        });

        test('dark moves up the board', async ({ page }) => {
            await setup(page, { b: { 1: 2 } }, 'black');
            await roll(page, [3, 5]);
            await page.evaluate(() => applyMove({ from: 0, to: 3, die: 3 }));
            const s = await snapshot(page);
            expect(s.pts[0]).toBe(-1);
            expect(s.pts[3]).toBe(-1);
        });

        test('a point held by two enemy checkers is closed', async ({ page }) => {
            await setup(page, { w: { 6: 2 }, b: { 5: 2, 4: 2, 3: 2 } });
            await roll(page, [1, 2]);
            const froms = await page.evaluate(() => legalMoves().map((m) => `${m.from}>${m.to}`));
            expect(froms).not.toContain('5>4');
            expect(froms).not.toContain('5>3');
        });

        test('a point held by one enemy checker can be hit', async ({ page }) => {
            await setup(page, { w: { 6: 2 }, b: { 5: 1 } });
            await roll(page, [1, 3]);
            await page.evaluate(() => applyMove({ from: 5, to: 4, die: 1 }));
            const s = await snapshot(page);
            expect(s.pts[4]).toBe(1);
            expect(s.barB).toBe(1);
        });

        test('hitting keeps both sides at fifteen checkers', async ({ page }) => {
            await setup(page, { w: { 6: 2 }, b: { 5: 1, 20: 14 } });
            await roll(page, [1, 3]);
            await page.evaluate(() => applyMove({ from: 5, to: 4, die: 1 }));
            expect(await page.evaluate(() => ({
                white: checkerCount('white'),
                black: checkerCount('black'),
            }))).toEqual({ white: 2, black: 15 });
        });

        test('using the last die ends the turn', async ({ page }) => {
            await setup(page, { w: { 24: 2 } });
            await roll(page, [3, 5]);
            await page.evaluate(() => {
                applyMove({ from: 23, to: 20, die: 3 });
                applyMove({ from: 23, to: 18, die: 5 });
            });
            const s = await snapshot(page);
            expect(s.moves).toEqual([]);
            expect(s.currentPlayer).toBe('black');
            expect(s.state).toBe('rolling');
        });

        test('an illegal move is rejected', async ({ page }) => {
            await setup(page, { w: { 24: 2 }, b: { 21: 2 } });
            await roll(page, [3, 5]);
            const ok = await page.evaluate(() => applyMove({ from: 23, to: 20, die: 3 }));
            expect(ok).toBe(false);
            expect((await snapshot(page)).pts[23]).toBe(2);
        });

        test('a die with no legal move is forfeited', async ({ page }) => {
            // The checker on 20 keeps white out of the bear-off, dark closes
            // points 16, 5, 4, 3 and 2, and a 5 plays 6 -> 1. After that a 4
            // has nowhere to go at all.
            await setup(page, { w: { 6: 1, 20: 1 }, b: { 16: 2, 5: 2, 4: 2, 3: 2, 2: 2 } });
            await roll(page, [4, 5]);
            await page.evaluate(() => applyMove({ from: 5, to: 0, die: 5 }));
            const s = await snapshot(page);
            expect(s.moves).toEqual([]);
            expect(s.currentPlayer).toBe('black');
        });

        test('a roll with no legal move at all passes the turn', async ({ page }) => {
            await setup(page, { w: { 6: 1 }, b: { 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 } });
            await roll(page, [1, 2]);
            const s = await snapshot(page);
            expect(s.currentPlayer).toBe('black');
            expect(s.state).toBe('rolling');
            await expect(page.locator('#message')).toContainText(/no legal move/i);
        });
    });

    // -----------------------------------------------------------------------
    // The bar
    // -----------------------------------------------------------------------
    test.describe('the bar', () => {
        test('a checker on the bar must enter first', async ({ page }) => {
            await setup(page, { w: { 6: 5, 13: 5 }, barW: 1 });
            await roll(page, [2, 4]);
            const froms = await page.evaluate(() => [...new Set(legalMoves().map((m) => m.from))]);
            expect(froms).toEqual(['bar']);
        });

        test('white enters on 25 minus the die', async ({ page }) => {
            await setup(page, { w: { 6: 5 }, barW: 1 });
            await roll(page, [3, 6]);
            await page.evaluate(() => applyMove({ from: 'bar', to: 21, die: 3 }));
            const s = await snapshot(page);
            expect(s.barW).toBe(0);
            expect(s.pts[21]).toBe(1);
        });

        test('dark enters on the die', async ({ page }) => {
            await setup(page, { b: { 19: 5 }, barB: 1 }, 'black');
            await roll(page, [3, 6]);
            await page.evaluate(() => applyMove({ from: 'bar', to: 2, die: 3 }));
            const s = await snapshot(page);
            expect(s.barB).toBe(0);
            expect(s.pts[2]).toBe(-1);
        });

        test('entering can hit a blot', async ({ page }) => {
            await setup(page, { w: { 6: 5 }, b: { 22: 1 }, barW: 1 });
            await roll(page, [3, 3]);
            await page.evaluate(() => applyMove({ from: 'bar', to: 21, die: 3 }));
            const s = await snapshot(page);
            expect(s.pts[21]).toBe(1);
            expect(s.barB).toBe(1);
        });

        test('a closed home board means the turn is lost', async ({ page }) => {
            await setup(page, { w: { 6: 3 }, b: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 }, barW: 1 });
            await roll(page, [2, 5]);
            const s = await snapshot(page);
            expect(s.barW).toBe(1);
            expect(s.currentPlayer).toBe('black');
        });
    });

    // -----------------------------------------------------------------------
    // Bearing off
    // -----------------------------------------------------------------------
    test.describe('bearing off', () => {
        test('not allowed while a checker is outside the home board', async ({ page }) => {
            await setup(page, { w: { 3: 4, 9: 1 } });
            expect(await page.evaluate(() => canBearOff('white'))).toBe(false);
        });

        test('not allowed while a checker is on the bar', async ({ page }) => {
            await setup(page, { w: { 3: 4 }, barW: 1 });
            expect(await page.evaluate(() => canBearOff('white'))).toBe(false);
        });

        test('allowed once every checker is home', async ({ page }) => {
            await setup(page, { w: { 3: 4, 1: 2 } });
            expect(await page.evaluate(() => canBearOff('white'))).toBe(true);
        });

        test('an exact die bears a checker off', async ({ page }) => {
            await setup(page, { w: { 3: 2, 1: 2 } });
            await roll(page, [3, 1]);
            await page.evaluate(() => applyMove({ from: 2, to: 'off', die: 3 }));
            const s = await snapshot(page);
            expect(s.offW).toBe(1);
            expect(s.pts[2]).toBe(1);
        });

        test('a bigger die bears off when nothing sits further back', async ({ page }) => {
            await setup(page, { w: { 2: 2 } });
            await roll(page, [5, 5]);
            const offs = await page.evaluate(() => legalMoves().filter((m) => m.to === 'off'));
            expect(offs.length).toBe(1);
            await page.evaluate(() => applyMove({ from: 1, to: 'off', die: 5 }));
            expect((await snapshot(page)).offW).toBe(1);
        });

        test('a bigger die may not skip a checker further back', async ({ page }) => {
            await setup(page, { w: { 6: 1, 2: 1 } });
            await roll(page, [5, 5]);
            const offs = await page.evaluate(() => legalMoves().filter((m) => m.to === 'off'));
            expect(offs).toEqual([]);
        });

        test('dark bears off past point 24', async ({ page }) => {
            await setup(page, { b: { 22: 2 } }, 'black');
            await roll(page, [3, 3]);
            await page.evaluate(() => applyMove({ from: 21, to: 'off', die: 3 }));
            const s = await snapshot(page);
            expect(s.offB).toBe(1);
            expect(s.pts[21]).toBe(-1);
        });

        test('the fifteenth checker off wins the game', async ({ page }) => {
            await setup(page, { w: { 1: 1 }, b: { 20: 10 }, offW: 14, offB: 5 });
            await roll(page, [1, 2]);
            await page.evaluate(() => applyMove({ from: 0, to: 'off', die: 1 }));
            expect(await page.evaluate(() => ({ state, winner, offW: pos.offW })))
                .toEqual({ state: 'over', winner: 'white', offW: 15 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a win with the loser on nothing is a gammon', async ({ page }) => {
            await setup(page, { w: { 1: 1 }, b: { 13: 15 }, offW: 14 });
            await roll(page, [1, 2]);
            await page.evaluate(() => applyMove({ from: 0, to: 'off', die: 1 }));
            await expect(page.locator('#overlay-sub')).toContainText(/gammon/i);
        });
    });

    // -----------------------------------------------------------------------
    // Clicking the board
    // -----------------------------------------------------------------------
    test.describe('clicking', () => {
        test('point geometry maps clicks back to points', async ({ page }) => {
            expect(await page.evaluate(() => ({
                p1: pointAt(788, 500),
                p12: pointAt(48, 500),
                p13: pointAt(48, 60),
                p24: pointAt(788, 60),
                bar: pointAt(418, 300),
                tray: pointAt(850, 500),
                off: pointAt(-5, 5),
            }))).toEqual({ p1: 0, p12: 11, p13: 12, p24: 23, bar: 'bar', tray: 'off', off: null });
        });

        test('clicking your own point selects it', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [1, 2]);
            await clickBoard(page, 468, 500);
            expect(await page.evaluate(() => selected)).toBe(5);
        });

        test('clicking a legal destination moves the checker', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [1, 2]);
            await clickBoard(page, 468, 500);
            await clickBoard(page, 532, 500);
            const s = await snapshot(page);
            expect(s.pts[5]).toBe(4);
            expect(s.pts[4]).toBe(1);
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking the selected point again cancels', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [1, 2]);
            await page.evaluate(() => clickPoint(5));
            await page.evaluate(() => clickPoint(5));
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('an empty point cannot be selected', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [1, 2]);
            await page.evaluate(() => clickPoint(10));
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test("an enemy point cannot be selected", async ({ page }) => {
            await setup(page, { w: { 6: 5 }, b: { 12: 2 } });
            await roll(page, [1, 2]);
            await page.evaluate(() => clickPoint(11));
            expect(await page.evaluate(() => selected)).toBe(null);
        });

        test('clicking the tray bears the selected checker off', async ({ page }) => {
            await setup(page, { w: { 3: 2 } });
            await roll(page, [3, 3]);
            await page.evaluate(() => {
                clickPoint(2);
                clickPoint('off');
            });
            expect((await snapshot(page)).offW).toBe(1);
        });

        test('a selected point shows its legal destinations', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await roll(page, [1, 2]);
            await page.evaluate(() => clickPoint(5));
            expect(await page.evaluate(() => targetsFor(selected).map((m) => m.to).sort()))
                .toEqual([3, 4]);
        });

        test('clicks do nothing before the dice are rolled', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await page.evaluate(() => clickPoint(5));
            expect(await page.evaluate(() => selected)).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // The computer opponent
    // -----------------------------------------------------------------------
    test.describe('the computer', () => {
        test('takes its turn and hands play back', async ({ page }) => {
            await page.click('#btn-start');
            await page.evaluate(() => {
                diceQueue = [6, 5];
                rollDice();
                for (const m of [{ from: 23, to: 17, die: 6 }, { from: 12, to: 7, die: 5 }]) applyMove(m);
            });
            await expect
                .poll(() => page.evaluate(() => currentPlayer), { timeout: 8000 })
                .toBe('white');
            expect(await page.evaluate(() => state)).toBe('rolling');
        });

        test('leaves fifteen checkers on each side', async ({ page }) => {
            await page.click('#btn-start');
            await page.evaluate(() => {
                diceQueue = [6, 5];
                rollDice();
                for (const m of [{ from: 23, to: 17, die: 6 }, { from: 12, to: 7, die: 5 }]) applyMove(m);
            });
            await expect
                .poll(() => page.evaluate(() => currentPlayer), { timeout: 8000 })
                .toBe('white');
            expect(await page.evaluate(() => ({
                white: checkerCount('white'),
                black: checkerCount('black'),
            }))).toEqual({ white: 15, black: 15 });
        });

        test('moves its own checkers in its own direction', async ({ page }) => {
            const before = await page.evaluate(() => {
                startGame();
                return pipCount('black');
            });
            await page.evaluate(() => {
                diceQueue = [6, 5];
                rollDice();
                for (const m of [{ from: 23, to: 17, die: 6 }, { from: 12, to: 7, die: 5 }]) applyMove(m);
            });
            await expect
                .poll(() => page.evaluate(() => currentPlayer), { timeout: 8000 })
                .toBe('white');
            const after = await page.evaluate(() => pipCount('black'));
            expect(after).toBeLessThan(before);
        });

        test('picks a sequence that uses both dice when it can', async ({ page }) => {
            const used = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                currentPlayer = 'black';
                return bestSequence(pos, 'black', [6, 5]).length;
            });
            expect(used).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // A whole game
    // -----------------------------------------------------------------------
    test.describe('a full game', () => {
        test('plays out to a win with the checkers all accounted for', async ({ page }) => {
            const result = await page.evaluate(() => {
                startGame();
                aiEnabled = false;             // both sides driven from here
                const problems = [];
                let turns = 0;
                while (state !== 'over' && turns < 600) {
                    turns++;
                    const player = currentPlayer;
                    rollDice();
                    if (state === 'moving') {
                        for (const mv of bestSequence(pos, player, moves)) {
                            if (!applyMove(mv)) problems.push(`turn ${turns}: illegal move`);
                            if (state !== 'moving') break;
                        }
                        if (state === 'moving') pruneDice();
                    }
                    if (checkerCount('white') !== 15) problems.push(`turn ${turns}: white has ${checkerCount('white')}`);
                    if (checkerCount('black') !== 15) problems.push(`turn ${turns}: black has ${checkerCount('black')}`);
                    if (pos.pts.some((v) => Math.abs(v) > 15)) problems.push(`turn ${turns}: overstacked point`);
                    if (state === 'moving' && currentPlayer !== player) problems.push(`turn ${turns}: turn changed mid-move`);
                }
                return { turns, state, winner, offW: pos.offW, offB: pos.offB, problems };
            });
            expect(result.problems).toEqual([]);
            expect(result.state).toBe('over');
            expect([result.offW, result.offB]).toContain(15);
            expect(result.winner === 'white' ? result.offW : result.offB).toBe(15);
            expect(result.turns).toBeLessThan(600);
        });

        test('the loser never ends up with a negative pip count', async ({ page }) => {
            const pips = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                let turns = 0;
                const low = [];
                while (state !== 'over' && turns < 600) {
                    turns++;
                    const player = currentPlayer;
                    rollDice();
                    if (state === 'moving') {
                        for (const mv of bestSequence(pos, player, moves)) {
                            applyMove(mv);
                            if (state !== 'moving') break;
                        }
                        if (state === 'moving') pruneDice();
                    }
                    low.push(Math.min(pipCount('white'), pipCount('black')));
                }
                return low;
            });
            expect(pips.every((v) => v >= 0)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('shows both pip counts', async ({ page }) => {
            await page.click('#btn-start');
            await expect(page.locator('#white-pips')).toHaveText('167');
            await expect(page.locator('#black-pips')).toHaveText('167');
        });

        test('pip count falls as you move', async ({ page }) => {
            await setup(page, { w: { 24: 2 } });
            await roll(page, [3, 5]);
            await page.evaluate(() => applyMove({ from: 23, to: 20, die: 3 }));
            await expect(page.locator('#white-pips')).toHaveText('45');
        });

        test('shows borne-off counts', async ({ page }) => {
            await setup(page, { w: { 3: 2 }, offW: 3, offB: 7 });
            await expect(page.locator('#white-off')).toHaveText('3');
            await expect(page.locator('#black-off')).toHaveText('7');
        });

        test('says whose turn it is', async ({ page }) => {
            await setup(page, { w: { 6: 5 } });
            await expect(page.locator('#turn-indicator')).toContainText(/your/i);
            await setup(page, { b: { 6: 5 } }, 'black');
            await expect(page.locator('#turn-indicator')).toContainText(/computer/i);
        });

        test('bar counts appear when a checker is hit', async ({ page }) => {
            await setup(page, { w: { 6: 2 }, b: { 5: 1 } });
            await roll(page, [1, 3]);
            await page.evaluate(() => applyMove({ from: 5, to: 4, die: 1 }));
            await expect(page.locator('#black-bar')).toHaveText('1');
        });
    });
});
