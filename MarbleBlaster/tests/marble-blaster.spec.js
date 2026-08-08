const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Blaster', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Blaster', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Blaster');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score and best start at 0', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 720x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '720');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no marbles in the chain before starting', async ({ page }) => {
            expect(await page.evaluate(() => chain.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-blaster-best', '4210'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4210');
        });
    });

    // -----------------------------------------------------------------------
    // The path
    // -----------------------------------------------------------------------
    test.describe('path', () => {
        test('the path has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => pathLength())).toBeGreaterThan(500);
        });

        test('pointAt(0) is the start of the path', async ({ page }) => {
            const same = await page.evaluate(() => {
                const p = pointAt(0);
                return Math.abs(p.x - PATH[0].x) < 0.001 && Math.abs(p.y - PATH[0].y) < 0.001;
            });
            expect(same).toBe(true);
        });

        test('pointAt(pathLength()) is the pit at the end of the path', async ({ page }) => {
            const same = await page.evaluate(() => {
                const p = pointAt(pathLength());
                const end = PATH[PATH.length - 1];
                return Math.abs(p.x - end.x) < 0.001 && Math.abs(p.y - end.y) < 0.001;
            });
            expect(same).toBe(true);
        });

        test('pointAt clamps distances outside the path', async ({ page }) => {
            const clamped = await page.evaluate(() => {
                const before = pointAt(-500);
                const after = pointAt(pathLength() + 500);
                const end = PATH[PATH.length - 1];
                return (
                    Math.abs(before.x - PATH[0].x) < 0.001 &&
                    Math.abs(after.x - end.x) < 0.001
                );
            });
            expect(clamped).toBe(true);
        });

        test('walking the path moves steadily (equal steps cover equal ground)', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const L = pathLength();
                let minStep = Infinity;
                let maxStep = 0;
                let prev = pointAt(0);
                for (let d = 10; d <= L; d += 10) {
                    const p = pointAt(d);
                    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
                    minStep = Math.min(minStep, step);
                    maxStep = Math.max(maxStep, step);
                    prev = p;
                }
                return { minStep, maxStep };
            });
            expect(ok.minStep).toBeGreaterThan(5);
            expect(ok.maxStep).toBeLessThan(15);
        });
    });

    // -----------------------------------------------------------------------
    // Starting the game
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

        test('game starts on level 1 with no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, score, state }; });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.state).toBe('running');
        });

        test('the level has marbles left to spawn', async ({ page }) => {
            expect(await page.evaluate(() => { startGame(); return toSpawn; })).toBeGreaterThan(10);
        });

        test('the shooter holds a current and a next marble colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { currentColor, nextColor, palette: COLORS };
            });
            expect(s.palette).toContain(s.currentColor);
            expect(s.palette).toContain(s.nextColor);
        });

        test('marbles feed onto the path over time', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 300; i++) step(0.016);
                return chain.length;
            });
            expect(n).toBeGreaterThan(3);
        });
    });

    // -----------------------------------------------------------------------
    // Chain behaviour
    // -----------------------------------------------------------------------
    test.describe('chain', () => {
        test('the marbles that feed in use the whole level palette', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 60 * 20; i++) step(1 / 60);
                return { colours: [...new Set(chain.map((m) => m.color))].length, palette: colorsForLevel(level) };
            });
            expect(r.colours).toBeGreaterThan(1);
            expect(r.colours).toBeLessThanOrEqual(r.palette);
        });

        test('the launcher only loads colours that are still on the track', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(2, 400);
                addMarble(2, 400 - SPACING);
                const picks = [];
                for (let i = 0; i < 30; i++) picks.push(pickColor());
                return { picks: [...new Set(picks)], want: COLORS[2] };
            });
            expect(r.picks).toEqual([r.want]);
        });

        test('the chain crawls toward the pit', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 100);
                const before = chain[0].dist;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: chain[0].dist };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('marbles stay packed one diameter apart', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                let worst = 0;
                for (let i = 1; i < chain.length; i++) {
                    const gap = chain[i - 1].dist - chain[i].dist;
                    worst = Math.max(worst, Math.abs(gap - SPACING));
                }
                return worst;
            });
            expect(worst).toBeLessThan(0.5);
        });

        test('the chain still packs up on fast late levels', async ({ page }) => {
            const worst = await page.evaluate(() => {
                startGame();
                level = 15;
                chain.length = 0;
                toSpawn = 20;
                for (let i = 0; i < 60 * 20; i++) step(1 / 60);
                let worst = 0;
                for (let i = 1; i < chain.length; i++) {
                    worst = Math.max(worst, Math.abs(chain[i - 1].dist - chain[i].dist - SPACING));
                }
                return worst;
            });
            expect(worst).toBeLessThan(0.5);
        });

        test('a detached tail catches up to the marble in front of it', async ({ page }) => {
            const gap = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 400);
                addMarble(1, 200); // far behind, big gap
                for (let i = 0; i < 400; i++) step(0.016);
                return chain[0].dist - chain[1].dist;
            });
            expect(gap).toBeLessThan(25);
        });

        test('the chain streams fast while marbles are queued, then slows to a crawl', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                toSpawn = 10;
                addMarble(0, 100);
                const a0 = chain[0].dist;
                step(0.1);
                const streaming = chain[0].dist - a0;
                toSpawn = 0;
                const b0 = chain[0].dist;
                step(0.1);
                return { streaming, crawling: chain[0].dist - b0 };
            });
            expect(r.streaming).toBeGreaterThan(r.crawling * 2);
        });

        test('the incoming stream never outruns its speed cap', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 10;
                level = 1;
                const early = frontSpeed();
                level = 40;
                const late = frontSpeed();
                return { early, late, cap: MAX_FEED_SPEED };
            });
            expect(r.early).toBeLessThanOrEqual(r.cap);
            expect(r.late).toBeLessThanOrEqual(r.cap);
        });

        test('the chain moves faster on later levels', async ({ page }) => {
            const { slow, fast } = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 100);
                const a0 = chain[0].dist;
                step(0.1);
                const slow = chain[0].dist - a0;
                level = 8;
                chain.length = 0;
                addMarble(0, 100);
                const b0 = chain[0].dist;
                step(0.1);
                const fast = chain[0].dist - b0;
                return { slow, fast };
            });
            expect(fast).toBeGreaterThan(slow);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming & firing
    // -----------------------------------------------------------------------
    test.describe('aiming and firing', () => {
        test('aimAt points the launcher at a target', async ({ page }) => {
            const a = await page.evaluate(() => {
                startGame();
                aimAt(shooter.x + 100, shooter.y);
                return aim;
            });
            expect(Math.abs(a)).toBeLessThan(0.001);
        });

        test('ArrowLeft and ArrowRight swing the aim', async ({ page }) => {
            const { left, right, start } = await page.evaluate(() => {
                startGame();
                setAim(0);
                const start = aim;
                keys['ArrowLeft'] = true;
                for (let i = 0; i < 10; i++) step(0.016);
                const left = aim;
                keys['ArrowLeft'] = false;
                setAim(0);
                keys['ArrowRight'] = true;
                for (let i = 0; i < 10; i++) step(0.016);
                const right = aim;
                keys['ArrowRight'] = false;
                return { left, right, start };
            });
            expect(left).toBeLessThan(start);
            expect(right).toBeGreaterThan(start);
        });

        test('firing launches a marble of the current colour', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                projectiles.length = 0;
                setAim(-Math.PI / 2);
                const colour = currentColor;
                fire();
                return { n: projectiles.length, colour, shot: projectiles[0] && projectiles[0].color };
            });
            expect(r.n).toBe(1);
            expect(r.shot).toBe(r.colour);
        });

        test('firing promotes the next marble to the launcher', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                const wasNext = nextColor;
                fire();
                return { wasNext, now: currentColor };
            });
            expect(r.now).toBe(r.wasNext);
        });

        test('a fired marble travels in the aimed direction', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                projectiles.length = 0;
                setAim(-Math.PI / 2); // straight up
                fire();
                const y0 = projectiles[0].y;
                const x0 = projectiles[0].x;
                step(0.05);
                return { dy: projectiles[0].y - y0, dx: Math.abs(projectiles[0].x - x0) };
            });
            expect(r.dy).toBeLessThan(0);
            expect(r.dx).toBeLessThan(0.001);
        });

        test('a rapid second shot is blocked by the reload cooldown', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                projectiles.length = 0;
                fire();
                fire();
                return projectiles.length;
            });
            expect(n).toBe(1);
        });

        test('the launcher reloads after the cooldown elapses', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                projectiles.length = 0;
                fire();
                for (let i = 0; i < 60; i++) step(0.016);
                fire();
                return projectiles.length;
            });
            expect(n).toBeGreaterThan(0);
        });

        test('a marble that misses everything leaves the screen', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                toSpawn = 0;
                projectiles.length = 0;
                setAim(-Math.PI / 2);
                fire();
                for (let i = 0; i < 120; i++) step(0.016);
                return projectiles.length;
            });
            expect(n).toBe(0);
        });

        test('moving the pointer over the canvas aims the launcher', async ({ page }) => {
            await page.evaluate(() => { startGame(); setAim(-Math.PI / 2); });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.move(box.x + 700, box.y + 255);
            const a = await page.evaluate(() => aim);
            expect(Math.abs(a)).toBeLessThan(0.2); // pointing right
        });

        test('clicking the canvas fires a marble', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                chain.length = 0;
                toSpawn = 0;
                projectiles.length = 0;
            });
            const box = await page.locator('#canvas').boundingBox();
            await page.mouse.click(box.x + 360, box.y + 40);
            expect(await page.evaluate(() => projectiles.length)).toBeGreaterThan(0);
        });

        test('S swaps the loaded marble', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                currentColor = COLORS[0];
                nextColor = COLORS[3];
            });
            await page.keyboard.press('KeyS');
            const r = await page.evaluate(() => ({ currentColor, nextColor, palette: COLORS }));
            expect(r.currentColor).toBe(r.palette[3]);
            expect(r.nextColor).toBe(r.palette[0]);
        });

        test('swapping exchanges the current and next marbles', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                currentColor = COLORS[0];
                nextColor = COLORS[1];
                swapMarble();
                return { currentColor, nextColor };
            });
            expect(r.currentColor).toBe(await page.evaluate(() => COLORS[1]));
            expect(r.nextColor).toBe(await page.evaluate(() => COLORS[0]));
        });
    });

    // -----------------------------------------------------------------------
    // Insertion
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('a marble that hits the chain joins it', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                projectiles.length = 0;
                toSpawn = 0;
                addMarble(0, 300);
                addMarble(1, 300 - SPACING);
                addMarble(0, 300 - SPACING * 2);
                const before = chain.length;
                const target = pointAt(300 - SPACING);
                launchAt(target.x, target.y, COLORS[2]);
                for (let i = 0; i < 120; i++) step(0.016);
                return { before, after: chain.length, flying: projectiles.length };
            });
            expect(r.after).toBe(r.before + 1);
            expect(r.flying).toBe(0);
        });

        test('the inserted marble keeps the colour that was fired', async ({ page }) => {
            const colours = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                projectiles.length = 0;
                toSpawn = 0;
                addMarble(0, 300);
                addMarble(1, 300 - SPACING);
                const target = pointAt(300 - SPACING);
                launchAt(target.x, target.y, COLORS[2]);
                for (let i = 0; i < 120; i++) step(0.016);
                return chain.map((m) => m.color);
            });
            expect(colours).toContain(await page.evaluate(() => COLORS[2]));
        });

        test('insertMarble pushes the marbles behind it further back', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 300);
                addMarble(1, 300 - SPACING);
                const tailBefore = chain[1].dist;
                insertMarble(1, COLORS[2]);
                return { tailBefore, tailAfter: chain[2].dist, inserted: chain[1].dist };
            });
            expect(r.tailAfter).toBeCloseTo(r.tailBefore - 24, 3);
            expect(r.inserted).toBeCloseTo(r.tailBefore, 3);
        });

        test('an insertion never pushes a marble back past the entrance', async ({ page }) => {
            const minDist = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                toSpawn = 0;
                // chain packed right up against the entrance
                for (let i = 0; i < 5; i++) addMarble(i % 3, SPACING * (4 - i));
                insertMarble(3, COLORS[4]);
                return Math.min(...chain.map((m) => m.dist));
            });
            expect(minDist).toBeGreaterThanOrEqual(0);
        });

        test('with no room behind, an insertion drives the head forward', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                toSpawn = 0;
                for (let i = 0; i < 4; i++) addMarble(i % 3, SPACING * (3 - i)); // tail sits at 0
                const headBefore = chain[0].dist;
                insertMarble(2, COLORS[4]);
                return { headBefore, headAfter: chain[0].dist, tail: chain[chain.length - 1].dist };
            });
            expect(r.headAfter).toBeCloseTo(r.headBefore + 24, 3);
            expect(r.tail).toBeCloseTo(0, 3);
        });

        test('the chain stays ordered front-to-back after an insertion', async ({ page }) => {
            const ordered = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                for (let i = 0; i < 6; i++) addMarble(i % 2, 400 - i * SPACING);
                insertMarble(3, COLORS[2]);
                for (let i = 1; i < chain.length; i++) {
                    if (chain[i].dist >= chain[i - 1].dist) return false;
                }
                return true;
            });
            expect(ordered).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('completing three of a colour clears them', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 400);
                addMarble(0, 400 - SPACING);
                addMarble(1, 400 - SPACING * 2);
                insertMarble(2, COLORS[0]); // makes red, red, red
                return chain.length;
            });
            expect(n).toBe(1);
        });

        test('clearing marbles scores points', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                chain.length = 0;
                addMarble(0, 400);
                addMarble(0, 400 - SPACING);
                insertMarble(1, COLORS[0]);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('a pair of the same colour is not enough to clear', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 400);
                addMarble(1, 400 - SPACING);
                insertMarble(1, COLORS[0]); // red, red, blue
                return chain.length;
            });
            expect(n).toBe(3);
        });

        test('a run longer than three clears completely', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 400);
                addMarble(0, 400 - SPACING);
                addMarble(0, 400 - SPACING * 2);
                addMarble(0, 400 - SPACING * 3);
                insertMarble(2, COLORS[0]);
                return chain.length;
            });
            expect(n).toBe(0);
        });

        test('the seam closing after a clear triggers a chain reaction', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 0;
                chain.length = 0;
                // blue blue | red red (+red) | blue  -> clearing red joins the blues
                addMarble(1, 500);
                addMarble(1, 500 - SPACING);
                addMarble(0, 500 - SPACING * 2);
                addMarble(0, 500 - SPACING * 3);
                addMarble(1, 500 - SPACING * 4);
                insertMarble(3, COLORS[0]);
                return { left: chain.length, combo: lastCombo };
            });
            expect(r.left).toBe(0);
            expect(r.combo).toBeGreaterThanOrEqual(2);
        });

        test('a chain reaction scores more than a plain match', async ({ page }) => {
            const r = await page.evaluate(() => {
                const plain = () => {
                    startGame();
                    score = 0;
                    chain.length = 0;
                    addMarble(0, 500);
                    addMarble(0, 500 - SPACING);
                    insertMarble(1, COLORS[0]);
                    return score;
                };
                const combo = () => {
                    startGame();
                    score = 0;
                    chain.length = 0;
                    addMarble(1, 500);
                    addMarble(1, 500 - SPACING);
                    addMarble(0, 500 - SPACING * 2);
                    addMarble(0, 500 - SPACING * 3);
                    addMarble(1, 500 - SPACING * 4);
                    insertMarble(3, COLORS[0]);
                    return score;
                };
                return { plain: plain(), combo: combo() };
            });
            expect(r.combo).toBeGreaterThan(r.plain * 2);
        });

        test('clearing the front of the chain works', async ({ page }) => {
            const n = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 400);
                addMarble(0, 400 - SPACING);
                addMarble(1, 400 - SPACING * 2);
                insertMarble(0, COLORS[0]);
                return chain.length;
            });
            expect(n).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing every marble advances to the next level', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                toSpawn = 0;
                chain.length = 0;
                step(0.016);
                return { level, toSpawn };
            });
            expect(r.level).toBe(2);
            expect(r.toSpawn).toBeGreaterThan(0);
        });

        test('finishing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 0;
                toSpawn = 0;
                chain.length = 0;
                step(0.016);
                return score;
            });
            expect(s).toBeGreaterThan(0);
        });

        test('later levels send more marbles', async ({ page }) => {
            const r = await page.evaluate(() => ({ l1: marblesForLevel(1), l5: marblesForLevel(5) }));
            expect(r.l5).toBeGreaterThan(r.l1);
        });

        test('a level never sends more chain than the track can hold', async ({ page }) => {
            const r = await page.evaluate(() => ({
                longest: marblesForLevel(99) * SPACING,
                track: pathLength(),
            }));
            expect(r.longest).toBeLessThan(r.track * 0.75);
        });

        test('the chain speed stops climbing once it hits its cap', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                level = 12;
                const a = chainSpeed();
                level = 60;
                const b = chainSpeed();
                level = 1;
                return { a, b, base: chainSpeed() };
            });
            expect(r.b).toBe(r.a);
            expect(r.a).toBeGreaterThan(r.base);
        });

        test('later levels use more colours, capped at the palette size', async ({ page }) => {
            const r = await page.evaluate(() => ({
                l1: colorsForLevel(1),
                l6: colorsForLevel(6),
                huge: colorsForLevel(99),
                max: COLORS.length,
            }));
            expect(r.l6).toBeGreaterThan(r.l1);
            expect(r.huge).toBe(r.max);
        });

        test('the level counter is shown in the HUD', async ({ page }) => {
            await page.evaluate(() => { startGame(); level = 7; updateHud(); });
            await expect(page.locator('#level')).toHaveText('7');
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('losing', () => {
        test('a marble reaching the pit ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, pathLength() - 2);
                for (let i = 0; i < 60; i++) step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });

        test('the chain stops moving once the game is over', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 100);
                endGame();
                const before = chain[0].dist;
                for (let i = 0; i < 30; i++) step(0.016);
                return chain[0].dist !== before;
            });
            expect(moved).toBe(false);
        });

        test('danger is flagged as the chain nears the pit', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 10);
                const calm = inDanger();
                chain[0].dist = pathLength() - 30;
                return { calm, danger: inDanger() };
            });
            expect(r.calm).toBe(false);
            expect(r.danger).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1234;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('1234');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 555;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-blaster-best'));
            expect(parseInt(stored, 10)).toBe(555);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-blaster-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 12;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('the score is shown in the HUD as it changes', async ({ page }) => {
            await page.evaluate(() => { startGame(); score = 640; updateHud(); });
            await expect(page.locator('#score')).toHaveText('640');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the chain', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 100);
                togglePause();
                const before = chain[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: chain[0].dist };
            });
            expect(r.after).toBe(r.before);
        });

        test('pausing freezes marbles in flight', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                projectiles.length = 0;
                setAim(-Math.PI / 2);
                fire();
                togglePause();
                const before = projectiles[0].y;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: projectiles[0].y };
            });
            expect(r.after).toBe(r.before);
        });

        test('resuming starts the chain again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                addMarble(0, 100);
                togglePause();
                togglePause();
                const before = chain[0].dist;
                for (let i = 0; i < 20; i++) step(0.016);
                return chain[0].dist > before;
            });
            expect(moved).toBe(true);
        });

        test('P toggles the pause state', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => paused)).toBe(true);
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => paused)).toBe(false);
        });

        test('restarting resets score, level, chain and marbles in flight', async ({ page }) => {
            const r = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 6;
                addMarble(0, 100);
                fire();
                endGame();
                startGame();
                return { score, level, chain: chain.length, flying: projectiles.length, state };
            });
            expect(r.score).toBe(0);
            expect(r.level).toBe(1);
            expect(r.chain).toBe(0);
            expect(r.flying).toBe(0);
            expect(r.state).toBe('running');
        });
    });

    // -----------------------------------------------------------------------
    // Rendering smoke test
    // -----------------------------------------------------------------------
    test.describe('rendering', () => {
        test('the canvas paints something after a few seconds of play', async ({ page }) => {
            const painted = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 200; i++) step(0.016);
                draw();
                const data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] || data[i + 1] || data[i + 2]) return true;
                }
                return false;
            });
            expect(painted).toBe(true);
        });

        test('no console errors during a run', async ({ page }) => {
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            await page.mouse.move(400, 200);
            await page.mouse.click(400, 200);
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
