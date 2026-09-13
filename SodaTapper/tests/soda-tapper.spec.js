const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Every test drives the simulation itself through step(dt) with automatic
// patron arrivals switched off, so the world only ever contains what the test
// put in it and nothing depends on the wall clock.
async function startClean(page) {
    await page.evaluate(() => {
        startGame();
        setSpawnEnabled(false);
        clearEntities();
    });
}

const consts = (page) =>
    page.evaluate(() => ({
        BAR_LEFT,
        BAR_RIGHT,
        GRAB_X,
        CATCH_X,
        LANE_COUNT,
        START_LIVES,
        MUG_SPEED,
        EMPTY_SPEED,
        PUSH_DIST,
        DRINK_TIME,
        POUR_COOLDOWN,
        SERVE_POINTS,
        EXIT_POINTS,
        CATCH_POINTS,
        LEVEL_POINTS,
        HIT_DIST,
    }));

test.describe('Soda Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => setAutoStep(false));
    });

    // -----------------------------------------------------------------------
    // Initial state
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

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('lives start at three', async ({ page }) => {
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('level starts at 1', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('canvas is 640x420', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '420');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('soda-tapper-best', '3100'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3100');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('overlay is hidden once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game has full lives and no score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                startGame();
            });
            expect(await page.evaluate(() => ({ score, lives, level }))).toEqual({
                score: 0,
                lives: 3,
                level: 1,
            });
        });

        test('the server starts on the top bar', async ({ page }) => {
            await startClean(page);
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the bar is empty at the start of a game', async ({ page }) => {
            await page.evaluate(() => {
                setSpawnEnabled(false);
                startGame();
            });
            expect(await page.evaluate(() => patrons.length + mugs.length + empties.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Moving between bars
    // -----------------------------------------------------------------------
    test.describe('moving between bars', () => {
        test('arrow down moves down one bar', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(1);
        });

        test('arrow up moves back up one bar', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => server.lane)).toBe(1);
        });

        test('w and s also move the server', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('s');
            await page.keyboard.press('s');
            expect(await page.evaluate(() => server.lane)).toBe(2);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => server.lane)).toBe(1);
        });

        test('the server cannot go above the top bar', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('ArrowUp');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });

        test('the server cannot go below the bottom bar', async ({ page }) => {
            await startClean(page);
            const { LANE_COUNT } = await consts(page);
            for (let i = 0; i < LANE_COUNT + 3; i++) await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(LANE_COUNT - 1);
        });

        test('the server does not move while paused', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => server.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('pouring puts a mug on the server bar', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                moveLane(1);
                pour();
            });
            expect(await page.evaluate(() => mugs.map((m) => m.lane))).toEqual([1]);
        });

        test('a poured mug starts at the tap end', async ({ page }) => {
            await startClean(page);
            const { BAR_RIGHT } = await consts(page);
            await page.evaluate(() => pour());
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeGreaterThan(BAR_RIGHT - 40);
            expect(x).toBeLessThanOrEqual(BAR_RIGHT);
        });

        test('a mug slides toward the far end of the bar', async ({ page }) => {
            await startClean(page);
            const { MUG_SPEED } = await consts(page);
            const moved = await page.evaluate(() => {
                pour();
                const before = mugs[0].x;
                step(0.1);
                return before - mugs[0].x;
            });
            expect(moved).toBeCloseTo(MUG_SPEED * 0.1, 1);
        });

        test('space pours while the game is running', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pours are rate limited', async ({ page }) => {
            await startClean(page);
            expect(await page.evaluate(() => [pour(), pour()])).toEqual([true, false]);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('pouring works again after the cooldown', async ({ page }) => {
            await startClean(page);
            const { POUR_COOLDOWN } = await consts(page);
            const second = await page.evaluate((cd) => {
                pour();
                step(cd + 0.01);
                return pour();
            }, POUR_COOLDOWN);
            expect(second).toBe(true);
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('pouring does nothing before the game starts', async ({ page }) => {
            expect(await page.evaluate(() => pour())).toBe(false);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('pouring does nothing while paused', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => pour())).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test('a patron walks toward the taps', async ({ page }) => {
            await startClean(page);
            const moved = await page.evaluate(() => {
                const p = spawnPatron(0, 200);
                step(1.0);
                return p.x - 200;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a patron that reaches the taps costs a life', async ({ page }) => {
            await startClean(page);
            const { GRAB_X, START_LIVES } = await consts(page);
            const after = await page.evaluate((grabX) => {
                spawnPatron(2, grabX - 1);
                step(0.5);
                return { lives, patrons: patrons.length };
            }, GRAB_X);
            expect(after).toEqual({ lives: START_LIVES - 1, patrons: 0 });
        });

        test('a mug hits the patron in its lane', async ({ page }) => {
            await startClean(page);
            const result = await page.evaluate(() => {
                const p = spawnPatron(0, 300);
                pour();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return { mugs: mugs.length, patronState: p.state, score };
            });
            expect(result.mugs).toBe(0);
            expect(result.patronState).not.toBe('advancing');
            expect(result.score).toBeGreaterThan(0);
        });

        test('a hit scores serve points', async ({ page }) => {
            await startClean(page);
            const { SERVE_POINTS } = await consts(page);
            const scored = await page.evaluate(() => {
                spawnPatron(0, 300);
                pour();
                for (let i = 0; i < 120; i++) step(1 / 60);
                return score;
            });
            expect(scored).toBe(SERVE_POINTS);
        });

        test('a mug ignores patrons on other bars', async ({ page }) => {
            await startClean(page);
            const { BAR_LEFT } = await consts(page);
            const state = await page.evaluate(() => {
                const p = spawnPatron(3, 300);
                pour(); // server is on lane 0
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { patronState: p.state, score };
            });
            expect(state.patronState).toBe('advancing');
            expect(state.score).toBe(0);
            expect(BAR_LEFT).toBeGreaterThan(0);
        });

        test('a hit patron drinks, then is pushed back', async ({ page }) => {
            await startClean(page);
            const { PUSH_DIST } = await consts(page);
            // Track the moment of the hit and the furthest the patron is
            // driven back, so the assertion does not depend on when within the
            // run the patron starts walking forward again.
            const pushed = await page.evaluate(() => {
                const p = spawnPatron(0, 400);
                pour();
                let hitAt = null;
                let furthest = null;
                for (let i = 0; i < 180; i++) {
                    step(1 / 60);
                    if (hitAt === null && p.state !== 'advancing') {
                        hitAt = p.x;
                        furthest = p.x;
                    } else if (hitAt !== null) {
                        furthest = Math.min(furthest, p.x);
                    }
                }
                return { hitAt, furthest };
            });
            expect(pushed.hitAt).not.toBeNull();
            expect(pushed.hitAt - pushed.furthest).toBeCloseTo(PUSH_DIST, 0);
        });

        test('a mug slides past a patron who is already drinking', async ({ page }) => {
            await startClean(page);
            const { SERVE_POINTS } = await consts(page);
            const result = await page.evaluate(() => {
                const p = spawnPatron(0, 300);
                p.state = 'drinking';
                p.drinkTimer = 10;
                pour();
                for (let i = 0; i < 180; i++) step(1 / 60);
                return { score, patronState: p.state, mugs: mugs.length };
            });
            // The mug is not consumed by the drinker — it runs on and smashes.
            expect(result.score).toBe(0);
            expect(result.patronState).toBe('drinking');
            expect(result.mugs).toBe(0);
            expect(SERVE_POINTS).toBeGreaterThan(0);
        });

        test('spamming mugs at one patron does not farm points', async ({ page }) => {
            await startClean(page);
            const { SERVE_POINTS, EXIT_POINTS, CATCH_POINTS, BAR_LEFT, PUSH_DIST } =
                await consts(page);
            const result = await page.evaluate(() => {
                lives = 99; // the wasted mugs would otherwise end the game
                spawnPatron(0, 420);
                for (let i = 0; i < 600; i++) {
                    pour();
                    step(1 / 60);
                }
                return { score, patrons: patrons.length };
            });
            // Ten seconds of held-down pouring can still only walk this patron
            // off the bar: one hit per push, the exit bonus, and at most the
            // empty they leave behind. No re-serving a customer mid-drink.
            const hits = Math.ceil((420 - BAR_LEFT) / PUSH_DIST);
            expect(result.patrons).toBe(0);
            expect(result.score).toBeLessThanOrEqual(
                SERVE_POINTS * hits + EXIT_POINTS + CATCH_POINTS
            );
        });

        test('a served patron comes back faster', async ({ page }) => {
            await startClean(page);
            const speeds = await page.evaluate(() => {
                const p = spawnPatron(0, 400);
                const before = p.speed;
                pour();
                for (let i = 0; i < 120 && p.state === 'advancing'; i++) step(1 / 60);
                return { before, after: p.speed };
            });
            expect(speeds.after).toBeGreaterThan(speeds.before);
        });

        test('a patron pushed off the end leaves and scores', async ({ page }) => {
            await startClean(page);
            const { BAR_LEFT, EXIT_POINTS } = await consts(page);
            // A patron standing right by the exit needs only one mug.
            const result = await page.evaluate((barLeft) => {
                spawnPatron(0, barLeft + 4);
                pour();
                for (let i = 0; i < 400 && patrons.length; i++) step(1 / 60);
                return { patrons: patrons.length, served, score };
            }, BAR_LEFT);
            expect(result.patrons).toBe(0);
            expect(result.served).toBe(1);
            expect(result.score).toBeGreaterThanOrEqual(EXIT_POINTS);
        });

        test('a departing patron leaves an empty mug behind', async ({ page }) => {
            await startClean(page);
            const { BAR_LEFT } = await consts(page);
            const result = await page.evaluate((barLeft) => {
                spawnPatron(0, barLeft + 4);
                pour();
                for (let i = 0; i < 400 && patrons.length; i++) step(1 / 60);
                return empties.map((e) => e.lane);
            }, BAR_LEFT);
            expect(result).toEqual([0]);
        });
    });

    // -----------------------------------------------------------------------
    // Mishaps
    // -----------------------------------------------------------------------
    test.describe('mishaps', () => {
        test('a mug that hits nothing smashes and costs a life', async ({ page }) => {
            await startClean(page);
            const { START_LIVES } = await consts(page);
            const after = await page.evaluate(() => {
                pour();
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { mugs: mugs.length, lives };
            });
            expect(after).toEqual({ mugs: 0, lives: START_LIVES - 1 });
        });

        test('an empty caught by the server scores', async ({ page }) => {
            await startClean(page);
            const { CATCH_POINTS, START_LIVES } = await consts(page);
            const after = await page.evaluate(() => {
                spawnEmpty(0);
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { empties: empties.length, lives, score };
            });
            expect(after.empties).toBe(0);
            expect(after.lives).toBe(START_LIVES);
            expect(after.score).toBe(CATCH_POINTS);
        });

        test('an empty on another bar smashes and costs a life', async ({ page }) => {
            await startClean(page);
            const { START_LIVES } = await consts(page);
            const after = await page.evaluate(() => {
                spawnEmpty(2); // server is on lane 0
                for (let i = 0; i < 300; i++) step(1 / 60);
                return { empties: empties.length, lives, score };
            });
            expect(after.empties).toBe(0);
            expect(after.lives).toBe(START_LIVES - 1);
            expect(after.score).toBe(0);
        });

        test('the lives readout follows the count', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Game over
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => state)).toBe('gameover');
        });

        test('the overlay reappears on game over', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over|shift/i);
        });

        test('the final score is shown', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                score = 750;
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#overlay-score')).toContainText('750');
        });

        test('the best score is kept and stored', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                score = 900;
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await expect(page.locator('#best')).toHaveText('900');
            expect(await page.evaluate(() => window.localStorage.getItem('soda-tapper-best'))).toBe(
                '900'
            );
        });

        test('the world stops once the game is over', async ({ page }) => {
            await startClean(page);
            const moved = await page.evaluate(() => {
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
                const p = spawnPatron(0, 200);
                step(1.0);
                return p.x - 200;
            });
            expect(moved).toBe(0);
        });

        test('space starts a new game after a loss', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                lives = 1;
                spawnEmpty(2);
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => ({ state, lives }))).toEqual({
                state: 'running',
                lives: 3,
            });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('p pauses the game', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('p resumes the game', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            await startClean(page);
            const moved = await page.evaluate(() => {
                const p = spawnPatron(0, 200);
                togglePause();
                step(1.0);
                return p.x - 200;
            });
            expect(moved).toBe(0);
        });

        test('the overlay says the game is paused', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('escape also pauses', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('paused');
        });
    });

    // -----------------------------------------------------------------------
    // Rounds
    // -----------------------------------------------------------------------
    test.describe('rounds', () => {
        test('later rounds send more patrons', async ({ page }) => {
            const [one, two] = await page.evaluate(() => [patronsForLevel(1), patronsForLevel(2)]);
            expect(two).toBeGreaterThan(one);
        });

        test('serving the whole round advances the level', async ({ page }) => {
            await startClean(page);
            const { LEVEL_POINTS } = await consts(page);
            const after = await page.evaluate(() => {
                score = 0;
                servedThisLevel = patronsForLevel(level);
                spawnedThisLevel = patronsForLevel(level);
                step(1 / 60);
                return { level, score, servedThisLevel };
            });
            expect(after.level).toBe(2);
            expect(after.score).toBe(LEVEL_POINTS);
            expect(after.servedThisLevel).toBe(0);
        });

        test('the round does not end while patrons remain', async ({ page }) => {
            await startClean(page);
            const level = await page.evaluate(() => {
                servedThisLevel = patronsForLevel(level);
                spawnedThisLevel = patronsForLevel(level);
                spawnPatron(0, 200);
                step(1 / 60);
                return level;
            });
            expect(level).toBe(1);
        });

        test('patrons get faster in later rounds', async ({ page }) => {
            const [slow, fast] = await page.evaluate(() => [patronSpeed(1), patronSpeed(4)]);
            expect(fast).toBeGreaterThan(slow);
        });

        test('lives are not refilled between rounds', async ({ page }) => {
            await startClean(page);
            const lives = await page.evaluate(() => {
                lives = 2;
                servedThisLevel = patronsForLevel(level);
                spawnedThisLevel = patronsForLevel(level);
                step(1 / 60);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('the level readout follows the level', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                servedThisLevel = patronsForLevel(level);
                spawnedThisLevel = patronsForLevel(level);
                step(1 / 60);
            });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Arrivals
    // -----------------------------------------------------------------------
    test.describe('arrivals', () => {
        test('patrons arrive on their own once the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            const count = await page.evaluate(() => {
                for (let i = 0; i < 600; i++) step(1 / 60);
                return patrons.length + served;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('arrivals can be switched off', async ({ page }) => {
            await startClean(page);
            const count = await page.evaluate(() => {
                for (let i = 0; i < 600; i++) step(1 / 60);
                return patrons.length;
            });
            expect(count).toBe(0);
        });

        test('a round never sends more than its quota', async ({ page }) => {
            await page.evaluate(() => startGame());
            const over = await page.evaluate(() => {
                for (let i = 0; i < 1800; i++) step(1 / 60);
                return spawnedThisLevel > patronsForLevel(level);
            });
            expect(over).toBe(false);
        });

        test('arriving patrons start at the far end of a bar', async ({ page }) => {
            await page.evaluate(() => startGame());
            const { BAR_LEFT } = await consts(page);
            const spawnX = await page.evaluate(() => {
                let first = null;
                for (let i = 0; i < 1200 && first === null; i++) {
                    step(1 / 60);
                    if (patrons.length) first = patrons[0].spawnX;
                }
                return first;
            });
            expect(spawnX).toBeCloseTo(BAR_LEFT, 0);
        });
    });

    // -----------------------------------------------------------------------
    // HUD and rendering
    // -----------------------------------------------------------------------
    test.describe('HUD and rendering', () => {
        test('the score readout follows the score', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnPatron(0, 300);
                pour();
                for (let i = 0; i < 120; i++) step(1 / 60);
            });
            const { SERVE_POINTS } = await consts(page);
            await expect(page.locator('#score')).toHaveText(String(SERVE_POINTS));
        });

        test('the served readout counts customers', async ({ page }) => {
            await startClean(page);
            const { BAR_LEFT } = await consts(page);
            await page.evaluate((barLeft) => {
                spawnPatron(0, barLeft + 4);
                pour();
                for (let i = 0; i < 400 && patrons.length; i++) step(1 / 60);
            }, BAR_LEFT);
            await expect(page.locator('#served')).toHaveText('1');
        });

        test('the canvas is not blank while playing', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                spawnPatron(0, 300);
                pour();
            });
            const distinct = await page.evaluate(async () => {
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, 640, 420).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(distinct).toBeGreaterThan(5);
        });

        test('the help text lists the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText('P');
            await expect(page.locator('.help')).toContainText(/pour|serve/i);
        });
    });
});
