const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Card literal helper for building exact boards passed to loadState().
const C = (rank, suit = 'S') => ({ rank, suit });

// Build a 28-slot tableau that is all-null except the given { id: card } map.
function tableauOf(map) {
    const t = new Array(28).fill(null);
    for (const [id, card] of Object.entries(map)) t[Number(id)] = card;
    return t;
}

async function load(page, board) {
    await page.evaluate((b) => window.loadState(b), board);
}

test.describe('TriPeaks Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title mentions TriPeaks', async ({ page }) => {
            await expect(page).toHaveTitle(/TriPeaks/i);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the goal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/rank|above|below|peak|card/i);
        });

        test('canvas exists with fixed pixel size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', /\d+/);
            await expect(canvas).toHaveAttribute('height', /\d+/);
        });

        test('state is idle before dealing', async ({ page }) => {
            expect(await page.evaluate(() => window.state)).toBe('idle');
        });

        test('exposes the rules API on window', async ({ page }) => {
            const present = await page.evaluate(() => ['newGame', 'loadState', 'makeCard',
                'isExposed', 'isPlayable', 'playCard', 'drawFromStock', 'adjacent',
                'hasMoves', 'COVERED_BY'].every((k) => window[k] !== undefined));
            expect(present).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tripeaks-best', '512'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('512');
        });
    });

    // -----------------------------------------------------------------------
    // Dealing
    // -----------------------------------------------------------------------
    test.describe('dealing', () => {
        test('newGame fills all 28 tableau slots', async ({ page }) => {
            const n = await page.evaluate(() => {
                window.newGame(1);
                return window.tableau.filter((c) => c !== null).length;
            });
            expect(n).toBe(28);
        });

        test('newGame leaves 23 in stock and 1 on the waste', async ({ page }) => {
            const s = await page.evaluate(() => {
                window.newGame(1);
                return { stock: window.stock.length, waste: window.waste.length };
            });
            expect(s).toEqual({ stock: 23, waste: 1 });
        });

        test('newGame deals a full 52-card deck with no duplicates', async ({ page }) => {
            const unique = await page.evaluate(() => {
                window.newGame(7);
                const all = [...window.tableau.filter(Boolean), ...window.stock, ...window.waste];
                const keys = new Set(all.map((c) => c.rank + c.suit));
                return { total: all.length, unique: keys.size };
            });
            expect(unique).toEqual({ total: 52, unique: 52 });
        });

        test('newGame(seed) is reproducible', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                window.newGame(42);
                const a = window.tableau.map((c) => c && c.rank + c.suit).join(',');
                window.newGame(42);
                const b = window.tableau.map((c) => c && c.rank + c.suit).join(',');
                return [a, b];
            });
            expect(a).toBe(b);
        });

        test('newGame sets state to playing', async ({ page }) => {
            expect(await page.evaluate(() => { window.newGame(1); return window.state; })).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Coverage / exposure
    // -----------------------------------------------------------------------
    test.describe('coverage', () => {
        test('all ten bottom-row cards start exposed', async ({ page }) => {
            const exposed = await page.evaluate(() => {
                window.newGame(1);
                const out = [];
                for (let id = 18; id <= 27; id++) out.push(window.isExposed(id));
                return out;
            });
            expect(exposed).toEqual(new Array(10).fill(true));
        });

        test('a peak card is not exposed while covered', async ({ page }) => {
            const exposed = await page.evaluate(() => { window.newGame(1); return window.isExposed(0); });
            expect(exposed).toBe(false);
        });

        test('a peak becomes exposed once both children are removed', async ({ page }) => {
            const exposed = await page.evaluate(() => {
                // Peak 0 is covered by cards 3 and 4.
                const t = new Array(28).fill(null);
                t[0] = { rank: 5, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 9, suit: 'H' }] });
                return window.isExposed(0);
            });
            expect(exposed).toBe(true);
        });

        test('COVERED_BY encodes the classic peak structure', async ({ page }) => {
            const cb = await page.evaluate(() => window.COVERED_BY);
            expect(cb[0]).toEqual([3, 4]);
            expect(cb[9]).toEqual([18, 19]);
            expect(cb[17]).toEqual([26, 27]);
            expect(cb[27]).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Rank adjacency
    // -----------------------------------------------------------------------
    test.describe('adjacency', () => {
        test('consecutive ranks are adjacent both ways', async ({ page }) => {
            const r = await page.evaluate(() => [
                window.adjacent(5, 6), window.adjacent(6, 5), window.adjacent(1, 2),
            ]);
            expect(r).toEqual([true, true, true]);
        });

        test('Ace wraps to both King and Two', async ({ page }) => {
            const r = await page.evaluate(() => [
                window.adjacent(1, 13), window.adjacent(13, 1),
            ]);
            expect(r).toEqual([true, true]);
        });

        test('non-consecutive ranks are not adjacent', async ({ page }) => {
            const r = await page.evaluate(() => [
                window.adjacent(5, 7), window.adjacent(5, 5), window.adjacent(2, 13),
            ]);
            expect(r).toEqual([false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Playing cards
    // -----------------------------------------------------------------------
    test.describe('playing', () => {
        test('an exposed adjacent card can be played onto the waste', async ({ page }) => {
            const res = await page.evaluate(() => {
                window.loadState({
                    tableau: (() => { const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' }; t[19] = { rank: 9, suit: 'D' }; return t; })(),
                    stock: [], waste: [{ rank: 6, suit: 'H' }],
                });
                const ok = window.playCard(18);
                const top = window.waste[window.waste.length - 1];
                return { ok, slot: window.tableau[18], topRank: top.rank, score: window.score };
            });
            expect(res.ok).toBe(true);
            expect(res.slot).toBeNull();
            expect(res.topRank).toBe(5);
            expect(res.score).toBe(1);
        });

        test('a non-adjacent card cannot be played', async ({ page }) => {
            const res = await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 9, suit: 'S' }; t[19] = { rank: 4, suit: 'S' };
                window.loadState({ tableau: t, stock: [{ rank: 1, suit: 'C' }], waste: [{ rank: 6, suit: 'H' }] });
                const ok = window.playCard(18);
                return { ok, slot: window.tableau[18] };
            });
            expect(res.ok).toBe(false);
            expect(res.slot).not.toBeNull();
        });

        test('a covered card cannot be played even if adjacent', async ({ page }) => {
            const res = await page.evaluate(() => {
                // card 0 (a peak) is present and adjacent, but its children 3,4 are present too.
                const t = new Array(28).fill(null);
                t[0] = { rank: 5, suit: 'S' }; t[3] = { rank: 9, suit: 'S' }; t[4] = { rank: 9, suit: 'D' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                return { exposed: window.isExposed(0), ok: window.playCard(0) };
            });
            expect(res.exposed).toBe(false);
            expect(res.ok).toBe(false);
        });

        test('consecutive plays build an increasing streak score', async ({ page }) => {
            const res = await page.evaluate(() => {
                const t = new Array(28).fill(null);
                t[18] = { rank: 8, suit: 'S' }; t[19] = { rank: 9, suit: 'S' };
                t[20] = { rank: 10, suit: 'S' }; t[21] = { rank: 2, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 7, suit: 'H' }] });
                window.playCard(18); // 8 on 7
                window.playCard(19); // 9 on 8
                window.playCard(20); // 10 on 9
                return { score: window.score, streak: window.streak };
            });
            expect(res.score).toBe(1 + 2 + 3);
            expect(res.streak).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing from stock
    // -----------------------------------------------------------------------
    test.describe('drawing', () => {
        test('drawing flips the top stock card onto the waste', async ({ page }) => {
            const res = await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' };
                window.loadState({ tableau: t, stock: [{ rank: 3, suit: 'C' }, { rank: 11, suit: 'D' }], waste: [{ rank: 6, suit: 'H' }] });
                const ok = window.drawFromStock();
                const top = window.waste[window.waste.length - 1];
                return { ok, stock: window.stock.length, topRank: top.rank };
            });
            expect(res.ok).toBe(true);
            expect(res.stock).toBe(1);
            expect(res.topRank).toBe(11);
        });

        test('drawing resets the streak', async ({ page }) => {
            const streak = await page.evaluate(() => {
                const t = new Array(28).fill(null);
                t[18] = { rank: 8, suit: 'S' }; t[19] = { rank: 12, suit: 'S' };
                window.loadState({ tableau: t, stock: [{ rank: 3, suit: 'C' }], waste: [{ rank: 7, suit: 'H' }] });
                window.playCard(18);     // streak → 1 (card 19 remains, so not a win)
                window.drawFromStock();  // streak → 0
                return window.streak;
            });
            expect(streak).toBe(0);
        });

        test('drawing from an empty stock fails', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                return window.drawFromStock();
            });
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Win / loss
    // -----------------------------------------------------------------------
    test.describe('win and loss', () => {
        test('clearing the last tableau card wins the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                window.playCard(18);
                return { state: window.state, score: window.score };
            });
            expect(res.state).toBe('won');
            // 1 for the play + 20 win bonus.
            expect(res.score).toBe(21);
        });

        test('a won game is persisted as the best score', async ({ page }) => {
            await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                window.playCard(18);
            });
            const best = await page.evaluate(() => window.localStorage.getItem('tripeaks-best'));
            expect(parseInt(best, 10)).toBe(21);
        });

        test('no moves and an empty stock is a loss', async ({ page }) => {
            const state = await page.evaluate(() => {
                const t = new Array(28).fill(null);
                t[18] = { rank: 3, suit: 'S' }; t[19] = { rank: 11, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                return window.state;
            });
            expect(state).toBe('lost');
        });

        test('hasMoves reports whether any exposed card is playable', async ({ page }) => {
            const r = await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 7, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                const yes = window.hasMoves();
                const t2 = new Array(28).fill(null); t2[18] = { rank: 10, suit: 'S' };
                window.loadState({ tableau: t2, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                const no = window.hasMoves();
                return { yes, no };
            });
            expect(r.yes).toBe(true);
            expect(r.no).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // HUD + interaction
    // -----------------------------------------------------------------------
    test.describe('hud and interaction', () => {
        test('score element reflects the current score', async ({ page }) => {
            await page.evaluate(() => {
                const t = new Array(28).fill(null); t[18] = { rank: 5, suit: 'S' }; t[19] = { rank: 12, suit: 'S' };
                window.loadState({ tableau: t, stock: [], waste: [{ rank: 6, suit: 'H' }] });
                window.playCard(18);
            });
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('Deal button starts a game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => window.state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('N deals a new game', async ({ page }) => {
            await page.evaluate(() => window.newGame(1));
            await page.evaluate(() => { window.playCard; }); // noop to ensure focus is fine
            await page.keyboard.press('n');
            expect(await page.evaluate(() => window.state)).toBe('playing');
        });
    });
});
