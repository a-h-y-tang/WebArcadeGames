const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
//
// The game exposes its state and a `step(dt)` simulation function as globals so
// that frames can be simulated deterministically. `autoAdvance = false` freezes
// the requestAnimationFrame loop, and `giftChance` pins the gift drop rate, so a
// physics or scoring test sees nothing it did not ask for.
// ---------------------------------------------------------------------------

async function freeze(page) {
    await page.evaluate(() => {
        autoAdvance = false;
        giftChance = 0;
    });
}

// Start field 1 with the loop frozen and no gift drops.
async function startFrozen(page) {
    await freeze(page);
    await page.evaluate(() => startGame());
}

// Start and launch the stone, so the simulation is running.
async function playFrozen(page) {
    await startFrozen(page);
    await page.evaluate(() => launch());
}

// Place the only stone just below a field stone and let it rise into it.
// Returns the number of hits that landed (0 or 1).
async function strike(page, r, c) {
    return page.evaluate(([r, c]) => {
        const rect = brickRect(r, c);
        const before = bricks[r][c] ? bricks[r][c].hp : 0;
        const b = balls[0];
        b.x = rect.x + rect.w / 2;
        b.y = rect.y + rect.h + b.r + 1;
        b.vx = 0;
        b.vy = -220;
        b.held = false;
        for (let i = 0; i < 40; i++) {
            step(1 / 240);
            const now = bricks[r][c] ? bricks[r][c].hp : 0;
            if (now !== before) return 1;
        }
        return 0;
    }, [r, c]);
}

// The lowest stone of a given kind with nothing underneath it, so the stone can
// be sent straight up into it from below.
async function findBrick(page, type) {
    return page.evaluate((type) => {
        for (let r = bricks.length - 1; r >= 0; r--) {
            for (let c = 0; c < bricks[r].length; c++) {
                const below = r + 1 < bricks.length ? bricks[r + 1][c] : null;
                if (bricks[r][c] && bricks[r][c].type === type && !below) return { r, c };
            }
        }
        return null;
    }, type);
}

async function steps(page, n, dt = 1 / 120) {
    await page.evaluate(([n, dt]) => {
        for (let i = 0; i < n; i++) step(dt);
    }, [n, dt]);
}

