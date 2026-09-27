const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// The game exposes its state and logic as plain globals (the same convention as
// Kaboom, Snake and Tetris in this repo), and all motion is advanced through
// `step(dt)`, so shots can be simulated deterministically without depending on
// requestAnimationFrame wall-clock timing. The helpers below are source
// fragments spliced into `page.evaluate` expressions.

// Runs the table until every ball has stopped (or a generous budget is spent).
const SETTLE = `for (let i = 0; i < 4000 && !allStopped(); i++) step(1 / 120);`;

// Leaves only the listed object balls on the table; everything else is potted.
const KEEP_ONLY = `
    const keepOnly = (ids) => balls.forEach((b) => {
        if (b.id !== 0) b.potted = !ids.includes(b.id);
    });
`;

// A clean straight 45-degree pot: the object ball at (700, 340) sits on the
// diagonal into the bottom-right pocket and the cue ball at (600, 240) lines up
// squarely behind it. Any other ball still on the table is parked in the
// top-left corner, well clear of the shot line.
const POT_SHOT = (targetId) => `
    const target = ballById(${targetId});
    target.potted = false;
    target.x = 700; target.y = 340; target.vx = 0; target.vy = 0;
    let parked = 0;
    balls.forEach((b) => {
        if (b.potted || b.id === 0 || b.id === ${targetId}) return;
        b.x = PLAY.x0 + 20 + (parked % 3) * 24;
        b.y = PLAY.y0 + 20 + Math.floor(parked / 3) * 24;
        b.vx = 0; b.vy = 0;
        parked++;
    });
    cue.x = 600; cue.y = 240; cue.vx = 0; cue.vy = 0; cue.potted = false;
    setAim(Math.PI / 4);
    setPower(0.55);
    shoot();
    ${SETTLE}
`;

// Builds a full evaluate expression from a body of page-side statements.
const run = (body) => `(() => {\n${body}\n})()`;

