const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Frostbite', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Frostbite', async ({ page }) => {
            await expect(page).toHaveTitle('Frostbite');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('hop');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at 3', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are four ice lanes', async ({ page }) => {
            expect(await page.evaluate(() => lanes.length)).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // floeUnder — the core collision rule (pure function)
    // -----------------------------------------------------------------------
    test.describe('floeUnder', () => {
        test('reports true over a floe and false over a gap', async ({ page }) => {
            const result = await page.evaluate(() => {
                const lane = { dir: 1, offset: 0, color: 'white' };
                return {
                    onFloe: floeUnder(lane, FLOE_W / 2),      // inside the first floe
                    inGap:  floeUnder(lane, FLOE_W + FLOE_GAP / 2), // inside the gap
                };
            });
            expect(result.onFloe).toBe(true);
            expect(result.inGap).toBe(false);
        });

        test('is periodic with PERIOD', async ({ page }) => {
            const same = await page.evaluate(() => {
                const lane = { dir: 1, offset: 0, color: 'white' };
                return floeUnder(lane, 5) === floeUnder(lane, 5 + PERIOD);
            });
            expect(same).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('ArrowUp dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space dismisses the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
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

        test('player starts on the bottom shore (row 5)', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => player.row)).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('ArrowRight moves the player right', async ({ page }) => {
            await page.keyboard.press('Space');
            const startX = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(200);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(startX);
        });

        test('the player is clamped inside the canvas', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.x = WIDTH - 4; });
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(250);
            await page.keyboard.up('ArrowRight');
            const ok = await page.evaluate(() => player.x <= WIDTH + 0.001);
            expect(ok).toBe(true);
        });

        test('ArrowUp hops the player up a row', async ({ page }) => {
            await page.keyboard.press('Space');           // starts, player at row 5
            await page.keyboard.press('ArrowUp');         // hop to row 4
            expect(await page.evaluate(() => player.row)).toBe(4);
        });

        test('cannot hop above the top row', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { player.row = 0; });
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.row)).toBe(0);
        });

        test('cannot hop below the bottom row', async ({ page }) => {
            await page.keyboard.press('Space');           // row 5
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.row)).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Floes drift and carry the player
    // -----------------------------------------------------------------------
    test.describe('drifting floes', () => {
        test('lane offsets change over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => lanes[0].offset);
            await page.evaluate(() => update(120));
            const after = await page.evaluate(() => lanes[0].offset);
            expect(after).not.toBe(before);
        });

        test('standing on a floe carries the player along', async ({ page }) => {
            await page.keyboard.press('Space');
            const moved = await page.evaluate(() => {
                player.row = 1;             // an ice lane
                player.x = 250;
                lanes[0].dir = 1;
                lanes[0].offset = 0;        // floe under x=250
                const before = player.x;
                update(100);
                return player.x !== before;
            });
            expect(moved).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Harvesting blocks
    // -----------------------------------------------------------------------
    test.describe('harvesting', () => {
        test('landing on a white lane harvests a block and scores', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                player.row = 0;
                player.x = FLOE_W / 2;        // squarely on the first floe
                lanes[0].offset = 0;
                lanes[0].color = 'white';
                const beforeBlocks = blocks;
                const beforeScore = score;
                hopVertical(1);               // hop down onto lane row 1
                return {
                    dBlocks: blocks - beforeBlocks,
                    dScore: score - beforeScore,
                    color: lanes[0].color,
                    row: player.row,
                };
            });
            expect(res.dBlocks).toBe(1);
            expect(res.dScore).toBeGreaterThan(0);
            expect(res.color).toBe('blue');
            expect(res.row).toBe(1);
        });

        test('landing on an already-blue lane harvests nothing', async ({ page }) => {
            await page.keyboard.press('Space');
            const dBlocks = await page.evaluate(() => {
                player.row = 0;
                player.x = FLOE_W / 2;
                lanes[0].offset = 0;
                lanes[0].color = 'blue';
                const before = blocks;
                hopVertical(1);
                return blocks - before;
            });
            expect(dBlocks).toBe(0);
        });

        test('all four lanes turning blue resets them to white', async ({ page }) => {
            await page.keyboard.press('Space');
            const colors = await page.evaluate(() => {
                // Pre-blue three lanes; harvest the fourth to trigger the reset.
                lanes[0].color = 'blue';
                lanes[1].color = 'blue';
                lanes[2].color = 'blue';
                lanes[3].color = 'white';
                lanes[3].offset = 0;
                player.row = 0;
                player.x = FLOE_W / 2;
                hopVertical(1); player.row = 0;   // land row1
                // now hop to row4 (index 3) directly for the test
                player.row = 3;
                player.x = FLOE_W / 2;
                hopVertical(1);                   // land row4 -> 4th blue -> reset
                return lanes.map(l => l.color);
            });
            expect(colors.every(c => c === 'white')).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Death: water and freezing
    // -----------------------------------------------------------------------
    test.describe('death', () => {
        test('hopping onto a gap costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                player.row = 0;
                lanes[0].offset = 0;
                player.x = FLOE_W + FLOE_GAP / 2;   // over a gap
                const before = lives;
                hopVertical(1);
                return { before, after: lives, row: player.row };
            });
            expect(res.after).toBe(res.before - 1);
            expect(res.row).toBe(5);                // reset to bottom shore
        });

        test('the temperature falls over time', async ({ page }) => {
            await page.keyboard.press('Space');
            const before = await page.evaluate(() => temperature);
            await page.evaluate(() => update(500));
            expect(await page.evaluate(() => temperature)).toBeLessThan(before);
        });

        test('temperature reaching zero costs a life', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                temperature = 0.0001;
                const before = lives;
                update(1000);
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before - 1);
        });

        test('losing the last life ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                lives = 1;
                player.row = 0;
                lanes[0].offset = 0;
                player.x = FLOE_W + FLOE_GAP / 2;   // over a gap
                hopVertical(1);
                return state;
            });
            expect(s).toBe('over');
        });

        test('landing safely on a floe does not cost a life', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                player.row = 0;
                lanes[0].offset = 0;
                player.x = FLOE_W / 2;              // on a floe
                const before = lives;
                hopVertical(1);
                return { before, after: lives };
            });
            expect(res.after).toBe(res.before);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('floes drift faster on later levels', async ({ page }) => {
            const faster = await page.evaluate(() => laneSpeed(3) > laneSpeed(1));
            expect(faster).toBe(true);
        });

        test('completing the igloo and reaching the top shore advances the level', async ({ page }) => {
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => {
                blocks = BLOCKS_PER_IGLOO;   // igloo complete
                player.row = 1;
                hopVertical(-1);             // hop up to the top shore (row 0)
                return { level, blocks };
            });
            expect(res.level).toBe(2);
            expect(res.blocks).toBe(0);
        });

        test('reaching the top shore with an unfinished igloo does not advance', async ({ page }) => {
            await page.keyboard.press('Space');
            const level = await page.evaluate(() => {
                blocks = 3;                  // not enough
                player.row = 1;
                hopVertical(-1);
                return level;
            });
            expect(level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pause / resume
    // -----------------------------------------------------------------------
    test.describe('pause and resume', () => {
        test('P pauses a running game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pause overlay shows "Paused"', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the temperature holds steady while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            const before = await page.evaluate(() => temperature);
            await page.waitForTimeout(300);
            expect(await page.evaluate(() => temperature)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('endGame shows the game over overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('Play Again button appears after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('best score updates on game over when score is higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 42; endGame(); });
            await expect(page.locator('#best')).toHaveText('42');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 30; endGame(); });
            const stored = await page.evaluate(() => localStorage.getItem('frostbite-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(30);
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 99; lives = 1; level = 4; endGame(); });
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            await expect(page.locator('#score')).toHaveText('0');
            const { lives, level } = await page.evaluate(() => ({ lives, level }));
            expect(lives).toBe(3);
            expect(level).toBe(1);
        });
    });
});
