const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Most specs are about one subsystem, so they start a game with wolf spawning
// and rock throwing switched off and place entities explicitly. Specs that are
// about spawning or rocks turn the relevant switch back on.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        spawnEnabled = false;
        rockEnabled = false;
        wolves.length = 0;
        meat = null;
    });

// Chromium can acknowledge a synthetic key event before the page's listener has
// run, so key presses are confirmed against the game state before the
// simulation is advanced.
const holdDir = async (page, key, want) => {
    await page.keyboard.down(key);
    await page.waitForFunction((d) => basket.dir === d, want);
};

const releaseDir = async (page, key) => {
    await page.keyboard.up(key);
    await page.waitForFunction(() => basket.dir === 0);
};

test.describe('Pooyan', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Pooyan', async ({ page }) => {
            await expect(page).toHaveTitle('Pooyan');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows starting score, wave, lives and wolves', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#wolves')).toHaveText(String(await page.evaluate(() => quotaFor(1))));
        });

        test('sky is empty before starting', async ({ page }) => {
            const counts = await page.evaluate(() => [wolves.length, arrows.length, rocks.length]);
            expect(counts).toEqual([0, 0, 0]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pooyan-best', '7300'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7300');
        });

        test('the basket starts centred on its track', async ({ page }) => {
            const { y, lo, hi } = await page.evaluate(() => ({
                y: basket.y,
                lo: BASKET_MIN_Y,
                hi: BASKET_MAX_Y,
            }));
            expect(y).toBeGreaterThan(lo);
            expect(y).toBeLessThan(hi);
        });

        test('step does nothing while idle', async ({ page }) => {
            await page.evaluate(() => spawnWolf(200, 100));
            const before = await page.evaluate(() => wolves[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => wolves[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting resets score, wave and lives', async ({ page }) => {
            await page.evaluate(() => {
                score = 5000;
                level = 4;
                lives = 1;
                startGame();
            });
            const s = await page.evaluate(() => ({ score, level, lives }));
            expect(s).toEqual({ score: 0, level: 1, lives: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Basket movement
    // -----------------------------------------------------------------------
    test.describe('basket', () => {
        test('ArrowUp rides the basket up', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => basket.y);
            await holdDir(page, 'ArrowUp', -1);
            await advance(page, 30);
            await releaseDir(page, 'ArrowUp');
            expect(await page.evaluate(() => basket.y)).toBeLessThan(before);
        });

        test('ArrowDown rides the basket down', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => basket.y);
            await holdDir(page, 'ArrowDown', 1);
            await advance(page, 30);
            await releaseDir(page, 'ArrowDown');
            expect(await page.evaluate(() => basket.y)).toBeGreaterThan(before);
        });

        test('W and S also move the basket', async ({ page }) => {
            await startQuiet(page);
            await holdDir(page, 'w', -1);
            await releaseDir(page, 'w');
            await holdDir(page, 's', 1);
            await releaseDir(page, 's');
        });

        test('holding both directions cancels out', async ({ page }) => {
            await startQuiet(page);
            await holdDir(page, 'ArrowUp', -1);
            await page.keyboard.down('ArrowDown');
            await page.waitForFunction(() => basket.dir === 0);
            const before = await page.evaluate(() => basket.y);
            await advance(page, 30);
            expect(await page.evaluate(() => basket.y)).toBe(before);
            await page.keyboard.up('ArrowUp');
            await page.keyboard.up('ArrowDown');
        });

        test('the basket cannot ride off the top of the track', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.dir = -1;
                for (let i = 0; i < 600; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => basket.y)).toBe(await page.evaluate(() => BASKET_MIN_Y));
        });

        test('the basket cannot ride off the bottom of the track', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.dir = 1;
                for (let i = 0; i < 600; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => basket.y)).toBe(await page.evaluate(() => BASKET_MAX_Y));
        });

        test('the basket moves at BASKET_SPEED', async ({ page }) => {
            await startQuiet(page);
            const moved = await page.evaluate(() => {
                basket.y = BASKET_MIN_Y;
                basket.dir = 1;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return basket.y - BASKET_MIN_Y;
            });
            const speed = await page.evaluate(() => BASKET_SPEED);
            expect(moved).toBeCloseTo(speed, 0);
        });
    });

    // -----------------------------------------------------------------------
    // Arrows
    // -----------------------------------------------------------------------
    test.describe('arrows', () => {
        test('Space fires an arrow from the basket', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('Space');
            const arrow = await page.evaluate(() => arrows[0] && { x: arrows[0].x, y: arrows[0].y });
            expect(arrow).not.toBeNull();
            expect(arrow.y).toBe(await page.evaluate(() => basket.y));
            expect(arrow.x).toBeLessThan(await page.evaluate(() => BASKET_X));
        });

        test('arrows fly left and leave the screen', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => shoot());
            const start = await page.evaluate(() => arrows[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => arrows[0].x)).toBeLessThan(start);
            await advance(page, 120);
            expect(await page.evaluate(() => arrows.length)).toBe(0);
        });

        test('at most ARROW_MAX arrows are in flight', async ({ page }) => {
            await startQuiet(page);
            const count = await page.evaluate(() => {
                for (let i = 0; i < 10; i++) shoot();
                return arrows.length;
            });
            expect(count).toBe(await page.evaluate(() => ARROW_MAX));
        });

        test('a fired arrow frees its slot once it leaves the screen', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                for (let i = 0; i < 10; i++) shoot();
            });
            await advance(page, 120);
            await page.evaluate(() => shoot());
            expect(await page.evaluate(() => arrows.length)).toBe(1);
        });

        test('shooting does nothing while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.evaluate(() => shoot());
            expect(await page.evaluate(() => arrows.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Wolves
    // -----------------------------------------------------------------------
    test.describe('wolves', () => {
        test('wolves drift to the right', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnWolf(200, 100));
            await advance(page, 60);
            expect(await page.evaluate(() => wolves[0].x)).toBeGreaterThan(100);
        });

        test('wolves fly level — their height never changes', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnWolf(200, 60));
            await advance(page, 120);
            expect(await page.evaluate(() => wolves[0].y)).toBe(200);
        });

        test('an arrow at the same height pops the balloon and scores', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 200;
                spawnWolf(200, 300);
                shoot();
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ wolves: wolves.length, score, resolved }));
            expect(after.wolves).toBe(0);
            expect(after.score).toBe(await page.evaluate(() => POP_POINTS));
            expect(after.resolved).toBe(1);
        });

        test('an arrow is consumed by the wolf it pops', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 200;
                spawnWolf(200, 300);
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => arrows.length)).toBe(0);
        });

        test('an arrow at the wrong height misses', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 380;
                spawnWolf(120, 300);
                shoot();
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ wolves: wolves.length, score }));
            expect(after).toEqual({ wolves: 1, score: 0 });
        });

        test('one arrow pops only one wolf', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 200;
                spawnWolf(200, 200);
                spawnWolf(200, 320);
                shoot();
            });
            await advance(page, 60);
            expect(await page.evaluate(() => wolves.length)).toBe(1);
        });

        test('a wolf that reaches the house costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnWolf(200, ESCAPE_X - 30));
            await advance(page, 180);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('an escaping wolf still counts towards the wave quota', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnWolf(200, ESCAPE_X - 30));
            await advance(page, 180);
            const after = await page.evaluate(() => ({ wolves: wolves.length, resolved }));
            expect(after).toEqual({ wolves: 0, resolved: 1 });
        });

        test('wolves fly faster on later waves', async ({ page }) => {
            const [first, later] = await page.evaluate(() => {
                startGame();
                const a = spawnWolf(200, 100).speed;
                level = 4;
                const b = spawnWolf(240, 100).speed;
                return [a, b];
            });
            expect(later).toBeGreaterThan(first);
        });

        test('wolf speed is capped', async ({ page }) => {
            const { speed, cap } = await page.evaluate(() => {
                startGame();
                level = 50;
                return { speed: spawnWolf(200, 100).speed, cap: WOLF_SPEED_CAP };
            });
            expect(speed).toBe(cap);
        });
    });

    // -----------------------------------------------------------------------
    // Rocks
    // -----------------------------------------------------------------------
    test.describe('rocks', () => {
        test('wolves throw rocks', async ({ page }) => {
            // The wolf flies well below the basket, so its rocks sail past and
            // the run is about throwing rather than about being hit.
            const throws = await page.evaluate(() => {
                srand(7);
                startGame();
                spawnEnabled = false;
                wolves.length = 0;
                meat = null;
                spawnWolf(380, 200);
                let seen = 0;
                let previous = 0;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    if (rocks.length > previous) seen += 1;
                    previous = rocks.length;
                }
                return { seen, lives };
            });
            expect(throws.seen).toBeGreaterThan(0);
            expect(throws.lives).toBe(3);
        });

        test('rocks fly right towards the house', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => rocks.push({ x: 200, y: 200, r: ROCK_R }));
            await advance(page, 30);
            expect(await page.evaluate(() => rocks[0].x)).toBeGreaterThan(200);
        });

        test('a rock that hits the basket costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 240;
                rocks.push({ x: BASKET_X - 60, y: 240, r: ROCK_R });
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ lives, rocks: rocks.length }));
            expect(after).toEqual({ lives: 2, rocks: 0 });
        });

        test('a rock that misses the basket flies past harmlessly', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 100;
                rocks.push({ x: BASKET_X - 60, y: 400, r: ROCK_R });
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ lives, rocks: rocks.length }));
            expect(after).toEqual({ lives: 3, rocks: 0 });
        });

        test('an arrow shoots a rock out of the air for points', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 240;
                rocks.push({ x: 200, y: 240, r: ROCK_R });
                shoot();
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ rocks: rocks.length, arrows: arrows.length, score }));
            expect(after.rocks).toBe(0);
            expect(after.arrows).toBe(0);
            expect(after.score).toBe(await page.evaluate(() => ROCK_POINTS));
        });
    });

    // -----------------------------------------------------------------------
    // Meat
    // -----------------------------------------------------------------------
    test.describe('meat', () => {
        test('the meat appears once the wave is half spawned', async ({ page }) => {
            const had = await page.evaluate(() => {
                srand(3);
                startGame();
                rockEnabled = false;
                let seen = false;
                for (let i = 0; i < 3600 && !seen; i++) {
                    step(1 / 60);
                    if (meat) seen = true;
                }
                return { seen, spawned, quota: quotaFor(level) };
            });
            expect(had.seen).toBe(true);
            expect(had.spawned).toBeGreaterThanOrEqual(Math.ceil(had.quota / 2));
        });

        test('unshot meat drifts right and leaves without penalty', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                meat = { x: 40, y: 240, falling: false };
            });
            await advance(page, 30);
            expect(await page.evaluate(() => meat.x)).toBeGreaterThan(40);
            await page.evaluate(() => {
                for (let i = 0; i < 1800; i++) step(1 / 60);
            });
            const after = await page.evaluate(() => ({ meat, lives }));
            expect(after.meat).toBeNull();
            expect(after.lives).toBe(3);
        });

        test('shooting the meat makes it fall', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 240;
                meat = { x: 300, y: 240, falling: false };
                shoot();
            });
            await advance(page, 60);
            const after = await page.evaluate(() => ({ falling: meat.falling, arrows: arrows.length }));
            expect(after.falling).toBe(true);
            expect(after.arrows).toBe(0);
        });

        test('falling meat sweeps every wolf beneath it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                meat = { x: 300, y: 120, falling: true };
                spawnWolf(240, 300);
                spawnWolf(340, 300);
            });
            await advance(page, 120);
            const after = await page.evaluate(() => ({ wolves: wolves.length, score, resolved }));
            expect(after.wolves).toBe(0);
            expect(after.resolved).toBe(2);
            expect(after.score).toBe(2 * (await page.evaluate(() => MEAT_KILL_POINTS)));
        });

        test('falling meat spares wolves in other columns', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                meat = { x: 120, y: 120, falling: true };
                spawnWolf(300, 460);
            });
            await advance(page, 120);
            expect(await page.evaluate(() => wolves.length)).toBe(1);
        });

        test('the meat is gone once it has fallen off the bottom', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                meat = { x: 300, y: 120, falling: true };
            });
            await advance(page, 240);
            expect(await page.evaluate(() => meat)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('later waves send more wolves', async ({ page }) => {
            const quotas = await page.evaluate(() => [quotaFor(1), quotaFor(2), quotaFor(5)]);
            expect(quotas[1]).toBeGreaterThan(quotas[0]);
            expect(quotas[2]).toBeGreaterThan(quotas[1]);
        });

        test('the wave quota is capped', async ({ page }) => {
            const { big, cap } = await page.evaluate(() => ({ big: quotaFor(99), cap: QUOTA_CAP }));
            expect(big).toBe(cap);
        });

        test('the HUD counts down the wolves left in the wave', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = 200;
                spawnWolf(200, 300);
                shoot();
            });
            await advance(page, 60);
            const quota = await page.evaluate(() => quotaFor(1));
            await expect(page.locator('#wolves')).toHaveText(String(quota - 1));
        });

        test('clearing the quota clears the wave and awards a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                resolved = quotaFor(level);
                score = 0;
            });
            await advance(page, 2);
            const after = await page.evaluate(() => ({ state, score }));
            expect(after.state).toBe('levelclear');
            expect(after.score).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('the next wave starts after the clear pause', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                resolved = quotaFor(level);
            });
            await page.evaluate(() => {
                for (let i = 0; i < 300; i++) step(1 / 60);
            });
            const after = await page.evaluate(() => ({ state, level, spawned, resolved }));
            expect(after.state).toBe('running');
            expect(after.level).toBe(2);
            expect(after.spawned).toBe(0);
            expect(after.resolved).toBe(0);
        });

        test('a wave is not cleared while wolves are still flying', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                resolved = quotaFor(level);
                spawnWolf(200, 100);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('losing a life clears the sky', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnWolf(200, 100);
                spawnWolf(300, 140);
                rocks.push({ x: 100, y: 100, r: ROCK_R });
                shoot();
                loseLife();
            });
            const after = await page.evaluate(() => ({
                wolves: wolves.length,
                rocks: rocks.length,
                arrows: arrows.length,
                state,
            }));
            expect(after).toEqual({ wolves: 0, rocks: 0, arrows: 0, state: 'dying' });
        });

        test('play resumes after the death pause with the basket re-centred', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                basket.y = BASKET_MAX_Y;
                loseLife();
                for (let i = 0; i < 180; i++) step(1 / 60);
            });
            const after = await page.evaluate(() => ({ state, y: basket.y, max: BASKET_MAX_Y }));
            expect(after.state).toBe('running');
            expect(after.y).toBeLessThan(after.max);
        });

        test('the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            const after = await page.evaluate(() => ({ state, lives }));
            expect(after).toEqual({ state: 'over', lives: 0 });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('a new best score is stored', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('4321');
            expect(await page.evaluate(() => window.localStorage.getItem('pooyan-best'))).toBe('4321');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('pooyan-best', '9999'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#best')).toHaveText('9999');
        });

        test('the simulation is frozen while dying', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                loseLife();
                deathTimer = 30;
                spawnWolf(200, 100);
            });
            await advance(page, 10);
            expect(await page.evaluate(() => wolves[0].x)).toBe(100);
        });

        test('Space restarts after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => ({ state, lives, score }));
            expect(after).toEqual({ state: 'running', lives: 3, score: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await startQuiet(page);
            // Pause in the same turn as the spawn, so the page's own animation
            // loop cannot nudge the wolf between the two calls.
            const parked = await page.evaluate(() => {
                spawnWolf(200, 100);
                togglePause();
                return wolves[0].x;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => wolves[0].x)).toBe(parked);
        });

        test('pausing does nothing when the game is not running', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Spawning
    // -----------------------------------------------------------------------
    test.describe('spawning', () => {
        test('wolves enter from the left over time', async ({ page }) => {
            const info = await page.evaluate(() => {
                srand(11);
                startGame();
                rockEnabled = false;
                for (let i = 0; i < 900; i++) step(1 / 60);
                return { spawned, flying: wolves.length };
            });
            expect(info.spawned).toBeGreaterThan(0);
            expect(info.flying).toBeGreaterThan(0);
        });

        test('no more than the wave quota is ever spawned', async ({ page }) => {
            const info = await page.evaluate(() => {
                srand(5);
                startGame();
                rockEnabled = false;
                const quota = quotaFor(1);
                let max = 0;
                for (let i = 0; i < 3600; i++) {
                    step(1 / 60);
                    if (level !== 1) break;
                    max = Math.max(max, spawned);
                }
                return { max, quota };
            });
            expect(info.max).toBeLessThanOrEqual(info.quota);
        });

        test('wolves spawn within the playable band', async ({ page }) => {
            const ys = await page.evaluate(() => {
                srand(2);
                startGame();
                rockEnabled = false;
                const seen = [];
                for (let i = 0; i < 3600; i++) {
                    step(1 / 60);
                    wolves.forEach((w) => seen.push(w.y));
                }
                return { seen, lo: WOLF_MIN_Y, hi: WOLF_MAX_Y };
            });
            expect(ys.seen.length).toBeGreaterThan(0);
            expect(Math.min(...ys.seen)).toBeGreaterThanOrEqual(ys.lo);
            expect(Math.max(...ys.seen)).toBeLessThanOrEqual(ys.hi);
        });

        test('the same seed produces the same wave', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    srand(42);
                    startGame();
                    for (let i = 0; i < 1200; i++) step(1 / 60);
                    return wolves.map((w) => [Math.round(w.x), w.y]);
                });
            expect(await run()).toEqual(await run());
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnWolf(200, 200);
                rocks.push({ x: 300, y: 300, r: ROCK_R });
                meat = { x: 150, y: 240, falling: false };
                shoot();
                draw();
            });
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('drawing never throws in any state', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const states = ['idle', 'running', 'paused', 'dying', 'levelclear', 'over'];
                for (const s of states) {
                    state = s;
                    draw();
                }
                state = 'idle';
                return true;
            });
            expect(ok).toBe(true);
        });
    });
});
