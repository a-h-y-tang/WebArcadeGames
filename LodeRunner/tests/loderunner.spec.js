const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Advance the simulation deterministically: `frames` calls to step(dt). The
// page's own requestAnimationFrame loop is switched off by loadLevelFromStrings,
// so these calls are the only source of motion.
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

const load = (page, rows) =>
    page.evaluate((r) => loadLevelFromStrings(r), rows);

const cellOf = (page) =>
    page.evaluate(() => ({ c: player.c, r: player.r, p: player.p }));

const press = (page, dir, on = true) =>
    page.evaluate(([d, v]) => { input[d] = v; }, [dir, on]);

// A flat brick floor with room to run: runner at (1,3), nobody chasing.
const FLAT = [
    '..........',
    '..........',
    '..........',
    '.@........',
    '##########',
    '==========',
];

// The same floor with a guard at (7,3), for the specs that want to be hunted.
const CHASE = [
    '..........',
    '..........',
    '..........',
    '.@.....X..',
    '##########',
    '==========',
];

// One ladder in column 4, running from the floor up to row 1.
const LADDERS = [
    '..........',
    '....H.....',
    '....H.....',
    '.@..H.....',
    '####H#####',
    '==========',
];

// A rope in row 1 spanning columns 5..7, reachable from the ladder top.
const ROPES = [
    '..........',
    '....H---..',
    '....H.....',
    '.@..H.....',
    '####H#####',
    '==========',
];

