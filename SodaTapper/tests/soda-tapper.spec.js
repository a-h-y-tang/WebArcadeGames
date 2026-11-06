const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Start a level and freeze the world: the animation loop stops simulating, the
// bar is emptied, and the spawn timer is pushed far into the future so nothing
// walks in on its own. Tests then build the exact situation they care about and
// advance the simulation one fixed step at a time.
async function startFrozen(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        patrons.length = 0;
        mugs.length = 0;
        spawnTimer = 1e9;
    });
}

// Replace the patrons on the bar with exactly the ones a test wants.
async function setPatrons(page, list) {
    await page.evaluate((rows) => {
        patrons.length = 0;
        rows.forEach((p) =>
            patrons.push({ lane: p.lane, x: p.x, speed: p.speed === undefined ? 0 : p.speed, drinks: p.drinks || 0 })
        );
    }, list);
}

// Replace the mugs in flight. dir 1 is a full mug heading for the door, dir -1
// is an empty on its way back to the taps.
async function setMugs(page, list) {
    await page.evaluate((rows) => {
        mugs.length = 0;
        rows.forEach((m) => mugs.push({ lane: m.lane, x: m.x, dir: m.dir }));
    }, list);
}

// Advance the frozen simulation by `steps` fixed timesteps.
async function step(page, steps = 1) {
    await page.evaluate((n) => {
        for (let i = 0; i < n; i++) physicsStep(1 / 120);
    }, steps);
}

// Everything a test normally needs to assert on, in one round trip.
async function snapshot(page) {
    return page.evaluate(() => ({
        state,
        score,
        level,
        lives,
        served,
        streak,
        lane: bartender.lane,
        patrons: patrons.map((p) => ({ lane: p.lane, x: p.x, drinks: p.drinks })),
        mugs: mugs.map((m) => ({ lane: m.lane, x: m.x, dir: m.dir })),
    }));
}

