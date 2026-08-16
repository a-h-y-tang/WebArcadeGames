const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Every handled keydown bumps `inputCount`, so a press can be confirmed as
// *processed* even when the game correctly refuses to move a hand. Without this
// the negative movement specs would race the browser's event dispatch.
const press = async (page, key) => {
    const before = await page.evaluate(() => inputCount);
    await page.keyboard.press(key);
    await page.waitForFunction((n) => inputCount > n, before);
};

// Start a game with both hazard spawners switched off so long simulations stay
// deterministic. Specs that are about a hazard drive that hazard directly.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        potSpawnEnabled = false;
        shutterEnabled = false;
    });

// Put the climber at a known height without simulating the whole climb.
// `maxHeight` is banked at the same time so the live render loop cannot award
// the skipped rows a frame later and disturb specs that assert on the score.
const placeHands = (page, row, leftCol = 3) =>
    page.evaluate(([r, c]) => {
        leftHand.col = c;
        leftHand.row = r;
        rightHand.col = c + 1;
        rightHand.row = r;
        openCell(r, c);
        openCell(r, c + 1);
        maxHeight = Math.max(maxHeight, r);
        updateHud();
    }, [row, leftCol]);

const hands = (page) =>
    page.evaluate(() => ({
        left: { col: leftHand.col, row: leftHand.row },
        right: { col: rightHand.col, row: rightHand.row },
    }));

