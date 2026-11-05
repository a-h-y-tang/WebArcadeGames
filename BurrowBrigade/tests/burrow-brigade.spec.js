const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
//
// The simulation is a fixed-step integer state machine, so a test can freeze
// the render loop, build the exact cave it cares about, drop in one critter and
// advance the world a tick at a time.
// ---------------------------------------------------------------------------

// Start a level, stop the animation loop, empty the world and shut the hatch.
async function sandbox(page) {
    await page.evaluate(() => {
        startGame();
        autoRun = false;
        autoResolve = false;
        clearTerrain();
        critters.length = 0;
        spawned = totalCritters;
        exitRect = { x: -99, y: -99, w: 0, h: 0 };
    });
}

// Paint a rectangle of cells.
async function fill(page, rects) {
    await page.evaluate((list) => {
        list.forEach((r) => fillRect(r.x, r.y, r.w, r.h, r.cell));
    }, rects);
}

// Drop a critter into the world, optionally pre-loaded with an ability.
async function place(page, spec) {
    return page.evaluate((s) => {
        const c = spawnCritter(s.x, s.y, s.dir === undefined ? 1 : s.dir);
        if (s.ability) c.ability = s.ability;
        if (s.bricks !== undefined) c.bricks = s.bricks;
        return critters.indexOf(c);
    }, spec);
}

// Read a critter back out of the page.
async function critter(page, i) {
    return page.evaluate((n) => ({ ...critters[n] }), i);
}

// Advance the frozen simulation by `n` ticks.
async function step(page, n = 1) {
    await page.evaluate((count) => {
        for (let i = 0; i < count; i++) simStep();
    }, n);
}

// Read one terrain cell.
async function cell(page, x, y) {
    return page.evaluate(([cx, cy]) => cellAt(cx, cy), [x, y]);
}

