const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation deterministically: `frames` calls to step(dt).
const advance = (page, frames, dt = 1 / 60) =>
    page.evaluate(([f, d]) => {
        for (let i = 0; i < f; i++) step(d);
    }, [frames, dt]);

// Nearly every spec is about one rule at a time, so the agents and the spawner
// are taken out of the way; the agent specs spawn exactly the agents they care
// about. Switching `autoStep` off stops the requestAnimationFrame loop from
// advancing the simulation behind the spec's back, leaving time entirely under
// test control. `spawnTimer` is pushed out of reach rather than disabled with a
// flag, so nothing in the game is aware it is being tested.
const startQuiet = (page) =>
    page.evaluate(() => {
        startGame();
        enemies.length = 0;
        bullets.length = 0;
        spawnTimer = 1e9;
        autoStep = false;
    });

// Chromium can acknowledge a synthetic key event before the page listener has
// run, so key presses are confirmed against the game's key state before the
// simulation is advanced.
const hold = async (page, key, flag) => {
    await page.keyboard.down(key);
    await page.waitForFunction((f) => keys[f], flag);
};

// Put the player on a floor at an exact x, standing, off any elevator.
const place = (page, floor, x) =>
    page.evaluate(([f, px]) => {
        player.floor = f;
        player.y = floorY(f);
        player.x = px;
        player.crouching = false;
        player.onElevator = -1;
    }, [floor, x]);

