const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Give a specific card a known value (rank) so tests can craft deterministic
// pairs without depending on the shuffled deal.
async function setPyramidValue(page, r, c, value) {
    await page.evaluate(
        ([r, c, v]) => {
            const card = pyramid[r][c];
            card.value = v;
            card.rank = v;
        },
        [r, c, value]
    );
}

test.describe('Pyramid Solitaire', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial deal
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pyramid Solitaire', async ({ page }) => {
            await expect(page).toHaveTitle('Pyramid Solitaire');
        });

        test('canvas is 760x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('state is playing after load', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('pyramid has 7 rows shaped 1..7', async ({ page }) => {
            const shape = await page.evaluate(() => pyramid.map((row) => row.length));
            expect(shape).toEqual([1, 2, 3, 4, 5, 6, 7]);
        });

        test('pyramid holds 28 cards, stock 24, waste 0', async ({ page }) => {
            const counts = await page.evaluate(() => ({
                pyramid: pyramid.flat().length,
                stock: stock.length,
                waste: waste.length,
            }));
            expect(counts).toEqual({ pyramid: 28, stock: 24, waste: 0 });
        });

        test('all 52 cards are unique', async ({ page }) => {
            const unique = await page.evaluate(() => {
                const ids = [...pyramid.flat(), ...stock, ...waste].map((c) => c.id);
                return new Set(ids).size;
            });
            expect(unique).toBe(52);
        });

        test('score 0, remaining 28', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#remaining')).toHaveText('28');
            expect(await page.evaluate(() => remaining())).toBe(28);
        });

        test('best loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pyramid-best', '321'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('321');
        });

        test('a fixed seed reproduces the same deal', async ({ page }) => {
            const a = await page.evaluate(() => {
                newGame(12345);
                return pyramid.flat().map((c) => c.id);
            });
            const b = await page.evaluate(() => {
                newGame(12345);
                return pyramid.flat().map((c) => c.id);
            });
            expect(a).toEqual(b);
        });
    });

    // -----------------------------------------------------------------------
    // Exposure rules
    // -----------------------------------------------------------------------
    test.describe('exposure', () => {
        test('the whole bottom row is exposed', async ({ page }) => {
            const allExposed = await page.evaluate(() =>
                pyramid[6].every((_, c) => isExposed(6, c))
            );
            expect(allExposed).toBe(true);
        });

        test('the apex is covered at the start', async ({ page }) => {
            expect(await page.evaluate(() => isExposed(0, 0))).toBe(false);
        });

        test('removing both coverers exposes the card beneath', async ({ page }) => {
            const exposed = await page.evaluate(() => {
                const before = isExposed(5, 0);
                pyramid[6][0].removed = true;
                pyramid[6][1].removed = true;
                return { before, after: isExposed(5, 0) };
            });
            expect(exposed.before).toBe(false);
            expect(exposed.after).toBe(true);
        });

        test('a card with only one coverer removed stays covered', async ({ page }) => {
            const stillCovered = await page.evaluate(() => {
                pyramid[6][0].removed = true;
                return isExposed(5, 0);
            });
            expect(stillCovered).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Card values
    // -----------------------------------------------------------------------
    test.describe('card values', () => {
        test('Ace is 1, Jack 11, Queen 12, King 13', async ({ page }) => {
            const vals = await page.evaluate(() => ({
                ace: cardValue({ value: 1 }),
                jack: cardValue({ value: 11 }),
                queen: cardValue({ value: 12 }),
                king: cardValue({ value: 13 }),
            }));
            expect(vals).toEqual({ ace: 1, jack: 11, queen: 12, king: 13 });
        });
    });

    // -----------------------------------------------------------------------
    // Removing pairs
    // -----------------------------------------------------------------------
    test.describe('pairing', () => {
        test('two exposed cards summing to 13 are removed for points', async ({ page }) => {
            await setPyramidValue(page, 6, 0, 6);
            await setPyramidValue(page, 6, 1, 7);
            const res = await page.evaluate(() => {
                clickPyramid(6, 0);
                clickPyramid(6, 1);
                return {
                    a: pyramid[6][0].removed,
                    b: pyramid[6][1].removed,
                    remaining: remaining(),
                    score,
                };
            });
            expect(res.a).toBe(true);
            expect(res.b).toBe(true);
            expect(res.remaining).toBe(26);
            expect(res.score).toBe(10);
        });

        test('score HUD updates after a removal', async ({ page }) => {
            await setPyramidValue(page, 6, 0, 5);
            await setPyramidValue(page, 6, 1, 8);
            await page.evaluate(() => {
                clickPyramid(6, 0);
                clickPyramid(6, 1);
            });
            await expect(page.locator('#score')).toHaveText('10');
            await expect(page.locator('#remaining')).toHaveText('26');
        });

        test('a King is removed on a single click', async ({ page }) => {
            await setPyramidValue(page, 6, 3, 13);
            const res = await page.evaluate(() => {
                clickPyramid(6, 3);
                return { removed: pyramid[6][3].removed, remaining: remaining(), score };
            });
            expect(res.removed).toBe(true);
            expect(res.remaining).toBe(27);
            expect(res.score).toBe(5);
        });

        test('a pair not summing to 13 is not removed', async ({ page }) => {
            await setPyramidValue(page, 6, 0, 5);
            await setPyramidValue(page, 6, 1, 6);
            const res = await page.evaluate(() => {
                clickPyramid(6, 0);
                clickPyramid(6, 1);
                return {
                    a: pyramid[6][0].removed,
                    b: pyramid[6][1].removed,
                    selectedId: selected ? selected.id : null,
                    secondId: pyramid[6][1].id,
                };
            });
            expect(res.a).toBe(false);
            expect(res.b).toBe(false);
            // Selection moved to the second card.
            expect(res.selectedId).toBe(res.secondId);
        });

        test('clicking a selected card again deselects it', async ({ page }) => {
            await setPyramidValue(page, 6, 0, 5);
            const res = await page.evaluate(() => {
                clickPyramid(6, 0);
                const mid = selected ? selected.id : null;
                clickPyramid(6, 0);
                return { mid, after: selected };
            });
            expect(res.mid).not.toBeNull();
            expect(res.after).toBeNull();
        });

        test('a covered card cannot be selected', async ({ page }) => {
            const sel = await page.evaluate(() => {
                clickPyramid(0, 0); // apex, covered
                return selected;
            });
            expect(sel).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Stock & waste
    // -----------------------------------------------------------------------
    test.describe('stock and waste', () => {
        test('clicking the stock deals a card to the waste', async ({ page }) => {
            const res = await page.evaluate(() => {
                clickStock();
                return { stock: stock.length, waste: waste.length };
            });
            expect(res).toEqual({ stock: 23, waste: 1 });
        });

        test('the waste top can pair with an exposed pyramid card', async ({ page }) => {
            const res = await page.evaluate(() => {
                clickStock();
                const top = waste[waste.length - 1];
                top.value = 4;
                pyramid[6][0].value = 9;
                clickWaste();
                clickPyramid(6, 0);
                return { pyramidRemoved: pyramid[6][0].removed, waste: waste.length };
            });
            expect(res.pyramidRemoved).toBe(true);
            expect(res.waste).toBe(0);
        });

        test('emptying then clicking the stock recycles the waste', async ({ page }) => {
            const res = await page.evaluate(() => {
                for (let i = 0; i < 24; i++) clickStock();
                const emptied = { stock: stock.length, waste: waste.length };
                clickStock(); // recycle
                return { emptied, stock: stock.length, waste: waste.length };
            });
            expect(res.emptied).toEqual({ stock: 0, waste: 24 });
            expect(res.stock).toBe(24);
            expect(res.waste).toBe(0);
        });

        test('clicking an empty waste selects nothing', async ({ page }) => {
            const sel = await page.evaluate(() => {
                clickWaste();
                return selected;
            });
            expect(sel).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    test.describe('winning', () => {
        test('clearing the pyramid wins with the completion bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                // Remove every pyramid card except two exposed bottom cards.
                pyramid.flat().forEach((c) => (c.removed = true));
                pyramid[6][0].removed = false;
                pyramid[6][1].removed = false;
                pyramid[6][0].value = 6;
                pyramid[6][1].value = 7;
                score = 0;
                clickPyramid(6, 0);
                clickPyramid(6, 1);
                return { state, remaining: remaining(), score };
            });
            expect(res.remaining).toBe(0);
            expect(res.state).toBe('won');
            // 2 cards (+10) plus the +100 clear bonus.
            expect(res.score).toBe(110);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a win records the best score', async ({ page }) => {
            await page.evaluate(() => {
                pyramid.flat().forEach((c) => (c.removed = true));
                pyramid[6][0].removed = false;
                pyramid[6][1].removed = false;
                pyramid[6][0].value = 6;
                pyramid[6][1].value = 7;
                clickPyramid(6, 0);
                clickPyramid(6, 1);
            });
            const stored = await page.evaluate(() =>
                window.localStorage.getItem('pyramid-best')
            );
            expect(stored).toBe(await page.evaluate(() => String(score)));
            await expect(page.locator('#best')).toHaveText(
                await page.evaluate(() => String(best))
            );
        });
    });

    // -----------------------------------------------------------------------
    // New game
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('N deals a fresh pyramid', async ({ page }) => {
            await page.evaluate(() => {
                clickStock();
                clickStock();
            });
            await page.keyboard.press('n');
            const res = await page.evaluate(() => ({
                state,
                remaining: remaining(),
                stock: stock.length,
                waste: waste.length,
                selected,
            }));
            expect(res.state).toBe('playing');
            expect(res.remaining).toBe(28);
            expect(res.stock).toBe(24);
            expect(res.waste).toBe(0);
            expect(res.selected).toBeNull();
        });

        test('the New Game button deals a fresh pyramid', async ({ page }) => {
            await page.evaluate(() => clickStock());
            await page.locator('#btn-new').click();
            expect(await page.evaluate(() => waste.length)).toBe(0);
            expect(await page.evaluate(() => remaining())).toBe(28);
        });
    });
});
