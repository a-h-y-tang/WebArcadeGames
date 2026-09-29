const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a game with an empty bar and nothing arriving on its own: each spec
// puts exactly the customers and mugs it cares about on the bar. `autoStep` off
// stops requestAnimationFrame from advancing time behind the spec's back.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        autoStep = false;
        autoSpawn = false;
        customers.length = 0;
        mugs.length = 0;
        empties.length = 0;
    });

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

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the declared size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 480]);
        });

        test('there are four lanes with distinct, ordered y positions', async ({ page }) => {
            const ys = await page.evaluate(() =>
                Array.from({ length: LANES }, (_, i) => laneY(i))
            );
            expect(ys).toHaveLength(4);
            expect(ys).toEqual([...ys].sort((a, b) => a - b));
            expect(new Set(ys).size).toBe(4);
            ys.forEach((y) => expect(y).toBeGreaterThan(0) && expect(y).toBeLessThan(480));
        });

        test('the bar runs left to right inside the canvas', async ({ page }) => {
            const geometry = await page.evaluate(() => ({
                left: BAR_LEFT,
                right: BAR_RIGHT,
                grab: GRAB_X,
                catch: CATCH_X,
            }));
            expect(geometry.left).toBeGreaterThan(0);
            expect(geometry.left).toBeLessThan(geometry.catch);
            // The catch zone is the near stretch of bar, wide enough to give the
            // player a real window on an empty rather than a single frame.
            expect(geometry.right - geometry.catch).toBeGreaterThanOrEqual(50);
            expect(geometry.catch).toBeLessThan(geometry.grab);
            expect(geometry.grab).toBeLessThan(geometry.right);
            expect(geometry.right).toBeLessThan(720);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#served')).toHaveText('0');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('the bar is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => [customers.length, mugs.length, empties.length])).toEqual([0, 0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                autoStep = false;
                customers.push(makeCustomer(0));
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('startGame() puts the game into play with a full board of lives', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => [state, lives, level, score, served])).toEqual([
                'playing',
                await page.evaluate(() => START_LIVES),
                1,
                0,
                0,
            ]);
        });

        test('starting hides the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space starts the game from the idle screen', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the bartender starts in the top lane', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('customers arrive on their own once play begins', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await advance(page, 60 * 12);
            expect(await page.evaluate(() => spawned)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // The bartender
    // -----------------------------------------------------------------------
    test.describe('bartender movement', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('moveLane walks down and up the bar', async ({ page }) => {
            expect(await page.evaluate(() => { moveLane(1); return bartender.lane; })).toBe(1);
            expect(await page.evaluate(() => { moveLane(1); return bartender.lane; })).toBe(2);
            expect(await page.evaluate(() => { moveLane(-1); return bartender.lane; })).toBe(1);
        });

        test('moveLane is clamped to the outermost lanes', async ({ page }) => {
            expect(await page.evaluate(() => { moveLane(-1); return bartender.lane; })).toBe(0);
            expect(
                await page.evaluate(() => {
                    for (let i = 0; i < 10; i++) moveLane(1);
                    return bartender.lane;
                })
            ).toBe((await page.evaluate(() => LANES)) - 1);
        });

        test('ArrowDown and ArrowUp move between lanes', async ({ page }) => {
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('S and W move between lanes', async ({ page }) => {
            await page.keyboard.press('s');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('the bartender cannot move while idle', async ({ page }) => {
            await page.reload();
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pouring
    // -----------------------------------------------------------------------
    test.describe('pouring', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('pour() slides a mug from the bartender end of the current lane', async ({ page }) => {
            const mug = await page.evaluate(() => {
                moveLane(1);
                pour();
                return { count: mugs.length, lane: mugs[0].lane, x: mugs[0].x };
            });
            expect(mug.count).toBe(1);
            expect(mug.lane).toBe(1);
            expect(mug.x).toBe(await page.evaluate(() => BAR_RIGHT));
        });

        test('a poured mug travels left', async ({ page }) => {
            await page.evaluate(() => pour());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after).toBeLessThan(before);
            expect(before - after).toBeCloseTo((await page.evaluate(() => MUG_SPEED)) * 0.5, 0);
        });

        test('Space pours a mug while playing', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('the cooldown stops a second mug in the same instant', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                pour();
            });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a second mug can be poured once the cooldown has elapsed', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 30);
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('a lane holds at most MUGS_PER_LANE mugs', async ({ page }) => {
            // The cooldown is cleared by hand so the cap, not the timer, is what
            // stops the twelfth mug.
            await page.evaluate(() => {
                for (let i = 0; i < 12; i++) {
                    bartender.pourCooldown = 0;
                    pour();
                }
            });
            expect(await page.evaluate(() => mugs.length)).toBe(await page.evaluate(() => MUGS_PER_LANE));
        });

        test('pouring does nothing while idle', async ({ page }) => {
            await page.reload();
            await page.evaluate(() => pour());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Customers
    // -----------------------------------------------------------------------
    test.describe('customers', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a spawned customer starts at the far end of its lane, advancing', async ({ page }) => {
            const c = await page.evaluate(() => {
                spawnCustomer(2);
                return customers[0];
            });
            expect(c.lane).toBe(2);
            expect(c.state).toBe('advancing');
            expect(c.x).toBeLessThanOrEqual(70);
        });

        test('a customer walks toward the bartender', async ({ page }) => {
            await page.evaluate(() => spawnCustomer(0));
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            const after = await page.evaluate(() => customers[0].x);
            expect(after).toBeGreaterThan(before);
            expect(after - before).toBeCloseTo(await page.evaluate(() => customerSpeed(level)), 0);
        });

        test('customers walk faster on later levels', async ({ page }) => {
            const [one, four] = await page.evaluate(() => [customerSpeed(1), customerSpeed(4)]);
            expect(four).toBeGreaterThan(one);
        });

        test('a customer reaching the bartender costs a life', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = GRAB_X - 1;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => customers.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('a mug reaching a customer is taken and drunk', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                pour();
            });
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].state)).toBe('drinking');
        });

        test('a drinking customer sends back an empty mug and staggers away', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].state = 'drinking';
                customers[0].timer = DRINK_TIME;
            });
            await advance(page, Math.ceil(60 * 0.9));
            expect(await page.evaluate(() => empties.length)).toBe(1);
            expect(await page.evaluate(() => empties[0].lane)).toBe(0);
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(300);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
        });

        test('a customer pushed off the far end is served and scores', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = BAR_LEFT + 20;
                customers[0].state = 'drinking';
                customers[0].timer = DRINK_TIME;
            });
            await advance(page, Math.ceil(60 * 0.9));
            expect(await page.evaluate(() => customers.length)).toBe(0);
            expect(await page.evaluate(() => served)).toBe(1);
            expect(await page.evaluate(() => score)).toBeGreaterThanOrEqual(await page.evaluate(() => SCORE_SERVE));
        });

        test('a mug that meets nobody shatters at the far end and costs a life', async ({ page }) => {
            await page.evaluate(() => pour());
            await advance(page, 60 * 4);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a customer already drinking still takes the next mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                customers[0].state = 'drinking';
                customers[0].timer = DRINK_TIME;
                mugs.push(makeMug(0, 450));
            });
            await advance(page, 45);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
            expect(await page.evaluate(() => customers[0].queued)).toBe(1);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('a queued mug becomes a second drink, a second empty and a second shove', async ({ page }) => {
            // Lane 3, away from the bartender, so both empties are still in
            // flight to be counted rather than caught as they arrive.
            await page.evaluate(() => {
                spawnCustomer(3);
                customers[0].x = 400;
                customers[0].state = 'drinking';
                customers[0].timer = DRINK_TIME;
                customers[0].queued = 1;
            });
            await advance(page, Math.ceil(60 * 1.7));
            expect(await page.evaluate(() => empties.length)).toBe(2);
            expect(await page.evaluate(() => customers[0].state)).toBe('advancing');
            expect(await page.evaluate(() => customers[0].queued)).toBe(0);
            // Two shoves, less the little walking done between them.
            expect(await page.evaluate(() => customers[0].x)).toBeLessThan(400 - 2 * 110 + 20);
        });

        test('queuing mugs pushes a customer off the bar faster than one at a time', async ({ page }) => {
            const run = (queue) =>
                page.evaluate((q) => {
                    startGame();
                    autoStep = false;
                    autoSpawn = false;
                    customers.length = 0;
                    mugs.length = 0;
                    empties.length = 0;
                    spawnCustomer(0);
                    customers[0].x = 400;
                    for (let f = 0; f < 60 * 12 && customers.length; f++) {
                        if (mugs.length < q) pour();
                        step(1 / 60);
                    }
                    return { frames: served ? 1 : 0, left: customers.length };
                }, queue);

            expect(await run(1)).toEqual({ frames: 1, left: 0 });
            expect(await run(3)).toEqual({ frames: 1, left: 0 });
        });

        test('the nearest customer to the bartender takes the mug', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 200;
                spawnCustomer(0);
                customers[1].x = 400;
                pour();
            });
            await advance(page, 60);
            const states = await page.evaluate(() => customers.map((c) => c.state));
            expect(states).toEqual(['advancing', 'drinking']);
        });
    });

    // -----------------------------------------------------------------------
    // Empties
    // -----------------------------------------------------------------------
    test.describe('empty mugs', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('an empty is caught when the bartender is in its lane', async ({ page }) => {
            await page.evaluate(() => {
                empties.push(makeEmpty(0, CATCH_X - 20));
            });
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_CATCH));
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an empty in another lane is missed and costs a life', async ({ page }) => {
            await page.evaluate(() => {
                empties.push(makeEmpty(3, CATCH_X - 20));
            });
            await advance(page, 60);
            expect(await page.evaluate(() => empties.length)).toBe(0);
            expect(await page.evaluate(() => lives)).toBe(2);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('an empty travels right', async ({ page }) => {
            await page.evaluate(() => empties.push(makeEmpty(0, 200)));
            await advance(page, 30);
            expect(await page.evaluate(() => empties[0].x)).toBeGreaterThan(200);
        });

        test('moving into the lane in time saves the mug', async ({ page }) => {
            await page.evaluate(() => {
                empties.push(makeEmpty(2, 300));
            });
            await advance(page, 60);
            await page.evaluate(() => {
                moveLane(1);
                moveLane(1);
            });
            await advance(page, 60 * 2);
            expect(await page.evaluate(() => lives)).toBe(3);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SCORE_CATCH));
        });
    });

    // -----------------------------------------------------------------------
    // Losing lives and game over
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('losing a life clears the glassware from the bar', async ({ page }) => {
            await page.evaluate(() => {
                pour();
                empties.push(makeEmpty(1, 300));
                loseLife();
            });
            expect(await page.evaluate(() => [mugs.length, empties.length])).toEqual([0, 0]);
        });

        test('losing a life staggers the remaining customers back', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 400;
                loseLife();
            });
            expect(await page.evaluate(() => customers[0].x)).toBe(400 - (await page.evaluate(() => PUSHBACK)));
        });

        test('the last life ends the game', async ({ page }) => {
            await page.evaluate(() => {
                loseLife();
                loseLife();
                loseLife();
            });
            expect(await page.evaluate(() => lives)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('over');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(() => {
                score = 1234;
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the best score is persisted', async ({ page }) => {
            await page.evaluate(() => {
                score = 777;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('777');
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('a lower score does not replace the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '5000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                loseLife();
            });
            expect(await page.evaluate(() => window.localStorage.getItem('sodatapper-best'))).toBe('5000');
        });

        test('step() does nothing once the game is over', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                customers[0].x = 300;
                lives = 1;
                loseLife();
            });
            const before = await page.evaluate(() => customers[0] && customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0] && customers[0].x)).toBe(before);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives, score])).toEqual(['playing', 3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Waves and levels
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('the wave grows with the level', async ({ page }) => {
            const [one, three] = await page.evaluate(() => [waveSize(1), waveSize(3)]);
            expect(three).toBeGreaterThan(one);
        });

        test('clearing the wave advances the level and scores the bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = waveSize(level);
                score = 0;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => level)).toBe(2);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('a new wave resets the spawn counter', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = waveSize(level);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => spawned)).toBe(0);
        });

        test('the level does not advance while customers remain', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawned = waveSize(level);
                spawnCustomer(0);
            });
            await advance(page, 2);
            expect(await page.evaluate(() => level)).toBe(1);
        });

        test('spawning is reproducible from a seed', async ({ page }) => {
            const run = () =>
                page.evaluate(() => {
                    startGame();
                    autoStep = false;
                    setSeed(99);
                    customers.length = 0;
                    for (let i = 0; i < 60 * 15; i++) step(1 / 60);
                    return customers.map((c) => c.lane);
                });
            const first = await run();
            const second = await run();
            expect(first).toEqual(second);
            expect(first.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the simulation is frozen while paused', async ({ page }) => {
            await page.evaluate(() => {
                spawnCustomer(0);
                togglePause();
            });
            const before = await page.evaluate(() => customers[0].x);
            await advance(page, 60);
            expect(await page.evaluate(() => customers[0].x)).toBe(before);
        });

        test('pausing shows the overlay and resuming hides it', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.evaluate(() => togglePause());
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Space resumes from a pause instead of pouring', async ({ page }) => {
            await page.evaluate(() => togglePause());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('HUD', () => {
        test.beforeEach(async ({ page }) => {
            await startQuiet(page);
        });

        test('the score, lives and served counters follow the game state', async ({ page }) => {
            await page.evaluate(() => {
                empties.push(makeEmpty(0, CATCH_X - 5));
            });
            await advance(page, 60);
            await expect(page.locator('#score')).toHaveText(String(await page.evaluate(() => SCORE_CATCH)));

            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the canvas is actually painted', async ({ page }) => {
            const blank = await page.evaluate(() => {
                const c = document.createElement('canvas');
                c.width = canvas.width;
                c.height = canvas.height;
                return c.toDataURL();
            });
            await page.evaluate(() => draw());
            const painted = await page.evaluate(() => canvas.toDataURL());
            expect(painted).not.toBe(blank);
        });
    });
    // -----------------------------------------------------------------------
    // Game browser integration — the catalogue entry has to stay honest
    // -----------------------------------------------------------------------
    test.describe('game browser integration', () => {
        const catalogue = () =>
            JSON.parse(
                fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8')
            );

        test('the game is listed in games.json', () => {
            const entry = catalogue().find((g) => g.id === 'soda-tapper');
            expect(entry).toBeTruthy();
            expect(entry.name).toBe('Soda Tapper');
            expect(entry.dir).toBe('SodaTapper');
            expect(entry.path).toBe('games/SodaTapper/index.html');
            expect(entry.thumbnail).toBe('games/SodaTapper/screenshot.png');
            expect(entry.description.length).toBeGreaterThan(10);
        });

        test('the games.json entry stays alphabetically sorted by name', () => {
            const games = catalogue();
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
