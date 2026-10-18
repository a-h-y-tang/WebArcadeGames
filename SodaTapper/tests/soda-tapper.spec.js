const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Start a round with an empty bar: no patrons, no mugs, no spawning and no
// requestAnimationFrame stepping, so time is entirely under the spec's control.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        patrons.length = 0;
        mugs.length = 0;
        spawnEnabled = false;   // no new custom walks in behind the spec's back
        autoStep = false;
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

        test('canvas matches the playfield size', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '460');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 460]);
        });

        test('there are four bars', async ({ page }) => {
            expect(await page.evaluate(() => LANE_COUNT)).toBe(4);
        });

        test('lane y positions are evenly spaced', async ({ page }) => {
            expect(await page.evaluate(() =>
                Array.from({ length: LANE_COUNT }, (_, i) => laneY(i))
            )).toEqual([70, 170, 270, 370]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, round and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#round')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('sodatapper-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('no patrons or mugs before starting', async ({ page }) => {
            expect(await page.evaluate(() => [patrons.length, mugs.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => { autoStep = false; });
            await advance(page, 120);
            expect(await page.evaluate(() => [state, patrons.length, score])).toEqual(['idle', 0, 0]);
        });

        test('serving does nothing while idle', async ({ page }) => {
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a run
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the run', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the run', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the overlay is hidden once running', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh run has three lives, round one and no score', async ({ page }) => {
            await page.evaluate(() => { score = 999; lives = 1; roundIndex = 3; startGame(); });
            expect(await page.evaluate(() => [score, lives, roundIndex])).toEqual([0, 3, 0]);
        });

        test('the bartender starts at the top bar', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('patrons walk in once the run is going', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoStep = false; });
            await advance(page, 240);
            expect(await page.evaluate(() => patrons.length)).toBeGreaterThan(0);
        });

        test('patrons enter from the far end of a bar', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoStep = false; });
            await advance(page, 60);
            const xs = await page.evaluate(() => patrons.map((p) => p.x));
            for (const x of xs) expect(x).toBeGreaterThan(500);
        });

        test('spawns never exceed the round cap', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoStep = false; });
            await advance(page, 600);
            const [count, cap] = await page.evaluate(() => [patrons.length, round().maxActive]);
            expect(count).toBeLessThanOrEqual(cap);
        });

        test('every patron spawns into a real lane', async ({ page }) => {
            await page.evaluate(() => { startGame(); autoStep = false; });
            await advance(page, 600);
            const lanes = await page.evaluate(() => patrons.map((p) => p.lane));
            for (const lane of lanes) {
                expect(Number.isInteger(lane)).toBe(true);
                expect(lane).toBeGreaterThanOrEqual(0);
                expect(lane).toBeLessThan(4);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Moving between bars
    // -----------------------------------------------------------------------
    test.describe('the bartender', () => {
        test('ArrowDown moves down a bar', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('ArrowUp moves back up a bar', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('S and W also move between bars', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('s');
            await page.keyboard.press('s');
            expect(await page.evaluate(() => bartender.lane)).toBe(2);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => bartender.lane)).toBe(1);
        });

        test('cannot move above the top bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { moveBartender(-1); moveBartender(-1); });
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });

        test('cannot move below the bottom bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { for (let i = 0; i < 8; i++) moveBartender(1); });
            expect(await page.evaluate(() => bartender.lane)).toBe(3);
        });

        test('does not move while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => bartender.lane)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Serving mugs
    // -----------------------------------------------------------------------
    test.describe('serving', () => {
        test('Space pours a mug into the bartender lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { bartender.lane = 2; });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => mugs.map((m) => [m.lane, m.full]))).toEqual([[2, true]]);
        });

        test('a poured mug starts at the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            const x = await page.evaluate(() => mugs[0].x);
            expect(x).toBeGreaterThan(await page.evaluate(() => TAP_X));
            expect(x).toBeLessThan(200);
        });

        test('a full mug slides toward the far end', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(after - before).toBeCloseTo(0.5 * 300, 0);
        });

        test('the serve cooldown stops a double pour', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { serve(); serve(); serve(); });
            expect(await page.evaluate(() => mugs.length)).toBe(1);
        });

        test('a second mug can be poured once the cooldown expires', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 30);
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(2);
        });

        test('serving does nothing while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => togglePause());
            await page.evaluate(() => serve());
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('clicking a bar moves there and pours', async ({ page }) => {
            await startQuiet(page);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 300, box.y + 270);
            expect(await page.evaluate(() => [bartender.lane, mugs.length, mugs[0].lane]))
                .toEqual([2, 1, 2]);
        });
    });

    // -----------------------------------------------------------------------
    // Patrons
    // -----------------------------------------------------------------------
    test.describe('patrons', () => {
        test('a patron walks toward the taps', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPatron(1));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            const after = await page.evaluate(() => patrons[0].x);
            expect(after).toBeLessThan(before);
        });

        test('a patron walks at the round speed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPatron(1));
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 60);
            const [after, speed] = await page.evaluate(() => [patrons[0].x, round().patronSpeed]);
            expect(before - after).toBeCloseTo(speed, 0);
        });

        test('a patron spawns walking', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => spawnPatron(0));
            expect(await page.evaluate(() => patrons[0].phase)).toBe('walking');
        });

        test('a patron reaching the taps costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(0); patrons[0].x = GRAB_X + 1; });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a patron reaching the taps is cleared off the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(0); patrons[0].x = GRAB_X - 5; });
            await advance(page, 2);
            const [xs, spawnX] = await page.evaluate(() => [patrons.map((p) => p.x), SPAWN_X]);
            for (const x of xs) expect(x).toBeGreaterThanOrEqual(spawnX);
        });
    });

    // -----------------------------------------------------------------------
    // A mug meeting a patron
    // -----------------------------------------------------------------------
    test.describe('serving a patron', () => {
        // Put one patron mid-bar and slide a mug into them.
        const serveInto = async (page, lane = 0, x = 400) => {
            await page.evaluate(([l, px]) => {
                spawnPatron(l);
                patrons[0].x = px;
                bartender.lane = l;
                serve();
            }, [lane, x]);
            await page.evaluate(() => {
                // Walk the mug up to the patron a frame at a time.
                for (let i = 0; i < 600 && mugs.length && mugs[0].full; i++) step(1 / 60);
            });
        };

        test('the patron catches the mug', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            expect(await page.evaluate(() => mugs.filter((m) => m.full).length)).toBe(0);
        });

        test('catching scores points', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => SERVE_POINTS));
        });

        test('the patron is pushed back toward the door', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page, 0, 400);
            const x = await page.evaluate(() => patrons[0].x);
            expect(x).toBeGreaterThan(400);
        });

        test('the patron stops to drink', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            expect(await page.evaluate(() => patrons[0].phase)).toBe('drinking');
        });

        test('a drinking patron holds still', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 10);
            expect(await page.evaluate(() => patrons[0].x)).toBeCloseTo(before, 5);
        });

        test('finishing the drink sends an empty mug back', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            await advance(page, 90);
            const empties = await page.evaluate(() => mugs.filter((m) => !m.full).length);
            expect(empties).toBe(1);
        });

        test('an empty mug slides back toward the taps', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page);
            await advance(page, 90);
            const before = await page.evaluate(() => mugs[0].x);
            await advance(page, 30);
            const after = await page.evaluate(() => mugs[0].x);
            expect(before - after).toBeCloseTo(0.5 * 240, 0);
        });

        test('the patron resumes walking after drinking', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page, 0, 400);
            await advance(page, 90);
            expect(await page.evaluate(() => patrons[0].phase)).toBe('walking');
        });

        test('a patron shoved past the door leaves satisfied', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page, 0, 650);
            await advance(page, 90);
            expect(await page.evaluate(() => patrons.length)).toBe(0);
        });

        test('a satisfied patron scores the bigger bonus', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page, 0, 650);
            await advance(page, 90);
            const [points, serve_, satisfied] = await page.evaluate(
                () => [score, SERVE_POINTS, SATISFIED_POINTS]);
            expect(points).toBe(serve_ + satisfied);
        });

        test('a satisfied patron still sends the mug back', async ({ page }) => {
            await startQuiet(page);
            await serveInto(page, 0, 650);
            await advance(page, 90);
            expect(await page.evaluate(() => mugs.length)).toBe(1);
            expect(await page.evaluate(() => mugs[0].full)).toBe(false);
        });

        test('a mug passes behind a patron that is leaving', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(0); patrons[0].x = 300; serve(); });
            await advance(page, 200);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Smashed mugs
    // -----------------------------------------------------------------------
    test.describe('smashed mugs', () => {
        test('a full mug down an empty bar costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 240);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a smashed mug is cleared off the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => serve());
            await advance(page, 240);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });

        test('an empty mug is caught when the bartender is in its lane', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                bartender.lane = 2;
                mugs.push({ lane: 2, x: CATCH_X + 30, full: false });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => [mugs.length, lives])).toEqual([0, 3]);
        });

        test('catching an empty mug scores points', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                bartender.lane = 2;
                mugs.push({ lane: 2, x: CATCH_X + 30, full: false });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CATCH_POINTS));
        });

        test('an empty mug in another lane smashes and costs a life', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                bartender.lane = 0;
                mugs.push({ lane: 3, x: CATCH_X + 30, full: false });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => [mugs.length, lives])).toEqual([0, 2]);
        });

        test('a smash clears every mug off the bars', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                bartender.lane = 0;
                mugs.push({ lane: 3, x: CATCH_X + 30, full: false });
                mugs.push({ lane: 1, x: 400, full: true });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => mugs.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Lives and game over
    // -----------------------------------------------------------------------
    test.describe('lives', () => {
        test('losing a life pauses play briefly', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => loseLife());
            expect(await page.evaluate(() => state)).toBe('dying');
        });

        test('play resumes after the pause', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => loseLife());
            await advance(page, 120);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('losing a life sends survivors back to the door', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                spawnPatron(0);
                patrons[0].x = 250;
                loseLife();
            });
            expect(await page.evaluate(() => patrons[0].x)).toBeGreaterThan(600);
        });

        test('the HUD tracks the remaining lives', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => loseLife());
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('three lives lost ends the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { loseLife(); loseLife(); loseLife(); });
            expect(await page.evaluate(() => [state, lives])).toEqual(['gameover', 0]);
        });

        test('game over shows the overlay with the score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 1234; loseLife(); loseLife(); loseLife(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('game over records a new best score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { score = 4321; loseLife(); loseLife(); loseLife(); });
            await expect(page.locator('#best')).toHaveText('4321');
            expect(await page.evaluate(() => localStorage.getItem('sodatapper-best'))).toBe('4321');
        });

        test('the simulation is frozen after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(0); loseLife(); loseLife(); loseLife(); });
            const before = await page.evaluate(() => patrons.map((p) => p.x));
            await advance(page, 120);
            expect(await page.evaluate(() => patrons.map((p) => p.x))).toEqual(before);
        });

        test('Space restarts after game over', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { loseLife(); loseLife(); loseLife(); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, lives, score])).toEqual(['running', 3, 0]);
        });
    });

    // -----------------------------------------------------------------------
    // Rounds
    // -----------------------------------------------------------------------
    test.describe('rounds', () => {
        test('clearing the quota finishes the round', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawned = round().patrons; });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('levelclear');
        });

        test('a cleared round pays a bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawned = round().patrons; });
            await advance(page, 5);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => LEVEL_BONUS));
        });

        test('the next round starts after the pause', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawned = round().patrons; });
            await advance(page, 180);
            expect(await page.evaluate(() => [state, roundIndex])).toEqual(['running', 1]);
        });

        test('the HUD shows the new round', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawned = round().patrons; });
            await advance(page, 180);
            await expect(page.locator('#round')).toHaveText('2');
        });

        test('a round is not cleared while a mug is still sliding', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawned = round().patrons; serve(); });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a round is not cleared while a patron is still on the bar', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(0); spawned = round().patrons; });
            await advance(page, 5);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('later rounds are faster', async ({ page }) => {
            const speeds = await page.evaluate(() => ROUNDS.map((r) => r.patronSpeed));
            for (let i = 1; i < speeds.length; i++) {
                expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
            }
        });

        test('later rounds are busier', async ({ page }) => {
            const gaps = await page.evaluate(() => ROUNDS.map((r) => r.spawnGap));
            for (let i = 1; i < gaps.length; i++) {
                expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1]);
            }
        });

        test('clearing the last round wins the run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { roundIndex = ROUNDS.length - 1; spawned = round().patrons; });
            await advance(page, 180);
            expect(await page.evaluate(() => state)).toBe('won');
        });

        test('winning shows a win overlay', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { roundIndex = ROUNDS.length - 1; spawned = round().patrons; });
            await advance(page, 180);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|closing|last call/i);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('the simulation is frozen while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => { spawnPatron(2); togglePause(); });
            const before = await page.evaluate(() => patrons[0].x);
            await advance(page, 120);
            expect(await page.evaluate(() => patrons[0].x)).toBe(before);
        });

        test('P unpauses the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Space unpauses the run', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the pause overlay explains itself', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/pause/i);
        });

        test('pausing does not apply while idle', async ({ page }) => {
            await page.evaluate(() => togglePause());
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('draw() works while idle', async ({ page }) => {
            expect(await page.evaluate(() => { draw(); return true; })).toBe(true);
        });

        test('draw() works with a busy bar', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => {
                for (let l = 0; l < LANE_COUNT; l++) {
                    spawnPatron(l);
                    mugs.push({ lane: l, x: 300, full: l % 2 === 0 });
                }
                patrons[0].phase = 'drinking';
                draw();
                return true;
            })).toBe(true);
        });

        test('the canvas is actually painted', async ({ page }) => {
            await page.keyboard.press('Space');
            const painted = await page.evaluate(() => {
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the animation loop runs without errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });

        test('the run survives a long unattended stretch', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => { startGame(); autoStep = false; });
            await advance(page, 3000);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => ['running', 'dying', 'levelclear', 'gameover', 'won']
                .includes(state))).toBe(true);
        });
    });
});
