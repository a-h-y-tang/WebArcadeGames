const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Simon', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Simon', async ({ page }) => {
            await expect(page).toHaveTitle('Simon');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to press a key', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Press');
        });

        test('score starts at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score starts at 0 when localStorage is empty', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 500×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '500');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state is idle before starting', async ({ page }) => {
            const s = await page.evaluate(() => state);
            expect(s).toBe('idle');
        });

        test('there are four pads', async ({ page }) => {
            const n = await page.evaluate(() => PADS.length);
            expect(n).toBe(4);
        });

        test('sequence is empty before starting', async ({ page }) => {
            const n = await page.evaluate(() => sequence.length);
            expect(n).toBe(0);
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

        test('Enter dismisses overlay', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button dismisses overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the first round seeds a one-pad sequence', async ({ page }) => {
            await page.keyboard.press('Space');
            const n = await page.evaluate(() => sequence.length);
            expect(n).toBe(1);
        });

        test('every step is a valid pad index', async ({ page }) => {
            await page.keyboard.press('Space');
            const ok = await page.evaluate(() =>
                sequence.every(i => Number.isInteger(i) && i >= 0 && i < PADS.length)
            );
            expect(ok).toBe(true);
        });

        test('score resets to 0 on start', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Playback → input transition (timer-driven integration)
    // -----------------------------------------------------------------------
    test.describe('playback', () => {
        test('playback hands control to the player', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'input');
            const s = await page.evaluate(() => state);
            expect(s).toBe('input');
        });

        test('input during playback is ignored', async ({ page }) => {
            await page.keyboard.press('Space');
            // While still watching, a press must not advance the player position.
            const pos = await page.evaluate(() => {
                state = 'watch';
                playerPos = 0;
                pressPad(sequence[0]);
                return playerPos;
            });
            expect(pos).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Player input (timer-free logic)
    // -----------------------------------------------------------------------
    test.describe('player input', () => {
        test('a correct press advances the player position', async ({ page }) => {
            await page.keyboard.press('Space');
            const pos = await page.evaluate(() => {
                sequence = [0, 2, 1];
                state = 'input';
                playerPos = 0;
                pressPad(0);
                return playerPos;
            });
            expect(pos).toBe(1);
        });

        test('completing the sequence scores the round', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                sequence = [0, 3];
                state = 'input';
                playerPos = 0;
                pressPad(0);
                pressPad(3);
            });
            await expect(page.locator('#score')).toHaveText('2');
        });

        test('completing the sequence leaves the input state', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                sequence = [1];
                state = 'input';
                playerPos = 0;
                pressPad(1);
                return state;
            });
            expect(s).not.toBe('input');
        });

        test('a wrong press ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => {
                sequence = [0, 1];
                state = 'input';
                playerPos = 0;
                pressPad(2); // wrong
                return state;
            });
            expect(s).toBe('over');
        });

        test('number keys map to pads', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                sequence = [0];
                state = 'input';
                playerPos = 0;
            });
            await page.keyboard.press('1'); // pad index 0
            await expect(page.locator('#score')).toHaveText('1');
        });

        test('the wrong number key ends the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                sequence = [0];
                state = 'input';
                playerPos = 0;
            });
            await page.keyboard.press('2'); // expected pad 0, pressed pad 1
            const s = await page.evaluate(() => state);
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Rounds
    // -----------------------------------------------------------------------
    test.describe('rounds', () => {
        test('addStep lengthens the sequence by one', async ({ page }) => {
            await page.keyboard.press('Space');
            const grew = await page.evaluate(() => {
                const before = sequence.length;
                addStep();
                return sequence.length - before;
            });
            expect(grew).toBe(1);
        });

        test('a new round replays from the start (player position reset)', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'input');
            const pos = await page.evaluate(() => {
                // Reproduce the single-step sequence to trigger the next round.
                pressPad(sequence[0]);
                return playerPos;
            });
            expect(pos).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pad hit-testing
    // -----------------------------------------------------------------------
    test.describe('pad hit-testing', () => {
        test('padAtPoint identifies the four quadrants', async ({ page }) => {
            const result = await page.evaluate(() => ({
                tl: padAtPoint(WIDTH * 0.25, HEIGHT * 0.25),
                tr: padAtPoint(WIDTH * 0.75, HEIGHT * 0.25),
                bl: padAtPoint(WIDTH * 0.25, HEIGHT * 0.75),
                br: padAtPoint(WIDTH * 0.75, HEIGHT * 0.75),
            }));
            expect(result).toEqual({ tl: 0, tr: 1, bl: 2, br: 3 });
        });

        test('the dead centre is not a pad', async ({ page }) => {
            const c = await page.evaluate(() => padAtPoint(WIDTH / 2, HEIGHT / 2));
            expect(c).toBe(-1);
        });

        test('clicking a pad registers input', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                sequence = [0];
                state = 'input';
                playerPos = 0;
            });
            // Click the top-left pad (index 0).
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.25);
            await expect(page.locator('#score')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('game over overlay is shown', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('Game Over');
        });

        test('game over score shows points', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#overlay-score')).toContainText('pts');
        });

        test('Play Again button is shown after game over', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => endGame());
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('restarting resets the score', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 9;
                updateHud();
                endGame();
            });
            await page.keyboard.press('Space');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best score updates on game over if higher', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 12;
                endGame();
            });
            const best = parseInt(await page.locator('#best').textContent());
            expect(best).toBeGreaterThanOrEqual(12);
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                score = 15;
                endGame();
            });
            const stored = await page.evaluate(() => localStorage.getItem('simon-best'));
            expect(parseInt(stored)).toBeGreaterThanOrEqual(15);
        });
    });
});
