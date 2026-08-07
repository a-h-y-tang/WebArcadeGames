const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

/**
 * Every test drives the simulation through the same `step(dt)` the real
 * animation loop uses, so nothing depends on requestAnimationFrame wall-clock
 * timing. Tests that only care about the burger usually clear `enemies` first
 * so a wandering Mr. Hot Dog cannot end the run mid-assertion.
 */
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

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the tile grid', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '512');
        });

        test('HUD starts at zero score, level 1, 3 lives, 5 pepper', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#pepper')).toHaveText('5');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('burgertime-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // The level map
    // -----------------------------------------------------------------------
    test.describe('level map', () => {
        test('map is COLS x ROWS characters', async ({ page }) => {
            const shape = await page.evaluate(() => ({
                rows: MAP.length,
                widths: [...new Set(MAP.map((r) => r.length))],
                COLS,
                ROWS,
            }));
            expect(shape.rows).toBe(shape.ROWS);
            expect(shape.widths).toEqual([shape.COLS]);
        });

        test('every floor row is walkable across the play field', async ({ page }) => {
            const ok = await page.evaluate(() =>
                FLOOR_ROWS.every((r) => {
                    for (let c = FLOOR_MIN_COL; c <= FLOOR_MAX_COL; c++) {
                        if (!isFloor(c, r)) return false;
                    }
                    return true;
                })
            );
            expect(ok).toBe(true);
        });

        test('rows between floors are not walkable', async ({ page }) => {
            const anyFloor = await page.evaluate(() => isFloor(9, FLOOR_ROWS[0] + 1));
            expect(anyFloor).toBe(false);
        });

        test('each ladder segment is continuous from top floor to bottom floor', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LADDER_SEGMENTS.every((seg) =>
                    seg.cols.every((c) => {
                        for (let r = seg.top; r <= seg.bottom; r++) {
                            if (!isLadder(c, r)) return false;
                        }
                        return true;
                    })
                )
            );
            expect(ok).toBe(true);
        });

        test('ladders never run through a burger stack', async ({ page }) => {
            const clash = await page.evaluate(() =>
                LADDER_SEGMENTS.some((seg) =>
                    seg.cols.some((c) =>
                        STACK_COLS.some((s) => c >= s && c < s + STACK_W)
                    )
                )
            );
            expect(clash).toBe(false);
        });

        test('every walkable cell is reachable from the chef spawn', async ({ page }) => {
            // Without this, a burger could sit on a girder no ladder ever reaches
            // and the level would be impossible to finish.
            const unreachable = await page.evaluate(() => {
                const key = (c, r) => `${c},${r}`;
                const seen = new Set([key(PLAYER_SPAWN.col, PLAYER_SPAWN.row)]);
                const queue = [{ col: PLAYER_SPAWN.col, row: PLAYER_SPAWN.row }];
                while (queue.length) {
                    const { col, row } = queue.shift();
                    const next = [];
                    if (isFloor(col - 1, row)) next.push({ col: col - 1, row });
                    if (isFloor(col + 1, row)) next.push({ col: col + 1, row });
                    const up = segmentAbove(col, row);
                    if (up) next.push({ col, row: up.top });
                    const down = segmentBelow(col, row);
                    if (down) next.push({ col, row: down.bottom });
                    for (const n of next) {
                        if (seen.has(key(n.col, n.row))) continue;
                        seen.add(key(n.col, n.row));
                        queue.push(n);
                    }
                }
                const missed = [];
                for (const r of FLOOR_ROWS) {
                    for (let c = FLOOR_MIN_COL; c <= FLOOR_MAX_COL; c++) {
                        if (!seen.has(key(c, r))) missed.push(key(c, r));
                    }
                }
                return missed;
            });
            expect(unreachable).toEqual([]);
        });

        test('every ingredient starts on a girder above the plate', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return ingredients.every(
                    (i) => FLOOR_ROWS.includes(i.row) && i.row < PLATE_ROW
                );
            });
            expect(ok).toBe(true);
        });

        test('out-of-bounds cells are neither floor nor ladder', async ({ page }) => {
            const res = await page.evaluate(() => ({
                a: isFloor(-1, 2),
                b: isFloor(COLS, 2),
                c: isLadder(5, -1),
                d: isLadder(5, ROWS),
            }));
            expect(res).toEqual({ a: false, b: false, c: false, d: false });
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh game has 3 burgers of 4 ingredients, all resting', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return {
                    total: ingredients.length,
                    stacks: STACK_COLS.length,
                    kinds: ING_KINDS.length,
                    resting: ingredients.filter((i) => i.state === 'rest').length,
                    plated: ingredients.filter((i) => i.state === 'plated').length,
                };
            });
            expect(s.total).toBe(s.stacks * s.kinds);
            expect(s.resting).toBe(s.total);
            expect(s.plated).toBe(0);
        });

        test('each stack holds one of every ingredient, ordered top to bottom', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return STACK_COLS.every((_, s) => {
                    const stack = ingredients
                        .filter((i) => i.stack === s)
                        .sort((a, b) => a.row - b.row);
                    if (stack.length !== ING_KINDS.length) return false;
                    return stack.every((ing, idx) => ing.kind === ING_KINDS[idx]);
                });
            });
            expect(ok).toBe(true);
        });

        test('no two ingredients in a stack share a starting row', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                return STACK_COLS.every((_, s) => {
                    const rows = ingredients.filter((i) => i.stack === s).map((i) => i.row);
                    return new Set(rows).size === rows.length;
                });
            });
            expect(ok).toBe(true);
        });

        test('enemies spawn on the grid', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { count: enemies.length, kinds: enemies.map((e) => e.kind) };
            });
            expect(s.count).toBeGreaterThanOrEqual(3);
            expect(s.kinds.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
        });

        test('the chef starts standing on a floor inside the play field', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                return {
                    mode: player.mode,
                    onFloor: FLOOR_ROWS.includes(rowOf(player.y)),
                    inField: player.x > 0 && player.x < CANVAS_W,
                };
            });
            expect(p.mode).toBe('floor');
            expect(p.onFloor).toBe(true);
            expect(p.inField).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Chef movement
    // -----------------------------------------------------------------------
    test.describe('chef movement', () => {
        test('walking right increases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(9, 14);
                const before = player.x;
                setPlayerDir(1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('walking left decreases x', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(9, 14);
                const before = player.x;
                setPlayerDir(-1, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(d.after).toBeLessThan(d.before);
        });

        test('the chef cannot walk off the left end of a floor', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(2, 14);
                setPlayerDir(-1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(32);
        });

        test('the chef cannot walk off the right end of a floor', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(16, 14);
                setPlayerDir(1, 0);
                for (let i = 0; i < 600; i++) step(0.016);
                return { x: player.x, limit: (FLOOR_MAX_COL + 1) * TILE };
            });
            expect(d.x).toBeLessThanOrEqual(d.limit);
        });

        test('the chef climbs up a ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const seg = LADDER_SEGMENTS[LADDER_SEGMENTS.length - 1];
                placePlayer(seg.cols[0], seg.bottom);
                const before = player.y;
                setPlayerDir(0, -1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.y, mode: player.mode };
            });
            expect(d.after).toBeLessThan(d.before);
            expect(d.mode).toBe('ladder');
        });

        test('climbing stops on a floor at the top of the ladder shaft', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const seg = LADDER_SEGMENTS[LADDER_SEGMENTS.length - 1];
                placePlayer(seg.cols[0], seg.bottom);
                setPlayerDir(0, -1);
                for (let i = 0; i < 400; i++) step(0.016);
                return {
                    y: player.y,
                    mode: player.mode,
                    onFloor: FLOOR_ROWS.includes(rowOf(player.y)) && player.y % TILE === 0,
                    ceiling: floorYOf(FLOOR_ROWS[0]),
                    startY: floorYOf(seg.bottom),
                };
            });
            expect(d.mode).toBe('floor');
            expect(d.onFloor).toBe(true);
            expect(d.y).toBeGreaterThanOrEqual(d.ceiling);
            expect(d.y).toBeLessThan(d.startY);
        });

        test('the chef climbs back down a ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const seg = LADDER_SEGMENTS[0];
                placePlayer(seg.cols[0], seg.top);
                const before = player.y;
                setPlayerDir(0, 1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.y };
            });
            expect(d.after).toBeGreaterThan(d.before);
        });

        test('the chef cannot climb where there is no ladder', async ({ page }) => {
            const d = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // column 9 sits inside a burger stack, so no ladder passes through it
                placePlayer(9, 14);
                const before = player.y;
                setPlayerDir(0, -1);
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: player.y, mode: player.mode };
            });
            expect(d.after).toBe(d.before);
            expect(d.mode).toBe('floor');
        });

        test('the chef never leaves the floor/ladder network', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const dirs = [[1, 0], [0, -1], [-1, 0], [0, 1], [1, 0], [0, 1]];
                for (const [dx, dy] of dirs) {
                    setPlayerDir(dx, dy);
                    for (let i = 0; i < 150; i++) {
                        step(0.016);
                        if (player.x < 0 || player.x > CANVAS_W) return false;
                        if (player.y < 0 || player.y > CANVAS_H) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('ArrowRight moves the chef right', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(9, 14);
            });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 20; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('releasing the key stops the chef', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                placePlayer(9, 14);
            });
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const before = await page.evaluate(() => player.x);
            await page.evaluate(() => { for (let i = 0; i < 30; i++) step(0.016); });
            const after = await page.evaluate(() => player.x);
            expect(after).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Ingredients
    // -----------------------------------------------------------------------
    test.describe('ingredients', () => {
        test('walking onto a segment presses it down', async ({ page }) => {
            const segs = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0);
                placePlayer(STACK_COLS[0], ing.row);
                step(0.016);
                return ing.segs.slice();
            });
            expect(segs[0]).toBe(true);
            expect(segs[3]).toBe(false);
        });

        test('the chef must cross all four segments before it falls', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0);
                placePlayer(STACK_COLS[0], ing.row);
                setPlayerDir(1, 0);
                // stop two segments in: not enough to drop it
                for (let i = 0; i < 30; i++) step(0.016);
                const midway = { state: ing.state, pressed: ing.segs.filter(Boolean).length };
                setPlayerDir(0, 0);
                return midway;
            });
            expect(r.state).toBe('rest');
            expect(r.pressed).toBeGreaterThan(0);
            expect(r.pressed).toBeLessThan(4);
        });

        test('crossing the whole ingredient drops it a level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0);
                const startRow = ing.row;
                placePlayer(STACK_COLS[0], startRow);
                setPlayerDir(1, 0);
                for (let i = 0; i < 240; i++) step(0.016);
                return { startRow, row: ing.row, state: ing.state };
            });
            expect(r.row).toBeGreaterThan(r.startRow);
            expect(['rest', 'plated']).toContain(r.state);
        });

        test('a falling ingredient moves downward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0);
                dropPile(0, ing.row);
                const before = ing.y;
                step(0.016);
                return { before, after: ing.y, state: ing.state };
            });
            expect(r.state).toBe('fall');
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('a dropped ingredient lands on the next floor down', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                // pick a stack row whose next floor down is empty
                const target = ingredients.find(
                    (i) => !ingredients.some((o) => o.stack === i.stack && o.row === nextFloorBelow(i.row))
                        && nextFloorBelow(i.row) !== PLATE_ROW
                );
                const expected = nextFloorBelow(target.row);
                dropPile(target.stack, target.row);
                for (let i = 0; i < 300; i++) step(0.016);
                return { row: target.row, expected, state: target.state };
            });
            expect(r.row).toBe(r.expected);
            expect(r.state).toBe('rest');
        });

        test('landing on a resting ingredient knocks that one down too', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const upper = ingredients.find((i) =>
                    ingredients.some((o) => o.stack === i.stack && o.row === nextFloorBelow(i.row))
                );
                const lower = ingredients.find(
                    (o) => o.stack === upper.stack && o.row === nextFloorBelow(upper.row)
                );
                const lowerStart = lower.row;
                dropPile(upper.stack, upper.row);
                for (let i = 0; i < 400; i++) step(0.016);
                return { lowerStart, lowerRow: lower.row, upperRow: upper.row };
            });
            expect(r.lowerRow).toBeGreaterThan(r.lowerStart);
            expect(r.upperRow).toBeGreaterThan(r.lowerStart);
        });

        test('a knocked-down ingredient has its segments reset', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0);
                ing.segs = [true, true, true, false];
                dropPile(0, ing.row);
                for (let i = 0; i < 400; i++) step(0.016);
                return ing.segs.filter(Boolean).length;
            });
            expect(pressed).toBe(0);
        });

        test('dropping an ingredient scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                const ing = ingredients.find((i) => i.stack === 0);
                dropPile(0, ing.row);
                for (let i = 0; i < 400; i++) step(0.016);
                return { before, after: score };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('an ingredient reaching the plate row becomes plated', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.kind === 'bunBottom');
                // shove it straight onto the plate
                ing.row = FLOOR_ROWS[FLOOR_ROWS.indexOf(PLATE_ROW) - 1];
                ing.y = floorYOf(ing.row) - ING_H;
                dropPile(0, ing.row);
                for (let i = 0; i < 400; i++) step(0.016);
                return { state: ing.state, row: ing.row };
            });
            expect(r.state).toBe('plated');
            expect(r.row).toBe(14);
        });

        test('plated ingredients cannot be stepped on again', async ({ page }) => {
            const pressed = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const ing = ingredients.find((i) => i.stack === 0 && i.kind === 'bunBottom');
                ing.state = 'plated';
                ing.row = PLATE_ROW;
                placePlayer(STACK_COLS[0], PLATE_ROW);
                setPlayerDir(1, 0);
                for (let i = 0; i < 200; i++) step(0.016);
                return ing.segs.filter(Boolean).length;
            });
            expect(pressed).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pepper
    // -----------------------------------------------------------------------
    test.describe('pepper', () => {
        test('spraying pepper uses one shaker', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = pepper;
                sprayPepper();
                return { before, after: pepper, clouds: peppers.length };
            });
            expect(r.after).toBe(r.before - 1);
            expect(r.clouds).toBe(1);
        });

        test('pepper cannot be sprayed when the shaker is empty', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                pepper = 0;
                sprayPepper();
                return { pepper, clouds: peppers.length };
            });
            expect(r.pepper).toBe(0);
            expect(r.clouds).toBe(0);
        });

        test('the Space key sprays pepper while playing', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => pepper);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => pepper);
            expect(after).toBe(before - 1);
        });

        test('an enemy caught in the cloud is stunned', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                player.face = 1;
                const e = placeEnemy(enemies[0], 10, 14);
                sprayPepper();
                step(0.016);
                return { stunned: e.stun > 0 };
            });
            expect(r.stunned).toBe(true);
        });

        test('a stunned enemy holds still and is harmless', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                player.face = 1;
                const e = placeEnemy(enemies[0], 10, 14);
                sprayPepper();
                step(0.016);
                const before = e.x;
                const livesBefore = lives;
                for (let i = 0; i < 30; i++) step(0.016);
                return { moved: Math.abs(e.x - before), livesBefore, lives };
            });
            expect(r.moved).toBeLessThan(0.001);
            expect(r.lives).toBe(r.livesBefore);
        });

        test('the stun wears off', async ({ page }) => {
            const stunned = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                player.face = 1;
                const e = placeEnemy(enemies[0], 10, 14);
                sprayPepper();
                for (let i = 0; i < 600; i++) step(0.016);
                return e.stun > 0;
            });
            expect(stunned).toBe(false);
        });

        test('peppering an enemy scores points', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                player.face = 1;
                const before = score;
                const e = placeEnemy(enemies[0], 10, 14);
                sprayPepper();
                step(0.016);
                return { before, after: score };
            });
            expect(r.after).toBeGreaterThan(r.before);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('enemies move around the level', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                player.x = -500; // park the chef far away so nothing collides
                const start = enemies.map((e) => ({ x: e.x, y: e.y }));
                for (let i = 0; i < 200; i++) step(0.016);
                return enemies.some((e, i) =>
                    Math.abs(e.x - start[i].x) > 1 || Math.abs(e.y - start[i].y) > 1
                );
            });
            expect(moved).toBe(true);
        });

        test('enemies stay on the floor/ladder network', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                player.x = -500;
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    for (const e of enemies) {
                        if (e.x < 0 || e.x > CANVAS_W) return false;
                        if (e.y < 0 || e.y > CANVAS_H) return false;
                    }
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('touching an enemy costs a life', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = lives;
                placePlayer(9, 14);
                placeEnemy(enemies[0], 9, 14);
                step(0.016);
                return { before, after: lives };
            });
            expect(r.after).toBe(r.before - 1);
        });

        test('losing a life respawns the chef with brief invulnerability', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                placeEnemy(enemies[0], 9, 14);
                step(0.016);
                const livesAfterFirst = lives;
                // still overlapping, but invulnerable: no second hit
                for (let i = 0; i < 5; i++) step(0.016);
                return { livesAfterFirst, lives, invuln: player.invuln > 0 };
            });
            expect(r.invuln).toBe(true);
            expect(r.lives).toBe(r.livesAfterFirst);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                lives = 1;
                placePlayer(9, 14);
                placeEnemy(enemies[0], 9, 14);
                step(0.016);
                return { lives, state };
            });
            expect(r.lives).toBe(0);
            expect(r.state).toBe('over');
        });

        test('a falling ingredient squashes an enemy in its path', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.x = -500;
                const before = score;
                const ing = ingredients.find((i) => i.stack === 0);
                const e = placeEnemy(enemies[0], STACK_COLS[0] + 1, nextFloorBelow(ing.row));
                const squashedBefore = e.squashed;
                dropPile(0, ing.row);
                // stop well short of the respawn delay so the flag is still set
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: score, squashedBefore, squashed: e.squashed };
            });
            expect(r.squashedBefore).toBe(false);
            expect(r.squashed).toBe(true);
            expect(r.after).toBeGreaterThanOrEqual(r.before + 500);
        });

        test('a squashed enemy respawns after a delay', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.x = -500;
                const e = enemies[0];
                squashEnemy(e);
                const squashed = e.squashed;
                for (let i = 0; i < 400; i++) step(0.016);
                return { squashed, after: e.squashed, count: enemies.length };
            });
            expect(r.squashed).toBe(true);
            expect(r.after).toBe(false);
            expect(r.count).toBeGreaterThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // Burgers, levels and scoring
    // -----------------------------------------------------------------------
    test.describe('burgers and levels', () => {
        test('a burger is complete when all four ingredients are plated', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const before = burgerComplete(0);
                ingredients
                    .filter((i) => i.stack === 0)
                    .forEach((i) => { i.state = 'plated'; i.row = PLATE_ROW; });
                return { before, after: burgerComplete(0) };
            });
            expect(r.before).toBe(false);
            expect(r.after).toBe(true);
        });

        test('plating every burger clears the level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                const before = score;
                plateEverything();
                step(0.016);
                return { before, after: score, state };
            });
            expect(r.state).toBe('levelclear');
            expect(r.after).toBeGreaterThan(r.before);
        });

        test('advancing to the next level rebuilds the burgers and refills pepper', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                pepper = 0;
                plateEverything();
                step(0.016);
                nextLevel();
                return {
                    level,
                    pepper,
                    resting: ingredients.filter((i) => i.state === 'rest').length,
                    total: ingredients.length,
                    state,
                    enemyCount: enemies.length,
                };
            });
            expect(r.level).toBe(2);
            expect(r.pepper).toBeGreaterThan(0);
            expect(r.resting).toBe(r.total);
            expect(r.state).toBe('running');
            expect(r.enemyCount).toBeGreaterThanOrEqual(3);
        });

        test('a scripted playthrough can serve every burger', async ({ page }) => {
            // Drives the real mechanics only — no state is forced. Repeatedly
            // walks the chef across whichever ingredient is still resting until
            // the level reports itself clear.
            const r = await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                let passes = 0;
                while (!levelComplete() && passes < 60) {
                    passes++;
                    const target = ingredients.find((i) => i.state === 'rest');
                    if (!target) break;
                    placePlayer(STACK_COLS[target.stack], target.row);
                    setPlayerDir(1, 0);
                    for (let i = 0; i < 150; i++) step(0.016);
                    setPlayerDir(0, 0);
                    for (let i = 0; i < 150; i++) step(0.016);
                }
                return {
                    passes,
                    plated: ingredients.filter((i) => i.state === 'plated').length,
                    total: ingredients.length,
                    state,
                };
            });
            expect(r.plated).toBe(r.total);
            expect(r.state).toBe('levelclear');
            expect(r.passes).toBeLessThan(60);
        });

        test('later levels are harder', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const s1 = enemySpeedFor(1);
                const s5 = enemySpeedFor(5);
                return { s1, s5 };
            });
            expect(r.s5).toBeGreaterThan(r.s1);
        });

        test('the score element tracks the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('the best score is persisted on game over', async ({ page }) => {
            const stored = await page.evaluate(() => {
                startGame();
                score = 7777;
                lives = 1;
                loseLife();
                return window.localStorage.getItem('burgertime-best');
            });
            expect(stored).toBe('7777');
        });
    });

    // -----------------------------------------------------------------------
    // Pause / game over
    // -----------------------------------------------------------------------
    test.describe('pause and game over', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('nothing moves while paused', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                placePlayer(9, 14);
                setPlayerDir(1, 0);
                togglePause();
                const before = player.x;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(r.after).toBe(r.before);
        });

        test('game over shows the overlay again', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                lives = 1;
                loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                lives = 1;
                loseLife();
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, lives, level }));
            expect(r.state).toBe('running');
            expect(r.score).toBe(0);
            expect(r.lives).toBe(3);
            expect(r.level).toBe(1);
        });

        test('Space continues to the next level after a level clear', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                enemies.length = 0;
                plateEverything();
                step(0.016);
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, level }));
            expect(r.state).toBe('running');
            expect(r.level).toBe(2);
        });
    });
});
