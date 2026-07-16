const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Card helpers mirrored in the tests: rank 2..14 (11=J,12=Q,13=K,14=A),
// suit 0..3 (0=♠,1=♥,2=♦,3=♣).
const C = (rank, suit) => ({ rank, suit });

test.describe('Video Poker', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Video Poker', async ({ page }) => {
            await expect(page).toHaveTitle('Video Poker');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to deal', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Deal');
        });

        test('credits start at 100', async ({ page }) => {
            await expect(page.locator('#credits')).toHaveText('100');
        });

        test('bet starts at 1', async ({ page }) => {
            await expect(page.locator('#bet')).toHaveText('1');
        });

        test('best starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state starts as idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('canvas has the designed size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', String(await page.evaluate(() => CANVAS_W)));
            await expect(canvas).toHaveAttribute('height', String(await page.evaluate(() => CANVAS_H)));
        });

        test('no cards in hand initially', async ({ page }) => {
            expect(await page.evaluate(() => hand.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Hand evaluation — the pure, deterministic core
    // -----------------------------------------------------------------------
    test.describe('hand evaluation', () => {
        const cases = [
            ['royal flush', [C(10,0),C(11,0),C(12,0),C(13,0),C(14,0)], 'Royal Flush', 250],
            ['straight flush', [C(5,1),C(6,1),C(7,1),C(8,1),C(9,1)], 'Straight Flush', 50],
            ['four of a kind', [C(7,0),C(7,1),C(7,2),C(7,3),C(2,0)], 'Four of a Kind', 25],
            ['full house', [C(13,0),C(13,1),C(13,2),C(4,0),C(4,1)], 'Full House', 9],
            ['flush', [C(2,3),C(5,3),C(7,3),C(9,3),C(11,3)], 'Flush', 6],
            ['straight (mixed suits)', [C(5,0),C(6,1),C(7,2),C(8,3),C(9,0)], 'Straight', 4],
            ['wheel straight A-2-3-4-5', [C(14,0),C(2,1),C(3,2),C(4,3),C(5,0)], 'Straight', 4],
            ['broadway straight 10-J-Q-K-A', [C(10,0),C(11,1),C(12,2),C(13,3),C(14,0)], 'Straight', 4],
            ['three of a kind', [C(9,0),C(9,1),C(9,2),C(2,3),C(5,0)], 'Three of a Kind', 3],
            ['two pair', [C(14,0),C(14,1),C(3,2),C(3,3),C(7,0)], 'Two Pair', 2],
            ['jacks or better (pair of jacks)', [C(11,0),C(11,1),C(2,2),C(5,3),C(9,0)], 'Jacks or Better', 1],
            ['jacks or better (pair of aces)', [C(14,0),C(14,1),C(2,2),C(5,3),C(9,0)], 'Jacks or Better', 1],
            ['low pair pays nothing', [C(5,0),C(5,1),C(2,2),C(9,3),C(11,0)], 'No Win', 0],
            ['busted hand pays nothing', [C(2,0),C(5,1),C(7,2),C(9,3),C(11,0)], 'No Win', 0],
        ];

        for (const [label, cards, name, payout] of cases) {
            test(`${label} → ${name}`, async ({ page }) => {
                const res = await page.evaluate((c) => evaluateHand(c), cards);
                expect(res.name).toBe(name);
                expect(res.payout).toBe(payout);
            });
        }
    });

    // -----------------------------------------------------------------------
    // Dealing
    // -----------------------------------------------------------------------
    test.describe('dealing', () => {
        test('Space deals five cards and enters holding state', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => hand.length)).toBe(5);
            expect(await page.evaluate(() => state)).toBe('holding');
        });

        test('dealing deducts the bet from credits', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#credits')).toHaveText('99');
        });

        test('dealing dismisses the overlay', async ({ page }) => {
            await page.keyboard.press(' ');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Deal button deals a hand', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('holding');
        });
    });

    // -----------------------------------------------------------------------
    // Holding cards
    // -----------------------------------------------------------------------
    test.describe('holding cards', () => {
        test('pressing 1 holds the first card', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('1');
            expect(await page.evaluate(() => held[0])).toBe(true);
        });

        test('pressing 1 twice toggles the hold back off', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.keyboard.press('1');
            await page.keyboard.press('1');
            expect(await page.evaluate(() => held[0])).toBe(false);
        });

        test('holds are all off when a hand is dealt', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => held.every((h) => h === false))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing
    // -----------------------------------------------------------------------
    test.describe('drawing', () => {
        test('a winning hand pays out and enters result state', async ({ page }) => {
            await page.keyboard.press(' ');   // credits -> 99
            const credits = await page.evaluate(() => {
                hand = [{rank:7,suit:0},{rank:7,suit:1},{rank:7,suit:2},{rank:7,suit:3},{rank:2,suit:0}];
                held = [true, true, true, true, true];
                draw();
                return credits;
            });
            expect(credits).toBe(99 + 25);   // four of a kind pays 25 at bet 1
            expect(await page.evaluate(() => state)).toBe('result');
        });

        test('the result text names the winning hand', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.evaluate(() => {
                hand = [{rank:13,suit:0},{rank:13,suit:1},{rank:13,suit:2},{rank:4,suit:0},{rank:4,suit:1}];
                held = [true, true, true, true, true];
                draw();
            });
            await expect(page.locator('#result')).toContainText('Full House');
        });

        test('un-held cards are replaced from the deck', async ({ page }) => {
            await page.keyboard.press(' ');
            const replaced = await page.evaluate(() => {
                hand = [{rank:2,suit:0},{rank:5,suit:1},{rank:7,suit:2},{rank:9,suit:3},{rank:11,suit:0}];
                held = [true, false, false, false, false];
                deck = [{rank:3,suit:0},{rank:4,suit:0},{rank:6,suit:0},{rank:8,suit:0}];
                draw();
                // held card unchanged, the other four taken from the deck top
                return {
                    kept: hand[0].rank === 2 && hand[0].suit === 0,
                    others: hand.slice(1).every((c) => c.suit === 0),
                };
            });
            expect(replaced.kept).toBe(true);
            expect(replaced.others).toBe(true);
        });

        test('a losing hand pays nothing', async ({ page }) => {
            await page.keyboard.press(' ');   // credits -> 99
            const credits = await page.evaluate(() => {
                hand = [{rank:2,suit:0},{rank:5,suit:1},{rank:7,suit:2},{rank:9,suit:3},{rank:11,suit:0}];
                held = [true, true, true, true, true];
                draw();
                return credits;
            });
            expect(credits).toBe(99);
        });
    });

    // -----------------------------------------------------------------------
    // Bet
    // -----------------------------------------------------------------------
    test.describe('bet', () => {
        test('B raises the bet', async ({ page }) => {
            await page.keyboard.press('b');
            await expect(page.locator('#bet')).toHaveText('2');
        });

        test('bet cycles back to 1 after the maximum', async ({ page }) => {
            for (let i = 0; i < 5; i++) await page.keyboard.press('b');
            await expect(page.locator('#bet')).toHaveText('1');
        });

        test('a bigger bet multiplies the payout', async ({ page }) => {
            await page.evaluate(() => { bet = 5; });
            await page.keyboard.press(' ');   // deal, credits -> 95
            const credits = await page.evaluate(() => {
                hand = [{rank:7,suit:0},{rank:7,suit:1},{rank:7,suit:2},{rank:7,suit:3},{rank:2,suit:0}];
                held = [true, true, true, true, true];
                draw();
                return credits;
            });
            expect(credits).toBe(95 + 25 * 5);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best updates after a winning draw', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.evaluate(() => {
                hand = [{rank:7,suit:0},{rank:7,suit:1},{rank:7,suit:2},{rank:7,suit:3},{rank:2,suit:0}];
                held = [true, true, true, true, true];
                draw();
            });
            await expect(page.locator('#best')).toHaveText('124');   // 99 + 25
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.keyboard.press(' ');
            await page.evaluate(() => {
                hand = [{rank:7,suit:0},{rank:7,suit:1},{rank:7,suit:2},{rank:7,suit:3},{rank:2,suit:0}];
                held = [true, true, true, true, true];
                draw();
            });
            const stored = await page.evaluate(() => localStorage.getItem('videopoker-best'));
            expect(parseInt(stored)).toBe(124);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('dealing with too few credits ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                credits = 0;
                deal();
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over overlay is shown', async ({ page }) => {
            await page.evaluate(() => { credits = 0; deal(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.evaluate(() => { credits = 0; deal(); });
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('starting again resets credits to 100 and deals', async ({ page }) => {
            await page.evaluate(() => { credits = 0; deal(); });
            await page.keyboard.press(' ');
            await expect(page.locator('#credits')).toHaveText('99');   // 100 - bet after the fresh deal
            expect(await page.evaluate(() => state)).toBe('holding');
        });
    });
});
