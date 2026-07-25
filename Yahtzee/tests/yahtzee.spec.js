const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Yahtzee', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Yahtzee', async ({ page }) => {
            await expect(page).toHaveTitle('Yahtzee');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Space');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('game state is ready before start', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('ready');
        });

        test('there are 13 scoring categories', async ({ page }) => {
            const n = await page.evaluate(() => CATEGORIES.length);
            expect(n).toBe(13);
        });

        test('all categories start unfilled', async ({ page }) => {
            const anyFilled = await page.evaluate(
                () => CATEGORIES.some((c) => scores[c.key] !== null)
            );
            expect(anyFilled).toBe(false);
        });

        test('rolls left starts at 3', async ({ page }) => {
            const r = await page.evaluate(() => rollsLeft);
            expect(r).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('game state is running after start', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => state);
            expect(s).toBe('running');
        });

        test('rolls left is 3 at the start of a turn', async ({ page }) => {
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => rollsLeft);
            expect(r).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Rolling the dice
    // -----------------------------------------------------------------------
    test.describe('rolling', () => {
        test('rolling produces five dice with faces 1..6', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => rollDice());
            const ok = await page.evaluate(
                () => dice.length === 5 && dice.every((d) => d >= 1 && d <= 6)
            );
            expect(ok).toBe(true);
        });

        test('rolling decrements rolls left', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => rollDice());
            const r = await page.evaluate(() => rollsLeft);
            expect(r).toBe(2);
        });

        test('rolls left never goes below 0', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                rollDice();
                rollDice();
                rollDice(); // 4th roll should be ignored
            });
            const r = await page.evaluate(() => rollsLeft);
            expect(r).toBe(0);
        });

        test('held dice are not re-rolled', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => {
                rollDice();
                // Hold every die, then roll again.
                for (let i = 0; i < 5; i++) held[i] = true;
                const snapshot = [...dice];
                rollDice();
                return { snapshot, after: [...dice] };
            });
            expect(before.after).toEqual(before.snapshot);
        });

        test('the Roll button rolls the dice', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#btn-roll').click();
            const r = await page.evaluate(() => rollsLeft);
            expect(r).toBe(2);
        });

        test('number keys toggle holding a die after a roll', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => rollDice());
            await page.keyboard.press('1');
            const h = await page.evaluate(() => held[0]);
            expect(h).toBe(true);
        });

        test('cannot hold a die before rolling', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('1');
            const h = await page.evaluate(() => held[0]);
            expect(h).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Category scoring (pure logic)
    // -----------------------------------------------------------------------
    test.describe('scoring rules', () => {
        const cases = [
            ['ones', [1, 1, 3, 4, 1], 3],
            ['twos', [2, 2, 2, 5, 6], 6],
            ['sixes', [6, 6, 1, 2, 3], 12],
            ['threeKind', [5, 5, 5, 2, 3], 20],
            ['threeKind', [1, 2, 3, 4, 5], 0],
            ['fourKind', [6, 6, 6, 6, 2], 26],
            ['fourKind', [6, 6, 6, 2, 2], 0],
            ['fullHouse', [3, 3, 3, 2, 2], 25],
            ['fullHouse', [3, 3, 3, 3, 2], 0],
            ['smallStraight', [1, 2, 3, 4, 6], 30],
            ['smallStraight', [1, 2, 3, 5, 6], 0],
            ['largeStraight', [2, 3, 4, 5, 6], 40],
            ['largeStraight', [1, 2, 3, 4, 6], 0],
            ['yahtzee', [4, 4, 4, 4, 4], 50],
            ['yahtzee', [4, 4, 4, 4, 2], 0],
            ['chance', [1, 2, 3, 4, 5], 15],
        ];

        for (const [key, roll, expected] of cases) {
            test(`${key} on [${roll}] scores ${expected}`, async ({ page }) => {
                const got = await page.evaluate(
                    ([k, d]) => scoreFor(k, d),
                    [key, roll]
                );
                expect(got).toBe(expected);
            });
        }
    });

    // -----------------------------------------------------------------------
    // Taking a scoring action
    // -----------------------------------------------------------------------
    test.describe('scoring a category', () => {
        test('scoring fills the category and advances the turn', async ({ page }) => {
            await page.keyboard.press('Space');
            const result = await page.evaluate(() => {
                rollDice();
                dice = [1, 2, 3, 4, 5];
                scoreCategory('chance');
                return { chance: scores.chance, rollsLeft, filled: turn };
            });
            expect(result.chance).toBe(15);
            expect(result.rollsLeft).toBe(3); // new turn
            expect(result.filled).toBe(1);
        });

        test('cannot score before rolling', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => scoreCategory('chance'));
            const filled = await page.evaluate(() => scores.chance);
            expect(filled).toBe(null);
        });

        test('cannot re-score a used category', async ({ page }) => {
            await page.keyboard.press('Space');
            const val = await page.evaluate(() => {
                rollDice();
                dice = [1, 1, 1, 1, 1];
                scoreCategory('ones'); // scores 5
                rollDice();
                dice = [1, 1, 1, 1, 1];
                scoreCategory('ones'); // should be ignored
                return scores.ones;
            });
            expect(val).toBe(5);
        });

        test('the score total updates in the DOM after scoring', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [6, 6, 6, 6, 6];
                scoreCategory('sixes'); // 30
            });
            await expect(page.locator('#score')).toHaveText('30');
        });

        test('clicking a category row scores it', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [2, 2, 2, 2, 3];
            });
            await page.locator('#row-twos').click();
            const v = await page.evaluate(() => scores.twos);
            expect(v).toBe(8);
        });

        test('a filled category shows its value in its row', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [5, 5, 5, 5, 5];
                scoreCategory('fives'); // 25
            });
            await expect(page.locator('#val-fives')).toHaveText('25');
        });
    });

    // -----------------------------------------------------------------------
    // Totals and bonus
    // -----------------------------------------------------------------------
    test.describe('totals and bonus', () => {
        test('upper bonus applies when the upper subtotal reaches 63', async ({ page }) => {
            const bonus = await page.evaluate(() => {
                startGame();
                scores.ones = 3;
                scores.twos = 6;
                scores.threes = 9;
                scores.fours = 12;
                scores.fives = 15;
                scores.sixes = 18; // subtotal 63
                return { bonus: upperBonus(), sub: upperSubtotal() };
            });
            expect(bonus.sub).toBe(63);
            expect(bonus.bonus).toBe(35);
        });

        test('no upper bonus below 63', async ({ page }) => {
            const bonus = await page.evaluate(() => {
                startGame();
                scores.ones = 1;
                return upperBonus();
            });
            expect(bonus).toBe(0);
        });

        test('grand total sums categories plus the bonus', async ({ page }) => {
            const total = await page.evaluate(() => {
                startGame();
                scores.ones = 3;
                scores.twos = 6;
                scores.threes = 9;
                scores.fours = 12;
                scores.fives = 15;
                scores.sixes = 18; // subtotal 63 -> +35 bonus
                scores.yahtzee = 50;
                return grandTotal();
            });
            expect(total).toBe(63 + 35 + 50);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('filling all categories ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                for (const c of CATEGORIES) {
                    rollDice();
                    scoreCategory(c.key);
                }
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over overlay is shown with the final score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [6, 6, 6, 6, 6];
                scoreCategory('sixes'); // 30
                endGame();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
            await expect(page.locator('#overlay-score')).toContainText('30');
        });

        test('Play Again button is visible after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restart resets the scorecard and score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [6, 6, 6, 6, 6];
                scoreCategory('sixes');
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            const anyFilled = await page.evaluate(
                () => CATEGORIES.some((c) => scores[c.key] !== null)
            );
            expect(anyFilled).toBe(false);
        });

        test('best score updates on game over when higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [6, 6, 6, 6, 6];
                scoreCategory('sixes'); // 30
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('30');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                rollDice();
                dice = [5, 5, 5, 5, 5];
                scoreCategory('fives'); // 25
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('yahtzee-best'));
            expect(parseInt(stored)).toBe(25);
        });
    });
});
