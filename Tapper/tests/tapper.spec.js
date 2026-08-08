const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Tapper', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
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

        test('score, level, lives and best show their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no mugs or customers before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ m: mugs.length, c: customers.length }));
            expect(counts).toEqual({ m: 0, c: 0 });
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => BARS)).toBe(4);
        });

        test('every bar sits inside the canvas, top to bottom', async ({ page }) => {
            const ys = await page.evaluate(() => Array.from({ length: BARS }, (_, i) => barY(i)));
            expect(ys).toHaveLength(4);
            for (const y of ys) {
                expect(y).toBeGreaterThan(0);
                expect(y).toBeLessThan(400);
            }
            for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('tapper-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game resets score, level, lives and served count', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999; level = 7; served = 5;
                startGame();
                return { score, level, lives, served };
            });
            expect(s).toEqual({ score: 0, level: 1, lives: 3, served: 0 });
        });

        test('the bartender starts at the top bar with an empty bar top', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { lane: bartender.lane, mugs: mugs.length, customers: customers.length };
            });
            expect(s).toEqual({ lane: 0, mugs: 0, customers: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Moving the bartender between bars
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test('ArrowDown moves down a bar', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('ArrowUp moves up a bar', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('the bartender cannot move above the top bar', async ({ page }) => {
            const lane = await page.evaluate(() => { startGame(); moveBartender(-1); return bartender.lane; });
            expect(lane).toBe(0);
        });

        test('the bartender cannot move below the bottom bar', async ({ page }) => {
            const lane = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 10; i++) moveBartender(1);
                return bartender.lane;
            });
            expect(lane).toBe(3);
        });

        test('W and S also move the bartender', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('s');
            const afterS = await page.evaluate(() => bartender.lane);
            await page.keyboard.press('w');
            const afterW = await page.evaluate(() => bartender.lane);
            expect(afterS).toBe(1);
            expect(afterW).toBe(0);
        });

        test('the bartender cannot change bars while idle', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring mugs
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test('Space pours a full mug in the bartender\'s bar', async ({ page }) => {
            const m = await page.evaluate(() => {
                startGame();
                moveBartender(1);
                pourMug();
                return mugs.map((mug) => ({ lane: mug.lane, dir: mug.dir, empty: mug.empty }));
            });
            expect(m).toEqual([{ lane: 1, dir: -1, empty: false }]);
        });

        test('a poured mug starts at the tap end of the bar', async ({ page }) => {
            const x = await page.evaluate(() => { startGame(); pourMug(); return mugs[0].x; });
            const tap = await page.evaluate(() => TAP_X);
            expect(x).toBeLessThanOrEqual(tap);
            expect(x).toBeGreaterThan(tap - 60);
        });

        test('pouring is rate limited by a cooldown', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); pourMug(); pourMug(); return mugs.length; });
            expect(n).toBe(1);
        });

        test('another mug can be poured once the cooldown elapses', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                pourMug();
                step(POUR_COOLDOWN + 0.01);
                pourMug();
                return mugs.length;
            });
            expect(n).toBe(2);
        });

        test('pressing Space while running pours instead of restarting', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.evaluate(() => { score = 42; });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ mugs: mugs.length, score, state }));
            expect(s).toEqual({ mugs: 1, score: 42, state: 'running' });
        });

        test('no mug is poured while paused', async ({ page }) => {
            const n = await page.evaluate(() => { startGame(); togglePause(); pourMug(); return mugs.length; });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Mug travel
    // -----------------------------------------------------------------------
    test.describe('mug travel', () => {
        test('a full mug slides toward the far end of the bar', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                pourMug();
                const before = mugs[0].x;
                step(0.5);
                return before - mugs[0].x;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a full mug travels at mugSpeed()', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                pourMug();
                const before = mugs[0].x;
                step(0.25);
                return { moved: before - mugs[0].x, expected: mugSpeed() * 0.25 };
            });
            expect(r.moved).toBeCloseTo(r.expected, 1);
        });

        test('a mug nobody catches smashes at the end of the bar and costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pourMug();
                for (let i = 0; i < 200 && mugs.length; i++) step(0.05);
                return { lives, mugs: mugs.length };
            });
            expect(s).toEqual({ lives: 2, mugs: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test('spawnCustomer puts a thirsty customer at the far end of a bar', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                const cust = spawnCustomer({ lane: 2 });
                return { lane: cust.lane, x: cust.x, state: cust.state, atLeft: cust.x <= BAR_LEFT + 1 };
            });
            expect(c.lane).toBe(2);
            expect(c.state).toBe('advancing');
            expect(c.atLeft).toBe(true);
        });

        test('customers advance toward the tap', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0 });
                const before = c.x;
                step(1);
                return c.x - before;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('customers spawn on their own over time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 40; i++) step(0.25);
                return customers.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('a customer that reaches the tap costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnCustomer({ lane: 1, x: TAP_X - GRAB_DIST - 2 });
                step(0.5);
                return { lives, customers: customers.length };
            });
            expect(s.lives).toBe(2);
            expect(s.customers).toBe(0);
        });

        test('a customer catches a mug sliding into them, scoring points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0, x: 300 });
                pourMug();
                const before = score;
                for (let i = 0; i < 100 && mugs.length; i++) step(0.02);
                return { gained: score - before, custState: c.state, mugs: mugs.length, lives };
            });
            expect(s.gained).toBeGreaterThan(0);
            expect(s.custState).toBe('drinking');
            expect(s.mugs).toBe(0);
            expect(s.lives).toBe(3);
        });

        test('a drinking customer is pushed back toward the door', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0, x: 400 });
                c.state = 'drinking';
                c.drinkTimer = DRINK_TIME;
                const before = c.x;
                step(0.3);
                return before - c.x;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('a customer pushed out of the door leaves and is counted as served', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0, x: BAR_LEFT + 4 });
                c.state = 'drinking';
                c.drinkTimer = DRINK_TIME;
                const before = score;
                for (let i = 0; i < 100 && customers.length; i++) step(0.02);
                return { customers: customers.length, served, gained: score - before, lives };
            });
            expect(s.customers).toBe(0);
            expect(s.served).toBe(1);
            expect(s.gained).toBeGreaterThan(0);
            expect(s.lives).toBe(3);
        });

        test('a customer who finishes drinking away from the door starts advancing again', async ({ page }) => {
            const st = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0, x: 420 });
                c.state = 'drinking';
                c.drinkTimer = 0.1;
                step(0.2);
                return c.state;
            });
            expect(st).toBe('advancing');
        });
    });

    // -----------------------------------------------------------------------
    // Empty mugs coming back
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test('a departing customer sends an empty mug back down the bar', async ({ page }) => {
            const m = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 2, x: BAR_LEFT + 4 });
                c.state = 'drinking';
                c.drinkTimer = DRINK_TIME;
                for (let i = 0; i < 100 && customers.length; i++) step(0.02);
                return mugs.map((mug) => ({ lane: mug.lane, dir: mug.dir, empty: mug.empty }));
            });
            expect(m).toEqual([{ lane: 2, dir: 1, empty: true }]);
        });

        test('an empty mug slides back toward the tap', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const m = spawnEmpty({ lane: 0, x: 200 });
                step(0.5);
                return m.x - 200;
            });
            expect(moved).toBeGreaterThan(0);
        });

        test('the bartender catches an empty mug in their own bar for points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnEmpty({ lane: 0, x: 300 });
                const before = score;
                for (let i = 0; i < 200 && mugs.length; i++) step(0.02);
                return { gained: score - before, lives, mugs: mugs.length };
            });
            expect(s.gained).toBeGreaterThan(0);
            expect(s.lives).toBe(3);
            expect(s.mugs).toBe(0);
        });

        test('an empty mug in another bar smashes and costs a life', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnEmpty({ lane: 3, x: 300 });
                for (let i = 0; i < 200 && mugs.length; i++) step(0.02);
                return { lives, mugs: mugs.length };
            });
            expect(s).toEqual({ lives: 2, mugs: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives and game over', () => {
        test('losing a life clears the bars', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnCustomer({ lane: 0, x: 200 });
                spawnCustomer({ lane: 1, x: 220 });
                pourMug();
                loseLife();
                return { lives, mugs: mugs.length, customers: customers.length };
            });
            expect(s).toEqual({ lives: 2, mugs: 0, customers: 0 });
        });

        test('running out of lives ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                loseLife(); loseLife(); loseLife();
                return { state, lives };
            });
            expect(s).toEqual({ state: 'over', lives: 0 });
        });

        test('game over shows the overlay again', async ({ page }) => {
            await page.evaluate(() => { startGame(); loseLife(); loseLife(); loseLife(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => { startGame(); loseLife(); loseLife(); loseLife(); });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, lives, score }));
            expect(s).toEqual({ state: 'running', lives: 3, score: 0 });
        });

        test('the best score is persisted', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                loseLife(); loseLife(); loseLife();
            });
            await expect(page.locator('#best')).toHaveText('1234');
            expect(await page.evaluate(() => window.localStorage.getItem('tapper-best'))).toBe('1234');
            await page.reload();
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('the step loop does nothing once the game is over', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                loseLife(); loseLife(); loseLife();
                step(5);
                return { customers: customers.length, mugs: mugs.length, state };
            });
            expect(s).toEqual({ customers: 0, mugs: 0, state: 'over' });
        });
    });

    // -----------------------------------------------------------------------
    // Levels & difficulty
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('serving a bar full of customers advances the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < CUSTOMERS_PER_LEVEL; i++) {
                    const c = spawnCustomer({ lane: 0, x: BAR_LEFT + 2 });
                    c.state = 'drinking';
                    c.drinkTimer = DRINK_TIME;
                    for (let j = 0; j < 100 && customers.length; j++) step(0.02);
                    mugs.length = 0; // ignore the returning empties for this test
                }
                return { level, served };
            });
            expect(s).toEqual({ level: 2, served: 0 });
        });

        test('customers, mugs and empties all speed up with the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const l1 = { c: customerSpeed(), m: mugSpeed(), e: emptySpeed(), s: spawnInterval() };
                level = 5;
                const l5 = { c: customerSpeed(), m: mugSpeed(), e: emptySpeed(), s: spawnInterval() };
                return { l1, l5 };
            });
            expect(s.l5.c).toBeGreaterThan(s.l1.c);
            expect(s.l5.m).toBeGreaterThan(s.l1.m);
            expect(s.l5.e).toBeGreaterThan(s.l1.e);
            expect(s.l5.s).toBeLessThan(s.l1.s);
        });

        test('the customer spawn interval never drops below its floor', async ({ page }) => {
            const s = await page.evaluate(() => { level = 99; return { i: spawnInterval(), min: SPAWN_MIN }; });
            expect(s.i).toBeCloseTo(s.min, 5);
        });

        test('serving is worth more in later levels', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const l1 = servePoints();
                level = 4;
                return { l1, l4: servePoints() };
            });
            expect(s.l4).toBeGreaterThan(s.l1);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const c = spawnCustomer({ lane: 0, x: 200 });
                togglePause();
                step(2);
                return c.x;
            });
            expect(s).toBe(200);
        });

        test('the game cannot be paused before it starts', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // A full serve cycle
    // -----------------------------------------------------------------------
    test.describe('full serve cycle', () => {
        test('pour, serve, push out the door and catch the empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                spawnTimer = 1e9; // no new arrivals — watch this one customer through
                spawnCustomer({ lane: 0, x: BAR_LEFT + 40 });
                pourMug();
                for (let i = 0; i < 600 && (customers.length || mugs.length); i++) step(0.02);
                return { score, served, lives, mugs: mugs.length, customers: customers.length, state };
            });
            expect(s.state).toBe('running');
            expect(s.lives).toBe(3);
            expect(s.served).toBe(1);
            expect(s.mugs).toBe(0);
            expect(s.customers).toBe(0);
            expect(s.score).toBeGreaterThan(0);
        });

        test('the HUD tracks the live score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 320; level = 3; lives = 2;
                step(0);
            });
            await expect(page.locator('#score')).toHaveText('320');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the game renders to the canvas', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                spawnCustomer({ lane: 1, x: 300 });
                pourMug();
                draw();
                const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
