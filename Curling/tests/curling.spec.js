const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Run until every stone has come to rest (with a generous frame cap so a bug
// can never hang the suite).
const settle = (page) =>
    page.evaluate(() => {
        for (let i = 0; i < 4000 && (anyMoving() || state === 'sliding'); i++) step(1 / 60);
    });

// Start a game with the computer skip switched off and the player on the clock,
// so a spec controls exactly which stones are thrown.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoAi = false;
        turn = 'player';
    });

// Throw one stone with explicit settings and let it settle. Returns the stone
// (which may have been removed from play, hence the snapshot).
const throwAndSettle = (page, opts = {}) =>
    page.evaluate((o) => {
        if (o.aim !== undefined) aim = o.aim;
        if (o.weight !== undefined) weight = o.weight;
        if (o.handle !== undefined) handle = o.handle;
        const stone = throwStone();
        sweeping = !!o.sweep;
        for (let i = 0; i < 4000 && anyMoving(); i++) {
            sweeping = !!o.sweep;
            step(1 / 60);
        }
        sweeping = false;
        step(1 / 60);
        return { x: stone.x, y: stone.y, inPlay: stones.includes(stone) };
    }, opts);

test.describe('Curling', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Curling', async ({ page }) => {
            await expect(page).toHaveTitle('Curling');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 760x380', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '760');
            await expect(canvas).toHaveAttribute('height', '380');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the opening end, scores and stones', async ({ page }) => {
            await expect(page.locator('#end')).toHaveText('1');
            await expect(page.locator('#score-you')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
            await expect(page.locator('#stones')).toHaveText(String(await page.evaluate(() => STONES_PER_TEAM)));
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('curling-best', '9'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('9');
        });

        test('no stones are on the sheet before starting', async ({ page }) => {
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('the house sits inside the sheet', async ({ page }) => {
            const geo = await page.evaluate(() => ({
                tee: TEE_X,
                cy: CENTER_Y,
                r: HOUSE_R,
                top: SIDE_T,
                bottom: SIDE_B,
                back: BACK_LINE_X,
                hog: HOG_LINE_X,
                hack: HACK_X,
            }));
            expect(geo.cy - geo.r).toBeGreaterThan(geo.top);
            expect(geo.cy + geo.r).toBeLessThan(geo.bottom);
            expect(geo.back).toBeLessThan(geo.tee);
            // The back line runs across the back of the twelve foot ring.
            expect(geo.back).toBe(geo.tee - geo.r);
            expect(geo.hog).toBeGreaterThan(geo.tee);
            expect(geo.hack).toBeGreaterThan(geo.hog);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await advance(page, 60);
            expect(await page.evaluate(() => stones.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'aiming');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'aiming');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'aiming');
        });

        test('overlay hides once the game is on', async ({ page }) => {
            await page.keyboard.press('Enter');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the player holds the hammer and so throws second', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => hammer)).toBe('player');
            expect(await page.evaluate(() => turn)).toBe('cpu');
        });

        test('both teams start with a full set of stones', async ({ page }) => {
            await page.evaluate(() => startGame());
            const left = await page.evaluate(() => ({ ...stonesLeft }));
            const perTeam = await page.evaluate(() => STONES_PER_TEAM);
            expect(left).toEqual({ player: perTeam, cpu: perTeam });
        });
    });

    // -----------------------------------------------------------------------
    // Aiming controls
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('aim, weight and handle start at their defaults', async ({ page }) => {
            expect(await page.evaluate(() => aim)).toBe(0);
            expect(await page.evaluate(() => weight)).toBe(await page.evaluate(() => DEFAULT_WEIGHT));
            expect(Math.abs(await page.evaluate(() => handle))).toBe(1);
        });

        test('ArrowDown aims down the sheet', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(() => aim > 0);
            expect(await page.evaluate(() => aim)).toBeCloseTo(await page.evaluate(() => AIM_STEP), 5);
        });

        test('ArrowUp aims up the sheet', async ({ page }) => {
            await page.keyboard.press('ArrowUp');
            await page.waitForFunction(() => aim < 0);
        });

        test('W and S also aim', async ({ page }) => {
            await page.keyboard.press('s');
            await page.waitForFunction(() => aim > 0);
            await page.keyboard.press('w');
            await page.waitForFunction(() => aim === 0);
        });

        test('aim is clamped to the maximum either way', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 200; i++) adjustAim(1);
            });
            expect(await page.evaluate(() => aim)).toBe(await page.evaluate(() => AIM_MAX));
            await page.evaluate(() => {
                for (let i = 0; i < 400; i++) adjustAim(-1);
            });
            expect(await page.evaluate(() => aim)).toBe(await page.evaluate(() => -AIM_MAX));
        });

        test('ArrowRight adds weight and ArrowLeft takes it off', async ({ page }) => {
            const start = await page.evaluate(() => weight);
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction((w) => weight > w, start);
            await page.keyboard.press('ArrowLeft');
            await page.waitForFunction((w) => weight === w, start);
        });

        test('weight is clamped to 0..100', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 200; i++) adjustWeight(1);
            });
            expect(await page.evaluate(() => weight)).toBe(100);
            await page.evaluate(() => {
                for (let i = 0; i < 200; i++) adjustWeight(-1);
            });
            expect(await page.evaluate(() => weight)).toBe(0);
        });

        test('H flips the handle', async ({ page }) => {
            const before = await page.evaluate(() => handle);
            await page.keyboard.press('h');
            await page.waitForFunction((h) => handle === -h, before);
            await page.keyboard.press('h');
            await page.waitForFunction((h) => handle === h, before);
        });

        test('the HUD tracks weight and handle', async ({ page }) => {
            await page.evaluate(() => {
                weight = 80;
                handle = -1;
                updateHud();
            });
            await expect(page.locator('#weight')).toHaveText('80');
            await expect(page.locator('#handle')).toContainText(/out/i);
        });
    });

    // -----------------------------------------------------------------------
    // Delivery
    // -----------------------------------------------------------------------
    test.describe('delivery', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('Space delivers a stone', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'sliding');
            expect(await page.evaluate(() => stones.length)).toBe(1);
        });

        test('the stone leaves from the hack on the centre line', async ({ page }) => {
            const s = await page.evaluate(() => {
                const st = throwStone();
                return { x: st.x, y: st.y, team: st.team };
            });
            expect(s.x).toBe(await page.evaluate(() => HACK_X));
            expect(s.y).toBe(await page.evaluate(() => CENTER_Y));
            expect(s.team).toBe('player');
        });

        test('the stone travels down the sheet toward the house', async ({ page }) => {
            await page.evaluate(() => throwStone());
            const before = await page.evaluate(() => stones[0].x);
            await advance(page, 30);
            expect(await page.evaluate(() => stones[0].x)).toBeLessThan(before);
        });

        test('aiming down the sheet sends the stone that way', async ({ page }) => {
            await page.evaluate(() => {
                aim = AIM_MAX;
                handle = 0;
                throwStone();
            });
            expect(await page.evaluate(() => stones[0].vy)).toBeGreaterThan(0);
        });

        test('aiming up the sheet sends the stone that way', async ({ page }) => {
            await page.evaluate(() => {
                aim = -AIM_MAX;
                handle = 0;
                throwStone();
            });
            expect(await page.evaluate(() => stones[0].vy)).toBeLessThan(0);
        });

        test('more weight means more speed', async ({ page }) => {
            const slow = await page.evaluate(() => speedForWeight(20));
            const fast = await page.evaluate(() => speedForWeight(80));
            expect(fast).toBeGreaterThan(slow);
        });

        test('the stone slows down and stops', async ({ page }) => {
            await page.evaluate(() => throwStone());
            await settle(page);
            expect(await page.evaluate(() => anyMoving())).toBe(false);
        });

        test('draw weight parks the stone in the house', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: await page.evaluate(() => DEFAULT_WEIGHT) });
            expect(rest.inPlay).toBe(true);
            const dist = await page.evaluate(({ x, y }) => Math.hypot(x - TEE_X, y - CENTER_Y), rest);
            expect(dist).toBeLessThan(await page.evaluate(() => HOUSE_R));
        });

        test('a second stone cannot be thrown while one is sliding', async ({ page }) => {
            await page.evaluate(() => throwStone());
            await advance(page, 10);
            await page.keyboard.press('Space');
            await advance(page, 10);
            expect(await page.evaluate(() => stones.length)).toBe(1);
        });

        test('delivering uses one of the team stones', async ({ page }) => {
            const before = await page.evaluate(() => stonesLeft.player);
            await page.evaluate(() => throwStone());
            expect(await page.evaluate(() => stonesLeft.player)).toBe(before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Curl and sweeping
    // -----------------------------------------------------------------------
    test.describe('curl and sweeping', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an in-turn curls down the sheet', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 1, weight: 59 });
            expect(rest.y).toBeGreaterThan(await page.evaluate(() => CENTER_Y + 8));
        });

        test('an out-turn curls up the sheet', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: -1, weight: 59 });
            expect(rest.y).toBeLessThan(await page.evaluate(() => CENTER_Y - 8));
        });

        test('a handleless stone runs straight', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: 59 });
            expect(rest.y).toBeCloseTo(await page.evaluate(() => CENTER_Y), 5);
        });

        test('sweeping carries the stone farther', async ({ page }) => {
            const dry = await throwAndSettle(page, { aim: 0, handle: 0, weight: 20 });
            await page.evaluate(() => {
                clearStones();
                turn = 'player';
                stonesLeft.player = STONES_PER_TEAM;
                state = 'aiming';
            });
            const swept = await throwAndSettle(page, { aim: 0, handle: 0, weight: 20, sweep: true });
            expect(swept.inPlay).toBe(true);
            expect(swept.x).toBeLessThan(dry.x - 20);
        });

        test('sweeping keeps the stone straighter', async ({ page }) => {
            // Both stones are measured as they reach the front of the house, so
            // they have covered the same ground when their curl is compared.
            const lateral = (sweep) =>
                page.evaluate((sw) => {
                    clearStones();
                    state = 'aiming';
                    turn = 'player';
                    stonesLeft.player = STONES_PER_TEAM;
                    aim = 0;
                    handle = 1;
                    weight = 40;
                    const st = throwStone();
                    sweeping = sw;
                    for (let i = 0; i < 4000 && anyMoving() && st.x > TEE_X + HOUSE_R; i++) {
                        sweeping = sw;
                        step(1 / 60);
                    }
                    sweeping = false;
                    return st.y - CENTER_Y;
                }, sweep);
            const dry = await lateral(false);
            const swept = await lateral(true);
            expect(dry).toBeGreaterThan(0);
            expect(swept).toBeGreaterThan(0);
            expect(swept).toBeLessThan(dry);
        });

        test('holding Space sweeps the sliding stone', async ({ page }) => {
            await page.evaluate(() => throwStone());
            await page.keyboard.down('Space');
            await page.waitForFunction(() => sweeping === true);
            await page.keyboard.up('Space');
            await page.waitForFunction(() => sweeping === false);
        });

        test('sweeping stops once the stone comes to rest', async ({ page }) => {
            await page.evaluate(() => {
                throwStone();
                sweepHeld = true;
            });
            await settle(page);
            expect(await page.evaluate(() => sweeping)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Lines and boundaries
    // -----------------------------------------------------------------------
    test.describe('boundaries', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a stone short of the hog line is taken off', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: 0 });
            expect(rest.x).toBeGreaterThan(await page.evaluate(() => HOG_LINE_X));
            expect(rest.inPlay).toBe(false);
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a stone through the back line is taken off', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: 100 });
            expect(rest.inPlay).toBe(false);
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a stone off the side is taken off', async ({ page }) => {
            await page.evaluate(() => {
                const s = placeStone('player', 400, CENTER_Y);
                s.vy = -260;
                s.moving = true;
                state = 'sliding';
            });
            await settle(page);
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a stone resting in the house stays in play', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: 59 });
            expect(rest.inPlay).toBe(true);
            expect(await page.evaluate(() => stones.length)).toBe(1);
        });

        test('a stone in the back of the house is not swept off', async ({ page }) => {
            await page.evaluate(() => placeStone('player', BACK_LINE_X + 6, CENTER_Y));
            await advance(page, 30);
            expect(await page.evaluate(() => stones.length)).toBe(1);
            expect(await page.evaluate(() => inHouse(stones[0]))).toBe(true);
        });

        test('a guard short of the house but past the hog line stays in play', async ({ page }) => {
            const rest = await throwAndSettle(page, { aim: 0, handle: 0, weight: 22 });
            expect(rest.inPlay).toBe(true);
            expect(rest.x).toBeGreaterThan(await page.evaluate(() => TEE_X + HOUSE_R));
            expect(rest.x).toBeLessThan(await page.evaluate(() => HOG_LINE_X));
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a running stone sets a resting one moving', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('cpu', TEE_X, CENTER_Y);
                aim = 0;
                handle = 0;
                weight = 85;
                throwStone();
            });
            await settle(page);
            const target = await page.evaluate(() => stones.find((s) => s.team === 'cpu'));
            expect(target === null || target === undefined || target.x !== 160).toBe(true);
        });

        test('a takeout removes the opposing stone from play', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('cpu', TEE_X, CENTER_Y);
                aim = 0;
                handle = 0;
                weight = 100;
                throwStone();
            });
            await settle(page);
            expect(await page.evaluate(() => stones.filter((s) => s.team === 'cpu').length)).toBe(0);
        });

        test('the shooter loses speed in the collision', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                placeStone('cpu', TEE_X, CENTER_Y);
                aim = 0;
                handle = 0;
                weight = 90;
                const shooter = throwStone();
                let before = 0;
                for (let i = 0; i < 4000 && anyMoving(); i++) {
                    const other = stones.find((s) => s.team === 'cpu');
                    if (other && Math.hypot(other.x - shooter.x, other.y - shooter.y) > STONE_R * 2.4) {
                        before = Math.hypot(shooter.vx, shooter.vy);
                    }
                    step(1 / 60);
                    if (other && Math.hypot(other.vx, other.vy) > 1) break;
                }
                return { before, after: Math.hypot(shooter.vx, shooter.vy) };
            });
            expect(speeds.before).toBeGreaterThan(0);
            expect(speeds.after).toBeLessThan(speeds.before);
        });

        test('stones are not left overlapping', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('cpu', TEE_X, CENTER_Y);
                aim = 0;
                handle = 0;
                weight = 62;
                throwStone();
            });
            await settle(page);
            const minGap = await page.evaluate(() => {
                let m = Infinity;
                for (let i = 0; i < stones.length; i++)
                    for (let j = i + 1; j < stones.length; j++)
                        m = Math.min(m, Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y));
                return m;
            });
            if (Number.isFinite(minGap)) {
                expect(minGap).toBeGreaterThanOrEqual((await page.evaluate(() => STONE_R)) * 2 - 0.5);
            }
        });

        test('a guard can be promoted into the house by a following stone', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const guard = placeStone('player', TEE_X + HOUSE_R + 40, CENTER_Y);
                const before = guard.x;
                aim = 0;
                handle = 0;
                weight = 58;
                throwStone();
                for (let i = 0; i < 4000 && anyMoving(); i++) step(1 / 60);
                return { before, after: guard.x, inPlay: stones.includes(guard) };
            });
            expect(moved.after).toBeLessThan(moved.before);
            expect(moved.inPlay).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Turn order and the computer skip
    // -----------------------------------------------------------------------
    test.describe('turns', () => {
        test('the turn passes once the stones stop', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => throwStone());
            await settle(page);
            expect(await page.evaluate(() => turn)).toBe('cpu');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the computer throws its own stone', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                aiNoise = 0;
            });
            await page.evaluate(() => {
                for (let i = 0; i < 4000 && stones.length === 0; i++) step(1 / 60);
            });
            expect(await page.evaluate(() => stones.length)).toBe(1);
            expect(await page.evaluate(() => stones[0].team)).toBe('cpu');
        });

        test('the computer puts stones in play rather than throwing them away', async ({ page }) => {
            const kept = await page.evaluate(() => {
                startGame();
                aiNoise = 0;
                let thrown = 0;
                for (let i = 0; i < 40000 && thrown < 3; i++) {
                    const n = stones.length;
                    step(1 / 60);
                    if (stones.length > n) thrown++;
                    if (turn === 'player' && state === 'aiming') {
                        // Skip the player's stones so only computer deliveries land.
                        stonesLeft.player = Math.max(0, stonesLeft.player - 1);
                        turn = 'cpu';
                    }
                }
                return stones.filter((s) => s.team === 'cpu').length;
            });
            expect(kept).toBeGreaterThan(0);
        });

        test('an end finishes when both teams run out of stones', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                stonesLeft.player = 1;
                stonesLeft.cpu = 0;
                aim = 0;
                handle = 0;
                weight = DEFAULT_WEIGHT;
                throwStone();
            });
            await settle(page);
            expect(await page.evaluate(() => state)).toBe('endover');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the team lying closest to the button scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                placeStone('cpu', TEE_X + 40, CENTER_Y);
                return endResult();
            });
            expect(result).toEqual({ team: 'player', points: 1 });
        });

        test('every stone closer than the best opposing stone counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                placeStone('player', TEE_X + 20, CENTER_Y);
                placeStone('player', TEE_X, CENTER_Y + 30);
                placeStone('cpu', TEE_X + 70, CENTER_Y);
                return endResult();
            });
            expect(result).toEqual({ team: 'player', points: 3 });
        });

        test('stones outside the house do not count', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeStone('cpu', TEE_X, CENTER_Y);
                placeStone('player', HOG_LINE_X - 5, CENTER_Y);
                return endResult();
            });
            expect(result).toEqual({ team: 'cpu', points: 1 });
        });

        test('a stone biting the rings still counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                placeStone('player', TEE_X + HOUSE_R + STONE_R - 2, CENTER_Y);
                return endResult();
            });
            expect(result).toEqual({ team: 'player', points: 1 });
        });

        test('an empty house is a blank end', async ({ page }) => {
            const result = await page.evaluate(() => endResult());
            expect(result).toEqual({ team: null, points: 0 });
        });

        test('the score is added when the end closes', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                placeStone('player', TEE_X + 20, CENTER_Y);
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            expect(await page.evaluate(() => playerScore)).toBe(2);
            expect(await page.evaluate(() => cpuScore)).toBe(0);
            await expect(page.locator('#score-you')).toHaveText('2');
        });

        test('the hammer passes to the team that was scored on', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            expect(await page.evaluate(() => hammer)).toBe('cpu');
        });

        test('a blank end leaves the hammer where it was', async ({ page }) => {
            const before = await page.evaluate(() => hammer);
            await page.evaluate(() => {
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            expect(await page.evaluate(() => hammer)).toBe(before);
        });

        test('the next end clears the sheet and refills the stones', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            expect(await page.evaluate(() => state)).toBe('aiming');
            expect(await page.evaluate(() => end)).toBe(2);
            expect(await page.evaluate(() => stones.length)).toBe(0);
            const perTeam = await page.evaluate(() => STONES_PER_TEAM);
            expect(await page.evaluate(() => ({ ...stonesLeft }))).toEqual({
                player: perTeam,
                cpu: perTeam,
            });
            await expect(page.locator('#end')).toHaveText('2');
        });

        test('the team without the hammer leads off the next end', async ({ page }) => {
            await page.evaluate(() => {
                placeStone('player', TEE_X, CENTER_Y);
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            expect(await page.evaluate(() => hammer)).toBe('cpu');
            expect(await page.evaluate(() => turn)).toBe('player');
        });
    });

    // -----------------------------------------------------------------------
    // The match
    // -----------------------------------------------------------------------
    test.describe('match', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the match ends after the last end', async ({ page }) => {
            await page.evaluate(() => {
                end = TOTAL_ENDS;
                placeStone('player', TEE_X, CENTER_Y);
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the winner is named on the overlay', async ({ page }) => {
            await page.evaluate(() => {
                end = TOTAL_ENDS;
                playerScore = 5;
                cpuScore = 2;
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('a tie is called a tie', async ({ page }) => {
            await page.evaluate(() => {
                end = TOTAL_ENDS;
                playerScore = 3;
                cpuScore = 3;
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            await expect(page.locator('#overlay-title')).toContainText(/tie|draw/i);
        });

        test('a new best score is stored', async ({ page }) => {
            await page.evaluate(() => {
                end = TOTAL_ENDS;
                playerScore = 8;
                cpuScore = 1;
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            await expect(page.locator('#best')).toHaveText('8');
            expect(await page.evaluate(() => window.localStorage.getItem('curling-best'))).toBe('8');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('curling-best', '12'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                end = TOTAL_ENDS;
                playerScore = 2;
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
            });
            await advance(page, Math.ceil(60 * (await page.evaluate(() => ENDOVER_TIME))) + 5);
            await expect(page.locator('#best')).toHaveText('12');
        });

        test('restarting resets the match', async ({ page }) => {
            await page.evaluate(() => {
                playerScore = 4;
                cpuScore = 6;
                end = 3;
                state = 'over';
            });
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => state === 'aiming');
            expect(await page.evaluate(() => playerScore)).toBe(0);
            expect(await page.evaluate(() => cpuScore)).toBe(0);
            expect(await page.evaluate(() => end)).toBe(1);
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
            await page.waitForFunction(() => state === 'aiming');
        });

        test('nothing moves while paused', async ({ page }) => {
            await page.evaluate(() => {
                throwStone();
                togglePause();
            });
            const before = await page.evaluate(() => stones[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => stones[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await advance(page, 10);
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
                autoAi = false;
                turn = 'player';
                draw(); // aiming
                placeStone('cpu', TEE_X + 20, CENTER_Y - 30);
                throwStone();
                sweepHeld = true;
                for (let i = 0; i < 60; i++) step(1 / 60);
                draw(); // sliding + sweeping
                sweepHeld = false;
                for (let i = 0; i < 4000 && anyMoving(); i++) step(1 / 60);
                togglePause();
                draw(); // paused
                togglePause();
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
                draw(); // end over
                for (let i = 0; i < 600; i++) step(1 / 60);
                draw();
                end = TOTAL_ENDS;
                stonesLeft.player = 0;
                stonesLeft.cpu = 0;
                finishEnd();
                for (let i = 0; i < 600; i++) step(1 / 60);
                draw(); // match over
            });
            expect(errors).toEqual([]);
        });
    });
});