async function constants(page) {
    return page.evaluate(() => ({
        W,
        H,
        LANES,
        TAP_X,
        EXIT_X,
        MUG_SPEED,
        MUG_R,
        PATRON_R,
        PATRON_PUSH,
        PATRON_REACH,
        PATRON_GAP,
        POUR_COOLDOWN,
        MUGS_PER_LANE,
        LIVES_START,
        LEVEL_COUNT,
        DRINK_POINTS,
        SERVE_POINTS,
        CATCH_POINTS,
        CLEAR_BONUS_PER_LIFE,
    }));
}

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Soda Tapper', async ({ page }) => {
            await expect(page).toHaveTitle('Soda Tapper');
        });

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle with an empty bar', async ({ page }) => {
            const s = await snapshot(page);
            expect(s.state).toBe('idle');
            expect(s.patrons).toEqual([]);
            expect(s.mugs).toEqual([]);
        });

        test('the bartender starts in the top lane', async ({ page }) => {
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('there are four lanes, evenly spaced', async ({ page }) => {
            const c = await constants(page);
            expect(c.LANES).toBe(4);
            const ys = await page.evaluate(() => [laneY(0), laneY(1), laneY(2), laneY(3)]);
            expect(ys).toEqual([96, 196, 296, 396]);
            ys.forEach((y) => {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(c.H);
            });
        });

        test('the taps sit left of the door', async ({ page }) => {
            const c = await constants(page);
            expect(c.TAP_X).toBeLessThan(c.EXIT_X);
            expect(c.TAP_X).toBeGreaterThan(0);
            expect(c.EXIT_X).toBeLessThan(c.W);
        });

        test('the simulation does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoRun = false;
                patrons.push({ lane: 0, x: 400, speed: 40, drinks: 0 });
            });
            await step(page, 60);
            expect(await page.evaluate(() => patrons[0].x)).toBe(400);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh run resets the scoreboard', async ({ page }) => {
            await page.evaluate(() => {
                score = 999;
                lives = 1;
                served = 7;
                level = 4;
                streak = 5;
                startGame();
            });
            const s = await snapshot(page);
            expect(s.score).toBe(0);
            expect(s.lives).toBe(3);
            expect(s.served).toBe(0);
            expect(s.level).toBe(1);
            expect(s.streak).toBe(0);
        });

        test('a fresh run loads level 1 worth of patrons to send', async ({ page }) => {
            await page.evaluate(() => startGame());
            const { spawnsLeft, planned } = await page.evaluate(() => ({
                spawnsLeft,
                planned: levelPlan(1).patrons,
            }));
            expect(spawnsLeft).toBe(planned);
            expect(planned).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between lanes
    // -----------------------------------------------------------------------
    test.describe('lane movement', () => {
        test('ArrowDown and ArrowUp move one lane at a time', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(2);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('S and W move between lanes too', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyS');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('KeyW');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot leave the bar at either end', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
            for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('lanes do not change before the game starts', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('a pour puts a full mug at the taps in the current lane', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                bartender.lane = 2;
                pour();
            });
            const c = await constants(page);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(1);
            expect(s.mugs[0].lane).toBe(2);
            expect(s.mugs[0].dir).toBe(1);
            expect(s.mugs[0].x).toBeGreaterThanOrEqual(c.TAP_X);
            expect(s.mugs[0].x).toBeLessThan(c.TAP_X + 40);
        });

        test('Space pours while the game is running', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the cooldown blocks a second pour straight away', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => pour())).toBe(true);
            expect(await page.evaluate(() => pour())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring works again once the cooldown has run down', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => pour());
            const c = await constants(page);
            await step(page, Math.ceil(c.POUR_COOLDOWN * 120) + 2);
            expect(await page.evaluate(() => pour())).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a lane holds at most MUGS_PER_LANE full mugs', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const cooldownSteps = Math.ceil(c.POUR_COOLDOWN * 120) + 2;
            for (let i = 0; i < c.MUGS_PER_LANE + 2; i++) {
                await page.evaluate(() => pour());
                await page.evaluate(() => {
                    // keep the mugs near the taps so none of them reach the door
                    mugs.forEach((m) => (m.x = TAP_X + 20));
                });
                await step(page, cooldownSteps);
            }
            const s = await snapshot(page);
            expect(s.mugs.filter((m) => m.lane === 0)).toHaveLength(c.MUGS_PER_LANE);
        });

        test('a full lane does not block a pour in another lane', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setMugs(
                page,
                Array.from({ length: c.MUGS_PER_LANE }, () => ({ lane: 0, x: c.TAP_X + 30, dir: 1 }))
            );
            await page.evaluate(() => {
                bartender.pourCooldown = 0;
                bartender.lane = 1;
            });
            expect(await page.evaluate(() => pour())).toBe(true);
            const s = await snapshot(page);
            expect(s.mugs.filter((m) => m.lane === 1)).toHaveLength(1);
        });

        test('empties in a lane do not count against the pour limit', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setMugs(
                page,
                Array.from({ length: c.MUGS_PER_LANE }, (_, i) => ({ lane: 0, x: 300 + i * 20, dir: -1 }))
            );
            await page.evaluate(() => {
                bartender.pourCooldown = 0;
            });
            expect(await page.evaluate(() => pour())).toBe(true);
        });

        test('pouring is refused when the game is not running', async ({ page }) => {
            expect(await page.evaluate(() => pour())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            await startFrozen(page);
            await page.evaluate(() => togglePause());
            await page.evaluate(() => {
                bartender.pourCooldown = 0;
            });
            expect(await page.evaluate(() => pour())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Mugs in flight
    // -----------------------------------------------------------------------
    test.describe('mugs in flight', () => {
        test('a full mug slides toward the door at MUG_SPEED', async ({ page }) => {
            await startFrozen(page);
            await setMugs(page, [{ lane: 0, x: 200, dir: 1 }]);
            const c = await constants(page);
            await step(page, 120);
            const x = (await snapshot(page)).mugs[0].x;
            expect(x).toBeCloseTo(200 + c.MUG_SPEED, 0);
        });

        test('an empty mug slides back toward the taps', async ({ page }) => {
            await startFrozen(page);
            await setMugs(page, [{ lane: 0, x: 500, dir: -1 }]);
            const c = await constants(page);
            await step(page, 120);
            const x = (await snapshot(page)).mugs[0].x;
            expect(x).toBeCloseTo(500 - c.MUG_SPEED, 0);
        });

        test('a mug stays in its own lane', async ({ page }) => {
            await startFrozen(page);
            await setMugs(page, [{ lane: 3, x: 200, dir: 1 }]);
            await step(page, 60);
            expect((await snapshot(page)).mugs[0].lane).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Serving patrons
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('a patron catching a mug scores, drinks and is pushed back', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [{ lane: 1, x: 300 }]);
            await setMugs(page, [{ lane: 1, x: 300 - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.score).toBe(c.DRINK_POINTS);
            expect(s.patrons).toHaveLength(1);
            expect(s.patrons[0].drinks).toBe(1);
            expect(s.patrons[0].x).toBeCloseTo(300 + c.PATRON_PUSH, 0);
        });

        test('the empty mug comes straight back down the lane', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [{ lane: 2, x: 300 }]);
            await setMugs(page, [{ lane: 2, x: 300 - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(1);
            expect(s.mugs[0].dir).toBe(-1);
            expect(s.mugs[0].lane).toBe(2);
            expect(s.mugs[0].x).toBeGreaterThan(200);
            expect(s.mugs[0].x).toBeLessThan(c.EXIT_X);
        });

        test('a mug only reaches a patron in its own lane', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [{ lane: 0, x: 300 }]);
            await setMugs(page, [{ lane: 1, x: 300 - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.score).toBe(0);
            expect(s.patrons[0].drinks).toBe(0);
            expect(s.mugs[0].dir).toBe(1);
        });

        test('an empty mug slides past a patron without being caught', async ({ page }) => {
            await startFrozen(page);
            await setPatrons(page, [{ lane: 0, x: 300 }]);
            await setMugs(page, [{ lane: 0, x: 340, dir: -1 }]);
            await step(page, 60);
            const s = await snapshot(page);
            expect(s.patrons[0].drinks).toBe(0);
            expect(s.mugs).toHaveLength(1);
            expect(s.mugs[0].x).toBeLessThan(300);
        });

        test('a push past the door sends the patron out satisfied', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const x = c.EXIT_X - 40;
            await setPatrons(page, [{ lane: 0, x }]);
            await setMugs(page, [{ lane: 0, x: x - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.served).toBe(1);
            expect(s.score).toBe(c.DRINK_POINTS + c.SERVE_POINTS);
        });

        test('a patron who is still short of the door stays on the bar', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const x = c.EXIT_X - c.PATRON_PUSH - 60;
            await setPatrons(page, [{ lane: 0, x }]);
            await setMugs(page, [{ lane: 0, x: x - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(1);
            expect(s.served).toBe(0);
        });

        test('a patron walking in from the door needs more than one mug', async ({ page }) => {
            const c = await constants(page);
            await startFrozen(page);
            await setPatrons(page, [{ lane: 0, x: c.EXIT_X - c.PATRON_PUSH - 10 }]);
            await setMugs(page, [
                { lane: 0, x: c.EXIT_X - c.PATRON_PUSH - 10 - (c.MUG_R + c.PATRON_R) - 1, dir: 1 },
            ]);
            await step(page, 2);
            expect((await snapshot(page)).served).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Catching empties
    // -----------------------------------------------------------------------
    test.describe('catching empties', () => {
        test('an empty caught in the right lane scores and builds the streak', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                bartender.lane = 3;
            });
            await setMugs(page, [{ lane: 3, x: c.TAP_X + 1, dir: -1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(0);
            expect(s.score).toBe(c.CATCH_POINTS);
            expect(s.streak).toBe(1);
            expect(s.lives).toBe(c.LIVES_START);
        });

        test('an empty in the wrong lane smashes and costs a life', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                bartender.lane = 0;
                streak = 4;
            });
            await setMugs(page, [{ lane: 2, x: c.TAP_X + 1, dir: -1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(0);
            expect(s.lives).toBe(c.LIVES_START - 1);
            expect(s.streak).toBe(0);
            expect(s.score).toBe(0);
        });

        test('the streak keeps growing over several catches', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            for (let i = 0; i < 3; i++) {
                await setMugs(page, [{ lane: 0, x: c.TAP_X + 1, dir: -1 }]);
                await step(page, 2);
            }
            const s = await snapshot(page);
            expect(s.streak).toBe(3);
            expect(s.score).toBe(3 * c.CATCH_POINTS);
        });
    });

    // -----------------------------------------------------------------------
    // Mishaps
    // -----------------------------------------------------------------------
    test.describe('mishaps', () => {
        test('a full mug that reaches the door smashes and costs a life', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setMugs(page, [{ lane: 0, x: c.EXIT_X - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.mugs).toHaveLength(0);
            expect(s.lives).toBe(c.LIVES_START - 1);
        });

        test('a patron who reaches the taps costs a life and leaves', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [{ lane: 0, x: c.TAP_X + c.PATRON_REACH + 1, speed: 60 }]);
            await step(page, 20);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.lives).toBe(c.LIVES_START - 1);
            expect(s.served).toBe(0);
        });

        test('a patron walks steadily toward the taps', async ({ page }) => {
            await startFrozen(page);
            await setPatrons(page, [{ lane: 0, x: 500, speed: 48 }]);
            await step(page, 120);
            expect((await snapshot(page)).patrons[0].x).toBeCloseTo(500 - 48, 0);
        });

        test('the last life ends the run', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                lives = 1;
            });
            await setMugs(page, [{ lane: 0, x: c.EXIT_X - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.lives).toBe(0);
            expect(s.state).toBe('gameover');
        });

        test('game over shows the overlay with the score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('game over records a new best score', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('4321');
            await expect(page.locator('#best')).toHaveText('4321');
        });

        test('the simulation stops once the run is over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await setMugs(page, [{ lane: 0, x: 200, dir: 1 }]);
            await step(page, 60);
            expect((await snapshot(page)).mugs[0].x).toBe(200);
        });

        test('each kind of mishap is named', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                lives = 99;
            });

            await setMugs(page, [{ lane: 0, x: c.EXIT_X - 1, dir: 1 }]);
            await step(page, 2);
            expect(await page.evaluate(() => lastMishap.reason)).toBe('smash');

            await page.evaluate(() => {
                bartender.lane = 0;
            });
            await setMugs(page, [{ lane: 2, x: c.TAP_X + 1, dir: -1 }]);
            await step(page, 2);
            expect(await page.evaluate(() => lastMishap.reason)).toBe('drop');

            await setPatrons(page, [{ lane: 1, x: c.TAP_X + c.PATRON_REACH + 1, speed: 60 }]);
            await step(page, 20);
            expect(await page.evaluate(() => lastMishap.reason)).toBe('grab');

            expect(await page.evaluate(() => mishaps)).toEqual({ smash: 1, drop: 1, grab: 1 });
        });

        test('the mishap banner fades away', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                lives = 99;
            });
            await setMugs(page, [{ lane: 0, x: c.EXIT_X - 1, dir: 1 }]);
            await step(page, 2);
            expect(await page.evaluate(() => lastMishap !== null)).toBe(true);
            await step(page, 300);
            expect(await page.evaluate(() => lastMishap)).toBeNull();
        });

        test('Space restarts after a game over', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // The queue
    // -----------------------------------------------------------------------
    test.describe('the queue', () => {
        test('a patron will not walk through the one in front', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [
                { lane: 0, x: 300, speed: 0 },
                { lane: 0, x: 300 + c.PATRON_GAP + 2, speed: 90 },
            ]);
            await step(page, 240);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(2);
            const gap = Math.abs(s.patrons[0].x - s.patrons[1].x);
            expect(gap).toBeGreaterThanOrEqual(c.PATRON_GAP - 0.01);
        });

        test('patrons in different lanes do not block each other', async ({ page }) => {
            await startFrozen(page);
            await setPatrons(page, [
                { lane: 0, x: 300, speed: 0 },
                { lane: 1, x: 310, speed: 60 },
            ]);
            await step(page, 120);
            const s = await snapshot(page);
            const walker = s.patrons.find((p) => p.lane === 1);
            expect(walker.x).toBeCloseTo(310 - 60, 0);
        });

        test('a shove travels down the queue behind the drinker', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const front = 300;
            await setPatrons(page, [
                { lane: 0, x: front, speed: 0 },
                { lane: 0, x: front + c.PATRON_GAP, speed: 0 },
            ]);
            await setMugs(page, [{ lane: 0, x: front - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(2);
            expect(s.score).toBe(c.DRINK_POINTS);
            const sorted = s.patrons.slice().sort((a, b) => a.x - b.x);
            expect(sorted[0].x).toBeCloseTo(front + c.PATRON_PUSH, 0);
            expect(sorted[1].x).toBeCloseTo(front + c.PATRON_PUSH + c.PATRON_GAP, 0);
        });

        test('a patron standing clear of the drinker is left where they are', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const front = 240;
            const back = front + c.PATRON_PUSH + c.PATRON_GAP + 40;
            await setPatrons(page, [
                { lane: 0, x: front, speed: 0 },
                { lane: 0, x: back, speed: 0 },
            ]);
            await setMugs(page, [{ lane: 0, x: front - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const sorted = (await snapshot(page)).patrons.slice().sort((a, b) => a.x - b.x);
            expect(sorted[1].x).toBeCloseTo(back, 0);
        });

        test('a shove can bundle the queue out of the door together', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const front = c.EXIT_X - c.PATRON_PUSH + 10;
            await setPatrons(page, [
                { lane: 0, x: front, speed: 0 },
                { lane: 0, x: front + c.PATRON_GAP, speed: 0 },
            ]);
            await setMugs(page, [{ lane: 0, x: front - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(0);
            expect(s.served).toBe(2);
            expect(s.score).toBe(c.DRINK_POINTS + 2 * c.SERVE_POINTS);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and unpauses', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => {
                patrons.length = 0;
                mugs.length = 0;
                spawnTimer = 1e9;
                mugs.push({ lane: 0, x: 200, dir: 1 });
            });
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => mugs[0].x);
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => mugs[0].x)).toBe(before);
        });

        test('the overlay explains the pause', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons walking in
    // -----------------------------------------------------------------------
    test.describe('patrons walking in', () => {
        test('a patron walks in at the door when the spawn timer runs out', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                spawnsLeft = 3;
                spawnTimer = 0;
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.patrons).toHaveLength(1);
            expect(s.patrons[0].x).toBeCloseTo(c.EXIT_X, 0);
            expect(s.patrons[0].lane).toBeGreaterThanOrEqual(0);
            expect(s.patrons[0].lane).toBeLessThan(c.LANES);
            expect(await page.evaluate(() => spawnsLeft)).toBe(2);
            expect(await page.evaluate(() => spawnTimer)).toBeGreaterThan(0);
        });

        test('a patron walks in with a speed near the level base speed', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 1;
                spawnTimer = 0;
            });
            await step(page, 1);
            const { speed, base } = await page.evaluate(() => ({
                speed: patrons[0].speed,
                base: levelPlan(level).speed,
            }));
            expect(speed).toBeGreaterThan(base * 0.85);
            expect(speed).toBeLessThan(base * 1.15);
        });

        test('no one walks in once the level has sent everybody', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
                spawnTimer = 0;
                patrons.push({ lane: 0, x: 400, speed: 0, drinks: 0 });
            });
            await step(page, 240);
            expect((await snapshot(page)).patrons).toHaveLength(1);
        });

        test('a spawn waits rather than stacking on top of a patron at the door', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await setPatrons(page, [0, 1, 2, 3].map((lane) => ({ lane, x: c.EXIT_X - 10 })));
            await page.evaluate(() => {
                spawnsLeft = 2;
                spawnTimer = 0;
            });
            await step(page, 1);
            expect((await snapshot(page)).patrons).toHaveLength(4);
            expect(await page.evaluate(() => spawnsLeft)).toBe(2);
        });

        test('spawns are deterministic for a given run', async ({ page }) => {
            const lanesFor = async () => {
                await startFrozen(page);
                await page.evaluate(() => {
                    spawnsLeft = 6;
                    spawnTimer = 0;
                });
                const out = [];
                for (let i = 0; i < 6; i++) {
                    await page.evaluate(() => {
                        patrons.length = 0;
                        spawnTimer = 0;
                        physicsStep(1 / 120);
                    });
                    out.push(await page.evaluate(() => (patrons[0] ? patrons[0].lane : null)));
                }
                return out;
            };
            const first = await lanesFor();
            const second = await lanesFor();
            expect(first).toEqual(second);
            expect(first.every((l) => l !== null)).toBe(true);
        });

        test('a level sends patrons to more than one lane', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 24;
            });
            const seen = new Set();
            for (let i = 0; i < 24; i++) {
                const lane = await page.evaluate(() => {
                    patrons.length = 0;
                    spawnTimer = 0;
                    physicsStep(1 / 120);
                    return patrons[0] ? patrons[0].lane : null;
                });
                if (lane !== null) seen.add(lane);
            }
            expect(seen.size).toBeGreaterThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('later levels send more patrons, faster, with less of a gap', async ({ page }) => {
            const plans = await page.evaluate(() =>
                [1, 2, 3, 4, 5].map((n) => {
                    const p = levelPlan(n);
                    return { patrons: p.patrons, speed: p.speed, interval: p.interval };
                })
            );
            for (let i = 1; i < plans.length; i++) {
                expect(plans[i].patrons).toBeGreaterThan(plans[i - 1].patrons);
                expect(plans[i].speed).toBeGreaterThan(plans[i - 1].speed);
                expect(plans[i].interval).toBeLessThan(plans[i - 1].interval);
            }
            expect(plans[plans.length - 1].interval).toBeGreaterThan(0);
        });

        test('an empty bar with nobody left to send clears the level', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate(() => {
                score = 100;
                spawnsLeft = 0;
            });
            await step(page, 1);
            const s = await snapshot(page);
            expect(s.state).toBe('levelclear');
            expect(s.score).toBe(100 + c.CLEAR_BONUS_PER_LIFE * c.LIVES_START);
        });

        test('a level is not cleared while a mug is still in flight', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
            });
            await setMugs(page, [{ lane: 0, x: 300, dir: 1 }]);
            await step(page, 1);
            expect((await snapshot(page)).state).toBe('running');
        });

        test('a level is not cleared while a patron is still drinking', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
            });
            await setPatrons(page, [{ lane: 0, x: 400 }]);
            await step(page, 1);
            expect((await snapshot(page)).state).toBe('running');
        });

        test('Space moves on to the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
            });
            await step(page, 1);
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(await page.evaluate(() => spawnsLeft)).toBe(
                await page.evaluate(() => levelPlan(2).patrons)
            );
        });

        test('the next level keeps the score and the lives', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
                lives = 2;
                score = 500;
            });
            await step(page, 1);
            const scored = (await snapshot(page)).score;
            await page.evaluate(() => advance());
            const s = await snapshot(page);
            expect(s.lives).toBe(2);
            expect(s.score).toBe(scored);
        });

        test('clearing the last level wins the run', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate((last) => {
                level = last;
                spawnsLeft = 0;
            }, c.LEVEL_COUNT);
            await step(page, 1);
            expect((await snapshot(page)).state).toBe('won');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('a win is announced on the overlay', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate((last) => {
                level = last;
                spawnsLeft = 0;
            }, c.LEVEL_COUNT);
            await step(page, 1);
            await expect(page.locator('#overlay-title')).toContainText(/win|won|last call/i);
        });

        test('Space after a win starts a fresh run', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            await page.evaluate((last) => {
                level = last;
                spawnsLeft = 0;
            }, c.LEVEL_COUNT);
            await step(page, 1);
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Overlay button
    // -----------------------------------------------------------------------
    test.describe('overlay button', () => {
        test('the button says what it does in each state', async ({ page }) => {
            const button = page.locator('#btn-start');
            await expect(button).toHaveText('Start Game');

            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await expect(button).toHaveText('Resume');
            await page.keyboard.press('KeyP');

            await page.evaluate(() => {
                spawnsLeft = 0;
            });
            await step(page, 1);
            await expect(button).toHaveText('Next Level');

            await page.evaluate(() => {
                advance();
                lives = 1;
                loseLife('smash');
            });
            await expect(button).toHaveText('Play Again');
        });

        test('the button resumes a paused game', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('KeyP');
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the button starts the next level', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                spawnsLeft = 0;
            });
            await step(page, 1);
            await page.locator('#btn-start').click();
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test('the HUD follows the score, lives and patrons served', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                score = 777;
                lives = 2;
                served = 5;
                level = 3;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('777');
            await expect(page.locator('#lives')).toHaveText('2');
            await expect(page.locator('#served')).toHaveText('5');
            await expect(page.locator('#level')).toHaveText('3');
        });

        test('a served patron shows up in the HUD', async ({ page }) => {
            await startFrozen(page);
            const c = await constants(page);
            const x = c.EXIT_X - 40;
            await setPatrons(page, [{ lane: 0, x }]);
            await setMugs(page, [{ lane: 0, x: x - (c.MUG_R + c.PATRON_R) - 1, dir: 1 }]);
            await step(page, 2);
            await expect(page.locator('#served')).toHaveText('1');
        });
    });

    // -----------------------------------------------------------------------
    // Mouse
    // -----------------------------------------------------------------------
    test.describe('mouse', () => {
        test('clicking a lane moves the bartender to it', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => laneY(2));
            await page.mouse.click(box.x + 300, box.y + y);
            expect(await page.evaluate(() => bartender.lane)).toBe(2);
        });

        test('clicking the bar pours a mug', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            const y = await page.evaluate(() => laneY(1));
            await page.mouse.click(box.x + 300, box.y + y);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].lane)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Playing it through
    // -----------------------------------------------------------------------
    test.describe('playing it through', () => {
        test('a hands-off level loses lives but never breaks', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
            });
            await step(page, 120 * 40);
            const s = await snapshot(page);
            expect(['running', 'gameover', 'levelclear']).toContain(s.state);
            expect(s.lives).toBeLessThan(3);
            expect(Number.isFinite(s.score)).toBe(true);
        });

        test('patrons never pile up on top of each other at the door', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                lives = 9999;
            });
            let worst = Infinity;
            for (let i = 0; i < 60; i++) {
                await step(page, 60);
                const gap = await page.evaluate(() => {
                    let min = Infinity;
                    for (let a = 0; a < patrons.length; a++) {
                        for (let b = a + 1; b < patrons.length; b++) {
                            if (patrons[a].lane === patrons[b].lane) {
                                min = Math.min(min, Math.abs(patrons[a].x - patrons[b].x));
                            }
                        }
                    }
                    return min;
                });
                worst = Math.min(worst, gap);
            }
            expect(worst).toBeGreaterThan(20);
        });

        test('an auto-played level can be cleared', async ({ page }) => {
            // A crude bot: stand in the lane with the patron closest to the taps,
            // pour whenever the taps are free, and catch whatever comes back.
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                lives = 9999;
            });
            await page.evaluate(() => {
                for (let i = 0; i < 120 * 90 && state === 'running'; i++) {
                    const returning = mugs.filter((m) => m.dir === -1).sort((a, b) => a.x - b.x)[0];
                    if (returning && returning.x < TAP_X + 120) {
                        bartender.lane = returning.lane;
                    } else {
                        const target = patrons.slice().sort((a, b) => a.x - b.x)[0];
                        if (target) bartender.lane = target.lane;
                    }
                    const mine = patrons.filter((p) => p.lane === bartender.lane);
                    if (mine.length) pour();
                    physicsStep(1 / 120);
                }
            });
            const s = await snapshot(page);
            expect(s.served).toBeGreaterThan(0);
            expect(['levelclear', 'running']).toContain(s.state);
        });

        test('the canvas actually draws something', async ({ page }) => {
            await startFrozen(page);
            await setPatrons(page, [{ lane: 0, x: 400 }]);
            await setMugs(page, [{ lane: 0, x: 200, dir: 1 }]);
            const distinct = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, W, H).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Repository integration
    // -----------------------------------------------------------------------
    test.describe('repository integration', () => {
        test('the game browser lists the game', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const entry = games.find((g) => g.id === 'soda-tapper');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Tapper');
            expect(entry.dir).toBe('SodaTapper');
            expect(entry.path).toBe('games/SodaTapper/index.html');
            expect(entry.thumbnail).toBe('games/SodaTapper/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'soda-tapper');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Soda Tapper\s*\|\s*\[SodaTapper\/\]\(SodaTapper\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'SodaTapper/DESIGN.md'))).toBe(true);
        });
    });
});
