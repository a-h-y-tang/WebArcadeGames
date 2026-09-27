const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// Mirrors the marble diameter in game.js — used for spacing assertions.
const MARBLE_D = 26;

// Advance the simulation deterministically: `frames` fixed 16ms steps.
const STEP = (frames) => `for (let i = 0; i < ${frames}; i++) step(0.016);`;

test.describe('Marble Loop', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Loop', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Loop');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('start overlay is visible and prompts the player', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best are shown in the HUD', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles and no shots before starting', async ({ page }) => {
            const counts = await page.evaluate(() => ({ c: chain.length, p: projectiles.length }));
            expect(counts).toEqual({ c: 0, p: 0 });
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marbleloop-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The track
    // -----------------------------------------------------------------------
    test.describe('track', () => {
        test('the path is long enough to hold a full chain', async ({ page }) => {
            const len = await page.evaluate(() => pathLength);
            expect(len).toBeGreaterThan(1500);
        });

        test('pointAt walks from the spawn mouth to the pit', async ({ page }) => {
            const { start, end } = await page.evaluate(() => ({
                start: pointAt(0),
                end: pointAt(pathLength),
            }));
            expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(100);
        });

        test('every point of the path lies inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let d = 0; d <= pathLength; d += 5) {
                    const p = pointAt(d);
                    if (p.x < MARBLE_R || p.x > CANVAS_W - MARBLE_R) return false;
                    if (p.y < MARBLE_R || p.y > CANVAS_H - MARBLE_R) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('pointAt clamps beyond the ends of the path', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = pointAt(-500), b = pointAt(0);
                const c = pointAt(pathLength + 500), d = pointAt(pathLength);
                return a.x === b.x && a.y === b.y && c.x === d.x && c.y === d.y;
            });
            expect(same).toBe(true);
        });

        test('the launcher sits clear of the track', async ({ page }) => {
            const clearance = await page.evaluate(() => {
                let min = Infinity;
                for (let d = 0; d <= pathLength; d += 4) {
                    const p = pointAt(d);
                    min = Math.min(min, Math.hypot(p.x - LAUNCH_X, p.y - LAUNCH_Y));
                }
                return min;
            });
            expect(clearance).toBeGreaterThan(MARBLE_D * 2);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
    // -----------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the game', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the Start button starts the game', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('starting hides the overlay', async ({ page }) => {
            await page.keyboard.press('Space');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('a fresh game starts on level 1 with score 0 and a full queue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, queue: spawnQueue, chain: chain.length };
            });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.queue).toBeGreaterThan(20);
            expect(s.chain).toBe(0);
        });

        test('the launcher is loaded with a current and a next marble', async ({ page }) => {
            const l = await page.evaluate(() => {
                startGame();
                return { current: launcher.current, next: launcher.next };
            });
            expect(Number.isInteger(l.current)).toBe(true);
            expect(Number.isInteger(l.next)).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // The advancing chain
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('marbles feed onto the track while the queue lasts', async ({ page }) => {
            const grown = await page.evaluate(`(() => {
                startGame();
                ${STEP(120)}
                return chain.length;
            })()`);
            expect(grown).toBeGreaterThan(3);
        });

        test('spawning drains the queue', async ({ page }) => {
            const { before, after } = await page.evaluate(`(() => {
                startGame();
                const before = spawnQueue;
                ${STEP(120)}
                return { before, after: spawnQueue };
            })()`);
            expect(after).toBeLessThan(before);
        });

        test('the chain creeps toward the pit', async ({ page }) => {
            const { before, after } = await page.evaluate(`(() => {
                startGame();
                setChain([0, 1, 2, 0, 1], 400);
                const before = chain[0].dist;
                ${STEP(60)}
                return { before, after: chain[0].dist };
            })()`);
            expect(after).toBeGreaterThan(before);
        });

        test('marbles never overlap each other', async ({ page }) => {
            const minGap = await page.evaluate(`(() => {
                startGame();
                let min = Infinity;
                for (let i = 0; i < 400; i++) {
                    step(0.016);
                    for (let j = 1; j < chain.length; j++) {
                        min = Math.min(min, chain[j - 1].dist - chain[j].dist);
                    }
                }
                return min;
            })()`);
            expect(minGap).toBeGreaterThan(MARBLE_D - 0.01);
        });

        test('marbles never slide backwards', async ({ page }) => {
            const monotonic = await page.evaluate(`(() => {
                startGame();
                setChain([0, 1, 2, 3, 0, 1], 300);
                let prev = chain.map((m) => m.dist);
                for (let i = 0; i < 200; i++) {
                    step(0.016);
                    for (let j = 0; j < chain.length && j < prev.length; j++) {
                        if (chain[j].dist < prev[j] - 1e-9) return false;
                    }
                    prev = chain.map((m) => m.dist);
                }
                return true;
            })()`);
            expect(monotonic).toBe(true);
        });

        test('gaps behind a hole close faster than the chain advances', async ({ page }) => {
            const closed = await page.evaluate(`(() => {
                startGame();
                setChain([0, 1, 2, 3, 4, 0], 600);
                chain[3].dist -= 120;
                chain[4].dist -= 120;
                chain[5].dist -= 120;
                const gapBefore = chain[2].dist - chain[3].dist;
                ${STEP(60)}
                return { gapBefore, gapAfter: chain[2].dist - chain[3].dist };
            })()`);
            expect(closed.gapAfter).toBeLessThan(closed.gapBefore);
        });

        test('fresh chains never spawn three of a colour in a row', async ({ page }) => {
            const ok = await page.evaluate(`(() => {
                for (let seed = 1; seed <= 8; seed++) {
                    setSeed(seed);
                    startGame();
                    ${STEP(600)}
                    for (let i = 2; i < chain.length; i++) {
                        if (chain[i].color === chain[i - 1].color && chain[i].color === chain[i - 2].color) return false;
                    }
                }
                return true;
            })()`);
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming and shooting
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('aimAt points the launcher at a target', async ({ page }) => {
            const angle = await page.evaluate(() => {
                startGame();
                aimAt(LAUNCH_X + 100, LAUNCH_Y);
                return launcher.angle;
            });
            expect(Math.abs(angle)).toBeLessThan(1e-6);
        });

        test('arrow keys rotate the launcher', async ({ page }) => {
            await page.evaluate(() => { startGame(); aimAt(LAUNCH_X + 100, LAUNCH_Y); });
            await page.keyboard.down('ArrowRight');
            const after = await page.evaluate(`(() => { ${STEP(30)} return launcher.angle; })()`);
            await page.keyboard.up('ArrowRight');
            expect(after).toBeGreaterThan(0);
        });

        test('moving the mouse over the canvas aims the launcher', async ({ page }) => {
            await page.evaluate(() => { startGame(); aimAt(LAUNCH_X + 100, LAUNCH_Y); });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
            const angle = await page.evaluate(() => launcher.angle);
            expect(angle).toBeGreaterThan(1);
        });
    });

    test.describe('shooting', () => {
        test('Space fires a marble once the game is running', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => projectiles.length)).toBe(1);
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.locator('#canvas').click({ position: { x: 320, y: 470 } });
            expect(await page.evaluate(() => projectiles.length)).toBe(1);
        });

        test('the fired marble carries the loaded colour and the next one loads', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const current = launcher.current, next = launcher.next;
                aimAt(LAUNCH_X, LAUNCH_Y + 100);
                shoot();
                return { fired: projectiles[0].color, current, next, nowCurrent: launcher.current };
            });
            expect(r.fired).toBe(r.current);
            expect(r.nowCurrent).toBe(r.next);
        });

        test('a fired marble travels along the aim direction', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                aimAt(LAUNCH_X, LAUNCH_Y + 100);
                shoot();
                const y0 = projectiles[0].y;
                ${STEP(5)}
                return { y0, y1: projectiles.length ? projectiles[0].y : Infinity };
            })()`);
            expect(r.y1).toBeGreaterThan(r.y0);
        });

        test('a marble that hits nothing leaves the board', async ({ page }) => {
            const left = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1], 100);
                aimAt(LAUNCH_X, LAUNCH_Y + 100);
                shoot();
                ${STEP(120)}
                return projectiles.length;
            })()`);
            expect(left).toBe(0);
        });

        test('a fire cooldown stops machine-gunning', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                shoot(); shoot(); shoot();
                return shotsFired;
            });
            expect(n).toBe(1);
        });

        test('the cooldown expires so the next shot can be fired', async ({ page }) => {
            const n = await page.evaluate(`(() => {
                startGame();
                shoot();
                ${STEP(30)}
                shoot();
                return shotsFired;
            })()`);
            expect(n).toBe(2);
        });

        test('S swaps the loaded and the queued marble', async ({ page }) => {
            await page.evaluate(() => startGame());
            const before = await page.evaluate(() => ({ c: launcher.current, n: launcher.next }));
            await page.keyboard.press('s');
            const after = await page.evaluate(() => ({ c: launcher.current, n: launcher.next }));
            expect(after).toEqual({ c: before.n, n: before.c });
        });

        test('loaded colours are drawn from the colours still on the track', async ({ page }) => {
            const ok = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([2, 2, 3, 4, 3], 500);
                for (let i = 0; i < 40; i++) {
                    reloadLauncher();
                    if (![2, 3, 4].includes(launcher.next)) return false;
                }
                return true;
            })()`);
            expect(ok).toBe(true);
        });

        test('shooting is ignored while the game is not running', async ({ page }) => {
            const n = await page.evaluate(() => { shoot(); return projectiles.length; });
            expect(n).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Insertion and matching
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a marble that reaches the chain joins it', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 0, 1, 0, 1, 0, 1], pathLength - 200);
                const before = chain.length;
                const target = pointAt(chain[4].dist);
                shootAt(target.x, target.y, 2);
                ${STEP(40)}
                return { before, after: chain.length, colors: chain.map((m) => m.color) };
            })()`);
            expect(r.after).toBe(r.before + 1);
            expect(r.colors).toContain(2);
        });

        test('joining the chain keeps marbles spaced apart', async ({ page }) => {
            const minGap = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 0, 1, 0, 1, 0, 1], pathLength - 200);
                const target = pointAt(chain[4].dist);
                shootAt(target.x, target.y, 2);
                ${STEP(40)}
                let min = Infinity;
                for (let i = 1; i < chain.length; i++) min = Math.min(min, chain[i - 1].dist - chain[i].dist);
                return min;
            })()`);
            expect(minGap).toBeGreaterThan(MARBLE_D - 0.01);
        });

        test('the marble is consumed by the chain', async ({ page }) => {
            const left = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 0, 1, 0, 1, 0, 1], pathLength - 200);
                const target = pointAt(chain[4].dist);
                shootAt(target.x, target.y, 2);
                ${STEP(40)}
                return projectiles.length;
            })()`);
            expect(left).toBe(0);
        });
    });

    test.describe('matching', () => {
        test('three touching marbles of one colour pop', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                const before = chain.length;
                step(0.016);
                return { before, after: chain.length, colors: chain.map((m) => m.color) };
            })()`);
            expect(r.after).toBe(3);
            expect(r.colors).not.toContain(2);
        });

        test('popping marbles scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                step(0.016);
                return score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('a pair does not pop', async ({ page }) => {
            const len = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 3, 4, 1], 800);
                ${STEP(10)}
                return chain.length;
            })()`);
            expect(len).toBe(6);
        });

        test('marbles separated by a gap do not count as a run', async ({ page }) => {
            const len = await page.evaluate(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                chain[3].dist -= 100;
                chain[4].dist -= 100;
                chain[5].dist -= 100;
                step(0.001);
                return chain.length;
            });
            expect(len).toBe(6);
        });

        test('a shot that completes a run of three pops all three', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 1, 3, 4, 0, 2, 4], pathLength - 200);
                const before = chain.length;
                const target = pointAt(chain[2].dist);
                shootAt(target.x, target.y, 1);
                ${STEP(40)}
                return { before, after: chain.length, score: score };
            })()`);
            expect(r.after).toBeLessThan(r.before);
            expect(r.score).toBeGreaterThan(0);
        });

        test('a closing gap that reunites a colour chains a combo', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([4, 4, 2, 2, 2, 4, 0, 1], 900);
                ${STEP(120)}
                return { colors: chain.map((m) => m.color), score: score, len: chain.length };
            })()`);
            // the 2s pop, the gap closes and the 4s meet to make three
            expect(r.len).toBe(2);
            expect(r.colors).toEqual([0, 1]);
        });

        test('a combo is worth more than the same marbles popped cold', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([4, 4, 2, 2, 2, 4, 0, 1], 900);
                ${STEP(120)}
                const comboScore = score;
                startGame();
                setSpawnQueue(0);
                setChain([2, 2, 2, 0, 1], 900);
                ${STEP(5)}
                const flatScore = score;
                startGame();
                setSpawnQueue(0);
                setChain([4, 4, 4, 0, 1], 900);
                ${STEP(5)}
                return { comboScore, plain: flatScore + score };
            })()`);
            expect(r.comboScore).toBeGreaterThan(r.plain);
        });
    });

    // -----------------------------------------------------------------------
    // Losing and winning
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('the game ends when the chain reaches the pit', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
                return state;
            })()`);
            expect(s).toBe('over');
        });

        test('game over shows the overlay with the final score', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
            })()`);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/over/i);
            await expect(page.locator('#overlay-score')).toContainText(/score/i);
        });

        test('the best score is kept in localStorage', async ({ page }) => {
            const best = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                step(0.016);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
                return window.localStorage.getItem('marbleloop-best');
            })()`);
            expect(parseInt(best, 10)).toBeGreaterThan(0);
        });

        test('Space restarts after a game over', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
            })()`);
            await page.keyboard.press('Space');
            // The animation frame may already have fed a marble onto the track, so
            // assert on the level's full complement rather than on an empty track.
            const s = await page.evaluate(() => ({
                state, level, score, total: spawnQueue + chain.length,
            }));
            expect(s).toEqual({ state: 'running', level: 1, score: 0, total: 34 });
        });

        test('the simulation freezes once the game is over', async ({ page }) => {
            const same = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
                const snapshot = chain.map((m) => m.dist);
                ${STEP(60)}
                return chain.every((m, i) => m.dist === snapshot[i]);
            })()`);
            expect(same).toBe(true);
        });
    });

    test.describe('clearing a level', () => {
        test('clearing the track completes the level', async ({ page }) => {
            const s = await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 1, 2, 2, 2, 1], 800);
                ${STEP(120)}
                return state;
            })()`);
            expect(s).toBe('cleared');
        });

        test('a cleared level awards a bonus and offers the next level', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 1, 2, 2, 2, 1], 800);
                ${STEP(120)}
            })()`);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/level/i);
            expect(await page.evaluate(() => score)).toBeGreaterThan(0);
        });

        test('Space starts the next level with a fresh track', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 1, 2, 2, 2, 1], 800);
                ${STEP(120)}
            })()`);
            const scoreBefore = await page.evaluate(() => score);
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ state, level, score, queue: spawnQueue }));
            expect(s.state).toBe('running');
            expect(s.level).toBe(2);
            expect(s.score).toBe(scoreBefore);
            expect(s.queue).toBeGreaterThan(20);
        });

        test('later levels are longer, faster and more colourful', async ({ page }) => {
            const r = await page.evaluate(() => ({
                speed: [chainSpeed(1), chainSpeed(5)],
                colors: [paletteSize(1), paletteSize(9)],
                queue: [levelMarbles(1), levelMarbles(4)],
            }));
            expect(r.speed[1]).toBeGreaterThan(r.speed[0]);
            expect(r.colors[1]).toBeGreaterThan(r.colors[0]);
            expect(r.queue[1]).toBeGreaterThan(r.queue[0]);
        });

        test('the colour palette never exceeds the available colours', async ({ page }) => {
            const max = await page.evaluate(() => {
                let m = 0;
                for (let l = 1; l <= 40; l++) m = Math.max(m, paletteSize(l));
                return { m, colors: COLORS.length };
            });
            expect(max.m).toBeLessThanOrEqual(max.colors);
        });
    });

    // -----------------------------------------------------------------------
    // Pausing and the HUD
    // -----------------------------------------------------------------------
    test.describe('pause', () => {
        test('P pauses and resumes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('paused');
            await page.keyboard.press('p');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a paused chain does not move', async ({ page }) => {
            const same = await page.evaluate(`(() => {
                startGame();
                setChain([0, 1, 2], 400);
                togglePause();
                const before = chain[0].dist;
                ${STEP(60)}
                return before === chain[0].dist;
            })()`);
            expect(same).toBe(true);
        });

        test('pausing shows the overlay', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('p');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paused/i);
        });
    });

    test.describe('HUD', () => {
        test('the score readout follows the score', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                step(0.016);
            });
            const shown = await page.locator('#score').textContent();
            expect(parseInt(shown, 10)).toBe(await page.evaluate(() => score));
        });

        test('the remaining readout counts queued plus tracked marbles', async ({ page }) => {
            const r = await page.evaluate(`(() => {
                startGame();
                ${STEP(90)}
                return { shown: document.getElementById('remaining').textContent, real: spawnQueue + chain.length };
            })()`);
            expect(parseInt(r.shown, 10)).toBe(r.real);
        });

        test('the level readout follows the level', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 1, 2, 2, 2, 1], 800);
                ${STEP(120)}
            })()`);
            await page.keyboard.press('Space');
            await expect(page.locator('#level')).toHaveText('2');
        });

        test('the best readout updates when the score beats it', async ({ page }) => {
            await page.evaluate(`(() => {
                startGame();
                setSpawnQueue(0);
                setChain([1, 2, 2, 2, 3, 1], 800);
                step(0.016);
                setChain([0, 1, 2], pathLength - 4);
                ${STEP(60)}
            })()`);
            const best = parseInt(await page.locator('#best').textContent(), 10);
            expect(best).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas is painted', async ({ page }) => {
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

        test('no page errors while playing', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.evaluate(`(() => {
                startGame();
                for (let i = 0; i < 300; i++) { step(0.016); if (i % 20 === 0) shoot(); draw(); }
            })()`);
            expect(errors).toEqual([]);
        });
    });
});