test.describe('Burrow Brigade', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burrow Brigade', async ({ page }) => {
            await expect(page).toHaveTitle('Burrow Brigade');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('the grid matches the canvas size', async ({ page }) => {
            const dims = await page.evaluate(() => ({ cols: COLS, rows: ROWS, cell: CELL }));
            expect(dims.cols * dims.cell).toBe(640);
            expect(dims.rows * dims.cell).toBe(480);
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no critters walk before starting', async ({ page }) => {
            expect(await page.evaluate(() => critters.length)).toBe(0);
        });

        test('HUD shows starting values', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#saved')).toHaveText('0');
            await expect(page.locator('#out')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('best run loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burrowbrigade-best', '42'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('42');
        });

        test('the help legend explains clicking a critter and picking an ability', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/click/i);
            await expect(page.locator('.help')).toContainText(/abilit/i);
        });

        test('there is a button for every ability', async ({ page }) => {
            for (const name of ['blocker', 'digger', 'basher', 'builder', 'floater']) {
                await expect(page.locator(`#btn-${name}`)).toBeVisible();
                await expect(page.locator(`#count-${name}`)).toBeVisible();
            }
        });

        test('blocker is the ability selected by default', async ({ page }) => {
            expect(await page.evaluate(() => selectedAbility)).toBe('blocker');
            await expect(page.locator('#btn-blocker')).toHaveClass(/selected/);
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

        test('overlay hides once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('there are three levels', async ({ page }) => {
            expect(await page.evaluate(() => LEVELS.length)).toBe(3);
        });

        test('every level has a hatch, an exit and a reachable quota', async ({ page }) => {
            const levels = await page.evaluate(() => {
                const out = [];
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    out.push({
                        hatch: { ...hatch },
                        exitRect: { ...exitRect },
                        total: totalCritters,
                        required: requiredCritters,
                        ticks: ticksLeft,
                        solid: terrain.filter((c) => c === DIRT || c === STEEL).length,
                        stock: Object.values(inventory).reduce((a, b) => a + b, 0),
                    });
                }
                return out;
            });
            for (const lv of levels) {
                expect(lv.hatch.x).toBeGreaterThanOrEqual(0);
                expect(lv.hatch.x).toBeLessThan(80);
                expect(lv.exitRect.w).toBeGreaterThan(0);
                expect(lv.total).toBeGreaterThan(0);
                expect(lv.required).toBeGreaterThan(0);
                expect(lv.required).toBeLessThanOrEqual(lv.total);
                expect(lv.ticks).toBeGreaterThan(0);
                expect(lv.solid).toBeGreaterThan(100);
                expect(lv.stock).toBeGreaterThan(0);
            }
        });

        test('the hatch releases a critter on the first tick', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                simStep();
            });
            expect(await page.evaluate(() => critters.length)).toBe(1);
            const c = await critter(page, 0);
            const h = await page.evaluate(() => ({ ...hatch }));
            expect(c.x).toBe(h.x);
            expect(c.y).toBe(h.y);
            expect(c.ability).toBe('walker');
        });

        test('the hatch releases one critter per spawn interval', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                autoResolve = false;
                for (let i = 0; i < SPAWN_INTERVAL * 3; i++) simStep();
            });
            expect(await page.evaluate(() => spawned)).toBe(3);
        });

        test('the hatch stops at the level total', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                autoResolve = false;
                for (let i = 0; i < SPAWN_INTERVAL * (totalCritters + 4); i++) simStep();
                return { spawned, total: totalCritters };
            });
            expect(out.spawned).toBe(out.total);
        });

        test('the HUD counts critters released', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                autoResolve = false;
                for (let i = 0; i < SPAWN_INTERVAL * 2; i++) simStep();
                draw();
            });
            await expect(page.locator('#out')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
        });

        test('a walker advances one cell per tick', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 3);
            const c = await critter(page, i);
            expect(c.x).toBe(13);
            expect(c.y).toBe(30);
        });

        test('a walker facing left walks left', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, dir: -1 });
            await step(page, 2);
            expect((await critter(page, i)).x).toBe(8);
        });

        test('a wall three cells tall turns a walker around', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 28, w: 1, h: 3, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 1);
            expect((await critter(page, i)).x).toBe(11);
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(11);
            expect(c.dir).toBe(-1);
            await step(page, 1);
            expect((await critter(page, i)).x).toBe(10);
        });

        test('a one-cell ledge is climbed', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 11, y: 30, w: 10, h: 1, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(11);
            expect(c.y).toBe(29);
            expect(c.dir).toBe(1);
        });

        test('a two-cell ledge is climbed', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 11, y: 29, w: 10, h: 2, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(11);
            expect(c.y).toBe(28);
        });

        test('the level edge turns a walker around', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 0, y: 30, dir: -1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(0);
            expect(c.dir).toBe(1);
        });

        test('an overhang at head height turns a walker around', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 11, y: 29, w: 1, h: 1, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(10);
            expect(c.dir).toBe(-1);
        });

        test('steel is as impassable as dirt', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 27, w: 1, h: 4, cell: 2 },
            ]);
            const i = await place(page, { x: 11, y: 30, dir: 1 });
            await step(page, 1);
            expect((await critter(page, i)).dir).toBe(-1);
        });
    });

    // -----------------------------------------------------------------------
    // Falling
    // -----------------------------------------------------------------------
    test.describe('falling', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
        });

        test('a critter with no ground falls two cells per tick', async ({ page }) => {
            const i = await place(page, { x: 10, y: 10 });
            await step(page, 2);
            const c = await critter(page, i);
            expect(c.y).toBe(14);
            expect(c.fallDist).toBe(4);
        });

        test('a floater falls one cell per tick', async ({ page }) => {
            const i = await place(page, { x: 10, y: 10, ability: 'floater' });
            await step(page, 3);
            expect((await critter(page, i)).y).toBe(13);
        });

        test('a short fall is survived and resets the fall counter', async ({ page }) => {
            await fill(page, [{ x: 0, y: 21, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 14, dir: 1 });
            await step(page, 5);
            const c = await critter(page, i);
            expect(c.alive).toBe(true);
            expect(c.y).toBe(20);
            expect(c.fallDist).toBe(0);
        });

        test('a fall longer than the splat distance is fatal', async ({ page }) => {
            await fill(page, [{ x: 0, y: 41, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 10 });
            await step(page, 20);
            const c = await critter(page, i);
            expect(c.fallDist).toBeGreaterThan(16);
            expect(c.alive).toBe(false);
        });

        test('a fall of exactly the splat distance is survived', async ({ page }) => {
            await fill(page, [{ x: 0, y: 27, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 10 });
            await step(page, 12);
            const c = await critter(page, i);
            expect(c.alive).toBe(true);
            expect(c.y).toBe(26);
        });

        test('a floater survives any drop', async ({ page }) => {
            await fill(page, [{ x: 0, y: 55, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 5, ability: 'floater' });
            await step(page, 60);
            const c = await critter(page, i);
            expect(c.alive).toBe(true);
            expect(c.y).toBe(54);
        });

        test('falling off the bottom of the cave is fatal', async ({ page }) => {
            const i = await place(page, { x: 10, y: 50 });
            await step(page, 10);
            expect((await critter(page, i)).alive).toBe(false);
        });

        test('a death is counted as lost', async ({ page }) => {
            const before = await page.evaluate(() => lost);
            await place(page, { x: 10, y: 50 });
            await step(page, 10);
            expect(await page.evaluate(() => lost)).toBe(before + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Hazards and the exit
    // -----------------------------------------------------------------------
    test.describe('water and the exit', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
        });

        test('water is not solid', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 2, cell: 3 }]);
            expect(await page.evaluate(() => isSolid(10, 31))).toBe(false);
        });

        test('walking into water drowns a critter', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 29, w: 4, h: 3, cell: 3 },
            ]);
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 6);
            const c = await critter(page, i);
            expect(c.alive).toBe(false);
            expect(c.saved).toBe(false);
        });

        test('reaching the exit saves a critter', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            await page.evaluate(() => {
                exitRect = { x: 14, y: 29, w: 2, h: 2 };
            });
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 4);
            const c = await critter(page, i);
            expect(c.saved).toBe(true);
            expect(c.alive).toBe(true);
            expect(await page.evaluate(() => saved)).toBe(1);
        });

        test('a saved critter stops moving', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            await page.evaluate(() => {
                exitRect = { x: 14, y: 29, w: 2, h: 2 };
            });
            const i = await place(page, { x: 10, y: 30, dir: 1 });
            await step(page, 4);
            const at = (await critter(page, i)).x;
            await step(page, 5);
            expect((await critter(page, i)).x).toBe(at);
            expect(await page.evaluate(() => saved)).toBe(1);
        });

        test('the HUD shows the quota and the saved tally', async ({ page }) => {
            await page.evaluate(() => {
                saved = 3;
                draw();
            });
            await expect(page.locator('#saved')).toHaveText('3');
            const required = await page.evaluate(() => requiredCritters);
            await expect(page.locator('#required')).toHaveText(String(required));
        });
    });

    // -----------------------------------------------------------------------
    // Blocker
    // -----------------------------------------------------------------------
    test.describe('blocker', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
        });

        test('assigning an ability spends one from the inventory', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30 });
            const before = await page.evaluate(() => inventory.blocker);
            const ok = await page.evaluate((n) => assignAbility(critters[n], 'blocker'), i);
            expect(ok).toBe(true);
            expect((await critter(page, i)).ability).toBe('blocker');
            expect(await page.evaluate(() => inventory.blocker)).toBe(before - 1);
        });

        test('a blocker stands still', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30, ability: 'blocker' });
            await step(page, 5);
            const c = await critter(page, i);
            expect(c.x).toBe(10);
            expect(c.y).toBe(30);
        });

        test('a blocker assigned in mid-air falls to the ground first', async ({ page }) => {
            const i = await place(page, { x: 10, y: 20, ability: 'blocker' });
            await step(page, 10);
            const c = await critter(page, i);
            expect(c.y).toBe(30);
            expect(c.ability).toBe('blocker');
        });

        test('a blocker drowns like anyone else', async ({ page }) => {
            await fill(page, [{ x: 8, y: 29, w: 6, h: 3, cell: 3 }]);
            const i = await place(page, { x: 10, y: 20, ability: 'blocker' });
            await step(page, 10);
            expect((await critter(page, i)).alive).toBe(false);
        });

        test('a walker turns around at a blocker', async ({ page }) => {
            await place(page, { x: 14, y: 30, ability: 'blocker' });
            const i = await place(page, { x: 12, y: 30, dir: 1 });
            await step(page, 1);
            expect((await critter(page, i)).x).toBe(13);
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.x).toBe(13);
            expect(c.dir).toBe(-1);
        });

        test('a blocker cannot be given another ability', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30, ability: 'blocker' });
            const ok = await page.evaluate((n) => assignAbility(critters[n], 'digger'), i);
            expect(ok).toBe(false);
            expect((await critter(page, i)).ability).toBe('blocker');
        });

        test('an ability cannot be assigned with an empty inventory', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30 });
            await page.evaluate(() => {
                inventory.digger = 0;
            });
            const ok = await page.evaluate((n) => assignAbility(critters[n], 'digger'), i);
            expect(ok).toBe(false);
            expect((await critter(page, i)).ability).toBe('walker');
        });

        test('a dead critter cannot be given an ability', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30 });
            await page.evaluate((n) => {
                critters[n].alive = false;
            }, i);
            const before = await page.evaluate(() => inventory.digger);
            const ok = await page.evaluate((n) => assignAbility(critters[n], 'digger'), i);
            expect(ok).toBe(false);
            expect(await page.evaluate(() => inventory.digger)).toBe(before);
        });

        test('a saved critter cannot be given an ability', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30 });
            await page.evaluate((n) => {
                critters[n].saved = true;
            }, i);
            const ok = await page.evaluate((n) => assignAbility(critters[n], 'digger'), i);
            expect(ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Digger
    // -----------------------------------------------------------------------
    test.describe('digger', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
        });

        test('a digger sinks one cell per tick', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 20, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 3);
            const c = await critter(page, i);
            expect(c.y).toBe(33);
            expect(c.ability).toBe('digger');
        });

        test('a digger clears a three-wide shaft', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 20, cell: 1 }]);
            await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 2);
            expect(await cell(page, 9, 31)).toBe(0);
            expect(await cell(page, 10, 31)).toBe(0);
            expect(await cell(page, 11, 31)).toBe(0);
            expect(await cell(page, 12, 31)).toBe(1);
            expect(await cell(page, 10, 32)).toBe(0);
        });

        test('steel stops a digger, which goes back to walking', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 0, y: 32, w: 80, h: 2, cell: 2 },
            ]);
            const i = await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 1);
            expect((await critter(page, i)).y).toBe(31);
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.ability).toBe('walker');
            expect(c.y).toBe(31);
        });

        test('a digger chews through bricks', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 4, cell: 4 }]);
            const i = await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 2);
            expect(await cell(page, 10, 31)).toBe(0);
            expect((await critter(page, i)).y).toBe(32);
        });

        test('a digger that drops into open air stops digging where it lands', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 0, y: 40, w: 80, h: 6, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 6);
            const c = await critter(page, i);
            expect(c.y).toBe(39);
            expect(c.ability).toBe('walker');
            expect(await cell(page, 10, 41)).toBe(1);
        });

        test('a digger that breaks into open air falls', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, ability: 'digger' });
            await step(page, 2);
            expect((await critter(page, i)).y).toBeGreaterThan(31);
        });
    });

    // -----------------------------------------------------------------------
    // Basher
    // -----------------------------------------------------------------------
    test.describe('basher', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
        });

        test('a basher tunnels forward one cell per tick', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 20, w: 8, h: 11, cell: 1 },
            ]);
            const i = await place(page, { x: 11, y: 30, ability: 'basher', dir: 1 });
            await step(page, 3);
            const c = await critter(page, i);
            expect(c.x).toBe(14);
            expect(c.y).toBe(30);
            expect(c.ability).toBe('basher');
        });

        test('a basher clears a four-cell-tall swath', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 20, w: 8, h: 11, cell: 1 },
            ]);
            await place(page, { x: 11, y: 30, ability: 'basher', dir: 1 });
            await step(page, 1);
            for (let y = 27; y <= 30; y++) {
                expect(await cell(page, 12, y)).toBe(0);
            }
            expect(await cell(page, 12, 26)).toBe(1);
            expect(await cell(page, 12, 31)).toBe(1);
        });

        test('a basher with nothing to chew goes back to walking', async ({ page }) => {
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, ability: 'basher', dir: 1 });
            await step(page, 1);
            expect((await critter(page, i)).ability).toBe('walker');
        });

        test('steel stops a basher, which goes back to walking', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 12, y: 20, w: 2, h: 11, cell: 2 },
            ]);
            const i = await place(page, { x: 11, y: 30, ability: 'basher', dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.ability).toBe('walker');
            expect(c.x).toBe(11);
            expect(await cell(page, 12, 30)).toBe(2);
        });

        test('a basher that drops off a ledge goes back to walking', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 11, h: 1, cell: 1 },
                { x: 0, y: 36, w: 80, h: 4, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, ability: 'basher', dir: 1 });
            await step(page, 6);
            const c = await critter(page, i);
            expect(c.y).toBe(35);
            expect(c.ability).toBe('walker');
        });

        test('a basher tunnels left too', async ({ page }) => {
            await fill(page, [
                { x: 0, y: 31, w: 80, h: 1, cell: 1 },
                { x: 0, y: 20, w: 10, h: 11, cell: 1 },
            ]);
            const i = await place(page, { x: 10, y: 30, ability: 'basher', dir: -1 });
            await step(page, 2);
            const c = await critter(page, i);
            expect(c.x).toBe(8);
            expect(await cell(page, 9, 29)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Builder
    // -----------------------------------------------------------------------
    test.describe('builder', () => {
        test.beforeEach(async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
        });

        test('a builder lays a brick and steps up onto it', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30, ability: 'builder', dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(await cell(page, 11, 30)).toBe(4);
            expect(c.x).toBe(11);
            expect(c.y).toBe(29);
        });

        test('each brick is spent from the builder budget', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30, ability: 'builder', dir: 1 });
            const start = (await critter(page, i)).bricks;
            await step(page, 3);
            expect((await critter(page, i)).bricks).toBe(start - 3);
        });

        test('a builder starts with twelve bricks', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30 });
            await page.evaluate((n) => assignAbility(critters[n], 'builder'), i);
            expect((await critter(page, i)).bricks).toBe(12);
        });

        test('a staircase of bricks is solid ground', async ({ page }) => {
            await place(page, { x: 10, y: 30, ability: 'builder', dir: 1 });
            await step(page, 4);
            expect(await page.evaluate(() => isSolid(13, 28))).toBe(true);
        });

        test('a builder out of bricks goes back to walking', async ({ page }) => {
            const i = await place(page, { x: 10, y: 30, ability: 'builder', dir: 1, bricks: 1 });
            await step(page, 1);
            expect((await critter(page, i)).bricks).toBe(0);
            await step(page, 1);
            expect((await critter(page, i)).ability).toBe('walker');
        });

        test('a ceiling turns a blocked builder around', async ({ page }) => {
            await fill(page, [{ x: 11, y: 27, w: 2, h: 2, cell: 1 }]);
            const i = await place(page, { x: 10, y: 30, ability: 'builder', dir: 1 });
            await step(page, 1);
            const c = await critter(page, i);
            expect(c.dir).toBe(-1);
            expect(c.ability).toBe('walker');
            expect(c.x).toBe(10);
        });
    });

    // -----------------------------------------------------------------------
    // Input
    // -----------------------------------------------------------------------
    test.describe('input', () => {
        test('number keys select an ability', async ({ page }) => {
            await page.keyboard.press('Space');
            const keys = { 1: 'blocker', 2: 'digger', 3: 'basher', 4: 'builder', 5: 'floater' };
            for (const [key, name] of Object.entries(keys)) {
                await page.keyboard.press(`Digit${key}`);
                expect(await page.evaluate(() => selectedAbility)).toBe(name);
            }
        });

        test('clicking an ability button selects it', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.locator('#btn-builder').click();
            expect(await page.evaluate(() => selectedAbility)).toBe('builder');
            await expect(page.locator('#btn-builder')).toHaveClass(/selected/);
            await expect(page.locator('#btn-blocker')).not.toHaveClass(/selected/);
        });

        test('the ability buttons show their remaining stock', async ({ page }) => {
            await page.keyboard.press('Space');
            const stock = await page.evaluate(() => inventory.digger);
            await expect(page.locator('#count-digger')).toHaveText(String(stock));
        });

        test('clicking a critter gives it the selected ability', async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 20, y: 30 });
            await page.evaluate(() => {
                selectedAbility = 'digger';
            });
            const before = await page.evaluate(() => inventory.digger);
            await page.locator('#canvas').click({ position: { x: 20 * 8 + 4, y: 30 * 8 + 4 } });
            expect((await critter(page, i)).ability).toBe('digger');
            expect(await page.evaluate(() => inventory.digger)).toBe(before - 1);
        });

        test('clicking empty cave spends nothing', async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            await place(page, { x: 20, y: 30 });
            const before = await page.evaluate(() => inventory.blocker);
            await page.locator('#canvas').click({ position: { x: 4, y: 4 } });
            expect(await page.evaluate(() => inventory.blocker)).toBe(before);
        });

        test('the HUD stock drops after an assignment', async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            await place(page, { x: 20, y: 30 });
            const before = await page.evaluate(() => inventory.blocker);
            await page.locator('#canvas').click({ position: { x: 20 * 8 + 4, y: 30 * 8 + 4 } });
            await expect(page.locator('#count-blocker')).toHaveText(String(before - 1));
        });

        test('clicking does nothing while paused', async ({ page }) => {
            await sandbox(page);
            await fill(page, [{ x: 0, y: 31, w: 80, h: 1, cell: 1 }]);
            const i = await place(page, { x: 20, y: 30 });
            await page.keyboard.press('KeyP');
            // force past the pause overlay, which deliberately covers the cave
            await page
                .locator('#canvas')
                .click({ position: { x: 20 * 8 + 4, y: 30 * 8 + 4 }, force: true });
            expect((await critter(page, i)).ability).toBe('walker');
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay says the game is paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('P does nothing before the game starts', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Level flow
    // -----------------------------------------------------------------------
    test.describe('level flow', () => {
        test('the clock ticks down while running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                autoResolve = false;
            });
            const before = await page.evaluate(() => ticksLeft);
            await step(page, 10);
            expect(await page.evaluate(() => ticksLeft)).toBe(before - 10);
        });

        test('the HUD shows the remaining time in seconds', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                ticksLeft = 40;
                draw();
            });
            await expect(page.locator('#time')).toHaveText('2');
        });

        test('meeting the quota completes the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = requiredCritters;
                simStep();
            });
            expect(await page.evaluate(() => state)).toBe('levelcomplete');
        });

        test('missing the quota fails the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = 0;
                simStep();
            });
            expect(await page.evaluate(() => state)).toBe('lost');
        });

        test('running out of time resolves the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                ticksLeft = 1;
                saved = 0;
                simStep();
            });
            expect(await page.evaluate(() => state)).toBe('lost');
        });

        test('Space moves on to the next level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = requiredCritters;
                simStep();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => critters.length)).toBe(0);
        });

        test('a new level restocks the inventory and resets the tally', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                inventory.blocker = 0;
                loadLevel(2);
                return { blocker: inventory.blocker, saved, spawned, level };
            });
            expect(out.blocker).toBeGreaterThan(0);
            expect(out.saved).toBe(0);
            expect(out.spawned).toBe(0);
            expect(out.level).toBe(2);
        });

        test('clearing the last level wins the game', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                loadLevel(LEVELS.length);
                critters.length = 0;
                spawned = totalCritters;
                saved = requiredCritters;
                simStep();
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/win|won|rescue/i);
        });

        test('R restarts the level with a fresh inventory', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                const stock = inventory.blocker;
                inventory.blocker = 0;
                saved = 4;
                spawned = 3;
                critters.push({});
                restartLevel();
                return { stock, blocker: inventory.blocker, saved, spawned, n: critters.length, state };
            });
            expect(out.blocker).toBe(out.stock);
            expect(out.saved).toBe(0);
            expect(out.spawned).toBe(0);
            expect(out.n).toBe(0);
            expect(out.state).toBe('running');
        });

        test('the R key restarts the level', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                autoResolve = false;
                saved = 2;
            });
            await page.keyboard.press('KeyR');
            expect(await page.evaluate(() => saved)).toBe(0);
        });

        test('score counts every critter saved across levels', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = requiredCritters;
                simStep();
                return score;
            });
            const required = await page.evaluate(() => LEVELS[0].required);
            expect(score).toBe(required);
        });

        test('the best run is written to localStorage', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                loadLevel(LEVELS.length);
                critters.length = 0;
                spawned = totalCritters;
                saved = requiredCritters;
                score = 99;
                simStep();
                return { score, best: window.localStorage.getItem('burrowbrigade-best') };
            });
            expect(out.score).toBeGreaterThan(99);
            expect(out.best).toBe(String(out.score));
        });

        test('a losing run still records its best', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = 0;
                score = 5;
                simStep();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('burrowbrigade-best'))).toBe('5');
        });

        test('a result overlay reports the tally', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                critters.length = 0;
                spawned = totalCritters;
                saved = 0;
                simStep();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText(/\d/);
        });

        test('Space after a loss restarts from level one', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoRun = false;
                loadLevel(2);
                critters.length = 0;
                spawned = totalCritters;
                saved = 0;
                simStep();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => score)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // A full level, played by the engine itself
    // -----------------------------------------------------------------------
    test.describe('end to end', () => {
        test('critters walk out of the hatch and into the exit unaided', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 4000 && state === 'running'; i++) simStep();
                return { state, saved, level };
            });
            expect(out.saved).toBeGreaterThan(0);
            expect(out.state).not.toBe('running');
        });

        test('level one is winnable with no abilities spent at all', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                for (let i = 0; i < 4000 && state === 'running'; i++) simStep();
                return { state, saved, required: LEVELS[0].required };
            });
            expect(out.saved).toBeGreaterThanOrEqual(out.required);
            expect(out.state).toBe('levelcomplete');
        });

        test('level two is solved by bridging the chasm and bashing the pillar', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                loadLevel(2);
                for (let i = 0; i < 4000 && state === 'running'; i++) {
                    // bridge the water with the first critter to reach the brink
                    for (const c of critters) {
                        if (!c.alive || c.saved) continue;
                        if (c.ability === 'walker' && c.dir === 1 && c.x >= 21 && c.x <= 23 && c.y === 39) {
                            assignAbility(c, 'builder');
                        }
                        // chew through the pillar that pens the crowd in
                        if (c.ability === 'walker' && c.dir === 1 && c.x === 39 && c.y === 39) {
                            assignAbility(c, 'basher');
                        }
                    }
                    simStep();
                }
                return { state, saved, required: requiredCritters };
            });
            expect(out.saved).toBeGreaterThanOrEqual(out.required);
            expect(out.state).toBe('levelcomplete');
        });

        test('level three is solved by digging a shaft and blocking the drop zone', async ({ page }) => {
            const out = await page.evaluate(() => {
                startGame();
                autoRun = false;
                loadLevel(3);
                for (let i = 0; i < 4000 && state === 'running'; i++) {
                    for (const c of critters) {
                        if (!c.alive || c.saved) continue;
                        // sink a shaft to the lower chamber, clear of the steel plate
                        if (c.ability === 'walker' && c.x === 52 && c.y === 29) {
                            assignAbility(c, 'digger');
                        }
                        // stop the crowd wandering left into the pool
                        if (c.ability === 'walker' && c.dir === -1 && c.y === 43 && c.x >= 46 && c.x <= 48) {
                            assignAbility(c, 'blocker');
                        }
                    }
                    simStep();
                }
                return { state, saved, required: requiredCritters };
            });
            expect(out.saved).toBeGreaterThanOrEqual(out.required);
            expect(out.state).toBe('won');
        });

        test('the animation loop runs the simulation on its own', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#out')).not.toHaveText('0', { timeout: 5000 });
            expect(await page.evaluate(() => critters.length)).toBeGreaterThan(0);
        });

        test('no console errors during play', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(GAME_URL);
            await page.keyboard.press('Space');
            await page.waitForTimeout(1500);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyR');
            expect(errors).toEqual([]);
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
            const entry = games.find((g) => g.id === 'burrow-brigade');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Burrow Brigade');
            expect(entry.dir).toBe('BurrowBrigade');
            expect(entry.path).toBe('games/BurrowBrigade/index.html');
            expect(entry.thumbnail).toBe('games/BurrowBrigade/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );
            const i = games.findIndex((g) => g.id === 'burrow-brigade');
            expect(i).toBeGreaterThan(0);
            expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
            if (i + 1 < games.length) {
                expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
            }
        });

        test('the thumbnail the browser points at exists', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'BurrowBrigade/screenshot.png'))).toBe(true);
        });

        test('the root README lists the game', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(
                /\|\s*Burrow Brigade\s*\|\s*\[BurrowBrigade\/\]\(BurrowBrigade\/\)\s*\|\s*(Complete|In Progress)\s*\|/
            );
        });

        test('the game ships its own README and DESIGN docs', () => {
            expect(fs.existsSync(path.join(REPO_ROOT, 'BurrowBrigade/README.md'))).toBe(true);
            expect(fs.existsSync(path.join(REPO_ROOT, 'BurrowBrigade/DESIGN.md'))).toBe(true);
        });

        test('the DESIGN doc records the assumptions that were made', () => {
            const design = fs.readFileSync(path.join(REPO_ROOT, 'BurrowBrigade/DESIGN.md'), 'utf8');
            expect(design).toMatch(/## Assumptions/);
            expect(design).toMatch(/## Mechanics/);
            expect(design).toMatch(/## Controls/);
        });
    });
});
