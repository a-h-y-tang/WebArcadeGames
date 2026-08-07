const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Marble Track', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Marble Track', async ({ page }) => {
            await expect(page).toHaveTitle('Marble Track');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts the player to start', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('score, level and best start at their defaults', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#level')).toHaveText('1');
            await expect(page.locator('#best')).toHaveText('0');
        });

        test('canvas is 640x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '640');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('the track is empty before starting', async ({ page }) => {
            expect(await page.evaluate(() => chain.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-track-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });
    });

    // -----------------------------------------------------------------------
    // The track (path geometry)
    // -----------------------------------------------------------------------
    test.describe('track geometry', () => {
        test('the track has a positive length', async ({ page }) => {
            expect(await page.evaluate(() => PATH_LENGTH)).toBeGreaterThan(500);
        });

        test('every point on the track is inside the canvas', async ({ page }) => {
            const inside = await page.evaluate(() => {
                for (let t = 0; t <= PATH_LENGTH; t += 10) {
                    const p = pointAt(t);
                    if (p.x < 0 || p.x > CANVAS_W || p.y < 0 || p.y > CANVAS_H) return false;
                }
                return true;
            });
            expect(inside).toBe(true);
        });

        test('t is an arc length — points 20px apart along t are ~20px apart in space', async ({ page }) => {
            const worst = await page.evaluate(() => {
                let worst = 0;
                for (let t = 0; t + 20 <= PATH_LENGTH; t += 20) {
                    const a = pointAt(t), b = pointAt(t + 20);
                    const d = Math.hypot(b.x - a.x, b.y - a.y);
                    worst = Math.max(worst, Math.abs(d - 20));
                }
                return worst;
            });
            expect(worst).toBeLessThan(2);
        });

        test('pointAt clamps outside the track', async ({ page }) => {
            const same = await page.evaluate(() => {
                const start = pointAt(0), before = pointAt(-500);
                const end = pointAt(PATH_LENGTH), after = pointAt(PATH_LENGTH + 500);
                return {
                    startSame: start.x === before.x && start.y === before.y,
                    endSame: end.x === after.x && end.y === after.y,
                };
            });
            expect(same.startSame).toBe(true);
            expect(same.endSame).toBe(true);
        });

        test('the track ends at the hole', async ({ page }) => {
            const d = await page.evaluate(() => {
                const p = pointAt(PATH_LENGTH);
                return Math.hypot(p.x - HOLE.x, p.y - HOLE.y);
            });
            expect(d).toBeLessThan(1);
        });
    });

    // -----------------------------------------------------------------------
    // Starting a game
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

        test('the game starts on level 1 with a full queue and no score', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { level, score, pending, chain: chain.length, total: marblesForLevel(1) };
            });
            expect(s.level).toBe(1);
            expect(s.score).toBe(0);
            expect(s.pending).toBe(s.total);
            expect(s.chain).toBe(0);
        });

        test('marbles roll onto the track over time', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                return { chain: chain.length, pending };
            });
            expect(s.chain).toBeGreaterThan(1);
            expect(s.pending).toBeLessThan(await page.evaluate(() => marblesForLevel(1)));
        });

        test('marbles on the track are one diameter apart', async ({ page }) => {
            const gaps = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 600; i++) step(0.016);
                const gaps = [];
                for (let i = 1; i < chain.length; i++) gaps.push(marbleT(i - 1) - marbleT(i));
                return gaps;
            });
            expect(gaps.length).toBeGreaterThan(0);
            for (const gap of gaps) expect(gap).toBeCloseTo(await page.evaluate(() => SPACING), 6);
        });

        test('the queue delivers more than one colour', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 900; i++) step(0.016);
                return [...new Set(chain.map((m) => m.color))].length;
            });
            expect(colors).toBeGreaterThan(1);
        });

        test('the queue never delivers a ready-made run of three', async ({ page }) => {
            const worstRun = await page.evaluate(() => {
                let worst = 0;
                for (let attempt = 0; attempt < 5; attempt++) {
                    startGame();
                    for (let i = 0; i < 2000; i++) {
                        if (state !== 'running') break;
                        step(0.016);
                    }
                    let run = 1;
                    for (let i = 1; i < chain.length; i++) {
                        run = chain[i].color === chain[i - 1].color ? run + 1 : 1;
                        worst = Math.max(worst, run);
                    }
                }
                return worst;
            });
            expect(worstRun).toBeLessThan(3);
        });

        test('the queue only uses colours from the level palette', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                for (let i = 0; i < 900; i++) step(0.016);
                const palette = paletteForLevel(level);
                return chain.every((m) => palette.includes(m.color));
            });
            expect(ok).toBe(true);
        });

        test('the queue never over-spawns past the level total', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const total = marblesForLevel(1);
                for (let i = 0; i < 4000; i++) {
                    if (state !== 'running') break;
                    step(0.016);
                }
                return { total, spawned: total - pending };
            });
            expect(s.spawned).toBeLessThanOrEqual(s.total);
            expect(s.spawned).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // The chain rolling toward the hole
    // -----------------------------------------------------------------------
    test.describe('the chain', () => {
        test('the chain rolls toward the hole', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 200);
                const before = headT;
                for (let i = 0; i < 60; i++) step(0.016);
                return { before, after: headT };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('marble positions decrease along the chain', async ({ page }) => {
            const ordered = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green', 'yellow'], 300);
                for (let i = 1; i < chain.length; i++) {
                    if (marbleT(i) >= marbleT(i - 1)) return false;
                }
                return true;
            });
            expect(ordered).toBe(true);
        });

        test('the chain rolls faster on later levels', async ({ page }) => {
            const { l1, l5 } = await page.evaluate(() => ({
                l1: speedForLevel(1),
                l5: speedForLevel(5),
            }));
            expect(l5).toBeGreaterThan(l1);
        });

        test('later levels hold more marbles', async ({ page }) => {
            const { l1, l4 } = await page.evaluate(() => ({
                l1: marblesForLevel(1),
                l4: marblesForLevel(4),
            }));
            expect(l4).toBeGreaterThan(l1);
        });
    });

    // -----------------------------------------------------------------------
    // The shooter
    // -----------------------------------------------------------------------
    test.describe('the shooter', () => {
        test('shooting launches a marble in the shooter colour', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooterColor = 'red';
                shootAt(HOLE.x + 200, HOLE.y);
                return { color: shot && shot.color, x: shot && shot.x, y: shot && shot.y };
            });
            expect(s.color).toBe('red');
            expect(s.x).toBeCloseTo(await page.evaluate(() => SHOOTER.x), 6);
            expect(s.y).toBeCloseTo(await page.evaluate(() => SHOOTER.y), 6);
        });

        test('the next marble becomes the loaded marble after a shot', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooterColor = 'red';
                nextColor = 'blue';
                shootAt(SHOOTER.x + 100, SHOOTER.y);
                return { loaded: shooterColor };
            });
            expect(s.loaded).toBe('blue');
        });

        test('only one marble can be in flight at a time', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                const first = shootAt(SHOOTER.x + 100, SHOOTER.y);
                const second = shootAt(SHOOTER.x - 100, SHOOTER.y);
                return { first, second };
            });
            expect(s.first).toBe(true);
            expect(s.second).toBe(false);
        });

        test('a shot marble flies toward the target', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shootAt(SHOOTER.x + 100, SHOOTER.y);
                const before = shot.x;
                step(0.05);
                return { before, after: shot.x, y0: SHOOTER.y, y: shot.y };
            });
            expect(s.after).toBeGreaterThan(s.before);
            expect(Math.abs(s.y - s.y0)).toBeLessThan(1);
        });

        test('a shot that hits nothing leaves the board', async ({ page }) => {
            const gone = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                shootAt(SHOOTER.x + 100, SHOOTER.y);
                for (let i = 0; i < 200; i++) step(0.016);
                return shot === null;
            });
            expect(gone).toBe(true);
        });

        test('swapping exchanges the loaded and next marbles', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                shooterColor = 'red';
                nextColor = 'blue';
                swapShooter();
                return { loaded: shooterColor, next: nextColor };
            });
            expect(s.loaded).toBe('blue');
            expect(s.next).toBe('red');
        });

        test('Space swaps the loaded marble while the game is running', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                shooterColor = 'red';
                nextColor = 'green';
            });
            await page.keyboard.press('Space');
            const s = await page.evaluate(() => ({ loaded: shooterColor, next: nextColor }));
            expect(s.loaded).toBe('green');
            expect(s.next).toBe('red');
        });

        test('aiming at the mouse updates the shooter angle', async ({ page }) => {
            const angles = await page.evaluate(() => {
                startGame();
                aimAt(SHOOTER.x + 100, SHOOTER.y);
                const right = aimAngle;
                aimAt(SHOOTER.x, SHOOTER.y + 100);
                return { right, down: aimAngle };
            });
            expect(angles.right).toBeCloseTo(0, 3);
            expect(angles.down).toBeCloseTo(Math.PI / 2, 3);
        });

        test('the loaded marble only uses colours still on the track', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red', 'red'], 300);
                const seen = new Set();
                for (let i = 0; i < 50; i++) seen.add(rollColor());
                return [...seen];
            });
            expect(colors).toEqual(['red']);
        });

        test('the loaded marble uses the level palette when the track is empty', async ({ page }) => {
            const ok = await page.evaluate(() => {
                startGame();
                chain.length = 0;
                for (let i = 0; i < 50; i++) {
                    if (!paletteForLevel(level).includes(rollColor())) return false;
                }
                return true;
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Inserting marbles into the chain
    // -----------------------------------------------------------------------
    test.describe('insertion', () => {
        test('inserting adds a marble at the requested index', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 300);
                insertMarble(1, 'yellow');
                return chain.map((m) => m.color);
            });
            expect(colors).toEqual(['red', 'yellow', 'blue', 'green']);
        });

        test('inserting pushes the chain one diameter closer to the hole', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green'], 300);
                const before = headT;
                insertMarble(2, 'yellow');
                return { before, after: headT };
            });
            expect(after - before).toBeCloseTo(await page.evaluate(() => SPACING), 6);
        });

        test('inserting at the front makes a new head marble', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 300);
                insertMarble(0, 'green');
                return { head: chain[0].color, headPos: marbleT(0), second: marbleT(1) };
            });
            expect(s.head).toBe('green');
            expect(s.headPos - s.second).toBeCloseTo(await page.evaluate(() => SPACING), 6);
        });

        test('marbles behind the insertion point keep their position', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue', 'green', 'yellow'], 300);
                const before = marbleT(3);
                insertMarble(1, 'purple');
                return { before, after: marbleT(4) };
            });
            expect(after).toBeCloseTo(before, 6);
        });

        test('a shot marble that reaches the chain is inserted into it', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                // Two colours that cannot match, so the marble sticks.
                setChain(['red', 'blue', 'red', 'blue', 'red', 'blue'], 400);
                const target = marblePos(3);
                shooterColor = 'green';
                shootAt(target.x, target.y);
                for (let i = 0; i < 400 && shot; i++) step(0.005);
                return { len: chain.length, colors: chain.map((m) => m.color), shot };
            });
            expect(s.shot).toBe(null);
            expect(s.len).toBe(7);
            expect(s.colors).toContain('green');
        });
    });

    // -----------------------------------------------------------------------
    // Matching
    // -----------------------------------------------------------------------
    test.describe('matching', () => {
        test('three of a colour clear the track', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'red', 'red', 'green'], 300);
                insertMarble(2, 'red');
                return chain.map((m) => m.color);
            });
            expect(colors).toEqual(['blue', 'green']);
        });

        test('two of a colour do not clear', async ({ page }) => {
            const colors = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'red', 'green'], 300);
                insertMarble(2, 'red');
                return chain.map((m) => m.color);
            });
            expect(colors).toEqual(['blue', 'red', 'red', 'green']);
        });

        test('a match scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'red', 'red', 'green'], 300);
                insertMarble(2, 'red');
                return window.score;
            });
            expect(score).toBeGreaterThan(0);
        });

        test('longer runs clear entirely and score more', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red', 'red', 'red'], 300);
                insertMarble(0, 'red');
                const five = { len: chain.length, score };
                score = 0;
                setChain(['blue', 'red', 'red', 'green'], 300);
                insertMarble(2, 'red');
                return { five, three: score };
            });
            expect(s.five.len).toBe(0);
            expect(s.five.score).toBeGreaterThan(s.three);
        });

        test('clearing behind the head does not pull the chain back', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'green', 'red', 'red'], 300);
                const before = headT;
                insertMarble(4, 'red'); // clears the three reds at the back
                return { before, after: headT };
            });
            // only the insertion shove moves the head; the pop happens behind it
            const spacing = await page.evaluate(() => SPACING);
            expect(after).toBeCloseTo(before + spacing, 6);
        });

        test('clearing the head pulls the chain back from the hole', async ({ page }) => {
            const { before, after, cleared } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red', 'blue', 'green'], 300);
                const before = headT;
                insertMarble(0, 'red'); // head run of three reds clears
                return { before, after: headT, cleared: chain.map((m) => m.color) };
            });
            expect(cleared).toEqual(['blue', 'green']);
            // head pushed forward by the insert, then pulled back by 3 removals
            const spacing = await page.evaluate(() => SPACING);
            expect(after).toBeCloseTo(before - 2 * spacing, 6);
        });

        test('a match that joins two runs sets off a chain reaction', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'blue', 'red', 'red', 'blue', 'blue'], 400);
                insertMarble(2, 'red');
                return { colors: chain.map((m) => m.color), combo: lastCombo };
            });
            expect(s.colors).toEqual([]);
            expect(s.combo).toBe(2);
        });

        test('a chain reaction scores more than the same marbles cleared singly', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'blue', 'red', 'red', 'blue', 'blue'], 400);
                insertMarble(2, 'red');
                const comboScore = score;
                score = 0;
                setChain(['red', 'red', 'yellow'], 400);
                insertMarble(0, 'red');
                const a = score;
                score = 0;
                setChain(['blue', 'blue', 'yellow'], 400);
                insertMarble(0, 'blue');
                const b = score;
                return { comboScore, singles: a + b };
            });
            expect(s.comboScore).toBeGreaterThan(s.singles);
        });

        test('a single match reports a combo of one', async ({ page }) => {
            const combo = await page.evaluate(() => {
                startGame();
                setChain(['blue', 'red', 'red', 'green'], 300);
                insertMarble(2, 'red');
                return lastCombo;
            });
            expect(combo).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Levels
    // -----------------------------------------------------------------------
    test.describe('levels', () => {
        test('clearing the track with an empty queue advances the level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red'], 300);
                insertMarble(0, 'red'); // clears the track completely
                step(0.016);
                return { level, state };
            });
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
        });

        test('a new level refills the queue and empties the track', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'red'], 300);
                insertMarble(0, 'red'); // clears the track completely
                step(0.016);
                return { pending, chain: chain.length, headT };
            });
            expect(s.pending).toBe(await page.evaluate(() => marblesForLevel(2)));
            expect(s.chain).toBeLessThanOrEqual(1);
            expect(s.headT).toBeLessThan(50);
        });

        test('clearing a level awards a bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                pending = 0;
                score = 0;
                chain.length = 0;
                step(0.016);
                return { score, level };
            });
            expect(s.level).toBe(2);
            expect(s.score).toBeGreaterThan(0);
        });

        test('marbles still in the queue keep the level going', async ({ page }) => {
            const level = await page.evaluate(() => {
                startGame();
                pending = 5;
                chain.length = 0;
                step(0.016);
                return window.level;
            });
            expect(level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Losing
    // -----------------------------------------------------------------------
    test.describe('game over', () => {
        test('a marble reaching the hole ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], PATH_LENGTH - 1);
                for (let i = 0; i < 120; i++) step(0.016);
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
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 300);
                endGame();
                const before = headT;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: headT };
            });
            expect(after).toBe(before);
        });

        test('the best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 777;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('777');
        });

        test('the best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 555;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('marble-track-best'));
            expect(parseInt(stored, 10)).toBe(555);
        });

        test('the best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('marble-track-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 12;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('P pauses the game', async ({ page }) => {
            await page.evaluate(() => startGame());
            await page.keyboard.press('KeyP');
            expect(await page.evaluate(() => state)).toBe('paused');
        });

        test('pausing freezes the chain', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 300);
                togglePause();
                const before = headT;
                for (let i = 0; i < 30; i++) step(0.016);
                return { before, after: headT };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the chain roll again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                setChain(['red', 'blue'], 300);
                togglePause();
                togglePause();
                const before = headT;
                for (let i = 0; i < 30; i++) step(0.016);
                return headT > before;
            });
            expect(moved).toBe(true);
        });

        test('shooting is ignored while paused', async ({ page }) => {
            const fired = await page.evaluate(() => {
                startGame();
                togglePause();
                return shootAt(SHOOTER.x + 100, SHOOTER.y);
            });
            expect(fired).toBe(false);
        });

        test('restarting resets score, level, track and queue', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 4;
                setChain(['red', 'blue', 'green'], 500);
                endGame();
                startGame();
                return { score, level, chain: chain.length, headT, pending, state, shot };
            });
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.chain).toBe(0);
            expect(s.headT).toBe(0);
            expect(s.pending).toBe(await page.evaluate(() => marblesForLevel(1)));
            expect(s.state).toBe('running');
            expect(s.shot).toBe(null);
        });
    });
});
