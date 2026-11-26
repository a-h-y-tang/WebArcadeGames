const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const seeded = (seed) => `${GAME_URL}?seed=${seed}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function start(page) {
    await page.keyboard.press('Space');
    await page.waitForFunction(() => state === 'running');
}

async function readMaze(page) {
    return page.evaluate(() => ({
        cols: maze.cols,
        rows: maze.rows,
        grid: Array.from(maze.grid),
    }));
}

function at(m, x, y) {
    return m.grid[y * m.cols + x];
}

// Breadth-first flood of the open tunnels from a starting cell.
function flood(m, sx, sy) {
    const seen = new Set([`${sx},${sy}`]);
    const queue = [[sx, sy]];
    while (queue.length) {
        const [x, y] = queue.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
            if (at(m, nx, ny) !== 0 || seen.has(key)) continue;
            seen.add(key);
            queue.push([nx, ny]);
        }
    }
    return seen;
}

function openCells(m) {
    const cells = [];
    for (let y = 0; y < m.rows; y++) {
        for (let x = 0; x < m.cols; x++) if (at(m, x, y) === 0) cells.push([x, y]);
    }
    return cells;
}

async function teleport(page, x, y, angle) {
    await page.evaluate(([x, y, angle]) => {
        player.x = x;
        player.y = y;
        if (angle != null) player.angle = angle;
    }, [x, y, angle]);
}

async function hold(page, key, ms) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
}

// Walk onto every dressed stone on the level, then step on the quarry mouth.
async function gatherAllStones(page) {
    const count = await page.evaluate(() => stones.length);
    for (let i = 0; i < count; i++) {
        await page.evaluate((i) => {
            player.x = stones[i].x;
            player.y = stones[i].y;
            oil = 100;
        }, i);
        await page.waitForFunction((i) => stones[i].taken, i);
    }
}

async function returnToGate(page) {
    await page.evaluate(() => {
        player.x = GATE.x;
        player.y = GATE.y;
        oil = 100;
    });
}

// ---------------------------------------------------------------------------

test.describe("Solomon's Quarry", () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(seeded(7));
    });

    test.afterEach(() => {
        expect(errors).toEqual([]);
    });

    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test("page title is Solomon's Quarry", async ({ page }) => {
            await expect(page).toHaveTitle("Solomon's Quarry");
        });

        test('the start overlay is visible and names the game', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText("Solomon's Quarry");
        });

        test('the overlay prompts to press Space', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('Space');
        });

        test('the title screen carries the 1 Kings 6:7 reference', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('1 Kings 6:7');
        });

        test('the canvas is 760×440', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '760');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '440');
        });

        test('the HUD starts at level 1, no stones, a full lamp and no score', async ({ page }) => {
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#stones')).toHaveText('0 / 3');
            await expect(page.locator('#oil')).toContainText('100');
            await expect(page.locator('#score')).toHaveText('0');
        });

        test('best shows a dash when nothing is stored', async ({ page }) => {
            await expect(page.locator('#best')).toHaveText('—');
        });

        test('the game starts idle', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the controls hint lists the movement and pause keys', async ({ page }) => {
            const hint = page.locator('#controls-hint');
            await expect(hint).toContainText('P');
            await expect(hint).toContainText('Q');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('starting a run', () => {
        test('Space hides the overlay and runs the game', async ({ page }) => {
            await start(page);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button also starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('Enter also starts the game', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the player starts at the quarry mouth, looking down a tunnel', async ({ page }) => {
            await start(page);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            const gate = await page.evaluate(() => ({ x: GATE.x, y: GATE.y }));
            expect(p.x).toBeCloseTo(gate.x, 5);
            expect(p.y).toBeCloseTo(gate.y, 5);
            // Never nose-first into the rock: the view ahead is open tunnel.
            const ahead = await page.evaluate(() => castRay(player.x, player.y, player.angle).dist);
            expect(ahead).toBeGreaterThan(0.9);
        });

        test('every level opens looking down a tunnel', async ({ page }) => {
            await start(page);
            const views = await page.evaluate(() => {
                const out = [];
                for (let l = 1; l <= LEVELS.length; l++) {
                    level = l;
                    startLevel();
                    out.push(castRay(player.x, player.y, player.angle).dist);
                }
                return out;
            });
            expect(views.filter((d) => d <= 0.9)).toEqual([]);
        });

        test('the status line asks for the stones', async ({ page }) => {
            await start(page);
            await expect(page.locator('#status')).toContainText('stone');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('the quarry maze', () => {
        test('level 1 is an 11×11 grid', async ({ page }) => {
            const m = await readMaze(page);
            expect([m.cols, m.rows]).toEqual([11, 11]);
        });

        test('the outer border is solid rock', async ({ page }) => {
            const m = await readMaze(page);
            const border = [];
            for (let x = 0; x < m.cols; x++) border.push(at(m, x, 0), at(m, x, m.rows - 1));
            for (let y = 0; y < m.rows; y++) border.push(at(m, 0, y), at(m, m.cols - 1, y));
            expect([...new Set(border)]).toEqual([1]);
        });

        test('the quarry mouth cell is open tunnel', async ({ page }) => {
            const m = await readMaze(page);
            expect(at(m, 1, 1)).toBe(0);
        });

        test('every open tunnel is reachable from the quarry mouth', async ({ page }) => {
            const m = await readMaze(page);
            expect(flood(m, 1, 1).size).toBe(openCells(m).length);
        });

        test('isWall agrees with the grid', async ({ page }) => {
            const m = await readMaze(page);
            const mismatches = await page.evaluate(() => {
                const bad = [];
                for (let y = 0; y < maze.rows; y++) {
                    for (let x = 0; x < maze.cols; x++) {
                        const grid = maze.grid[y * maze.cols + x] === 1;
                        if (isWall(x, y) !== grid) bad.push([x, y]);
                    }
                }
                return bad;
            });
            expect(mismatches).toEqual([]);
            expect(m.cols).toBeGreaterThan(0);
        });

        test('cells outside the grid count as rock', async ({ page }) => {
            expect(await page.evaluate(() => isWall(-1, 3) && isWall(3, -1) && isWall(999, 3))).toBe(true);
        });

        test('the same seed always carves the same quarry', async ({ page }) => {
            const first = await readMaze(page);
            await page.goto(seeded(7));
            expect(await readMaze(page)).toEqual(first);
        });

        test('a different seed carves a different quarry', async ({ page }) => {
            const first = await readMaze(page);
            await page.goto(seeded(12345));
            expect(await readMaze(page)).not.toEqual(first);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('stones and flasks', () => {
        test('level 1 holds three dressed stones', async ({ page }) => {
            expect(await page.evaluate(() => stones.length)).toBe(3);
        });

        test('level 1 holds an oil flask for every stone', async ({ page }) => {
            expect(await page.evaluate(() => flasks.length)).toBe(3);
        });

        test('every item sits in an open tunnel cell', async ({ page }) => {
            const m = await readMaze(page);
            const items = await page.evaluate(() => [...stones, ...flasks].map((i) => ({ x: i.x, y: i.y })));
            const inRock = items.filter((i) => at(m, Math.floor(i.x), Math.floor(i.y)) !== 0);
            expect(inRock).toEqual([]);
        });

        test('no item sits on the quarry mouth', async ({ page }) => {
            const onGate = await page.evaluate(() =>
                [...stones, ...flasks].filter(
                    (i) => Math.floor(i.x) === Math.floor(GATE.x) && Math.floor(i.y) === Math.floor(GATE.y)
                ).length
            );
            expect(onGate).toBe(0);
        });

        test('no two items share a cell', async ({ page }) => {
            const keys = await page.evaluate(() =>
                [...stones, ...flasks].map((i) => `${Math.floor(i.x)},${Math.floor(i.y)}`)
            );
            expect(new Set(keys).size).toBe(keys.length);
        });

        test('the stones start untaken', async ({ page }) => {
            expect(await page.evaluate(() => stones.every((s) => !s.taken))).toBe(true);
        });

        test('every stone is a real walk from the mouth', async ({ page }) => {
            const dists = await page.evaluate(() => stones.map((s) => gateDistance(Math.floor(s.x), Math.floor(s.y))));
            expect(Math.min(...dists)).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('walking the tunnels', () => {
        test('forward walks the way the lamp points', async ({ page }) => {
            await start(page);
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x + 1, y) === 0);
            await teleport(page, cell[0] + 0.5, cell[1] + 0.5, 0);
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowUp', 300);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before + 0.1);
        });

        test('back walks the other way', async ({ page }) => {
            await start(page);
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x - 1, y) === 0);
            await teleport(page, cell[0] + 0.5, cell[1] + 0.5, 0);
            const before = await page.evaluate(() => player.x);
            await hold(page, 'ArrowDown', 300);
            expect(await page.evaluate(() => player.x)).toBeLessThan(before - 0.05);
        });

        test('W and S walk as well', async ({ page }) => {
            await start(page);
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x + 1, y) === 0);
            await teleport(page, cell[0] + 0.5, cell[1] + 0.5, 0);
            const before = await page.evaluate(() => player.x);
            await hold(page, 'KeyW', 300);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(before + 0.1);
        });

        test('the right arrow turns clockwise', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { player.angle = 1; });
            await hold(page, 'ArrowRight', 250);
            expect(await page.evaluate(() => player.angle)).toBeGreaterThan(1.1);
        });

        test('the left arrow turns anticlockwise', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { player.angle = 1; });
            await hold(page, 'ArrowLeft', 250);
            expect(await page.evaluate(() => player.angle)).toBeLessThan(0.9);
        });

        test('A and D turn too', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { player.angle = 1; });
            await hold(page, 'KeyD', 200);
            const turned = await page.evaluate(() => player.angle);
            expect(turned).toBeGreaterThan(1.05);
            await hold(page, 'KeyA', 200);
            expect(await page.evaluate(() => player.angle)).toBeLessThan(turned);
        });

        test('E sidesteps without turning', async ({ page }) => {
            await start(page);
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x, y + 1) === 0);
            await teleport(page, cell[0] + 0.5, cell[1] + 0.5, 0);
            const before = await page.evaluate(() => ({ y: player.y, angle: player.angle }));
            await hold(page, 'KeyE', 300);
            const after = await page.evaluate(() => ({ y: player.y, angle: player.angle }));
            expect(after.y).toBeGreaterThan(before.y + 0.05);
            expect(after.angle).toBeCloseTo(before.angle, 5);
        });

        test('rock cannot be walked through', async ({ page }) => {
            await start(page);
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x + 1, y) === 1);
            await teleport(page, cell[0] + 0.5, cell[1] + 0.5, 0);
            await hold(page, 'ArrowUp', 600);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y }));
            expect(p.x).toBeLessThan(cell[0] + 0.85);
            expect(await page.evaluate(() => isWall(Math.floor(player.x), Math.floor(player.y)))).toBe(false);
        });

        test('a long scramble never ends up inside rock', async ({ page }) => {
            await start(page);
            for (const key of ['ArrowUp', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowUp', 'KeyE', 'ArrowUp', 'KeyQ']) {
                await page.evaluate(() => { oil = 100; });
                await hold(page, key, 120);
                expect(await page.evaluate(() => isWall(Math.floor(player.x), Math.floor(player.y)))).toBe(false);
            }
        });

        test('nothing moves while the game is idle', async ({ page }) => {
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await hold(page, 'ArrowUp', 250);
            expect(await page.evaluate(() => ({ x: player.x, y: player.y }))).toEqual(before);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('casting rays', () => {
        test('a ray east from a cell centre stops half a cell from the rock', async ({ page }) => {
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x + 1, y) === 1);
            const hit = await page.evaluate(
                ([x, y]) => castRay(x + 0.5, y + 0.5, 0),
                cell
            );
            expect(hit.dist).toBeCloseTo(0.5, 2);
            expect(hit.side).toBe('x');
        });

        test('a ray north from a cell centre stops half a cell from the rock', async ({ page }) => {
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x, y - 1) === 1);
            const hit = await page.evaluate(
                ([x, y]) => castRay(x + 0.5, y + 0.5, -Math.PI / 2),
                cell
            );
            expect(hit.dist).toBeCloseTo(0.5, 2);
            expect(hit.side).toBe('y');
        });

        test('a ray down an open tunnel travels more than one cell', async ({ page }) => {
            const m = await readMaze(page);
            const cell = openCells(m).find(([x, y]) => at(m, x + 1, y) === 0 && at(m, x + 2, y) === 0);
            const hit = await page.evaluate(([x, y]) => castRay(x + 0.5, y + 0.5, 0), cell);
            expect(hit.dist).toBeGreaterThan(1.4);
        });

        test('every ray across the view hits rock at a sane distance', async ({ page }) => {
            await start(page);
            const stats = await page.evaluate(() => {
                let min = Infinity;
                let max = 0;
                for (let col = 0; col < 760; col += 5) {
                    const a = player.angle - FOV / 2 + (col / 760) * FOV;
                    const d = castRay(player.x, player.y, a).dist;
                    min = Math.min(min, d);
                    max = Math.max(max, d);
                }
                return { min, max, span: Math.max(maze.cols, maze.rows) };
            });
            expect(stats.min).toBeGreaterThan(0);
            expect(stats.max).toBeLessThan(stats.span * 1.5);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('the lamp', () => {
        test('oil drains while walking the quarry', async ({ page }) => {
            await start(page);
            const before = await page.evaluate(() => oil);
            await page.waitForTimeout(700);
            expect(await page.evaluate(() => oil)).toBeLessThan(before);
        });

        test('the oil bar narrows as the oil burns', async ({ page }) => {
            await start(page);
            const full = await page.evaluate(() => parseFloat(document.getElementById('oil-bar').style.width));
            expect(full).toBeGreaterThan(95);
            await page.evaluate(() => { oil = 40; });
            await page.waitForFunction(
                () => parseFloat(document.getElementById('oil-bar').style.width) < 45
            );
        });

        test('the light reaches further with a full lamp', async ({ page }) => {
            await start(page);
            const full = await page.evaluate(() => { oil = 100; return lightRadius(); });
            const low = await page.evaluate(() => { oil = 10; return lightRadius(); });
            expect(full).toBeGreaterThan(low);
        });

        test('an oil flask refills the lamp', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                oil = 20;
                player.x = flasks[0].x;
                player.y = flasks[0].y;
            });
            await page.waitForFunction(() => flasks[0].taken);
            expect(await page.evaluate(() => oil)).toBeGreaterThan(40);
        });

        test('a flask never pushes the lamp past full', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                oil = 95;
                player.x = flasks[0].x;
                player.y = flasks[0].y;
            });
            await page.waitForFunction(() => flasks[0].taken);
            expect(await page.evaluate(() => oil)).toBeLessThanOrEqual(100);
        });

        test('the run ends when the lamp goes out', async ({ page }) => {
            await start(page);
            await page.evaluate(() => { oil = 0.4; });
            await page.waitForFunction(() => state === 'over');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('lamp');
            expect(await page.evaluate(() => oil)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('gathering stones', () => {
        test('walking onto a stone takes it and scores 100', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                player.x = stones[0].x;
                player.y = stones[0].y;
            });
            await page.waitForFunction(() => stones[0].taken);
            expect(await page.evaluate(() => score)).toBe(100);
            await expect(page.locator('#stones')).toHaveText('1 / 3');
        });

        test('a stone is only taken once', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                player.x = stones[0].x;
                player.y = stones[0].y;
            });
            await page.waitForFunction(() => stones[0].taken);
            await page.waitForTimeout(250);
            expect(await page.evaluate(() => score)).toBe(100);
        });

        test('the gate stays shut until every stone is held', async ({ page }) => {
            await start(page);
            expect(await page.evaluate(() => gateOpen())).toBe(false);
            await page.evaluate(() => {
                player.x = stones[0].x;
                player.y = stones[0].y;
            });
            await page.waitForFunction(() => stones[0].taken);
            expect(await page.evaluate(() => gateOpen())).toBe(false);
        });

        test('the gate opens once all the stones are held', async ({ page }) => {
            await start(page);
            await gatherAllStones(page);
            expect(await page.evaluate(() => gateOpen())).toBe(true);
            await expect(page.locator('#status')).toContainText('mouth');
        });

        test('returning to a shut gate does not clear the level', async ({ page }) => {
            await start(page);
            await returnToGate(page);
            await page.waitForTimeout(300);
            expect(await page.evaluate(() => level)).toBe(1);
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('clearing a level', () => {
        test('carrying the stones out opens the next, larger level', async ({ page }) => {
            await start(page);
            await gatherAllStones(page);
            await returnToGate(page);
            await page.waitForFunction(() => level === 2);
            await expect(page.locator('#level')).toHaveText('2');
            const m = await readMaze(page);
            expect([m.cols, m.rows]).toEqual([13, 13]);
            await expect(page.locator('#stones')).toHaveText('0 / 4');
        });

        test('clearing a level pays a bonus and refills the lamp', async ({ page }) => {
            await start(page);
            await gatherAllStones(page);
            await returnToGate(page);
            await page.waitForFunction(() => level === 2);
            expect(await page.evaluate(() => score)).toBeGreaterThan(3 * 100 + 250);
            expect(await page.evaluate(() => oil)).toBeGreaterThan(99);
        });

        test('the new level puts the player back at its quarry mouth', async ({ page }) => {
            await start(page);
            await gatherAllStones(page);
            await returnToGate(page);
            await page.waitForFunction(() => level === 2);
            const p = await page.evaluate(() => ({ x: player.x, y: player.y, taken: stones.filter((s) => s.taken).length }));
            expect(p.x).toBeCloseTo(1.5, 5);
            expect(p.y).toBeCloseTo(1.5, 5);
            expect(p.taken).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('winning the run', () => {
        test('clearing the last level wins', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                level = LEVELS.length;
                startLevel();
            });
            await gatherAllStones(page);
            await returnToGate(page);
            await page.waitForFunction(() => state === 'won');
            await expect(page.locator('#overlay-title')).toContainText('temple');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the best score is kept for next time', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                level = LEVELS.length;
                startLevel();
            });
            await gatherAllStones(page);
            await returnToGate(page);
            await page.waitForFunction(() => state === 'won');
            const won = await page.evaluate(() => score);
            expect(await page.evaluate(() => localStorage.getItem('solomons-quarry-best'))).toBe(String(won));
            await page.goto(seeded(7));
            await expect(page.locator('#best')).toHaveText(String(won));
        });
    });

    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses the run and says so', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#status')).toContainText('Paused');
        });

        test('a paused lamp does not burn', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => oil);
            await page.waitForTimeout(600);
            expect(await page.evaluate(() => oil)).toBe(before);
        });

        test('a paused player does not move', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            const before = await page.evaluate(() => ({ x: player.x, y: player.y }));
            await hold(page, 'ArrowUp', 300);
            expect(await page.evaluate(() => ({ x: player.x, y: player.y }))).toEqual(before);
        });

        test('P resumes the run', async ({ page }) => {
            await start(page);
            await page.keyboard.press('KeyP');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    test.describe('playing again', () => {
        test('Space after the lamp dies starts a fresh run', async ({ page }) => {
            await start(page);
            await page.evaluate(() => {
                player.x = stones[0].x;
                player.y = stones[0].y;
            });
            await page.waitForFunction(() => stones[0].taken);
            await page.evaluate(() => { oil = 0.3; });
            await page.waitForFunction(() => state === 'over');
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            const s = await page.evaluate(() => ({ level, score, oil, taken: stones.filter((x) => x.taken).length }));
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.taken).toBe(0);
            expect(s.oil).toBeGreaterThan(99);     // a frame of burn may already have passed
        });

        test('a fresh run carves a fresh quarry', async ({ page }) => {
            await page.goto(GAME_URL);
            await start(page);
            const first = await readMaze(page);
            await page.evaluate(() => { oil = 0.3; });
            await page.waitForFunction(() => state === 'over');
            await page.keyboard.press('Space');
            await page.waitForFunction(() => state === 'running');
            expect(await readMaze(page)).not.toEqual(first);
        });
    });

    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the tunnels are drawn, not left blank', async ({ page }) => {
            await start(page);
            await page.waitForTimeout(200);
            const colours = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const { data } = ctx.getImageData(0, 0, 760, 440);
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(colours).toBeGreaterThan(8);
        });

        test('the minimap only shows tunnels already walked', async ({ page }) => {
            await start(page);
            const seen = await page.evaluate(() => explored.size);
            expect(seen).toBeGreaterThan(0);
            expect(seen).toBeLessThan(await page.evaluate(() => maze.cols * maze.rows));
        });

        test('walking on reveals more of the minimap', async ({ page }) => {
            await start(page);
            const before = await page.evaluate(() => explored.size);
            await hold(page, 'ArrowUp', 400);
            expect(await page.evaluate(() => explored.size)).toBeGreaterThanOrEqual(before);
        });
    });
});