test.describe('Sky Climber', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => localStorage.clear());
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Sky Climber', async ({ page }) => {
            await expect(page).toHaveTitle('Sky Climber');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, lives and height', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#height')).toHaveText('0');
        });

        test('help text documents both hand controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/left hand/i);
            await expect(help).toContainText(/right hand/i);
        });

        test('step does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnPot(0));
            const before = await page.evaluate(() => pots[0].row);
            await advance(page, 60);
            expect(await page.evaluate(() => pots[0].row)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Space starts the game', async ({ page }) => {
            await press(page, 'Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await press(page, 'Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay is hidden once running', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('both hands start at street level on adjacent columns', async ({ page }) => {
            await startQuiet(page);
            const h = await hands(page);
            expect(h.left.row).toBe(0);
            expect(h.right.row).toBe(0);
            expect(h.right.col - h.left.col).toBe(1);
        });

        test('the wall starts fully open', async ({ page }) => {
            await startQuiet(page);
            const allOpen = await page.evaluate(() =>
                wall.every((row) => row.every((cell) => cell.state === 'open'))
            );
            expect(allOpen).toBe(true);
        });

        test('the roof is 20 rows up on level 1', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => roofRow)).toBe(20);
        });
    });

    // -----------------------------------------------------------------------
    // Hand movement
    // -----------------------------------------------------------------------
    test.describe('hand movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('W moves the left hand up one row', async ({ page }) => {
            await press(page, 'w');
            const h = await hands(page);
            expect(h.left.row).toBe(1);
            expect(h.right.row).toBe(0);
        });

        test('ArrowUp moves the right hand up one row', async ({ page }) => {
            await press(page, 'ArrowUp');
            const h = await hands(page);
            expect(h.right.row).toBe(1);
            expect(h.left.row).toBe(0);
        });

        test('S moves the left hand back down', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'ArrowUp');
            await press(page, 's');
            expect((await hands(page)).left.row).toBe(0);
        });

        test('ArrowDown moves the right hand back down', async ({ page }) => {
            await press(page, 'ArrowUp');
            await press(page, 'w');
            await press(page, 'ArrowDown');
            expect((await hands(page)).right.row).toBe(0);
        });

        test('a staggered left hand can step right into the other column', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'd');
            const h = await hands(page);
            expect(h.left.col).toBe(h.right.col);
            expect(h.left.row).toBe(1);
        });

        test('the right hand then leads further right', async ({ page }) => {
            const start = await hands(page);
            await press(page, 'w');
            await press(page, 'd');
            await press(page, 'ArrowRight');
            const h = await hands(page);
            expect(h.right.col).toBe(start.right.col + 1);
        });

        test('a staggered right hand can step left into the other column', async ({ page }) => {
            const start = await hands(page);
            await press(page, 'w');
            await press(page, 'ArrowLeft');
            const h = await hands(page);
            expect(h.right.col).toBe(start.left.col);
            expect(h.left.col).toBe(start.left.col);
        });

        test('alternating W and ArrowUp climbs the wall', async ({ page }) => {
            for (let i = 0; i < 4; i++) {
                await press(page, 'w');
                await press(page, 'ArrowUp');
            }
            const h = await hands(page);
            expect(h.left.row).toBe(4);
            expect(h.right.row).toBe(4);
        });

        test('moveHand reports whether the move was legal', async ({ page }) => {
            const ok = await page.evaluate(() => moveHand('left', 0, 1));
            const blocked = await page.evaluate(() => moveHand('left', 0, 1));
            expect(ok).toBe(true);
            expect(blocked).toBe(false);
        });

        test('hands do not move before the game starts', async ({ page }) => {
            await page.reload();
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Movement rules
    // -----------------------------------------------------------------------
    test.describe('movement rules', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('hands cannot stretch more than one row apart', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(1);
        });

        test('a hand cannot move onto the other hand', async ({ page }) => {
            const start = await hands(page);
            await press(page, 'd');
            expect((await hands(page)).left.col).toBe(start.left.col);
        });

        test('the left hand cannot cross to the right of the right hand', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'd');
            const mid = await hands(page);
            await press(page, 'd');
            expect((await hands(page)).left.col).toBe(mid.left.col);
        });

        test('the right hand cannot cross to the left of the left hand', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'ArrowLeft');
            const mid = await hands(page);
            await press(page, 'ArrowLeft');
            expect((await hands(page)).right.col).toBe(mid.right.col);
        });

        test('hands cannot leave the wall on the left', async ({ page }) => {
            await page.evaluate(() => {
                leftHand.col = 0;
                leftHand.row = 1;
                rightHand.col = 1;
                rightHand.row = 0;
            });
            await press(page, 'a');
            expect((await hands(page)).left.col).toBe(0);
        });

        test('hands cannot leave the wall on the right', async ({ page }) => {
            await page.evaluate(() => {
                leftHand.col = COLS - 1;
                leftHand.row = 1;
                rightHand.col = COLS - 1;
                rightHand.row = 0;
            });
            await press(page, 'ArrowRight');
            const lastCol = await page.evaluate(() => COLS - 1);
            expect((await hands(page)).right.col).toBe(lastCol);
        });

        test('hands cannot go below street level', async ({ page }) => {
            await press(page, 's');
            expect((await hands(page)).left.row).toBe(0);
        });

        test('hands cannot climb past the roof', async ({ page }) => {
            // Only the leading hand is on the roof, so the building is not
            // cleared and the climber stays put.
            const roof = await page.evaluate(() => {
                leftHand.col = 3;
                leftHand.row = roofRow;
                rightHand.col = 4;
                rightHand.row = roofRow - 1;
                return roofRow;
            });
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(roof);
        });

        test('a hand cannot grab a closing window', async ({ page }) => {
            await page.evaluate(() => triggerShutter(1, leftHand.col));
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(0);
        });

        test('a hand cannot grab a closed window', async ({ page }) => {
            await page.evaluate(() => triggerShutter(1, leftHand.col));
            await advance(page, 60);
            expect(await page.evaluate(() => cellState(1, leftHand.col))).toBe('closed');
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Height and scoring
    // -----------------------------------------------------------------------
    test.describe('height and scoring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('height only counts once both hands are up', async ({ page }) => {
            await press(page, 'w');
            await advance(page, 1);
            expect(await page.evaluate(() => maxHeight)).toBe(0);
            await press(page, 'ArrowUp');
            await advance(page, 1);
            expect(await page.evaluate(() => maxHeight)).toBe(1);
        });

        test('climbing scores 10 points per row', async ({ page }) => {
            for (let i = 0; i < 3; i++) {
                await press(page, 'w');
                await press(page, 'ArrowUp');
            }
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(30);
        });

        test('re-climbing covered ground scores nothing', async ({ page }) => {
            for (let i = 0; i < 3; i++) {
                await press(page, 'w');
                await press(page, 'ArrowUp');
            }
            await advance(page, 1);
            for (let i = 0; i < 2; i++) {
                await press(page, 's');
                await press(page, 'ArrowDown');
            }
            for (let i = 0; i < 2; i++) {
                await press(page, 'w');
                await press(page, 'ArrowUp');
            }
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(30);
        });

        test('the HUD shows the current height', async ({ page }) => {
            for (let i = 0; i < 2; i++) {
                await press(page, 'w');
                await press(page, 'ArrowUp');
            }
            await advance(page, 1);
            await expect(page.locator('#height')).toHaveText('2');
        });

        test('the HUD shows the current score', async ({ page }) => {
            await press(page, 'w');
            await press(page, 'ArrowUp');
            await advance(page, 1);
            await expect(page.locator('#score')).toHaveText('10');
        });
    });

    // -----------------------------------------------------------------------
    // Shutters
    // -----------------------------------------------------------------------
    test.describe('shutters', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a triggered window starts closing', async ({ page }) => {
            await page.evaluate(() => triggerShutter(4, 2));
            expect(await page.evaluate(() => cellState(4, 2))).toBe('closing');
        });

        test('a closing window becomes closed', async ({ page }) => {
            await page.evaluate(() => triggerShutter(4, 2));
            await advance(page, 60);
            expect(await page.evaluate(() => cellState(4, 2))).toBe('closed');
        });

        test('a closed window opens again', async ({ page }) => {
            await page.evaluate(() => triggerShutter(4, 2));
            await advance(page, 300);
            expect(await page.evaluate(() => cellState(4, 2))).toBe('open');
        });

        test('a shutter closing under a hand knocks the climber down', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => triggerShutter(8, leftHand.col));
            await advance(page, 60);
            const h = await hands(page);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(h.left.row).toBe(5);
            expect(h.right.row).toBe(5);
        });

        test('a shutter elsewhere leaves the climber alone', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => triggerShutter(2, 0));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect((await hands(page)).left.row).toBe(8);
        });

        test('the climber always lands on open windows', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => {
                triggerShutter(5, leftHand.col);
                triggerShutter(5, rightHand.col);
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            const landed = await page.evaluate(() => [
                cellState(leftHand.row, leftHand.col),
                cellState(rightHand.row, rightHand.col),
            ]);
            expect(landed).toEqual(['open', 'open']);
        });

        test('shutters stay off when disabled', async ({ page }) => {
            await advance(page, 900);
            const allOpen = await page.evaluate(() =>
                wall.every((row) => row.every((cell) => cell.state === 'open'))
            );
            expect(allOpen).toBe(true);
        });

        test('shutters appear on their own once enabled', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(7);
                shutterEnabled = true;
            });
            await advance(page, 600);
            const anyShut = await page.evaluate(() =>
                wall.some((row) => row.some((cell) => cell.state !== 'open'))
            );
            expect(anyShut).toBe(true);
        });

        test('the roof row never gets a shutter', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(3);
                shutterEnabled = true;
            });
            await advance(page, 1800);
            const roofOpen = await page.evaluate(() =>
                wall[roofRow].every((cell) => cell.state === 'open')
            );
            expect(roofOpen).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Falling pots
    // -----------------------------------------------------------------------
    test.describe('falling pots', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a pot spawns above the roof', async ({ page }) => {
            await page.evaluate(() => spawnPot(2));
            const pot = await page.evaluate(() => ({ col: pots[0].col, row: pots[0].row }));
            expect(pot.col).toBe(2);
            expect(pot.row).toBeGreaterThan(await page.evaluate(() => roofRow));
        });

        test('pots fall downwards', async ({ page }) => {
            await page.evaluate(() => spawnPot(2));
            const before = await page.evaluate(() => pots[0].row);
            await advance(page, 30);
            expect(await page.evaluate(() => pots[0].row)).toBeLessThan(before);
        });

        test('a pot in the climber\'s column costs a life', async ({ page }) => {
            await placeHands(page, 6);
            await page.evaluate(() => spawnPot(leftHand.col));
            await advance(page, 360);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a pot knocks the climber down the wall', async ({ page }) => {
            await placeHands(page, 6);
            await page.evaluate(() => spawnPot(leftHand.col));
            await advance(page, 360);
            expect((await hands(page)).left.row).toBe(3);
        });

        test('a pot in another column misses', async ({ page }) => {
            await placeHands(page, 6, 0);
            await page.evaluate(() => spawnPot(COLS - 1));
            await advance(page, 480);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect((await hands(page)).left.row).toBe(6);
        });

        test('pots are removed once past the street', async ({ page }) => {
            await placeHands(page, 6, 0);
            await page.evaluate(() => spawnPot(COLS - 1));
            await advance(page, 600);
            expect(await page.evaluate(() => pots.length)).toBe(0);
        });

        test('a pot that hits is consumed', async ({ page }) => {
            await placeHands(page, 6);
            await page.evaluate(() => {
                spawnPot(leftHand.col);
                pots[0].row = leftHand.row + 0.5;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => pots.length)).toBe(0);
        });

        test('invulnerability blocks a second hit straight away', async ({ page }) => {
            await placeHands(page, 6);
            const dropPot = () =>
                page.evaluate(() => {
                    spawnPot(leftHand.col);
                    pots[0].row = leftHand.row + 0.5;
                });
            await dropPot();
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
            await dropPot();
            await advance(page, 2);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('pots stay away when spawning is disabled', async ({ page }) => {
            await advance(page, 900);
            expect(await page.evaluate(() => pots.length)).toBe(0);
        });

        test('pots arrive on their own once enabled', async ({ page }) => {
            await page.evaluate(() => {
                setSeed(11);
                potSpawnEnabled = true;
            });
            await advance(page, 300);
            expect(await page.evaluate(() => pots.length)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the HUD tracks remaining lives', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => triggerShutter(8, leftHand.col));
            await advance(page, 60);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the last life ends the game', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => {
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('game over shows the overlay', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => {
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('game over reports the final score', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => {
                score = 420;
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            await expect(page.locator('#overlay-score')).toContainText('420');
        });

        test('a knock never drops the climber below the street', async ({ page }) => {
            await placeHands(page, 1);
            await page.evaluate(() => triggerShutter(1, leftHand.col));
            await advance(page, 60);
            expect((await hands(page)).left.row).toBe(0);
        });

        test('restarting resets score, lives and level', async ({ page }) => {
            await placeHands(page, 8);
            await page.evaluate(() => {
                score = 420;
                level = 3;
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            await press(page, 'Space');
            const fresh = await page.evaluate(() => ({ state, score, lives, level }));
            expect(fresh).toEqual({ state: 'running', score: 0, lives: 3, level: 1 });
        });
    });

    // -----------------------------------------------------------------------
    // Reaching the roof
    // -----------------------------------------------------------------------
    test.describe('reaching the roof', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('both hands on the roof clears the building', async ({ page }) => {
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing a building pays a bonus', async ({ page }) => {
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(500);
        });

        test('the next building is taller', async ({ page }) => {
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            expect(await page.evaluate(() => roofRow)).toBe(25);
        });

        test('the climber restarts at street level', async ({ page }) => {
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            const h = await hands(page);
            expect(h.left.row).toBe(0);
            expect(h.right.row).toBe(0);
            expect(await page.evaluate(() => maxHeight)).toBe(0);
        });

        test('one hand on the roof is not enough', async ({ page }) => {
            await page.evaluate(() => {
                leftHand.col = 3;
                leftHand.row = roofRow;
                rightHand.col = 4;
                rightHand.row = roofRow - 1;
            });
            await advance(page, 1);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('the new building starts with a clean wall', async ({ page }) => {
            await page.evaluate(() => triggerShutter(4, 2));
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            const allOpen = await page.evaluate(() =>
                wall.every((row) => row.every((cell) => cell.state === 'open'))
            );
            expect(allOpen).toBe(true);
        });

        test('the HUD shows the new level', async ({ page }) => {
            await placeHands(page, await page.evaluate(() => roofRow));
            await advance(page, 1);
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await startQuiet(page);
            await press(page, 'p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('P resumes a paused game', async ({ page }) => {
            await startQuiet(page);
            await press(page, 'p');
            await press(page, 'p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPot(2));
            await press(page, 'p');
            const before = await page.evaluate(() => pots[0].row);
            await advance(page, 60);
            expect(await page.evaluate(() => pots[0].row)).toBe(before);
        });

        test('hands do not move while paused', async ({ page }) => {
            await startQuiet(page);
            await press(page, 'p');
            await press(page, 'w');
            expect((await hands(page)).left.row).toBe(0);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await press(page, 'p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('the best score is stored after a game', async ({ page }) => {
            await startQuiet(page);
            await placeHands(page, 8);
            await page.evaluate(() => {
                score = 640;
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            await expect(page.locator('#best')).toHaveText('640');
            expect(await page.evaluate(() => localStorage.getItem('skyclimber-best'))).toBe('640');
        });

        test('a worse game does not lower the best score', async ({ page }) => {
            await page.evaluate(() => localStorage.setItem('skyclimber-best', '999'));
            await page.reload();
            await startQuiet(page);
            await placeHands(page, 8);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                triggerShutter(8, leftHand.col);
            });
            await advance(page, 60);
            await expect(page.locator('#best')).toHaveText('999');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('drawing does not throw in any state', async ({ page }) => {
            const ok = await page.evaluate(() => {
                draw();
                startGame();
                draw();
                togglePause();
                draw();
                return true;
            });
            expect(ok).toBe(true);
        });

        test('drawing leaves the simulation untouched', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPot(2));
            const before = await page.evaluate(() => pots[0].row);
            await page.evaluate(() => draw());
            expect(await page.evaluate(() => pots[0].row)).toBe(before);
        });

        test('the canvas actually paints something', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => draw());
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, 560, 480).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