test.describe('Elevator Action', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Elevator Action', async ({ page }) => {
            await expect(page).toHaveTitle('Elevator Action');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas matches the viewport constants', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
            expect(await page.evaluate(() => [CANVAS_W, CANVAS_H])).toEqual([720, 480]);
        });

        test('the building is sixteen floors of 60px', async ({ page }) => {
            expect(await page.evaluate(() => [FLOORS, FLOOR_H, WORLD_H])).toEqual([16, 60, 960]);
        });

        test('floorY places floor 0 at the top and floor 15 at the bottom', async ({ page }) => {
            const ys = await page.evaluate(() => [floorY(0), floorY(1), floorY(FLOORS - 1)]);
            expect(ys).toEqual([50, 110, 950]);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('HUD shows the starting score, level and lives', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '7400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('7400');
        });

        test('no agents and no bullets before starting', async ({ page }) => {
            expect(await page.evaluate(() => [enemies.length, bullets.length])).toEqual([0, 0]);
        });

        test('step() does nothing while idle', async ({ page }) => {
            await page.evaluate(() => {
                keys.right = true;
            });
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Building layout
    // -----------------------------------------------------------------------
    test.describe('building layout', () => {
        test('three shafts cover overlapping bands of floors', async ({ page }) => {
            expect(await page.evaluate(() => SHAFTS.map((s) => [s.x, s.top, s.bottom]))).toEqual([
                [150, 0, 7],
                [360, 4, 11],
                [570, 8, 15],
            ]);
        });

        test('no shaft overlaps a door slot', async ({ page }) => {
            const clashes = await page.evaluate(() => {
                const out = [];
                for (const s of SHAFTS) {
                    for (const slot of DOOR_SLOTS) {
                        if (s.x < slot + DOOR_W && slot < s.x + SHAFT_W) out.push([s.x, slot]);
                    }
                }
                return out;
            });
            expect(clashes).toEqual([]);
        });

        test('every door slot fits inside the building', async ({ page }) => {
            expect(await page.evaluate(() => DOOR_SLOTS.every((x) => x >= 0 && x + DOOR_W <= BUILDING_W))).toBe(true);
        });

        test('every level is sixteen rows of four door slots', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    LEVELS.every((l) => l.doors.length === FLOORS && l.doors.every((r) => r.length === DOOR_SLOTS.length)),
                ),
            ).toBe(true);
        });

        test('the roof and the basement carry no doors', async ({ page }) => {
            expect(
                await page.evaluate(() =>
                    LEVELS.every((l) => /^\.+$/.test(l.doors[0]) && /^\.+$/.test(l.doors[FLOORS - 1])),
                ),
            ).toBe(true);
        });

        test('each level has at least three documents, rising with difficulty', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((l) => l.doors.join('').split('').filter((c) => c === 'R').length),
            );
            expect(counts[0]).toBeGreaterThanOrEqual(3);
            for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
        });

        test('doors are built from the level layout', async ({ page }) => {
            await startQuiet(page);
            const built = await page.evaluate(() =>
                doors.map((d) => [d.floor, d.x, d.kind]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
            );
            const expected = await page.evaluate(() => {
                const out = [];
                LEVELS[0].doors.forEach((row, f) => {
                    row.split('').forEach((c, i) => {
                        if (c === 'R') out.push([f, DOOR_SLOTS[i], 'red']);
                        if (c === 'B') out.push([f, DOOR_SLOTS[i], 'blue']);
                    });
                });
                return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            });
            expect(built).toEqual(expected);
        });

        test('docsLeft starts as the number of red doors', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => docsLeft)).toBe(
                await page.evaluate(() => doors.filter((d) => d.kind === 'red').length),
            );
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game and hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('the player drops in on the roof at the right hand side', async ({ page }) => {
            await startQuiet(page);
            const p = await page.evaluate(() => [player.floor, player.y, player.x > BUILDING_W / 2]);
            expect(p).toEqual([0, 50, true]);
        });

        test('each car starts inside its own shaft range', async ({ page }) => {
            await startQuiet(page);
            expect(
                await page.evaluate(() => elevators.every((c, i) => c.y >= floorY(SHAFTS[i].top) && c.y <= floorY(SHAFTS[i].bottom))),
            ).toBe(true);
        });

        test('the first car is level with the roof so the player can board at once', async ({ page }) => {
            await startQuiet(page);
            expect(await page.evaluate(() => elevators[0].y)).toBe(50);
        });

        test('P pauses and unpauses', async ({ page }) => {
            await startQuiet(page);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('playing');
        });

        test('step() does nothing while paused', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                togglePause();
                keys.right = true;
            });
            const before = await page.evaluate(() => player.x);
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Walking
    // -----------------------------------------------------------------------
    test.describe('walking', () => {
        test('right moves the player right and sets the facing', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.right = true;
            });
            await advance(page, 30);
            const after = await page.evaluate(() => [player.x, player.facing]);
            expect(after[0]).toBeGreaterThan(300);
            expect(after[1]).toBe(1);
        });

        test('left moves the player left and sets the facing', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.left = true;
            });
            await advance(page, 30);
            const after = await page.evaluate(() => [player.x, player.facing]);
            expect(after[0]).toBeLessThan(300);
            expect(after[1]).toBe(-1);
        });

        test('walking speed matches WALK_SPEED', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.right = true;
            });
            await advance(page, 60);
            const moved = (await page.evaluate(() => player.x)) - 300;
            expect(moved).toBeCloseTo(await page.evaluate(() => WALK_SPEED), 0);
        });

        test('the player cannot walk out of the left wall', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 40);
            await page.evaluate(() => {
                keys.left = true;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => player.x - PLAYER_W / 2)).toBeGreaterThanOrEqual(0);
        });

        test('the player cannot walk out of the right wall', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 700);
            await page.evaluate(() => {
                keys.right = true;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => player.x + PLAYER_W / 2)).toBeLessThanOrEqual(
                await page.evaluate(() => BUILDING_W),
            );
        });

        test('the arrow keys and WASD both drive the player', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await hold(page, 'd', 'right');
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBeGreaterThan(300);
        });

        test('the player stays on the same floor while walking', async ({ page }) => {
            await startQuiet(page);
            await place(page, 5, 300);
            await page.evaluate(() => {
                keys.right = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => [player.floor, player.y])).toEqual([5, 350]);
        });
    });

    // -----------------------------------------------------------------------
    // Crouching
    // -----------------------------------------------------------------------
    test.describe('crouching', () => {
        test('down crouches the player on a floor away from any shaft', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => player.crouching)).toBe(true);
        });

        test('a crouching player is shorter', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => playerHeight())).toBe(await page.evaluate(() => CROUCH_H));
        });

        test('a crouching player cannot walk', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.down = true;
                keys.right = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => player.x)).toBe(300);
        });

        test('releasing down stands the player back up', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            await page.evaluate(() => {
                keys.down = false;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => player.crouching)).toBe(false);
        });

        test('down inside a reachable shaft works the elevator instead of crouching', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => player.crouching)).toBe(false);
        });

        test('down inside a shaft that does not reach this floor still crouches', async ({ page }) => {
            await startQuiet(page);
            await place(page, 13, 176); // shaft A stops at floor 7
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => player.crouching)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Elevators
    // -----------------------------------------------------------------------
    test.describe('elevators', () => {
        test('holding down in a shaft with a level car boards it', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => player.onElevator)).toBe(0);
        });

        test('a boarded car carries the player down', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 60);
            const after = await page.evaluate(() => [player.y, elevators[0].y, player.onElevator]);
            expect(after[0]).toBeGreaterThan(50);
            expect(after[0]).toBe(after[1]);
            expect(after[2]).toBe(0);
        });

        test('the car descends at CAR_SPEED', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 60);
            expect((await page.evaluate(() => elevators[0].y)) - 50).toBeCloseTo(
                await page.evaluate(() => CAR_SPEED),
                0,
            );
        });

        test('a car cannot be driven past the bottom of its shaft', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 600);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(SHAFTS[0].bottom)));
        });

        test('a car cannot be driven past the top of its shaft', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 176);
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => elevators[0].y)).toBe(await page.evaluate(() => floorY(SHAFTS[0].top)));
        });

        test('a distant car is summoned towards the player', async ({ page }) => {
            await startQuiet(page);
            await place(page, 4, 386); // shaft B, car parked far below
            const before = await page.evaluate(() => elevators[1].y);
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 30);
            const after = await page.evaluate(() => elevators[1].y);
            expect(after).toBeLessThan(before);
            expect(await page.evaluate(() => player.onElevator)).toBe(-1);
        });

        test('a summoned car is called towards the player whichever key is held', async ({ page }) => {
            await startQuiet(page);
            await place(page, 4, 386);
            const before = await page.evaluate(() => elevators[1].y);
            await page.evaluate(() => {
                keys.down = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => elevators[1].y)).toBeLessThan(before);
        });

        test('a summoned car stops level with the player instead of crushing them', async ({ page }) => {
            await startQuiet(page);
            await place(page, 4, 386);
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 600);
            const after = await page.evaluate(() => [elevators[1].y, floorY(4), player.alive]);
            expect(after[0]).toBe(after[1]);
            expect(after[2]).toBe(true);
        });

        test('the player boards the car the moment it arrives', async ({ page }) => {
            await startQuiet(page);
            await place(page, 4, 386);
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 600);
            expect(await page.evaluate(() => player.onElevator)).toBe(1);
        });

        test('a car outside the shaft x span cannot be summoned', async ({ page }) => {
            await startQuiet(page);
            await place(page, 4, 300); // between shafts
            const before = await page.evaluate(() => elevators.map((c) => c.y));
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => elevators.map((c) => c.y))).toEqual(before);
        });

        test('a shaft that does not reach the floor cannot be called', async ({ page }) => {
            await startQuiet(page);
            await place(page, 13, 176); // shaft A ends at floor 7
            const before = await page.evaluate(() => elevators[0].y);
            await page.evaluate(() => {
                keys.up = true;
            });
            await advance(page, 60);
            expect(await page.evaluate(() => elevators[0].y)).toBe(before);
        });

        test('pressing left steps the player off a car level with a floor', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.onElevator = 0;
                elevators[0].y = floorY(5);
                player.y = floorY(5);
                player.x = 176;
                keys.left = true;
            });
            await advance(page, 4);
            const after = await page.evaluate(() => [player.onElevator, player.floor, player.y]);
            expect(after).toEqual([-1, 5, 350]);
        });

        test('the player cannot step off a car parked between floors', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.onElevator = 0;
                elevators[0].y = floorY(5) - 25;
                player.y = elevators[0].y;
                player.x = 176;
                keys.right = true;
            });
            await advance(page, 10);
            expect(await page.evaluate(() => player.onElevator)).toBe(0);
        });

        test('a riding player does not walk sideways', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.onElevator = 0;
                elevators[0].y = floorY(5) - 25;
                player.y = elevators[0].y;
                player.x = 176;
                keys.right = true;
            });
            await advance(page, 30);
            expect(await page.evaluate(() => player.x)).toBe(176);
        });

        test('the player can ride all the way from the roof to the basement by transferring', async ({ page }) => {
            await startQuiet(page);
            const reached = await page.evaluate(() => {
                // Drive A down to 7, walk to shaft B, ride to 11, walk to C, ride to 15.
                const ride = (shaft, targetFloor) => {
                    player.x = SHAFTS[shaft].x + SHAFT_W / 2;
                    // Call the car to this floor, then drive it to the target.
                    for (let i = 0; i < 3000 && player.onElevator !== shaft; i++) {
                        keys.up = elevators[shaft].y > player.y;
                        keys.down = elevators[shaft].y < player.y;
                        if (!keys.up && !keys.down) keys.down = true;
                        step(1 / 60);
                    }
                    const want = floorY(targetFloor);
                    for (let i = 0; i < 3000; i++) {
                        keys.up = elevators[shaft].y > want;
                        keys.down = elevators[shaft].y < want;
                        if (!keys.up && !keys.down) break;
                        step(1 / 60);
                    }
                    keys.up = keys.down = false;
                    keys.right = true;
                    step(1 / 60);
                    keys.right = false;
                };
                ride(0, 7);
                ride(1, 11);
                ride(2, 15);
                return player.floor;
            });
            expect(reached).toBe(15);
        });

        test('the camera follows the player down the building', async ({ page }) => {
            await startQuiet(page);
            await place(page, 0, 300);
            await advance(page, 1);
            const top = await page.evaluate(() => camY);
            await place(page, 15, 300);
            await advance(page, 1);
            const bottom = await page.evaluate(() => camY);
            expect(top).toBe(0);
            expect(bottom).toBe(await page.evaluate(() => WORLD_H - CANVAS_H));
        });
    });

    // -----------------------------------------------------------------------
    // Documents and the exit
    // -----------------------------------------------------------------------
    test.describe('documents', () => {
        test('walking onto a red door takes the document and scores', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => docsLeft);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                player.onElevator = -1;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => docsLeft)).toBe(before - 1);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => DOC_POINTS));
        });

        test('a taken door is marked open and cannot be taken twice', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                player.onElevator = -1;
            });
            await advance(page, 2);
            const once = await page.evaluate(() => [docsLeft, score]);
            await advance(page, 60);
            expect(await page.evaluate(() => [docsLeft, score])).toEqual(once);
            expect(await page.evaluate(() => doors.find((x) => x.kind === 'red').open)).toBe(true);
        });

        test('a blue door is not a document', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => [docsLeft, score]);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'blue');
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                player.onElevator = -1;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => [docsLeft, score])).toEqual(before);
        });

        test('walking past a door without overlapping it takes nothing', async ({ page }) => {
            await startQuiet(page);
            const before = await page.evaluate(() => docsLeft);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W + 40;
                player.onElevator = -1;
            });
            await advance(page, 2);
            expect(await page.evaluate(() => docsLeft)).toBe(before);
        });

        test('the HUD counts the documents still to find', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const d = doors.find((x) => x.kind === 'red');
                player.floor = d.floor;
                player.y = floorY(d.floor);
                player.x = d.x + DOOR_W / 2;
                player.onElevator = -1;
            });
            await advance(page, 2);
            await expect(page.locator('#docs')).toHaveText(String(await page.evaluate(() => docsLeft)));
        });
    });

    test.describe('the exit', () => {
        test('the basement exit does nothing while documents remain', async ({ page }) => {
            await startQuiet(page);
            await place(page, 15, 20);
            await advance(page, 10);
            expect(await page.evaluate(() => [state, level])).toEqual(['playing', 1]);
        });

        test('reaching the exit with every document clears the level', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                docsLeft = 0;
            });
            await place(page, 15, 20);
            await advance(page, 10);
            expect(await page.evaluate(() => level)).toBe(2);
        });

        test('clearing a level scores the escape bonus', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                docsLeft = 0;
                score = 0;
            });
            await place(page, 15, 20);
            await advance(page, 10);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => ESCAPE_POINTS));
        });

        test('a cleared level rebuilds the building and puts the player back on the roof', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                docsLeft = 0;
            });
            await place(page, 15, 20);
            await advance(page, 10);
            const after = await page.evaluate(() => [player.floor, docsLeft > 0, enemies.length]);
            expect(after).toEqual([0, true, 0]);
        });

        test('escaping the last level wins the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                level = LEVELS.length;
                docsLeft = 0;
            });
            await place(page, 15, 20);
            await advance(page, 10);
            expect(await page.evaluate(() => [state, won])).toEqual(['over', true]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/escaped/i);
        });

        test('the exit only counts on the left hand side of the basement', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                docsLeft = 0;
            });
            await place(page, 15, 400);
            await advance(page, 10);
            expect(await page.evaluate(() => level)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('firing adds a player bullet travelling the way the player faces', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                player.facing = 1;
                shoot();
            });
            const b = await page.evaluate(() => bullets.map((x) => [x.from, Math.sign(x.vx)]));
            expect(b).toEqual([['player', 1]]);
        });

        test('facing left fires left', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                player.facing = -1;
                shoot();
            });
            expect(await page.evaluate(() => Math.sign(bullets[0].vx))).toBe(-1);
        });

        test('a standing shot leaves at chest height', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => shoot());
            expect(await page.evaluate(() => floorY(3) - bullets[0].y)).toBe(await page.evaluate(() => SHOT_H));
        });

        test('a crouching shot leaves low', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                player.crouching = true;
                shoot();
            });
            expect(await page.evaluate(() => floorY(3) - bullets[0].y)).toBe(await page.evaluate(() => CROUCH_SHOT_H));
        });

        test('the gun has a cooldown', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                shoot();
                shoot();
                shoot();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('the gun fires again once the cooldown elapses', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => shoot());
            await advance(page, 30);
            await page.evaluate(() => {
                bullets.length = 0;
                shoot();
            });
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('Space fires while playing', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('Z fires while playing', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.keyboard.press('z');
            expect(await page.evaluate(() => bullets.length)).toBe(1);
        });

        test('bullets travel at BULLET_SPEED', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                player.facing = 1;
                shoot();
            });
            const x0 = await page.evaluate(() => bullets[0].x);
            await advance(page, 30);
            expect((await page.evaluate(() => bullets[0].x)) - x0).toBeCloseTo(
                (await page.evaluate(() => BULLET_SPEED)) / 2,
                0,
            );
        });

        test('bullets are retired at the walls', async ({ page }) => {
            await startQuiet(page);
            await place(page, 3, 300);
            await page.evaluate(() => {
                player.facing = 1;
                shoot();
            });
            await advance(page, 120);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    test.describe('agents', () => {
        test('spawnEnemyAt places an agent on a floor', async ({ page }) => {
            await startQuiet(page);
            const e = await page.evaluate(() => {
                const a = spawnEnemyAt(6, 400, -1);
                return [a.floor, a.x, a.y, a.alive, enemies.length];
            });
            expect(e).toEqual([6, 400, 410, true, 1]);
        });

        test('an agent walks towards the player on its own floor', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 200);
            await page.evaluate(() => spawnEnemyAt(6, 500, 1));
            await advance(page, 30);
            expect(await page.evaluate(() => enemies[0].x)).toBeLessThan(500);
        });

        test('an agent faces the player it is walking towards', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 200);
            await page.evaluate(() => spawnEnemyAt(6, 500, 1));
            await advance(page, 10);
            expect(await page.evaluate(() => enemies[0].facing)).toBe(-1);
        });

        test('an agent stays on its own floor when the player is elsewhere', async ({ page }) => {
            await startQuiet(page);
            await place(page, 2, 200);
            await page.evaluate(() => spawnEnemyAt(9, 500, 1));
            await advance(page, 120);
            expect(await page.evaluate(() => [enemies[0].floor, enemies[0].y])).toEqual([9, 590]);
        });

        test('an agent in range on the same floor opens fire', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            // Watch for the shot as it is fired rather than after the fact: a
            // bullet that reaches the player ends the run, and one that misses
            // has left the building again long before the last frame.
            const fired = await page.evaluate(() => {
                spawnEnemyAt(6, 420, -1).speed = 0;
                let seen = false;
                for (let i = 0; i < 180; i++) {
                    step(1 / 60);
                    if (bullets.some((b) => b.from === 'enemy')) seen = true;
                    bullets.length = 0;
                }
                return seen;
            });
            expect(fired).toBe(true);
        });

        test('an agent on another floor never fires', async ({ page }) => {
            await startQuiet(page);
            await place(page, 2, 300);
            await page.evaluate(() => {
                spawnEnemyAt(9, 320, -1).speed = 0;
            });
            await advance(page, 300);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('an agent out of range holds its fire', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 20);
            await page.evaluate(() => {
                const a = spawnEnemyAt(6, 700, -1);
                a.speed = 0;
            });
            await advance(page, 180);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a player bullet kills an agent and scores', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                score = 0;
                const a = spawnEnemyAt(6, 420, -1);
                a.speed = 0;
                player.facing = 1;
                shoot();
            });
            await advance(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => ENEMY_POINTS));
        });

        test('the bullet is spent on the agent it kills', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                const a = spawnEnemyAt(6, 420, -1);
                a.speed = 0;
                player.facing = 1;
                shoot();
            });
            await advance(page, 30);
            expect(await page.evaluate(() => bullets.length)).toBe(0);
        });

        test('a player bullet passes agents on other floors', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                const a = spawnEnemyAt(7, 420, -1);
                a.speed = 0;
                player.facing = 1;
                shoot();
            });
            await advance(page, 20);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('a crouching player can still shoot an agent', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                const a = spawnEnemyAt(6, 420, -1);
                a.speed = 0;
                player.crouching = true;
                player.facing = 1;
                shoot();
            });
            await advance(page, 30);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
        });

        test('the spawner brings agents out of blue doors over time', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                spawnTimer = 0;
                for (let i = 0; i < 300; i++) {
                    step(1 / 60);
                    bullets.length = 0; // the spawner is under test here, not the gunfight
                }
            });
            const spawned = await page.evaluate(() =>
                enemies.map((e) => doors.some((d) => d.kind === 'blue' && d.floor === e.floor)),
            );
            expect(spawned.length).toBeGreaterThan(0);
            expect(spawned.every(Boolean)).toBe(true);
        });

        test('the spawner respects the level agent cap', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                spawnTimer = 0;
                for (let i = 0; i < 1200; i++) {
                    step(1 / 60);
                    bullets.length = 0;
                }
            });
            expect(await page.evaluate(() => enemies.length)).toBeLessThanOrEqual(
                await page.evaluate(() => LEVELS[0].maxEnemies),
            );
        });
    });

    // -----------------------------------------------------------------------
    // Getting hit
    // -----------------------------------------------------------------------
    test.describe('getting hit', () => {
        test('an agent bullet costs the player a life', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('a hit puts the player back on the roof with the floor cleared', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                spawnEnemyAt(6, 500, -1);
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            const after = await page.evaluate(() => [player.floor, enemies.length, bullets.length]);
            expect(after).toEqual([0, 0, 0]);
        });

        test('documents already collected survive a death', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                docsLeft = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => docsLeft)).toBe(1);
        });

        test('crouching ducks under an agent bullet', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                player.crouching = true;
                keys.down = true;
                bullets.push({ x: 360, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('an agent bullet on another floor misses', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                bullets.push({ x: 360, y: floorY(7) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 30);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('the player cannot be shot by their own bullet', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                bullets.push({ x: 300, y: floorY(6) - SHOT_H, vx: 0, from: 'player' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => lives)).toBe(3);
        });

        test('touching an agent costs a life', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => spawnEnemyAt(6, 305, -1));
            await advance(page, 4);
            expect(await page.evaluate(() => lives)).toBe(2);
        });

        test('the last life ends the game', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                lives = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => [state, lives, won])).toEqual(['over', 0, false]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('the HUD tracks the remaining lives', async ({ page }) => {
            await startQuiet(page);
            await place(page, 6, 300);
            await page.evaluate(() => {
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('a riding player between floors is above the gunfire', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                player.onElevator = 0;
                elevators[0].y = floorY(6) - 30;
                player.y = elevators[0].y;
                player.x = 176;
                bullets.push({ x: 400, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 60);
            expect(await page.evaluate(() => lives)).toBe(3);
        });
    });

    // -----------------------------------------------------------------------
    // Crushing agents with a car
    // -----------------------------------------------------------------------
    test.describe('crushing', () => {
        test('a car driven down onto an agent crushes it', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 0;
                const a = spawnEnemyAt(1, SHAFTS[0].x + SHAFT_W / 2, -1);
                a.speed = 0;
                player.floor = 0;
                player.y = floorY(0);
                player.x = SHAFTS[0].x + SHAFT_W / 2;
                player.onElevator = -1;
                keys.down = true;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => enemies.length)).toBe(0);
            expect(await page.evaluate(() => score)).toBe(await page.evaluate(() => CRUSH_POINTS));
        });

        test('a still car crushes nobody', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const a = spawnEnemyAt(0, SHAFTS[0].x + SHAFT_W / 2, -1);
                a.speed = 0;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });

        test('an agent clear of the shaft is not crushed', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                const a = spawnEnemyAt(1, 300, -1);
                a.speed = 0;
                player.floor = 0;
                player.y = floorY(0);
                player.x = SHAFTS[0].x + SHAFT_W / 2;
                player.onElevator = -1;
                keys.down = true;
            });
            await advance(page, 120);
            expect(await page.evaluate(() => enemies.length)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring and restart
    // -----------------------------------------------------------------------
    test.describe('score keeping', () => {
        test('the HUD mirrors the score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 1234;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('1234');
        });

        test('a game over writes a new best score to localStorage', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 4321;
                lives = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe('4321');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('elevatoraction-best', '9000'));
            await page.reload();
            await startQuiet(page);
            await page.evaluate(() => {
                score = 10;
                lives = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            expect(await page.evaluate(() => window.localStorage.getItem('elevatoraction-best'))).toBe('9000');
        });

        test('the overlay reports the final score', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 2500;
                lives = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            await expect(page.locator('#overlay-score')).toContainText('2500');
        });

        test('Space after a game over starts a fresh run', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => {
                score = 2500;
                lives = 1;
                player.floor = 6;
                player.y = floorY(6);
                player.x = 300;
                player.onElevator = -1;
                bullets.push({ x: 320, y: floorY(6) - SHOT_H, vx: -BULLET_SPEED, from: 'enemy' });
            });
            await advance(page, 10);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => [state, score, lives, level])).toEqual(['playing', 0, 3, 1]);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startQuiet(page);
            await page.evaluate(() => draw());
            const painted = await page.evaluate(() => {
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });

        test('draw() is safe before the game starts', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => draw());
            expect(errors).toEqual([]);
        });

        test('the running game throws no errors over a long stretch', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(() => {
                startGame();
                autoStep = false;
            });
            await page.evaluate(() => {
                for (let i = 0; i < 3000; i++) {
                    keys.right = i % 240 < 120;
                    keys.left = !keys.right;
                    keys.down = i % 97 < 40;
                    if (i % 31 === 0) shoot();
                    step(1 / 60);
                    draw();
                }
            });
            expect(errors).toEqual([]);
        });
    });
});
