const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers. The rules are pure functions over plain data, so most tests install
// an exact deal with setupHands() and then ask a question about it.
// Cards are written as two characters: rank (2-9, T, J, Q, K, A) then suit.
// ---------------------------------------------------------------------------

// Deal exact hands (arrays of card codes), with the computer players stopped
// so the test drives every play itself.
async function setupHands(page, hands, options = {}) {
    await page.evaluate(
        ([hands, options]) => {
            startGame();
            aiEnabled = false;
            setupHands(hands, options);
        },
        [hands, options]
    );
}

async function legalPlays(page, player) {
    return page.evaluate((player) => legalPlays(player).map(cardName).sort(), player);
}

async function handOf(page, player) {
    return page.evaluate((player) => hands[player].map(cardName), player);
}

async function play(page, player, code) {
    return page.evaluate(
        ([player, code]) => playCard(player, hands[player].find((c) => cardName(c) === code)),
        [player, code]
    );
}

// Click the card in your own hand by its code.
async function clickCard(page, code) {
    const spot = await page.evaluate((code) => handCardCentre(code), code);
    if (!spot) throw new Error(`card ${code} is not in your hand`);
    await page.locator('#canvas').click({ position: spot });
}

// A full 52-card deal split four ways, in a fixed order, for deterministic play.
const SUIT_ORDER = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
function dealByIndex(indexes) {
    const all = [];
    for (const s of SUIT_ORDER) for (const r of RANKS) all.push(r + s);
    return indexes.map((list) => list.map((i) => all[i]));
}

const DEAL_FOR_RESTART = [
    ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2H', '3H', '4H', '2D', '3D', '4D'],
    ['6C', '7C', '8C', '5S', '6S', '7S', '5H', '6H', '7H', '5D', '6D', '7D', '8D'],
    ['9C', 'TC', 'JC', '8S', '9S', 'TS', '8H', '9H', 'TH', '9D', 'TD', 'JD', 'QD'],
    ['QC', 'KC', 'AC', 'JS', 'QS', 'KS', 'AS', 'JH', 'QH', 'KH', 'AH', 'KD', 'AD'],
];

