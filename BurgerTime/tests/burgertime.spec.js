const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start the game and switch off the real-time loop so that every `step(dt)`
// call the tests make is the only thing advancing the simulation.
async function start(page) {
    await page.evaluate(() => {
        startGame();
        autoLoop = false;
    });
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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('HUD starts at zero score, 3 lives, level 1, full pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('canvas is 640x512', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '512');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies before starting', async ({ page }) => {
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Maze geometry
    // -----------------------------------------------------------------------
    test.describe('maze geometry', () => {
        test('five floors, ordered top to bottom, inside the canvas', async ({ page }) => {
            const floors = await page.evaluate(() => FLOOR_Y.slice());
            expect(floors).toHaveLength(5);
            for (let i = 1; i < floors.length; i++) {
                expect(floors[i]).toBeGreaterThan(floors[i - 1]);
            }
            expect(floors[floors.length - 1]).toBeLessThanOrEqual(await page.evaluate(() => CANVAS_H));
        });

        test('four ladders spread across the canvas', async ({ page }) => {
            const ladders = await page.evaluate(() => LADDER_X.slice());
            expect(ladders).toHaveLength(4);
            for (const x of ladders) {
                expect(x).toBeGreaterThanOrEqual(0);
                expect(x).toBeLessThanOrEqual(await page.evaluate(() => CANVAS_W));
            }
        });

        test('three burger stacks that do not overlap', async ({ page }) => {
            const { stacks, w } = await page.evaluate(() => ({ stacks: STACK_X.slice(), w: STACK_W }));
            expect(stacks).toHaveLength(3);
            expect(stacks[0] + w).toBeLessThanOrEqual(stacks[1]);
            expect(stacks[1] + w).toBeLessThanOrEqual(stacks[2]);
        });

        test('the plate floor is the bottom floor', async ({ page }) => {
            const res = await page.evaluate(() => ({ plate: PLATE_FLOOR, last: FLOOR_Y.length - 1 }));
            expect(res.plate).toBe(res.last);
        });

        test('floorIndexAt only matches exact floor heights', async ({ page }) => {
            const res = await page.evaluate(() => ({
                onFloor: floorIndexAt(FLOOR_Y[2]),
                between: floorIndexAt(FLOOR_Y[2] + 20),
            }));
            expect(res.onFloor).toBe(2);
            expect(res.between).toBe(-1);
        });

        test('nearestLadderX snaps to the closest ladder', async ({ page }) => {
            const res = await page.evaluate(() => ({
                near: nearestLadderX(LADDER_X[1] + 10),
                expected: LADDER_X[1],
            }));
            expect(res.near).toBe(res.expected);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game has full lives, pepper, level 1 and no score', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => ({ score, lives, level, pepper }));
            expect(s).toEqual({ score: 0, lives: 3, level: 1, pepper: 5 });
        });

        test('twelve ingredients are built: four per stack', async ({ page }) => {
            await start(page);
            const counts = await page.evaluate(() => [0, 1, 2].map(
                (s) => ingredients.filter((i) => i.stack === s).length));
            expect(counts).toEqual([4, 4, 4]);
        });

        test('every ingredient starts resting with no segments stamped', async ({ page }) => {
            await start(page);
            const ok = await page.evaluate(() => ingredients.every(
                (i) => i.state === 'rest' && i.pressed.length === SEGMENTS && i.pressed.every((p) => !p)));
            expect(ok).toBe(true);
        });

        test('each stack occupies four distinct floors above the plate', async ({ page }) => {
            await start(page);
            const floorsPerStack = await page.evaluate(() => [0, 1, 2].map(
                (s) => ingredients.filter((i) => i.stack === s).map((i) => i.floor).sort()));
            for (const floors of floorsPerStack) {
                expect(floors).toEqual([0, 1, 2, 3]);
            }
        });

        test('the chef starts on a floor inside the canvas', async ({ page }) => {
            await start(page);
            const ok = await page.evaluate(() => floorIndexAt(chef.y) >= 0
                && chef.x > 0 && chef.x < CANVAS_W);
            expect(ok).toBe(true);
        });

        test('the maze starts empty of enemies and pepper clouds', async ({ page }) => {
            await start(page);
            const s = await page.evaluate(() => ({ e: enemies.length, p: peppers.length }));
            expect(s).toEqual({ e: 0, p: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('holding right walks the chef right', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const x0 = chef.x;
                input.right = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return chef.x - x0;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('holding left walks the chef left and flips his facing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const x0 = chef.x;
                input.left = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { dx: chef.x - x0, facing: chef.facing };
            });
            expect(res.dx).toBeLessThan(0);
            expect(res.facing).toBe(-1);
        });

        test('walking does not change the chef height', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const y0 = chef.y;
                input.right = true;
                for (let i = 0; i < 40; i++) step(0.016);
                return { y0, y: chef.y };
            });
            expect(res.y).toBe(res.y0);
        });

        test('the chef cannot walk off either edge', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                input.right = true;
                for (let i = 0; i < 600; i++) step(0.016);
                const right = chef.x;
                input.right = false; input.left = true;
                for (let i = 0; i < 900; i++) step(0.016);
                return { right, left: chef.x };
            });
            expect(res.right).toBeLessThanOrEqual(640);
            expect(res.left).toBeGreaterThanOrEqual(0);
        });

        test('pressing up on a ladder climbs', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[1], FLOOR_Y[3]);
                input.up = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { y: chef.y, start: FLOOR_Y[3] };
            });
            expect(res.y).toBeLessThan(res.start);
        });

        test('pressing down on a ladder descends', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[2], FLOOR_Y[1]);
                input.down = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { y: chef.y, start: FLOOR_Y[1] };
            });
            expect(res.y).toBeGreaterThan(res.start);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[1] + 4, FLOOR_Y[3]);
                input.up = true;
                for (let i = 0; i < 10; i++) step(0.016);
                return chef.x;
            });
            expect(x).toBe(await page.evaluate(() => LADDER_X[1]));
        });

        test('pressing up away from a ladder does nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(STACK_X[0] + 60, FLOOR_Y[2]);
                input.up = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { y: chef.y, floor: FLOOR_Y[2] };
            });
            expect(res.y).toBe(res.floor);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[0], FLOOR_Y[0]);
                input.up = true;
                for (let i = 0; i < 60; i++) step(0.016);
                return { y: chef.y, top: FLOOR_Y[0] };
            });
            expect(res.y).toBe(res.top);
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[0], FLOOR_Y[FLOOR_Y.length - 1]);
                input.down = true;
                for (let i = 0; i < 60; i++) step(0.016);
                return { y: chef.y, bottom: FLOOR_Y[FLOOR_Y.length - 1] };
            });
            expect(res.y).toBe(res.bottom);
        });

        test('climbing a full ladder span lands on the floor above', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[1], FLOOR_Y[3]);
                input.up = true;
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (chef.y <= FLOOR_Y[2]) break;
                }
                input.up = false;
                step(0.016);
                return { y: chef.y, target: FLOOR_Y[2], floor: floorIndexAt(chef.y) };
            });
            expect(res.y).toBe(res.target);
            expect(res.floor).toBe(2);
        });

        test('the chef cannot walk sideways while between floors', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[1], FLOOR_Y[3] - 40);
                input.right = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { x: chef.x, ladder: LADDER_X[1] };
            });
            expect(res.x).toBe(res.ladder);
        });
    });

    // -----------------------------------------------------------------------
    // Stamping and dropping ingredients
    // -----------------------------------------------------------------------
    test.describe('stamping ingredients', () => {
        test('walking onto a segment stamps it', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                setChefAt(STACK_X[0] + SEG_W * 1.5, FLOOR_Y[0]);
                step(0.016);
                return ing.pressed.slice();
            });
            expect(pressed).toEqual([false, true, false, false]);
        });

        test('an ingredient with some segments stamped does not fall', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 1 && i.floor === 1);
                setChefAt(STACK_X[1] + SEG_W * 0.5, FLOOR_Y[1]);
                step(0.016);
                setChefAt(STACK_X[1] + SEG_W * 1.5, FLOOR_Y[1]);
                step(0.016);
                return { state: ing.state, pressed: ing.pressed.slice() };
            });
            expect(st.state).toBe('rest');
            expect(st.pressed).toEqual([true, true, false, false]);
        });

        test('stamping every segment drops the ingredient and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                for (let s = 0; s < SEGMENTS; s++) {
                    setChefAt(STACK_X[0] + SEG_W * (s + 0.5), FLOOR_Y[0]);
                    step(0.016);
                }
                return { state: ing.state, score };
            });
            expect(res.state).toBe('falling');
            expect(res.score).toBe(50);
        });

        test('walking the whole width of an ingredient drops it', async ({ page }) => {
            const state2 = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 3);
                setChefAt(STACK_X[2] - 8, FLOOR_Y[3]);
                input.right = true;
                for (let i = 0; i < 200 && ing.state === 'rest'; i++) step(0.016);
                return ing.state;
            });
            expect(state2).toBe('falling');
        });

        test('a falling ingredient descends over time', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                dropIngredient(ing);
                const y0 = ing.y;
                step(0.1);
                return { dy: ing.y - y0 };
            });
            expect(res.dy).toBeGreaterThan(0);
        });

        test('a dropped ingredient comes to rest on the next floor down', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                // Clear floor 1 of stack 0 so the drop lands on empty floor 2.
                const below = ingredients.find((i) => i.stack === 0 && i.floor === 1);
                below.floor = 2; below.y = FLOOR_Y[2];
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                dropIngredient(ing);
                for (let i = 0; i < 200 && ing.state === 'falling'; i++) step(0.016);
                return { state: ing.state, floor: ing.floor, y: ing.y, target: FLOOR_Y[1] };
            });
            expect(res.state).toBe('rest');
            expect(res.floor).toBe(1);
            expect(res.y).toBe(res.target);
        });

        test('stamps are cleared when an ingredient lands', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const below = ingredients.find((i) => i.stack === 0 && i.floor === 1);
                below.floor = 2; below.y = FLOOR_Y[2];
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                ing.pressed = [true, true, true, true];
                dropIngredient(ing);
                for (let i = 0; i < 200 && ing.state === 'falling'; i++) step(0.016);
                return ing.pressed.slice();
            });
            expect(pressed).toEqual([false, false, false, false]);
        });

        test('landing on a resting ingredient knocks it loose too', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const top = ingredients.find((i) => i.stack === 1 && i.floor === 0);
                const next = ingredients.find((i) => i.stack === 1 && i.floor === 1);
                dropIngredient(top);
                for (let i = 0; i < 60 && next.state === 'rest'; i++) step(0.016);
                return { next: next.state, top: top.state };
            });
            expect(res.next).toBe('falling');
            expect(res.top).toBe('falling');
        });

        test('a knocked-loose pair settles two floors down as one pile', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const stack = ingredients.filter((i) => i.stack === 1);
                const top = stack.find((i) => i.kind === 'topbun');
                dropIngredient(top);
                for (let i = 0; i < 400 && stack.some((s) => s.state === 'falling'); i++) step(0.016);
                return {
                    states: stack.map((s) => s.state),
                    pile: pileAt(1, 2).map((s) => s.kind),
                    lonely: pileAt(1, 3).map((s) => s.kind),
                };
            });
            // top bun lands on the lettuce, which is pushed onto the patty's floor
            expect(res.states).toEqual(['rest', 'rest', 'rest', 'rest']);
            expect(res.pile).toEqual(['patty', 'lettuce', 'topbun']);
            expect(res.lonely).toEqual(['bottombun']);
        });

        test('the chain stops after one push — one drop cannot clear a column', async ({ page }) => {
            const plated = await page.evaluate(() => {
                startGame(); autoLoop = false;
                dropIngredient(ingredients.find((i) => i.stack === 1 && i.kind === 'topbun'));
                for (let i = 0; i < 600; i++) step(0.016);
                return ingredients.filter((i) => i.state === 'plated').length;
            });
            expect(plated).toBe(0);
        });

        test('stamping a pile drops every ingredient in it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const stack = ingredients.filter((i) => i.stack === 1);
                dropIngredient(stack.find((i) => i.kind === 'topbun'));
                for (let i = 0; i < 400 && stack.some((s) => s.state === 'falling'); i++) step(0.016);
                score = 0;
                // Walk the whole width of the three-high pile now sitting on floor 2.
                setChefAt(STACK_X[1] - 8, FLOOR_Y[2]);
                input.right = true;
                for (let i = 0; i < 200 && pileAt(1, 2).length === 3; i++) step(0.016);
                return { falling: stack.filter((s) => s.state === 'falling').length, score };
            });
            expect(res.falling).toBe(3);
            expect(res.score).toBe(150); // 50 per ingredient in the pile
        });

        test('a pile dropped onto the last layer plates the whole burger in order', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const stack = ingredients.filter((i) => i.stack === 1);
                dropIngredient(stack.find((i) => i.kind === 'topbun'));
                for (let i = 0; i < 400 && stack.some((s) => s.state === 'falling'); i++) step(0.016);
                dropIngredient(pileAt(1, 2)[0]);
                for (let i = 0; i < 600 && !stack.every((s) => s.state === 'plated'); i++) step(0.016);
                return stack.slice().sort((a, b) => a.plateIndex - b.plateIndex).map((s) => s.kind);
            });
            expect(res).toEqual(['bottombun', 'patty', 'lettuce', 'topbun']);
        });

        test('only the top of a pile can be stamped', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const stack = ingredients.filter((i) => i.stack === 1);
                dropIngredient(stack.find((i) => i.kind === 'topbun'));
                for (let i = 0; i < 400 && stack.some((s) => s.state === 'falling'); i++) step(0.016);
                setChefAt(STACK_X[1] + SEG_W * 0.5, FLOOR_Y[2]);
                step(0.016);
                const pile = pileAt(1, 2);
                return {
                    top: pile[pile.length - 1].pressed.slice(),
                    buried: pile[0].pressed.slice(),
                };
            });
            expect(res.top).toEqual([true, false, false, false]);
            expect(res.buried).toEqual([false, false, false, false]);
        });

        test('an ingredient reaching the bottom is plated and scores', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.state !== 'plated'; i++) step(0.016);
                return { state: ing.state, floor: ing.floor, score };
            });
            expect(res.state).toBe('plated');
            expect(res.floor).toBe(await page.evaluate(() => PLATE_FLOOR));
            expect(res.score).toBe(150); // 50 for the drop + 100 for plating
        });

        test('plated ingredients cannot be stamped again', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 2 && i.floor === 3);
                dropIngredient(ing);
                for (let i = 0; i < 300 && ing.state !== 'plated'; i++) step(0.016);
                setChefAt(STACK_X[2] + SEG_W * 0.5, FLOOR_Y[PLATE_FLOOR]);
                step(0.016);
                return ing.pressed.slice();
            });
            expect(pressed).toEqual([false, false, false, false]);
        });

        test('plated ingredients pile up in arrival order', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const stack = ingredients.filter((i) => i.stack === 0);
                const bottom = stack.find((i) => i.kind === 'bottombun');
                const patty = stack.find((i) => i.kind === 'patty');
                dropIngredient(bottom);
                for (let i = 0; i < 300 && bottom.state !== 'plated'; i++) step(0.016);
                // The patty needs two drops: floor 2 -> floor 3, then onto the plate.
                dropIngredient(patty);
                for (let i = 0; i < 300 && patty.state !== 'rest'; i++) step(0.016);
                dropIngredient(patty);
                for (let i = 0; i < 300 && patty.state !== 'plated'; i++) step(0.016);
                return {
                    first: stack.find((i) => i.kind === 'bottombun').plateIndex,
                    second: stack.find((i) => i.kind === 'patty').plateIndex,
                };
            });
            expect(res.first).toBe(0);
            expect(res.second).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Level completion
    // -----------------------------------------------------------------------
    test.describe('level completion', () => {
        test('plating every ingredient advances to the next level', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                plateAll();
                step(0.016);
                return { level, state, plated: ingredients.filter((i) => i.state === 'plated').length };
            });
            expect(res.level).toBe(2);
            expect(res.state).toBe('running');
            expect(res.plated).toBe(0);
        });

        test('completing a level awards the level bonus', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                score = 0;
                plateAll();
                step(0.016);
                return score;
            });
            expect(res).toBe(1000);
        });

        test('a new level rebuilds all twelve ingredients', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                plateAll();
                step(0.016);
                return {
                    count: ingredients.length,
                    resting: ingredients.every((i) => i.state === 'rest'),
                };
            });
            expect(res.count).toBe(12);
            expect(res.resting).toBe(true);
        });

        test('a new level clears enemies and restocks pepper', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                spawnEnemy({ x: LADDER_X[0], y: FLOOR_Y[0] });
                pepper = 1;
                plateAll();
                step(0.016);
                return { enemies: enemies.length, pepper };
            });
            expect(res).toEqual({ enemies: 0, pepper: 5 });
        });

        test('enemies get faster on later levels', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const s1 = enemySpeed();
                level = 3;
                return { s1, s3: enemySpeed() };
            });
            expect(res.s3).toBeGreaterThan(res.s1);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('spawnEnemy places an enemy at the requested spot', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const e = spawnEnemy({ x: LADDER_X[0], y: FLOOR_Y[0] });
                return { count: enemies.length, x: e.x, y: e.y, lx: LADDER_X[0], fy: FLOOR_Y[0] };
            });
            expect(res.count).toBe(1);
            expect(res.x).toBe(res.lx);
            expect(res.y).toBe(res.fy);
        });

        test('an enemy on the chef floor walks toward him', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(80, FLOOR_Y[0]);
                const e = spawnEnemy({ x: 560, y: FLOOR_Y[0] });
                const x0 = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { moved: e.x - x0 };
            });
            expect(res.moved).toBeLessThan(0);
        });

        test('an enemy on another floor heads for a ladder and climbs', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(LADDER_X[0], FLOOR_Y[FLOOR_Y.length - 1]);
                const e = spawnEnemy({ x: LADDER_X[0] + 60, y: FLOOR_Y[0] });
                const y0 = e.y;
                for (let i = 0; i < 300; i++) step(0.016);
                return { dy: e.y - y0 };
            });
            expect(res.dy).toBeGreaterThan(0);
        });

        test('a stunned enemy does not move', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(80, FLOOR_Y[0]);
                const e = spawnEnemy({ x: 560, y: FLOOR_Y[0] });
                e.stun = 2;
                const x0 = e.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { dx: e.x - x0, stun: e.stun };
            });
            expect(res.dx).toBe(0);
            expect(res.stun).toBeLessThan(2);
        });

        test('a stun wears off and the enemy moves again', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(80, FLOOR_Y[0]);
                const e = spawnEnemy({ x: 560, y: FLOOR_Y[0] });
                e.stun = 0.1;
                for (let i = 0; i < 40; i++) step(0.016);
                return { stun: e.stun, moved: e.x < 560 };
            });
            expect(res.stun).toBe(0);
            expect(res.moved).toBe(true);
        });

        test('touching an enemy costs a life and clears the maze', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(320, FLOOR_Y[2]);
                spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                step(0.016);
                return { lives, enemies: enemies.length, state };
            });
            expect(res.lives).toBe(2);
            expect(res.enemies).toBe(0);
            expect(res.state).toBe('running');
        });

        test('a stunned enemy is harmless to touch', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(320, FLOOR_Y[2]);
                const e = spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                e.stun = 2;
                step(0.016);
                return lives;
            });
            expect(lives).toBe(3);
        });

        test('losing a life returns the chef to his start and restocks pepper', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const start = { x: chef.x, y: chef.y };
                pepper = 0;
                setChefAt(320, FLOOR_Y[2]);
                spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                step(0.016);
                return { start, x: chef.x, y: chef.y, pepper };
            });
            expect(res.x).toBe(res.start.x);
            expect(res.y).toBe(res.start.y);
            expect(res.pepper).toBe(5);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                lives = 1;
                setChefAt(320, FLOOR_Y[2]);
                spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                step(0.016);
                return { lives, state };
            });
            expect(res.lives).toBe(0);
            expect(res.state).toBe('over');
        });

        test('enemies appear as the game runs', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame(); autoLoop = false;
                for (let i = 0; i < 600; i++) step(0.016);
                return enemies.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('the number of enemies is capped', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                // Park the chef out of reach on the top floor so nothing catches him.
                for (let i = 0; i < 4000; i++) {
                    setChefAt(chef.x, chef.y);
                    step(0.016);
                }
                return { count: enemies.length, max: maxEnemies() };
            });
            expect(res.count).toBeLessThanOrEqual(res.max);
        });

        test('a falling ingredient squashes an enemy underneath it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                score = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                spawnEnemy({ x: STACK_X[0] + 40, y: FLOOR_Y[1] });
                dropIngredient(ing);
                for (let i = 0; i < 120 && enemies.length > 0; i++) step(0.016);
                return { enemies: enemies.length, score };
            });
            expect(res.enemies).toBe(0);
            expect(res.score).toBeGreaterThanOrEqual(550); // 50 drop + 500 squash
        });

        test('a falling ingredient misses enemies in other stacks', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame(); autoLoop = false;
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                spawnEnemy({ x: STACK_X[2] + 40, y: FLOOR_Y[1] });
                enemies[0].stun = 99;
                dropIngredient(ing);
                for (let i = 0; i < 120; i++) step(0.016);
                return enemies.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying consumes one pepper and makes a cloud', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                sprayPepper();
                return { pepper, clouds: peppers.length };
            });
            expect(res).toEqual({ pepper: 4, clouds: 1 });
        });

        test('the cloud appears in front of the chef', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(320, FLOOR_Y[2]);
                chef.facing = 1;
                sprayPepper();
                const right = peppers[0].x;
                peppers.length = 0;
                chef.facing = -1;
                sprayPepper();
                return { right, left: peppers[0].x, chefX: chef.x };
            });
            expect(res.right).toBeGreaterThan(res.chefX);
            expect(res.left).toBeLessThan(res.chefX);
        });

        test('spraying with no pepper left does nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                pepper = 0;
                const ok = sprayPepper();
                return { ok, clouds: peppers.length, pepper };
            });
            expect(res).toEqual({ ok: false, clouds: 0, pepper: 0 });
        });

        test('a cloud stuns an enemy caught in it', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(300, FLOOR_Y[2]);
                chef.facing = 1;
                const e = spawnEnemy({ x: 330, y: FLOOR_Y[2] });
                sprayPepper();
                step(0.016);
                return { stun: e.stun };
            });
            expect(res.stun).toBeGreaterThan(0);
        });

        test('a cloud does not stun an enemy behind the chef', async ({ page }) => {
            const stun = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(300, FLOOR_Y[0]);
                chef.facing = 1;
                const e = spawnEnemy({ x: 220, y: FLOOR_Y[0] });
                e.stun = 0;
                sprayPepper();
                const before = e.stun;
                step(0.016);
                return { before, after: e.stun };
            });
            expect(stun.after).toBe(0);
        });

        test('clouds expire', async ({ page }) => {
            const clouds = await page.evaluate(() => {
                startGame(); autoLoop = false;
                sprayPepper();
                for (let i = 0; i < 120; i++) step(0.016);
                return peppers.length;
            });
            expect(clouds).toBe(0);
        });

        test('Space sprays while the game is running', async ({ page }) => {
            await start(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => pepper)).toBe(4);
        });

        test('the HUD shows the remaining pepper', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { sprayPepper(); sprayPepper(); });
            await expect(page.locator('#pepper')).toHaveText('3');
        });
    });

    // -----------------------------------------------------------------------
    // Keyboard input
    // -----------------------------------------------------------------------
    test.describe('keyboard', () => {
        test('arrow keys set and clear the input flags', async ({ page }) => {
            await start(page);
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(true);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => input.right)).toBe(false);
        });

        test('WASD works as well as the arrows', async ({ page }) => {
            await start(page);
            await page.keyboard.down('a');
            expect(await page.evaluate(() => input.left)).toBe(true);
            await page.keyboard.up('a');
            await page.keyboard.down('w');
            expect(await page.evaluate(() => input.up)).toBe(true);
            await page.keyboard.up('w');
        });

        test('down arrow and S both set the down flag', async ({ page }) => {
            await start(page);
            await page.keyboard.down('ArrowDown');
            expect(await page.evaluate(() => input.down)).toBe(true);
            await page.keyboard.up('ArrowDown');
            await page.keyboard.down('s');
            expect(await page.evaluate(() => input.down)).toBe(true);
            await page.keyboard.up('s');
        });

        test('held keys are released when the game ends', async ({ page }) => {
            await start(page);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { lives = 1; setChefAt(320, FLOOR_Y[2]); spawnEnemy({ x: 322, y: FLOOR_Y[2] }); step(0.016); });
            expect(await page.evaluate(() => input.right)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Pause, game over and the HUD
    // -----------------------------------------------------------------------
    test.describe('pause and game over', () => {
        test('P pauses and resumes', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay shows while paused', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('the start button resumes from pause', async ({ page }) => {
            await start(page);
            await page.keyboard.press('p');
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoLoop = false; score = 777; lives = 1; setChefAt(320, FLOOR_Y[2]); spawnEnemy({ x: 322, y: FLOOR_Y[2] }); step(0.016); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('777');
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoLoop = false; lives = 1; setChefAt(320, FLOOR_Y[2]); spawnEnemy({ x: 322, y: FLOOR_Y[2] }); step(0.016); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score }));
            expect(s).toEqual({ state: 'running', lives: 3, score: 0 });
        });

        test('stepping while paused changes nothing', async ({ page }) => {
            const res = await page.evaluate(() => {
                startGame(); autoLoop = false;
                setChefAt(320, FLOOR_Y[2]);
                togglePause();
                input.right = true;
                for (let i = 0; i < 20; i++) step(0.016);
                return { x: chef.x };
            });
            expect(res.x).toBe(320);
        });

        test('the best score is saved at game over', async ({ page }) => {
            const best = await page.evaluate(() => {
                startGame(); autoLoop = false;
                score = 1234; lives = 1;
                setChefAt(320, FLOOR_Y[2]);
                spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                step(0.016);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('1234');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '9000'));
            await page.reload();
            const best = await page.evaluate(() => {
                startGame(); autoLoop = false;
                score = 10; lives = 1;
                setChefAt(320, FLOOR_Y[2]);
                spawnEnemy({ x: 322, y: FLOOR_Y[2] });
                step(0.016);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('9000');
        });
    });

    test.describe('HUD', () => {
        test('the score display follows the score', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                const ing = ingredients.find((i) => i.stack === 0 && i.floor === 0);
                dropIngredient(ing);
            });
            await expect(page.locator('#score')).toHaveText('50');
        });

        test('the lives display follows the lives', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { setChefAt(320, FLOOR_Y[2]); spawnEnemy({ x: 322, y: FLOOR_Y[2] }); step(0.016); });
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the level display follows the level', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { plateAll(); step(0.016); });
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Real-time play
    // -----------------------------------------------------------------------
    test.describe('real-time play', () => {
        test('the game runs and draws without console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
            await page.goto(GAME_URL);
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(600);
            await page.keyboard.up('ArrowRight');
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            expect(errors).toEqual([]);
        });

        test('the chef moves in real time without any manual stepping', async ({ page }) => {
            await page.keyboard.press('Space');
            const x0 = await page.evaluate(() => chef.x);
            await page.keyboard.down('ArrowLeft');
            await page.waitForTimeout(400);
            await page.keyboard.up('ArrowLeft');
            const x1 = await page.evaluate(() => chef.x);
            expect(x1).toBeLessThan(x0);
        });

        test('something is painted on the canvas', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(200);
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
