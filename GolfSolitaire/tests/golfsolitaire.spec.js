const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// card: { rank: 1..13 (1=A, 11=J, 12=Q, 13=K), suit: 0..3 }
test.describe('Golf Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try { localStorage.removeItem('golf-solitaire-best'); } catch (e) {}
        });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Golf Solitaire', async ({ page }) => {
            await expect(page).toHaveTitle('Golf Solitaire');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay explains the game (foundation / rank)', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/one rank/i);
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 720×520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '520');
        });
    });

    // -----------------------------------------------------------------------
    // Dealing
    // -----------------------------------------------------------------------
    test.describe('the deal', () => {
        test('starting deals seven columns of five', async ({ page }) => {
            await page.locator('#btn-start').click();
            const lens = await page.evaluate(() => columns.map(c => c.length));
            expect(lens).toEqual([5, 5, 5, 5, 5, 5, 5]);
        });

        test('the stock holds sixteen cards after the opening flip', async ({ page }) => {
            await page.locator('#btn-start').click();
            const n = await page.evaluate(() => stock.length);
            expect(n).toBe(16);
        });

        test('the foundation has a card after the deal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const ok = await page.evaluate(() => foundation != null);
            expect(ok).toBe(true);
        });

        test('all 52 cards are accounted for and unique', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                const all = [...columns.flat(), ...stock, foundation];
                const keys = all.map(c => c.rank + '-' + c.suit);
                return { total: all.length, unique: new Set(keys).size };
            });
            expect(r.total).toBe(52);
            expect(r.unique).toBe(52);
        });

        test('state is playing after the deal', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // The play rule (pure)
    // -----------------------------------------------------------------------
    test.describe('canPlay rule', () => {
        async function can(page, cr, fr) {
            return page.evaluate(([cr, fr]) => canPlay({ rank: cr, suit: 0 }, { rank: fr, suit: 1 }), [cr, fr]);
        }

        test('one lower is playable', async ({ page }) => {
            expect(await can(page, 5, 6)).toBe(true);
        });

        test('one higher is playable', async ({ page }) => {
            expect(await can(page, 7, 6)).toBe(true);
        });

        test('same rank is not playable', async ({ page }) => {
            expect(await can(page, 6, 6)).toBe(false);
        });

        test('two apart is not playable', async ({ page }) => {
            expect(await can(page, 4, 6)).toBe(false);
        });

        test('Ace (1) plays on a 2', async ({ page }) => {
            expect(await can(page, 1, 2)).toBe(true);
        });

        test('King (13) plays on a Queen (12)', async ({ page }) => {
            expect(await can(page, 13, 12)).toBe(true);
        });

        test('no wrap-around: King (13) does not play on an Ace (1)', async ({ page }) => {
            expect(await can(page, 13, 1)).toBe(false);
        });

        test('nothing is playable on an empty foundation', async ({ page }) => {
            const r = await page.evaluate(() => canPlay({ rank: 5, suit: 0 }, null));
            expect(r).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Playing columns
    // -----------------------------------------------------------------------
    test.describe('playing a column', () => {
        test('a legal play moves the exposed card to the foundation', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns[0] = [{ rank: 9, suit: 1 }, { rank: 5, suit: 2 }]; // exposed 5
                const before = columns[0].length;
                playColumn(0);
                return { before, after: columns[0].length, f: foundation };
            });
            expect(r.after).toBe(r.before - 1);
            expect(r.f.rank).toBe(5);
        });

        test('a legal play increases the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns[0] = [{ rank: 5, suit: 2 }];
                score = 0;
                playColumn(0);
                return score;
            });
            expect(r).toBe(1);
        });

        test('an illegal play does nothing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns[0] = [{ rank: 9, suit: 2 }]; // 9 is not adjacent to 6
                score = 0;
                playColumn(0);
                return { len: columns[0].length, f: foundation.rank, score };
            });
            expect(r.len).toBe(1);
            expect(r.f).toBe(6);
            expect(r.score).toBe(0);
        });

        test('playing an empty column does nothing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns[3] = [];
                score = 0;
                playColumn(3);
                return { f: foundation.rank, score };
            });
            expect(r.f).toBe(6);
            expect(r.score).toBe(0);
        });

        test('consecutive plays chain up and down in rank', async ({ page }) => {
            await page.locator('#btn-start').click();
            const f = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [
                    [{ rank: 7, suit: 0 }], // 7 on 6
                    [{ rank: 8, suit: 1 }], // 8 on 7
                    [{ rank: 7, suit: 2 }], // 7 on 8
                    [], [], [], [],
                ];
                stock = [];
                playColumn(0);
                playColumn(1);
                playColumn(2);
                return foundation.rank;
            });
            expect(f).toBe(7);
        });
    });

    // -----------------------------------------------------------------------
    // The stock
    // -----------------------------------------------------------------------
    test.describe('the stock', () => {
        test('drawing flips the top stock card onto the foundation', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                stock = [{ rank: 2, suit: 0 }, { rank: 10, suit: 3 }]; // top = last
                foundation = { rank: 6, suit: 0 };
                drawStock();
                return { f: foundation.rank, n: stock.length };
            });
            expect(r.f).toBe(10);
            expect(r.n).toBe(1);
        });

        test('drawing does not change the score', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                stock = [{ rank: 10, suit: 3 }];
                foundation = { rank: 6, suit: 0 };
                score = 4;
                drawStock();
                return score;
            });
            expect(r).toBe(4);
        });

        test('drawing from an empty stock does nothing', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                stock = [];
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 13, suit: 0 }], [], [], [], [], [], []]; // 13 not playable on 6 → no move
                drawStock();
                return { f: foundation.rank, n: stock.length };
            });
            expect(r.f).toBe(6);
            expect(r.n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Winning & losing
    // -----------------------------------------------------------------------
    test.describe('end of hole', () => {
        test('clearing the last tableau card wins the hole', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 7, suit: 0 }], [], [], [], [], [], []];
                stock = [];
                playColumn(0); // clears the only card
                return state;
            });
            expect(s).toBe('won');
        });

        test('winning shows the overlay with a win message', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 7, suit: 0 }], [], [], [], [], [], []];
                stock = [];
                playColumn(0);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/You Win|Cleared/i);
        });

        test('an empty stock with no moves loses the hole', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                // every exposed card is 9 (not adjacent to 6), stock empty → stuck
                columns = [[{ rank: 9, suit: 0 }], [{ rank: 9, suit: 1 }], [], [], [], [], []];
                stock = [];
                checkEnd();
                return state;
            });
            expect(s).toBe('lost');
        });

        test('a still-playable position does not end the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 5, suit: 0 }], [], [], [], [], [], []]; // 5 plays on 6
                stock = [];
                checkEnd();
                return state;
            });
            expect(s).toBe('playing');
        });

        test('a non-empty stock never counts as stuck', async ({ page }) => {
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 9, suit: 0 }], [], [], [], [], [], []];
                stock = [{ rank: 2, suit: 0 }]; // can still flip
                checkEnd();
                return state;
            });
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Best score & restart
    // -----------------------------------------------------------------------
    test.describe('best and restart', () => {
        test('best rises to the score when the hole ends', async ({ page }) => {
            await page.locator('#btn-start').click();
            const best = await page.evaluate(() => {
                best = 0;
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 7, suit: 0 }], [], [], [], [], [], []];
                stock = [];
                score = 34;
                playColumn(0); // score → 35, win
                return best;
            });
            expect(best).toBeGreaterThanOrEqual(35);
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                best = 0;
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 7, suit: 0 }], [], [], [], [], [], []];
                stock = [];
                score = 20;
                playColumn(0);
            });
            const stored = await page.evaluate(() => parseInt(localStorage.getItem('golf-solitaire-best'), 10));
            expect(stored).toBeGreaterThanOrEqual(21);
        });

        test('the overlay button starts a fresh deal after a loss', async ({ page }) => {
            await page.locator('#btn-start').click();
            // drive a real loss so the end-of-hole overlay appears
            await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns = [[{ rank: 9, suit: 0 }], [], [], [], [], [], []];
                stock = [];
                score = 12;
                checkEnd();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-start').click();
            await expect(page.locator('#score')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });

        test('N starts a fresh deal at any time', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => { score = 12; });
            await page.keyboard.press('n');
            await expect(page.locator('#score')).toHaveText('0');
            const s = await page.evaluate(() => state);
            expect(s).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // DOM wiring
    // -----------------------------------------------------------------------
    test.describe('DOM wiring', () => {
        test('the score display updates after a play', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.evaluate(() => {
                foundation = { rank: 6, suit: 0 };
                columns[0] = [{ rank: 5, suit: 2 }];
                score = 0;
                playColumn(0);
            });
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('Space flips the stock', async ({ page }) => {
            await page.locator('#btn-start').click();
            const r = await page.evaluate(() => {
                stock = [{ rank: 2, suit: 0 }, { rank: 11, suit: 3 }];
                foundation = { rank: 6, suit: 0 };
                return { before: stock.length };
            });
            await page.keyboard.press(' ');
            const after = await page.evaluate(() => ({ n: stock.length, f: foundation.rank }));
            expect(after.n).toBe(r.before - 1);
            expect(after.f).toBe(11);
        });
    });
});