test.describe('8-Ball Pool', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is 8-Ball Pool', async ({ page }) => {
            await expect(page).toHaveTitle('8-Ball Pool');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('canvas is 800x440', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '440');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the table has six pockets', async ({ page }) => {
            expect(await page.evaluate(() => pockets.length)).toBe(6);
        });
    });

    // -----------------------------------------------------------------------
    // Racking
    // -----------------------------------------------------------------------
    test.describe('racking', () => {
        test('Space starts the game and moves to aiming', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('aiming');
        });

        test('the rack holds a cue ball plus 15 object balls', async ({ page }) => {
            const info = await page.evaluate(run(`
                startGame();
                return {
                    total: balls.length,
                    potted: balls.filter((b) => b.potted).length,
                    solids: balls.filter((b) => b.type === 'solid').length,
                    stripes: balls.filter((b) => b.type === 'stripe').length,
                    eights: balls.filter((b) => b.type === 'eight').length,
                    cues: balls.filter((b) => b.type === 'cue').length,
                };
            `));
            expect(info).toEqual({ total: 16, potted: 0, solids: 7, stripes: 7, eights: 1, cues: 1 });
        });

        test('the cue ball starts on the head spot, left of the rack', async ({ page }) => {
            const info = await page.evaluate(run(`
                startGame();
                const apex = Math.min(...balls.filter((b) => b.id !== 0).map((b) => b.x));
                return { x: cue.x, y: cue.y, head: HEAD.x, headY: HEAD.y, apex };
            `));
            expect(info.x).toBeCloseTo(info.head, 5);
            expect(info.y).toBeCloseTo(info.headY, 5);
            expect(info.x).toBeLessThan(info.apex);
        });

        test('the 8 ball sits in the middle of the rack', async ({ page }) => {
            const centred = await page.evaluate(run(`
                startGame();
                return Math.abs(ballById(8).y - (PLAY.y0 + PLAY.y1) / 2) < 1;
            `));
            expect(centred).toBe(true);
        });

        test('no two balls overlap in the rack', async ({ page }) => {
            const overlapping = await page.evaluate(run(`
                startGame();
                for (let i = 0; i < balls.length; i++) {
                    for (let j = i + 1; j < balls.length; j++) {
                        const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
                        if (d < 2 * R - 0.001) return true;
                    }
                }
                return false;
            `));
            expect(overlapping).toBe(false);
        });

        test('every ball is racked inside the cushions', async ({ page }) => {
            const inside = await page.evaluate(run(`
                startGame();
                return balls.every((b) => b.x >= PLAY.x0 + R && b.x <= PLAY.x1 - R
                    && b.y >= PLAY.y0 + R && b.y <= PLAY.y1 - R);
            `));
            expect(inside).toBe(true);
        });

        test('both players start with no group and player 1 to break', async ({ page }) => {
            const info = await page.evaluate(run(`
                startGame();
                return { p1: players[0].group, p2: players[1].group, turn: currentPlayer };
            `));
            expect(info).toEqual({ p1: null, p2: null, turn: 0 });
        });
    });

    // -----------------------------------------------------------------------
    // Aiming & shooting
    // -----------------------------------------------------------------------
    test.describe('aiming and shooting', () => {
        test('setAim sets the aim angle', async ({ page }) => {
            const a = await page.evaluate(run(`startGame(); setAim(1.25); return aimAngle;`));
            expect(a).toBeCloseTo(1.25, 5);
        });

        test('setPower clamps power between 0 and 1', async ({ page }) => {
            const p = await page.evaluate(run(`
                startGame();
                setPower(5);
                const high = power;
                setPower(-3);
                return { high, low: power };
            `));
            expect(p.high).toBe(1);
            expect(p.low).toBe(0);
        });

        test('shooting launches the cue ball along the aim angle', async ({ page }) => {
            const v = await page.evaluate(run(`
                startGame();
                setAim(0);
                setPower(1);
                shoot();
                return { vx: cue.vx, vy: cue.vy, state };
            `));
            expect(v.vx).toBeGreaterThan(0);
            expect(Math.abs(v.vy)).toBeLessThan(0.001);
            expect(v.state).toBe('rolling');
        });

        test('shot power scales the cue ball speed', async ({ page }) => {
            const s = await page.evaluate(run(`
                startGame();
                setAim(0);
                setPower(0.25);
                shoot();
                const soft = Math.hypot(cue.vx, cue.vy);
                startGame();
                setAim(0);
                setPower(1);
                shoot();
                return { soft, hard: Math.hypot(cue.vx, cue.vy) };
            `));
            expect(s.hard).toBeGreaterThan(s.soft);
        });

        test('a shot with zero power is rejected', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                setPower(0);
                return { fired: shoot(), state };
            `));
            expect(r.fired).toBe(false);
            expect(r.state).toBe('aiming');
        });

        test('the cue ball cannot be struck while the table is rolling', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                setAim(0);
                setPower(1);
                shoot();
                const vx = cue.vx;
                setAim(Math.PI);
                setPower(1);
                const fired = shoot();
                return { fired, same: cue.vx === vx };
            `));
            expect(r.fired).toBe(false);
            expect(r.same).toBe(true);
        });

        test('ArrowLeft and ArrowRight rotate the aim', async ({ page }) => {
            await page.evaluate(run(`startGame(); setAim(0);`));
            await page.keyboard.press('ArrowRight');
            const right = await page.evaluate(() => aimAngle);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const left = await page.evaluate(() => aimAngle);
            expect(right).toBeGreaterThan(0);
            expect(left).toBeLessThan(right);
        });

        test('moving the mouse aims the cue at the pointer', async ({ page }) => {
            await page.evaluate(run(`startGame(); setAim(0);`));
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 300, box.y + 400);
            const aim = await page.evaluate(() => aimAngle);
            expect(aim).toBeCloseTo(Math.atan2(400 - 220, 300 - 220), 1);
        });

        test('pressing and releasing the mouse charges and takes the shot', async ({ page }) => {
            await page.evaluate(run(`startGame(); setPower(0);`));
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 600, box.y + 220);
            await page.mouse.down();
            await page.waitForTimeout(400);
            const charged = await page.evaluate(() => ({ power, charging }));
            await page.mouse.up();
            const after = await page.evaluate(() => state);
            expect(charged.charging).toBe(true);
            expect(charged.power).toBeGreaterThan(0);
            expect(after).toBe('rolling');
        });

        test('holding Space charges power and releasing takes the shot', async ({ page }) => {
            await page.evaluate(run(`startGame(); setAim(0); setPower(0);`));
            await page.keyboard.down('Space');
            const charged = await page.evaluate(run(`
                for (let i = 0; i < 30; i++) step(1 / 60);
                return power;
            `));
            await page.keyboard.up('Space');
            const after = await page.evaluate(() => state);
            expect(charged).toBeGreaterThan(0);
            expect(after).toBe('rolling');
        });
    });

    // -----------------------------------------------------------------------
    // Physics
    // -----------------------------------------------------------------------
    test.describe('physics', () => {
        test('a rolling ball slows to a stop', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                cue.vx = 300;
                cue.vy = 0;
                for (let i = 0; i < 20; i++) step(1 / 120);
                const mid = Math.hypot(cue.vx, cue.vy);
                for (let i = 0; i < 4000; i++) step(1 / 120);
                return { mid, end: Math.hypot(cue.vx, cue.vy) };
            `));
            expect(r.mid).toBeLessThan(300);
            expect(r.mid).toBeGreaterThan(0);
            expect(r.end).toBe(0);
        });

        test('a ball bounces off a cushion', async ({ page }) => {
            const bounced = await page.evaluate(run(`
                startGame();
                balls.forEach((b) => { if (b.id !== 0) b.potted = true; });
                cue.x = 300; cue.y = 220; cue.vx = -500; cue.vy = 0;
                let sawBounce = false;
                for (let i = 0; i < 2000; i++) {
                    step(1 / 120);
                    if (cue.vx > 0) sawBounce = true;
                }
                return sawBounce;
            `));
            expect(bounced).toBe(true);
        });

        test('balls never leave the cushions', async ({ page }) => {
            const inside = await page.evaluate(run(`
                startGame();
                setAim(0.7);
                setPower(1);
                shoot();
                for (let i = 0; i < 4000; i++) {
                    step(1 / 120);
                    for (const b of balls) {
                        if (b.potted) continue;
                        if (b.x < PLAY.x0 + R - 0.5 || b.x > PLAY.x1 - R + 0.5) return false;
                        if (b.y < PLAY.y0 + R - 0.5 || b.y > PLAY.y1 - R + 0.5) return false;
                    }
                }
                return true;
            `));
            expect(inside).toBe(true);
        });

        test('balls never end a shot overlapping each other', async ({ page }) => {
            const clean = await page.evaluate(run(`
                startGame();
                setAim(0.05);
                setPower(1);
                shoot();
                ${SETTLE}
                const live = balls.filter((b) => !b.potted);
                for (let i = 0; i < live.length; i++) {
                    for (let j = i + 1; j < live.length; j++) {
                        const d = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y);
                        if (d < 2 * R - 0.5) return false;
                    }
                }
                return true;
            `));
            expect(clean).toBe(true);
        });

        test('a moving ball drives a resting ball forward', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                balls.forEach((b) => { if (b.id !== 0 && b.id !== 1) b.potted = true; });
                const one = ballById(1);
                one.x = 400; one.y = 220; one.vx = 0; one.vy = 0;
                cue.x = 200; cue.y = 220; cue.vx = 400; cue.vy = 0;
                let peak = 0;
                for (let i = 0; i < 400; i++) {
                    step(1 / 120);
                    peak = Math.max(peak, Math.hypot(one.vx, one.vy));
                }
                return { targetX: one.x, peak, cueV: Math.hypot(cue.vx, cue.vy) };
            `));
            expect(r.targetX).toBeGreaterThan(400);
            expect(r.peak).toBeGreaterThan(100);
            expect(r.cueV).toBeLessThan(100);
        });

        test('a ball reaching a pocket is potted and stops', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                const one = ballById(1);
                one.x = pockets[0].x;
                one.y = pockets[0].y;
                one.vx = 60;
                step(1 / 120);
                return { potted: one.potted, speed: Math.hypot(one.vx, one.vy) };
            `));
            expect(r.potted).toBe(true);
            expect(r.speed).toBe(0);
        });

        test('allStopped reports motion on the table', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                const before = allStopped();
                cue.vx = 200;
                const moving = allStopped();
                for (let i = 0; i < 4000; i++) step(1 / 120);
                return { before, moving, after: allStopped() };
            `));
            expect(r.before).toBe(true);
            expect(r.moving).toBe(false);
            expect(r.after).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Turn & group rules
    // -----------------------------------------------------------------------
    test.describe('rules', () => {
        test('an open table is assigned by the first ball potted', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                keepOnly([1, 8]);
                ${POT_SHOT(1)}
                return {
                    p1: players[0].group,
                    p2: players[1].group,
                    turn: currentPlayer,
                    potted: ballById(1).potted,
                };
            `));
            expect(r.potted).toBe(true);
            expect(r.p1).toBe('solid');
            expect(r.p2).toBe('stripe');
            expect(r.turn).toBe(0);
        });

        test('potting a stripe first gives the breaker the stripes', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                keepOnly([9, 8]);
                ${POT_SHOT(9)}
                return { p1: players[0].group, p2: players[1].group };
            `));
            expect(r.p1).toBe('stripe');
            expect(r.p2).toBe('solid');
        });

        test('potting one of your own balls keeps the turn', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([1, 8]);
                ${POT_SHOT(1)}
                return { turn: currentPlayer, potted: ballById(1).potted, foul };
            `));
            expect(r.potted).toBe(true);
            expect(r.foul).toBe(false);
            expect(r.turn).toBe(0);
        });

        test('hitting your own ball but potting nothing passes the turn', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([1, 8]);
                const one = ballById(1);
                one.x = 400; one.y = 220; one.vx = 0; one.vy = 0;
                ballById(8).x = 200; ballById(8).y = 100;
                cue.x = 200; cue.y = 220;
                setAim(0);
                setPower(0.4);
                shoot();
                ${SETTLE}
                return { turn: currentPlayer, potted: one.potted, foul, movedTo: one.x };
            `));
            expect(r.potted).toBe(false);
            expect(r.movedTo).toBeGreaterThan(400);
            expect(r.foul).toBe(false);
            expect(r.turn).toBe(1);
        });

        test('striking an opponent ball first is a foul and passes the turn', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([9, 8]);
                const nine = ballById(9);
                nine.x = 400; nine.y = 220; nine.vx = 0; nine.vy = 0;
                ballById(8).x = 200; ballById(8).y = 100;
                cue.x = 200; cue.y = 220;
                setAim(0);
                setPower(0.4);
                shoot();
                ${SETTLE}
                return { turn: currentPlayer, foul, message };
            `));
            expect(r.foul).toBe(true);
            expect(r.turn).toBe(1);
            expect(r.message).toMatch(/wrong ball/i);
        });

        test('potting an opponent ball does not earn another shot', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([9, 8]);
                ${POT_SHOT(9)}
                return { turn: currentPlayer, potted: ballById(9).potted };
            `));
            expect(r.potted).toBe(true);
            expect(r.turn).toBe(1);
        });

        test('hitting nothing at all is a foul', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([1, 8]);
                ballById(1).x = 400; ballById(1).y = 100;
                ballById(8).x = 600; ballById(8).y = 100;
                cue.x = 200; cue.y = 350;
                setAim(0);
                setPower(0.15);
                shoot();
                ${SETTLE}
                return { foul, turn: currentPlayer, message };
            `));
            expect(r.foul).toBe(true);
            expect(r.turn).toBe(1);
            expect(r.message).toMatch(/no ball/i);
        });

        test('potting the cue ball is a scratch that respots it and passes the turn', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                keepOnly([1, 8]);
                ballById(1).x = 600; ballById(1).y = 100;
                ballById(8).x = 650; ballById(8).y = 150;
                cue.x = 220; cue.y = 220;
                setAim(Math.PI + Math.PI / 4);
                setPower(1);
                shoot();
                ${SETTLE}
                return {
                    message,
                    onTable: !cue.potted,
                    x: cue.x,
                    y: cue.y,
                    foul,
                    turn: currentPlayer,
                };
            `));
            expect(r.message).toMatch(/scratch/i);
            expect(r.onTable).toBe(true);
            expect(r.foul).toBe(true);
            expect(r.turn).toBe(1);
            expect(r.x).toBeGreaterThan(0);
        });

        test('a respotted cue ball never overlaps another ball', async ({ page }) => {
            const clear = await page.evaluate(run(`
                startGame();
                // Park an object ball right on the head spot before respotting.
                ballById(1).x = HEAD.x;
                ballById(1).y = HEAD.y;
                cue.potted = true;
                respotCue();
                return !cue.potted && balls.every((b) => b === cue || b.potted
                    || Math.hypot(b.x - cue.x, b.y - cue.y) >= 2 * R - 0.001);
            `));
            expect(clear).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Winning and losing
    // -----------------------------------------------------------------------
    test.describe('the 8 ball', () => {
        test('potting the 8 before clearing your group loses the game', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([1, 8]);
                ${POT_SHOT(8)}
                return { state, winner, message };
            `));
            expect(r.state).toBe('over');
            expect(r.winner).toBe(1);
            expect(r.message).toMatch(/player 2/i);
        });

        test('potting the 8 after clearing your group wins the game', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                keepOnly([8, 9, 10]);
                ${POT_SHOT(8)}
                return { state, winner };
            `));
            expect(r.state).toBe('over');
            expect(r.winner).toBe(0);
        });

        test('player 2 can win the game too', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                currentPlayer = 1;
                keepOnly([8, 1, 2]);
                ${POT_SHOT(8)}
                return { state, winner };
            `));
            expect(r.state).toBe('over');
            expect(r.winner).toBe(1);
        });

        test('potting the 8 on an open table loses the game', async ({ page }) => {
            const r = await page.evaluate(run(`
                ${KEEP_ONLY}
                startGame();
                keepOnly([1, 8]);
                ${POT_SHOT(8)}
                return { state, winner };
            `));
            expect(r.state).toBe('over');
            expect(r.winner).toBe(1);
        });

        test('the game over overlay names the winner and offers a rematch', async ({ page }) => {
            await page.evaluate(run(`startGame(); endGame(0);`));
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/player 1/i);
            await expect(page.locator('#btn-start')).toHaveText(/again|rematch/i);
        });

        test('groupCleared knows when a group is finished', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                const before = groupCleared(0);
                balls.forEach((b) => { if (b.type === 'solid') b.potted = true; });
                return { before, after: groupCleared(0) };
            `));
            expect(r.before).toBe(false);
            expect(r.after).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // HUD
    // -----------------------------------------------------------------------
    test.describe('hud', () => {
        test('the turn indicator follows the active player', async ({ page }) => {
            await page.evaluate(run(`startGame();`));
            await expect(page.locator('#turn')).toContainText(/player 1/i);
            await page.evaluate(run(`currentPlayer = 1; updateHud();`));
            await expect(page.locator('#turn')).toContainText(/player 2/i);
        });

        test('group labels are unset until the table is assigned', async ({ page }) => {
            await page.evaluate(run(`startGame();`));
            await expect(page.locator('#p1-group')).toHaveText('—');
            await page.evaluate(run(`
                players[0].group = 'stripe';
                players[1].group = 'solid';
                updateHud();
            `));
            await expect(page.locator('#p1-group')).toHaveText(/stripes/i);
            await expect(page.locator('#p2-group')).toHaveText(/solids/i);
        });

        test('remaining counts drop as balls are potted', async ({ page }) => {
            await page.evaluate(run(`
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                ballById(1).potted = true;
                ballById(2).potted = true;
                updateHud();
            `));
            await expect(page.locator('#p1-count')).toHaveText('5');
            await expect(page.locator('#p2-count')).toHaveText('7');
        });

        test('the message line reports what happened', async ({ page }) => {
            await page.evaluate(run(`startGame(); setMessage('Nice shot');`));
            await expect(page.locator('#message')).toHaveText('Nice shot');
        });

        test('the power meter reflects the charged power', async ({ page }) => {
            await page.evaluate(run(`startGame(); setPower(0.5);`));
            const width = await page.locator('#power-fill').evaluate((el) => el.style.width);
            expect(parseFloat(width)).toBeCloseTo(50, 1);
        });
    });

    // -----------------------------------------------------------------------
    // Restarting
    // -----------------------------------------------------------------------
    test.describe('restarting', () => {
        test('a rematch re-racks the table and resets the players', async ({ page }) => {
            const r = await page.evaluate(run(`
                startGame();
                players[0].group = 'solid';
                players[1].group = 'stripe';
                currentPlayer = 1;
                balls.forEach((b) => { b.potted = b.id !== 0; });
                endGame(1);
                startGame();
                return {
                    state,
                    potted: balls.filter((b) => b.potted).length,
                    p1: players[0].group,
                    turn: currentPlayer,
                    winner,
                };
            `));
            expect(r.state).toBe('aiming');
            expect(r.potted).toBe(0);
            expect(r.p1).toBe(null);
            expect(r.turn).toBe(0);
            expect(r.winner).toBe(null);
        });

        test('R re-racks a finished game', async ({ page }) => {
            await page.evaluate(run(`startGame(); endGame(0);`));
            await page.keyboard.press('r');
            expect(await page.evaluate(() => state)).toBe('aiming');
        });
    });
});
