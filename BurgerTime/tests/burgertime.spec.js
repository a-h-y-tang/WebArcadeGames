const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

/** Start the game with the animation loop detached so ticks are deterministic. */
async function startDeterministic(page, { enemies = true } = {}) {
    await page.evaluate((keepEnemies) => {
        autoTick = false;
        startGame();
        if (!keepEnemies) enemies.length = 0;
    }, enemies);
}

test.describe('Burger Time', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Burger Time', async ({ page }) => {
            await expect(page).toHaveTitle('Burger Time');
        });

        test('canvas is 640x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD starts at score 0, level 1, 3 lives, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level geometry
    // -----------------------------------------------------------------------
    test.describe('level layout', () => {
        test('grid constants describe a 16x13 board of 40px tiles', async ({ page }) => {
            const g = await page.evaluate(() => ({ TILE, COLS, ROWS, CANVAS_W, CANVAS_H }));
            expect(g).toEqual({ TILE: 40, COLS: 16, ROWS: 13, CANVAS_W: 640, CANVAS_H: 520 });
        });

        test('there are four floors and four ladder columns', async ({ page }) => {
            const g = await page.evaluate(() => ({ FLOOR_ROWS, LADDER_COLS, LANE_COLS }));
            expect(g.FLOOR_ROWS).toEqual([1, 4, 7, 10]);
            expect(g.LADDER_COLS).toEqual([0, 5, 10, 15]);
            expect(g.LANE_COLS).toEqual([1, 6, 11]);
        });

        test('level 1 builds three burgers of four layers', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    lanes: [0, 1, 2].map((l) => ingredients.filter((i) => i.lane === l).length),
                    types: ingredients.filter((i) => i.lane === 0).map((i) => i.type),
                };
            });
            expect(info.total).toBe(12);
            expect(info.lanes).toEqual([4, 4, 4]);
            expect(info.types).toEqual(['bunBottom', 'patty', 'lettuce', 'bunTop']);
        });

        test('level 1 puts one ingredient on every floor of every lane', async ({ page }) => {
            const floors = await page.evaluate(() => {
                startGame();
                return ingredients.filter((i) => i.lane === 0).map((i) => i.floor);
            });
            expect(floors.slice().sort((a, b) => a - b)).toEqual([1, 4, 7, 10]);
        });

        test('resting ingredients sit one layer above their floor line', async ({ page }) => {
            const rows = await page.evaluate(() => {
                startGame();
                return ingredients.map((i) => ({ y: i.y, floor: i.floor }));
            });
            for (const r of rows) expect(r.y).toBe(r.floor * 40 - 10);
        });

        test('each ingredient spans its lane and starts unstepped', async ({ page }) => {
            const info = await page.evaluate(() => {
                startGame();
                const i = ingredients[0];
                return { x: i.x, segs: i.segments, state: i.state };
            });
            expect(info.x).toBe(40);
            expect(info.segs).toEqual([false, false, false, false]);
            expect(info.state).toBe('rest');
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Space starts the game from idle', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the chef starts on the bottom floor', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { x: chef.x, y: chef.y };
            });
            expect(c.y).toBe(400);
            expect(c.x).toBe(320);
        });

        test('level 1 spawns three enemies', async ({ page }) => {
            expect(await page.evaluate(() => {
                startGame();
                return enemies.length;
            })).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walks right along a floor', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const x = await page.evaluate(() => {
                chef.want = 'right';
                tickN(10);
                return chef.x;
            });
            expect(x).toBe(340);
        });

        test('walks left along a floor', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const x = await page.evaluate(() => {
                chef.want = 'left';
                tickN(10);
                return chef.x;
            });
            expect(x).toBe(300);
        });

        test('stops at the left and right walls', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const res = await page.evaluate(() => {
                chef.want = 'left';
                tickN(400);
                const left = chef.x;
                chef.want = 'right';
                tickN(400);
                return { left, right: chef.x };
            });
            expect(res.left).toBe(20);
            expect(res.right).toBe(620);
        });

        test('cannot climb when not on a ladder', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const y = await page.evaluate(() => {
                chef.x = 320; // between ladders
                chef.want = 'up';
                tickN(20);
                return chef.y;
            });
            expect(y).toBe(400);
        });

        test('climbs up a ladder to the floor above', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const y = await page.evaluate(() => {
                chef.x = 420; // ladder column 10
                chef.want = 'up';
                tickN(60); // 120px at 2px/tick
                return chef.y;
            });
            expect(y).toBe(280);
        });

        test('cannot climb above the top floor', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const y = await page.evaluate(() => {
                chef.x = 420;
                chef.want = 'up';
                tickN(400);
                return chef.y;
            });
            expect(y).toBe(40);
        });

        test('cannot descend below the bottom floor', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const y = await page.evaluate(() => {
                chef.x = 420;
                chef.want = 'down';
                tickN(200);
                return chef.y;
            });
            expect(y).toBe(400);
        });

        test('cannot walk sideways halfway up a ladder', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const res = await page.evaluate(() => {
                chef.x = 420;
                chef.want = 'up';
                tickN(30); // halfway between floors
                const midY = chef.y;
                chef.want = 'right';
                tickN(20);
                return { midY, x: chef.x };
            });
            expect(res.midY).toBe(340);
            expect(res.x).toBe(420);
        });

        test('arrow keys steer the chef', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            await page.keyboard.press('ArrowLeft');
            const dir = await page.evaluate(() => {
                tickN(5);
                return { want: chef.want, x: chef.x };
            });
            expect(dir.want).toBe('left');
            expect(dir.x).toBe(310);
        });

        test('WASD keys steer the chef', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            await page.keyboard.press('KeyD');
            expect(await page.evaluate(() => chef.want)).toBe('right');
        });

        test('facing follows horizontal movement', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const f = await page.evaluate(() => {
                chef.want = 'left';
                tickN(5);
                const a = chef.facing;
                chef.want = 'right';
                tickN(5);
                return [a, chef.facing];
            });
            expect(f).toEqual([-1, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping ingredients', () => {
        test('walking over a segment marks it as stepped', async ({ page }) => {
            const segs = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                chef.x = 60; // first segment of lane 0 on the bottom floor
                tickN(1);
                return topRestingAt(0, 10).segments;
            });
            expect(segs).toEqual([true, false, false, false]);
        });

        test('walking the whole ingredient drops it', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                chef.x = 20;
                chef.y = 400;
                chef.want = 'right';
                tickN(95); // walk from x=20 across the whole 160px ingredient
                const ing = ingredients.find((i) => i.lane === 0 && i.type === 'bunBottom');
                return { state: ing.state, target: ing.target };
            });
            expect(res.state).not.toBe('rest');
            expect(res.target).toBe(12); // the plate row
        });

        test('only the top of a stack can be stepped', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                // Stack a second ingredient on the bottom floor of lane 0.
                const lower = ingredients.find((i) => i.lane === 0 && i.floor === 10);
                ingredients.push({
                    lane: 0, layer: 2, type: 'lettuce', floor: 10, x: laneX(0), y: lower.y - 10,
                    state: 'rest', target: 10, segments: [false, false, false, false], kills: 0,
                });
                chef.x = 60;
                tickN(1);
                return {
                    top: topRestingAt(0, 10).type,
                    lowerSegs: lower.segments,
                };
            });
            expect(res.top).toBe('lettuce');
            expect(res.lowerSegs).toEqual([false, false, false, false]);
        });

        test('stepping does not mark ingredients on other floors', async ({ page }) => {
            const segs = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                chef.x = 60;
                tickN(1);
                return ingredients.find((i) => i.lane === 0 && i.floor === 7).segments;
            });
            expect(segs).toEqual([false, false, false, false]);
        });
    });

    // -----------------------------------------------------------------------
    // Falling and cascading
    // -----------------------------------------------------------------------
    test.describe('falling ingredients', () => {
        test('a dropped ingredient lands on the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 10);
                tickN(40);
                const ing = ingredients.find((i) => i.lane === 0 && i.type === 'bunBottom');
                return { state: ing.state, y: ing.y, floor: ing.floor };
            });
            expect(res.state).toBe('plate');
            expect(res.floor).toBe(12);
            expect(res.y).toBe(470);
        });

        test('an ingredient dropped onto an empty floor rests there', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                // Clear the floor below so nothing cascades.
                ingredients = ingredients.filter((i) => !(i.lane === 0 && i.floor === 7));
                dropStack(0, 4);
                tickN(60);
                const ing = ingredients.find((i) => i.lane === 0 && i.type === 'lettuce');
                return { state: ing.state, floor: ing.floor, y: ing.y };
            });
            expect(res.state).toBe('rest');
            expect(res.floor).toBe(7);
            expect(res.y).toBe(270);
        });

        test('a falling ingredient knocks the one below it down too', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 1); // drop the top bun from the top floor
                tickN(40);
                const lettuce = ingredients.find((i) => i.lane === 0 && i.type === 'lettuce');
                return lettuce.state;
            });
            expect(res).toBe('fall');
        });

        test('dropping the top bun cascades the whole burger onto the plate', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 1);
                tickN(300);
                const lane = ingredients.filter((i) => i.lane === 0);
                return {
                    states: lane.map((i) => i.state),
                    ys: lane.slice().sort((a, b) => b.y - a.y).map((i) => i.y),
                    types: lane.slice().sort((a, b) => b.y - a.y).map((i) => i.type),
                };
            });
            expect(res.states).toEqual(['plate', 'plate', 'plate', 'plate']);
            expect(res.ys).toEqual([470, 460, 450, 440]);
            expect(res.types).toEqual(['bunBottom', 'patty', 'lettuce', 'bunTop']);
        });

        test('ingredients in other lanes are unaffected by a drop', async ({ page }) => {
            const states = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 1);
                tickN(300);
                return ingredients.filter((i) => i.lane === 1).map((i) => i.state);
            });
            expect(states).toEqual(['rest', 'rest', 'rest', 'rest']);
        });

        test('landing scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 10);
                tickN(40);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('a landed ingredient can be stepped again', async ({ page }) => {
            const segs = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                ingredients = ingredients.filter((i) => !(i.lane === 0 && i.floor === 7));
                dropStack(0, 4);
                tickN(60);
                const ing = ingredients.find((i) => i.lane === 0 && i.type === 'lettuce');
                ing.segments = [true, true, true, false];
                chef.y = 280;
                chef.x = 180;
                tickN(1);
                return ing.state;
            });
            expect(segs).toBe('fall');
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies move when the game ticks', async ({ page }) => {
            const moved = await page.evaluate(() => {
                autoTick = false;
                startGame();
                const before = enemies.map((e) => e.x + ',' + e.y);
                tickN(60);
                const after = enemies.map((e) => e.x + ',' + e.y);
                return before.some((p, i) => p !== after[i]);
            });
            expect(moved).toBe(true);
        });

        test('enemies stay on the grid', async ({ page }) => {
            const ok = await page.evaluate(() => {
                autoTick = false;
                startGame();
                tickN(400);
                return enemies.every((e) => e.x >= 20 && e.x <= 620 && e.y >= 40 && e.y <= 400);
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                enemies[0].stun = 0;
                enemies[0].dead = false;
                chef.invuln = 0;
                tickN(1);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('losing a life resets the chef to the start position', async ({ page }) => {
            const c = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                chef.x = 120;
                chef.y = 160;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                enemies[0].stun = 0;
                enemies[0].dead = false;
                chef.invuln = 0;
                tickN(1);
                return { x: chef.x, y: chef.y };
            });
            expect(c).toEqual({ x: 320, y: 400 });
        });

        test('the chef is briefly invulnerable after losing a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                enemies[0].stun = 0;
                enemies[0].dead = false;
                chef.invuln = 0;
                tickN(1);
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                tickN(1);
                return lives;
            });
            expect(lives).toBe(2);
        });

        test('a falling ingredient squashes an enemy', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                const e = enemies[0];
                e.dead = false;
                e.stun = 0;
                e.x = 120;      // inside lane 0
                e.y = 400;      // standing on the bottom floor
                const before = score;
                dropStack(0, 7); // patty falls through lane 0 onto the enemy
                tickN(60);
                return { dead: e.dead, gained: score - before };
            });
            expect(res.dead).toBe(true);
            expect(res.gained).toBeGreaterThanOrEqual(200);
        });

        test('a squashed enemy comes back later', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                const e = enemies[0];
                e.dead = true;
                e.respawn = 3;
                tickN(5);
                return e.dead;
            });
            expect(res).toBe(false);
        });

        test('a dead enemy cannot hurt the chef', async ({ page }) => {
            const lives = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                enemies[0].dead = true;
                enemies[0].respawn = 999;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                chef.invuln = 0;
                tickN(1);
                return lives;
            });
            expect(lives).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('Space sprays pepper and spends a shake', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            await page.keyboard.press('Space');
            const res = await page.evaluate(() => ({ pepper: pepper, sprays: sprays.length }));
            expect(res.pepper).toBe(4);
            expect(res.sprays).toBe(1);
            await expect(page.locator('#pepper')).toHaveText('4');
        });

        test('pepper stuns an enemy it touches', async ({ page }) => {
            const stun = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                const e = enemies[0];
                e.dead = false;
                e.stun = 0;
                e.x = chef.x + 40;
                e.y = chef.y;
                chef.facing = 1;
                sprayPepper();
                tickN(1);
                return e.stun;
            });
            expect(stun).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move or hurt the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 1;
                const e = enemies[0];
                e.dead = false;
                e.stun = 100;
                e.x = chef.x;
                e.y = chef.y;
                chef.invuln = 0;
                const before = e.x;
                tickN(5);
                return { lives: lives, moved: e.x !== before };
            });
            expect(res.lives).toBe(3);
            expect(res.moved).toBe(false);
        });

        test('pepper runs out', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                for (let i = 0; i < 8; i++) sprayPepper();
                return { pepper: pepper, sprays: sprays.length };
            });
            expect(res.pepper).toBe(0);
            expect(res.sprays).toBe(5);
        });

        test('a pepper cloud fades away', async ({ page }) => {
            const left = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                sprayPepper();
                tickN(60);
                return sprays.length;
            });
            expect(left).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level completion and game over
    // -----------------------------------------------------------------------
    test.describe('progression', () => {
        test('plating every ingredient clears the level', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                for (const lane of [0, 1, 2]) dropStack(lane, 1);
                tickN(400);
                return { state, score: score };
            });
            expect(res.state).toBe('levelclear');
            expect(res.score).toBeGreaterThanOrEqual(1000);
        });

        test('the level-clear overlay offers the next level', async ({ page }) => {
            await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                for (const lane of [0, 1, 2]) dropStack(lane, 1);
                tickN(400);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/level/i);
        });

        test('starting the next level rebuilds the burgers', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                for (const lane of [0, 1, 2]) dropStack(lane, 1);
                tickN(400);
                nextLevel();
                return {
                    level: level,
                    state,
                    resting: ingredients.filter((i) => i.state === 'rest').length,
                    enemies: enemies.length,
                };
            });
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.resting).toBe(12);
            expect(res.enemies).toBe(4);
        });

        test('level 2 uses a different burger layout', async ({ page }) => {
            const same = await page.evaluate(() => {
                const shape = () => ingredients.map((i) => i.lane + ':' + i.layer + ':' + i.floor).join('|');
                startGame();
                const one = shape();
                level = 2;
                buildLevel();
                return one === shape();
            });
            expect(same).toBe(false);
        });

        test('running out of lives ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                lives = 1;
                enemies.length = 1;
                enemies[0].dead = false;
                enemies[0].stun = 0;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                chef.invuln = 0;
                tickN(1);
                return { state, lives: lives };
            });
            expect(res.state).toBe('gameover');
            expect(res.lives).toBe(0);
        });

        test('game over shows an overlay and saves the best score', async ({ page }) => {
            await page.evaluate(() => {
                autoTick = false;
                startGame();
                score = 7500;
                lives = 1;
                enemies.length = 1;
                enemies[0].dead = false;
                enemies[0].stun = 0;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                chef.invuln = 0;
                tickN(1);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#best')).toHaveText('7500');
            expect(await page.evaluate(() => window.localStorage.getItem('burgertime-best'))).toBe('7500');
        });

        test('a new game resets score, lives and level', async ({ page }) => {
            const res = await page.evaluate(() => {
                autoTick = false;
                startGame();
                score = 900;
                lives = 1;
                level = 3;
                startGame();
                return { score: score, lives: lives, level: level, pepper: pepper };
            });
            expect(res).toEqual({ score: 0, lives: 3, level: 1, pepper: 5 });
        });
    });

    // -----------------------------------------------------------------------
    // Pause + HUD
    // -----------------------------------------------------------------------
    test.describe('pause and HUD', () => {
        test('P pauses and resumes', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not tick', async ({ page }) => {
            await startDeterministic(page, { enemies: false });
            const res = await page.evaluate(() => {
                chef.want = 'right';
                togglePause();
                const before = chef.x;
                tickN(20);
                return before === chef.x;
            });
            expect(res).toBe(true);
        });

        test('the HUD tracks score and lives', async ({ page }) => {
            await page.evaluate(() => {
                autoTick = false;
                startGame();
                enemies.length = 0;
                dropStack(0, 10);
                tickN(40);
            });
            await expect(page.locator('#score')).not.toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
        });

        test('the help panel documents the controls', async ({ page }) => {
            const help = page.locator('.help');
            await expect(help).toContainText(/pepper/i);
            await expect(help).toContainText(/pause/i);
        });
    });

    // -----------------------------------------------------------------------
    // Repo integration
    // -----------------------------------------------------------------------
    test.describe('repo integration', () => {
        test('the game browser lists Burger Time', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8'),
            );
            const entry = games.find((g) => g.id === 'burger-time');
            expect(entry).toBeTruthy();
            expect(entry.dir).toBe('BurgerTime');
            expect(entry.path).toBe('games/BurgerTime/index.html');
            expect(entry.name).toBe('Burger Time');
        });

        test('the games list stays sorted by id', () => {
            const games = JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8'),
            );
            const ids = games.map((g) => g.id);
            expect(ids).toEqual(ids.slice().sort());
        });

        test('the root README lists Burger Time as complete', () => {
            const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
            expect(readme).toMatch(/\|\s*Burger Time\s*\|\s*\[BurgerTime\/\]\(BurgerTime\/\)\s*\|\s*Complete\s*\|/);
        });

        test('the game folder ships a README and DESIGN doc', () => {
            expect(fs.existsSync(path.join(__dirname, '../README.md'))).toBe(true);
            expect(fs.existsSync(path.join(__dirname, '../DESIGN.md'))).toBe(true);
        });
    });
});
