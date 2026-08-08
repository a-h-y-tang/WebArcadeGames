const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Start a match and silence the opponent's random error so every test that
// involves the computer is repeatable.
async function startMatch(page) {
    await page.evaluate(() => {
        cpuNoise = 0;
        startGame();
    });
}

test.describe('Curling', () => {
    test.beforeEach(async ({ page }) => {
        // The sheet is tall; give it a viewport that fits so pointer
        // coordinates line up with canvas coordinates.
        await page.setViewportSize({ width: 900, height: 900 });
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Curling', async ({ page }) => {
            await expect(page).toHaveTitle('Curling');
        });

        test('canvas is 460x700', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '700');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-msg')).toContainText(/start|enter/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('scoreboard starts level at end 1', async ({ page }) => {
            await expect(page.locator('#score-you')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
            await expect(page.locator('#end')).toHaveText('1');
        });

        test('there are no stones on the sheet', async ({ page }) => {
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a match
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Enter starts the match', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the match', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('each team starts an end with four stones', async ({ page }) => {
            await startMatch(page);
            expect(await page.evaluate(() => stonesLeft)).toEqual([4, 4]);
        });

        test('the player leads the first end', async ({ page }) => {
            await startMatch(page);
            expect(await page.evaluate(() => currentTeam())).toBe(0);
        });

        test('a new match clears the scoreboard', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                scores = [3, 1];
                endNumber = 3;
                startGame();
            });
            expect(await page.evaluate(() => scores)).toEqual([0, 0]);
            expect(await page.evaluate(() => endNumber)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming controls
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => startMatch(page));

        test('arrow keys move the aim left and right', async ({ page }) => {
            const before = await page.evaluate(() => aim);
            await page.keyboard.press('ArrowRight');
            const right = await page.evaluate(() => aim);
            expect(right).toBeGreaterThan(before);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => aim)).toBeLessThan(before);
        });

        test('aim is clamped to the legal range', async ({ page }) => {
            expect(await page.evaluate(() => { setAim(99); return aim === MAX_AIM; })).toBe(true);
            expect(await page.evaluate(() => { setAim(-99); return aim === -MAX_AIM; })).toBe(true);
        });

        test('up and down arrows change the power', async ({ page }) => {
            const before = await page.evaluate(() => power);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => power)).toBeGreaterThan(before);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => power)).toBeLessThan(before);
        });

        test('power is clamped to 0..100', async ({ page }) => {
            expect(await page.evaluate(() => { setPower(500); return power; })).toBe(100);
            expect(await page.evaluate(() => { setPower(-500); return power; })).toBe(0);
        });

        test('Q and E set the handle, W clears it', async ({ page }) => {
            await page.keyboard.press('q');
            expect(await page.evaluate(() => spin)).toBe(-1);
            await page.keyboard.press('e');
            expect(await page.evaluate(() => spin)).toBe(1);
            await page.keyboard.press('w');
            expect(await page.evaluate(() => spin)).toBe(0);
        });

        test('the HUD reflects the current power and handle', async ({ page }) => {
            await page.evaluate(() => { setPower(72); setSpin(-1); });
            await expect(page.locator('#power-value')).toHaveText('72');
            await expect(page.locator('#spin-value')).toContainText(/counter/i);
            expect(await page.evaluate(
                () => parseFloat(document.getElementById('power-fill').style.width)
            )).toBeCloseTo(72, 1);
        });

        test('controls do nothing once the stone is on its way', async ({ page }) => {
            await page.evaluate(() => { setPower(60); throwStone(); });
            const aimBefore = await page.evaluate(() => aim);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => aim)).toBe(aimBefore);
        });
    });

    // -----------------------------------------------------------------------
    // Delivery and physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test.beforeEach(async ({ page }) => startMatch(page));

        test('throwing puts a moving stone on the sheet at the hack', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(60);
                throwStone();
                const stone = stones[0];
                return { state, count: stones.length, x: stone.x, y: stone.y, vy: stone.vy };
            });
            expect(s.state).toBe('sliding');
            expect(s.count).toBe(1);
            expect(s.x).toBeCloseTo(230, 5);
            expect(s.y).toBeCloseTo(645, 5);
            expect(s.vy).toBeLessThan(0);
        });

        test('a delivered stone comes to rest', async ({ page }) => {
            const stopped = await page.evaluate(() => {
                setPower(60);
                throwStone();
                settle();
                return stones.every((s) => s.vx === 0 && s.vy === 0);
            });
            expect(stopped).toBe(true);
        });

        test('more power means the stone travels further', async ({ page }) => {
            const near = await page.evaluate(() => {
                startGame();
                setPower(50);
                throwStone();
                settle();
                return stones.length ? stones[0].y : null;
            });
            const far = await page.evaluate(() => {
                startGame();
                setPower(62);
                throwStone();
                settle();
                return stones.length ? stones[0].y : null;
            });
            expect(near).not.toBeNull();
            expect(far).not.toBeNull();
            expect(far).toBeLessThan(near);
        });

        test('a clockwise handle bends the stone right', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setPower(60);
                setSpin(1);
                throwStone();
                settle();
                return stones.length ? stones[0].x : null;
            });
            expect(x).not.toBeNull();
            expect(x).toBeGreaterThan(230 + 5);
        });

        test('a counter-clockwise handle bends the stone left', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setPower(60);
                setSpin(-1);
                throwStone();
                settle();
                return stones.length ? stones[0].x : null;
            });
            expect(x).not.toBeNull();
            expect(x).toBeLessThan(230 - 5);
        });

        test('a stone thrown with no handle stays on the centre line', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setPower(60);
                setSpin(0);
                setAim(0);
                throwStone();
                settle();
                return stones.length ? stones[0].x : null;
            });
            expect(x).toBeCloseTo(230, 1);
        });

        test('a stone that stops short of the hog line is removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                setPower(5);
                throwStone();
                settle();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stone thrown too hard runs through the back line', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                setPower(100);
                setAim(0);
                setSpin(0);
                throwStone();
                settle();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stone that reaches a side line is out of play', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                const s = placeStone(0, 230, 300);
                s.vx = 200;
                state = 'sliding';
                settle();
                return stones.length;
            });
            expect(count).toBe(0);
        });

        test('a stationary stone behind the hog line is not hogged by a collision', async ({ page }) => {
            const survived = await page.evaluate(() => {
                startGame();
                placeStone(1, 230, 300);
                setPower(58);
                setAim(0);
                setSpin(0);
                throwStone();
                settle();
                return stones.some((s) => s.team === 1);
            });
            expect(survived).toBe(true);
        });

        test('a moving stone knocks a stationary one out of the way', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                const target = placeStone(1, 230, 150);
                const before = target.y;
                setPower(95);
                setAim(0);
                setSpin(0);
                throwStone();
                settle();
                return before - target.y;
            });
            expect(moved).toBeGreaterThan(20);
        });

        test('a collision never leaves two stones overlapping', async ({ page }) => {
            const minGap = await page.evaluate(() => {
                startGame();
                placeStone(1, 230, 250);
                setPower(60);
                setAim(0);
                setSpin(0);
                throwStone();
                settle();
                let gap = Infinity;
                for (let i = 0; i < stones.length; i++) {
                    for (let j = i + 1; j < stones.length; j++) {
                        gap = Math.min(gap, Math.hypot(
                            stones[i].x - stones[j].x, stones[i].y - stones[j].y
                        ));
                    }
                }
                return gap;
            });
            expect(minGap).toBeGreaterThanOrEqual(2 * 13 - 0.5);
        });

        test('clicking the sheet delivers the stone', async ({ page }) => {
            await page.locator('#canvas').click({ position: { x: 230, y: 400 } });
            expect(await page.evaluate(() => state)).toBe('sliding');
        });

        test('Space delivers the stone', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('sliding');
        });

        test('moving the mouse over the sheet aims at the pointer', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 330, box.y + 300);
            expect(await page.evaluate(() => aim)).toBeGreaterThan(0);
            await page.mouse.move(box.x + 130, box.y + 300);
            expect(await page.evaluate(() => aim)).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => startMatch(page));

        test('the team with the closest stone scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 155);
                placeStone(1, 230, 190);
                return endResult();
            });
            expect(result).toEqual({ team: 0, points: 1 });
        });

        test('every stone closer than the opponent\'s best counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones = [];
                placeStone(1, 230, 152);
                placeStone(1, 200, 160);
                placeStone(1, 260, 170);
                placeStone(0, 230, 210);
                return endResult();
            });
            expect(result).toEqual({ team: 1, points: 3 });
        });

        test('stones outside the house never count', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 400);
                placeStone(1, 230, 380);
                return endResult();
            });
            expect(result).toEqual({ team: -1, points: 0 });
        });

        test('a stone biting the rings counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 150 + 78 + 12);
                return endResult();
            });
            expect(result).toEqual({ team: 0, points: 1 });
        });

        test('an empty house blanks the end', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones = [];
                return endResult();
            });
            expect(result).toEqual({ team: -1, points: 0 });
        });

        // Reads one linescore row as [end, you, cpu].
        const readRow = (n) => `[...document.querySelectorAll('#linescore .end-${n} td')]
            .map((td) => td.textContent)`;

        test('the linescore records each end as it is played', async ({ page }) => {
            const log = await page.evaluate(() => {
                stones = [];
                placeStone(1, 230, 155);
                placeStone(1, 250, 175);
                scoreEnd();
                return endLog;
            });
            expect(log).toEqual([[0, 2]]);
            expect(await page.evaluate(readRow(1))).toEqual(['1', '0', '2']);
        });

        test('unplayed ends show a dash, a blank end shows nil', async ({ page }) => {
            expect(await page.evaluate(readRow(2))).toEqual(['2', '–', '–']);
            await page.evaluate(() => {
                stones = [];
                scoreEnd();
            });
            expect(await page.evaluate(readRow(1))).toEqual(['1', '0', '0']);
            expect(await page.evaluate(readRow(2))).toEqual(['2', '–', '–']);
        });

        test('a new match empties the linescore', async ({ page }) => {
            const log = await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 155);
                scoreEnd();
                startGame();
                return endLog;
            });
            expect(log).toEqual([]);
        });

        test('scoring an end adds to the scoreboard', async ({ page }) => {
            await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 155);
                placeStone(0, 240, 175);
                placeStone(1, 230, 210);
                scoreEnd();
            });
            expect(await page.evaluate(() => scores)).toEqual([2, 0]);
            await expect(page.locator('#score-you')).toHaveText('2');
        });
    });

    // -----------------------------------------------------------------------
    // Turn and end flow
    // -----------------------------------------------------------------------
    test.describe('flow', () => {
        test.beforeEach(async ({ page }) => startMatch(page));

        test('delivering uses one of the thrower\'s stones', async ({ page }) => {
            await page.evaluate(() => { setPower(60); throwStone(); settle(); });
            expect(await page.evaluate(() => stonesLeft[0])).toBe(3);
        });

        test('the opponent throws after the player', async ({ page }) => {
            const after = await page.evaluate(() => {
                setPower(60);
                throwStone();
                settle();
                return state;
            });
            expect(after).toBe('cpu');
        });

        test('the opponent delivers once its pause elapses', async ({ page }) => {
            const left = await page.evaluate(() => {
                setPower(60);
                throwStone();
                settle();
                settle();
                return stonesLeft[1];
            });
            expect(left).toBe(3);
        });

        test('play returns to the player after the opponent', async ({ page }) => {
            const s = await page.evaluate(() => {
                setPower(60);
                throwStone();
                settle();
                settle();
                return { state, team: currentTeam() };
            });
            expect(s.state).toBe('aiming');
            expect(s.team).toBe(0);
        });

        test('eight stones complete the end', async ({ page }) => {
            const s = await page.evaluate(() => {
                for (let i = 0; i < 16 && state !== 'endover' && state !== 'gameover'; i++) {
                    if (state === 'aiming') { setPower(55 + i); throwStone(); }
                    settle();
                }
                return { state, left: stonesLeft, end: endNumber };
            });
            expect(s.left).toEqual([0, 0]);
            expect(s.state).toBe('endover');
        });

        test('the end result overlay names the outcome', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < 16 && state !== 'endover' && state !== 'gameover'; i++) {
                    if (state === 'aiming') { setPower(55 + i); throwStone(); }
                    settle();
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/end 1/i);
        });

        test('starting the next end clears the sheet and reloads the stones', async ({ page }) => {
            const s = await page.evaluate(() => {
                for (let i = 0; i < 16 && state !== 'endover' && state !== 'gameover'; i++) {
                    if (state === 'aiming') { setPower(55 + i); throwStone(); }
                    settle();
                }
                nextEnd();
                return { end: endNumber, count: stones.length, left: stonesLeft, state };
            });
            expect(s.end).toBe(2);
            expect(s.count).toBe(0);
            expect(s.left).toEqual([4, 4]);
            expect(['aiming', 'cpu']).toContain(s.state);
        });

        test('the lead alternates between ends', async ({ page }) => {
            const leads = await page.evaluate(() => {
                const seen = [leadTeam];
                nextEnd();
                seen.push(leadTeam);
                nextEnd();
                seen.push(leadTeam);
                return seen;
            });
            expect(leads).toEqual([0, 1, 0]);
        });

        test('the match ends after three ends', async ({ page }) => {
            const s = await page.evaluate(() => {
                for (let guard = 0; guard < 200 && state !== 'gameover'; guard++) {
                    if (state === 'aiming') { setPower(50 + (guard % 30)); throwStone(); }
                    else if (state === 'endover') nextEnd();
                    settle();
                }
                return { state, end: endNumber };
            });
            expect(s.state).toBe('gameover');
            expect(s.end).toBe(3);
        });

        test('the final overlay declares a winner or a tie', async ({ page }) => {
            await page.evaluate(() => {
                for (let guard = 0; guard < 200 && state !== 'gameover'; guard++) {
                    if (state === 'aiming') { setPower(50 + (guard % 30)); throwStone(); }
                    else if (state === 'endover') nextEnd();
                    settle();
                }
            });
            await expect(page.locator('#overlay-title')).toContainText(/win|lose|tie/i);
        });

        test('R starts a fresh match', async ({ page }) => {
            await page.evaluate(() => { scores = [2, 1]; endNumber = 3; });
            await page.keyboard.press('r');
            expect(await page.evaluate(() => scores)).toEqual([0, 0]);
            expect(await page.evaluate(() => endNumber)).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Opponent
    // -----------------------------------------------------------------------
    test.describe('opponent', () => {
        test.beforeEach(async ({ page }) => startMatch(page));

        test('simulating a shot leaves the live stones untouched', async ({ page }) => {
            const same = await page.evaluate(() => {
                placeStone(0, 230, 150);
                const before = JSON.stringify(stones);
                simulateThrow(80, 0, 0, 1);
                return JSON.stringify(stones) === before;
            });
            expect(same).toBe(true);
        });

        test('simulating a shot reports where the stones would end up', async ({ page }) => {
            const result = await page.evaluate(() => simulateThrow(60, 0, 0, 1));
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].y).toBeLessThan(645);
        });

        test('the opponent draws into the house on an empty sheet', async ({ page }) => {
            const inHouse = await page.evaluate(() => {
                stones = [];
                stonesLeft = [4, 4];
                shotIndex = 1;
                state = 'cpu';
                cpuTimer = 0;
                settle();
                return stones.filter((s) => s.team === 1 && inHouse(s)).length;
            });
            expect(inHouse).toBeGreaterThan(0);
        });

        test('the opponent plays a takeout at a player stone on the button', async ({ page }) => {
            const shot = await page.evaluate(() => {
                stones = [];
                const target = placeStone(0, 230, 150);
                const startY = target.y;
                stonesLeft = [4, 4];
                shotIndex = 1;
                state = 'cpu';
                cpuTimer = 0;
                settle();
                return {
                    removed: !stones.includes(target),
                    movedBy: Math.hypot(target.x - 230, target.y - startY),
                };
            });
            expect(shot.removed || shot.movedBy > 10).toBe(true);
        });

        test('after the opponent\'s takeout the player is no longer lying shot', async ({ page }) => {
            const shotRock = await page.evaluate(() => {
                stones = [];
                placeStone(0, 230, 150);
                stonesLeft = [4, 4];
                shotIndex = 1;
                state = 'cpu';
                cpuTimer = 0;
                settle();
                const counting = stones.filter(inHouse)
                    .sort((a, b) => buttonDistance(a) - buttonDistance(b));
                return counting.length ? counting[0].team : -1;
            });
            expect(shotRock).not.toBe(0);
        });

        test('a position evaluation favours the team lying closest', async ({ page }) => {
            const v = await page.evaluate(() => {
                const list = [
                    { team: 0, x: 230, y: 152 },
                    { team: 1, x: 230, y: 200 },
                ];
                return { you: evaluatePosition(list, 0), cpu: evaluatePosition(list, 1) };
            });
            expect(v.you).toBeGreaterThan(0);
            expect(v.cpu).toBeLessThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the sheet is drawn on the canvas', async ({ page }) => {
            const blank = await page.evaluate(() => {
                const ctx = document.getElementById('canvas').getContext('2d');
                const data = ctx.getImageData(0, 0, 460, 700).data;
                for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
                return true;
            });
            expect(blank).toBe(false);
        });

        test('a delivered stone is drawn in its team colour', async ({ page }) => {
            await startMatch(page);
            const drawn = await page.evaluate(() => {
                placeStone(0, 230, 150);
                draw();
                const ctx = document.getElementById('canvas').getContext('2d');
                const px = ctx.getImageData(230, 150, 1, 1).data;
                return px[0] > px[2];
            });
            expect(drawn).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game browser integration
    // -----------------------------------------------------------------------
    test.describe('game browser', () => {
        test('Curling is listed in the browser catalogue', async () => {
            const games = require('../../game-browser/src/assets/games.json');
            const entry = games.find((g) => g.id === 'curling');
            expect(entry).toBeTruthy();
            expect(entry.dir).toBe('Curling');
            expect(entry.path).toBe('games/Curling/index.html');
            expect(entry.category).toBe('Sports');
        });

        test('the catalogue stays sorted by id', async () => {
            const games = require('../../game-browser/src/assets/games.json');
            const ids = games.map((g) => g.id);
            expect(ids).toEqual([...ids].sort());
        });
    });
});