// Two chests and a pair of escape ladder cells in column 8.
const GOLD = [
    '........E.',
    '........E.',
    '........E.',
    '.@.$...$E.',
    '########H#',
    '==========',
];

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('canvas is sized to the tile grid', async ({ page }) => {
            const size = await page.evaluate(() => {
                const c = document.getElementById('canvas');
                return { w: c.width, h: c.height, cols: COLS, rows: ROWS, tile: TILE };
            });
            expect(size.w).toBe(size.cols * size.tile);
            expect(size.h).toBe(size.rows * size.tile);
        });

        test('overlay is visible before the game starts', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toBeVisible();
        });

        test('starts idle with three lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, lives, score, level }));
            expect(s.state).toBe('idle');
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
        });

        test('the shipped levels are well formed', async ({ page }) => {
            const report = await page.evaluate(() =>
                LEVELS.map((rows) => ({
                    widths: [...new Set(rows.map((row) => row.length))],
                    height: rows.length,
                    runners: rows.join('').split('@').length - 1,
                    gold: rows.join('').split('$').length - 1,
                    guards: rows.join('').split('X').length - 1,
                    escapes: rows.join('').split('E').length - 1,
                }))
            );
            expect(report.length).toBeGreaterThanOrEqual(3);
            for (const level of report) {
                expect(level.widths).toHaveLength(1);
                expect(level.height).toBeGreaterThan(4);
                expect(level.runners).toBe(1);
                expect(level.gold).toBeGreaterThan(0);
                expect(level.guards).toBeGreaterThan(0);
                expect(level.escapes).toBeGreaterThan(0);
            }
        });
    });

    // -----------------------------------------------------------------------
    // Level loading
    // -----------------------------------------------------------------------
    test.describe('level loading', () => {
        test('map characters become the right tiles', async ({ page }) => {
            await load(page, ROPES);
            const t = await page.evaluate(() => ({
                empty: tileAt(0, 0),
                brick: tileAt(0, 4),
                solid: tileAt(0, 5),
                ladder: tileAt(4, 2),
                rope: tileAt(5, 1),
                offGrid: tileAt(-1, 0),
            }));
            expect(t.empty).toBe('empty');
            expect(t.brick).toBe('brick');
            expect(t.solid).toBe('solid');
            expect(t.ladder).toBe('ladder');
            expect(t.rope).toBe('rope');
            expect(t.offGrid).toBe('solid');
        });

        test('the runner spawns on the @ cell', async ({ page }) => {
            await load(page, FLAT);
            expect(await cellOf(page)).toMatchObject({ c: 1, r: 3, p: 0 });
        });

        test('guards spawn on the X cells', async ({ page }) => {
            await load(page, CHASE);
            const g = await page.evaluate(() => guards.map((x) => ({ c: x.c, r: x.r })));
            expect(g).toEqual([{ c: 7, r: 3 }]);
        });

        test('gold is counted and left on the grid', async ({ page }) => {
            await load(page, GOLD);
            const s = await page.evaluate(() => ({
                remaining: goldRemaining,
                total: gold.length,
                cells: gold.map((g) => `${g.c},${g.r}`),
            }));
            expect(s.total).toBe(2);
            expect(s.remaining).toBe(2);
            expect(s.cells).toEqual(['3,3', '7,3']);
        });

        test('escape ladders are empty until the gold is gone', async ({ page }) => {
            await load(page, GOLD);
            const before = await page.evaluate(() => tileAt(8, 1));
            expect(before).toBe('empty');
        });
    });

    // -----------------------------------------------------------------------
    // Running
    // -----------------------------------------------------------------------
    test.describe('running', () => {
        test('runs right while right is held', async ({ page }) => {
            await load(page, FLAT);
            await press(page, 'right');
            await advance(page, 25); // 25/60 s at 6 cells/s ≈ 2.5 cells
            const a = await cellOf(page);
            expect(a.c).toBe(3);
            await advance(page, 20); // 4.5 cells covered in total
            const b = await cellOf(page);
            expect(b.c).toBe(5);
            expect(b.r).toBe(3);
        });

        test('runs left while left is held', async ({ page }) => {
            await load(page, FLAT);
            await page.evaluate(() => setPlayerCell(6, 3));
            await press(page, 'left');
            await advance(page, 25);
            expect((await cellOf(page)).c).toBe(4);
        });

        test('stops on the next cell when the key is released', async ({ page }) => {
            await load(page, FLAT);
            await press(page, 'right');
            await advance(page, 25);
            await press(page, 'right', false);
            await advance(page, 60);
            const a = await cellOf(page);
            expect(a.c).toBe(4);
            expect(a.p).toBe(0);
        });

        test('cannot run through a brick wall', async ({ page }) => {
            await load(page, [
                '..........',
                '..........',
                '..#.......',
                '.@#.......',
                '##########',
                '==========',
            ]);
            await press(page, 'right');
            await advance(page, 60);
            expect((await cellOf(page)).c).toBe(1);
        });

        test('cannot run off the edge of the grid', async ({ page }) => {
            await load(page, FLAT);
            await press(page, 'left');
            await advance(page, 120);
            expect((await cellOf(page)).c).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Gravity
    // -----------------------------------------------------------------------
    test.describe('gravity', () => {
        test('falls until it lands on brick', async ({ page }) => {
            await load(page, FLAT);
            await page.evaluate(() => setPlayerCell(5, 0));
            await advance(page, 60);
            const a = await cellOf(page);
            expect(a).toMatchObject({ c: 5, r: 3, p: 0 });
        });

        test('cannot be steered mid-fall', async ({ page }) => {
            await load(page, FLAT);
            await page.evaluate(() => setPlayerCell(5, 0));
            await press(page, 'right');
            await advance(page, 6); // still airborne
            const mid = await cellOf(page);
            expect(mid.c).toBe(5);
            expect(mid.r).toBeLessThan(3);
        });

        test('lands at the bottom of a pit', async ({ page }) => {
            await load(page, [
                '..........',
                '..........',
                '..........',
                '..........',
                '####.#####',
                '==========',
            ]);
            await page.evaluate(() => setPlayerCell(4, 0));
            await advance(page, 90);
            expect(await cellOf(page)).toMatchObject({ c: 4, r: 4, p: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('climbs up a ladder', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 3));
            await press(page, 'up');
            await advance(page, 30); // 30/60 s at 5 cells/s = 2.5 cells
            expect((await cellOf(page)).r).toBe(1);
        });

        test('climbs back down', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 1));
            await press(page, 'down');
            await advance(page, 30);
            expect((await cellOf(page)).r).toBe(3);
        });

        test('stands on top of the ladder and climbs no further', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 1));
            await press(page, 'up');
            await advance(page, 120);
            expect(await cellOf(page)).toMatchObject({ c: 4, r: 0, p: 0 });
        });

        test('the top row is not an exit without escape ladders', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 1));
            await press(page, 'up');
            await advance(page, 60);
            const s = await page.evaluate(() => ({ level, state, r: player.r }));
            expect(s).toEqual({ level: 1, state: 'playing', r: 0 });
        });

        test('cannot climb where there is no ladder', async ({ page }) => {
            await load(page, FLAT);
            await press(page, 'up');
            await advance(page, 60);
            expect(await cellOf(page)).toMatchObject({ c: 1, r: 3 });
        });

        test('a ladder holds the runner up', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 2));
            await advance(page, 120);
            expect((await cellOf(page)).r).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Ropes
    // -----------------------------------------------------------------------
    test.describe('ropes', () => {
        test('hangs on a rope instead of falling', async ({ page }) => {
            await load(page, ROPES);
            await page.evaluate(() => setPlayerCell(6, 1));
            await advance(page, 120);
            expect(await cellOf(page)).toMatchObject({ c: 6, r: 1 });
        });

        test('traverses a rope hand over hand', async ({ page }) => {
            await load(page, ROPES);
            await page.evaluate(() => setPlayerCell(5, 1));
            await press(page, 'right');
            await advance(page, 15);
            expect((await cellOf(page)).c).toBe(6);
        });

        test('falls off the end of a rope', async ({ page }) => {
            await load(page, ROPES);
            await page.evaluate(() => setPlayerCell(7, 1));
            await press(page, 'right');
            await advance(page, 15); // steps off the rope end, then lets go
            await press(page, 'right', false);
            await advance(page, 60);
            const a = await cellOf(page);
            expect(a.c).toBe(8);
            expect(a.r).toBe(3);
        });

        test('drops off a rope on down', async ({ page }) => {
            await load(page, ROPES);
            await page.evaluate(() => setPlayerCell(6, 1));
            await press(page, 'down');
            await advance(page, 60);
            expect(await cellOf(page)).toMatchObject({ c: 6, r: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // Gold and escaping
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test('running over a chest collects it', async ({ page }) => {
            await load(page, GOLD);
            await press(page, 'right');
            await advance(page, 30);
            const s = await page.evaluate(() => ({ score, goldRemaining }));
            expect(s.score).toBe(100);
            expect(s.goldRemaining).toBe(1);
        });

        test('the last chest reveals the escape ladders', async ({ page }) => {
            await load(page, GOLD);
            await press(page, 'right');
            await advance(page, 90);
            const s = await page.evaluate(() => ({
                goldRemaining,
                escape: tileAt(8, 1),
                score,
            }));
            expect(s.goldRemaining).toBe(0);
            expect(s.escape).toBe('ladder');
            expect(s.score).toBe(200);
        });

        test('the top row does not finish the level while gold remains', async ({ page }) => {
            await load(page, GOLD);
            await page.evaluate(() => setPlayerCell(8, 4));
            await press(page, 'up');
            await advance(page, 120);
            const s = await page.evaluate(() => ({ level, state, r: player.r }));
            expect(s.level).toBe(1);
            expect(s.state).toBe('playing');
            expect(s.r).toBeGreaterThan(0);
        });

        test('climbing off the top with no gold left clears the level', async ({ page }) => {
            await page.evaluate(() => startGame());
            await load(page, GOLD);
            await press(page, 'right');
            await advance(page, 90);
            await press(page, 'right', false);
            await page.evaluate(() => setPlayerCell(8, 1));
            await press(page, 'up');
            await advance(page, 60);
            const s = await page.evaluate(() => ({ level, score, state }));
            expect(s.level).toBe(2);
            expect(s.state).toBe('playing');
            expect(s.score).toBe(700); // 2 chests + level bonus
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        const DIG = [
            '..........',
            '..........',
            '..........',
            '....@.....',
            '##########',
            '==========',
        ];

        test('drills a hole down and to the right', async ({ page }) => {
            await load(page, DIG);
            const ok = await page.evaluate(() => digRight());
            expect(ok).toBe(true);
            expect(await page.evaluate(() => tileAt(5, 4))).toBe('hole');
            expect(await page.evaluate(() => holes.length)).toBe(1);
        });

        test('drills a hole down and to the left', async ({ page }) => {
            await load(page, DIG);
            expect(await page.evaluate(() => digLeft())).toBe(true);
            expect(await page.evaluate(() => tileAt(3, 4))).toBe('hole');
        });

        test('cannot drill bedrock', async ({ page }) => {
            await load(page, [
                '..........',
                '..........',
                '..........',
                '....@.....',
                '==========',
                '==========',
            ]);
            expect(await page.evaluate(() => digRight())).toBe(false);
            expect(await page.evaluate(() => tileAt(5, 4))).toBe('solid');
        });

        test('cannot drill through a blocked cell above the target', async ({ page }) => {
            await load(page, [
                '..........',
                '..........',
                '.....#....',
                '....@#....',
                '##########',
                '==========',
            ]);
            expect(await page.evaluate(() => digRight())).toBe(false);
            expect(await page.evaluate(() => tileAt(5, 4))).toBe('brick');
        });

        test('cannot drill while falling', async ({ page }) => {
            await load(page, DIG);
            await page.evaluate(() => setPlayerCell(4, 0));
            await advance(page, 4);
            expect(await page.evaluate(() => digRight())).toBe(false);
        });

        test('cannot drill from a ladder', async ({ page }) => {
            await load(page, LADDERS);
            await page.evaluate(() => setPlayerCell(4, 3));
            expect(await page.evaluate(() => digRight())).toBe(false);
        });

        test('a hole fills itself back in', async ({ page }) => {
            await load(page, DIG);
            await page.evaluate(() => digRight());
            await advance(page, 60);
            expect(await page.evaluate(() => tileAt(5, 4))).toBe('hole');
            await advance(page, Math.ceil(60 * 6));
            expect(await page.evaluate(() => tileAt(5, 4))).toBe('brick');
            expect(await page.evaluate(() => holes.length)).toBe(0);
        });

        test('the runner can drop into a hole it dug', async ({ page }) => {
            await load(page, DIG);
            await page.evaluate(() => digRight());
            await press(page, 'right');
            await advance(page, 30);
            expect(await cellOf(page)).toMatchObject({ c: 5, r: 4 });
        });

        test('a refilling hole crushes the runner', async ({ page }) => {
            await load(page, DIG);
            await page.evaluate(() => { lives = 3; digRight(); setPlayerCell(5, 4); });
            await advance(page, Math.ceil(60 * 6));
            expect(await page.evaluate(() => lives)).toBe(2);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('a guard closes in on the runner', async ({ page }) => {
            await load(page, CHASE);
            const before = await page.evaluate(() => guards[0].c);
            await advance(page, 60);
            const after = await page.evaluate(() => guards[0].c);
            expect(after).toBeLessThan(before);
        });

        test('a guard falls into a hole and is trapped', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { setPlayerCell(4, 3); digRight(); });
            await advance(page, 90);
            const g = await page.evaluate(() => ({
                c: guards[0].c,
                r: guards[0].r,
                trapped: guards[0].trapped,
            }));
            expect(g).toMatchObject({ c: 5, r: 4, trapped: true });
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { setPlayerCell(4, 3); digRight(); });
            await advance(page, 90);
            expect(await page.evaluate(() => guards[0].trapped)).toBe(true);
            await page.evaluate(() => setPlayerCell(0, 3));
            await advance(page, 180);
            const g = await page.evaluate(() => ({ r: guards[0].r, trapped: guards[0].trapped }));
            expect(g.trapped).toBe(false);
            expect(g.r).toBeLessThan(4);
        });

        test('the runner can stand on a trapped guard', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { setPlayerCell(4, 3); digRight(); });
            await advance(page, 90);
            await page.evaluate(() => setPlayerCell(5, 3));
            await advance(page, 20);
            expect(await cellOf(page)).toMatchObject({ c: 5, r: 3 });
        });

        test('a guard crushed by a refilling hole respawns and scores', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { setPlayerCell(4, 3); digRight(); });
            await advance(page, 60);
            // Park the runner out of reach and stop the guard escaping, so the
            // only thing that can happen next is the brick reforming at t = 5 s.
            await page.evaluate(() => { setPlayerCell(0, 3); guards[0].trapTimer = -99; });
            await advance(page, 245);
            const s = await page.evaluate(() => ({
                score,
                trapped: guards[0].trapped,
                c: guards[0].c,
                r: guards[0].r,
                tile: tileAt(5, 4),
            }));
            expect(s.score).toBe(75);
            expect(s.trapped).toBe(false);
            expect(s.tile).toBe('brick');
            expect({ c: s.c, r: s.r }).toEqual({ c: 7, r: 3 });
        });

        test('being caught costs a life and resets the level', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { lives = 3; setPlayerCell(6, 3); });
            await advance(page, 20);
            const s = await page.evaluate(() => ({ lives, c: player.c, r: player.r }));
            expect(s.lives).toBe(2);
            expect(s).toMatchObject({ c: 1, r: 3 });
        });

        test('losing the last life ends the game', async ({ page }) => {
            await load(page, CHASE);
            await page.evaluate(() => { lives = 1; setPlayerCell(6, 3); });
            await advance(page, 20);
            expect(await page.evaluate(() => state)).toBe('gameover');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Controls and game flow
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            const s = await page.evaluate(() => ({ lives, score, level }));
            expect(s).toEqual({ lives: 3, score: 0, level: 1 });
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            await page.waitForFunction(() => state === 'playing');
        });

        test('arrow keys drive the runner', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('ArrowRight');
            await page.waitForFunction(() => input.right === true);
            await page.keyboard.up('ArrowRight');
            await page.waitForFunction(() => input.right === false);
        });

        test('WASD also drives the runner', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.down('a');
            await page.waitForFunction(() => input.left === true);
            await page.keyboard.up('a');
            await page.waitForFunction(() => input.left === false);
        });

        test('Z and X drill', async ({ page }) => {
            await load(page, [
                '..........',
                '..........',
                '..........',
                '....@.....',
                '##########',
                '==========',
            ]);
            await page.keyboard.press('x');
            await page.waitForFunction(() => tileAt(5, 4) === 'hole');
            await page.keyboard.press('z');
            await page.waitForFunction(() => tileAt(3, 4) === 'hole');
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'paused');
            const before = await cellOf(page);
            await press(page, 'right');
            await advance(page, 60);
            expect(await cellOf(page)).toMatchObject({ c: before.c, r: before.r });
            await press(page, 'right', false);
            await page.keyboard.press('p');
            await page.waitForFunction(() => state === 'playing');
        });

        test('the HUD reports score, lives and level', async ({ page }) => {
            await page.evaluate(() => startGame());
            await load(page, GOLD);
            await press(page, 'right');
            await advance(page, 30);
            await page.evaluate(() => render());
            await expect(page.locator('#score')).toHaveText('100');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#gold')).toHaveText('1');
        });

        test('the best score is remembered', async ({ page }) => {
            await page.evaluate(() => startGame());
            await load(page, GOLD);
            await press(page, 'right');
            await advance(page, 30);
            await page.evaluate(() => { lives = 1; killPlayer(); });
            expect(await page.evaluate(() => state)).toBe('gameover');
            const best = await page.evaluate(() => localStorage.getItem('loderunner.best'));
            expect(Number(best)).toBe(100);
        });
    });
});
