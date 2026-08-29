const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with every random system switched off and the whole wall open,
// so a spec only sees the mechanic it is about. `autoStep = false` parks the
// requestAnimationFrame loop, which would otherwise race the manual stepping.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        potsEnabled = false;
        windowCycling = false;
        graceTimer = 0;
        openAllWindows();
    });

const bodyRow = (page) => page.evaluate(() => bodyRow());
const hands = (page) =>
    page.evaluate(() => ({
        leftCol: climber.leftCol,
        rightCol: climber.rightCol,
        leftRow: climber.leftRow,
        rightRow: climber.rightRow,
    }));

// Climb `n` rows the honest way: alternate hands.
const climbTo = (page, row) =>
    page.evaluate((target) => {
        while (bodyRow() < target) {
            tryRaise('left');
            tryRaise('right');
        }
    }, row);

test.describe('Sky Climber', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
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

        test('canvas is 520x640', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '640');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level, height and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#height')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('the building is five columns wide', async ({ page }) => {
            expect(await page.evaluate(() => COLS)).toBe(5);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the start button begins a run and hides the overlay', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space begins a run', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
        });

        test('a new run starts with both hands on the street ledge', async ({ page }) => {
            await startQuiet(page);
            const h = await hands(page);
            expect(h.leftRow).toBe(0);
            expect(h.rightRow).toBe(0);
            expect(h.rightCol).toBe(h.leftCol + 1);
        });

        test('the first building is ROWS_BASE rows tall', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => rows)).toBe(await page.evaluate(() => ROWS_BASE));
            expect(await page.evaluate(() => roofRow)).toBe(await page.evaluate(() => rows - 1));
        });
    });

    // -----------------------------------------------------------------------
    // Climbing
    // -----------------------------------------------------------------------
    test.describe('climbing', () => {
        test('raising one hand lifts that hand but not the body', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => tryRaise('left'))).toBe(true);
            const h = await hands(page);
            expect(h.leftRow).toBe(1);
            expect(h.rightRow).toBe(0);
            expect(await bodyRow(page)).toBe(0);
        });

        test('a hand cannot climb more than one row above its partner', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => tryRaise('left'));
            expect(await page.evaluate(() => tryRaise('left'))).toBe(false);
            expect((await hands(page)).leftRow).toBe(1);
        });

        test('raising both hands raises the body', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                tryRaise('left');
                tryRaise('right');
            });
            expect(await bodyRow(page)).toBe(1);
        });

        test('lowering a hand drops the body back down', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 3);
            await page.evaluate(() => tryLower('left'));
            expect(await bodyRow(page)).toBe(2);
        });

        test('hands cannot go below the street', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => tryLower('left'))).toBe(false);
            expect((await hands(page)).leftRow).toBe(0);
        });

        test('a hand cannot grab a closed window', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => setWindow(climber.leftCol, 1, 'closed'));
            expect(await page.evaluate(() => tryRaise('left'))).toBe(false);
            expect((await hands(page)).leftRow).toBe(0);
        });

        test('a closing window can still be climbed off but not onto', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => setWindow(climber.leftCol, 1, 'closing'));
            expect(await page.evaluate(() => tryRaise('left'))).toBe(false);
        });

        test('climbing to a new height scores ten points per row', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 4);
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => 4 * ROW_POINTS));
            await expect(page.locator('#height')).toHaveText('4');
        });

        test('re-climbing ground already covered scores nothing', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 4);
            await advance(page, 1);
            await page.evaluate(() => {
                tryLower('left');
                tryLower('right');
            });
            await advance(page, 1);
            await climbTo(page, 4);
            await advance(page, 1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => 4 * ROW_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Moving sideways
    // -----------------------------------------------------------------------
    test.describe('sideways movement', () => {
        test('shifting moves both hands one column', async ({ page }) => {
            await startQuiet(page);
            const before = await hands(page);
            expect(await page.evaluate(() => tryShift(1))).toBe(true);
            const after = await hands(page);
            expect(after.leftCol).toBe(before.leftCol + 1);
            expect(after.rightCol).toBe(before.rightCol + 1);
            expect(after.leftRow).toBe(before.leftRow);
        });

        test('the climber cannot shift off the edge of the building', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                while (tryShift(1)) { /* walk to the right edge */ }
            });
            expect((await hands(page)).rightCol).toBe((await page.evaluate(() => COLS)) - 1);
            expect(await page.evaluate(() => tryShift(1))).toBe(false);
        });

        test('shifting needs both hands on the same row', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => tryRaise('left'));
            expect(await page.evaluate(() => tryShift(1))).toBe(false);
        });

        test('the climber cannot shift onto a closed window', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 1);
            await page.evaluate(() => setWindow(climber.rightCol + 1, 1, 'closed'));
            expect(await page.evaluate(() => tryShift(1))).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Windows
    // -----------------------------------------------------------------------
    test.describe('windows', () => {
        test('the street ledge is always open', async ({ page }) => {
            await startQuiet(page);
            const allOpen = await page.evaluate(() => {
                windowCycling = true;
                for (let i = 0; i < 3600; i++) step(1 / 60);
                return windows.every((col) => col[0].state === 'open');
            });
            expect(allOpen).toBe(true);
        });

        test('windows cycle shut over time', async ({ page }) => {
            await startQuiet(page);
            const shut = await page.evaluate(() => {
                windowCycling = true;
                for (let i = 0; i < 1200; i++) step(1 / 60);
                return windows.some((col) => col.some((w) => w.state !== 'open'));
            });
            expect(shut).toBe(true);
        });

        test('a window closing under a hand drops the climber a row', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 4);
            await page.evaluate(() => setWindow(climber.leftCol, 4, 'closed'));
            await advance(page, 1);
            expect(await bodyRow(page)).toBe(3);
            const h = await hands(page);
            expect(h.leftRow).toBe(3);
            expect(h.rightRow).toBe(3);
        });

        test('a closing window still holds the climber', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 4);
            await page.evaluate(() => setWindow(climber.leftCol, 4, 'closing'));
            await advance(page, 1);
            expect(await bodyRow(page)).toBe(4);
        });

        test('the climber slides past shut rows down to the street', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 4);
            await page.evaluate(() => {
                for (let r = 1; r <= 4; r++) {
                    setWindow(climber.leftCol, r, 'closed');
                    setWindow(climber.rightCol, r, 'closed');
                }
            });
            await advance(page, 1);
            expect(await bodyRow(page)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Flower pots
    // -----------------------------------------------------------------------
    test.describe('flower pots', () => {
        test('a pot falls down its column', async ({ page }) => {
            await startQuiet(page);
            const dropped = await page.evaluate(() => {
                spawnPot(0);
                const start = pots[0].y;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return start - pots[0].y;
            });
            expect(dropped).toBeGreaterThan(0);
        });

        test('a pot in another column misses the climber', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeClimber(0, 6);
                spawnPot(COLS - 1);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a pot down the climber\'s column knocks them off the wall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
            });
            await page.evaluate(() => {
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('falling');
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('pots are cleared when the climber is knocked off', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => pots.length)).toBe(0);
        });

        test('after the fall the climber restarts at the bottom of the same building', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                for (let i = 0; i < 300 && state === 'falling'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await bodyRow(page)).toBe(0);
        });

        test('pots spawn on their own when enabled', async ({ page }) => {
            await startQuiet(page);
            const spawned = await page.evaluate(() => {
                potsEnabled = true;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return potsSpawned;
            });
            expect(spawned).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                for (let i = 0; i < 300 && state === 'falling'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                placeClimber(1, 6);
                maxRow = bodyRow();
                score = 1234;
                spawnPot(climber.leftCol);
                for (let i = 0; i < 600 && state !== 'over'; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('Enter after game over starts a clean run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
                for (let i = 0; i < 600 && state !== 'over'; i++) step(1 / 60);
            });
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('the best score is kept and stored', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                placeClimber(1, 6);
                maxRow = bodyRow();
                score = 777;
                spawnPot(climber.leftCol);
                for (let i = 0; i < 600 && state !== 'over'; i++) step(1 / 60);
            });
            await expect(page.locator('#best')).toHaveText('777');
            expect(await page.evaluate(() => localStorage.getItem('skyclimber.best'))).toBe('777');
        });
    });

    // -----------------------------------------------------------------------
    // Reaching the roof
    // -----------------------------------------------------------------------
    test.describe('level progression', () => {
        test('reaching the roof clears the building', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                placeClimber(1, roofRow);
                maxRow = roofRow;
                score = 0;
                step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('levelclear');
            expect(await page.evaluate(() => score)).toBe(500);
        });

        test('the next building is taller and the level counter advances', async ({ page }) => {
            await startQuiet(page);
            const firstRows = await page.evaluate(() => rows);
            await page.evaluate(() => {
                placeClimber(1, roofRow);
                step(1 / 60);                     // reaching the roof clears the building
                for (let i = 0; i < 600 && state !== 'running'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => rows)).toBe(firstRows + (await page.evaluate(() => ROWS_STEP)));
            expect(await bodyRow(page)).toBe(0);
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('lives carry over to the next building', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 2;
                placeClimber(1, roofRow);
                step(1 / 60);
                for (let i = 0; i < 600 && state !== 'running'; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('W raises the left hand and Arrow Up the right', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('w');
            await page.waitForFunction(() => climber.leftRow === 1);
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => climber.rightRow === 1);
        });

        test('S and Arrow Down lower the hands', async ({ page }) => {
            await startQuiet(page);
            await climbTo(page, 2);
            await page.keyboard.press('s');
            await page.waitForFunction(() => climber.leftRow === 1);
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => climber.rightRow === 1);
        });

        test('D and Arrow Right shift the climber across', async ({ page }) => {
            await startQuiet(page);
            const start = (await hands(page)).leftCol;
            await page.keyboard.press('d');
            await page.waitForFunction((c) => climber.leftCol === c + 1, start);
            await page.keyboard.press('ArrowLeft');
            await page.waitForFunction((c) => climber.leftCol === c, start);
        });

        test('holding a hand key repeats the climb', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => tryRaise('left'));
            await page.keyboard.down('ArrowUp');
            await page.waitForFunction(() => climber.rightRow === 1);
            await advance(page, 60);
            await page.keyboard.up('ArrowUp');
            expect((await hands(page)).rightRow).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                spawnPot(0);
                togglePause();
                const y = pots[0].y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return pots[0].y !== y;
            });
            expect(moved).toBe(false);
        });

        test('the climber ignores keys while paused', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('w');
            expect((await hands(page)).leftRow).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The animation loop
    // -----------------------------------------------------------------------
    test.describe('animation loop', () => {
        test('the game advances on its own once started', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                potsEnabled = false;
                windowCycling = false;
                graceTimer = 0;
                openAllWindows();
                spawnPot(0);
            });
            const y = await page.evaluate(() => pots[0].y);
            await page.waitForFunction((start) => pots.length === 0 || pots[0].y < start, y);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 30);
            const painted = await page.evaluate(() => {
                draw();
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing works in every state without throwing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                draw(); // idle
                startGame();
                autoStep = false;
                graceTimer = 0;
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                spawnPot(climber.leftCol);
                placeClimber(1, 6);
                for (let i = 0; i < 300 && state === 'running'; i++) step(1 / 60);
                draw(); // falling
                for (let i = 0; i < 300 && state === 'falling'; i++) step(1 / 60);
                placeClimber(1, roofRow);
                step(1 / 60);
                draw(); // levelclear
                for (let i = 0; i < 300 && state !== 'running'; i++) step(1 / 60);
                draw();
                lives = 1;
                placeClimber(1, 6);
                spawnPot(climber.leftCol);
                for (let i = 0; i < 900 && state !== 'over'; i++) step(1 / 60);
                draw(); // over
            });
            expect(errors).toEqual([]);
        });
    });
});
