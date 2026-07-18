const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Force a known, match-friendly deck: pairs live at (0,1), (2,3), (4,5)...
// Returns after the deck is installed so tests are layout-independent.
async function setKnownDeck(page) {
    await page.evaluate(() => {
        for (let i = 0; i < cards.length; i++) {
            cards[i].symbol = String.fromCharCode(65 + Math.floor(i / 2)); // A,A,B,B,...
            cards[i].faceUp = false;
            cards[i].matched = false;
        }
        firstPick = null;
        secondPick = null;
        lockBoard = false;
        moves = 0;
        matchedPairs = 0;
    });
}

test.describe('Memory Match', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Memory Match', async ({ page }) => {
            await expect(page).toHaveTitle('Memory Match');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('moves start at 0', async ({ page }) => {
            await expect(page.locator('#moves')).toHaveText('0');
        });

        test('pairs start at 0/8', async ({ page }) => {
            await expect(page.locator('#pairs')).toHaveText('0/8');
        });

        test('best starts as — when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are 16 cards, all face down and unmatched', async ({ page }) => {
            const r = await page.evaluate(() => ({
                n: cards.length,
                anyUp: cards.some(c => c.faceUp),
                anyMatched: cards.some(c => c.matched),
            }));
            expect(r.n).toBe(16);
            expect(r.anyUp).toBe(false);
            expect(r.anyMatched).toBe(false);
        });

        test('the deck holds 8 symbols, each appearing exactly twice', async ({ page }) => {
            const counts = await page.evaluate(() => {
                const m = {};
                for (const c of cards) m[c.symbol] = (m[c.symbol] || 0) + 1;
                return m;
            });
            const values = Object.values(counts);
            expect(values.length).toBe(8);
            expect(values.every(v => v === 2)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Flipping and matching
    // -----------------------------------------------------------------------
    test.describe('flipping and matching', () => {
        test('flipping a face-down card turns it face up', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const up = await page.evaluate(() => { flipAt(0); return cards[0].faceUp; });
            expect(up).toBe(true);
        });

        test('two cards with the same symbol match and stay face up', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const r = await page.evaluate(() => {
                flipAt(0); flipAt(1);           // both 'A'
                return {
                    m0: cards[0].matched, m1: cards[1].matched,
                    up0: cards[0].faceUp, up1: cards[1].faceUp,
                    pairs: matchedPairs,
                };
            });
            expect(r.m0).toBe(true);
            expect(r.m1).toBe(true);
            expect(r.up0).toBe(true);
            expect(r.up1).toBe(true);
            expect(r.pairs).toBe(1);
        });

        test('a completed attempt increments the move counter', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const moves = await page.evaluate(() => { flipAt(0); flipAt(1); return moves; });
            expect(moves).toBe(1);
        });

        test('two cards with different symbols do not match', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const r = await page.evaluate(() => {
                flipAt(0); flipAt(2);           // 'A' vs 'B'
                return { m0: cards[0].matched, m2: cards[2].matched, locked: lockBoard };
            });
            expect(r.m0).toBe(false);
            expect(r.m2).toBe(false);
            expect(r.locked).toBe(true); // board locks awaiting flip-back
        });

        test('resolveMismatch flips the two mismatched cards back down', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const r = await page.evaluate(() => {
                flipAt(0); flipAt(2);
                resolveMismatch();
                return { up0: cards[0].faceUp, up2: cards[2].faceUp, locked: lockBoard };
            });
            expect(r.up0).toBe(false);
            expect(r.up2).toBe(false);
            expect(r.locked).toBe(false);
        });

        test('an already-matched card cannot be flipped again', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const stillMatched = await page.evaluate(() => {
                flipAt(0); flipAt(1);           // match A,A
                flipAt(0);                       // try to flip a matched card
                return cards[0].matched && cards[0].faceUp && firstPick === null;
            });
            expect(stillMatched).toBe(true);
        });

        test('clicking the same card twice does not complete a pair', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const r = await page.evaluate(() => {
                flipAt(0); flipAt(0);
                return { second: secondPick, moves };
            });
            expect(r.second).toBeNull();
            expect(r.moves).toBe(0);
        });

        test('a third flip is ignored while the board is locked after a mismatch', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            const up = await page.evaluate(() => {
                flipAt(0); flipAt(2);           // mismatch → locked
                flipAt(4);                       // should be ignored
                return cards[4].faceUp;
            });
            expect(up).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Winning
    // -----------------------------------------------------------------------
    async function winWithKnownDeck(page) {
        await setKnownDeck(page);
        await page.evaluate(() => {
            for (let p = 0; p < 8; p++) { flipAt(p * 2); flipAt(p * 2 + 1); }
        });
    }

    test.describe('winning', () => {
        test('matching all pairs wins the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            const r = await page.evaluate(() => ({ state, pairs: matchedPairs }));
            expect(r.state).toBe('won');
            expect(r.pairs).toBe(8);
        });

        test('the pairs HUD reads 8/8 after winning', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            await expect(page.locator('#pairs')).toHaveText('8/8');
        });

        test('the overlay shows You Win!', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toHaveText('You Win!');
        });

        test('Play Again button is shown after winning', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets moves, pairs and state and re-hides the board', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({
                moves, pairs: matchedPairs, state,
                anyUp: cards.some(c => c.faceUp),
                anyMatched: cards.some(c => c.matched),
            }));
            expect(r.moves).toBe(0);
            expect(r.pairs).toBe(0);
            expect(r.state).toBe('running');
            expect(r.anyUp).toBe(false);
            expect(r.anyMatched).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Best score (fewest moves)
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('best score is the move count after the first win', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page); // 8 matches → 8 moves
            await expect(page.locator('#best')).toHaveText('8');
        });

        test('best persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await winWithKnownDeck(page);
            const stored = await page.evaluate(() => localStorage.getItem('memory-match-best'));
            expect(stored).toBe('8');
        });

        test('a fewer-move win lowers the best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('memory-match-best', '20'));
            await page.reload();
            await page.keyboard.press('Space');
            await winWithKnownDeck(page); // 8 moves < 20
            await expect(page.locator('#best')).toHaveText('8');
        });

        test('a higher-move win does not replace a better best', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('memory-match-best', '5'));
            await page.reload();
            await page.keyboard.press('Space');
            await winWithKnownDeck(page); // 8 moves > 5, keep 5
            await expect(page.locator('#best')).toHaveText('5');
        });

        test('best is read back from localStorage on reload', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('memory-match-best', '12'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('12');
        });
    });

    // -----------------------------------------------------------------------
    // Input: mouse and keyboard cursor
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('clicking a card flips it face up', async ({ page }) => {
            await page.keyboard.press('Space');
            const rect = await page.evaluate(() => cardRect(0));
            await page.locator('#canvas').click({
                position: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
            });
            expect(await page.evaluate(() => cards[0].faceUp)).toBe(true);
        });

        test('arrow keys move the selection cursor', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { cursor = 0; });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => cursor)).toBe(1);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => cursor)).toBe(5);
        });

        test('Enter flips the card under the cursor', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { cursor = 3; });
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => cards[3].faceUp)).toBe(true);
        });

        test('flipping is ignored before the game starts', async ({ page }) => {
            const up = await page.evaluate(() => { flipAt(0); return cards[0].faceUp; });
            expect(up).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the overlay shows Paused when paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay-title')).toHaveText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('flipping is ignored while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await setKnownDeck(page);
            await page.keyboard.press('p');
            const up = await page.evaluate(() => { flipAt(0); return cards[0].faceUp; });
            expect(up).toBe(false);
        });
    });
});
