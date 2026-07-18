const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helper: build a deck (drawn from the END via pop) so that the next cards
// dealt come out in the given order. deal() draws p1, d1, p2, d2.
function C(rank, suit = '♠') { return { rank, suit }; }

test.describe('Blackjack', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => window.localStorage.clear());
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Blackjack', async ({ page }) => {
            await expect(page).toHaveTitle('Blackjack');
        });

        test('balance starts at 100', async ({ page }) => {
            await expect(page.locator('#balance')).toHaveText('100');
        });

        test('bet starts at 10', async ({ page }) => {
            await expect(page.locator('#bet')).toHaveText('10');
        });

        test('best starts at 100', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('100');
        });

        test('state is betting before the first deal', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('betting');
        });

        test('canvas is 640×460', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '460');
        });

        test('hit and stand buttons are disabled while betting', async ({ page }) => {
            await expect(page.locator('#btn-hit')).toBeDisabled();
            await expect(page.locator('#btn-stand')).toBeDisabled();
        });
    });

    // -----------------------------------------------------------------------
    // Hand values (ace handling)
    // -----------------------------------------------------------------------
    test.describe('hand value', () => {
        test('ace + king is 21 (blackjack)', async ({ page }) => {
            const v = await page.evaluate(() => handValue([{ rank: 'A' }, { rank: 'K' }]));
            expect(v).toBe(21);
        });

        test('two aces total 12 (one soft, one hard)', async ({ page }) => {
            const v = await page.evaluate(() => handValue([{ rank: 'A' }, { rank: 'A' }]));
            expect(v).toBe(12);
        });

        test('ace demotes to avoid busting', async ({ page }) => {
            const v = await page.evaluate(() => handValue([{ rank: 'A' }, { rank: '9' }, { rank: '9' }]));
            expect(v).toBe(19);
        });

        test('face cards are worth 10', async ({ page }) => {
            const v = await page.evaluate(() => handValue([{ rank: 'K' }, { rank: 'Q' }, { rank: 'J' }]));
            expect(v).toBe(30);
        });

        test('ace + ace + nine is 21', async ({ page }) => {
            const v = await page.evaluate(() => handValue([{ rank: 'A' }, { rank: 'A' }, { rank: '9' }]));
            expect(v).toBe(21);
        });
    });

    // -----------------------------------------------------------------------
    // Betting
    // -----------------------------------------------------------------------
    test.describe('betting', () => {
        test('bet-up increases the bet', async ({ page }) => {
            await page.locator('#btn-bet-up').click();
            await expect(page.locator('#bet')).toHaveText('15');
        });

        test('bet-down decreases the bet', async ({ page }) => {
            await page.locator('#btn-bet-down').click();
            await expect(page.locator('#bet')).toHaveText('5');
        });

        test('bet cannot go below the minimum of 5', async ({ page }) => {
            for (let i = 0; i < 5; i++) await page.locator('#btn-bet-down').click();
            await expect(page.locator('#bet')).toHaveText('5');
        });

        test('bet cannot exceed the balance', async ({ page }) => {
            for (let i = 0; i < 40; i++) await page.locator('#btn-bet-up').click();
            const bet = parseInt(await page.locator('#bet').textContent(), 10);
            expect(bet).toBeLessThanOrEqual(100);
        });
    });

    // -----------------------------------------------------------------------
    // Dealing
    // -----------------------------------------------------------------------
    test.describe('dealing', () => {
        test('Deal deals two cards to each hand', async ({ page }) => {
            await page.evaluate(() => {
                deck = [{ rank: '8', suit: '♠' }, { rank: '7', suit: '♠' },
                        { rank: '5', suit: '♠' }, { rank: '9', suit: '♠' }];
                deal();
            });
            const lens = await page.evaluate(() => ({ p: playerHand.length, d: dealerHand.length }));
            expect(lens.p).toBe(2);
            expect(lens.d).toBe(2);
        });

        test('Deal moves the game to playerTurn (no naturals)', async ({ page }) => {
            await page.evaluate(() => {
                deck = [{ rank: '8' }, { rank: '7' }, { rank: '5' }, { rank: '9' }];
                deal();
            });
            const s = await page.evaluate(() => state);
            expect(s).toBe('playerTurn');
        });

        test('Deal button enables hit and stand', async ({ page }) => {
            await page.evaluate(() => {
                deck = [{ rank: '8' }, { rank: '7' }, { rank: '5' }, { rank: '9' }];
            });
            await page.locator('#btn-deal').click();
            await expect(page.locator('#btn-hit')).toBeEnabled();
            await expect(page.locator('#btn-stand')).toBeEnabled();
        });
    });

    // -----------------------------------------------------------------------
    // Player actions
    // -----------------------------------------------------------------------
    test.describe('player turn', () => {
        test('hit adds a card to the player hand', async ({ page }) => {
            await page.evaluate(() => {
                deck = [{ rank: '8' }, { rank: '7' }, { rank: '5' }, { rank: '9' }];
                deal();
                deck.push({ rank: '2' }); // next card
            });
            const before = await page.evaluate(() => playerHand.length);
            await page.locator('#btn-hit').click();
            const after = await page.evaluate(() => playerHand.length);
            expect(after).toBe(before + 1);
        });

        test('busting ends the round with a loss', async ({ page }) => {
            await page.evaluate(() => {
                playerHand = [{ rank: 'K' }, { rank: 'Q' }];
                dealerHand = [{ rank: '9' }, { rank: '7' }];
                state = 'playerTurn';
                deck = [{ rank: 'K' }]; // hitting draws a K -> 30, bust
                hit();
            });
            const r = await page.evaluate(() => ({ state, result }));
            expect(r.state).toBe('roundOver');
            expect(r.result).toBe('lose');
        });

        test('busting deducts the bet from the balance', async ({ page }) => {
            const bal = await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: 'K' }, { rank: 'Q' }];
                dealerHand = [{ rank: '9' }, { rank: '7' }];
                state = 'playerTurn';
                deck = [{ rank: 'K' }];
                hit();
                return balance;
            });
            expect(bal).toBe(90);
        });
    });

    // -----------------------------------------------------------------------
    // Stand / dealer resolution
    // -----------------------------------------------------------------------
    test.describe('standing and resolution', () => {
        test('higher player total beats the dealer', async ({ page }) => {
            const r = await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: 'K' }, { rank: 'Q' }]; // 20
                dealerHand = [{ rank: '9' }, { rank: '8' }]; // 17, stands
                state = 'playerTurn';
                deck = [];
                stand();
                return { result, state, balance };
            });
            expect(r.result).toBe('win');
            expect(r.state).toBe('roundOver');
            expect(r.balance).toBe(110);
        });

        test('dealer draws until at least 17', async ({ page }) => {
            const r = await page.evaluate(() => {
                playerHand = [{ rank: 'K' }, { rank: 'Q' }]; // 20
                dealerHand = [{ rank: '9' }, { rank: '5' }]; // 14, must draw
                state = 'playerTurn';
                deck = [{ rank: '3' }]; // dealer draws 3 -> 17, then stands
                stand();
                return { dealerLen: dealerHand.length, dealerVal: handValue(dealerHand) };
            });
            expect(r.dealerLen).toBe(3);
            expect(r.dealerVal).toBeGreaterThanOrEqual(17);
        });

        test('dealer busting is a player win', async ({ page }) => {
            const r = await page.evaluate(() => {
                playerHand = [{ rank: '10' }, { rank: '7' }]; // 17
                dealerHand = [{ rank: '9' }, { rank: '6' }]; // 15
                state = 'playerTurn';
                deck = [{ rank: 'K' }]; // dealer draws K -> 25, bust
                stand();
                return result;
            });
            expect(r).toBe('win');
        });

        test('equal totals are a push (bet returned)', async ({ page }) => {
            const r = await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: 'K' }, { rank: 'Q' }]; // 20
                dealerHand = [{ rank: '10' }, { rank: '10' }]; // 20
                state = 'playerTurn';
                deck = [];
                stand();
                return { result, balance };
            });
            expect(r.result).toBe('push');
            expect(r.balance).toBe(100);
        });

        test('lower player total loses to the dealer', async ({ page }) => {
            const r = await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: '10' }, { rank: '7' }]; // 17
                dealerHand = [{ rank: '10' }, { rank: '9' }]; // 19
                state = 'playerTurn';
                deck = [];
                stand();
                return { result, balance };
            });
            expect(r.result).toBe('lose');
            expect(r.balance).toBe(90);
        });
    });

    // -----------------------------------------------------------------------
    // Naturals (blackjack)
    // -----------------------------------------------------------------------
    test.describe('naturals', () => {
        test('a natural blackjack pays 3:2', async ({ page }) => {
            const r = await page.evaluate(() => {
                balance = 100; bet = 10;
                // deal draws p1,d1,p2,d2 via pop() -> player A,K ; dealer 9,8
                deck = [{ rank: '8' }, { rank: 'K' }, { rank: '9' }, { rank: 'A' }];
                deal();
                return { result, state, balance };
            });
            expect(r.result).toBe('blackjack');
            expect(r.state).toBe('roundOver');
            expect(r.balance).toBe(115); // 100 + floor(10 * 1.5)
        });

        test('player and dealer both blackjack is a push', async ({ page }) => {
            const r = await page.evaluate(() => {
                balance = 100; bet = 10;
                // player A,K ; dealer A,K  (pop order: A,A,K,K)
                deck = [{ rank: 'K' }, { rank: 'K' }, { rank: 'A' }, { rank: 'A' }];
                deal();
                return { result, balance };
            });
            expect(r.result).toBe('push');
            expect(r.balance).toBe(100);
        });
    });

    // -----------------------------------------------------------------------
    // Best balance tracking / persistence
    // -----------------------------------------------------------------------
    test.describe('best balance', () => {
        test('best rises with the balance after a win', async ({ page }) => {
            await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: 'K' }, { rank: 'Q' }];
                dealerHand = [{ rank: '9' }, { rank: '8' }];
                state = 'playerTurn';
                deck = [];
                stand();
            });
            await expect(page.locator('#best')).toHaveText('110');
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                balance = 100; bet = 10;
                playerHand = [{ rank: 'K' }, { rank: 'Q' }];
                dealerHand = [{ rank: '9' }, { rank: '8' }];
                state = 'playerTurn';
                deck = [];
                stand();
            });
            const stored = await page.evaluate(() => localStorage.getItem('blackjack-best'));
            expect(parseInt(stored, 10)).toBeGreaterThanOrEqual(110);
        });
    });

    // -----------------------------------------------------------------------
    // Next round
    // -----------------------------------------------------------------------
    test.describe('next round', () => {
        test('dealing again clears the previous hands', async ({ page }) => {
            await page.evaluate(() => {
                playerHand = [{ rank: 'K' }, { rank: 'Q' }];
                dealerHand = [{ rank: '9' }, { rank: '8' }];
                state = 'playerTurn';
                deck = [];
                stand(); // roundOver
                deck = [{ rank: '8' }, { rank: '7' }, { rank: '5' }, { rank: '9' }];
                deal();
            });
            const lens = await page.evaluate(() => ({ p: playerHand.length, d: dealerHand.length }));
            expect(lens.p).toBe(2);
            expect(lens.d).toBe(2);
        });

        test('keyboard: H hits and S stands', async ({ page }) => {
            await page.evaluate(() => {
                deck = [{ rank: '8' }, { rank: '7' }, { rank: '5' }, { rank: '9' }];
                deal();
                deck.push({ rank: '2' });
            });
            await page.keyboard.press('h');
            const afterHit = await page.evaluate(() => playerHand.length);
            expect(afterHit).toBe(3);
            await page.keyboard.press('s');
            const s = await page.evaluate(() => state);
            expect(s).toBe('roundOver');
        });
    });
});
