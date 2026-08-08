const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Small hand-built levels used to put the runner in an exact situation. Each is
// a plain array of strings; `loadLevelLines()` accepts any width/height.
const FLAT = [
    '          ',
    '          ',
    '   P      ',
    '  ####### ',
    '          ',
    '==========',
];

const LADDER = [
    '          ',
    '   H      ',
    '   H      ',
    '   H      ',
    '  PH      ',
    '==========',
];

const BAR = [
    '          ',
    '  ----    ',
    '          ',
    '          ',
    '  P       ',
    '==========',
];

const GOLD = [
    '          ',
    '  P$      ',
    '  ####    ',
    '          ',
    '          ',
    '==========',
];

const ESCAPE = [
    'S         ',
    'S         ',
    'SP $      ',
    'S###      ',
    '          ',
    '==========',
];

const GUARD = [
    '          ',
    '          ',
    '   P  G   ',
    '  ####### ',
    '          ',
    '==========',
];

test.describe('Lode Runner', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        // Freeze the requestAnimationFrame driver so every test advances the
        // simulation itself through step(dt) — no wall-clock dependence.
        await page.evaluate(() => setAutoStep(false));
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Lode Runner', async ({ page }) => {
            await expect(page).toHaveTitle('Lode Runner');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x360', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '360');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('lode-runner-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
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

        test('game starts on level 1 with full lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, lives, score, START_LIVES };
            });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(s.START_LIVES);
            expect(s.score).toBe(0);
        });

        test('the runner spawns on the level P tile', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { player: { c: player.c, r: player.r }, spawn: playerSpawn };
            });
            expect(s.player).toEqual({ c: s.spawn.c, r: s.spawn.r });
        });

        test('level 1 has gold to collect and the exit is closed', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { goldRemaining, exitOpen };
            });
            expect(s.goldRemaining).toBeGreaterThan(0);
            expect(s.exitOpen).toBe(false);
        });

        test('level 1 has at least one guard', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return guards.length; })).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Level parsing
    // -----------------------------------------------------------------------
    test.describe('level parsing', () => {
        test('grid dimensions follow the loaded lines', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                return { COLS, ROWS };
            }, FLAT);
            expect(s).toEqual({ COLS: 10, ROWS: 6 });
        });

        test('characters map onto the right tiles', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                return {
                    empty: tileAt(0, 0) === TILE.EMPTY,
                    brick: tileAt(3, 3) === TILE.BRICK,
                    solid: tileAt(0, 5) === TILE.SOLID,
                    spawnIsEmpty: tileAt(3, 2) === TILE.EMPTY,
                };
            }, FLAT);
            expect(s).toEqual({ empty: true, brick: true, solid: true, spawnIsEmpty: true });
        });

        test('gold tiles are counted', async ({ page }) => {
            expect(await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                return goldRemaining;
            }, GOLD)).toBe(1);
        });

        test('hidden exit ladders read as empty until the exit opens', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const closed = tileAt(0, 1);
                exitOpen = true;
                return { closed, open: tileAt(0, 1), EMPTY: TILE.EMPTY, LADDER: TILE.LADDER };
            }, ESCAPE);
            expect(s.closed).toBe(s.EMPTY);
            expect(s.open).toBe(s.LADDER);
        });

        test('guards spawn on the G tiles', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                return guards.map((g) => ({ c: g.c, r: g.r }));
            }, GUARD);
            expect(s).toEqual([{ c: 6, r: 2 }]);
        });
    });

    // -----------------------------------------------------------------------
    // Running and climbing
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('holding right runs right', async ({ page }) => {
            const c = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
                for (let i = 0; i < 40; i++) step(0.016);
                return player.c;
            }, FLAT);
            expect(c).toBeGreaterThan(3);
        });

        test('holding left runs left', async ({ page }) => {
            const c = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(-1, 0);
                for (let i = 0; i < 40; i++) step(0.016);
                return player.c;
            }, FLAT);
            expect(c).toBeLessThan(3);
        });

        test('the runner cannot walk through a brick', async ({ page }) => {
            const c = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                // wall the runner in on the right at its own height
                grid[2][4] = TILE.BRICK;
                setInput(1, 0);
                for (let i = 0; i < 60; i++) step(0.016);
                return player.c;
            }, FLAT);
            expect(c).toBe(3);
        });

        test('the runner cannot leave the grid', async ({ page }) => {
            const c = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(-1, 0);
                for (let i = 0; i < 400; i++) step(0.016);
                return player.c;
            }, FLAT);
            expect(c).toBe(0);
        });

        test('the runner falls when nothing is underneath', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(9, 0);
                const start = player.r;
                for (let i = 0; i < 10; i++) step(0.016);
                return { start, after: player.r, falling: player.falling };
            }, FLAT);
            expect(s.after).toBeGreaterThan(s.start);
            expect(s.falling).toBe(true);
        });

        test('a fall stops on top of solid ground', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(9, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return player.r;
            }, FLAT);
            expect(r).toBe(4); // resting on the bedrock row 5
        });

        test('there is no steering while falling', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(9, 0);
                setInput(-1, 0);
                for (let i = 0; i < 8; i++) step(0.016);
                return { c: player.c, falling: player.falling };
            }, FLAT);
            expect(s.falling).toBe(true);
            expect(s.c).toBe(9);
        });

        test('the runner climbs up a ladder', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(3, 4);
                setInput(0, -1);
                for (let i = 0; i < 40; i++) step(0.016);
                return player.r;
            }, LADDER);
            expect(r).toBeLessThan(4);
        });

        test('the runner climbs down a ladder', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(3, 1);
                setInput(0, 1);
                for (let i = 0; i < 40; i++) step(0.016);
                return player.r;
            }, LADDER);
            expect(r).toBeGreaterThan(1);
        });

        test('a ladder holds the runner up', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(3, 1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { r: player.r, falling: player.falling };
            }, LADDER);
            expect(s).toEqual({ r: 1, falling: false });
        });

        test('the runner cannot climb without a ladder', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return player.r;
            }, FLAT);
            expect(r).toBe(2);
        });

        test('a bar holds the runner up', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(3, 1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { r: player.r, falling: player.falling };
            }, BAR);
            expect(s).toEqual({ r: 1, falling: false });
        });

        test('the runner slides along a bar', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(2, 1);
                setInput(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { c: player.c, r: player.r };
            }, BAR);
            expect(s.c).toBeGreaterThan(2);
            expect(s.r).toBe(1);
        });

        test('pressing down drops off a bar', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(3, 1);
                setInput(0, 1);
                for (let i = 0; i < 60; i++) step(0.016);
                return player.r;
            }, BAR);
            expect(r).toBe(4);
        });
    });

    // -----------------------------------------------------------------------
    // Gold and the exit
    // -----------------------------------------------------------------------
    test.describe('gold', () => {
        test('running over gold collects it and scores', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                score = 0;
                setInput(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { score, goldRemaining, tile: tileAt(3, 1), EMPTY: TILE.EMPTY };
            }, GOLD);
            expect(s.goldRemaining).toBe(0);
            expect(s.score).toBeGreaterThan(0);
            expect(s.tile).toBe(s.EMPTY);
        });

        test('the HUD shows the gold left', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, GOLD);
            await expect(page.locator('#gold')).toHaveText('1');
        });

        test('collecting the last gold opens the exit', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { exitOpen, ladder: tileAt(3, 1) === TILE.LADDER };
            }, GOLD);
            expect(s.exitOpen).toBe(true);
        });

        test('hidden ladders become climbable once the exit opens', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
                for (let i = 0; i < 30; i++) step(0.016);
                return { exitOpen, tile: tileAt(0, 2), LADDER: TILE.LADDER };
            }, ESCAPE);
            expect(s.exitOpen).toBe(true);
            expect(s.tile).toBe(s.LADDER);
        });
    });

    // -----------------------------------------------------------------------
    // Digging
    // -----------------------------------------------------------------------
    test.describe('digging', () => {
        test('digging right removes the brick below-right', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const ok = dig(1);
                return { ok, tile: tileAt(4, 3), holes: holes.length, EMPTY: TILE.EMPTY };
            }, FLAT);
            expect(s.ok).toBe(true);
            expect(s.tile).toBe(s.EMPTY);
            expect(s.holes).toBe(1);
        });

        test('digging left removes the brick below-left', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const ok = dig(-1);
                return { ok, tile: tileAt(2, 3), EMPTY: TILE.EMPTY };
            }, FLAT);
            expect(s.ok).toBe(true);
            expect(s.tile).toBe(s.EMPTY);
        });

        test('solid stone cannot be dug', async ({ page }) => {
            const ok = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                grid[3][4] = TILE.SOLID;
                return dig(1);
            }, FLAT);
            expect(ok).toBe(false);
        });

        test('nothing to dig means no hole', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(9, 4); // standing on bedrock, empty either side
                const ok = dig(1);
                return { ok, holes: holes.length };
            }, FLAT);
            expect(s).toEqual({ ok: false, holes: 0 });
        });

        test('a blocked side stops the dig', async ({ page }) => {
            const ok = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                grid[2][4] = TILE.BRICK; // wall right of the runner
                return dig(1);
            }, FLAT);
            expect(ok).toBe(false);
        });

        test('you cannot dig from a ladder', async ({ page }) => {
            const ok = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                grid[5][4] = TILE.BRICK;
                setPlayerCell(3, 4); // on the ladder foot
                return dig(1);
            }, LADDER);
            expect(ok).toBe(false);
        });

        test('you cannot dig while falling', async ({ page }) => {
            const ok = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setPlayerCell(9, 1);
                step(0.016);
                grid[2][8] = TILE.BRICK;
                return dig(-1);
            }, FLAT);
            expect(ok).toBe(false);
        });

        test('a hole fills itself back in', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(1);
                setPlayerCell(0, 4); // out of the way of the refill
                for (let i = 0; i < Math.ceil((HOLE_TIME + 0.5) / 0.016); i++) step(0.016);
                return { tile: tileAt(4, 3), holes: holes.length, BRICK: TILE.BRICK };
            }, FLAT);
            expect(s.tile).toBe(s.BRICK);
            expect(s.holes).toBe(0);
        });

        test('a hole is still open just before it fills', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(1);
                for (let i = 0; i < Math.floor((HOLE_TIME - 0.5) / 0.016); i++) step(0.016);
                return { tile: tileAt(4, 3), EMPTY: TILE.EMPTY };
            }, FLAT);
            expect(s.tile).toBe(s.EMPTY);
        });

        test('the runner is crushed by a hole filling in on top of them', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const before = lives;
                dig(1);
                setPlayerCell(4, 3); // drop into the fresh hole
                for (let i = 0; i < Math.ceil((HOLE_TIME + 0.5) / 0.016); i++) step(0.016);
                return { before, after: lives };
            }, FLAT);
            expect(s.after).toBe(s.before - 1);
        });
    });

    // -----------------------------------------------------------------------
    // Guards
    // -----------------------------------------------------------------------
    test.describe('guards', () => {
        test('a guard closes in on the runner', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const before = Math.abs(guards[0].c - player.c);
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: Math.abs(guards[0].c - player.c) };
            }, GUARD);
            expect(s.after).toBeLessThan(s.before);
        });

        test('a guard falls when the floor goes away', async ({ page }) => {
            const r = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                grid[3][6] = TILE.EMPTY;
                for (let i = 0; i < 20; i++) step(0.016);
                return guards[0].r;
            }, GUARD);
            expect(r).toBeGreaterThan(2);
        });

        test('a guard walks into a hole and is trapped', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                score = 0;
                dig(1); // hole at column 4 of the floor
                for (let i = 0; i < 300 && !guards[0].trapped; i++) step(0.016);
                return { trapped: guards[0].trapped, c: guards[0].c, r: guards[0].r, score };
            }, GUARD);
            expect(s.trapped).toBe(true);
            expect(s).toMatchObject({ c: 4, r: 3 });
            expect(s.score).toBeGreaterThan(0);
        });

        test('a trapped guard is safe to stand on', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(1);
                for (let i = 0; i < 300 && !guards[0].trapped; i++) step(0.016);
                const before = lives;
                setPlayerCell(4, 2); // right on the trapped guard's head
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: lives, supported: isSupported(4, 2) };
            }, GUARD);
            expect(s.after).toBe(s.before);
            expect(s.supported).toBe(true);
        });

        test('a trapped guard climbs back out', async ({ page }) => {
            const trapped = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(1);
                for (let i = 0; i < 300 && !guards[0].trapped; i++) step(0.016);
                setPlayerCell(0, 4); // stay clear so the escape is not a collision
                for (let i = 0; i < Math.ceil((GUARD_TRAP_TIME + 1) / 0.016); i++) {
                    if (!guards[0].trapped) break;
                    step(0.016);
                }
                return guards[0].trapped;
            }, GUARD);
            expect(trapped).toBe(false);
        });

        test('a guard buried by a refilling hole respawns', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(1);
                for (let i = 0; i < 300 && !guards[0].trapped; i++) step(0.016);
                setPlayerCell(0, 4);
                // age the hole so the brick grows back before the guard can climb out
                holes[0].timer = HOLE_TIME - 0.3;
                const scoreBefore = score;
                for (let i = 0; i < Math.ceil(0.6 / 0.016) && holes.length; i++) step(0.016);
                return {
                    scoreBefore,
                    score,
                    spawn: guards[0].spawn,
                    at: { c: guards[0].c, r: guards[0].r },
                    trapped: guards[0].trapped,
                };
            }, GUARD);
            expect(s.score).toBeGreaterThan(s.scoreBefore);
            expect(s.trapped).toBe(false);
            expect(s.at).toEqual({ c: s.spawn.c, r: s.spawn.r });
        });

        test('being caught by a guard costs a life', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const before = lives;
                for (let i = 0; i < 400 && lives === before; i++) step(0.016);
                return { before, after: lives };
            }, GUARD);
            expect(s.after).toBe(s.before - 1);
        });

        test('a death puts everyone back at their spawn', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const before = lives;
                for (let i = 0; i < 400 && lives === before; i++) step(0.016);
                return {
                    player: { c: player.c, r: player.r },
                    spawn: playerSpawn,
                    guard: { c: guards[0].c, r: guards[0].r },
                    guardSpawn: guards[0].spawn,
                };
            }, GUARD);
            expect(s.player).toEqual({ c: s.spawn.c, r: s.spawn.r });
            expect(s.guard).toEqual({ c: s.guardSpawn.c, r: s.guardSpawn.r });
        });

        test('a death fills in any open holes', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                dig(-1);
                const before = lives;
                for (let i = 0; i < 400 && lives === before; i++) step(0.016);
                return { holes: holes.length, tile: tileAt(2, 3), BRICK: TILE.BRICK };
            }, GUARD);
            expect(s.holes).toBe(0);
            expect(s.tile).toBe(s.BRICK);
        });

        test('collected gold stays collected after a death', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                grid[2][4] = TILE.GOLD;
                goldRemaining = 1;
                setInput(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                const afterPickup = goldRemaining;
                setInput(0, 0);
                const before = lives;
                for (let i = 0; i < 600 && lives === before; i++) step(0.016);
                return { afterPickup, goldRemaining, scoreKept: score > 0 };
            }, GUARD);
            expect(s.afterPickup).toBe(0);
            expect(s.goldRemaining).toBe(0);
            expect(s.scoreKept).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Escaping / level progression
    // -----------------------------------------------------------------------
    test.describe('escaping', () => {
        test('reaching the top row with the exit open clears the level', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                exitOpen = true;
                goldRemaining = 0;
                const before = level;
                setPlayerCell(0, 1);
                setInput(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: level };
            }, ESCAPE);
            expect(s.after).toBe(s.before + 1);
        });

        test('the top row does nothing while gold is still out there', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                const before = level;
                setPlayerCell(4, 0);
                step(0.016);
                return { before, after: level, state };
            }, ESCAPE);
            expect(s.after).toBe(s.before);
            expect(s.state).toBe('running');
        });

        test('clearing the last level wins the game', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                level = LEVELS.length;
                loadLevelLines(lines);
                exitOpen = true;
                goldRemaining = 0;
                setPlayerCell(0, 1);
                setInput(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return state;
            }, ESCAPE);
            expect(s).toBe('won');
        });

        test('clearing a level loads the next one', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                exitOpen = true;
                goldRemaining = 0;
                setPlayerCell(0, 1);
                setInput(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { level, exitOpen, goldRemaining, COLS };
            }, ESCAPE);
            expect(s.level).toBe(2);
            expect(s.exitOpen).toBe(false);
            expect(s.goldRemaining).toBeGreaterThan(0);
            expect(s.COLS).toBe(30);
        });
    });

    // -----------------------------------------------------------------------
    // Lives, game over, best score
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                lives = 1;
                for (let i = 0; i < 400 && state === 'running'; i++) step(0.016);
                return { state, lives };
            }, GUARD);
            expect(s.state).toBe('gameover');
            expect(s.lives).toBe(0);
        });

        test('the overlay comes back on game over', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                lives = 1;
                for (let i = 0; i < 400 && state === 'running'; i++) step(0.016);
            }, GUARD);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            const stored = await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                lives = 1;
                score = 1234;
                for (let i = 0; i < 400 && state === 'running'; i++) step(0.016);
                return window.localStorage.getItem('lode-runner-best');
            }, GUARD);
            expect(Number(stored)).toBeGreaterThanOrEqual(1234);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                lives = 1;
                for (let i = 0; i < 400 && state === 'running'; i++) step(0.016);
            }, GUARD);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, level, score, lives }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Controls
    // -----------------------------------------------------------------------
    test.describe('controls', () => {
        test('arrow keys steer the runner', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, FLAT);
            await page.keyboard.down('ArrowRight');
            const c = await page.evaluate(() => {
                for (let i = 0; i < 40; i++) step(0.016);
                return player.c;
            });
            await page.keyboard.up('ArrowRight');
            expect(c).toBeGreaterThan(3);
        });

        test('releasing a key stops the runner', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, FLAT);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const s = await page.evaluate(() => {
                const before = player.c;
                for (let i = 0; i < 40; i++) step(0.016);
                return { before, after: player.c };
            });
            expect(s.after).toBe(s.before);
        });

        test('WASD also steers the runner', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, FLAT);
            await page.keyboard.down('a');
            const c = await page.evaluate(() => {
                for (let i = 0; i < 40; i++) step(0.016);
                return player.c;
            });
            await page.keyboard.up('a');
            expect(c).toBeLessThan(3);
        });

        test('Z digs left and X digs right', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
            }, FLAT);
            await page.keyboard.press('z');
            await page.keyboard.press('x');
            const s = await page.evaluate(() => ({
                left: tileAt(2, 3), right: tileAt(4, 3), EMPTY: TILE.EMPTY,
            }));
            expect(s.left).toBe(s.EMPTY);
            expect(s.right).toBe(s.EMPTY);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused game does not move', async ({ page }) => {
            await page.evaluate((lines) => {
                startGame();
                loadLevelLines(lines);
                setInput(1, 0);
                togglePause();
                for (let i = 0; i < 60; i++) step(0.016);
            }, FLAT);
            expect(await page.evaluate(() => player.c)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Built-in levels
    // -----------------------------------------------------------------------
    test.describe('built-in levels', () => {
        test('there are three levels, all rectangular', async ({ page }) => {
            const s = await page.evaluate(() => LEVELS.map((lines) => ({
                rows: lines.length,
                widths: [...new Set(lines.map((l) => l.length))],
            })));
            expect(s.length).toBe(3);
            for (const lvl of s) {
                expect(lvl.rows).toBe(18);
                expect(lvl.widths).toEqual([30]);
            }
        });

        test('every level has one runner, gold and guards', async ({ page }) => {
            const s = await page.evaluate(() => LEVELS.map((lines) => {
                const flat = lines.join('');
                return {
                    p: (flat.match(/P/g) || []).length,
                    gold: (flat.match(/\$/g) || []).length,
                    guards: (flat.match(/G/g) || []).length,
                };
            }));
            for (const lvl of s) {
                expect(lvl.p).toBe(1);
                expect(lvl.gold).toBeGreaterThanOrEqual(4);
                expect(lvl.guards).toBeGreaterThanOrEqual(1);
            }
        });

        test('every actor starts on firm footing', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const problems = [];
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    if (!isSupported(player.c, player.r)) problems.push(`L${i} runner`);
                    guards.forEach((g, n) => {
                        if (!isSupported(g.c, g.r)) problems.push(`L${i} guard ${n}`);
                    });
                }
                return problems;
            });
            expect(bad).toEqual([]);
        });

        test('every piece of gold can be reached from the spawn', async ({ page }) => {
            const bad = await page.evaluate(() => {
                // Flood the level with the same movement rules the runner obeys:
                // an unsupported cell can only fall, a supported one can step
                // sideways, climb a ladder, or drop.
                function flood() {
                    const seen = new Set();
                    const queue = [[player.c, player.r]];
                    const push = (c, r) => {
                        if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
                        const t = tileAt(c, r);
                        if (t === TILE.BRICK || t === TILE.SOLID) return;
                        const k = c + ',' + r;
                        if (!seen.has(k)) { seen.add(k); queue.push([c, r]); }
                    };
                    push(player.c, player.r);
                    while (queue.length) {
                        const [c, r] = queue.pop();
                        if (!isSupported(c, r)) { push(c, r + 1); continue; }
                        push(c - 1, r);
                        push(c + 1, r);
                        push(c, r + 1);
                        if (tileAt(c, r) === TILE.LADDER) push(c, r - 1);
                    }
                    return seen;
                }

                const problems = [];
                for (let i = 1; i <= LEVELS.length; i++) {
                    loadLevel(i);
                    let seen = flood();
                    for (let r = 0; r < ROWS; r++) {
                        for (let c = 0; c < COLS; c++) {
                            if (tileAt(c, r) === TILE.GOLD && !seen.has(c + ',' + r)) {
                                problems.push(`L${i} gold ${c},${r}`);
                            }
                        }
                    }
                    // and with the exit open the top row must be climbable
                    exitOpen = true;
                    seen = flood();
                    if (![...seen].some((k) => k.endsWith(',0'))) problems.push(`L${i} exit`);
                }
                return problems;
            });
            expect(bad).toEqual([]);
        });
    });
});
