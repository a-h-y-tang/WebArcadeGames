const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// --- helpers ---------------------------------------------------------------

// Start a wave and stop the animation loop so a test can arrange the bar
// itself and advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
    });
}

// Empty the bar but keep one patron owed, so the wave can never complete
// while a test is looking at something else.
async function isolate(page) {
    await page.evaluate(() => {
        patrons = [];
        mugs = [];
        toSpawn = 1;
        spawnTimer = 9999;
        pourTimer = 0;
    });
}

async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

async function stepSeconds(page, secs) {
    await page.evaluate((s) => {
        const n = Math.round(s * 120);
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, secs);
}

async function addPatron(page, lane, x, patronState = 'walking') {
    await page.evaluate((p) => {
        const patron = makePatron(p.lane, p.x);
        patron.state = p.state;
        if (p.state === 'drinking') {
            patron.timer = DRINK_TIME;
            patron.targetX = Math.max(BAR_LEFT, p.x - PUSHBACK);
        }
        patrons.push(patron);
    }, { lane, x, state: patronState });
}

async function addMug(page, lane, x, full = true) {
    await page.evaluate((m) => {
        mugs.push(makeMug(m.lane, m.x, m.full));
    }, { lane, x, full });
}

async function snapshot(page) {
    return page.evaluate(() => ({
        state,
        score,
        level,
        lives,
        patrons: patrons.length,
        mugs: mugs.length,
        toSpawn,
        lane: keeper.lane,
    }));
}

test.describe('Soda Shack', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Shack', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Shack');
        });

        test('canvas is 640x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#left')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the bar is empty before starting', async ({ page }) => {
            const s = await snapshot(page);
            expect(s.patrons).toBe(0);
            expect(s.mugs).toBe(0);
            expect(s.toSpawn).toBe(0);
        });

        test('there are four lanes', async ({ page }) => {
            expect(await page.evaluate(() => LANES)).toBe(4);
            expect(await page.evaluate(() => LANE_Y.length)).toBe(4);
        });

        test('lane centres are inside the canvas and increase downward', async ({ page }) => {
            const ys = await page.evaluate(() => LANE_Y.slice());
            for (const y of ys) {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(520);
            }
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('the bar spans a sensible stretch of the canvas', async ({ page }) => {
            const { left, right } = await page.evaluate(() => ({ left: BAR_LEFT, right: BAR_RIGHT }));
            expect(left).toBeGreaterThan(0);
            expect(right).toBeLessThan(640);
            expect(right - left).toBeGreaterThan(300);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodashack-best', '4820'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4820');
        });

        test('a corrupt stored best falls back to zero', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodashack-best', 'not-a-number'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('the help legend explains the lane and pour controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/lane/i);
            await expect(page.locator('.help')).toContainText(/pour|serve/i);
        });

        test('the help legend warns about empty mugs', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/empt/i);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the idle overlay sits in front of the canvas', async ({ page }) => {
            // The overlay owns every idle click, so a stray click on the bar
            // cannot start a shift (and later, cannot waste a mug).
            const covered = await page.evaluate(() => {
                const rect = document.getElementById('canvas').getBoundingClientRect();
                const overlay = document.getElementById('overlay');
                const hit = document.elementFromPoint(rect.left + 20, rect.top + 20);
                return hit === overlay || overlay.contains(hit);
            });
            expect(covered).toBe(true);
        });

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game starts on level 1 with three lives and no score', async ({ page }) => {
            await startFrozen(page);
            const s = await snapshot(page);
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });

        test('the first wave queues the level-1 patron count', async ({ page }) => {
            await startFrozen(page);
            const expected = await page.evaluate(() => patronsForLevel(1));
            expect((await snapshot(page)).toSpawn).toBe(expected);
        });

        test('the barkeep starts in the top lane', async ({ page }) => {
            await startFrozen(page);
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('no patron is on the bar on the very first frame', async ({ page }) => {
            await startFrozen(page);
            expect((await snapshot(page)).patrons).toBe(0);
        });

        test('restarting after a game over resets score and lives', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test('ArrowDown moves the barkeep down a lane', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(1);
        });

        test('ArrowUp moves the barkeep up a lane', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => setLane(2));
            await page.keyboard.press('ArrowUp');
            expect((await snapshot(page)).lane).toBe(1);
        });

        test('S and W also change lanes', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyS');
            expect((await snapshot(page)).lane).toBe(1);
            await page.keyboard.press('KeyW');
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('the barkeep cannot climb above the top lane', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('the barkeep cannot drop below the bottom lane', async ({ page }) => {
            await startFrozen(page);
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(3);
        });

        test('setLane clamps out-of-range values', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => setLane(99));
            expect((await snapshot(page)).lane).toBe(3);
            await page.evaluate(() => setLane(-5));
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('setLane ignores non-numeric input', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => setLane(2));
            await page.evaluate(() => setLane(NaN));
            expect((await snapshot(page)).lane).toBe(2);
        });

        test('moving the mouse over a lane selects it', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => LANE_Y[2]);
            await page.mouse.move(box.x + 300, box.y + y);
            expect((await snapshot(page)).lane).toBe(2);
        });

        test('lanes do not change while the game is idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(0);
        });

        test('lanes do not change while paused', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => setLane(1));
            await page.keyboard.press('KeyP');
            await page.keyboard.press('ArrowDown');
            expect((await snapshot(page)).lane).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pouring puts a full mug on the barkeep lane', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { setLane(2); pour(); });
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug.lane).toBe(2);
            expect(mug.full).toBe(true);
        });

        test('a poured mug starts at the taps', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => pour());
            const { x, tap } = await page.evaluate(() => ({ x: mugs[0].x, tap: TAP_X }));
            expect(x).toBeCloseTo(tap, 1);
        });

        test('a full mug slides to the left', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await stepSeconds(page, 0.5);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
            expect(before - after).toBeCloseTo(await page.evaluate(() => MUG_SPEED * 0.5), 0);
        });

        test('Space pours while the game is running', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.keyboard.press('Space');
            expect((await snapshot(page)).mugs).toBe(1);
        });

        test('clicking the bar pours while running', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.locator('#canvas').click({ position: { x: 300, y: 110 } });
            expect((await snapshot(page)).mugs).toBe(1);
        });

        test('the tap has a cooldown between pours', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { pour(); pour(); });
            expect((await snapshot(page)).mugs).toBe(1);
        });

        test('the tap works again once the cooldown elapses', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => pour());
            await page.evaluate(() => { pourTimer = 0; });
            await page.evaluate(() => pour());
            expect((await snapshot(page)).mugs).toBe(2);
        });

        test('the cooldown ticks down with the simulation', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => pourTimer)).toBeGreaterThan(0);
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => pourTimer)).toBe(0);
        });

        test('pouring does nothing while idle', async ({ page }) => {
            await page.evaluate(() => pour());
            expect((await snapshot(page)).mugs).toBe(0);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { togglePause(); pour(); });
            expect((await snapshot(page)).mugs).toBe(0);
        });

        test('two lanes can carry mugs at the same time', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => {
                setLane(0);
                pour();
                pourTimer = 0;
                setLane(3);
                pour();
            });
            const lanes = await page.evaluate(() => mugs.map((m) => m.lane));
            expect(lanes).toEqual([0, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a full mug reaching a patron is taken off the bar', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 1, 330, true);
            await stepSeconds(page, 0.3);
            expect((await snapshot(page)).mugs).toBe(0);
        });

        test('serving a patron scores points', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 1, 330, true);
            await stepSeconds(page, 0.3);
            expect((await snapshot(page)).score).toBe(await page.evaluate(() => SERVE_POINTS));
        });

        test('a served patron starts drinking', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 1, 330, true);
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => patrons[0].state)).toBe('drinking');
        });

        test('a served patron is pushed back down the bar', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 1, 330, true);
            await stepSeconds(page, 0.3);
            const x1 = await page.evaluate(() => patrons[0].x);
            await stepSeconds(page, 0.4);
            const x2 = await page.evaluate(() => patrons[0].x);
            expect(x2).toBeLessThan(x1);
        });

        test('the push back never exceeds PUSHBACK pixels', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 1, 330, true);
            await stepSeconds(page, 0.1);
            const start = await page.evaluate(() => patrons[0].x);
            await stepSeconds(page, 0.9);
            const after = await page.evaluate(() => patrons[0].x);
            expect(await page.evaluate(() => patrons[0].state)).toBe('drinking');
            expect(start - after).toBeGreaterThan(0);
            expect(start - after).toBeLessThanOrEqual(await page.evaluate(() => PUSHBACK) + 1);
        });

        test('a drinking patron hands an empty mug back', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 2, 300);
            await addMug(page, 2, 330, true);
            await stepSeconds(page, 0.3);
            expect((await snapshot(page)).mugs).toBe(0);
            await stepSeconds(page, await page.evaluate(() => DRINK_TIME + 0.1));
            const mug = await page.evaluate(() => mugs[0]);
            expect(mug).toBeTruthy();
            expect(mug.full).toBe(false);
            expect(mug.lane).toBe(2);
        });

        test('the returned empty mug slides to the right', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 200, false);
            const before = await page.evaluate(() => mugs[0].x);
            await stepSeconds(page, 0.4);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeGreaterThan(before);
            expect(after - before).toBeCloseTo(await page.evaluate(() => EMPTY_SPEED * 0.4), 0);
        });

        test('a patron walks off the bar after drinking', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await addMug(page, 0, 330, true);
            await stepSeconds(page, 0.3);
            await stepSeconds(page, await page.evaluate(() => DRINK_TIME + 0.1));
            expect(await page.evaluate(() => patrons[0].state)).toBe('leaving');
            await stepSeconds(page, 8);
            expect((await snapshot(page)).patrons).toBe(0);
        });

        test('a leaving patron moves toward the door', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300, 'leaving');
            const before = await page.evaluate(() => patrons[0].x);
            await stepSeconds(page, 0.5);
            const after = await page.evaluate(() => patrons[0].x);
            expect(after).toBeLessThan(before);
        });

        test('a mug passes straight through a drinking patron', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300, 'drinking');
            await addMug(page, 0, 330, true);
            await stepSeconds(page, 0.1);
            expect((await snapshot(page)).mugs).toBe(1);
            expect((await snapshot(page)).score).toBe(0);
        });

        test('one mug serves only one patron', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await addPatron(page, 0, 280);
            await addMug(page, 0, 340, true);
            await stepSeconds(page, 0.5);
            const states = await page.evaluate(() => patrons.map((p) => p.state));
            expect(states.filter((s) => s === 'walking').length).toBe(1);
            expect(states.filter((s) => s !== 'walking').length).toBe(1);
        });

        test('a mug only serves patrons in its own lane', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 3, 300);
            await addMug(page, 0, 330, true);
            await stepSeconds(page, 0.3);
            expect(await page.evaluate(() => patrons[0].state)).toBe('walking');
        });

        test('the frontmost patron in the lane is served first', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 200);
            await addPatron(page, 0, 320);
            await addMug(page, 0, 400, true);
            await stepSeconds(page, 0.5);
            const front = await page.evaluate(() => patrons.find((p) => p.x > 250));
            expect(front.state).not.toBe('walking');
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test('an empty mug caught in the barkeep lane scores points', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => setLane(1));
            await addMug(page, 1, 540, false);
            await stepSeconds(page, 0.5);
            const s = await snapshot(page);
            expect(s.mugs).toBe(0);
            expect(s.score).toBe(await page.evaluate(() => CATCH_POINTS));
            expect(s.lives).toBe(3);
        });

        test('an empty mug in another lane smashes and costs a life', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => setLane(0));
            await addMug(page, 2, 540, false);
            await stepSeconds(page, 0.5);
            const s = await snapshot(page);
            expect(s.mugs).toBe(0);
            expect(s.lives).toBe(2);
            expect(s.score).toBe(0);
        });

        test('an empty mug is only resolved once it reaches the end of the bar', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => setLane(0));
            await addMug(page, 0, 300, false);
            await stepSeconds(page, 0.2);
            expect((await snapshot(page)).mugs).toBe(1);
            expect((await snapshot(page)).score).toBe(0);
        });

        test('switching lanes in time saves the catch', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => setLane(0));
            await addMug(page, 3, 480, false);
            await stepSeconds(page, 0.1);
            await page.evaluate(() => setLane(3));
            await stepSeconds(page, 1);
            const s = await snapshot(page);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(await page.evaluate(() => CATCH_POINTS));
        });

        test('a caught empty leaves a smash-free bar', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => setLane(1));
            await addMug(page, 1, 540, false);
            await stepSeconds(page, 0.5);
            expect((await snapshot(page)).patrons).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Hazards
    // -----------------------------------------------------------------------
    test.describe('hazards', () => {
        test('a full mug that runs off the far end costs a life', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 120, true);
            await stepSeconds(page, 1);
            const s = await snapshot(page);
            expect(s.mugs).toBe(0);
            expect(s.lives).toBe(2);
        });

        test('a full mug sliding safely down the bar costs nothing', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 400, true);
            await stepSeconds(page, 0.2);
            const s = await snapshot(page);
            expect(s.mugs).toBe(1);
            expect(s.lives).toBe(3);
        });

        test('a patron who reaches the taps costs a life', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, await page.evaluate(() => BAR_RIGHT - PATRON_R - 2));
            await stepSeconds(page, 1);
            expect((await snapshot(page)).lives).toBe(2);
        });

        test('patrons advance up the bar on their own', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 200);
            const before = await page.evaluate(() => patrons[0].x);
            await stepSeconds(page, 1);
            const after = await page.evaluate(() => patrons[0].x);
            expect(after).toBeGreaterThan(before);
        });

        test('a dropped mug clears the bar of patrons and mugs', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 2, 120, true);
            await stepSeconds(page, 1);
            const s = await snapshot(page);
            expect(s.patrons).toBe(0);
            expect(s.mugs).toBe(0);
        });

        test('losing a life restarts the wave at the same level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { level = 2; loadLevel(2); });
            await page.evaluate(() => loseLife());
            const s = await snapshot(page);
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
            expect(s.toSpawn).toBe(await page.evaluate(() => patronsForLevel(2)));
        });

        test('a restarted wave gives the player a moment before the next patron', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => loseLife());
            expect(await page.evaluate(() => spawnTimer)).toBeGreaterThan(0.5);
        });

        test('losing a life keeps the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { score = 480; loseLife(); });
            expect((await snapshot(page)).score).toBe(480);
        });

        test('a spill is drawn where a mug smashed', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 120, true);
            await stepSeconds(page, 1);
            expect(await page.evaluate(() => spills.length)).toBeGreaterThan(0);
        });

        test('spills fade away', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 120, true);
            await stepSeconds(page, 1);
            await stepSeconds(page, 4);
            expect(await page.evaluate(() => spills.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game ends when the last life goes', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; loseLife(); });
            const s = await snapshot(page);
            expect(s.lives).toBe(0);
            expect(s.state).toBe('gameover');
        });

        test('the overlay announces the game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; loseLife(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the overlay reports the final score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { score = 1234; lives = 1; loseLife(); });
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is stored after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { score = 777; lives = 1; loseLife(); });
            expect(await page.evaluate(() => window.localStorage.getItem('sodashack-best'))).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodashack-best', '5000'));
            await page.reload();
            await startFrozen(page);
            await page.evaluate(() => { score = 100; lives = 1; loseLife(); });
            expect(await page.evaluate(() => window.localStorage.getItem('sodashack-best'))).toBe('5000');
        });

        test('the simulation stops once the game is over', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await page.evaluate(() => { lives = 1; loseLife(); });
            await stepSeconds(page, 1);
            const s = await snapshot(page);
            expect(s.state).toBe('gameover');
            expect(s.patrons).toBe(0);
        });

        test('no pouring after the game is over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { lives = 1; loseLife(); pour(); });
            expect((await snapshot(page)).mugs).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses a running game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('P resumes a paused game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay shows while paused', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('Space resumes from the pause overlay', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await addMug(page, 1, 400, true);
            await page.evaluate(() => togglePause());
            const before = await page.evaluate(() => ({ p: patrons[0].x, m: mugs[0].x }));
            await stepSeconds(page, 1);
            const after = await page.evaluate(() => ({ p: patrons[0].x, m: mugs[0].x }));
            expect(after).toEqual(before);
        });

        test('pausing cannot start an idle game', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('waves and levels', () => {
        test('patrons arrive over time', async ({ page }) => {
            await startFrozen(page);
            await stepSeconds(page, 3);
            expect((await snapshot(page)).patrons).toBeGreaterThan(0);
        });

        test('each arrival comes out of the queue', async ({ page }) => {
            await startFrozen(page);
            const before = (await snapshot(page)).toSpawn;
            await stepSeconds(page, 3);
            const after = await snapshot(page);
            expect(after.toSpawn).toBe(before - after.patrons);
        });

        test('a new patron starts at the door end of the bar', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { spawnTimer = 0; });
            await step(page, 1);
            const x = await page.evaluate(() => patrons[0].x);
            expect(x).toBeCloseTo(await page.evaluate(() => BAR_LEFT), 0);
        });

        test('arrivals always land in a real lane', async ({ page }) => {
            await startFrozen(page);
            const lanes = await page.evaluate(() => {
                const seen = [];
                for (let i = 0; i < 80; i++) {
                    spawnTimer = 0;
                    toSpawn = 5;
                    const before = patrons.length;
                    physicsStep(1 / 120);
                    if (patrons.length > before) seen.push(patrons[patrons.length - 1].lane);
                    patrons = [];
                }
                return seen;
            });
            expect(lanes.length).toBeGreaterThan(10);
            for (const l of lanes) {
                expect(Number.isInteger(l)).toBe(true);
                expect(l).toBeGreaterThanOrEqual(0);
                expect(l).toBeLessThan(4);
            }
        });

        test('a level always deals the same arrival order', async ({ page }) => {
            const read = async () => page.evaluate(() => {
                startGame();
                autoRun = false;
                const seen = [];
                for (let i = 0; i < 40; i++) {
                    spawnTimer = 0;
                    toSpawn = 5;
                    const before = patrons.length;
                    physicsStep(1 / 120);
                    if (patrons.length > before) seen.push(patrons[patrons.length - 1].lane);
                    patrons = [];
                }
                return seen;
            });
            const first = await read();
            await page.reload();
            const second = await read();
            expect(second).toEqual(first);
        });

        test('clearing the wave moves the game to the level-clear state', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { patrons = []; mugs = []; toSpawn = 0; });
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('the level-clear overlay offers the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { patrons = []; mugs = []; toSpawn = 0; });
            await step(page, 1);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/clear|shift/i);
        });

        test('a cleared wave pays a bonus', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { patrons = []; mugs = []; toSpawn = 0; });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.score).toBe(await page.evaluate(() => levelBonus()));
            expect(s.score).toBeGreaterThan(0);
        });

        test('the wave is not clear while a mug is still sliding', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { toSpawn = 0; });
            await addMug(page, 0, 400, true);
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the wave is not clear while a patron is still at the bar', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { toSpawn = 0; });
            await addPatron(page, 0, 200);
            await step(page, 1);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('advancing from level clear starts the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { patrons = []; mugs = []; toSpawn = 0; });
            await step(page, 1);
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(s.toSpawn).toBe(await page.evaluate(() => patronsForLevel(2)));
        });

        test('later levels serve more patrons', async ({ page }) => {
            const counts = await page.evaluate(() => [1, 2, 3, 4].map((n) => patronsForLevel(n)));
            for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
            expect(counts[3]).toBeGreaterThan(counts[0]);
        });

        test('later levels send patrons in faster', async ({ page }) => {
            const gaps = await page.evaluate(() => [1, 2, 3, 4].map((n) => spawnInterval(n)));
            for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1]);
            expect(gaps[3]).toBeLessThan(gaps[0]);
        });

        test('later levels make patrons walk faster', async ({ page }) => {
            const speeds = await page.evaluate(() => [1, 2, 5].map((n) => patronSpeed(n)));
            expect(speeds[1]).toBeGreaterThan(speeds[0]);
            expect(speeds[2]).toBeGreaterThan(speeds[1]);
        });

        test('difficulty settles instead of running away', async ({ page }) => {
            const far = await page.evaluate(() => ({
                gap: spawnInterval(60),
                count: patronsForLevel(60),
            }));
            expect(far.gap).toBeGreaterThan(0.2);
            expect(far.count).toBeLessThanOrEqual(20);
        });

        test('a new level clears the bar and resets the taps', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await addMug(page, 0, 300, true);
            await page.evaluate(() => { pourTimer = 5; loadLevel(3); });
            const s = await snapshot(page);
            expect(s.patrons).toBe(0);
            expect(s.mugs).toBe(0);
            expect(await page.evaluate(() => pourTimer)).toBe(0);
        });

        test('a new level puts the barkeep back in the top lane', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => { setLane(3); loadLevel(2); });
            expect((await snapshot(page)).lane).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the score readout follows the score', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 300);
            await addMug(page, 0, 330, true);
            await stepSeconds(page, 0.3);
            await expect(page.locator('#score')).toHaveText(String(await page.evaluate(() => SERVE_POINTS)));
        });

        test('the lives readout follows a dropped mug', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await addMug(page, 0, 120, true);
            await stepSeconds(page, 1);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the level readout follows the level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => loadLevel(4));
            await expect(page.locator('#level')).toHaveText('4');
        });

        test('the remaining readout counts the whole wave', async ({ page }) => {
            await startFrozen(page);
            const expected = await page.evaluate(() => patronsForLevel(1));
            await expect(page.locator('#left')).toHaveText(String(expected));
        });

        test('the remaining count holds steady as a patron arrives', async ({ page }) => {
            await startFrozen(page);
            const before = await page.locator('#left').textContent();
            await page.evaluate(() => { spawnTimer = 0; });
            await step(page, 1);
            expect(await page.locator('#left').textContent()).toBe(before);
        });

        test('the remaining count drops once a patron is served and gone', async ({ page }) => {
            await startFrozen(page);
            await isolate(page);
            await page.evaluate(() => { toSpawn = 0; });
            await addPatron(page, 0, 300);
            await step(page, 1);
            await expect(page.locator('#left')).toHaveText('1');
            await addMug(page, 0, 330, true);
            await stepSeconds(page, 0.3);
            await stepSeconds(page, await page.evaluate(() => DRINK_TIME + 0.1));
            await expect(page.locator('#left')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the idle bar is drawn', async ({ page }) => {
            const shot = await page.locator('#canvas').screenshot();
            expect(shot.length).toBeGreaterThan(1000);
        });

        test('the canvas changes once patrons are on the bar', async ({ page }) => {
            const before = await page.locator('#canvas').screenshot();
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 1, 300);
            await addMug(page, 2, 350, true);
            await page.evaluate(() => draw());
            const after = await page.locator('#canvas').screenshot();
            expect(Buffer.compare(before, after)).not.toBe(0);
        });

        test('drawing every state raises no error', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await startFrozen(page);
            await isolate(page);
            await addPatron(page, 0, 200);
            await addPatron(page, 1, 300, 'drinking');
            await addPatron(page, 2, 250, 'leaving');
            await addMug(page, 3, 300, true);
            await addMug(page, 0, 400, false);
            await page.evaluate(() => {
                spills.push({ x: 200, y: LANE_Y[1], life: 1 });
                draw();
                togglePause();
                draw();
                togglePause();
                levelClear();
                draw();
                lives = 1;
                state = 'running';
                loseLife();
                draw();
            });
            expect(errors).toEqual([]);
        });

        test('the animation loop runs the simulation on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect(await page.evaluate(() => spawnTimer)).toBeLessThan(await page.evaluate(() => spawnInterval(1)));
        });

        test('a live game eventually puts a patron on the bar by itself', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect.poll(async () => page.evaluate(() => patrons.length), { timeout: 8000 })
                .toBeGreaterThan(0);
        });

        test('no console errors during normal play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            for (const key of ['ArrowDown', 'Space', 'ArrowUp', 'Space', 'KeyS', 'Space', 'KeyP', 'KeyP']) {
                await page.keyboard.press(key);
            }
            await page.waitForTimeout(500);
            expect(errors).toEqual([]);
        });
    });

    // -----------------------------------------------------------------------
    // Invariants
    // -----------------------------------------------------------------------
    test.describe('invariants', () => {
        test('a long simulated shift never leaks mugs or patrons', async ({ page }) => {
            await startFrozen(page);
            const peak = await page.evaluate(() => {
                let maxMugs = 0;
                let maxPatrons = 0;
                for (let i = 0; i < 120 * 60; i++) {
                    if (state === 'running' && i % 40 === 0) pour();
                    if (state === 'running' && i % 97 === 0) setLane((keeper.lane + 1) % LANES);
                    if (state === 'levelclear') advance();
                    physicsStep(1 / 120);
                    maxMugs = Math.max(maxMugs, mugs.length);
                    maxPatrons = Math.max(maxPatrons, patrons.length);
                }
                return { maxMugs, maxPatrons, state };
            });
            expect(peak.maxMugs).toBeLessThan(80);
            expect(peak.maxPatrons).toBeLessThan(80);
        });

        test('mugs always stay inside the bar', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() => {
                for (let i = 0; i < 120 * 30; i++) {
                    if (state === 'running' && i % 31 === 0) pour();
                    if (state === 'levelclear') advance();
                    physicsStep(1 / 120);
                    for (const m of mugs) {
                        if (m.x < BAR_LEFT - 40 || m.x > BAR_RIGHT + 40) return { x: m.x };
                    }
                }
                return null;
            });
            expect(bad).toBeNull();
        });

        test('patrons never walk past the taps', async ({ page }) => {
            await startFrozen(page);
            const bad = await page.evaluate(() => {
                for (let i = 0; i < 120 * 30; i++) {
                    if (state === 'levelclear') advance();
                    physicsStep(1 / 120);
                    for (const p of patrons) {
                        if (p.state === 'walking' && p.x > BAR_RIGHT) return { x: p.x };
                    }
                }
                return null;
            });
            expect(bad).toBeNull();
        });

        test('lives never go below zero', async ({ page }) => {
            await startFrozen(page);
            const low = await page.evaluate(() => {
                let min = lives;
                for (let i = 0; i < 120 * 40; i++) {
                    if (state === 'gameover') startGame();
                    if (state === 'levelclear') advance();
                    physicsStep(1 / 120);
                    min = Math.min(min, lives);
                }
                return min;
            });
            expect(low).toBeGreaterThanOrEqual(0);
        });

        test('the score never goes backwards', async ({ page }) => {
            await startFrozen(page);
            const ok = await page.evaluate(() => {
                let prev = score;
                for (let i = 0; i < 120 * 30; i++) {
                    if (state === 'running' && i % 37 === 0) pour();
                    if (state === 'levelclear') advance();
                    physicsStep(1 / 120);
                    if (score < prev) return false;
                    prev = score;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('a perfect shift can clear a level without losing a life', async ({ page }) => {
            await startFrozen(page);
            const result = await page.evaluate(() => {
                // Serve whoever is furthest along, and always stand under the
                // empty closest to the end of the bar.
                for (let i = 0; i < 120 * 180 && state === 'running'; i++) {
                    // An empty on the bar always comes first: stand under the
                    // one nearest the taps and hold the pour until it is in.
                    const empty = mugs.filter((m) => !m.full).sort((a, b) => b.x - a.x)[0];
                    if (empty) {
                        setLane(empty.lane);
                    } else {
                        const target = patrons
                            .filter((p) => p.state === 'walking')
                            .sort((a, b) => b.x - a.x)[0];
                        if (target) {
                            setLane(target.lane);
                            // One mug on the bar at a time: pour, serve, catch.
                            if (mugs.length === 0) pour();
                        }
                    }
                    physicsStep(1 / 120);
                }
                return { state, lives, level, score };
            });
            expect(result.state).toBe('levelclear');
            expect(result.lives).toBe(3);
            expect(result.score).toBeGreaterThan(0);
        });

        test('ignoring the bar ends the shift', async ({ page }) => {
            await startFrozen(page);
            const result = await page.evaluate(() => {
                for (let i = 0; i < 120 * 300 && state !== 'gameover'; i++) physicsStep(1 / 120);
                return state;
            });
            expect(result).toBe('gameover');
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        test('games.json lists Soda Shack', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-shack');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Shack');
            expect(entry.dir).toBe('SodaShack');
            expect(entry.path).toBe('games/SodaShack/index.html');
            expect(entry.thumbnail).toBe('games/SodaShack/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry uses a category the browser already filters on', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-shack');
            const categories = new Set(games.filter((g) => g.id !== 'soda-shack').map((g) => g.category));
            expect(categories.has(entry.category)).toBe(true);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'soda-shack');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaShack/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Soda Shack\s*\|\s*\[SodaShack\/\]\(SodaShack\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaShack/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaShack/DESIGN.md'))).toBe(true);
        });

        test('the game README documents the controls', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'SodaShack/README.md'), 'utf8');
            expect(readme).toMatch(/lane/i);
            expect(readme).toMatch(/pour|serve/i);
        });

        test('DESIGN.md records the assumptions that were made', () => {
            const design = fs.readFileSync(path.join(REPO_ROOT, 'SodaShack/DESIGN.md'), 'utf8');
            expect(design).toMatch(/## Assumptions/);
        });

        test('the game needs no build step — plain html, css and js', () => {
            for (const f of ['index.html', 'style.css', 'game.js']) {
                expect(fs.existsSync(path.join(REPO_ROOT, 'SodaShack', f))).toBe(true);
            }
            const html = fs.readFileSync(path.join(REPO_ROOT, 'SodaShack/index.html'), 'utf8');
            expect(html).toContain('game.js');
            expect(html).toContain('style.css');
        });
    });
});
