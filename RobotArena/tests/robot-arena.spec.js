const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Helpers injected into page.evaluate bodies:
//   s(n)    — run `n` fixed 1/60s steps
//   hold()  — park a motionless enemy in a corner so the wave never completes
//             (keeps long-running tests from being disturbed by a wave change)
const STEP = `
    const s = (n) => { for (let i = 0; i < n; i++) step(1 / 60); };
    const hold = () => { const e = spawnEnemy('drifter', WALL + 30, WALL + 30); e.vx = 0; e.vy = 0; return e; };
`;

test.describe('Robot Arena', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Robot Arena', async ({ page }) => {
            await expect(page).toHaveTitle('Robot Arena');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts to start', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, wave and lives read their starting values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#wave')).toHaveText('1');
            await expect(page.locator('#lives')).toHaveText('3');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no enemies or humans exist while idle', async ({ page }) => {
            const counts = await page.evaluate(() => ({ e: enemies.length, h: humans.length }));
            expect(counts).toEqual({ e: 0, h: 0 });
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { x: player.x, y: player.y };
                moveDir(1, 0);
                for (let i = 0; i < 30; i++) step(1 / 60);
                return player.x !== before.x || player.y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('high score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('robot-arena-high', '4200'));
            await page.reload();
            await expect(page.locator('#high')).toHaveText('4200');
        });

        test('the arena walls sit inside the canvas', async ({ page }) => {
            const g = await page.evaluate(() => ({
                wall: WALL, w: CANVAS_W, h: CANVAS_H, r: PLAYER_R,
            }));
            expect(g.wall).toBeGreaterThan(0);
            expect(g.wall + g.r).toBeLessThan(g.w / 2);
            expect(g.wall + g.r).toBeLessThan(g.h / 2);
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

        test('a fresh game is wave 1, score 0, three lives', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { score, wave, lives, startLives: START_LIVES };
            });
            expect(s).toEqual({ score: 0, wave: 1, lives: 3, startLives: 3 });
        });

        test('the player starts at the centre of the arena', async ({ page }) => {
            const p = await page.evaluate(() => {
                startGame();
                return { x: player.x, y: player.y, cx: CANVAS_W / 2, cy: CANVAS_H / 2 };
            });
            expect(p.x).toBe(p.cx);
            expect(p.y).toBe(p.cy);
        });

        test('wave 1 spawns enemies and humans', async ({ page }) => {
            const c = await page.evaluate(() => {
                startGame();
                return { e: enemies.length, h: humans.length };
            });
            expect(c.e).toBeGreaterThan(0);
            expect(c.h).toBeGreaterThan(0);
        });

        test('nothing spawns on top of the player', async ({ page }) => {
            const nearest = await page.evaluate(() => {
                startGame();
                const d = (o) => Math.hypot(o.x - player.x, o.y - player.y);
                return Math.min(...enemies.map(d), ...humans.map(d));
            });
            expect(nearest).toBeGreaterThan(80);
        });

        test('everything spawns inside the arena walls', async ({ page }) => {
            const inside = await page.evaluate(() => {
                startGame();
                return [...enemies, ...humans].every((o) =>
                    o.x >= WALL && o.x <= CANVAS_W - WALL &&
                    o.y >= WALL && o.y <= CANVAS_H - WALL);
            });
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Movement
    // -----------------------------------------------------------------------
    test.describe('movement', () => {
        test('moveDir walks the player right', async ({ page }) => {
            const d = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                const x0 = player.x;
                moveDir(1, 0);
                s(30);
                return player.x - x0;
            })()`);
            expect(d).toBeGreaterThan(50);
        });

        test('moveDir walks the player up', async ({ page }) => {
            const d = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                const y0 = player.y;
                moveDir(0, -1);
                s(30);
                return player.y - y0;
            })()`);
            expect(d).toBeLessThan(-50);
        });

        test('releasing the direction stops the player', async ({ page }) => {
            const d = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                moveDir(1, 0);
                s(10);
                moveDir(0, 0);
                const x0 = player.x;
                s(30);
                return player.x - x0;
            })()`);
            expect(d).toBe(0);
        });

        test('diagonal movement is not faster than straight movement', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                const a = { x: player.x, y: player.y };
                moveDir(1, 1);
                s(30);
                const diag = Math.hypot(player.x - a.x, player.y - a.y);
                startGame();
                const b = { x: player.x, y: player.y };
                moveDir(1, 0);
                s(30);
                const straight = Math.hypot(player.x - b.x, player.y - b.y);
                return { diag, straight };
            })()`);
            expect(r.diag).toBeCloseTo(r.straight, 1);
        });

        test('the player cannot walk through the arena walls', async ({ page }) => {
            const p = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                player.invuln = 1e9;
                moveDir(1, 1);
                s(200);
                return { x: player.x, y: player.y, w: CANVAS_W, h: CANVAS_H, wall: WALL, r: PLAYER_R };
            })()`);
            expect(p.x).toBeLessThanOrEqual(p.w - p.wall - p.r + 0.001);
            expect(p.y).toBeLessThanOrEqual(p.h - p.wall - p.r + 0.001);
        });

        test('WASD keys move the player', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('d');
            const dx = await page.evaluate(`(() => {
                ${STEP}
                const x0 = player.x;
                s(30);
                return player.x - x0;
            })()`);
            await page.keyboard.up('d');
            expect(dx).toBeGreaterThan(20);
        });
    });

    // -----------------------------------------------------------------------
    // Shooting
    // -----------------------------------------------------------------------
    test.describe('shooting', () => {
        test('fireDir spawns a bullet travelling that way', async ({ page }) => {
            const b = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                fireDir(0, -1);
                s(2);
                return bullets.map((x) => ({ vx: x.vx, vy: x.vy }));
            })()`);
            expect(b.length).toBe(1);
            expect(b[0].vy).toBeLessThan(0);
            expect(Math.abs(b[0].vx)).toBeLessThan(1);
        });

        test('holding fire is rate limited by the cooldown', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                fireDir(1, 0);
                s(30);
                return { shots: shotsFired, cooldown: FIRE_COOLDOWN };
            })()`);
            const expected = Math.floor(0.5 / r.cooldown) + 1;
            expect(r.shots).toBeLessThanOrEqual(expected);
            expect(r.shots).toBeGreaterThan(1);
        });

        test('bullets are removed when they hit a wall', async ({ page }) => {
            const left = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                fireDir(-1, 0);
                s(1);
                fireDir(0, 0);
                s(120);
                return bullets.length;
            })()`);
            expect(left).toBe(0);
        });

        test('no bullets are fired while paused', async ({ page }) => {
            const n = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                togglePause();
                fireDir(1, 0);
                s(30);
                return bullets.length;
            })()`);
            expect(n).toBe(0);
        });

        test('arrow keys fire without moving the player', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.down('ArrowLeft');
            const r = await page.evaluate(`(() => {
                ${STEP}
                enemies.length = 0;
                const x0 = player.x;
                s(2);
                return { n: bullets.length, vx: bullets.length ? bullets[0].vx : 0, moved: player.x - x0 };
            })()`);
            await page.keyboard.up('ArrowLeft');
            expect(r.n).toBeGreaterThan(0);
            expect(r.vx).toBeLessThan(0);
            expect(r.moved).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Enemies
    // -----------------------------------------------------------------------
    test.describe('enemies', () => {
        test('grunts chase the player', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(120, 120);
                const e = spawnEnemy('grunt', 500, 400);
                const before = Math.hypot(e.x - player.x, e.y - player.y);
                s(60);
                const after = Math.hypot(e.x - player.x, e.y - player.y);
                return { before, after };
            })()`);
            expect(r.after).toBeLessThan(r.before - 30);
        });

        test('hunters are faster than grunts', async ({ page }) => {
            const r = await page.evaluate(() => ({
                grunt: ENEMY_TYPES.grunt.speed,
                hunter: ENEMY_TYPES.hunter.speed,
            }));
            expect(r.hunter).toBeGreaterThan(r.grunt);
        });

        test('drifters bounce off the arena walls', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(60, 60);
                const e = spawnEnemy('drifter', CANVAS_W - WALL - 30, 240);
                e.vx = 200; e.vy = 0;
                s(60);
                return { vx: e.vx, x: e.x, limit: CANVAS_W - WALL };
            })()`);
            expect(r.vx).toBeLessThan(0);
            expect(r.x).toBeLessThanOrEqual(r.limit);
        });

        test('sentries shoot at the player', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(320, 440);
                spawnEnemy('sentry', 320, 80);
                s(Math.ceil(SENTRY_FIRE_INTERVAL * 60) + 10);
                return enemyBullets.map((b) => ({ vy: b.vy, vx: b.vx }));
            })()`);
            expect(r.length).toBeGreaterThan(0);
            expect(r[0].vy).toBeGreaterThan(0);
        });

        test('enemy bullets are removed at the walls', async ({ page }) => {
            const n = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                hold();
                setPlayerPos(320, 400);
                player.invuln = 1e9;
                spawnEnemyBullet(320, 240, 0, -ENEMY_BULLET_SPEED);
                s(90);
                return enemyBullets.length;
            })()`);
            expect(n).toBe(0);
        });

        test('a bullet destroys a grunt and scores points', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                humans.length = 0;
                setPlayerPos(320, 400);
                spawnEnemy('grunt', 320, 220);
                fireDir(0, -1);
                s(60);
                return { enemies: enemies.length, score, points: ENEMY_TYPES.grunt.points };
            })()`);
            expect(r.enemies).toBe(0);
            expect(r.score).toBeGreaterThanOrEqual(r.points);
        });

        test('sentries take two hits to destroy', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                const e = spawnEnemy('sentry', 200, 200);
                hitEnemy(e);
                const afterOne = { alive: enemies.includes(e), hp: e.hp, score };
                hitEnemy(e);
                return { afterOne, alive: enemies.includes(e), score };
            })()`);
            expect(r.afterOne.alive).toBe(true);
            expect(r.afterOne.hp).toBe(1);
            expect(r.afterOne.score).toBe(0);
            expect(r.alive).toBe(false);
            expect(r.score).toBeGreaterThan(0);
        });

        test('enemies stay inside the arena', async ({ page }) => {
            const inside = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                setPlayerPos(WALL + PLAYER_R, WALL + PLAYER_R);
                player.invuln = 9999;
                s(240);
                return enemies.every((e) =>
                    e.x >= WALL - 1 && e.x <= CANVAS_W - WALL + 1 &&
                    e.y >= WALL - 1 && e.y <= CANVAS_H - WALL + 1);
            })()`);
            expect(inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Taking damage
    // -----------------------------------------------------------------------
    test.describe('damage', () => {
        test('touching an enemy costs a life and respawns at the centre', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(200, 200);
                player.invuln = 0;
                spawnEnemy('grunt', 202, 200);
                s(1);
                return { lives, x: player.x, y: player.y, invuln: player.invuln, cx: CANVAS_W / 2, cy: CANVAS_H / 2 };
            })()`);
            expect(r.lives).toBe(2);
            expect(r.x).toBe(r.cx);
            expect(r.y).toBe(r.cy);
            expect(r.invuln).toBeGreaterThan(0);
        });

        test('the player is invulnerable just after respawning', async ({ page }) => {
            const lives = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(200, 200);
                player.invuln = 0;
                spawnEnemy('grunt', 202, 200);
                s(1);
                spawnEnemy('grunt', player.x, player.y);
                s(5);
                return lives;
            })()`);
            expect(lives).toBe(2);
        });

        test('an enemy bullet costs a life', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(320, 240);
                player.invuln = 0;
                spawnEnemyBullet(320, 200, 0, 200);
                s(20);
                return { lives, bullets: enemyBullets.length };
            })()`);
            expect(r.lives).toBe(2);
            expect(r.bullets).toBe(0);
        });

        test('losing a life clears enemy bullets', async ({ page }) => {
            const n = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                setPlayerPos(320, 240);
                player.invuln = 0;
                spawnEnemyBullet(100, 100, 40, 40);
                spawnEnemyBullet(320, 200, 0, 200);
                s(20);
                return enemyBullets.length;
            })()`);
            expect(n).toBe(0);
        });

        test('invulnerability wears off', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                hold();
                setPlayerPos(320, 400);
                player.invuln = INVULN_TIME;
                s(Math.ceil(INVULN_TIME * 60) + 5);
                return player.invuln;
            })()`);
            expect(r).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rescuing humans
    // -----------------------------------------------------------------------
    test.describe('humans', () => {
        test('walking into a human rescues them for points', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                humans.length = 0;
                setPlayerPos(300, 300);
                spawnHuman(302, 300);
                s(1);
                return { humans: humans.length, score, rescued };
            })()`);
            expect(r.humans).toBe(0);
            expect(r.score).toBe(100);
            expect(r.rescued).toBe(1);
        });

        test('consecutive rescues are worth more', async ({ page }) => {
            const scores = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                humans.length = 0;
                setPlayerPos(300, 300);
                const out = [];
                for (let i = 0; i < 3; i++) {
                    spawnHuman(302, 300);
                    s(1);
                    out.push(score);
                }
                return out;
            })()`);
            expect(scores).toEqual([100, 300, 600]);
        });

        test('the rescue chain resets on a new wave', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                humans.length = 0;
                setPlayerPos(300, 300);
                spawnHuman(302, 300);
                s(1);
                const before = rescueChain;
                s(Math.ceil(WAVE_DELAY * 60) + 5);
                return { before, after: rescueChain, wave };
            })()`);
            expect(r.before).toBe(1);
            expect(r.after).toBe(0);
            expect(r.wave).toBe(2);
        });

        test('humans wander but stay inside the arena', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                humans.length = 0;
                setPlayerPos(CANVAS_W - WALL - PLAYER_R, CANVAS_H - WALL - PLAYER_R);
                player.invuln = 1e9;
                hold();
                const h = spawnHuman(320, 120);
                const start = { x: h.x, y: h.y };
                s(180);
                return {
                    moved: Math.hypot(h.x - start.x, h.y - start.y),
                    inside: h.x >= WALL && h.x <= CANVAS_W - WALL && h.y >= WALL && h.y <= CANVAS_H - WALL,
                };
            })()`);
            expect(r.moved).toBeGreaterThan(0);
            expect(r.inside).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Waves
    // -----------------------------------------------------------------------
    test.describe('waves', () => {
        test('clearing every enemy advances the wave after a short delay', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                const mid = wave;
                s(Math.ceil(WAVE_DELAY * 60) + 5);
                return { mid, wave, enemies: enemies.length };
            })()`);
            expect(r.mid).toBe(1);
            expect(r.wave).toBe(2);
            expect(r.enemies).toBeGreaterThan(0);
        });

        test('later waves send more enemies', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const first = enemyCountForWave(1);
                return { first, fifth: enemyCountForWave(5) };
            });
            expect(r.fifth).toBeGreaterThan(r.first);
        });

        test('the wave counter is shown in the HUD', async ({ page }) => {
            await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                s(Math.ceil(WAVE_DELAY * 60) + 5);
            })()`);
            await expect(page.locator('#wave')).toHaveText('2');
        });

        test('a new wave clears leftover bullets', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                spawnEnemyBullet(60, 60, 0, 0);
                s(Math.ceil(WAVE_DELAY * 60) + 5);
                return enemyBullets.length;
            })()`);
            expect(r).toBe(0);
        });

        test('the player is briefly invulnerable at the start of a new wave', async ({ page }) => {
            const invuln = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                s(Math.ceil(WAVE_DELAY * 60) + 1);
                return player.invuln;
            })()`);
            expect(invuln).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing
    // -----------------------------------------------------------------------
    test.describe('pausing', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing moves while paused', async ({ page }) => {
            const moved = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                setPlayerPos(200, 200);
                enemies.length = 0;
                const e = spawnEnemy('grunt', 400, 400);
                togglePause();
                const before = { x: e.x, y: e.y };
                s(60);
                return e.x !== before.x || e.y !== before.y;
            })()`);
            expect(moved).toBe(false);
        });

        test('pausing is ignored while idle', async ({ page }) => {
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('idle');
        });
    });

    // -----------------------------------------------------------------------
    // Game over & restart
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('running out of lives ends the game', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < START_LIVES; i++) loseLife();
                return { state, lives };
            });
            expect(r.state).toBe('over');
            expect(r.lives).toBe(0);
        });

        test('the overlay reports the final score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                for (let i = 0; i < START_LIVES; i++) loseLife();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/game over/i);
            await expect(page.locator('#overlay-score')).toContainText('1234');
        });

        test('the high score is saved', async ({ page }) => {
            const saved = await page.evaluate(() => {
                startGame();
                score = 777;
                for (let i = 0; i < START_LIVES; i++) loseLife();
                return window.localStorage.getItem('robot-arena-high');
            });
            expect(saved).toBe('777');
            await expect(page.locator('#high')).toHaveText('777');
        });

        test('a lower score does not overwrite the high score', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('robot-arena-high', '9000'));
            await page.reload();
            const saved = await page.evaluate(() => {
                startGame();
                score = 10;
                for (let i = 0; i < START_LIVES; i++) loseLife();
                return window.localStorage.getItem('robot-arena-high');
            });
            expect(saved).toBe('9000');
        });

        test('stepping after game over does nothing', async ({ page }) => {
            const moved = await page.evaluate(`(() => {
                ${STEP}
                startGame();
                enemies.length = 0;
                const e = spawnEnemy('grunt', 400, 400);
                for (let i = 0; i < START_LIVES; i++) loseLife();
                const before = { x: e.x, y: e.y };
                s(60);
                return e.x !== before.x || e.y !== before.y;
            })()`);
            expect(moved).toBe(false);
        });

        test('Space restarts after game over', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 500;
                for (let i = 0; i < START_LIVES; i++) loseLife();
            });
            await page.keyboard.press('Space');
            const r = await page.evaluate(() => ({ state, score, wave, lives }));
            expect(r).toEqual({ state: 'running', score: 0, wave: 1, lives: 3 });
        });
    });

    // -----------------------------------------------------------------------
    // HUD & rendering
    // -----------------------------------------------------------------------
    test.describe('hud and rendering', () => {
        test('the HUD tracks score, wave and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 250;
                loseLife();
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('250');
            await expect(page.locator('#lives')).toHaveText('2');
        });

        test('the canvas is actually painted', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('the help text lists the controls', async ({ page }) => {
            await expect(page.locator('.help')).toContainText(/WASD/i);
            await expect(page.locator('.help')).toContainText(/fire|shoot/i);
        });
    });
});
