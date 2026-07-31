const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Walk the chef across a whole ingredient span on the given floor — which marks
// all four segments and drops the pile sitting there — then hold still until the
// resulting ripple has settled. Returns the points earned by the whole drop.
async function stepPile(page, stackIndex, floor) {
    return page.evaluate(({ stackIndex, floor }) => {
        const before = score;
        chef.y = FLOORS[floor];
        chef.x = stacks[stackIndex].x - 2;
        setDir(1, 0);
        for (let i = 0; i < 100; i++) step(1 / 60);  // clears the 120 px span
        setDir(0, 0);
        for (let i = 0; i < 240; i++) step(1 / 60);  // let the column settle
        return score - before;
    }, { stackIndex, floor });
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

        test('canvas is 600x520', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '520');
        });

        test('HUD starts at score 0, 3 lives, level 1, 5 peppers', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#peppers')).toHaveText('5');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('step() does nothing while idle', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = chef.x;
                setDir(1, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Level layout
    // -----------------------------------------------------------------------
    test.describe('layout', () => {
        test('there are five floors and seven ladders', async ({ page }) => {
            expect(await page.evaluate(() => FLOORS.length)).toBe(5);
            expect(await page.evaluate(() => LADDERS.length)).toBe(7);
        });

        test('there are three burger stacks', async ({ page }) => {
            expect(await page.evaluate(() => stacks.length)).toBe(3);
        });

        test('each stack starts with one pile on each of the top four floors', async ({ page }) => {
            const shape = await page.evaluate(() =>
                stacks.map((s) => s.piles.map((p) => (p ? p.ings.length : 0))));
            expect(shape).toEqual([
                [1, 1, 1, 1, 0],
                [1, 1, 1, 1, 0],
                [1, 1, 1, 1, 0],
            ]);
        });

        test('ingredients are ordered top bun down to bottom bun', async ({ page }) => {
            const kinds = await page.evaluate(() => stacks[0].piles.slice(0, 4).map((p) => p.ings[0]));
            expect(kinds).toEqual(['bunTop', 'lettuce', 'patty', 'bunBottom']);
        });

        test('nothing is plated at the start', async ({ page }) => {
            expect(await page.evaluate(() => platedCount())).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('level 1 spawns two enemies', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => enemies.length)).toBe(2);
        });

        test('the chef starts standing on a floor', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => FLOORS.includes(chef.y))).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
        });

        test('walking right increases x', async ({ page }) => {
            const dx = await page.evaluate(() => {
                const before = chef.x;
                setDir(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x - before;
            });
            expect(dx).toBeGreaterThan(10);
        });

        test('walking left decreases x', async ({ page }) => {
            const dx = await page.evaluate(() => {
                const before = chef.x;
                setDir(-1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x - before;
            });
            expect(dx).toBeLessThan(-10);
        });

        test('the chef cannot walk off the right edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                setDir(1, 0);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeLessThanOrEqual(580);
        });

        test('the chef cannot walk off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                setDir(-1, 0);
                for (let i = 0; i < 600; i++) step(1 / 60);
                return chef.x;
            });
            expect(x).toBeGreaterThanOrEqual(20);
        });

        test('climbing is refused when not on a ladder', async ({ page }) => {
            const dy = await page.evaluate(() => {
                chef.x = LADDERS[0] + 40;
                chef.y = FLOORS[2];
                const before = chef.y;
                setDir(0, -1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.y - before;
            });
            expect(dy).toBe(0);
        });

        test('climbing up on a ladder decreases y', async ({ page }) => {
            const dy = await page.evaluate(() => {
                chef.x = LADDERS[3];
                chef.y = FLOORS[2];
                const before = chef.y;
                setDir(0, -1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.y - before;
            });
            expect(dy).toBeLessThan(-10);
        });

        test('climbing snaps the chef onto the ladder centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                chef.x = LADDERS[3] + 4;
                chef.y = FLOORS[2];
                setDir(0, -1);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x;
            });
            expect(await page.evaluate(() => LADDERS[3])).toBe(x);
        });

        test('the chef cannot climb above the top floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                chef.x = LADDERS[3];
                chef.y = FLOORS[0];
                setDir(0, -1);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return chef.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOORS[0]));
        });

        test('the chef cannot climb below the bottom floor', async ({ page }) => {
            const y = await page.evaluate(() => {
                chef.x = LADDERS[3];
                chef.y = FLOORS[4];
                setDir(0, 1);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return chef.y;
            });
            expect(y).toBe(await page.evaluate(() => FLOORS[4]));
        });

        test('walking is refused in mid-ladder', async ({ page }) => {
            const dx = await page.evaluate(() => {
                chef.x = LADDERS[3];
                chef.y = (FLOORS[1] + FLOORS[2]) / 2;
                const before = chef.x;
                setDir(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return chef.x - before;
            });
            expect(dx).toBe(0);
        });

        test('a climb that reaches a floor lets the chef walk again', async ({ page }) => {
            const result = await page.evaluate(() => {
                chef.x = LADDERS[3];
                chef.y = FLOORS[2];
                setDir(0, -1);
                for (let i = 0; i < 300; i++) step(1 / 60);
                const y = chef.y;
                setDir(1, 0);
                const before = chef.x;
                for (let i = 0; i < 30; i++) step(1 / 60);
                return { y, dx: chef.x - before };
            });
            expect(result.y).toBe(await page.evaluate(() => FLOORS[0]));
            expect(result.dx).toBeGreaterThan(10);
        });
    });

    // -----------------------------------------------------------------------
    // Stepping ingredients
    // -----------------------------------------------------------------------
    test.describe('stepping ingredients', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
        });

        test('walking onto a pile marks the segment underfoot', async ({ page }) => {
            const steps = await page.evaluate(() => {
                chef.y = FLOORS[0];
                chef.x = stacks[0].x + 5;
                setDir(1, 0);
                step(1 / 60);
                return stacks[0].piles[0].steps.slice();
            });
            expect(steps).toEqual([true, false, false, false]);
        });

        test('a pile off the chef’s floor is untouched', async ({ page }) => {
            const steps = await page.evaluate(() => {
                chef.y = FLOORS[0];
                chef.x = stacks[0].x + 5;
                setDir(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return stacks[0].piles[1].steps.slice();
            });
            expect(steps).toEqual([false, false, false, false]);
        });

        test('walking the whole span drops the pile', async ({ page }) => {
            await stepPile(page, 0, 0);
            expect(await page.evaluate(() => stacks[0].piles[0])).toBeNull();
        });

        test('a dropped ingredient scores 50', async ({ page }) => {
            const gained = await page.evaluate(() => {
                const before = score;
                chef.y = FLOORS[0];
                chef.x = stacks[0].x - 2;
                setDir(1, 0);
                for (let i = 0; i < 100; i++) step(1 / 60);
                return score - before;
            });
            expect(gained).toBeGreaterThanOrEqual(50);
        });

        test('walking another stack leaves the first alone', async ({ page }) => {
            await stepPile(page, 2, 0);
            const shape = await page.evaluate(() => stacks[0].piles.map((p) => (p ? p.ings.length : 0)));
            expect(shape).toEqual([1, 1, 1, 1, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Falling, pushing and plating
    // -----------------------------------------------------------------------
    test.describe('falling and plating', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
        });

        test('a dropped pile pushes the whole column down one floor', async ({ page }) => {
            await stepPile(page, 0, 0);
            const shape = await page.evaluate(() => stacks[0].piles.map((p) => (p ? p.ings[0] : null)));
            expect(shape).toEqual([null, 'bunTop', 'lettuce', 'patty', null]);
            expect(await page.evaluate(() => stacks[0].piles[4])).toBeNull();
            expect(await page.evaluate(() => platedCount())).toBe(1);
        });

        test('the first ingredient to reach the plate is the bottom bun', async ({ page }) => {
            await stepPile(page, 0, 0);
            expect(await page.evaluate(() => stacks[0].plate.ings)).toEqual(['bunBottom']);
        });

        test('landed piles have their step marks cleared', async ({ page }) => {
            await stepPile(page, 0, 0);
            const steps = await page.evaluate(() => stacks[0].piles[1].steps.slice());
            expect(steps).toEqual([false, false, false, false]);
        });

        test('nothing is left falling once the ripple settles', async ({ page }) => {
            await stepPile(page, 0, 0);
            expect(await page.evaluate(() => fallingPiles.length)).toBe(0);
        });

        test('four passes plate an entire burger in order', async ({ page }) => {
            for (const floor of [0, 1, 2, 3]) await stepPile(page, 0, floor);
            expect(await page.evaluate(() => stacks[0].plate.ings))
                .toEqual(['bunBottom', 'patty', 'lettuce', 'bunTop']);
        });

        test('plating an ingredient scores 100 on top of the drop', async ({ page }) => {
            const gained = await stepPile(page, 0, 0);
            expect(gained).toBe(150);
        });

        test('a plated pile stacks visibly above the plate', async ({ page }) => {
            for (const floor of [0, 1]) await stepPile(page, 0, floor);
            const heights = await page.evaluate(() => stacks[0].plate.ings.length);
            expect(heights).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Level completion
    // -----------------------------------------------------------------------
    test.describe('level completion', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
        });

        test('serving all three burgers advances the level', async ({ page }) => {
            await page.evaluate(() => serveAll());
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('the next level restocks all twelve ingredients', async ({ page }) => {
            await page.evaluate(() => serveAll());
            const shape = await page.evaluate(() =>
                stacks.map((s) => s.piles.map((p) => (p ? p.ings.length : 0))));
            expect(shape).toEqual([
                [1, 1, 1, 1, 0],
                [1, 1, 1, 1, 0],
                [1, 1, 1, 1, 0],
            ]);
            expect(await page.evaluate(() => platedCount())).toBe(0);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const gained = await page.evaluate(() => {
                const before = score;
                serveAll();
                return score - before;
            });
            expect(gained).toBeGreaterThanOrEqual(1000);
        });

        test('the next level refills the pepper', async ({ page }) => {
            await page.evaluate(() => { firePepper(); firePepper(); serveAll(); });
            expect(await page.evaluate(() => peppers)).toBe(5);
        });

        test('the next level adds an enemy', async ({ page }) => {
            await page.evaluate(() => serveAll());
            expect(await page.evaluate(() => enemies.length)).toBe(3);
        });

        test('the HUD shows the new level', async ({ page }) => {
            await page.evaluate(() => serveAll());
            await expect(page.locator('#level')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { setSeed(7); startGame(); });
        });

        test('enemies move over time', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = enemies.map((e) => e.x + ',' + e.y);
                for (let i = 0; i < 120; i++) step(1 / 60);
                return enemies.some((e, i) => e.x + ',' + e.y !== before[i]);
            });
            expect(moved).toBe(true);
        });

        test('enemies stay inside the playfield', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let i = 0; i < 900; i++) step(1 / 60);
                return enemies.every((e) => e.x >= 20 && e.x <= 580 && e.y >= FLOORS[0] && e.y <= FLOORS[4]);
            });
            expect(inside).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const lost = await page.evaluate(() => {
                const before = lives;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                return before - lives;
            });
            expect(lost).toBe(1);
        });

        test('losing a life resets the chef to its post', async ({ page }) => {
            const back = await page.evaluate(() => {
                const start = { x: chef.x, y: chef.y };
                chef.x = LADDERS[0];
                chef.y = FLOORS[0];
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                return chef.x === start.x && chef.y === start.y;
            });
            expect(back).toBe(true);
        });

        test('a death does not undo plated ingredients', async ({ page }) => {
            const plated = await page.evaluate(() => {
                serveOne(0);
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                return platedCount();
            });
            expect(plated).toBe(4);
        });

        test('running out of lives ends the game', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 3; i++) {
                    enemies[0].x = chef.x;
                    enemies[0].y = chef.y;
                    step(1 / 60);
                }
            });
            expect(await page.evaluate(() => state)).toBe('over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('a falling pile squashes an enemy for 500', async ({ page }) => {
            const gained = await page.evaluate(() => {
                enemies.length = 1;
                enemies[0].x = stacks[0].x + 60;
                enemies[0].y = FLOORS[1];
                enemies[0].stun = 99;
                const before = score;
                chef.y = FLOORS[0];
                chef.x = stacks[0].x - 2;
                setDir(1, 0);
                for (let i = 0; i < 100; i++) step(1 / 60);
                setDir(0, 0);
                for (let i = 0; i < 240; i++) step(1 / 60);
                return score - before - 150;
            });
            expect(gained).toBe(500);
        });

        test('a squashed enemy leaves the floor and comes back later', async ({ page }) => {
            const seen = await page.evaluate(() => {
                enemies.length = 1;
                enemies[0].x = stacks[0].x + 60;
                enemies[0].y = FLOORS[1];
                enemies[0].stun = 99;
                chef.y = FLOORS[0];
                chef.x = stacks[0].x - 2;
                setDir(1, 0);
                for (let i = 0; i < 100; i++) step(1 / 60);
                setDir(0, 0);
                for (let i = 0; i < 60; i++) step(1 / 60);
                const dead = !enemies[0].alive;
                for (let i = 0; i < 400; i++) step(1 / 60);
                return { dead, back: enemies[0].alive };
            });
            expect(seen.dead).toBe(true);
            expect(seen.back).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { setSeed(3); startGame(); });
        });

        test('throwing pepper uses a shaker', async ({ page }) => {
            await page.evaluate(() => firePepper());
            expect(await page.evaluate(() => peppers)).toBe(4);
            await expect(page.locator('#peppers')).toHaveText('4');
        });

        test('pepper runs out after five throws', async ({ page }) => {
            const left = await page.evaluate(() => {
                for (let i = 0; i < 8; i++) firePepper();
                return peppers;
            });
            expect(left).toBe(0);
        });

        test('pepper stuns an enemy in front of the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                chef.face = 1;
                enemies[0].x = chef.x + 26;
                enemies[0].y = chef.y;
                firePepper();
                return enemies[0].stun > 0;
            });
            expect(stunned).toBe(true);
        });

        test('pepper misses an enemy behind the chef', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                chef.face = 1;
                enemies[0].x = chef.x - 60;
                enemies[0].y = chef.y;
                firePepper();
                return enemies[0].stun > 0;
            });
            expect(stunned).toBe(false);
        });

        test('a stunned enemy stays put', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const e = enemies[0];
                e.stun = 4;
                const before = e.x + ',' + e.y;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return e.x + ',' + e.y !== before;
            });
            expect(moved).toBe(false);
        });

        test('a stunned enemy is harmless', async ({ page }) => {
            const lost = await page.evaluate(() => {
                const before = lives;
                enemies[0].stun = 4;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                return before - lives;
            });
            expect(lost).toBe(0);
        });

        test('the stun wears off', async ({ page }) => {
            const stillStunned = await page.evaluate(() => {
                enemies[0].stun = 1;
                for (let i = 0; i < 90; i++) step(1 / 60);
                return enemies[0].stun > 0;
            });
            expect(stillStunned).toBe(false);
        });

        test('an empty shaker stuns nothing', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                peppers = 0;
                chef.face = 1;
                enemies[0].x = chef.x + 26;
                enemies[0].y = chef.y;
                firePepper();
                return enemies[0].stun > 0;
            });
            expect(stunned).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('keyboard controls', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { startGame(); enemies.length = 0; });
        });

        test('ArrowRight sets the walk direction', async ({ page }) => {
            await page.keyboard.down('ArrowRight');
            expect(await page.evaluate(() => chef.dx)).toBe(1);
            await page.keyboard.up('ArrowRight');
            expect(await page.evaluate(() => chef.dx)).toBe(0);
        });

        test('ArrowUp sets the climb direction', async ({ page }) => {
            await page.keyboard.down('ArrowUp');
            expect(await page.evaluate(() => chef.dy)).toBe(-1);
            await page.keyboard.up('ArrowUp');
            expect(await page.evaluate(() => chef.dy)).toBe(0);
        });

        test('WASD works as well as the arrows', async ({ page }) => {
            await page.keyboard.down('a');
            expect(await page.evaluate(() => chef.dx)).toBe(-1);
            await page.keyboard.up('a');
            await page.keyboard.down('s');
            expect(await page.evaluate(() => chef.dy)).toBe(1);
            await page.keyboard.up('s');
        });

        test('Space throws pepper while running', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => peppers)).toBe(4);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a paused game does not simulate', async ({ page }) => {
            const moved = await page.evaluate(() => {
                setDir(1, 0);
                state = 'paused';
                const before = chef.x;
                for (let i = 0; i < 60; i++) step(1 / 60);
                return chef.x !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Game over and restart
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test.beforeEach(async ({ page }) => {
            await page.evaluate(() => { setSeed(11); startGame(); });
        });

        test('the best score is stored', async ({ page }) => {
            const best = await page.evaluate(() => {
                score = 3400;
                lives = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                return window.localStorage.getItem('burgertime-best');
            });
            expect(best).toBe('3400');
            await expect(page.locator('#best')).toHaveText('3400');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
            });
            await expect(page.locator('#overlay-score')).toContainText('777');
        });

        test('Space starts a fresh game after game over', async ({ page }) => {
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await page.evaluate(() => score)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('a restart restocks the burgers', async ({ page }) => {
            await page.evaluate(() => {
                serveOne(0);
                lives = 1;
                enemies[0].x = chef.x;
                enemies[0].y = chef.y;
                step(1 / 60);
                startGame();
            });
            expect(await page.evaluate(() => platedCount())).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is drawn on', async ({ page }) => {
            await page.evaluate(() => { startGame(); draw(); });
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, 600, 520).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('no console errors on load', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(GAME_URL);
            await page.evaluate(() => { startGame(); for (let i = 0; i < 120; i++) step(1 / 60); draw(); });
            expect(errors).toEqual([]);
        });
    });
});
