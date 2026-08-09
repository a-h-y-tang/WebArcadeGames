const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Most tests drive the simulation by hand through `step(dt)`. The CPU opponent
// normally takes its turn from the real-time frame loop, so tests switch
// `autoCpu` off to keep every scenario deterministic.
test.describe('Curling', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Curling', async ({ page }) => {
            await expect(page).toHaveTitle('Curling');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('scores start at 0 and the end counter at 1', async ({ page }) => {
            await expect(page.locator('#score-player')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
            await expect(page.locator('#end')).toHaveText('1');
        });

        test('canvas matches the sheet dimensions', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '420');
            await expect(canvas).toHaveAttribute('height', '720');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no stones are on the sheet before starting', async ({ page }) => {
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('win/loss record loads from localStorage', async ({ page }) => {
            await page.evaluate(() =>
                window.localStorage.setItem('curling-record', JSON.stringify({ w: 7, l: 3 })));
            await page.reload();
            await expect(page.locator('#record')).toHaveText('7-3');
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('a new game resets scores, end and stones', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                return { scores: scores.slice(), end, stones: stones.length, thrown: thrown.slice() };
            });
            expect(s.scores).toEqual([0, 0]);
            expect(s.end).toBe(1);
            expect(s.stones).toBe(0);
            expect(s.thrown).toEqual([0, 0]);
        });

        test('the player throws first because the CPU holds the hammer', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                return { currentTeam, hammer };
            });
            expect(s.hammer).toBe(1);
            expect(s.currentTeam).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming controls
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('setAim clamps the angle to the legal range', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(10);
                const high = aim.angle;
                setAim(-10);
                const low = aim.angle;
                return { high, low, max: MAX_AIM };
            });
            expect(s.high).toBeCloseTo(s.max, 5);
            expect(s.low).toBeCloseTo(-s.max, 5);
        });

        test('setPower clamps to 0..1', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setPower(5);
                const high = aim.power;
                setPower(-5);
                return { high, low: aim.power };
            });
            expect(s.high).toBe(1);
            expect(s.low).toBe(0);
        });

        test('setCurl only accepts -1, 0 and 1', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setCurl(3);
                const high = aim.curl;
                setCurl(-3);
                const low = aim.curl;
                setCurl(0);
                return { high, low, zero: aim.curl };
            });
            expect(s.high).toBe(1);
            expect(s.low).toBe(-1);
            expect(s.zero).toBe(0);
        });

        test('arrow keys adjust the aim angle', async ({ page }) => {
            await page.evaluate(() => { autoCpu = false; startGame(); setAim(0); });
            await page.keyboard.press('ArrowRight');
            const right = await page.evaluate(() => aim.angle);
            expect(right).toBeGreaterThan(0);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const left = await page.evaluate(() => aim.angle);
            expect(left).toBeLessThan(right);
        });

        test('A and D set the curl handle', async ({ page }) => {
            await page.evaluate(() => { autoCpu = false; startGame(); setCurl(0); });
            await page.keyboard.press('KeyD');
            expect(await page.evaluate(() => aim.curl)).toBe(1);
            await page.keyboard.press('KeyA');
            expect(await page.evaluate(() => aim.curl)).toBe(-1);
        });

        test('the power meter sweeps up and back down while charging', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                startCharge();
                const samples = [];
                for (let i = 0; i < 100; i++) { step(0.016); samples.push(aim.power); }
                return { charging, max: Math.max(...samples), min: Math.min(...samples) };
            });
            expect(s.charging).toBe(true);
            expect(s.max).toBeGreaterThan(0.8);
            expect(s.min).toBeLessThan(0.2);
        });

        test('releasing the charge throws the stone', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                startCharge();
                for (let i = 0; i < 25; i++) step(0.016);
                releaseCharge();
                return { state, stones: stones.length, charging };
            });
            expect(s.charging).toBe(false);
            expect(s.state).toBe('sliding');
            expect(s.stones).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Throwing and sliding physics
    // -----------------------------------------------------------------------
    test.describe('throwing', () => {
        test('a thrown stone starts at the release point and belongs to the thrower', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setPower(0.5);
                throwStone();
                return { x: stones[0].x, y: stones[0].y, team: stones[0].team, rx: RELEASE_X, ry: RELEASE_Y };
            });
            expect(s.x).toBeCloseTo(s.rx, 5);
            expect(s.y).toBeCloseTo(s.ry, 5);
            expect(s.team).toBe(0);
        });

        test('the stone travels up the sheet', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setPower(0.5);
                throwStone();
                const y0 = stones[0].y;
                for (let i = 0; i < 30; i++) step(0.016);
                return { y0, y1: stones[0].y };
            });
            expect(s.y1).toBeLessThan(s.y0);
        });

        test('friction brings the stone to rest', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setPower(0.5);
                throwStone();
                for (let i = 0; i < 600; i++) step(0.016);
                return { moving: anyStoneMoving(), state };
            });
            expect(s.moving).toBe(false);
            expect(s.state).not.toBe('sliding');
        });

        test('more power sends the stone further', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setPower(0.35);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const soft = stones.length ? stones[stones.length - 1].y : -1;

                startGame();
                setAim(0);
                setPower(0.75);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const hard = stones.length ? stones[stones.length - 1].y : -1;
                return { soft, hard };
            });
            // Smaller y == further up the sheet. A removed stone reports -1,
            // which is also "further", so the ordering holds either way.
            expect(s.hard).toBeLessThan(s.soft);
        });

        test('aiming right sends the stone right of centre', async ({ page }) => {
            const x = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(MAX_AIM);
                setCurl(0);
                setPower(0.45);
                throwStone();
                for (let i = 0; i < 200; i++) step(0.016);
                return stones[0].x;
            });
            expect(x).toBeGreaterThan(215);
        });

        test('a clockwise handle curls the stone to the right', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setCurl(0);
                setPower(0.55);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const straight = stones.length ? stones[0].x : null;

                startGame();
                setAim(0);
                setCurl(1);
                setPower(0.55);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const curled = stones.length ? stones[0].x : null;
                return { straight, curled };
            });
            expect(s.straight).not.toBeNull();
            expect(s.curled).not.toBeNull();
            expect(s.curled).toBeGreaterThan(s.straight + 5);
        });

        test('an anticlockwise handle curls the stone to the left', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setCurl(0);
                setPower(0.55);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const straight = stones.length ? stones[0].x : null;

                startGame();
                setAim(0);
                setCurl(-1);
                setPower(0.55);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                const curled = stones.length ? stones[0].x : null;
                return { straight, curled };
            });
            expect(s.curled).toBeLessThan(s.straight - 5);
        });

        test('you cannot throw while a stone is still sliding', async ({ page }) => {
            const count = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setPower(0.5);
                throwStone();
                throwStone();
                throwStone();
                return stones.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('a moving stone knocks a stationary stone forward', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                const target = addStone({ x: RELEASE_X, y: 300, team: 1 });
                const y0 = target.y;
                setAim(0);
                setCurl(0);
                setPower(0.9);
                throwStone();
                for (let i = 0; i < 400; i++) step(0.016);
                return { y0, y1: target.y, moved: target.y < y0 };
            });
            expect(s.moved).toBe(true);
        });

        test('stones never end up overlapping', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: 200, y: 300, team: 1 });
                addStone({ x: 226, y: 300, team: 1 });
                setAim(0);
                setCurl(0);
                setPower(0.85);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                let gap = Infinity;
                for (let i = 0; i < stones.length; i++) {
                    for (let j = i + 1; j < stones.length; j++) {
                        const d = Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y);
                        gap = Math.min(gap, d);
                    }
                }
                return gap;
            });
            expect(minGap).toBeGreaterThan(25);
        });

        test('a collision transfers speed to the struck stone', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                const target = addStone({ x: RELEASE_X, y: 400, team: 1 });
                setAim(0);
                setCurl(0);
                setPower(1);
                throwStone();
                let sawTargetMove = false;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    if (Math.hypot(target.vx, target.vy) > 10) sawTargetMove = true;
                }
                return sawTargetMove;
            });
            expect(s).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Out-of-play rules
    // -----------------------------------------------------------------------
    test.describe('out of play', () => {
        test('a stone that fails to reach the hog line is removed', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setAim(0);
                setCurl(0);
                setPower(0);
                throwStone();
                for (let i = 0; i < 600; i++) step(0.016);
                return { stones: stones.length, hog: HOG_LINE };
            });
            expect(s.stones).toBe(0);
        });

        test('a stone driven past the back line is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: 210, y: BACK_LINE - 5, team: 1 });
                resolveShot();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stone pushed over a side line is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: SIDE_LEFT + 2, y: 300, team: 0 });
                addStone({ x: SIDE_RIGHT - 2, y: 300, team: 1 });
                resolveShot();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a legally placed stone survives the shot resolution', async ({ page }) => {
            const count = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                resolveShot();
                return stones.length;
            });
            expect(count).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Turn order
    // -----------------------------------------------------------------------
    test.describe('turn order', () => {
        test('the turn passes to the opponent after a shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setPower(0.5);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
                return { currentTeam, thrown: thrown.slice(), state };
            });
            expect(s.currentTeam).toBe(1);
            expect(s.thrown).toEqual([1, 0]);
            expect(s.state).toBe('aiming');
        });

        test('each team throws the same number of stones in an end', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                for (let n = 0; n < STONES_PER_TEAM * 2; n++) {
                    setAim(0);
                    setPower(0.5);
                    throwStone();
                    for (let i = 0; i < 900; i++) step(0.016);
                }
                return { thrown: thrown.slice(), perTeam: STONES_PER_TEAM };
            });
            expect(s.thrown[0]).toBe(s.perTeam);
            expect(s.thrown[1]).toBe(s.perTeam);
        });

        test('the end finishes once every stone has been thrown', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                for (let n = 0; n < STONES_PER_TEAM * 2; n++) {
                    setAim(0);
                    setPower(0.5);
                    throwStone();
                    for (let i = 0; i < 900; i++) step(0.016);
                }
                return { state, end };
            });
            expect(s.state).toBe('endbreak');
            expect(s.end).toBe(2);
        });

        test('stones remaining is shown in the HUD and counts down', async ({ page }) => {
            await page.evaluate(() => {
                autoCpu = false;
                startGame();
                setPower(0.5);
                throwStone();
                for (let i = 0; i < 900; i++) step(0.016);
            });
            await expect(page.locator('#stones-left')).toHaveText(String(3));
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the team with the closest stone scores', async ({ page }) => {
            const r = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                addStone({ x: BUTTON_X + 40, y: BUTTON_Y, team: 1 });
                return scoreEnd();
            });
            expect(r.team).toBe(0);
            expect(r.points).toBe(1);
        });

        test('every stone closer than the best opposing stone counts', async ({ page }) => {
            const r = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 1 });
                addStone({ x: BUTTON_X + 20, y: BUTTON_Y, team: 1 });
                addStone({ x: BUTTON_X, y: BUTTON_Y + 30, team: 1 });
                addStone({ x: BUTTON_X + 60, y: BUTTON_Y, team: 0 });
                return scoreEnd();
            });
            expect(r.team).toBe(1);
            expect(r.points).toBe(3);
        });

        test('stones outside the house never score', async ({ page }) => {
            const r = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y + HOUSE_R + STONE_R + 40, team: 0 });
                return scoreEnd();
            });
            expect(r.points).toBe(0);
            expect(r.team).toBe(-1);
        });

        test('an empty house is a blank end', async ({ page }) => {
            const r = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                return scoreEnd();
            });
            expect(r.points).toBe(0);
        });

        test('finishing an end adds the points to the scoreboard', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                addStone({ x: BUTTON_X + 18, y: BUTTON_Y, team: 0 });
                finishEnd();
                return { scores: scores.slice(), end };
            });
            expect(s.scores[0]).toBe(2);
            expect(s.scores[1]).toBe(0);
            expect(s.end).toBe(2);
        });

        test('the hammer passes to the team that conceded the end', async ({ page }) => {
            const hammer = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                finishEnd();
                return hammer;
            });
            expect(hammer).toBe(1);
        });

        test('a blank end leaves the hammer where it was', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                const before = hammer;
                finishEnd();
                return { before, after: hammer };
            });
            expect(s.after).toBe(s.before);
        });

        test('the non-hammer team throws first in the next end', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 1 });
                finishEnd();     // CPU scores, so the player gets the hammer
                startEnd();
                return { hammer, currentTeam, stones: stones.length };
            });
            expect(s.hammer).toBe(0);
            expect(s.currentTeam).toBe(1);
            expect(s.stones).toBe(0);
        });

        test('the scoreboard is mirrored in the HUD', async ({ page }) => {
            await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 1 });
                finishEnd();
            });
            await expect(page.locator('#score-cpu')).toHaveText('1');
            await expect(page.locator('#end')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Match flow
    // -----------------------------------------------------------------------
    test.describe('match flow', () => {
        test('the match ends after the scheduled ends when someone leads', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                end = TOTAL_ENDS;
                scores[0] = 4;
                scores[1] = 2;
                finishEnd();
                return { state, end };
            });
            expect(s.state).toBe('over');
        });

        test('a tied match goes to an extra end', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                end = TOTAL_ENDS;
                scores[0] = 3;
                scores[1] = 3;
                finishEnd();
                return { state, end };
            });
            expect(s.state).toBe('endbreak');
            expect(s.end).toBe(5);
        });

        test('extra ends stop at the cap and the match is declared a draw', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                end = MAX_ENDS;
                scores[0] = 3;
                scores[1] = 3;
                finishEnd();
                return { state, title: document.getElementById('overlay-title').textContent };
            });
            expect(s.state).toBe('over');
            expect(s.title).toMatch(/draw/i);
        });

        test('the overlay announces the winner', async ({ page }) => {
            await page.evaluate(() => {
                autoCpu = false;
                startGame();
                scores[0] = 6;
                scores[1] = 1;
                endGame();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win/i);
        });

        test('a win is written to the stored record', async ({ page }) => {
            const rec = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                scores[0] = 5;
                scores[1] = 0;
                endGame();
                return JSON.parse(window.localStorage.getItem('curling-record'));
            });
            expect(rec.w).toBe(1);
            expect(rec.l).toBe(0);
        });

        test('a loss is written to the stored record', async ({ page }) => {
            const rec = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                scores[0] = 0;
                scores[1] = 5;
                endGame();
                return JSON.parse(window.localStorage.getItem('curling-record'));
            });
            expect(rec.l).toBe(1);
        });

        test('the Next End button starts the following end', async ({ page }) => {
            await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                finishEnd();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.locator('#btn-start').click();
            const s = await page.evaluate(() => ({ state, stones: stones.length }));
            expect(s.state).toBe('aiming');
            expect(s.stones).toBe(0);
        });

        test('starting a new game after a match clears the scoreboard', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                scores[0] = 8;
                scores[1] = 1;
                endGame();
                startGame();
                return { scores: scores.slice(), end, state };
            });
            expect(s.scores).toEqual([0, 0]);
            expect(s.end).toBe(1);
            expect(s.state).toBe('aiming');
        });
    });

    // -----------------------------------------------------------------------
    // CPU opponent
    // -----------------------------------------------------------------------
    test.describe('cpu opponent', () => {
        test('the CPU throws a stone when it is its turn', async ({ page }) => {
            const s = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                currentTeam = 1;
                cpuTakeShot();
                return { state, team: stones[stones.length - 1].team };
            });
            expect(s.state).toBe('sliding');
            expect(s.team).toBe(1);
        });

        test('CPU stones reach the far half of the sheet', async ({ page }) => {
            const { ys, hog } = await page.evaluate(() => {
                autoCpu = false;
                const results = [];
                for (let n = 0; n < 6; n++) {
                    startGame();
                    currentTeam = 1;
                    cpuTakeShot();
                    for (let i = 0; i < 900; i++) step(0.016);
                    results.push(stones.length ? stones[0].y : CANVAS_H);
                }
                return { ys: results, hog: HOG_LINE };
            });
            // At least most CPU draws should end up past the hog line.
            expect(ys.filter((y) => y < hog).length).toBeGreaterThanOrEqual(4);
        });

        test('the CPU plays a takeout when the player is sitting on the button', async ({ page }) => {
            const targeted = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X, y: BUTTON_Y, team: 0 });
                currentTeam = 1;
                const plan = cpuPlan();
                return plan.kind;
            });
            expect(targeted).toBe('takeout');
        });

        test('the CPU draws when the house is empty', async ({ page }) => {
            const kind = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                currentTeam = 1;
                return cpuPlan().kind;
            });
            expect(kind).toBe('draw');
        });

        test('the CPU takes its turn automatically when autoCpu is on', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setPower(0.5);
                throwStone();
            });
            // Let the real-time loop settle the shot and run the CPU reply.
            await expect
                .poll(async () => page.evaluate(() => thrown[1]), { timeout: 9000 })
                .toBeGreaterThanOrEqual(1);
        });
    });

    // -----------------------------------------------------------------------
    // Helpers used by the tests above
    // -----------------------------------------------------------------------
    test.describe('geometry helpers', () => {
        test('distanceToButton measures from the button', async ({ page }) => {
            const d = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                const s = addStone({ x: BUTTON_X + 30, y: BUTTON_Y + 40, team: 0 });
                return distanceToButton(s);
            });
            expect(d).toBeCloseTo(50, 5);
        });

        test('stonesInHouse is ordered by distance to the button', async ({ page }) => {
            const order = await page.evaluate(() => {
                autoCpu = false;
                startGame();
                addStone({ x: BUTTON_X + 50, y: BUTTON_Y, team: 0 });
                addStone({ x: BUTTON_X + 10, y: BUTTON_Y, team: 1 });
                addStone({ x: BUTTON_X + 30, y: BUTTON_Y, team: 0 });
                return stonesInHouse().map((s) => Math.round(distanceToButton(s)));
            });
            expect(order).toEqual([10, 30, 50]);
        });
    });
});
