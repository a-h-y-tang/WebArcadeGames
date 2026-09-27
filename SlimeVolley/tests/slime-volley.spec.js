const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Slime Volley', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Slime Volley', async ({ page }) => {
            await expect(page).toHaveTitle('Slime Volley');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('both scores start at 0', async ({ page }) => {
            await expect(page.locator('#score-p1')).toHaveText('0');
            await expect(page.locator('#score-p2')).toHaveText('0');
        });

        test('rally and best rally start at 0', async ({ page }) => {
            await expect(page.locator('#rally')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 600x400', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '400');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('stepping while idle does nothing', async ({ page }) => {
            const moved = await page.evaluate(() => {
                const before = { x: ball.x, y: ball.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return ball.x !== before.x || ball.y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('best rally loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('slime-volley-best', '42'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('42');
        });

        test('the net divides the court in half', async ({ page }) => {
            const geom = await page.evaluate(() => ({
                netX: NET_X, w: CANVAS_W, netTop: NET_TOP, ground: GROUND_Y,
            }));
            expect(geom.netX).toBe(geom.w / 2);
            expect(geom.netTop).toBeLessThan(geom.ground);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a match
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a fresh match starts 0-0 with the player serving', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { scoreP1, scoreP2, server, rally };
            });
            expect(s.scoreP1).toBe(0);
            expect(s.scoreP2).toBe(0);
            expect(s.server).toBe('p1');
            expect(s.rally).toBe(0);
        });

        test('the slimes start on their own sides, on the ground', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { p1x: player.x, p2x: ai.x, p1y: player.y, p2y: ai.y, net: NET_X, ground: GROUND_Y };
            });
            expect(s.p1x).toBeLessThan(s.net);
            expect(s.p2x).toBeGreaterThan(s.net);
            expect(s.p1y).toBe(s.ground);
            expect(s.p2y).toBe(s.ground);
        });

        test('the serve puts the ball above the serving side, in the air', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { x: ball.x, y: ball.y, net: NET_X, ground: GROUND_Y };
            });
            expect(s.x).toBeLessThan(s.net);
            expect(s.y).toBeLessThan(s.ground - 100);
        });
    });

    // -----------------------------------------------------------------------
    // Player movement
    // -----------------------------------------------------------------------
    test.describe('player movement', () => {
        test('moving left decreases the slime x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                player.x = 150;
                const before = player.x;
                movePlayer(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('moving right increases the slime x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                player.x = 150;
                const before = player.x;
                movePlayer(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the player cannot walk off the left wall', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                movePlayer(-1);
                for (let i = 0; i < 300; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the player cannot cross the net', async ({ page }) => {
            const { x, limit } = await page.evaluate(() => {
                startGame();
                movePlayer(1);
                for (let i = 0; i < 300; i++) step(0.016);
                return { x: player.x, limit: NET_X - NET_W / 2 - SLIME_R };
            });
            expect(x).toBeLessThanOrEqual(limit + 0.001);
        });

        test('ArrowRight key moves the player right', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.x = 150; });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('releasing the key stops the slime', async ({ page }) => {
            await page.evaluate(() => { startGame(); player.x = 150; });
            await page.keyboard.down('ArrowLeft');
            await page.evaluate(() => { for (let i = 0; i < 5; i++) step(0.016); });
            await page.keyboard.up('ArrowLeft');
            const moved = await page.evaluate(() => {
                const before = player.x;
                for (let i = 0; i < 10; i++) step(0.016);
                return player.x !== before;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Jumping
    // -----------------------------------------------------------------------
    test.describe('jumping', () => {
        test('jumping lifts the slime off the ground', async ({ page }) => {
            const y = await page.evaluate(() => {
                startGame();
                jump();
                for (let i = 0; i < 6; i++) step(0.016);
                return player.y;
            });
            expect(y).toBeLessThan(400);
        });

        test('the slime falls back to the ground', async ({ page }) => {
            const { y, ground } = await page.evaluate(() => {
                startGame();
                jump();
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: player.y, ground: GROUND_Y };
            });
            expect(y).toBe(ground);
        });

        test('the slime cannot double-jump in mid-air', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                jump();
                for (let i = 0; i < 6; i++) step(0.016);
                const before = player.vy;
                jump();
                return player.vy === before;
            });
            expect(same).toBe(true);
        });

        test('ArrowUp jumps', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('ArrowUp');
            const y = await page.evaluate(() => {
                for (let i = 0; i < 6; i++) step(0.016);
                return player.y;
            });
            expect(y).toBeLessThan(400);
        });

        test('the slime never rises above the top of the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                jump();
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (player.y - SLIME_R < 0) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Ball physics
    // -----------------------------------------------------------------------
    test.describe('ball physics', () => {
        test('gravity pulls the ball downward', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setBall(150, 100, 0, 0);
                const before = ball.vy;
                for (let i = 0; i < 5; i++) step(0.016);
                return { before, after: ball.vy };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('the ball bounces off the left wall', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                setBall(BALL_R + 2, 120, -300, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });

        test('the ball bounces off the right wall', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                setBall(CANVAS_W - BALL_R - 2, 120, 300, 0);
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('the ball bounces off the ceiling', async ({ page }) => {
            const vy = await page.evaluate(() => {
                startGame();
                setBall(150, BALL_R + 2, 0, -300);
                for (let i = 0; i < 6; i++) step(0.016);
                return ball.vy;
            });
            expect(vy).toBeGreaterThan(0);
        });

        test('the ball always stays inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setBall(120, 60, 520, -260);
                for (let i = 0; i < 600; i++) {
                    step(0.016);
                    if (ball.x < 0 || ball.x > CANVAS_W || ball.y < 0) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // The net
    // -----------------------------------------------------------------------
    test.describe('the net', () => {
        test('a ball hitting the side of the net is turned back', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                setBall(NET_X - NET_W / 2 - BALL_R - 2, GROUND_Y - 30, 260, 0);
                for (let i = 0; i < 8; i++) step(0.016);
                return ball.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('a ball cannot tunnel through the net', async ({ page }) => {
            const crossed = await page.evaluate(() => {
                startGame();
                setBall(120, NET_TOP + 20, 900, 0);
                for (let i = 0; i < 15; i++) {
                    step(0.016);
                    if (ball.x > NET_X + NET_W / 2) return true;
                }
                return false;
            });
            expect(crossed).toBe(false);
        });

        test('a ball dropping onto the top of the net bounces upward', async ({ page }) => {
            const vy = await page.evaluate(() => {
                startGame();
                setBall(NET_X, NET_TOP - BALL_R - 2, 0, 200);
                for (let i = 0; i < 8; i++) step(0.016);
                return ball.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('a ball passing above the net crosses freely', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                setBall(200, 40, 400, 0);
                for (let i = 0; i < 20; i++) step(0.016);
                return ball.x;
            });
            expect(x).toBeGreaterThan(300);
        });
    });

    // -----------------------------------------------------------------------
    // Hitting the ball
    // -----------------------------------------------------------------------
    test.describe('hitting the ball', () => {
        test('a ball landing on the player sends it back up', async ({ page }) => {
            const vy = await page.evaluate(() => {
                startGame();
                player.x = 150;
                setBall(150, GROUND_Y - SLIME_R - BALL_R - 2, 0, 200);
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('a hit increases the rally counter', async ({ page }) => {
            const rally = await page.evaluate(() => {
                startGame();
                player.x = 150;
                setBall(150, GROUND_Y - SLIME_R - BALL_R - 2, 0, 200);
                for (let i = 0; i < 10; i++) step(0.016);
                return rally;
            });
            expect(rally).toBe(1);
        });

        test('hitting the left flank of the slime pushes the ball left', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                player.x = 200;
                movePlayer(0);
                // Ball resting against the upper-left of the slime dome.
                const a = Math.PI * 0.78;
                const d = SLIME_R + BALL_R - 2;
                setBall(200 + Math.cos(a) * d, GROUND_Y - Math.sin(a) * d, 0, 60);
                for (let i = 0; i < 4; i++) step(0.016);
                return ball.vx;
            });
            expect(vx).toBeLessThan(0);
        });

        test('hitting the right flank of the slime pushes the ball right', async ({ page }) => {
            const vx = await page.evaluate(() => {
                startGame();
                player.x = 200;
                movePlayer(0);
                const a = Math.PI * 0.22;
                const d = SLIME_R + BALL_R - 2;
                setBall(200 + Math.cos(a) * d, GROUND_Y - Math.sin(a) * d, 0, 60);
                for (let i = 0; i < 4; i++) step(0.016);
                return ball.vx;
            });
            expect(vx).toBeGreaterThan(0);
        });

        test('the ball is never left overlapping the slime', async ({ page }) => {
            const gap = await page.evaluate(() => {
                startGame();
                player.x = 150;
                setBall(150, GROUND_Y - SLIME_R - BALL_R - 2, 0, 300);
                for (let i = 0; i < 10; i++) step(0.016);
                const dx = ball.x - player.x;
                const dy = ball.y - player.y;
                return Math.hypot(dx, dy) - (SLIME_R + BALL_R);
            });
            expect(gap).toBeGreaterThanOrEqual(-0.5);
        });

        test('the ball speed is capped after a hit', async ({ page }) => {
            const { speed, cap } = await page.evaluate(() => {
                startGame();
                player.x = 150;
                setBall(150, GROUND_Y - SLIME_R - BALL_R - 2, 0, 5000);
                for (let i = 0; i < 4; i++) step(0.016);
                return { speed: Math.hypot(ball.vx, ball.vy), cap: MAX_BALL_SPEED };
            });
            expect(speed).toBeLessThanOrEqual(cap + 1);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('a ball landing on the player side scores for the opponent', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                player.x = 40;
                setBall(220, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return { scoreP1, scoreP2 };
            });
            expect(s.scoreP2).toBe(1);
            expect(s.scoreP1).toBe(0);
        });

        test('a ball landing on the opponent side scores for the player', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return { scoreP1, scoreP2 };
            });
            expect(s.scoreP1).toBe(1);
            expect(s.scoreP2).toBe(0);
        });

        test('the side that wins the point serves next', async ({ page }) => {
            const server = await page.evaluate(() => {
                startGame();
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return server;
            });
            expect(server).toBe('p1');
        });

        test('the ball is re-served above the winner side after a point', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                player.x = 40;
                setBall(220, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return { x: ball.x, y: ball.y, net: NET_X, ground: GROUND_Y };
            });
            expect(s.x).toBeGreaterThan(s.net);
            expect(s.y).toBeLessThan(s.ground - 100);
        });

        test('a point resets the rally counter', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                player.x = 150;
                setBall(150, GROUND_Y - SLIME_R - BALL_R - 2, 0, 200);
                for (let i = 0; i < 10; i++) step(0.016);   // one hit
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);        // then a point
                for (let i = 0; i < 20; i++) step(0.016);
                return rally;
            });
            expect(r).toBe(0);
        });

        test('the scoreboard shows the current score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await expect(page.locator('#score-p1')).toHaveText('1');
            await expect(page.locator('#score-p2')).toHaveText('0');
        });
    });

    // -----------------------------------------------------------------------
    // Winning the match
    // -----------------------------------------------------------------------
    test.describe('match end', () => {
        test('reaching the winning score ends the match', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                scoreP1 = WIN_SCORE - 1;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return { state, scoreP1 };
            });
            expect(s.scoreP1).toBe(await page.evaluate(() => WIN_SCORE));
            expect(s.state).toBe('over');
        });

        test('the overlay announces the winner', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                scoreP1 = WIN_SCORE - 1;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/win|won/i);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the opponent can win too', async ({ page }) => {
            const title = await page.evaluate(() => {
                startGame();
                scoreP2 = WIN_SCORE - 1;
                player.x = 40;
                setBall(220, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                return document.getElementById('overlay-title').textContent;
            });
            expect(title.toLowerCase()).toContain('lose');
        });

        test('the ball stops moving once the match is over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                scoreP1 = WIN_SCORE - 1;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
                const before = { x: ball.x, y: ball.y };
                for (let i = 0; i < 30; i++) step(0.016);
                return ball.x !== before.x || ball.y !== before.y;
            });
            expect(moved).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Best rally
    // -----------------------------------------------------------------------
    test.describe('best rally', () => {
        test('the best rally is recorded when a point ends', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                rally = 9;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await expect(page.locator('#best')).toHaveText('9');
        });

        test('the best rally persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                rally = 12;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('slime-volley-best'));
            expect(parseInt(stored, 10)).toBe(12);
        });

        test('a shorter rally does not lower the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('slime-volley-best', '30'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                rally = 2;
                ai.x = 340;                                 // pull the rival off the drop zone
                setBall(560, GROUND_Y - 20, 0, 400);
                for (let i = 0; i < 20; i++) step(0.016);
            });
            await expect(page.locator('#best')).toHaveText('30');
        });
    });

    // -----------------------------------------------------------------------
    // Opponent AI
    // -----------------------------------------------------------------------
    test.describe('opponent AI', () => {
        test('the opponent chases a ball on its side', async ({ page }) => {
            const { before, after, ballX } = await page.evaluate(() => {
                startGame();
                ai.x = 560;
                setBall(340, 150, 0, 0);
                const before = ai.x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: ai.x, ballX: ball.x };
            });
            expect(after).toBeLessThan(before);
            expect(Math.abs(after - ballX)).toBeLessThan(Math.abs(before - ballX));
        });

        test('the opponent stays on its own side of the net', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                setBall(60, 150, 0, 0);
                const limit = NET_X + NET_W / 2 + SLIME_R;
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    if (ai.x < limit - 0.001 || ai.x > CANVAS_W) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });

        test('the opponent returns a ball dropping onto it', async ({ page }) => {
            const vy = await page.evaluate(() => {
                startGame();
                ai.x = 450;
                setBall(450, GROUND_Y - SLIME_R - BALL_R - 2, 0, 200);
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.vy;
            });
            expect(vy).toBeLessThan(0);
        });

        test('the opponent can keep a rally alive', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                // Fire the ball deep into the opponent court and let the AI cope.
                setBall(320, 120, 200, -100);
                for (let i = 0; i < 240; i++) step(0.016);
                return { rally, scoreP1, scoreP2 };
            });
            expect(s.rally + s.scoreP1 + s.scoreP2).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the ball', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setBall(150, 120, 100, 0);
                togglePause();
                const before = { x: ball.x, y: ball.y };
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.x !== before.x || ball.y !== before.y;
            });
            expect(moved).toBe(false);
        });

        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('resuming lets the ball move again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setBall(150, 120, 100, 0);
                togglePause();
                togglePause();
                const before = ball.x;
                for (let i = 0; i < 10; i++) step(0.016);
                return ball.x > before;
            });
            expect(moved).toBe(true);
        });

        test('restarting after a match resets the score and state', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                scoreP1 = 5;
                scoreP2 = 3;
                rally = 7;
                endGame('p1');
                startGame();
                return { scoreP1, scoreP2, rally, state };
            });
            expect(s.scoreP1).toBe(0);
            expect(s.scoreP2).toBe(0);
            expect(s.rally).toBe(0);
            expect(s.state).toBe('running');
        });

        test('Space restarts after the match is over', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame('p1'); });
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });
    });
});
