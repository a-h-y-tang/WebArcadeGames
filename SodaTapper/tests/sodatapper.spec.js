const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a running game with the patron queue switched off, so specs only see
// the patrons they place themselves.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // The animation loop is switched off for every spec: the specs drive
        // step(dt) themselves so nothing races requestAnimationFrame.
        await page.evaluate(() => {
            loopEnabled = false;
        });
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '3400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3400');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });

        test('there are four bars, ordered top to bottom', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            const ys = await page.evaluate(() => BAR_Y.slice());
            expect(ys).toHaveLength(4);
            expect([...ys].sort((a, b) => a - b)).toEqual(ys);
        });

        test('the bartender starts on the top bar', async ({ page }) => {
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0, 200));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'running');
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game starts on level 1 with a clean bar', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => spawned)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Bartender movement
    // -----------------------------------------------------------------------
    test.describe('bartender', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('ArrowDown steps down a bar', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => bartender.lane === 1);
        });

        test('ArrowUp steps back up a bar', async ({ page }) => {
            await page.evaluate(() => placeBartender(2));
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => bartender.lane === 1);
        });

        test('W and S also move the bartender', async ({ page }) => {
            await page.keyboard.press('s');
            await page.waitForFunction(() => bartender.lane === 1);
            await page.keyboard.press('w');
            await page.waitForFunction(() => bartender.lane === 0);
        });

        test('the bartender cannot go above the top bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(0);
                moveBartender(-1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot go below the bottom bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(LANES - 1);
                moveBartender(1);
            });
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('the bartender stands at the serving end of the bar', async ({ page }) => {
            expect(await page.evaluate(() => bartender.x)).toBeGreaterThan(
                await page.evaluate(() => BAR_RIGHT)
            );
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('serving pours a mug onto the current bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(2);
                serve();
            });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.x).toBeLessThanOrEqual(await page.evaluate(() => BAR_RIGHT));
        });

        test('Space pours a mug while running', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => mugs.length === 1);
        });

        test('a poured mug slides toward the far end', async ({ page }) => {
            const before = await page.evaluate(() => {
                serve();
                return mugs[0].x;
            });
            await advance(page, 20);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(before);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            await page.evaluate(() => {
                serve();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the tap can be used again once the cooldown passes', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 30);
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a mug that runs off the end costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 200);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('the bartender cannot pour while not running', async ({ page }) => {
            await page.evaluate(() => {
                togglePause();
                serve();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a patron walks toward the bartender', async ({ page }) => {
            const before = await page.evaluate(() => spawnPatron(1, BAR_LEFT).x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(before);
        });

        test('a mug reaching a patron is caught and scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeBartender(1);
                const p = spawnPatron(1, BAR_LEFT + 260);
                serve();
                for (let i = 0; i < 200 && mugs.length; i++) step(1 / 60);
                return { mugs: mugs.length, patron: p.state, score, drink: DRINK_POINTS };
            });
            expect(result.mugs).toBe(0);
            expect(result.patron).toBe('drinking');
            expect(result.score).toBeGreaterThanOrEqual(result.drink);
        });

        test('a drinking patron is pushed back down the bar', async ({ page }) => {
            const before = await page.evaluate(() => {
                const p = spawnPatron(1, BAR_LEFT + 260);
                giveDrink(p);
                return p.x;
            });
            await advance(page, 20);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(before);
        });

        test('a patron goes back to walking once the drink is finished', async ({ page }) => {
            const frames = await page.evaluate(() => {
                giveDrink(spawnPatron(1, BAR_LEFT + 300));
                return Math.ceil((DRINK_TIME + 0.3) * 60);
            });
            await advance(page, frames);
            expect(await page.evaluate(() => patrons[0].state)).toBe('walking');
        });

        test('a mug only reaches patrons on its own bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(0);
                spawnPatron(2, BAR_LEFT + 200);
                serve();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].state)).toBe('walking');
        });

        test('the patron nearest the tap catches the mug', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(0);
                spawnPatron(0, BAR_LEFT + 60);
                spawnPatron(0, BAR_LEFT + 300);
                serve();
            });
            await advance(page, 100);
            const states = await page.evaluate(() => patrons.map((p) => p.state));
            expect(states).toEqual(['walking', 'drinking']);
        });

        test('a patron pushed off the end of the bar is served', async ({ page }) => {
            await page.evaluate(() => {
                const p = spawnPatron(1, BAR_LEFT + 30);
                giveDrink(p);
            });
            await advance(page, 60);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => SERVE_POINTS)
            );
        });

        test('a served patron sends an empty mug back', async ({ page }) => {
            await page.evaluate(() => giveDrink(spawnPatron(1, BAR_LEFT + 30)));
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(1);
        });

        test('a patron reaching the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => spawnPatron(1, BAR_RIGHT - 30));
            await advance(page, 120);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('patrons keep their distance when the queue spawns them', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                spawnEnabled = true;
                for (let i = 0; i < 60 * 20; i++) step(1 / 60);
                return patrons.map((p) => p.lane);
            });
            expect(lanes.length).toBeGreaterThan(0);
            const perLane = {};
            for (const l of lanes) perLane[l] = (perLane[l] || 0) + 1;
            expect(Math.max(...Object.values(perLane))).toBeLessThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty mug slides back toward the bartender', async ({ page }) => {
            const before = await page.evaluate(() => spawnEmpty(0, BAR_LEFT).x);
            await advance(page, 20);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(before);
        });

        test('the bartender catches an empty on their own bar', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(0);
                spawnEmpty(0, BAR_LEFT);
            });
            await advance(page, 200);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => EMPTY_POINTS)
            );
        });

        test('an empty is only catchable near the serving end', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(0);
                spawnEmpty(0, BAR_LEFT);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => empties.length)).toBe(1);
        });

        test('an uncaught empty smashes and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                placeBartender(3);
                spawnEmpty(0, BAR_LEFT);
            });
            await advance(page, 220);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('dying');
        });
    });

    // -----------------------------------------------------------------------
    // Losing a life
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the bar is cleared and play resumes after a life is lost', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0, BAR_LEFT + 200);
                spawnEmpty(1, BAR_LEFT + 100);
                serve();
                loseLife();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            // Everyone still waiting is sent back to the far end; they only
            // start walking again once play resumes.
            const { x, left } = await page.evaluate(() => ({ x: patrons[0].x, left: BAR_LEFT }));
            expect(x).toBeGreaterThanOrEqual(left);
            expect(x).toBeLessThan(left + 20);
        });

        test('the HUD shows the lost life', async ({ page }) => {
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('nothing moves while dying', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0, BAR_LEFT + 100);
                loseLife();
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 20);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('clearing the round moves on to the next level', async ({ page }) => {
            await page.evaluate(() => clearRoundForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('levelclear');
            await advance(page, 150);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing a round is worth a bonus', async ({ page }) => {
            await page.evaluate(() => clearRoundForTest());
            await advance(page, 2);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(
                await page.evaluate(() => LEVEL_BONUS)
            );
        });

        test('the next round starts with a fresh queue of patrons', async ({ page }) => {
            await page.evaluate(() => clearRoundForTest());
            await advance(page, 152);
            expect(await page.evaluate(() => spawned)).toBe(0);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('later rounds serve more patrons', async ({ page }) => {
            const first = await page.evaluate(() => waveSize());
            await page.evaluate(() => {
                level = 5;
            });
            expect(await page.evaluate(() => waveSize())).toBeGreaterThan(first);
        });

        test('patrons get thirstier and faster each level', async ({ page }) => {
            const first = await page.evaluate(() => patronSpeed());
            await page.evaluate(() => {
                level = 6;
            });
            expect(await page.evaluate(() => patronSpeed())).toBeGreaterThan(first);
        });

        test('patrons never outrun a poured mug', async ({ page }) => {
            await page.evaluate(() => {
                level = 50;
            });
            expect(await page.evaluate(() => patronSpeed())).toBeLessThan(
                await page.evaluate(() => MUG_SPEED)
            );
        });

        test('patrons arrive more often at higher levels', async ({ page }) => {
            const first = await page.evaluate(() => spawnInterval());
            await page.evaluate(() => {
                level = 6;
            });
            expect(await page.evaluate(() => spawnInterval())).toBeLessThan(first);
        });

        test('score carries into the next level', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                clearRoundForTest();
            });
            await advance(page, 152);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(900);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('P resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0, BAR_LEFT + 100);
                togglePause();
            });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Best score
    // -----------------------------------------------------------------------
    test.describe('best score', () => {
        test('a new best is stored on game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 6543;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('6543');
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe(
                '6543'
            );
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                loopEnabled = false;
            });
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('restarting after game over resets the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 400;
                level = 3;
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0, BAR_LEFT + 100);
                serve();
                draw();
            });
            const painted = await page.evaluate(() => {
                const d = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i] > 30 || d[i + 1] > 30 || d[i + 2] > 30) return true;
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
                spawnEnabled = false;
                spawnPatron(0, BAR_LEFT + 120);
                giveDrink(spawnPatron(2, BAR_LEFT + 200));
                spawnEmpty(3, BAR_LEFT + 60);
                serve();
                for (let i = 0; i < 30; i++) step(1 / 60);
                draw(); // running
                togglePause();
                draw(); // paused
                togglePause();
                loseLife();
                draw(); // dying
                for (let i = 0; i < 120; i++) step(1 / 60);
                clearRoundForTest();
                step(1 / 60);
                draw(); // level clear
                lives = 1;
                loseLife();
                draw(); // over
            });
            expect(errors).toEqual([]);
        });
    });
});
