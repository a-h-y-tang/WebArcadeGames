const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The animation loop drives `step()` itself, which would race every assertion
// below. `autoStep = false` detaches it: from then on the only time that passes
// is the time a spec asks for. Drawing keeps running, so the render path is
// still exercised throughout the suite.
const freeze = (page) => page.evaluate(() => { autoStep = false; });

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with random patron arrivals switched off, so long simulations
// stay deterministic. The spawner's own specs leave spawning on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
    });

// Put a patron on `lane` at an exact x, so collision specs don't depend on how
// far a walker happened to get.
const patronAt = (page, lane, x) =>
    page.evaluate(([l, px]) => {
        const p = spawnPatron(l);
        p.x = px;
        return p.x;
    }, [lane, x]);

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await freeze(page);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Tapper');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 560x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '560');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, shift and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '7350'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7350');
        });

        test('the bar is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [patrons.length, mugs.length, empties.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('there are four counters', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('counters are evenly spaced down the canvas', async ({ page }) => {
            const gaps = await page.evaluate(() =>
                LANE_Y.slice(1).map((y, i) => y - LANE_Y[i])
            );
            expect(new Set(gaps).size).toBe(1);
        });

        test('the door is left of the taps', async ({ page }) => {
            const [left, right] = await page.evaluate(() => [EXIT_X, SERVE_X]);
            expect(left).toBeLessThan(right);
        });

        test('stepping while idle does nothing', async ({ page }) => {
            await page.evaluate(() => spawnPatron(0));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a shift
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay hides once running', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting resets score, lives and shift', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                level = 4;
            });
            await startQuiet(page);
            expect(await page.evaluate(() => [score, lives, level])).toEqual([0, 3, 1]);
        });

        test('starting clears anything left on the bar', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(0);
                spawnEmpty(1, 200);
            });
            await startQuiet(page);
            expect(await page.evaluate(() => [patrons.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
        });

        test('the first shift needs six patrons served', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => levelTarget)).toBe(6);
            expect(await page.evaluate(() => served)).toBe(0);
        });

        test('HUD shows the shift quota', async ({ page }) => {
            await startQuiet(page);
            await expect(page.locator('#served')).toHaveText('0/6');
        });
    });

    // -----------------------------------------------------------------------
    // Moving between counters
    // -----------------------------------------------------------------------
    test.describe('player movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the player starts on the top counter', async ({ page }) => {
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('arrow down moves down one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('arrow up moves back up one counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(1);
        });

        test('w and s also move the player', async ({ page }) => {
            await page.keyboard.press('s');
            expect(await page.evaluate(() => player.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the player cannot move above the top counter', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });

        test('the player cannot move below the bottom counter', async ({ page }) => {
            for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(3);
        });

        test('the drawn position eases toward the new counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            const before = await page.evaluate(() => player.y);
            await advance(page, 30);
            const after = await page.evaluate(() => player.y);
            expect(after).toBeGreaterThan(before);
            expect(after).toBeLessThanOrEqual(await page.evaluate(() => LANE_Y[1]) + 0.001);
        });

        test('the drawn position settles on the counter', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await advance(page, 120);
            const [y, laneY] = await page.evaluate(() => [player.y, LANE_Y[1]]);
            expect(Math.abs(y - laneY)).toBeLessThan(0.5);
        });

        test('the player cannot move while the game is over', async ({ page }) => {
            await page.evaluate(() => { state = 'over'; });
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => player.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('space pours a mug on the player lane', async ({ page }) => {
            await page.keyboard.press('Space');
            const mug = await page.evaluate(() => mugs[0] && { lane: mugs[0].lane, x: mugs[0].x });
            expect(mug).toEqual({ lane: 0, x: await page.evaluate(() => SERVE_X) });
        });

        test('a mug is poured on whichever counter the player is on', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs[0].lane)).toBe(2);
        });

        test('a poured mug slides toward the door', async ({ page }) => {
            await page.evaluate(() => serve());
            const start = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => mugs[0].x)).toBeLessThan(start);
        });

        test('mug speed matches the constant', async ({ page }) => {
            await page.evaluate(() => serve());
            const start = await page.evaluate(() => mugs[0].x);
            await advance(page, 60, 1 / 60);
            const [now, speed] = await page.evaluate(() => [mugs[0].x, MUG_SPEED]);
            expect(start - now).toBeCloseTo(speed, 0);
        });

        test('the cooldown blocks an immediate second pour', async ({ page }) => {
            expect(await page.evaluate(() => serve())).toBe(true);
            expect(await page.evaluate(() => serve())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('another mug can be poured once the cooldown expires', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 30);
            expect(await page.evaluate(() => serve())).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('no mug is poured when the game is over', async ({ page }) => {
            await page.evaluate(() => { state = 'over'; });
            expect(await page.evaluate(() => serve())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('no mug is poured while paused', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => serve())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a patron enters at the door on the given counter', async ({ page }) => {
            await page.evaluate(() => spawnPatron(2));
            const p = await page.evaluate(() => ({ lane: patrons[0].lane, x: patrons[0].x }));
            expect(p).toEqual({ lane: 2, x: await page.evaluate(() => SPAWN_X) });
        });

        test('a patron walks toward the taps', async ({ page }) => {
            await patronAt(page, 0, 200);
            await advance(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(200);
        });

        test('patrons walk at the shift speed', async ({ page }) => {
            await patronAt(page, 0, 200);
            await advance(page, 60);
            const [x, speed] = await page.evaluate(() => [patrons[0].x, patronSpeed()]);
            expect(x - 200).toBeCloseTo(speed, 0);
        });

        test('later shifts have faster patrons', async ({ page }) => {
            const first = await page.evaluate(() => patronSpeed());
            const later = await page.evaluate(() => { level = 5; return patronSpeed(); });
            expect(later).toBeGreaterThan(first);
        });

        test('a patron reaching the taps costs a life', async ({ page }) => {
            await page.evaluate(() => { patrons.length = 0; });
            await patronAt(page, 0, await page.evaluate(() => GRAB_X - 2));
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('the spawner brings patrons in over time', async ({ page }) => {
            await page.evaluate(() => { spawnEnabled = true; });
            await advance(page, 60 * 8);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });

        test('the spawner stops once the shift quota has arrived', async ({ page }) => {
            await page.evaluate(() => { spawnEnabled = true; });
            await advance(page, 60 * 40);
            expect(await page.evaluate(() => spawned)).toBeLessThanOrEqual(
                await page.evaluate(() => levelTarget)
            );
        });

        test('no counter holds more than the per-lane limit', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 20; i++) spawnPatron(1);
            });
            expect(await page.evaluate(() => patrons.filter((p) => p.lane === 1).length))
                .toBeLessThanOrEqual(await page.evaluate(() => MAX_PER_LANE));
        });
    });

    // -----------------------------------------------------------------------
    // Mug meets patron
    // -----------------------------------------------------------------------
    test.describe('serving patrons', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug is caught by the patron it reaches', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => patrons.length)).toBe(1);
        });

        test('catching a mug scores', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 90);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => MUG_SCORE));
        });

        test('a caught mug knocks the patron back', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBeLessThan(300 - 50);
        });

        test('the patron drinks after being knocked back', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].mode)).toBe('drink');
        });

        test('a drinking patron walks again once finished', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 120 + 60);
            expect(await page.evaluate(() => patrons[0].mode)).toBe('walk');
        });

        test('catching a mug sends an empty back down the counter', async ({ page }) => {
            await patronAt(page, 0, 300);
            await page.evaluate(() => serve());
            await advance(page, 90);
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
        });

        test('the mug meets the right-most patron first', async ({ page }) => {
            await patronAt(page, 0, 150);
            await patronAt(page, 0, 350);
            await page.evaluate(() => serve());
            await advance(page, 60);
            const xs = await page.evaluate(() => patrons.map((p) => Math.round(p.x)));
            // The near patron was pushed back; the far one is untouched (still
            // walking forward from 150).
            expect(Math.min(...xs)).toBeGreaterThan(150);
            expect(Math.max(...xs)).toBeLessThan(350);
        });

        test('a patron knocked out of the door is served', async ({ page }) => {
            await patronAt(page, 0, await page.evaluate(() => EXIT_X + 20));
            await page.evaluate(() => serve());
            await advance(page, 180);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
        });

        test('serving a patron scores the patron bonus', async ({ page }) => {
            await patronAt(page, 0, await page.evaluate(() => EXIT_X + 20));
            await page.evaluate(() => serve());
            await advance(page, 180);
            const [s, mug, patron] = await page.evaluate(() => [score, MUG_SCORE, SERVE_SCORE]);
            expect(s).toBe(mug + patron);
        });

        test('the HUD counts served patrons', async ({ page }) => {
            await patronAt(page, 0, await page.evaluate(() => EXIT_X + 20));
            await page.evaluate(() => serve());
            await advance(page, 180);
            await expect(page.locator('#served')).toHaveText('1/6');
        });

        test('a mug that meets nobody costs a life', async ({ page }) => {
            await page.evaluate(() => serve());
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('a mug only reaches patrons on its own counter', async ({ page }) => {
            await patronAt(page, 2, 300);
            await page.evaluate(() => serve()); // player is on lane 0
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => patrons.length)).toBe(0); // cleared by the life loss
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty slides toward the taps', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 200));
            await advance(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(200);
        });

        test('empty speed matches the constant', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 200));
            await advance(page, 60);
            const [x, speed] = await page.evaluate(() => [empties[0].x, EMPTY_SPEED]);
            expect(x - 200).toBeCloseTo(speed, 0);
        });

        test('standing on the counter catches the empty', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 400));
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('catching an empty scores', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(0, 400));
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => EMPTY_SCORE));
        });

        test('an empty reaching the taps on another counter costs a life', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(2, 400));
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => empties.length)).toBe(0);
        });

        test('moving to the counter in time saves the empty', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(1, 380));
            await page.keyboard.press('ArrowDown');
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => EMPTY_SCORE));
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the bar', async ({ page }) => {
            await patronAt(page, 1, 300);
            await page.evaluate(() => spawnEmpty(3, 400));
            await advance(page, 60);
            expect(await page.evaluate(() => [patrons.length, mugs.length, empties.length]))
                .toEqual([0, 0, 0]);
        });

        test('cleared patrons still count toward the shift quota', async ({ page }) => {
            await page.evaluate(() => {
                spawnPatron(1);
                spawnPatron(2);
            });
            const before = await page.evaluate(() => spawned);
            await page.evaluate(() => spawnEmpty(3, 480));
            await advance(page, 30);
            expect(await page.evaluate(() => spawned)).toBe(before - 2);
        });

        test('play is frozen briefly after losing a life', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(3, 480));
            await advance(page, 30);
            await page.evaluate(() => spawnPatron(0));
            const x = await page.evaluate(() => patrons[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => patrons[0].x)).toBe(x);
        });

        test('the HUD shows the remaining lives', async ({ page }) => {
            await page.evaluate(() => spawnEmpty(3, 480));
            await advance(page, 30);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the game ends when the last life is lost', async ({ page }) => {
            await page.evaluate(() => { lives = 1; spawnEmpty(3, 480); });
            await advance(page, 30);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => { lives = 1; score = 1234; spawnEmpty(3, 480); });
            await advance(page, 30);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is kept', async ({ page }) => {
            await page.evaluate(() => { lives = 1; score = 4321; spawnEmpty(3, 480); });
            await advance(page, 30);
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('4321');
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '9000'));
            await page.reload();
            await freeze(page);
            await startQuiet(page);
            await page.evaluate(() => { lives = 1; score = 10; spawnEmpty(3, 480); });
            await advance(page, 30);
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('9000');
        });

        test('the game can be restarted after it ends', async ({ page }) => {
            await page.evaluate(() => { lives = 1; spawnEmpty(3, 480); });
            await advance(page, 30);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives, score])).toEqual(['running', 3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Shifts
    // -----------------------------------------------------------------------
    test.describe('shift progression', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the shift does not advance until the quota is met', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 2; served = 1; });
            await advance(page, 60);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('the shift does not advance while the bar is busy', async ({ page }) => {
            await page.evaluate(() => {
                levelTarget = 1;
                served = 1;
                spawnEmpty(0, 100);
            });
            await advance(page, 30);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('clearing the quota advances the shift', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; served = 1; });
            await advance(page, 30);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('advancing awards the shift bonus', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; served = 1; score = 0; });
            await advance(page, 30);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('the new shift starts from zero served', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; served = 1; });
            await advance(page, 30);
            expect(await page.evaluate(() => [served, spawned])).toEqual([0, 0]);
        });

        test('the new shift has a bigger quota', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; served = 1; });
            await advance(page, 30);
            expect(await page.evaluate(() => levelTarget)).toBe(8);
        });

        test('the HUD shows the new shift', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; served = 1; });
            await advance(page, 30);
            await expect(page.locator('#level')).toHaveText('2');
            await expect(page.locator('#served')).toHaveText('0/8');
        });

        test('a full round trip serves a patron and advances the shift', async ({ page }) => {
            await page.evaluate(() => { levelTarget = 1; });
            await patronAt(page, 0, await page.evaluate(() => EXIT_X + 20));
            await page.evaluate(() => serve());
            await advance(page, 60 * 8);
            expect(await page.evaluate(() => level)).toBe(2);
            const [s, mug, patron, empty, bonus] = await page.evaluate(() =>
                [score, MUG_SCORE, SERVE_SCORE, EMPTY_SCORE, LEVEL_BONUS]);
            expect(s).toBe(mug + patron + empty + bonus);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('p pauses the game', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the pause overlay is shown', async ({ page }) => {
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });

        test('nothing moves while paused', async ({ page }) => {
            await patronAt(page, 0, 200);
            await page.keyboard.press('p');
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBe(200);
        });

        test('p resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('enter resumes the game', async ({ page }) => {
            await page.keyboard.press('p');
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('pausing does not work once the game is over', async ({ page }) => {
            await page.evaluate(() => { state = 'over'; });
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            const blank = await page.evaluate(() => {
                draw();
                const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
                return true;
            });
            expect(blank).toBe(false);
        });

        test('drawing a busy bar does not throw', async ({ page }) => {
            await startQuiet(page);
            const ok = await page.evaluate(() => {
                for (let lane = 0; lane < LANES; lane++) {
                    spawnPatron(lane);
                    spawnEmpty(lane, 200 + lane * 40);
                }
                serve();
                try {
                    draw();
                    return true;
                } catch (e) {
                    return String(e);
                }
            });
            expect(ok).toBe(true);
        });

        test('drawing the game-over screen does not throw', async ({ page }) => {
            await startQuiet(page);
            const ok = await page.evaluate(() => {
                lives = 1;
                spawnEmpty(3, 480);
                for (let i = 0; i < 10; i++) step(1 / 60);
                try {
                    draw();
                    return state;
                } catch (e) {
                    return String(e);
                }
            });
            expect(ok).toBe('over');
        });
    });
});