test.describe('Hearts', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Page and initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Hearts', async ({ page }) => {
            await expect(page).toHaveTitle('Hearts');
        });

        test('canvas is 760x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('start overlay is visible and state is ready', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('everyone starts on zero', async ({ page }) => {
            expect(await page.evaluate(() => scores)).toEqual([0, 0, 0, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Cards and the deck
    // -----------------------------------------------------------------------
    test.describe('cards', () => {
        test('a deck is 52 distinct cards', async ({ page }) => {
            const names = await page.evaluate(() => newDeck().map(cardName));
            expect(names).toHaveLength(52);
            expect(new Set(names).size).toBe(52);
        });

        test('each suit holds thirteen cards', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const by = { S: 0, H: 0, D: 0, C: 0 };
                for (const card of newDeck()) by[card.suit]++;
                return by;
            });
            expect(counts).toEqual({ S: 13, H: 13, D: 13, C: 13 });
        });

        test('card codes round-trip', async ({ page }) => {
            const ok = await page.evaluate(() =>
                newDeck().every((c) => cardName(parseCard(cardName(c))) === cardName(c))
            );
            expect(ok).toBe(true);
            expect(await page.evaluate(() => parseCard('QS'))).toEqual({ rank: 12, suit: 'S' });
            expect(await page.evaluate(() => parseCard('TH'))).toEqual({ rank: 10, suit: 'H' });
            expect(await page.evaluate(() => parseCard('AC'))).toEqual({ rank: 14, suit: 'C' });
        });

        test('hearts cost one, the queen of spades thirteen, the rest nothing', async ({ page }) => {
            const got = await page.evaluate(() =>
                ['2H', 'AH', 'QS', 'KS', 'QH', '2C', 'AD'].map((c) => pointsOf(parseCard(c)))
            );
            expect(got).toEqual([1, 1, 13, 0, 1, 0, 0]);
        });

        test('a whole deck is worth 26 points', async ({ page }) => {
            expect(await page.evaluate(() => handPoints(newDeck()))).toBe(26);
        });

        test('a deal gives everyone thirteen cards and uses the whole deck', async ({ page }) => {
            const got = await page.evaluate(() => {
                const dealt = deal(newDeck());
                return {
                    sizes: dealt.map((h) => h.length),
                    distinct: new Set(dealt.flat().map(cardName)).size,
                };
            });
            expect(got).toEqual({ sizes: [13, 13, 13, 13], distinct: 52 });
        });
    });

    // -----------------------------------------------------------------------
    // Passing
    // -----------------------------------------------------------------------
    test.describe('passing', () => {
        test('the direction cycles left, right, across, none', async ({ page }) => {
            const dirs = await page.evaluate(() => [0, 1, 2, 3, 4, 5].map(passDirection));
            expect(dirs).toEqual(['left', 'right', 'across', 'none', 'left', 'right']);
        });

        test('passing left hands the cards to the next player round', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 0 });

            await page.evaluate(() => {
                selectedCards = ['AS', 'KS', 'QS'];
                completePass([['AS', 'KS', 'QS'], ['AH', 'KH', 'QH'], ['AD', 'KD', 'QD'], ['AC', 'KC', 'QC']]);
            });

            expect(await handOf(page, 1)).toEqual(expect.arrayContaining(['AS', 'KS', 'QS']));
            expect(await handOf(page, 2)).toEqual(expect.arrayContaining(['AH', 'KH', 'QH']));
            expect(await handOf(page, 0)).toEqual(expect.arrayContaining(['AC', 'KC', 'QC']));
            expect(await handOf(page, 0)).not.toContain('AS');
        });

        test('every hand is thirteen cards again after the pass', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 1 });
            await page.evaluate(() =>
                completePass([['AS', 'KS', 'QS'], ['AH', 'KH', 'QH'], ['AD', 'KD', 'QD'], ['AC', 'KC', 'QC']])
            );
            const sizes = await page.evaluate(() => hands.map((h) => h.length));
            expect(sizes).toEqual([13, 13, 13, 13]);
            // Hand 1 passes right: your cards go to East (player 3).
            expect(await handOf(page, 3)).toEqual(expect.arrayContaining(['AS', 'KS', 'QS']));
        });

        test('passing across sends the cards two seats round', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 2 });
            await page.evaluate(() =>
                completePass([['AS', 'KS', 'QS'], ['AH', 'KH', 'QH'], ['AD', 'KD', 'QD'], ['AC', 'KC', 'QC']])
            );
            expect(await handOf(page, 2)).toEqual(expect.arrayContaining(['AS', 'KS', 'QS']));
        });

        test('the fourth hand is played as dealt', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 3 });
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('you cannot pass until three cards are chosen', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 0 });
            await expect(page.locator('#btn-pass')).toBeDisabled();
            await clickCard(page, '2S');
            await clickCard(page, '3S');
            await expect(page.locator('#btn-pass')).toBeDisabled();
            await clickCard(page, '4S');
            await expect(page.locator('#btn-pass')).toBeEnabled();
            expect(await page.evaluate(() => selectedCards.slice().sort())).toEqual(['2S', '3S', '4S']);
        });

        test('clicking a chosen card takes it back', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 0 });
            await clickCard(page, '2S');
            await clickCard(page, '2S');
            expect(await page.evaluate(() => selectedCards)).toEqual([]);
        });

        test('a fourth card is refused while three are chosen', async ({ page }) => {
            await setupHands(page, dealByIndex([
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
                [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38],
                [39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51],
            ]), { phase: 'passing', handNumber: 0 });
            for (const code of ['2S', '3S', '4S', '5S']) await clickCard(page, code);
            expect(await page.evaluate(() => selectedCards.length)).toBe(3);
            expect(await page.evaluate(() => selectedCards)).not.toContain('5S');
        });
    });

    // -----------------------------------------------------------------------
    // The rules of play
    // -----------------------------------------------------------------------
    test.describe('the rules of play', () => {
        // You hold the two of clubs in this deal.
        const DEAL = [
            ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2H', '3H', '4H', '2D', '3D', '4D'],
            ['6C', '7C', '8C', '5S', '6S', '7S', '5H', '6H', '7H', '5D', '6D', '7D', '8D'],
            ['9C', 'TC', 'JC', '8S', '9S', 'TS', '8H', '9H', 'TH', '9D', 'TD', 'JD', 'QD'],
            ['QC', 'KC', 'AC', 'JS', 'QS', 'KS', 'AS', 'JH', 'QH', 'KH', 'AH', 'KD', 'AD'],
        ];

        test('the two of clubs leads the first trick', async ({ page }) => {
            await setupHands(page, DEAL);
            expect(await page.evaluate(() => turn)).toBe(0);
            expect(await legalPlays(page, 0)).toEqual(['2C']);
        });

        test('the lead can be any player, whoever holds the two', async ({ page }) => {
            const shifted = [DEAL[1], DEAL[0], DEAL[2], DEAL[3]];
            await setupHands(page, shifted);
            expect(await page.evaluate(() => turn)).toBe(1);
        });

        test('you must follow suit when you can', async ({ page }) => {
            await setupHands(page, DEAL);
            await play(page, 0, '2C');
            expect(await legalPlays(page, 1)).toEqual(['6C', '7C', '8C']);
        });

        test('with no card of the suit you may play anything but points on trick one', async ({ page }) => {
            const noClubs = [
                ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2H', '3H', '4H', '2D', '3D', '4D'],
                ['5S', '6S', '7S', '8S', '5H', '6H', '7H', '5D', '6D', '7D', '8D', '9D', 'TD'],
                ['9C', 'TC', 'JC', '9S', 'TS', 'JS', '8H', '9H', 'TH', 'JD', 'QD', 'KD', 'AD'],
                ['6C', '7C', '8C', 'QC', 'KC', 'AC', 'QS', 'KS', 'AS', 'JH', 'QH', 'KH', 'AH'],
            ];
            await setupHands(page, noClubs);
            await play(page, 0, '2C');
            // West is void in clubs: everything except the hearts is allowed.
            expect(await legalPlays(page, 1)).toEqual(
                ['5S', '6S', '7S', '8S', '5D', '6D', '7D', '8D', '9D', 'TD'].sort()
            );
        });

        test('a player holding only points may play them on the first trick', async ({ page }) => {
            const onlyPoints = [
                ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2D', '3D', '4D', '5D', '6D', '7D'],
                ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH'],
                ['9C', 'TC', 'JC', '8S', '9S', 'TS', 'JS', '8D', '9D', 'TD', 'JD', 'QD', 'KD'],
                ['6C', '7C', '8C', 'QC', 'KC', 'AC', 'QS', 'KS', 'AS', '5S', '6S', '7S', 'AD'],
            ];
            await setupHands(page, onlyPoints);
            await play(page, 0, '2C');
            expect((await legalPlays(page, 1)).length).toBe(13);
        });

        test('hearts may not be led until they are broken', async ({ page }) => {
            await setupHands(page, DEAL, { phase: 'playing', leader: 0, trickNumber: 3 });
            const plays = await legalPlays(page, 0);
            expect(plays).not.toContain('2H');
            expect(plays).toContain('2S');
            expect(plays).toContain('2D');
        });

        test('the queen of spades may be led whenever you like', async ({ page }) => {
            await setupHands(page, DEAL, { phase: 'playing', leader: 3, trickNumber: 3 });
            expect(await legalPlays(page, 3)).toContain('QS');
        });

        test('discarding a heart breaks hearts', async ({ page }) => {
            // West holds no spades, so the spade lead forces a discard.
            await setupHands(page, [
                ['2C', '3C', '2S'],
                ['5C', '2H', '3H'],
                ['9C', '8S', '9S'],
                ['QC', 'JS', 'QS'],
            ], { phase: 'playing', leader: 0, trickNumber: 2 });
            expect(await page.evaluate(() => heartsBroken)).toBe(false);
            await play(page, 0, '2S');
            expect(await page.evaluate(() => heartsBroken)).toBe(false);
            await play(page, 1, '2H');
            expect(await page.evaluate(() => heartsBroken)).toBe(true);
        });

        test('once broken, hearts may be led', async ({ page }) => {
            await setupHands(page, DEAL, { phase: 'playing', leader: 0, trickNumber: 3, heartsBroken: true });
            expect(await legalPlays(page, 0)).toContain('2H');
        });

        test('a player holding only hearts may lead them regardless', async ({ page }) => {
            const allHearts = [
                ['2H', '3H', '4H', '5H', '6H'],
                ['7H', '8H', '9H', 'TH', 'JH'],
                ['QH', 'KH', 'AH', '2S', '3S'],
                ['4S', '5S', '6S', '7S', '8S'],
            ];
            await setupHands(page, allHearts, { phase: 'playing', leader: 0, trickNumber: 5 });
            expect(await legalPlays(page, 0)).toEqual(['2H', '3H', '4H', '5H', '6H']);
        });

        test('the highest card of the suit led takes the trick', async ({ page }) => {
            const got = await page.evaluate(() =>
                trickWinner([
                    { player: 0, card: parseCard('5C') },
                    { player: 1, card: parseCard('KC') },
                    { player: 2, card: parseCard('AD') },
                    { player: 3, card: parseCard('9C') },
                ])
            );
            expect(got).toBe(1);
        });

        test('a card of another suit never wins, however high', async ({ page }) => {
            const got = await page.evaluate(() =>
                trickWinner([
                    { player: 2, card: parseCard('2D') },
                    { player: 3, card: parseCard('AS') },
                    { player: 0, card: parseCard('AH') },
                    { player: 1, card: parseCard('AC') },
                ])
            );
            expect(got).toBe(2);
        });

        test('the winner of a trick leads the next one', async ({ page }) => {
            await setupHands(page, DEAL);
            await play(page, 0, '2C');
            await play(page, 1, '8C');
            await play(page, 2, 'JC');
            await play(page, 3, 'AC');
            expect(await page.evaluate(() => turn)).toBe(3);
            expect(await page.evaluate(() => trick.length)).toBe(0);
            expect(await page.evaluate(() => taken[3].length)).toBe(4);
        });

        test('playing a card removes it from the hand', async ({ page }) => {
            await setupHands(page, DEAL);
            await play(page, 0, '2C');
            expect(await handOf(page, 0)).not.toContain('2C');
            expect((await handOf(page, 0)).length).toBe(12);
        });

        test('an illegal card is refused and nothing changes', async ({ page }) => {
            await setupHands(page, DEAL);
            const refused = await play(page, 0, '2H');
            expect(refused).toBe(false);
            expect(await handOf(page, 0)).toContain('2H');
            expect(await page.evaluate(() => trick.length)).toBe(0);
        });

        test('playing out of turn is refused', async ({ page }) => {
            await setupHands(page, DEAL);
            expect(await play(page, 2, '9C')).toBe(false);
            expect(await page.evaluate(() => trick.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('counts a heart as one and the queen as thirteen', async ({ page }) => {
            const got = await page.evaluate(() =>
                scoreHand([
                    ['2H', '3H'].map(parseCard),
                    ['QS'].map(parseCard),
                    ['4H', '5H', '6H'].map(parseCard),
                    ['2C', 'AD'].map(parseCard),
                ])
            );
            expect(got).toEqual([2, 13, 3, 0]);
        });

        test('a hand is always worth 26 points in total', async ({ page }) => {
            const total = await page.evaluate(() => {
                const deck = newDeck();
                const split = [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39)];
                return scoreHand(split).reduce((a, b) => a + b, 0);
            });
            expect(total).toBe(26);
        });

        test('shooting the moon gives everyone else 26', async ({ page }) => {
            const got = await page.evaluate(() => {
                const all = newDeck().filter((c) => pointsOf(c) > 0);
                return scoreHand([[], all, [], []]);
            });
            expect(got).toEqual([26, 0, 26, 26]);
        });

        test('a hand played out adds its points to the running score', async ({ page }) => {
            // Five-card hands: East holds the queen and must take it.
            const deal = [
                ['2C', '3C', '4C', '5C', '6C'],
                ['7C', '8C', '9C', 'TC', 'JC'],
                ['QC', 'KC', '2H', '3H', '4H'],
                ['AC', 'QS', '2S', '3S', '4S'],
            ];
            await setupHands(page, deal);
            await play(page, 0, '2C');
            await play(page, 1, '7C');
            await play(page, 2, 'QC');
            await play(page, 3, 'AC');
            // East leads the rest; the others shed what they can.
            await play(page, 3, '2S');
            await play(page, 0, '3C');
            await play(page, 1, '8C');
            await play(page, 2, '2H');
            await play(page, 3, '3S');
            await play(page, 0, '4C');
            await play(page, 1, '9C');
            await play(page, 2, '3H');
            await play(page, 3, '4S');
            await play(page, 0, '5C');
            await play(page, 1, 'TC');
            await play(page, 2, '4H');
            await play(page, 3, 'QS');
            await play(page, 0, '6C');
            await play(page, 1, 'JC');
            await play(page, 2, 'KC');
            expect(await page.evaluate(() => hands.map((h) => h.length))).toEqual([0, 0, 0, 0]);
            const scored = await page.evaluate(() => scores);
            expect(scored.reduce((a, b) => a + b, 0)).toBe(16); // 3 hearts + the queen
            expect(scored[3]).toBe(16);
        });

        test('the game ends when someone reaches 100', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                scores = [96, 10, 20, 30];
                finishHand([4, 0, 0, 0]);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => scores)).toEqual([100, 10, 20, 30]);
            expect(await page.evaluate(() => winners())).toEqual([1]);
        });

        test('the lowest score wins, and a tie is shared', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                scores = [100, 12, 12, 40];
                state = 'over';
            });
            expect(await page.evaluate(() => winners())).toEqual([1, 2]);
        });

        test('under 100 the game carries on to another hand', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                scores = [40, 10, 20, 30];
                finishHand([5, 0, 0, 0]);
            });
            expect(await page.evaluate(() => state)).not.toBe('over');
            expect(await page.evaluate(() => scores)).toEqual([45, 10, 20, 30]);
        });
    });

    // -----------------------------------------------------------------------
    // The computer players
    // -----------------------------------------------------------------------
    test.describe('the computer players', () => {
        test('always choose a legal card', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 40; i++) {
                    startGame();
                    aiEnabled = false;
                    newHand({ skipPass: true });
                    // Walk a whole hand with every seat played by the computer.
                    let guard = 0;
                    while (hands.flat().length && guard++ < 60) {
                        const card = aiChoosePlay(turn);
                        if (!legalPlays(turn).some((c) => cardName(c) === cardName(card))) return false;
                        playCard(turn, card);
                    }
                    if (hands.flat().length) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pass exactly three cards from their own hand', async ({ page }) => {
            const ok = await page.evaluate(() => {
                for (let i = 0; i < 20; i++) {
                    startGame();
                    aiEnabled = false;
                    newHand();
                    for (let p = 1; p < 4; p++) {
                        const chosen = aiChoosePass(p);
                        if (chosen.length !== 3) return false;
                        const names = hands[p].map(cardName);
                        if (!chosen.every((c) => names.includes(cardName(c)))) return false;
                        if (new Set(chosen.map(cardName)).size !== 3) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('pass the queen of spades when it is bare', async ({ page }) => {
            await setupHands(page, [
                ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2H', '3H', '4H', '2D', '3D', '4D'],
                ['QS', 'AH', 'KH', '6C', '7C', '8C', '5H', '7H', '5D', '6D', '7D', '8D', '9D'],
                ['9C', 'TC', 'JC', '8S', '9S', 'TS', '8H', '9H', 'TH', 'TD', 'JD', 'QD', 'KD'],
                ['QC', 'KC', 'AC', 'JS', 'KS', 'AS', 'JH', 'QH', '6H', 'AD', '5S', '6S', '7S'],
            ], { phase: 'passing', handNumber: 0 });
            const chosen = await page.evaluate(() => aiChoosePass(1).map(cardName));
            expect(chosen).toContain('QS');
        });

        test('do not take a trick they can duck under', async ({ page }) => {
            await setupHands(page, [
                ['2C', '3C', '4C', '5C', 'JC'],
                ['7C', '8C', 'AC', '2H', '3H'],
                ['9C', 'TC', 'QC', '4H', '5H'],
                ['6C', 'KC', '2S', '3S', '4S'],
            ], { phase: 'playing', leader: 0, trickNumber: 2 });
            await play(page, 0, 'JC');
            // West can win with the ace or duck below the jack: it must duck.
            const choice = await page.evaluate(() => cardName(aiChoosePlay(1)));
            expect(['7C', '8C']).toContain(choice);
        });

        test('throw the queen of spades when void in the suit led', async ({ page }) => {
            await setupHands(page, [
                ['2C', '3C', '4C', '5C', '6C'],
                ['QS', 'AS', 'KS', '2H', '3H'],
                ['9C', 'TC', 'JC', '4H', '5H'],
                ['QC', 'KC', '7C', '8C', 'AC'],
            ], { phase: 'playing', leader: 0, trickNumber: 2 });
            await play(page, 0, '2C');
            expect(await page.evaluate(() => cardName(aiChoosePlay(1)))).toBe('QS');
        });
    });

    // -----------------------------------------------------------------------
    // Playing with the mouse
    // -----------------------------------------------------------------------
    test.describe('playing by clicking', () => {
        const DEAL = [
            ['2C', '3C', '4C', '5C', '2S', '3S', '4S', '2H', '3H', '4H', '2D', '3D', '4D'],
            ['6C', '7C', '8C', '5S', '6S', '7S', '5H', '6H', '7H', '5D', '6D', '7D', '8D'],
            ['9C', 'TC', 'JC', '8S', '9S', 'TS', '8H', '9H', 'TH', '9D', 'TD', 'JD', 'QD'],
            ['QC', 'KC', 'AC', 'JS', 'QS', 'KS', 'AS', 'JH', 'QH', 'KH', 'AH', 'KD', 'AD'],
        ];

        test('clicking a legal card plays it', async ({ page }) => {
            await setupHands(page, DEAL);
            await clickCard(page, '2C');
            expect(await page.evaluate(() => trick.map((t) => cardName(t.card)))).toEqual(['2C']);
            expect(await handOf(page, 0)).not.toContain('2C');
        });

        test('clicking an illegal card does nothing', async ({ page }) => {
            await setupHands(page, DEAL);
            await clickCard(page, '2H');
            expect(await page.evaluate(() => trick.length)).toBe(0);
            expect(await handOf(page, 0)).toContain('2H');
        });

        test('clicking while it is not your turn does nothing', async ({ page }) => {
            await setupHands(page, DEAL);
            await play(page, 0, '2C');
            await clickCard(page, '3C');
            expect(await page.evaluate(() => trick.length)).toBe(1);
        });

        test('the status line says what to do', async ({ page }) => {
            await setupHands(page, DEAL);
            await expect(page.locator('#status')).toContainText(/your (lead|turn)|play/i);
        });

        test('the scoreboard shows every player', async ({ page }) => {
            await setupHands(page, DEAL);
            for (const id of ['#score-0', '#score-1', '#score-2', '#score-3']) {
                await expect(page.locator(id)).toHaveText('0');
            }
        });
    });

    // -----------------------------------------------------------------------
    // Playing a full hand against the computer
    // -----------------------------------------------------------------------
    test.describe('a hand against the computer', () => {
        test.setTimeout(60_000);

        test('the computer answers your lead and the trick is collected', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                newHand({ skipPass: true });
            });
            await page.waitForFunction(() => state === 'playing' && turn === 0, null, { timeout: 15000 });
            const card = await page.evaluate(() => cardName(legalPlays(0)[0]));
            await clickCard(page, card);
            await page.waitForFunction(() => trick.length === 0 && hands[0].length === 12, null, {
                timeout: 15000,
            });
            expect(await page.evaluate(() => taken.flat().length)).toBeGreaterThanOrEqual(4);
            expect(errors).toEqual([]);
        });

        test('a whole hand plays out and is scored', async ({ page }) => {
            const total = await page.evaluate(() => {
                startGame();
                aiEnabled = false;
                newHand({ skipPass: true });
                let guard = 0;
                while (hands.flat().length && guard++ < 60) playCard(turn, aiChoosePlay(turn));
                return { scores: scores.slice(), taken: taken.flat().length };
            });
            expect(total.scores.reduce((a, b) => a + b, 0)).toBe(26);
            expect(await page.evaluate(() => handNumber)).toBeGreaterThan(0);
        });

        test('a whole game plays out to a hundred', async ({ page }) => {
            const summary = await page.evaluate(() => {
                const games = [];
                for (let g = 0; g < 10; g++) {
                    startGame();
                    aiEnabled = false;
                    let guard = 0;
                    const handTotals = [];
                    while (state !== 'over' && guard++ < 60) {
                        if (state === 'passing') {
                            completePass([0, 1, 2, 3].map((p) => aiChoosePass(p).map(cardName)));
                        }
                        const before = scores.reduce((a, b) => a + b, 0);
                        let plays = 0;
                        while (state === 'playing' && hands.flat().length && plays++ < 60) {
                            playCard(turn, aiChoosePlay(turn));
                        }
                        handTotals.push(scores.reduce((a, b) => a + b, 0) - before);
                        if (state === 'handover') newHand();
                    }
                    games.push({
                        state,
                        top: Math.max(...scores),
                        hands: handNumber,
                        handTotals,
                        winners: winners().length,
                    });
                }
                return games;
            });
            for (const game of summary) {
                expect(game.state).toBe('over');
                expect(game.top).toBeGreaterThanOrEqual(100);
                expect(game.hands).toBeGreaterThan(0);
                expect(game.winners).toBeGreaterThan(0);
                // Every hand is worth 26 points, or 78 when somebody shoots the moon.
                for (const total of game.handTotals) expect([26, 78]).toContain(total);
            }
            expect(errors).toEqual([]);
        });

        test('R starts a new game', async ({ page }) => {
            await setupHands(page, DEAL_FOR_RESTART);
            await page.evaluate(() => {
                scores = [20, 30, 40, 50];
            });
            await page.keyboard.press('r');
            expect(await page.evaluate(() => scores)).toEqual([0, 0, 0, 0]);
            expect(await page.evaluate(() => hands.map((h) => h.length))).toEqual([13, 13, 13, 13]);
        });
    });
});
