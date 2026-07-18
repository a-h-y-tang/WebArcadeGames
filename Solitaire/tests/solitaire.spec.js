const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Card literal helpers used to build exact boards for loadState().
const C = (rank, suit, faceUp = true) => ({ rank, suit, faceUp });
// A full ascending suit A..K, all face up (a completed foundation pile).
function fullSuit(suit) {
    const pile = [];
    for (let r = 1; r <= 13; r++) pile.push(C(r, suit, true));
    return pile;
}

async function load(page, board) {
    await page.evaluate((b) => window.loadState(b), board);
}

test.describe('Klondike Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions Solitaire', async ({ page }) => {
            await expect(page).toHaveTitle(/Solitaire/i);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/foundation|ace|king|card/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('exposes the game API on window', async ({ page }) => {
            const api = await page.evaluate(() => Object.fromEntries(
                ['newGame', 'loadState', 'makeCard', 'drawFromStock', 'color',
                    'canMoveToFoundation', 'canMoveToTableau', 'moveWasteToFoundation',
                    'moveWasteToTableau', 'moveTableauToFoundation', 'moveTableauToTableau',
                    'moveFoundationToTableau', 'isWon']
                    .map((k) => [k, typeof window[k]])));
            for (const k of Object.keys(api)) expect(api[k]).toBe('function');
        });
    });

    // -----------------------------------------------------------------------
    // Dealing a new game
    // -----------------------------------------------------------------------
    test.describe('the deal', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => window.newGame(1));
        });

        test('deals 52 cards in total', async ({ page }) => {
            const total = await page.evaluate(() => {
                const t = window.tableau.reduce((n, col) => n + col.length, 0);
                const f = window.foundations.reduce((n, p) => n + p.length, 0);
                return t + f + window.stock.length + window.waste.length;
            });
            expect(total).toBe(52);
        });

        test('tableau columns hold 1..7 cards', async ({ page }) => {
            const lengths = await page.evaluate(() => window.tableau.map((c) => c.length));
            expect(lengths).toEqual([1, 2, 3, 4, 5, 6, 7]);
        });

        test('only the bottom card of each column is face up', async ({ page }) => {
            const ok = await page.evaluate(() => window.tableau.every((col) =>
                col.every((card, i) => card.faceUp === (i === col.length - 1))));
            expect(ok).toBe(true);
        });

        test('stock holds 24, waste 0, foundations empty', async ({ page }) => {
            const s = await page.evaluate(() => ({
                stock: window.stock.length,
                waste: window.waste.length,
                foundations: window.foundations.map((p) => p.length),
            }));
            expect(s.stock).toBe(24);
            expect(s.waste).toBe(0);
            expect(s.foundations).toEqual([0, 0, 0, 0]);
        });

        test('the deck is a full set of 52 unique cards', async ({ page }) => {
            const unique = await page.evaluate(() => {
                const all = [
                    ...window.stock, ...window.waste,
                    ...window.foundations.flat(), ...window.tableau.flat(),
                ];
                return new Set(all.map((c) => c.rank + c.suit)).size;
            });
            expect(unique).toBe(52);
        });

        test('the same seed deals the same game', async ({ page }) => {
            const sig = () => window.tableau.map((col) =>
                col.map((c) => c.rank + c.suit).join(',')).join('|');
            const a = await page.evaluate(sig);
            await page.evaluate(() => window.newGame(1));
            const b = await page.evaluate(sig);
            expect(a).toBe(b);
        });

        test('state is playing after a deal', async ({ page }) => {
            expect(await page.evaluate(() => window.state)).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Colour helper
    // -----------------------------------------------------------------------
    test('colour classifies suits correctly', async ({ page }) => {
        const colors = await page.evaluate(() => ({
            S: window.color({ rank: 5, suit: 'S' }),
            C: window.color({ rank: 5, suit: 'C' }),
            H: window.color({ rank: 5, suit: 'H' }),
            D: window.color({ rank: 5, suit: 'D' }),
        }));
        expect(colors).toEqual({ S: 'black', C: 'black', H: 'red', D: 'red' });
    });

    // -----------------------------------------------------------------------
    // Stock and waste
    // -----------------------------------------------------------------------
    test.describe('stock and waste', () => {
        test('drawing moves one card from stock to waste, face up', async ({ page }) => {
            await page.evaluate(() => window.newGame(2));
            const r = await page.evaluate(() => {
                const ok = window.drawFromStock();
                return { ok, stock: window.stock.length, waste: window.waste.length,
                    topFaceUp: window.waste[window.waste.length - 1].faceUp };
            });
            expect(r.ok).toBe(true);
            expect(r.stock).toBe(23);
            expect(r.waste).toBe(1);
            expect(r.topFaceUp).toBe(true);
        });

        test('an empty stock recycles the waste', async ({ page }) => {
            await page.evaluate(() => window.newGame(2));
            const r = await page.evaluate(() => {
                for (let i = 0; i < 24; i++) window.drawFromStock(); // empty the stock
                const emptied = { stock: window.stock.length, waste: window.waste.length };
                window.drawFromStock(); // recycle
                return { emptied, stock: window.stock.length, waste: window.waste.length };
            });
            expect(r.emptied).toEqual({ stock: 0, waste: 24 });
            expect(r.stock).toBe(24);
            expect(r.waste).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Foundation moves
    // -----------------------------------------------------------------------
    test.describe('foundations', () => {
        test('an Ace can go to an empty foundation, other ranks cannot', async ({ page }) => {
            const r = await page.evaluate(() => ({
                ace: window.canMoveToFoundation({ rank: 1, suit: 'S' }, 0),
                two: window.canMoveToFoundation({ rank: 2, suit: 'S' }, 0),
            }));
            expect(r).toEqual({ ace: true, two: false });
        });

        test('moving the waste Ace onto an empty foundation works', async ({ page }) => {
            await load(page, { waste: [C(1, 'S')] });
            const ok = await page.evaluate(() => window.moveWasteToFoundation(0));
            const s = await page.evaluate(() => ({
                f: window.foundations[0].map((c) => c.rank + c.suit),
                waste: window.waste.length,
            }));
            expect(ok).toBe(true);
            expect(s.f).toEqual(['1S']);
            expect(s.waste).toBe(0);
        });

        test('a same-suit next rank builds on a foundation', async ({ page }) => {
            await load(page, { waste: [C(2, 'S')], foundations: [[C(1, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToFoundation(0));
            expect(ok).toBe(true);
        });

        test('a wrong-suit card is rejected by a foundation', async ({ page }) => {
            await load(page, { waste: [C(2, 'H')], foundations: [[C(1, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToFoundation(0));
            expect(ok).toBe(false);
            const waste = await page.evaluate(() => window.waste.length);
            expect(waste).toBe(1); // unchanged
        });

        test('a non-sequential rank is rejected by a foundation', async ({ page }) => {
            await load(page, { waste: [C(3, 'S')], foundations: [[C(1, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToFoundation(0));
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Tableau moves
    // -----------------------------------------------------------------------
    test.describe('tableau', () => {
        test('a King goes to an empty column, a Queen does not', async ({ page }) => {
            await load(page, { tableau: [[], []] });
            const r = await page.evaluate(() => ({
                king: window.canMoveToTableau({ rank: 13, suit: 'S' }, 0),
                queen: window.canMoveToTableau({ rank: 12, suit: 'S' }, 0),
            }));
            expect(r).toEqual({ king: true, queen: false });
        });

        test('a red Queen stacks on a black King', async ({ page }) => {
            await load(page, { waste: [C(12, 'H')], tableau: [[C(13, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToTableau(0));
            const top = await page.evaluate(() => {
                const col = window.tableau[0];
                return col[col.length - 1].rank + col[col.length - 1].suit;
            });
            expect(ok).toBe(true);
            expect(top).toBe('12H');
        });

        test('a same-colour stack is rejected', async ({ page }) => {
            await load(page, { waste: [C(12, 'S')], tableau: [[C(13, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToTableau(0));
            expect(ok).toBe(false);
        });

        test('a wrong-rank stack is rejected', async ({ page }) => {
            await load(page, { waste: [C(11, 'H')], tableau: [[C(13, 'S')]] });
            const ok = await page.evaluate(() => window.moveWasteToTableau(0));
            expect(ok).toBe(false);
        });

        test('a valid multi-card run moves between columns', async ({ page }) => {
            // col1 holds a valid run 9S(black),8H(red); drop it onto 10H(red) at col0.
            await load(page, {
                tableau: [[C(10, 'H')], [C(9, 'S'), C(8, 'H')]],
            });
            const ok = await page.evaluate(() => window.moveTableauToTableau(1, 2, 0));
            const s = await page.evaluate(() => ({
                col0: window.tableau[0].map((c) => c.rank + c.suit),
                col1: window.tableau[1].length,
            }));
            expect(ok).toBe(true);
            expect(s.col0).toEqual(['10H', '9S', '8H']);
            expect(s.col1).toBe(0);
        });

        test('an invalid run (not alternating) cannot be moved', async ({ page }) => {
            await load(page, {
                tableau: [[C(10, 'H')], [C(9, 'S'), C(8, 'S')]],
            });
            const ok = await page.evaluate(() => window.moveTableauToTableau(1, 2, 0));
            expect(ok).toBe(false);
        });

        test('exposing a face-down card flips it face up', async ({ page }) => {
            await load(page, {
                tableau: [[C(10, 'H')], [C(5, 'D', false), C(9, 'S', true)]],
            });
            await page.evaluate(() => window.moveTableauToTableau(1, 1, 0)); // move 9S onto 10H
            const s = await page.evaluate(() => ({
                col1len: window.tableau[1].length,
                topFaceUp: window.tableau[1][window.tableau[1].length - 1].faceUp,
                topCard: window.tableau[1][0].rank + window.tableau[1][0].suit,
            }));
            expect(s.col1len).toBe(1);
            expect(s.topFaceUp).toBe(true);
            expect(s.topCard).toBe('5D');
        });

        test('the top tableau card can go to a foundation', async ({ page }) => {
            await load(page, { tableau: [[C(1, 'S')]], foundations: [[]] });
            const ok = await page.evaluate(() => window.moveTableauToFoundation(0, 0));
            const s = await page.evaluate(() => ({
                f: window.foundations[0].map((c) => c.rank + c.suit),
                col0: window.tableau[0].length,
            }));
            expect(ok).toBe(true);
            expect(s.f).toEqual(['1S']);
            expect(s.col0).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Foundation back to tableau
    // -----------------------------------------------------------------------
    test('a card can be pulled from a foundation back to the tableau', async ({ page }) => {
        // Foundation top is 3H (red); drop onto black 4S in the tableau.
        await load(page, {
            foundations: [[C(1, 'H'), C(2, 'H'), C(3, 'H')]],
            tableau: [[C(4, 'S')]],
        });
        const ok = await page.evaluate(() => window.moveFoundationToTableau(0, 0));
        const s = await page.evaluate(() => ({
            f: window.foundations[0].length,
            col0: window.tableau[0].map((c) => c.rank + c.suit),
        }));
        expect(ok).toBe(true);
        expect(s.f).toBe(2);
        expect(s.col0).toEqual(['4S', '3H']);
    });

    // -----------------------------------------------------------------------
    // Move counting
    // -----------------------------------------------------------------------
    test('a legal move increments the move counter, a rejected one does not', async ({ page }) => {
        await load(page, { waste: [C(1, 'S')], foundations: [[]] });
        const before = await page.evaluate(() => window.moves);
        await page.evaluate(() => window.moveWasteToFoundation(0)); // legal
        const afterLegal = await page.evaluate(() => window.moves);
        await load(page, { waste: [C(3, 'S')], foundations: [[C(1, 'S')]] });
        const beforeBad = await page.evaluate(() => window.moves);
        await page.evaluate(() => window.moveWasteToFoundation(0)); // rejected
        const afterBad = await page.evaluate(() => window.moves);
        expect(afterLegal).toBe(before + 1);
        expect(afterBad).toBe(beforeBad);
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        // Three suits complete; spades built to Queen; the King waits on the waste.
        const nearWinBoard = () => {
            const spadesToQueen = [];
            for (let r = 1; r <= 12; r++) spadesToQueen.push(C(r, 'S'));
            return {
                waste: [C(13, 'S')],
                foundations: [fullSuit('H'), fullSuit('D'), fullSuit('C'), spadesToQueen],
            };
        };

        test('completing every foundation wins the game', async ({ page }) => {
            await load(page, nearWinBoard());
            const wonBefore = await page.evaluate(() => window.isWon());
            const ok = await page.evaluate(() => window.moveWasteToFoundation(3));
            const s = await page.evaluate(() => ({ won: window.isWon(), state: window.state }));
            expect(wonBefore).toBe(false);
            expect(ok).toBe(true);
            expect(s.won).toBe(true);
            expect(s.state).toBe('won');
        });

        test('the win overlay is shown after winning', async ({ page }) => {
            await load(page, nearWinBoard());
            await page.evaluate(() => window.moveWasteToFoundation(3));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|congrat|solved|you/i);
        });
    });

    // -----------------------------------------------------------------------
    // New Game control
    // -----------------------------------------------------------------------
    test.describe('new game control', () => {
        test('the New Game button deals and hides the overlay', async ({ page }) => {
            await page.locator('#btn-new').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => ({
                state: window.state,
                total: window.stock.length + window.tableau.reduce((n, c) => n + c.length, 0),
            }));
            expect(s.state).toBe('playing');
            expect(s.total).toBeGreaterThan(0);
        });
    });
});