test.describe('Gather the Stones', () => {
    const errors = [];

    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Gather the Stones', async ({ page }) => {
            await expect(page).toHaveTitle('Gather the Stones');
        });

        test('canvas is 520x600', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '520');
            await expect(canvas).toHaveAttribute('height', '600');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('HUD starts at no score, three workers, field 1', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#lives')).toHaveText('3');
            await expect(page.locator('#field')).toHaveText('1');
        });

        test('the title overlay invites the player to start', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
            expect(await page.evaluate(() => state)).toBe('title');
        });

        test('the Isaiah 5:2 verse is on the page', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('Isaiah 5:2');
            await expect(page.locator('#verse')).toContainText(/stones/i);
        });

        test('the field and the stone grid fit inside the canvas', async ({ page }) => {
            const fits = await page.evaluate(() => {
                const last = brickRect(GRID_ROWS - 1, COLS - 1);
                const first = brickRect(0, 0);
                return (
                    FIELD.x >= 0 &&
                    FIELD.y >= 0 &&
                    FIELD.x + FIELD.w <= canvas.width + 0.001 &&
                    first.x >= FIELD.x - 0.001 &&
                    first.y >= FIELD.y - 0.001 &&
                    last.x + last.w <= FIELD.x + FIELD.w + 0.001 &&
                    last.y + last.h < paddle.y
                );
            });
            expect(fits).toBe(true);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('gather-the-stones-best', '3400'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('3400');
        });

        test('stepping on the title screen does not move anything', async ({ page }) => {
            const moved = await page.evaluate(() => {
                autoAdvance = false;
                const before = JSON.stringify(balls);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return JSON.stringify(balls) !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -------------------------------------------------------------------
    // Starting a field
    // -------------------------------------------------------------------
    test.describe('starting a field', () => {
        test('Space starts the first field and hides the overlay', async ({ page }) => {
            await freeze(page);
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('ready');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('the start button starts the first field', async ({ page }) => {
            await freeze(page);
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('ready');
        });

        test('the field is laid out with stones to gather', async ({ page }) => {
            await startFrozen(page);
            expect(await page.evaluate(() => aliveBreakable())).toBeGreaterThan(10);
            await expect(page.locator('#stones')).not.toHaveText('0');
        });

        test('the stone rests on the basket before launch', async ({ page }) => {
            await startFrozen(page);
            const ball = await page.evaluate(() => ({ ...balls[0], px: paddle.x, py: paddle.y }));
            expect(ball.held).toBe(true);
            expect(ball.x).toBeCloseTo(ball.px, 1);
            expect(ball.y).toBeLessThan(ball.py);
        });

        test('a held stone does not fall when frames pass', async ({ page }) => {
            await startFrozen(page);
            const before = await page.evaluate(() => balls[0].y);
            await steps(page, 60);
            expect(await page.evaluate(() => balls[0].y)).toBeCloseTo(before, 3);
        });

        test('moving the basket carries the held stone', async ({ page }) => {
            await startFrozen(page);
            const moved = await page.evaluate(() => {
                paddle.x -= 60;
                step(1 / 120);
                return balls[0].x - paddle.x;
            });
            expect(Math.abs(moved)).toBeLessThan(0.01);
        });
    });

    // -------------------------------------------------------------------
    // The basket
    // -------------------------------------------------------------------
    test.describe('the basket', () => {
        test('follows the mouse across the field', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 150, box.y + 40);
            const x = await page.evaluate(() => paddle.x);
            expect(x).toBeCloseTo(150, 0);
        });

        test('is clamped inside the left wall', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 2, box.y + 40);
            const ok = await page.evaluate(() => paddle.x - paddle.w / 2 >= FIELD.x - 0.001);
            expect(ok).toBe(true);
        });

        test('is clamped inside the right wall', async ({ page }) => {
            await startFrozen(page);
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width - 2, box.y + 40);
            const ok = await page.evaluate(
                () => paddle.x + paddle.w / 2 <= FIELD.x + FIELD.w + 0.001
            );
            expect(ok).toBe(true);
        });

        test('arrow keys move the basket left and right', async ({ page }) => {
            await startFrozen(page);
            const start = await page.evaluate(() => paddle.x);
            await page.keyboard.down('ArrowRight');
            await steps(page, 30);
            await page.keyboard.up('ArrowRight');
            const right = await page.evaluate(() => paddle.x);
            expect(right).toBeGreaterThan(start + 20);

            await page.keyboard.down('ArrowLeft');
            await steps(page, 30);
            await page.keyboard.up('ArrowLeft');
            expect(await page.evaluate(() => paddle.x)).toBeLessThan(right - 20);
        });

        test('A and D move the basket too', async ({ page }) => {
            await startFrozen(page);
            const start = await page.evaluate(() => paddle.x);
            await page.keyboard.down('KeyD');
            await steps(page, 30);
            await page.keyboard.up('KeyD');
            expect(await page.evaluate(() => paddle.x)).toBeGreaterThan(start + 20);
        });

        test('a finger dragged across the field moves the basket', async ({ page }) => {
            await startFrozen(page);
            const x = await page.evaluate(() => {
                const rect = canvas.getBoundingClientRect();
                const touch = new Touch({
                    identifier: 1,
                    target: canvas,
                    clientX: rect.left + 180,
                    clientY: rect.top + 500,
                });
                canvas.dispatchEvent(
                    new TouchEvent('touchmove', { touches: [touch], changedTouches: [touch], bubbles: true, cancelable: true })
                );
                return paddle.x;
            });
            expect(x).toBeCloseTo(180, 0);
        });

        test('keyboard movement stays inside the walls', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.down('ArrowLeft');
            await steps(page, 400);
            await page.keyboard.up('ArrowLeft');
            const ok = await page.evaluate(() => paddle.x - paddle.w / 2 >= FIELD.x - 0.001);
            expect(ok).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Launching
    // -------------------------------------------------------------------
    test.describe('launching the stone', () => {
        test('Space launches the stone upward', async ({ page }) => {
            await startFrozen(page);
            await page.keyboard.press('Space');
            const ball = await page.evaluate(() => ({ ...balls[0], st: state }));
            expect(ball.held).toBe(false);
            expect(ball.vy).toBeLessThan(0);
            expect(ball.st).toBe('playing');
        });

        test('clicking the field launches the stone', async ({ page }) => {
            await startFrozen(page);
            await page.locator('#canvas').click({ position: { x: 260, y: 560 } });
            expect(await page.evaluate(() => balls[0].held)).toBe(false);
        });

        test('the launched stone travels at the field speed', async ({ page }) => {
            await playFrozen(page);
            const ok = await page.evaluate(() => {
                const b = balls[0];
                return Math.abs(Math.hypot(b.vx, b.vy) - ballSpeed()) < 0.5;
            });
            expect(ok).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Bouncing
    // -------------------------------------------------------------------
    test.describe('bouncing', () => {
        test('bounces off the left wall', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                const b = balls[0];
                b.x = FIELD.x + b.r + 2;
                b.y = 400;
                b.vx = -300;
                b.vy = 0;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return { vx: b.vx, x: b.x, r: b.r };
            });
            expect(res.vx).toBeGreaterThan(0);
            expect(res.x).toBeGreaterThanOrEqual(14 + res.r - 0.001);
        });

        test('bounces off the right wall', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                const b = balls[0];
                b.x = FIELD.x + FIELD.w - b.r - 2;
                b.y = 400;
                b.vx = 300;
                b.vy = 0;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return { vx: b.vx, inside: b.x + b.r <= FIELD.x + FIELD.w + 0.001 };
            });
            expect(res.vx).toBeLessThan(0);
            expect(res.inside).toBe(true);
        });

        test('bounces off the top of the field', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                const b = balls[0];
                b.x = 260;
                b.y = FIELD.y + b.r + 2;
                b.vx = 0;
                b.vy = -300;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return { vy: b.vy, inside: b.y - b.r >= FIELD.y - 0.001 };
            });
            expect(res.vy).toBeGreaterThan(0);
            expect(res.inside).toBe(true);
        });

        test('the basket sends the stone back up', async ({ page }) => {
            await playFrozen(page);
            const vy = await page.evaluate(() => {
                const b = balls[0];
                b.x = paddle.x;
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return b.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('a hit left of the basket centre sends the stone left', async ({ page }) => {
            await playFrozen(page);
            const vx = await page.evaluate(() => {
                const b = balls[0];
                b.x = paddle.x - paddle.w / 2 + 4;
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return b.vx;
            });
            expect(vx).toBeLessThan(-30);
        });

        test('a hit right of the basket centre sends the stone right', async ({ page }) => {
            await playFrozen(page);
            const vx = await page.evaluate(() => {
                const b = balls[0];
                b.x = paddle.x + paddle.w / 2 - 4;
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return b.vx;
            });
            expect(vx).toBeGreaterThan(30);
        });

        test('the basket never sends the stone straight up', async ({ page }) => {
            await playFrozen(page);
            const vx = await page.evaluate(() => {
                const b = balls[0];
                b.x = paddle.x;            // dead centre
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                for (let i = 0; i < 20; i++) step(1 / 240);
                return Math.abs(b.vx);
            });
            expect(vx).toBeGreaterThan(30);
        });

        test('a worker who tracks the stone can clear the first field', async ({ page }) => {
            // A stone that rides a cleared column up and down for ever would make
            // the game unfinishable, so this plays field 1 out with a basket that
            // simply centres on the stone - the worst way to aim - and expects the
            // field to come clear all the same.
            const res = await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                startGame();
                launch();
                let frames = 0;
                while (frames < 180 * 60 && state === 'playing') {
                    const b = balls.filter((x) => !x.held)[0];
                    if (b) {
                        paddle.x += clamp(b.x - paddle.x, -7.5, 7.5);
                        clampPaddle();
                    }
                    step(1 / 60);
                    frames++;
                }
                return { state, frames, left: aliveBreakable() };
            });
            expect(res.left).toBe(0);
            expect(res.state).toBe('levelComplete');
        });

        test('a lone stone is always found in the end', async ({ page }) => {
            // A fixed bounce angle plus perfect tracking could loop for ever, so the
            // basket widens its bounce the longer the stone strikes nothing.
            const res = await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                lives = 99;
                startGame();
                for (const row of bricks) row.fill(null);
                bricks[1][11] = { type: 'loose', hp: 1, maxHp: 1 };
                launch();
                let frames = 0;
                while (frames < 90 * 60 && aliveBreakable() > 0) {
                    const b = balls.filter((x) => !x.held)[0];
                    if (b) {
                        paddle.x += clamp(b.x - paddle.x, -9, 9);
                        clampPaddle();
                    }
                    if (state === 'ready') launch();
                    step(1 / 60);
                    frames++;
                }
                return { left: aliveBreakable(), seconds: Math.round(frames / 60) };
            });
            expect(res.left).toBe(0);
        });

        test('the basket does not change the stone speed', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                const b = balls[0];
                b.x = paddle.x + 20;
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                const before = Math.hypot(b.vx, b.vy);
                for (let i = 0; i < 20; i++) step(1 / 240);
                return { before, after: Math.hypot(b.vx, b.vy) };
            });
            expect(res.after).toBeCloseTo(res.before, 1);
        });
    });

    // -------------------------------------------------------------------
    // Gathering stones
    // -------------------------------------------------------------------
    test.describe('gathering stones', () => {
        test('a loose stone is gathered in one hit and scores 10', async ({ page }) => {
            await playFrozen(page);
            const at = await findBrick(page, 'loose');
            expect(at).not.toBeNull();
            expect(await strike(page, at.r, at.c)).toBe(1);
            const after = await page.evaluate(([r, c]) => ({ brick: bricks[r][c], score }), [at.r, at.c]);
            expect(after.brick).toBeNull();
            expect(after.score).toBe(10);
        });

        test('the stone rebounds after a hit', async ({ page }) => {
            await playFrozen(page);
            const at = await findBrick(page, 'loose');
            await strike(page, at.r, at.c);
            expect(await page.evaluate(() => balls[0].vy)).toBeGreaterThan(0);
        });

        test('a packed stone needs two hits and scores 20', async ({ page }) => {
            await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                startLevel(0);
                // One packed stone to work on, and one spare so the field is not finished.
                for (const row of bricks) row.fill(null);
                bricks[4][5] = { type: 'packed', hp: 2, maxHp: 2 };
                bricks[0][0] = { type: 'loose', hp: 1, maxHp: 1 };
                launch();
            });
            await strike(page, 4, 5);
            const mid = await page.evaluate(() => ({ hp: bricks[4][5] && bricks[4][5].hp, score }));
            expect(mid.hp).toBe(1);
            expect(mid.score).toBe(0);
            await strike(page, 4, 5);
            const done = await page.evaluate(() => ({ brick: bricks[4][5], score }));
            expect(done.brick).toBeNull();
            expect(done.score).toBe(20);
        });

        test('a boulder needs three hits and scores 30', async ({ page }) => {
            await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                // Put a boulder on a cleared field so the stone has a clear run at it.
                startLevel(0);
                for (const row of bricks) row.fill(null);
                bricks[4][5] = { type: 'boulder', hp: 3, maxHp: 3 };
                bricks[0][0] = { type: 'loose', hp: 1, maxHp: 1 };
                launch();
            });
            await strike(page, 4, 5);
            expect(await page.evaluate(() => bricks[4][5].hp)).toBe(2);
            await strike(page, 4, 5);
            expect(await page.evaluate(() => bricks[4][5].hp)).toBe(1);
            await strike(page, 4, 5);
            const done = await page.evaluate(() => ({ brick: bricks[4][5], score }));
            expect(done.brick).toBeNull();
            expect(done.score).toBe(30);
        });

        test('bedrock never breaks and turns the stone back', async ({ page }) => {
            await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                startLevel(0);
                for (const row of bricks) row.fill(null);
                bricks[3][6] = { type: 'bedrock', hp: Infinity, maxHp: Infinity };
                bricks[0][0] = { type: 'loose', hp: 1, maxHp: 1 };
                launch();
            });
            const res = await page.evaluate(() => {
                const rect = brickRect(3, 6);
                const b = balls[0];
                b.x = rect.x + rect.w / 2;
                b.y = rect.y + rect.h + b.r + 1;
                b.vx = 0;
                b.vy = -220;
                for (let i = 0; i < 40; i++) step(1 / 240);
                return { brick: bricks[3][6], vy: b.vy, score };
            });
            expect(res.brick).not.toBeNull();
            expect(res.vy).toBeGreaterThan(0);
            expect(res.score).toBe(0);
        });

        test('the stones-left counter follows the field', async ({ page }) => {
            await playFrozen(page);
            const before = Number(await page.locator('#stones').textContent());
            const at = await findBrick(page, 'loose');
            await strike(page, at.r, at.c);
            await steps(page, 1);
            expect(Number(await page.locator('#stones').textContent())).toBe(before - 1);
        });

        test('a very fast stone cannot tunnel through a row', async ({ page }) => {
            await playFrozen(page);
            const hit = await page.evaluate(() => {
                const before = aliveBreakable();
                const b = balls[0];
                b.x = 260;
                b.y = 300;
                b.vx = 0;
                b.vy = -6000;
                b.held = false;
                step(1 / 30);
                return before - aliveBreakable();
            });
            expect(hit).toBeGreaterThan(0);
        });

        test('the score is shown in the HUD', async ({ page }) => {
            await playFrozen(page);
            const at = await findBrick(page, 'loose');
            await strike(page, at.r, at.c);
            await steps(page, 1);
            await expect(page.locator('#score')).toHaveText('10');
        });
    });

    // -------------------------------------------------------------------
    // Losing the stone
    // -------------------------------------------------------------------
    test.describe('losing the stone', () => {
        test('a stone lost past the bottom costs a worker', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vx = 0;
                b.vy = 400;
                for (let i = 0; i < 60; i++) step(1 / 120);
                return { lives, state, balls: balls.length, held: balls[0].held };
            });
            expect(res.lives).toBe(2);
            expect(res.state).toBe('ready');
            expect(res.balls).toBe(1);
            expect(res.held).toBe(true);
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('losing one of three stones costs nothing', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                applyGift('three');
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vx = 0;
                b.vy = 400;
                for (let i = 0; i < 40; i++) step(1 / 120);
                return { lives, count: balls.length, state };
            });
            expect(res.lives).toBe(3);
            expect(res.count).toBe(2);
            expect(res.state).toBe('playing');
        });

        test('running out of workers ends the game', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vx = 0;
                b.vy = 400;
                for (let i = 0; i < 60; i++) step(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('gameOver');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/field|over|stones/i);
        });

        test('the game over overlay reports the score', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                score = 250;
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vy = 400;
                for (let i = 0; i < 60; i++) step(1 / 120);
            });
            await expect(page.locator('#overlay-score')).toContainText('250');
        });

        test('a new best score is kept', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                score = 1234;
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vy = 400;
                for (let i = 0; i < 60; i++) step(1 / 120);
            });
            await expect(page.locator('#best')).toHaveText('1234');
            expect(await page.evaluate(() => window.localStorage.getItem('gather-the-stones-best'))).toBe('1234');
        });

        test('the restart button starts over with three workers', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                lives = 1;
                score = 90;
                const b = balls[0];
                b.x = 40;
                b.y = 600;
                b.vy = 400;
                for (let i = 0; i < 60; i++) step(1 / 120);
            });
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({ lives, score, levelIndex, state }));
            expect(res).toEqual({ lives: 3, score: 0, levelIndex: 0, state: 'ready' });
        });
    });

    // -------------------------------------------------------------------
    // Clearing a field
    // -------------------------------------------------------------------
    test.describe('clearing a field', () => {
        test('clearing every breakable stone completes the field', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                score = 0;
                for (const row of bricks) {
                    for (let c = 0; c < row.length; c++) {
                        if (row[c] && row[c].type !== 'bedrock') row[c] = null;
                    }
                }
                step(1 / 120);
                return { state, score };
            });
            expect(res.state).toBe('levelComplete');
            expect(res.score).toBe(100);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('bedrock left behind does not block completion', async ({ page }) => {
            await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                startLevel(0);
                for (const row of bricks) row.fill(null);
                bricks[2][2] = { type: 'bedrock', hp: Infinity, maxHp: Infinity };
                launch();
                step(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('levelComplete');
        });

        test('the next-field button opens the next field', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                for (const row of bricks) row.fill(null);
                step(1 / 120);
            });
            await page.locator('#btn-start').click();
            const res = await page.evaluate(() => ({ levelIndex, state, held: balls[0].held, left: aliveBreakable() }));
            expect(res.levelIndex).toBe(1);
            expect(res.state).toBe('ready');
            expect(res.held).toBe(true);
            expect(res.left).toBeGreaterThan(0);
            await expect(page.locator('#field')).toHaveText('2');
        });

        test('clearing the last field wins the game', async ({ page }) => {
            await page.evaluate(() => {
                autoAdvance = false;
                giftChance = 0;
                startGame();
                startLevel(LEVELS.length - 1);
                launch();
                for (const row of bricks) row.fill(null);
                step(1 / 120);
            });
            expect(await page.evaluate(() => state)).toBe('won');
            await expect(page.locator('#overlay-title')).toContainText(/vineyard/i);
        });

        test('the field name is shown for every field', async ({ page }) => {
            await startFrozen(page);
            for (let i = 0; i < 5; i++) {
                await page.evaluate((i) => startLevel(i), i);
                const name = await page.locator('#field-name').textContent();
                expect(name.trim().length).toBeGreaterThan(3);
            }
        });
    });

    // -------------------------------------------------------------------
    // Gifts
    // -------------------------------------------------------------------
    test.describe('gifts', () => {
        test('a gathered stone can leave a gift behind', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                giftChance = 1;
            });
            const at = await findBrick(page, 'loose');
            await strike(page, at.r, at.c);
            expect(await page.evaluate(() => powerups.length)).toBe(1);
        });

        test('gifts fall and are lost past the bottom', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                lives = 99;
                spawnGift('wide', 100, 200);
                const y0 = powerups[0].y;
                step(1 / 60);
                const fell = powerups[0].y > y0;
                for (let i = 0; i < 600; i++) step(1 / 60);
                return { fell, left: powerups.length, w: paddle.w, base: paddle.baseW };
            });
            expect(res.fell).toBe(true);
            expect(res.left).toBe(0);
            expect(res.w).toBe(res.base);
        });

        test('catching a gift scores 25', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                score = 0;
                spawnGift('wide', paddle.x, paddle.y - 40);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return { score, left: powerups.length };
            });
            expect(res.score).toBe(25);
            expect(res.left).toBe(0);
        });

        test('Wide basket widens the basket and runs out', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                lives = 99;
                const base = paddle.baseW;
                applyGift('wide');
                const wide = paddle.w;
                for (let i = 0; i < 25 * 60; i++) step(1 / 60);
                return { base, wide, after: paddle.w };
            });
            expect(res.wide).toBeGreaterThan(res.base);
            expect(res.after).toBe(res.base);
        });

        test('Steady hand slows the stone and runs out', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                lives = 99;
                const b = balls[0];
                const fast = Math.hypot(b.vx, b.vy);
                applyGift('slow');
                step(1 / 60);
                const slow = Math.hypot(balls[0].vx, balls[0].vy);
                for (let i = 0; i < 20 * 60; i++) step(1 / 60);
                return { fast, slow, after: ballSpeed() };
            });
            expect(res.slow).toBeLessThan(res.fast - 10);
            expect(res.after).toBeGreaterThan(res.slow + 10);
        });

        test('Three stones splits the stone in play', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                applyGift('three');
                return {
                    count: balls.length,
                    moving: balls.every((b) => Math.hypot(b.vx, b.vy) > 1),
                    speeds: balls.map((b) => Math.round(Math.hypot(b.vx, b.vy))),
                };
            });
            expect(res.count).toBe(3);
            expect(res.moving).toBe(true);
            expect(new Set(res.speeds).size).toBe(1);
        });

        test('Sticky pitch holds the stone until Space is pressed', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                applyGift('catch');
                const b = balls[0];
                b.x = paddle.x;
                b.y = paddle.y - b.r - 1;
                b.vx = 0;
                b.vy = 250;
                for (let i = 0; i < 10; i++) step(1 / 240);
            });
            expect(await page.evaluate(() => balls[0].held)).toBe(true);
            await page.keyboard.press('Space');
            const after = await page.evaluate(() => ({ held: balls[0].held, vy: balls[0].vy }));
            expect(after.held).toBe(false);
            expect(after.vy).toBeLessThan(0);
        });

        test('Extra helper adds a worker, up to five', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                applyGift('helper');
                const four = lives;
                for (let i = 0; i < 5; i++) applyGift('helper');
                return { four, capped: lives };
            });
            expect(res.four).toBe(4);
            expect(res.capped).toBe(5);
        });

        test('a repeated gift restarts its clock', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                lives = 99;
                applyGift('wide');
                for (let i = 0; i < 10 * 60; i++) step(1 / 60);
                const half = timers.wide;
                applyGift('wide');
                return { half, full: timers.wide };
            });
            expect(res.full).toBeGreaterThan(res.half);
        });

        test('running gifts are listed in the HUD', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                applyGift('wide');
                step(1 / 60);
            });
            await expect(page.locator('#gifts .gift')).toHaveCount(1);
            await expect(page.locator('#gifts')).toContainText(/basket/i);
        });

        test('gifts are cleared when a new field opens', async ({ page }) => {
            await playFrozen(page);
            const res = await page.evaluate(() => {
                applyGift('wide');
                spawnGift('slow', 200, 200);
                startLevel(1);
                return { pups: powerups.length, w: paddle.w, base: paddle.baseW, wide: timers.wide };
            });
            expect(res.pups).toBe(0);
            expect(res.w).toBe(res.base);
            expect(res.wide).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Pause and restart
    // -------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses and resumes the work', async ({ page }) => {
            await playFrozen(page);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('playing');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            await playFrozen(page);
            await page.keyboard.press('KeyP');
            const still = await page.evaluate(() => {
                const before = JSON.stringify(balls);
                for (let i = 0; i < 60; i++) step(1 / 60);
                return JSON.stringify(balls) === before;
            });
            expect(still).toBe(true);
        });

        test('R restarts from the first field', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                score = 500;
                lives = 1;
                startLevel(2);
            });
            await page.keyboard.press('KeyR');
            const res = await page.evaluate(() => ({ score, lives, levelIndex, state }));
            expect(res).toEqual({ score: 0, lives: 3, levelIndex: 0, state: 'ready' });
        });
    });

    test.describe('leaving the page', () => {
        test('work pauses when the page is hidden', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            expect(await page.evaluate(() => state)).toBe('paused');
        });
    });

    // -------------------------------------------------------------------
    // Level data
    // -------------------------------------------------------------------
    test.describe('the five fields', () => {
        test('every field is 12 columns wide and fits the grid', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.filter(
                    (lv) =>
                        lv.rows.length > GRID_ROWS ||
                        lv.rows.some((row) => row.length !== COLS) ||
                        !lv.name
                ).map((lv) => lv.name || '(unnamed)')
            );
            expect(bad).toEqual([]);
            expect(await page.evaluate(() => LEVELS.length)).toBe(5);
        });

        test('every field uses known stones and has something to gather', async ({ page }) => {
            const bad = await page.evaluate(() =>
                LEVELS.filter((lv) => {
                    const chars = lv.rows.join('');
                    return (
                        /[^.lpbX]/.test(chars) || !/[lpb]/.test(chars)
                    );
                }).map((lv) => lv.name)
            );
            expect(bad).toEqual([]);
        });

        test('later fields are harder than the first', async ({ page }) => {
            const counts = await page.evaluate(() =>
                LEVELS.map((lv) => ({
                    tough: (lv.rows.join('').match(/[pb]/g) || []).length,
                    rock: (lv.rows.join('').match(/X/g) || []).length,
                }))
            );
            expect(counts[0].tough).toBeLessThan(counts[4].tough);
            expect(counts[4].rock).toBeGreaterThan(0);
        });

        test('no stone sits where the basket works', async ({ page }) => {
            const ok = await page.evaluate(() =>
                LEVELS.every((lv) => brickRect(lv.rows.length - 1, 0).y + brickRect(0, 0).h < paddle.y - 80)
            );
            expect(ok).toBe(true);
        });
    });

    // -------------------------------------------------------------------
    // Rendering and robustness
    // -------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
            await startFrozen(page);
            const painted = await page.evaluate(() => {
                draw();
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let lit = 0;
                for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
                return lit;
            });
            expect(painted).toBeGreaterThan(5000);
        });

        test('a long run of frames raises no error', async ({ page }) => {
            await playFrozen(page);
            await page.evaluate(() => {
                giftChance = 0.5;
                for (let i = 0; i < 3000; i++) {
                    step(1 / 60);
                    if (state === 'ready') launch();
                    if (state === 'levelComplete') startLevel(levelIndex + 1);
                    if (state === 'gameOver' || state === 'won') startGame();
                }
            });
            await page.waitForTimeout(100);
            expect(errors).toEqual([]);
        });

        test('the animation loop runs the game on its own', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                launch();
            });
            const before = await page.evaluate(() => balls[0].y);
            await page.waitForTimeout(300);
            const after = await page.evaluate(() => balls[0].y);
            expect(Math.abs(after - before)).toBeGreaterThan(5);
        });
    });
});
