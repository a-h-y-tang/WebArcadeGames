const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

test.describe('Barrel Climb', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial / idle state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Barrel Climb', async ({ page }) => {
            await expect(page).toHaveTitle('Barrel Climb');
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

        test('canvas is 600x480', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '600');
            await expect(canvas).toHaveAttribute('height', '480');
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('no barrels before starting', async ({ page }) => {
            expect(await page.evaluate(() => barrels.length)).toBe(0);
        });

        test('best score loads from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('barrel-climb-best', '4200'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4200');
        });

        test('the stage has five floors and four ladders', async ({ page }) => {
            const stage = await page.evaluate(() => ({ p: platforms.length, l: ladders.length }));
            expect(stage.p).toBe(5);
            expect(stage.l).toBe(4);
        });

        test('every ladder connects two real platforms', async ({ page }) => {
            const ok = await page.evaluate(() => ladders.every((l) => {
                const below = platforms[l.floor];
                const above = platforms[l.floor + 1];
                if (!below || !above) return false;
                const on = (p) => l.x >= p.x && l.x <= p.x + p.w;
                return on(below) && on(above);
            }));
            expect(ok).toBe(true);
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

        test('game starts on level 1 with 3 lives and no score', async ({ page }) => {
            const s = await page.evaluate(() => { startGame(); return { level, lives, score }; });
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.score).toBe(0);
        });

        test('player starts standing on the bottom floor', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                return { y: player.y, floorY: platforms[0].y, onGround: player.onGround };
            });
            expect(s.y).toBe(s.floorY);
            expect(s.onGround).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Running
    // -----------------------------------------------------------------------
    test.describe('running', () => {
        test('moving right increases the player x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerX(300);
                const before = player.x;
                movePlayer(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('moving left decreases the player x', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerX(300);
                const before = player.x;
                movePlayer(-1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.x };
            });
            expect(after).toBeLessThan(before);
        });

        test('the player cannot run off the left edge', async ({ page }) => {
            const x = await page.evaluate(() => {
                startGame();
                movePlayer(-1);
                for (let i = 0; i < 300; i++) step(0.016);
                return player.x;
            });
            expect(x).toBeGreaterThanOrEqual(0);
        });

        test('the player cannot run off the right edge', async ({ page }) => {
            const { x, w } = await page.evaluate(() => {
                startGame();
                movePlayer(1);
                for (let i = 0; i < 300; i++) step(0.016);
                return { x: player.x, w: CANVAS_W };
            });
            expect(x).toBeLessThanOrEqual(w);
        });

        test('running along a floor keeps the player at the same height', async ({ page }) => {
            const { y0, y1 } = await page.evaluate(() => {
                startGame();
                setPlayerX(200);
                const y0 = player.y;
                movePlayer(1);
                for (let i = 0; i < 30; i++) step(0.016);
                return { y0, y1: player.y };
            });
            expect(y1).toBe(y0);
        });

        test('ArrowRight key moves the player right', async ({ page }) => {
            await page.evaluate(() => { startGame(); setPlayerX(300); });
            const before = await page.evaluate(() => player.x);
            await page.keyboard.down('ArrowRight');
            await page.evaluate(() => { for (let i = 0; i < 10; i++) step(0.016); });
            await page.keyboard.up('ArrowRight');
            const after = await page.evaluate(() => player.x);
            expect(after).toBeGreaterThan(before);
        });

        test('walking off the end of an upper floor makes the player fall', async ({ page }) => {
            const landed = await page.evaluate(() => {
                startGame();
                // stand on floor 2 (spans the left side) and run off its right end
                placePlayerOnFloor(2, platforms[2].x + platforms[2].w - 10);
                movePlayer(1);
                for (let i = 0; i < 120; i++) step(0.016);
                return { y: player.y, floor1: platforms[1].y };
            });
            expect(landed.y).toBe(landed.floor1);
        });
    });

    // -----------------------------------------------------------------------
    // Jumping
    // -----------------------------------------------------------------------
    test.describe('jumping', () => {
        test('jumping lifts the player off the floor', async ({ page }) => {
            const { start, mid, airborne } = await page.evaluate(() => {
                startGame();
                const start = player.y;
                jump();
                for (let i = 0; i < 5; i++) step(0.016);
                return { start, mid: player.y, airborne: !player.onGround };
            });
            expect(mid).toBeLessThan(start);
            expect(airborne).toBe(true);
        });

        test('the player lands back on the same floor', async ({ page }) => {
            const { start, end, onGround } = await page.evaluate(() => {
                startGame();
                const start = player.y;
                jump();
                for (let i = 0; i < 120; i++) step(0.016);
                return { start, end: player.y, onGround: player.onGround };
            });
            expect(end).toBe(start);
            expect(onGround).toBe(true);
        });

        test('the player cannot jump again while airborne', async ({ page }) => {
            const same = await page.evaluate(() => {
                startGame();
                jump();
                for (let i = 0; i < 5; i++) step(0.016);
                const vy = player.vy;
                jump();
                return player.vy === vy;
            });
            expect(same).toBe(true);
        });

        test('a jump does not clear a full floor of height', async ({ page }) => {
            const { peak, gap } = await page.evaluate(() => {
                startGame();
                const start = player.y;
                jump();
                let peak = start;
                for (let i = 0; i < 120; i++) { step(0.016); peak = Math.min(peak, player.y); }
                return { peak: start - peak, gap: platforms[0].y - platforms[1].y };
            });
            expect(peak).toBeGreaterThan(20);
            expect(peak).toBeLessThan(gap);
        });
    });

    // -----------------------------------------------------------------------
    // Ladders
    // -----------------------------------------------------------------------
    test.describe('ladders', () => {
        test('the player is on a ladder when standing at its base', async ({ page }) => {
            const found = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x);
                return isOnLadder() !== null;
            });
            expect(found).toBe(true);
        });

        test('the player is not on a ladder elsewhere on the floor', async ({ page }) => {
            const found = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x + 120);
                return isOnLadder() !== null;
            });
            expect(found).toBe(false);
        });

        test('climbing up moves the player upward', async ({ page }) => {
            const { before, after, climbing } = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x);
                const before = player.y;
                climb(1);
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: player.y, climbing: player.climbing };
            });
            expect(after).toBeLessThan(before);
            expect(climbing).toBe(true);
        });

        test('climbing to the top puts the player on the next floor', async ({ page }) => {
            const { y, target, climbing } = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x);
                climb(1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: player.y, target: platforms[1].y, climbing: player.climbing };
            });
            expect(y).toBe(target);
            expect(climbing).toBe(false);
        });

        test('climbing down returns the player to the floor below', async ({ page }) => {
            const { y, target } = await page.evaluate(() => {
                startGame();
                placePlayerOnFloor(1, ladders[0].x);
                climb(-1);
                for (let i = 0; i < 200; i++) step(0.016);
                return { y: player.y, target: platforms[0].y };
            });
            expect(y).toBe(target);
        });

        test('climbing does nothing when the player is not on a ladder', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x + 120);
                const before = player.y;
                climb(1);
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: player.y };
            });
            expect(after).toBe(before);
        });

        test('gravity does not pull the player down mid-ladder', async ({ page }) => {
            const held = await page.evaluate(() => {
                startGame();
                setPlayerX(ladders[0].x);
                climb(1);
                for (let i = 0; i < 20; i++) step(0.016);
                const y = player.y;
                climb(0);
                for (let i = 0; i < 30; i++) step(0.016);
                return player.y === y;
            });
            expect(held).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Barrels
    // -----------------------------------------------------------------------
    test.describe('barrels', () => {
        test('spawnBarrel adds a barrel rolling from the top floor', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                spawnBarrel();
                return { count: barrels.length, floor: barrels[0].floor, dir: barrels[0].dir, top: platforms.length - 1 };
            });
            expect(b.count).toBe(1);
            expect(b.floor).toBe(b.top);
            expect(b.dir).toBe(1);
        });

        test('barrels roll horizontally over time', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                spawnBarrel({ x: 200, floor: 0, dir: 1 });
                const before = barrels[0].x;
                for (let i = 0; i < 20; i++) step(0.016);
                return { before, after: barrels[0].x };
            });
            expect(after).toBeGreaterThan(before);
        });

        test('a barrel that rolls off a platform edge falls', async ({ page }) => {
            const falling = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                const p = platforms[2];
                spawnBarrel({ x: p.x + p.w - 6, floor: 2, dir: 1 });
                for (let i = 0; i < 10; i++) step(0.016);
                return barrels[0].falling;
            });
            expect(falling).toBe(true);
        });

        test('a falling barrel lands on the floor below and reverses direction', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                const p = platforms[2];
                spawnBarrel({ x: p.x + p.w - 6, floor: 2, dir: 1, wantsLadder: false });
                let i = 0;
                while (i++ < 200 && !barrels[0].falling) step(0.016);
                while (i++ < 200 && barrels[0].falling) step(0.016);
                return { floor: barrels[0].floor, dir: barrels[0].dir, falling: barrels[0].falling };
            });
            expect(b.floor).toBe(1);
            expect(b.dir).toBe(-1);
            expect(b.falling).toBe(false);
        });

        test('barrels leaving the bottom floor are removed', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 30, floor: 0, dir: -1 });
                for (let i = 0; i < 60; i++) step(0.016);
                return barrels.length;
            });
            expect(count).toBe(0);
        });

        test('the machine drops barrels automatically as time passes', async ({ page }) => {
            const count = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                for (let i = 0; i < 300; i++) step(0.016);
                return barrels.length;
            });
            expect(count).toBeGreaterThan(0);
        });

        test('barrels roll faster on later levels', async ({ page }) => {
            const { l1, l5 } = await page.evaluate(() => {
                startGame();
                level = 1;
                const l1 = barrelSpeed();
                level = 5;
                const l5 = barrelSpeed();
                return { l1, l5 };
            });
            expect(l5).toBeGreaterThan(l1);
        });

        test('barrels are dropped more often on later levels', async ({ page }) => {
            const { l1, l5 } = await page.evaluate(() => {
                startGame();
                level = 1;
                const l1 = spawnInterval();
                level = 5;
                const l5 = spawnInterval();
                return { l1, l5 };
            });
            expect(l5).toBeLessThan(l1);
        });

        test('a barrel can take a ladder down to the next floor', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                const lad = ladders[2];
                spawnBarrel({ x: lad.x - 12, floor: 3, dir: 1, wantsLadder: true });
                for (let i = 0; i < 200 && barrels[0].floor !== 2; i++) step(0.016);
                return { floor: barrels[0].floor, x: barrels[0].x, ladderX: lad.x };
            });
            expect(b.floor).toBe(2);
            expect(Math.abs(b.x - b.ladderX)).toBeLessThan(4);
        });

        test('the same seed produces the same barrel run', async ({ page }) => {
            const { a, b } = await page.evaluate(() => {
                const run = () => {
                    startGame();
                    setSeed(1234);
                    barrels.length = 0;
                    for (let i = 0; i < 400; i++) step(0.016);
                    return barrels.map((bar) => `${bar.floor}:${Math.round(bar.x)}:${bar.dir}`).join('|');
                };
                return { a: run(), b: run() };
            });
            expect(a).toBe(b);
        });
    });

    // -----------------------------------------------------------------------
    // Collisions
    // -----------------------------------------------------------------------
    test.describe('collisions', () => {
        test('being hit by a barrel costs a life', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 300, floor: 0, dir: 1 });
                step(0.016);
                return window.lives;
            });
            expect(lives).toBe(2);
        });

        test('being hit resets the player to the start and clears the barrels', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 300, floor: 0, dir: 1 });
                spawnBarrel({ x: 120, floor: 3, dir: 1 });
                step(0.016);
                return { x: player.x, y: player.y, startX: PLAYER_START.x, floorY: platforms[0].y, barrels: barrels.length };
            });
            expect(s.x).toBe(s.startX);
            expect(s.y).toBe(s.floorY);
            expect(s.barrels).toBe(0);
        });

        test('a barrel on another floor does not hit the player', async ({ page }) => {
            const lives = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 300, floor: 2, dir: 1 });
                step(0.016);
                return window.lives;
            });
            expect(lives).toBe(3);
        });

        test('losing the last life ends the game', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                lives = 1;
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 300, floor: 0, dir: 1 });
                step(0.016);
                return state;
            });
            expect(s).toBe('over');
        });
    });

    // -----------------------------------------------------------------------
    // Jumping barrels for points
    // -----------------------------------------------------------------------
    test.describe('jumping barrels', () => {
        test('jumping over a barrel scores points', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 260, floor: 0, dir: 1 });
                jump();
                for (let i = 0; i < 40; i++) step(0.016);
                return { score: window.score, points: JUMP_POINTS };
            });
            expect(score.score).toBe(score.points);
        });

        test('a barrel only scores once', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 260, floor: 0, dir: 1 });
                jump();
                for (let i = 0; i < 40; i++) step(0.016);
                const first = window.score;
                // send the same barrel back under the player
                barrels[0].dir = -1;
                barrels[0].x = 340;
                jump();
                for (let i = 0; i < 40; i++) step(0.016);
                return window.score - first;
            });
            expect(score).toBe(0);
        });

        test('standing next to a barrel without jumping scores nothing', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                setPlayerX(300);
                spawnBarrel({ x: 200, floor: 0, dir: 1 });
                for (let i = 0; i < 10; i++) step(0.016);
                return window.score;
            });
            expect(score).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Reaching the goal
    // -----------------------------------------------------------------------
    test.describe('the goal', () => {
        test('reaching the goal advances to the next level', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                placePlayerOnFloor(platforms.length - 1, GOAL.x);
                step(0.016);
                return { level, state };
            });
            expect(s.level).toBe(2);
            expect(s.state).toBe('running');
        });

        test('completing a level banks the remaining bonus', async ({ page }) => {
            const score = await page.evaluate(() => {
                startGame();
                bonus = 3000;
                score = 0;
                placePlayerOnFloor(platforms.length - 1, GOAL.x);
                step(0.016);
                return window.score;
            });
            expect(score).toBe(3000);
        });

        test('completing a level resets the player, barrels and bonus', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                bonus = 1000;
                spawnBarrel({ x: 200, floor: 2, dir: 1 });
                placePlayerOnFloor(platforms.length - 1, GOAL.x);
                step(0.016);
                return { x: player.x, y: player.y, startX: PLAYER_START.x, floorY: platforms[0].y, barrels: barrels.length, bonus, full: BONUS_START };
            });
            expect(s.x).toBe(s.startX);
            expect(s.y).toBe(s.floorY);
            expect(s.barrels).toBe(0);
            expect(s.bonus).toBe(s.full);
        });

        test('standing away from the goal does not complete the level', async ({ page }) => {
            const level = await page.evaluate(() => {
                startGame();
                placePlayerOnFloor(platforms.length - 1, GOAL.x - 200);
                step(0.016);
                return window.level;
            });
            expect(level).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Bonus timer
    // -----------------------------------------------------------------------
    test.describe('bonus timer', () => {
        test('the bonus counts down while playing', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                const before = bonus;
                for (let i = 0; i < 130; i++) step(0.016);
                return { before, after: bonus };
            });
            expect(after).toBeLessThan(before);
        });

        test('the bonus never drops below zero', async ({ page }) => {
            const b = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                bonus = 5;
                for (let i = 0; i < 60; i++) step(0.016);
                return bonus;
            });
            expect(b).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Scoring & best
    // -----------------------------------------------------------------------
    test.describe('scoring', () => {
        test('best score updates on game over when beaten', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 7700;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('7700');
        });

        test('best score persists to localStorage', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 1500;
                updateHud();
                endGame();
            });
            const stored = await page.evaluate(() => window.localStorage.getItem('barrel-climb-best'));
            expect(parseInt(stored, 10)).toBe(1500);
        });

        test('best score is not lowered by a worse run', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('barrel-climb-best', '9000'));
            await page.reload();
            await page.evaluate(() => {
                startGame();
                score = 10;
                updateHud();
                endGame();
            });
            await expect(page.locator('#best')).toHaveText('9000');
        });

        test('game over shows the overlay with Play Again', async ({ page }) => {
            await page.evaluate(() => { startGame(); endGame(); });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#btn-start')).toHaveText('Play Again');
        });
    });

    // -----------------------------------------------------------------------
    // Pause & restart
    // -----------------------------------------------------------------------
    test.describe('pause and restart', () => {
        test('pausing freezes the barrels', async ({ page }) => {
            const { before, after } = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                spawnBarrel({ x: 200, floor: 2, dir: 1 });
                togglePause();
                const before = barrels[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return { before, after: barrels[0].x };
            });
            expect(after).toBe(before);
        });

        test('resuming lets the barrels roll again', async ({ page }) => {
            const moved = await page.evaluate(() => {
                startGame();
                barrels.length = 0;
                spawnBarrel({ x: 200, floor: 2, dir: 1 });
                togglePause();
                togglePause();
                const before = barrels[0].x;
                for (let i = 0; i < 10; i++) step(0.016);
                return barrels[0].x > before;
            });
            expect(moved).toBe(true);
        });

        test('restart after game over resets score, level, lives and barrels', async ({ page }) => {
            const s = await page.evaluate(() => {
                startGame();
                score = 999;
                level = 4;
                lives = 1;
                spawnBarrel({ x: 200, floor: 2, dir: 1 });
                endGame();
                startGame();
                return { score, level, lives, barrels: barrels.length, state };
            });
            expect(s.score).toBe(0);
            expect(s.level).toBe(1);
            expect(s.lives).toBe(3);
            expect(s.barrels).toBe(0);
            expect(s.state).toBe('running');
        });

        test('the HUD reflects score, level and lives', async ({ page }) => {
            await page.evaluate(() => {
                startGame();
                score = 250;
                level = 3;
                lives = 2;
                updateHud();
            });
            await expect(page.locator('#score')).toHaveText('250');
            await expect(page.locator('#level')).toHaveText('3');
            await expect(page.locator('#lives')).toHaveText('2');
        });
    });
});
