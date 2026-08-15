const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Advance the simulation until every stone has come to rest (or a generous
// frame budget runs out). Returns the number of frames actually simulated so a
// test can assert that the shot really did settle.
async function settle(page) {
    return page.evaluate(() => {
        let frames = 0;
        while (frames < 4000 && state === 'sliding') {
            step(1 / 60);
            frames++;
        }
        return frames;
    });
}

/** Throw a shot with explicit parameters and let it come to rest. */
async function shoot(page, { aim = 0, power = 0.58, spin = 0, sweep = false } = {}) {
    await page.evaluate(
        ([a, p, s, sw]) => {
            setAim(a);
            setPower(p);
            setSpin(s);
            throwStone();
            setSweeping(sw);
        },
        [aim, power, spin, sweep],
    );
    return settle(page);
}

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

        test('canvas is 520x720', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '720');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('both scores start at 0', async ({ page }) => {
            await expect(page.locator('#score-you')).toHaveText('0');
            await expect(page.locator('#score-ai')).toHaveText('0');
        });

        test('the scoreboard starts at end 1 of 3', async ({ page }) => {
            await expect(page.locator('#end-num')).toHaveText('1');
            await expect(page.locator('#end-total')).toHaveText('3');
        });

        test('no stones are on the sheet', async ({ page }) => {
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('stepping while idle changes nothing', async ({ page }) => {
            const changed = await page.evaluate(() => {
                for (let i = 0; i < 60; i++) step(1 / 60);
                return stones.length !== 0 || state !== 'idle';
            });
            expect(changed).toBe(false);
        });

        test('the house sits above the hog line, which sits above the hack', async ({ page }) => {
            const g = await page.evaluate(() => ({
                houseY: HOUSE_Y, hogY: HOG_Y, hackY: HACK_Y, backY: BACK_Y,
                houseX: HOUSE_X, w: CANVAS_W, houseR: HOUSE_R,
            }));
            expect(g.houseX).toBe(g.w / 2);
            expect(g.backY).toBeLessThan(g.houseY);
            expect(g.houseY).toBeLessThan(g.hogY);
            expect(g.hogY).toBeLessThan(g.hackY);
            expect(g.houseR).toBeGreaterThan(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('curling-best', '9'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('9');
        });

        test('throwing before the game starts is ignored', async ({ page }) => {
            await page.evaluate(() => throwStone());
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a match
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the match', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the Start button starts the match', async ({ page }) => {
            await page.click('#btn-start');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the player throws first in end 1', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => currentTeam)).toBe('you');
        });

        test('each team starts the end with a full set of stones', async ({ page }) => {
            await page.keyboard.press('Space');
            const left = await page.evaluate(() => ({
                you: stonesLeft('you'), ai: stonesLeft('ai'), perTeam: STONES_PER_TEAM,
            }));
            expect(left.you).toBe(left.perTeam);
            expect(left.ai).toBe(left.perTeam);
        });

        test('aim, power and spin reset to their defaults', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ aim: aimDeg, power, spin }));
            expect(s.aim).toBe(0);
            expect(s.spin).toBe(0);
            expect(s.power).toBeGreaterThan(0);
            expect(s.power).toBeLessThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming controls
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('left and right arrows swing the aim', async ({ page }) => {
            await page.keyboard.press('ArrowRight');
            const right = await page.evaluate(() => aimDeg);
            expect(right).toBeGreaterThan(0);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            expect(await page.evaluate(() => aimDeg)).toBeLessThan(0);
        });

        test('aim is clamped to the maximum swing', async ({ page }) => {
            const clamped = await page.evaluate(() => {
                setAim(999);
                const hi = aimDeg;
                setAim(-999);
                return { hi, lo: aimDeg, max: AIM_MAX_DEG };
            });
            expect(clamped.hi).toBe(clamped.max);
            expect(clamped.lo).toBe(-clamped.max);
        });

        test('up and down arrows change the power', async ({ page }) => {
            const start = await page.evaluate(() => power);
            await page.keyboard.press('ArrowUp');
            const up = await page.evaluate(() => power);
            expect(up).toBeGreaterThan(start);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => power)).toBeLessThan(up);
        });

        test('power is clamped to 0..1', async ({ page }) => {
            const p = await page.evaluate(() => {
                setPower(5);
                const hi = power;
                setPower(-5);
                return { hi, lo: power };
            });
            expect(p.hi).toBe(1);
            expect(p.lo).toBe(0);
        });

        test('Q and E set the handle (curl direction)', async ({ page }) => {
            await page.keyboard.press('KeyQ');
            expect(await page.evaluate(() => spin)).toBe(-1);
            await page.keyboard.press('KeyE');
            expect(await page.evaluate(() => spin)).toBe(1);
        });

        test('the HUD reflects aim, power and handle', async ({ page }) => {
            await page.evaluate(() => {
                setAim(4);
                setPower(0.75);
                setSpin(1);
            });
            await expect(page.locator('#aim')).toContainText('4');
            await expect(page.locator('#power')).toContainText('75');
            await expect(page.locator('#spin')).toContainText(/in|right|out|left|clock/i);
        });

        test('moving the mouse over the sheet aims the shot', async ({ page }) => {
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 10, box.y + 40);
            expect(await page.evaluate(() => aimDeg)).toBeGreaterThan(0);
            await page.mouse.move(box.x + 10, box.y + 40);
            expect(await page.evaluate(() => aimDeg)).toBeLessThan(0);
        });

        test('aim controls do nothing once the stone is sliding', async ({ page }) => {
            await page.evaluate(() => throwStone());
            const before = await page.evaluate(() => aimDeg);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => aimDeg)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Delivering a stone
    // -----------------------------------------------------------------------
    test.describe('delivery', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('Space delivers the stone and it starts sliding', async ({ page }) => {
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({
                state, n: stones.length, vy: stones[0].vy, team: stones[0].team,
            }));
            expect(s.state).toBe('sliding');
            expect(s.n).toBe(1);
            expect(s.vy).toBeLessThan(0);
            expect(s.team).toBe('you');
        });

        test('the stone leaves from the hack', async ({ page }) => {
            const s = await page.evaluate(() => {
                const stone = throwStone();
                return { x: stone.x, y: stone.y, hx: HOUSE_X, hy: HACK_Y };
            });
            expect(s.x).toBeCloseTo(s.hx, 5);
            expect(s.y).toBeCloseTo(s.hy, 5);
        });

        test('a second throw is refused while a stone is still sliding', async ({ page }) => {
            await page.evaluate(() => {
                throwStone();
                throwStone();
            });
            expect(await page.evaluate(() => stones.length)).toBe(1);
        });

        test('more power means a longer slide', async ({ page }) => {
            const soft = await page.evaluate(() => {
                setPower(0.45);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                return stones[0].y;
            });
            await page.reload();
            await page.keyboard.press('Space');
            const hard = await page.evaluate(() => {
                setPower(0.65);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                return stones[0] ? stones[0].y : -1;
            });
            expect(hard).toBeLessThan(soft);
        });

        test('a stone eventually comes to a complete stop', async ({ page }) => {
            await shoot(page, { power: 0.58 });
            const s = await page.evaluate(() => (stones[0] ? { vx: stones[0].vx, vy: stones[0].vy } : null));
            expect(Math.hypot(s.vx, s.vy)).toBe(0);
        });

        test('a default-power draw finishes in the house', async ({ page }) => {
            await shoot(page, { aim: 0, power: 0.58 });
            const inHouse = await page.evaluate(() => stones.length === 1 && isInHouse(stones[0]));
            expect(inHouse).toBe(true);
        });

        test('aiming right finishes right of centre', async ({ page }) => {
            await shoot(page, { aim: 6, power: 0.58 });
            const x = await page.evaluate(() => (stones[0] ? stones[0].x : null));
            expect(x).toBeGreaterThan(260);
        });

        test('aiming left finishes left of centre', async ({ page }) => {
            await shoot(page, { aim: -6, power: 0.58 });
            const x = await page.evaluate(() => (stones[0] ? stones[0].x : null));
            expect(x).toBeLessThan(260);
        });
    });

    // -----------------------------------------------------------------------
    // Curl and sweeping
    // -----------------------------------------------------------------------
    test.describe('curl and sweeping', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a clockwise handle curls the stone to the right', async ({ page }) => {
            await shoot(page, { aim: 0, power: 0.58, spin: 1 });
            const x = await page.evaluate(() => (stones[0] ? stones[0].x : null));
            expect(x).toBeGreaterThan(260);
        });

        test('a counter-clockwise handle curls the stone to the left', async ({ page }) => {
            await shoot(page, { aim: 0, power: 0.58, spin: -1 });
            const x = await page.evaluate(() => (stones[0] ? stones[0].x : null));
            expect(x).toBeLessThan(260);
        });

        test('no handle means no sideways drift', async ({ page }) => {
            await shoot(page, { aim: 0, power: 0.58, spin: 0 });
            const x = await page.evaluate(() => (stones[0] ? stones[0].x : null));
            expect(Math.abs(x - 260)).toBeLessThan(0.5);
        });

        test('sweeping carries the stone further', async ({ page }) => {
            const plain = await page.evaluate(() => {
                setPower(0.5);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                return stones[0].y;
            });
            await page.reload();
            await page.keyboard.press('Space');
            const swept = await page.evaluate(() => {
                setPower(0.5);
                throwStone();
                setSweeping(true);
                while (state === 'sliding') step(1 / 60);
                return stones[0].y;
            });
            expect(swept).toBeLessThan(plain);
        });

        test('sweeping straightens the curl', async ({ page }) => {
            const plain = await page.evaluate(() => {
                setPower(0.5);
                setSpin(1);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                return stones[0].x;
            });
            await page.reload();
            await page.keyboard.press('Space');
            const swept = await page.evaluate(() => {
                setPower(0.5);
                setSpin(1);
                throwStone();
                setSweeping(true);
                while (state === 'sliding') step(1 / 60);
                return stones[0].x;
            });
            expect(swept - 260).toBeLessThan(plain - 260);
        });

        test('holding Space while the stone slides sweeps it', async ({ page }) => {
            await page.evaluate(() => throwStone());
            await page.keyboard.down('Space');
            expect(await page.evaluate(() => sweeping)).toBe(true);
            await page.keyboard.up('Space');
            expect(await page.evaluate(() => sweeping)).toBe(false);
        });

        test('pressing the mouse on the sheet sweeps while sliding', async ({ page }) => {
            await page.evaluate(() => throwStone());
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            expect(await page.evaluate(() => sweeping)).toBe(true);
            await page.mouse.up();
            expect(await page.evaluate(() => sweeping)).toBe(false);
        });

        test('sweeping stops when the stone comes to rest', async ({ page }) => {
            await page.evaluate(() => {
                throwStone();
                setSweeping(true);
            });
            await settle(page);
            expect(await page.evaluate(() => sweeping)).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Boundary rules
    // -----------------------------------------------------------------------
    test.describe('boundary rules', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a stone short of the hog line is removed', async ({ page }) => {
            await shoot(page, { power: 0 });
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a stone through the back of the house is removed', async ({ page }) => {
            await shoot(page, { power: 1 });
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a stone leaving the side of the sheet is removed', async ({ page }) => {
            await page.evaluate(() => {
                throwStone();
                stones[0].x = STONE_R - 1;
                stones[0].vx = -200;
            });
            await settle(page);
            expect(await page.evaluate(() => stones.length)).toBe(0);
        });

        test('a legal stone stays on the sheet', async ({ page }) => {
            await shoot(page, { power: 0.5 });
            const s = await page.evaluate(() => stones.map((st) => ({ x: st.x, y: st.y })));
            expect(s).toHaveLength(1);
            expect(s[0].y).toBeLessThan(560);
            expect(s[0].y).toBeGreaterThan(60);
        });

        test('a removed stone still uses up the turn', async ({ page }) => {
            await shoot(page, { power: 0 });
            const s = await page.evaluate(() => ({ left: stonesLeft('you'), team: currentTeam, per: STONES_PER_TEAM }));
            expect(s.left).toBe(s.per - 1);
            expect(s.team).toBe('ai');
        });
    });

    // -----------------------------------------------------------------------
    // Stone collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('a moving stone knocks a resting stone away', async ({ page }) => {
            const moved = await page.evaluate(() => {
                stones.push({ x: HOUSE_X, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                const before = stones[0].y;
                throwStone();
                while (state === 'sliding') step(1 / 60);
                const target = stones.find((s) => s.team === 'ai');
                return { before, after: target ? target.y : -1, hit: !!target };
            });
            expect(moved.after).not.toBe(moved.before);
        });

        test('a head-on hit sends the struck stone up the sheet', async ({ page }) => {
            const after = await page.evaluate(() => {
                stones.push({ x: HOUSE_X, y: HOUSE_Y + 60, vx: 0, vy: 0, spin: 0, team: 'ai' });
                setPower(0.8);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                const target = stones.find((s) => s.team === 'ai');
                return target ? target.y : -1;
            });
            // Either driven further up the sheet, or knocked clean out of play.
            expect(after === -1 || after < 230).toBe(true);
        });

        test('stones never end up overlapping', async ({ page }) => {
            const overlap = await page.evaluate(() => {
                stones.push({ x: HOUSE_X, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                setPower(0.6);
                throwStone();
                while (state === 'sliding') step(1 / 60);
                let worst = Infinity;
                for (let i = 0; i < stones.length; i++) {
                    for (let j = i + 1; j < stones.length; j++) {
                        worst = Math.min(worst, Math.hypot(stones[i].x - stones[j].x, stones[i].y - stones[j].y));
                    }
                }
                return worst;
            });
            expect(overlap).toBeGreaterThanOrEqual(27.9);
        });

        test('a collision does not create or destroy energy wildly', async ({ page }) => {
            const speeds = await page.evaluate(() => {
                stones.push({ x: HOUSE_X, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                setPower(0.7);
                const thrown = throwStone();
                const launch = Math.hypot(thrown.vx, thrown.vy);
                let peak = 0;
                while (state === 'sliding') {
                    step(1 / 60);
                    for (const s of stones) peak = Math.max(peak, Math.hypot(s.vx, s.vy));
                }
                return { launch, peak };
            });
            expect(speeds.peak).toBeLessThanOrEqual(speeds.launch + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Turn order
    // -----------------------------------------------------------------------
    test.describe('turn order', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the turn passes to the computer after your stone rests', async ({ page }) => {
            await shoot(page, { power: 0.55 });
            expect(await page.evaluate(() => currentTeam)).toBe('ai');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the computer delivers its own stone after a short pause', async ({ page }) => {
            await shoot(page, { power: 0.55 });
            const aiThrew = await page.evaluate(() => {
                for (let i = 0; i < 300 && currentTeam === 'ai' && state === 'aiming'; i++) step(1 / 60);
                return stones.some((s) => s.team === 'ai') || state === 'sliding';
            });
            expect(aiThrew).toBe(true);
        });

        test('teams alternate through the whole end', async ({ page }) => {
            const order = await page.evaluate(() => {
                const seen = [];
                for (let i = 0; i < 8 && state !== 'break' && state !== 'over'; i++) {
                    const team = currentTeam;
                    seen.push(team);
                    if (team === 'you') {
                        setPower(0.4 + i * 0.02);
                        throwStone();
                    }
                    // Advance exactly one delivery: the turn passing to the
                    // other team is what ends this stone.
                    for (let f = 0; f < 3000; f++) {
                        if (state !== 'sliding' && !(state === 'aiming' && currentTeam === team)) break;
                        step(1 / 60);
                    }
                }
                return seen;
            });
            expect(order).toEqual(['you', 'ai', 'you', 'ai', 'you', 'ai', 'you', 'ai']);
        });

        test('the stone counter drops as stones are thrown', async ({ page }) => {
            await shoot(page, { power: 0.5 });
            expect(await page.evaluate(() => stonesLeft('you'))).toBe(3);
            await expect(page.locator('#stones-you')).toHaveText('3');
        });
    });

    // -----------------------------------------------------------------------
    // Scoring an end
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the closest stone to the button decides who scores', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOUSE_Y + 10, vx: 0, vy: 0, spin: 0, team: 'you' });
                stones.push({ x: HOUSE_X, y: HOUSE_Y + 50, vx: 0, vy: 0, spin: 0, team: 'ai' });
                return scoreEnd();
            });
            expect(result).toEqual({ team: 'you', points: 1 });
        });

        test('every stone closer than the best opponent stone counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                stones.push({ x: HOUSE_X + 20, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                stones.push({ x: HOUSE_X, y: HOUSE_Y + 40, vx: 0, vy: 0, spin: 0, team: 'ai' });
                stones.push({ x: HOUSE_X, y: HOUSE_Y + 60, vx: 0, vy: 0, spin: 0, team: 'you' });
                return scoreEnd();
            });
            expect(result).toEqual({ team: 'ai', points: 3 });
        });

        test('stones outside the house never score', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOG_Y - 20, vx: 0, vy: 0, spin: 0, team: 'you' });
                return scoreEnd();
            });
            expect(result).toEqual({ team: null, points: 0 });
        });

        test('an empty house is a blank end', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                return scoreEnd();
            });
            expect(result).toEqual({ team: null, points: 0 });
        });

        test('a stone biting the outer ring still counts', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOUSE_Y + HOUSE_R + STONE_R - 2, vx: 0, vy: 0, spin: 0, team: 'you' });
                return scoreEnd();
            });
            expect(result).toEqual({ team: 'you', points: 1 });
        });

        test('a stone fully outside the rings does not count', async ({ page }) => {
            const result = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOUSE_Y + HOUSE_R + STONE_R + 2, vx: 0, vy: 0, spin: 0, team: 'you' });
                return scoreEnd();
            });
            expect(result).toEqual({ team: null, points: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // End and match flow
    // -----------------------------------------------------------------------
    test.describe('match flow', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the end closes once all eight stones are thrown', async ({ page }) => {
            const s = await page.evaluate(() => {
                playEnd();
                return { state, left: stonesLeft('you') + stonesLeft('ai') };
            });
            expect(s.state).toBe('break');
            expect(s.left).toBe(0);
        });

        test('the break overlay reports the end result', async ({ page }) => {
            await page.evaluate(() => playEnd());
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/end 1/i);
        });

        test('the scoreboard total matches the points awarded', async ({ page }) => {
            const s = await page.evaluate(() => {
                const res = playEnd();
                return { res, you: scoreYou, ai: scoreAi };
            });
            const awarded = s.res.team === 'you' ? s.you : s.res.team === 'ai' ? s.ai : 0;
            expect(awarded).toBe(s.res.points);
        });

        test('Space continues into the next end', async ({ page }) => {
            await page.evaluate(() => playEnd());
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, end: endNumber, n: stones.length }));
            expect(s.state).toBe('aiming');
            expect(s.end).toBe(2);
            expect(s.n).toBe(0);
        });

        test('the sheet is cleared and stones are restocked for the new end', async ({ page }) => {
            await page.evaluate(() => {
                playEnd();
                nextEnd();
            });
            const s = await page.evaluate(() => ({ n: stones.length, you: stonesLeft('you'), ai: stonesLeft('ai') }));
            expect(s).toEqual({ n: 0, you: 4, ai: 4 });
        });

        test('the team that scored throws first in the next end', async ({ page }) => {
            const first = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'ai' });
                closeEnd();
                nextEnd();
                return currentTeam;
            });
            expect(first).toBe('ai');
        });

        test('a blank end keeps the same order', async ({ page }) => {
            const first = await page.evaluate(() => {
                const before = firstThrower;
                stones.length = 0;
                closeEnd();
                nextEnd();
                return { before, after: firstThrower };
            });
            expect(first.after).toBe(first.before);
        });

        test('the match ends after the last end', async ({ page }) => {
            const s = await page.evaluate(() => {
                for (let i = 0; i < ENDS; i++) {
                    playEnd();
                    if (state === 'break') nextEnd();
                }
                return { state, end: endNumber };
            });
            expect(s.state).toBe('over');
        });

        test('the winner is announced', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < ENDS; i++) {
                    playEnd();
                    if (state === 'break') nextEnd();
                }
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|lose|tie|draw/i);
        });

        test('your best match score is remembered', async ({ page }) => {
            const best = await page.evaluate(() => {
                scoreYou = 5;
                endNumber = ENDS;
                finishMatch();
                return window.localStorage.getItem('curling-best');
            });
            expect(best).toBe('5');
            await expect(page.locator('#best')).toHaveText('5');
        });

        test('Space restarts a finished match', async ({ page }) => {
            await page.evaluate(() => {
                for (let i = 0; i < ENDS; i++) {
                    playEnd();
                    if (state === 'break') nextEnd();
                }
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, end: endNumber, you: scoreYou, ai: scoreAi }));
            expect(s).toEqual({ state: 'aiming', end: 1, you: 0, ai: 0 });
        });

        test('R restarts the match at any time', async ({ page }) => {
            await shoot(page, { power: 0.55 });
            await page.keyboard.press('KeyR');
            const s = await page.evaluate(() => ({ state, end: endNumber, n: stones.length }));
            expect(s).toEqual({ state: 'aiming', end: 1, n: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Computer opponent
    // -----------------------------------------------------------------------
    test.describe('computer opponent', () => {
        test.beforeEach(async ({ page }) => {
            await page.keyboard.press('Space');
        });

        test('the computer plans a legal shot', async ({ page }) => {
            const plan = await page.evaluate(() => planAiShot());
            expect(Math.abs(plan.aim)).toBeLessThanOrEqual(12);
            expect(plan.power).toBeGreaterThan(0);
            expect(plan.power).toBeLessThanOrEqual(1);
            expect([-1, 0, 1]).toContain(plan.spin);
        });

        test('the computer draws into the house on an empty sheet', async ({ page }) => {
            const inHouse = await page.evaluate(() => {
                stones.length = 0;
                currentTeam = 'ai';
                aiThrow();
                while (state === 'sliding') step(1 / 60);
                return stones.some((s) => s.team === 'ai' && isInHouse(s));
            });
            expect(inHouse).toBe(true);
        });

        test('the computer aims at your stone when you are sitting shot', async ({ page }) => {
            const aimed = await page.evaluate(() => {
                stones.length = 0;
                stones.push({ x: HOUSE_X + 40, y: HOUSE_Y, vx: 0, vy: 0, spin: 0, team: 'you' });
                currentTeam = 'ai';
                const plan = planAiShot();
                return plan.aim;
            });
            expect(aimed).toBeGreaterThan(0);
        });

        test('the computer plays a full end without leaving the sheet in a bad state', async ({ page }) => {
            const s = await page.evaluate(() => {
                playEnd();
                return {
                    state,
                    onSheet: stones.length,
                    legal: stones.every((st) => st.y > BACK_Y && st.y < HOG_Y && st.x > 0 && st.x < CANVAS_W),
                };
            });
            expect(s.state).toBe('break');
            expect(s.legal).toBe(true);
            expect(s.onSheet).toBeLessThanOrEqual(8);
        });
    });

    // -----------------------------------------------------------------------
    // Pause
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes the match', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('a paused game does not simulate', async ({ page }) => {
            await page.keyboard.press('Space');
            const still = await page.evaluate(() => {
                throwStone();
                togglePause();
                const before = { x: stones[0].x, y: stones[0].y };
                for (let i = 0; i < 60; i++) step(1 / 60);
                return stones[0].x === before.x && stones[0].y === before.y;
            });
            expect(still).toBe(true);
        });

        test('pausing before the match starts does nothing', async ({ page }) => {
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the sheet is drawn on the canvas', async ({ page }) => {
            const blank = await page.evaluate(() => {
                const c = document.getElementById('canvas');
                const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) return false;
                }
                return true;
            });
            expect(blank).toBe(false);
        });

        test('a thrown stone is drawn where the model says it is', async ({ page }) => {
            await page.keyboard.press('Space');
            await shoot(page, { power: 0.58 });
            const painted = await page.evaluate(() => {
                draw();
                const s = stones[0];
                const c = document.getElementById('canvas');
                const px = c.getContext('2d').getImageData(Math.round(s.x), Math.round(s.y), 1, 1).data;
                return px[3] > 0;
            });
            expect(painted).toBe(true);
        });

        test('the page has no console errors', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.reload();
            await page.keyboard.press('Space');
            await shoot(page, { power: 0.58 });
            expect(errors).toEqual([]);
        });
    });
});
