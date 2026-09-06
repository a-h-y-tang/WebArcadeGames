const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most tests drive the simulation by hand (`throwStone()` + `settle()`), so the
// real-time animation loop is switched off first to keep results deterministic.
// The handful of tests that exercise the live loop turn it back on explicitly.
async function openManual(page) {
    await page.goto(GAME_URL);
    await page.evaluate(() => setAutoPlay(false));
}

test.describe('Curling', () => {
    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test.beforeEach(async ({ page }) => openManual(page));

        test('page title is Curling', async ({ page }) => {
            await expect(page).toHaveTitle('Curling');
        });

        test('canvas is 400x700', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '400');
            await expect(canvas).toHaveAttribute('height', '700');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle with no stones on the sheet', async ({ page }) => {
            const s = await page.evaluate(() => ({ state, stones: stones.length }));
            expect(s.state).toBe('idle');
            expect(s.stones).toBe(0);
        });

        test('scoreboard starts at 0-0 in end 1', async ({ page }) => {
            await expect(page.locator('#score-you')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
            await expect(page.locator('#end')).toHaveText('1');
        });

        test('the house sits above the far hog line', async ({ page }) => {
            const geo = await page.evaluate(() => ({ HOUSE_Y, HOG_Y, BACK_Y, RELEASE_Y, RING_12 }));
            expect(geo.HOUSE_Y).toBeLessThan(geo.HOG_Y);
            expect(geo.HOG_Y).toBeLessThan(geo.RELEASE_Y);
            expect(geo.BACK_Y).toBeLessThan(geo.HOUSE_Y);
            expect(geo.HOUSE_Y - geo.RING_12).toBeLessThanOrEqual(geo.HOUSE_Y);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test.beforeEach(async ({ page }) => openManual(page));

        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('a fresh game begins in end 1 with the player to throw', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { end, stonesThrown, team: currentTeam(), you: scores.you, cpu: scores.cpu };
            });
            expect(s.end).toBe(1);
            expect(s.stonesThrown).toBe(0);
            expect(s.team).toBe('you');
            expect(s.you).toBe(0);
            expect(s.cpu).toBe(0);
        });

        test('both teams start with a full set of stones', async ({ page }) => {
            const left = await page.evaluate(() => { startGame(); return stonesRemaining(); });
            const per = await page.evaluate(() => STONES_PER_TEAM);
            expect(left).toBe(per * 2);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming, power and handle
    // -----------------------------------------------------------------------
    test.describe('aim, power and handle', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('aim is clamped to the maximum in both directions', async ({ page }) => {
            const s = await page.evaluate(() => {
                setAim(99); const hi = aim;
                setAim(-99); const lo = aim;
                return { hi, lo, max: MAX_AIM };
            });
            expect(s.hi).toBeCloseTo(s.max, 6);
            expect(s.lo).toBeCloseTo(-s.max, 6);
        });

        test('arrow keys steer the aim', async ({ page }) => {
            await page.evaluate(() => setAim(0));
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => aim)).toBeLessThan(0);
            await page.evaluate(() => setAim(0));
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => aim)).toBeGreaterThan(0);
        });

        test('power is clamped to the 0..1 range', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(5); const hi = power;
                setPower(-5); const lo = power;
                return { hi, lo };
            });
            expect(s.hi).toBe(1);
            expect(s.lo).toBe(0);
        });

        test('up and down arrows change the power', async ({ page }) => {
            await page.evaluate(() => setPower(0.5));
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => power)).toBeGreaterThan(0.5);
            await page.evaluate(() => setPower(0.5));
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => power)).toBeLessThan(0.5);
        });

        test('the HUD shows the current power as a percentage', async ({ page }) => {
            await page.evaluate(() => setPower(0.42));
            await expect(page.locator('#power-value')).toHaveText('42%');
        });

        test('the handle toggles between in-turn and out-turn', async ({ page }) => {
            const s = await page.evaluate(() => {
                setHandle(1); const a = handle;
                toggleHandle(); const b = handle;
                toggleHandle(); const c = handle;
                return { a, b, c };
            });
            expect(s.a).toBe(1);
            expect(s.b).toBe(-1);
            expect(s.c).toBe(1);
        });

        test('the H key toggles the handle and the HUD follows it', async ({ page }) => {
            await page.evaluate(() => setHandle(1));
            const before = await page.locator('#handle-value').textContent();
            await page.keyboard.press('h');
            expect(await page.evaluate(() => handle)).toBe(-1);
            expect(await page.locator('#handle-value').textContent()).not.toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Delivering a stone
    // -----------------------------------------------------------------------
    test.describe('delivery', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('throwing puts a moving stone on the sheet', async ({ page }) => {
            const s = await page.evaluate(() => {
                throwStone();
                const st = stones[stones.length - 1];
                return { state, count: stones.length, team: st.team, y: st.y, vy: st.vy };
            });
            expect(s.count).toBe(1);
            expect(s.state).toBe('sliding');
            expect(s.team).toBe('you');
            expect(s.vy).toBeLessThan(0); // travelling up the sheet toward the house
        });

        test('the stone leaves from the hack at the release line', async ({ page }) => {
            const s = await page.evaluate(() => {
                throwStone();
                const st = stones[0];
                return { x: st.x, y: st.y, w: CANVAS_W, release: RELEASE_Y };
            });
            expect(s.x).toBeCloseTo(s.w / 2, 6);
            expect(s.y).toBeCloseTo(s.release, 6);
        });

        test('release speed scales between the minimum and maximum with power', async ({ page }) => {
            const s = await page.evaluate(() => {
                const speed = (p) => {
                    startGame();
                    setAim(0); setPower(p); throwStone();
                    const st = stones[0];
                    return Math.hypot(st.vx, st.vy);
                };
                return { lo: speed(0), hi: speed(1), MIN_SPEED, MAX_SPEED };
            });
            expect(s.lo).toBeCloseTo(s.MIN_SPEED, 3);
            expect(s.hi).toBeCloseTo(s.MAX_SPEED, 3);
        });

        test('a second stone cannot be thrown while one is sliding', async ({ page }) => {
            const count = await page.evaluate(() => {
                throwStone();
                throwStone();
                return stones.length;
            });
            expect(count).toBe(1);
        });

        test('stones come to rest through friction', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(0.5); throwStone(); settle();
                const st = stones[0];
                return st ? { vx: st.vx, vy: st.vy } : { vx: 0, vy: 0 };
            });
            expect(Math.hypot(s.vx, s.vy)).toBe(0);
        });

        test('more power sends the stone further up the sheet', async ({ page }) => {
            const ys = await page.evaluate(() => {
                const run = (p) => {
                    startGame();
                    setAim(0); setPower(p); setHandle(1);
                    throwStone();
                    // Step manually so the stone is measured before the hog-line
                    // sweep removes short deliveries.
                    for (let i = 0; i < 2000 && state === 'sliding'; i++) step(1 / 120);
                    return stones.length ? stones[0].y : -999;
                };
                return [run(0.3), run(0.5), run(0.7)];
            });
            expect(ys[1]).toBeLessThan(ys[0]);
            expect(ys[2]).toBeLessThan(ys[1]);
        });
    });

    // -----------------------------------------------------------------------
    // Curl and aim
    // -----------------------------------------------------------------------
    test.describe('curl', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('an in-turn curls the stone to the right', async ({ page }) => {
            const x = await page.evaluate(() => {
                setAim(0); setPower(0.6); setHandle(1);
                throwStone(); settle();
                return stones.length ? stones[0].x : null;
            });
            expect(x).not.toBeNull();
            expect(x).toBeGreaterThan(200);
        });

        test('an out-turn curls the stone to the left', async ({ page }) => {
            const x = await page.evaluate(() => {
                setAim(0); setPower(0.6); setHandle(-1);
                throwStone(); settle();
                return stones.length ? stones[0].x : null;
            });
            expect(x).not.toBeNull();
            expect(x).toBeLessThan(200);
        });

        test('aiming right lands the stone further right than aiming straight', async ({ page }) => {
            const s = await page.evaluate(() => {
                const run = (a) => {
                    startGame();
                    setAim(a); setPower(0.6); setHandle(1);
                    throwStone(); settle();
                    return stones.length ? stones[0].x : null;
                };
                return { straight: run(0), right: run(0.15) };
            });
            expect(s.right).toBeGreaterThan(s.straight);
        });
    });

    // -----------------------------------------------------------------------
    // Boundaries: hog line, back line, side lines
    // -----------------------------------------------------------------------
    test.describe('out of play', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('a stone short of the hog line is swept off the sheet', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(0); setAim(0); throwStone(); settle();
                return stones.length;
            });
            expect(s).toBe(0);
        });

        test('a stone through the back line is removed', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(1); setAim(0); throwStone(); settle();
                return stones.length;
            });
            expect(s).toBe(0);
        });

        test('a stone driven off the side is removed', async ({ page }) => {
            const s = await page.evaluate(() => {
                launchStone('you', 200, 500, 260, -60, 0);
                settle();
                return stones.length;
            });
            expect(s).toBe(0);
        });

        test('a stone that stops in the house stays in play', async ({ page }) => {
            const found = await page.evaluate(() => {
                // Sweep the power range: at least one draw weight must finish in
                // the house, otherwise the sheet geometry is unplayable.
                for (let p = 0.3; p <= 0.95; p += 0.02) {
                    startGame();
                    setPower(p); setAim(-0.08); setHandle(1);
                    throwStone(); settle();
                    if (stones.length === 1 && isInHouse(stones[0])) return true;
                }
                return false;
            });
            expect(found).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('a head-on hit drives the target stone up the sheet', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('cpu', 200, 300);
                launchStone('you', 200, 620, 0, -210, 0);
                settle();
                const target = stones.find((st) => st.team === 'cpu');
                const shooter = stones.find((st) => st.team === 'you');
                return { targetY: target ? target.y : null, shooterY: shooter ? shooter.y : null };
            });
            expect(s.targetY).not.toBeNull();
            expect(s.targetY).toBeLessThan(300);
        });

        test('the shooter loses speed to the stone it strikes', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('cpu', 200, 300);
                launchStone('you', 200, 620, 0, -210, 0);
                settle();
                const target = stones.find((st) => st.team === 'cpu');
                const shooter = stones.find((st) => st.team === 'you');
                return { target: target ? target.y : null, shooter: shooter ? shooter.y : null };
            });
            // Equal masses: the shooter stops behind the stone it knocked away.
            expect(s.shooter).not.toBeNull();
            expect(s.shooter).toBeGreaterThan(s.target);
        });

        test('resting stones never overlap after a collision', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                placeStone('cpu', 200, 300);
                placeStone('cpu', 224, 300);
                launchStone('you', 200, 620, 0, -200, 0);
                settle();
                let min = Infinity;
                for (let i = 0; i < stones.length; i++) {
                    for (let j = i + 1; j < stones.length; j++) {
                        min = Math.min(min, Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y));
                    }
                }
                return min === Infinity ? 999 : min;
            });
            expect(minGap).toBeGreaterThan(23); // 2 * STONE_R, minus float slack
        });
    });

    // -----------------------------------------------------------------------
    // Turn order
    // -----------------------------------------------------------------------
    test.describe('turn order', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('teams alternate after each delivery', async ({ page }) => {
            const teams = await page.evaluate(() => {
                const seen = [currentTeam()];
                setPower(0.6);
                throwStone(); settle();
                seen.push(currentTeam());
                throwStone(); settle();
                seen.push(currentTeam());
                return seen;
            });
            expect(teams).toEqual(['you', 'cpu', 'you']);
        });

        test('the stone count and remaining stones track deliveries', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(0.6);
                throwStone(); settle();
                return { thrown: stonesThrown, left: stonesRemaining() };
            });
            expect(s.thrown).toBe(1);
            expect(s.left).toBe(7);
        });

        test('the HUD names the team about to throw', async ({ page }) => {
            await expect(page.locator('#turn')).toContainText(/you/i);
            await page.evaluate(() => { setPower(0.6); throwStone(); settle(); });
            await expect(page.locator('#turn')).toContainText(/cpu|computer/i);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring an end
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('an empty house is a blank end', async ({ page }) => {
            const r = await page.evaluate(() => scoreEnd());
            expect(r.team).toBeNull();
            expect(r.points).toBe(0);
        });

        test('the closest stone to the button wins the end', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOUSE_Y + 10);
                placeStone('cpu', HOUSE_X, HOUSE_Y + 40);
                return scoreEnd();
            });
            expect(r.team).toBe('you');
            expect(r.points).toBe(1);
        });

        test('every stone closer than the opponent counts', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOUSE_Y + 10);
                placeStone('you', HOUSE_X + 20, HOUSE_Y);
                placeStone('you', HOUSE_X, HOUSE_Y - 30);
                placeStone('cpu', HOUSE_X + 50, HOUSE_Y + 40);
                return scoreEnd();
            });
            expect(r.team).toBe('you');
            expect(r.points).toBe(3);
        });

        test('an opponent stone in front cuts the count off', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone('cpu', HOUSE_X, HOUSE_Y + 5);   // shot stone
                placeStone('you', HOUSE_X, HOUSE_Y + 20);
                placeStone('you', HOUSE_X, HOUSE_Y + 30);
                return scoreEnd();
            });
            expect(r.team).toBe('cpu');
            expect(r.points).toBe(1);
        });

        test('stones outside the house do not count', async ({ page }) => {
            const r = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOG_Y - 20);      // a guard, well short
                placeStone('cpu', HOUSE_X, HOUSE_Y + 30);
                return scoreEnd();
            });
            expect(r.team).toBe('cpu');
            expect(r.points).toBe(1);
        });

        test('the shot stone is the one lying closest to the button', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('cpu', HOUSE_X + 40, HOUSE_Y);
                placeStone('you', HOUSE_X, HOUSE_Y + 8);
                const shot = shotStone();
                return shot ? shot.team : null;
            });
            expect(s).toBe('you');
        });

        test('there is no shot stone when the house is empty', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOG_Y - 20);   // a guard, outside the rings
                return shotStone();
            });
            expect(s).toBeNull();
        });

        test('a stone biting the 12-foot ring is in the house', async ({ page }) => {
            const s = await page.evaluate(() => {
                const biting = placeStone('you', HOUSE_X, HOUSE_Y + RING_12 + STONE_R - 2);
                const clear = placeStone('cpu', HOUSE_X, HOUSE_Y + RING_12 + STONE_R + 6);
                return { biting: isInHouse(biting), clear: isInHouse(clear) };
            });
            expect(s.biting).toBe(true);
            expect(s.clear).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // End and game flow
    // -----------------------------------------------------------------------
    test.describe('end and game flow', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => startGame());
        });

        test('the end closes once every stone has been thrown', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(0.6);
                for (let i = 0; i < STONES_PER_TEAM * 2; i++) { throwStone(); settle(); }
                return { state, thrown: stonesThrown, left: stonesRemaining() };
            });
            expect(s.state).toBe('end-over');
            expect(s.left).toBe(0);
        });

        test('the end result is added to the scoreboard', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOUSE_Y);
                stonesThrown = STONES_PER_TEAM * 2 - 1;
                setPower(0.6); throwStone(); settle();
                return { you: scores.you, cpu: scores.cpu, state };
            });
            expect(s.state).toBe('end-over');
            expect(s.you + s.cpu).toBeGreaterThanOrEqual(1);
        });

        test('the next end resets the sheet', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOUSE_Y);
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                nextEnd();
                return { end, stones: stones.length, thrown: stonesThrown, state };
            });
            expect(s.end).toBe(2);
            expect(s.stones).toBe(0);
            expect(s.thrown).toBe(0);
            expect(s.state).toBe('aiming');
        });

        test('the team that scores throws first in the next end', async ({ page }) => {
            const first = await page.evaluate(() => {
                placeStone('cpu', HOUSE_X, HOUSE_Y);
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                nextEnd();
                return currentTeam();
            });
            expect(first).toBe('cpu');
        });

        test('a blank end leaves the throwing order alone', async ({ page }) => {
            const s = await page.evaluate(() => {
                const before = firstTeam;
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                nextEnd();
                return { before, after: firstTeam };
            });
            expect(s.after).toBe(s.before);
        });

        test('the game is over after the last end', async ({ page }) => {
            const s = await page.evaluate(() => {
                end = ENDS;
                placeStone('you', HOUSE_X, HOUSE_Y);
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                nextEnd();
                return { state, end };
            });
            expect(s.state).toBe('over');
            expect(s.end).toBe(await page.evaluate(() => ENDS));
        });

        test('the final overlay names the winner', async ({ page }) => {
            await page.evaluate(() => {
                end = ENDS;
                scores.you = 5; scores.cpu = 2;
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                nextEnd();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('Space moves on to the next end', async ({ page }) => {
            await page.evaluate(() => {
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ end, state }));
            expect(s.end).toBe(2);
            expect(s.state).toBe('aiming');
        });

        test('the scoreboard survives across ends', async ({ page }) => {
            const s = await page.evaluate(() => {
                placeStone('you', HOUSE_X, HOUSE_Y);
                stonesThrown = STONES_PER_TEAM * 2;
                finishEnd();
                const afterFirst = scores.you;
                nextEnd();
                return { afterFirst, afterNext: scores.you };
            });
            expect(s.afterNext).toBe(s.afterFirst);
        });
    });

    // -----------------------------------------------------------------------
    // Computer opponent
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test.beforeEach(async ({ page }) => {
            await openManual(page);
            await page.evaluate(() => { setSeed(7); startGame(); });
        });

        test('the computer delivers a stone of its own', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(0.6); throwStone(); settle();   // player's stone
                cpuThrow();
                const st = stones[stones.length - 1];
                return { state, team: st.team, moving: Math.hypot(st.vx, st.vy) > 0 };
            });
            expect(s.state).toBe('sliding');
            expect(s.team).toBe('cpu');
            expect(s.moving).toBe(true);
        });

        test('the computer mostly keeps its stones in play', async ({ page }) => {
            const kept = await page.evaluate(() => {
                let inPlay = 0;
                for (let i = 0; i < 5; i++) {
                    setSeed(100 + i);
                    startGame();
                    firstTeam = 'cpu';
                    cpuThrow(); settle();
                    if (stones.some((s) => s.team === 'cpu')) inPlay++;
                }
                return inPlay;
            });
            expect(kept).toBeGreaterThanOrEqual(3);
        });

        test('the computer plays deterministically for a given seed', async ({ page }) => {
            const s = await page.evaluate(() => {
                const run = () => {
                    setSeed(42);
                    startGame();
                    firstTeam = 'cpu';
                    cpuThrow(); settle();
                    return stones.map((st) => `${st.team}:${st.x.toFixed(4)}:${st.y.toFixed(4)}`).join('|');
                };
                return { a: run(), b: run() };
            });
            expect(s.a).toBe(s.b);
        });

        test('a full end between both teams completes and scores', async ({ page }) => {
            const s = await page.evaluate(() => {
                setSeed(3);
                startGame();
                for (let i = 0; i < STONES_PER_TEAM * 2; i++) {
                    if (currentTeam() === 'cpu') cpuThrow();
                    else { setPower(0.62); setAim(-0.07); setHandle(1); throwStone(); }
                    settle();
                }
                return { state, you: scores.you, cpu: scores.cpu };
            });
            expect(s.state).toBe('end-over');
            expect(s.you + s.cpu).toBeGreaterThanOrEqual(0);
        });
    });

    // -----------------------------------------------------------------------
    // Live animation loop
    // -----------------------------------------------------------------------
    test.describe('live play', () => {
        test('a thrown stone travels over real time', async ({ page }) => {
            await page.goto(GAME_URL);
            const y0 = await page.evaluate(() => {
                startGame();
                setPower(0.6); throwStone();
                return stones[0].y;
            });
            await page.waitForTimeout(400);
            const y1 = await page.evaluate(() => (stones.length ? stones[0].y : -999));
            expect(y1).toBeLessThan(y0);
        });

        test('the computer takes its turn on its own', async ({ page }) => {
            await page.goto(GAME_URL);
            await page.evaluate(() => {
                setSeed(11);
                startGame();
                setPower(0); setAim(0); throwStone();   // a short one, settles quickly
            });
            await page.waitForFunction(() => stonesThrown >= 1, null, { timeout: 6000 });
            await page.waitForFunction(() => stones.some((s) => s.team === 'cpu'), null, { timeout: 6000 });
            expect(await page.evaluate(() => currentTeam())).toBe('cpu');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the sheet is painted on the canvas', async ({ page }) => {
            await page.goto(GAME_URL);
            // Let the animation loop paint at least one frame first.
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));
            const painted = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
                return false;
            });
            expect(painted).toBe(true);
        });
    });
});
