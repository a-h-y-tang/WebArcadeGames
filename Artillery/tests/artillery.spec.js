const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A flat height map at a given surface y, full canvas width.
function flat(y, width = 800) {
    return new Array(width).fill(y);
}

test.describe('Artillery Duel', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
    });

    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Artillery Duel', async ({ page }) => {
            await expect(page).toHaveTitle('Artillery Duel');
        });

        test('start overlay is visible', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
        });

        test('overlay prompts to begin', async ({ page }) => {
            await expect(page.locator('#overlay-sub')).toContainText('begin');
        });

        test('canvas is 800×500', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '800');
            await expect(canvas).toHaveAttribute('height', '500');
        });

        test('state starts idle', async ({ page }) => {
            expect(await page.evaluate(() => window.state)).toBe('idle');
        });

        test('HUD shows both scores at 0', async ({ page }) => {
            await expect(page.locator('#score0')).toHaveText('0');
            await expect(page.locator('#score1')).toHaveText('0');
        });

        test('two players exist, positioned on opposite sides', async ({ page }) => {
            const xs = await page.evaluate(() => window.players.map(p => p.x));
            expect(xs.length).toBe(2);
            expect(xs[0]).toBeLessThan(400);
            expect(xs[1]).toBeGreaterThan(400);
        });
    });

    // -----------------------------------------------------------------------
    // Public API is exposed
    // -----------------------------------------------------------------------
    test.describe('API surface', () => {
        test('core functions are exposed on window', async ({ page }) => {
            const types = await page.evaluate(() => ({
                computeTrajectory: typeof window.computeTrajectory,
                generateTerrain: typeof window.generateTerrain,
                startGame: typeof window.startGame,
                fireShot: typeof window.fireShot,
                adjustAngle: typeof window.adjustAngle,
                adjustPower: typeof window.adjustPower,
                loadTerrain: typeof window.loadTerrain,
                setWind: typeof window.setWind,
            }));
            for (const t of Object.values(types)) expect(t).toBe('function');
        });
    });

    // -----------------------------------------------------------------------
    // Pure physics: computeTrajectory
    // -----------------------------------------------------------------------
    test.describe('projectile physics', () => {
        test('is deterministic for identical inputs', async ({ page }) => {
            const [a, b] = await page.evaluate(() => {
                window.players.length = 0; // no tanks in the way
                window.loadTerrain(new Array(800).fill(480));
                const args = { x: 100, y: 200, angleDeg: 45, power: 50, dir: 1, wind: 0.02 };
                const r1 = window.computeTrajectory(args);
                const r2 = window.computeTrajectory(args);
                return [r1.hit, r2.hit];
            });
            expect(a).toEqual(b);
        });

        test('gravity pulls the shell downward over time', async ({ page }) => {
            const rising = await page.evaluate(() => {
                window.players.length = 0;
                window.loadTerrain(new Array(800).fill(495));
                // Perfectly horizontal launch: y must strictly increase (falls).
                const r = window.computeTrajectory({ x: 50, y: 100, angleDeg: 0, power: 50, dir: 1, wind: 0 });
                return r.points.slice(0, 6).map(p => p.y);
            });
            for (let i = 1; i < rising.length; i++) {
                expect(rising[i]).toBeGreaterThan(rising[i - 1]);
            }
        });

        test('more power carries the shell farther', async ({ page }) => {
            const { near, far } = await page.evaluate(() => {
                window.players.length = 0;
                window.loadTerrain(new Array(800).fill(470));
                const base = { x: 60, y: 120, angleDeg: 45, dir: 1, wind: 0 };
                const near = window.computeTrajectory({ ...base, power: 30 }).hit.x;
                const far = window.computeTrajectory({ ...base, power: 65 }).hit.x;
                return { near, far };
            });
            expect(far).toBeGreaterThan(near);
        });

        test('rightward wind pushes the shell farther right', async ({ page }) => {
            const { calm, tail, head } = await page.evaluate(() => {
                window.players.length = 0;
                window.loadTerrain(new Array(800).fill(470));
                const base = { x: 200, y: 100, angleDeg: 60, power: 50, dir: 1 };
                const calm = window.computeTrajectory({ ...base, wind: 0 }).hit.x;
                const tail = window.computeTrajectory({ ...base, wind: 0.06 }).hit.x;
                const head = window.computeTrajectory({ ...base, wind: -0.06 }).hit.x;
                return { calm, tail, head };
            });
            expect(tail).toBeGreaterThan(calm);
            expect(head).toBeLessThan(calm);
        });

        test('a shell that clears the field flies out of bounds', async ({ page }) => {
            const type = await page.evaluate(() => {
                window.players.length = 0;
                window.loadTerrain(new Array(800).fill(499));
                // Fire off the right edge at very high power, shallow angle.
                return window.computeTrajectory({ x: 700, y: 200, angleDeg: 10, power: 100, dir: 1, wind: 0 }).hit.type;
            });
            expect(type).toBe('oob');
        });

        test('landing on the ground reports a terrain hit', async ({ page }) => {
            const hit = await page.evaluate(() => {
                window.players.length = 0;
                window.loadTerrain(new Array(800).fill(450));
                return window.computeTrajectory({ x: 200, y: 250, angleDeg: 75, power: 40, dir: 1, wind: 0 }).hit;
            });
            expect(hit.type).toBe('terrain');
            expect(hit.y).toBeGreaterThanOrEqual(449);
        });

        test('a shell passing through a tank reports a player hit with its index', async ({ page }) => {
            const hit = await page.evaluate(() => {
                window.loadTerrain(new Array(800).fill(450));
                const p = window.players;
                p.length = 0;
                p.push({ x: 100, y: 450, angle: 5, power: 40, dir: 1, score: 0 });
                p.push({ x: 250, y: 450, angle: 45, power: 55, dir: -1, score: 0 });
                // Low, flat shot from player 0's muzzle straight into player 1.
                return window.computeTrajectory({ x: 121.9, y: 436, angleDeg: 5, power: 40, dir: 1, wind: 0 }).hit;
            });
            expect(hit.type).toBe('player');
            expect(hit.playerIndex).toBe(1);
        });
    });

    // -----------------------------------------------------------------------
    // Terrain generation
    // -----------------------------------------------------------------------
    test.describe('terrain generation', () => {
        test('same seed yields identical terrain', async ({ page }) => {
            const same = await page.evaluate(() => {
                const a = window.generateTerrain(777);
                const b = window.generateTerrain(777);
                return a.every((v, i) => v === b[i]) && a.length === b.length;
            });
            expect(same).toBe(true);
        });

        test('different seeds yield different terrain', async ({ page }) => {
            const differ = await page.evaluate(() => {
                const a = window.generateTerrain(1);
                const b = window.generateTerrain(2);
                return a.some((v, i) => v !== b[i]);
            });
            expect(differ).toBe(true);
        });

        test('terrain heights stay within the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => {
                const a = window.generateTerrain(42);
                return a.length === window.W && a.every(v => v >= 0 && v <= window.H);
            });
            expect(ok).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Game flow
    // -----------------------------------------------------------------------
    test.describe('starting the game', () => {
        test('Start button dismisses the overlay and enters aiming', async ({ page }) => {
            await page.locator('#btn-start').click();
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
            expect(await page.evaluate(() => window.state)).toBe('aiming');
        });

        test('Space starts the duel from idle', async ({ page }) => {
            await page.keyboard.press(' ');
            expect(await page.evaluate(() => window.state)).toBe('aiming');
        });

        test('player 0 (Blue) shoots first', async ({ page }) => {
            await page.evaluate(() => window.startGame(999));
            expect(await page.evaluate(() => window.currentPlayer)).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // Aiming controls
    // -----------------------------------------------------------------------
    test.describe('aiming', () => {
        test('ArrowRight increases the active angle, ArrowLeft decreases it', async ({ page }) => {
            await page.evaluate(() => window.startGame(1));
            const before = await page.evaluate(() => window.players[window.currentPlayer].angle);
            await page.keyboard.press('ArrowRight');
            const afterUp = await page.evaluate(() => window.players[window.currentPlayer].angle);
            expect(afterUp).toBe(before + 1);
            await page.keyboard.press('ArrowLeft');
            await page.keyboard.press('ArrowLeft');
            const afterDown = await page.evaluate(() => window.players[window.currentPlayer].angle);
            expect(afterDown).toBe(before - 1);
        });

        test('ArrowUp increases power, ArrowDown decreases it', async ({ page }) => {
            await page.evaluate(() => window.startGame(1));
            const before = await page.evaluate(() => window.players[window.currentPlayer].power);
            await page.keyboard.press('ArrowUp');
            expect(await page.evaluate(() => window.players[window.currentPlayer].power)).toBe(before + 1);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            expect(await page.evaluate(() => window.players[window.currentPlayer].power)).toBe(before - 1);
        });

        test('angle is clamped to its maximum', async ({ page }) => {
            await page.evaluate(() => { window.startGame(1); window.adjustAngle(1000); });
            const angle = await page.evaluate(() => window.players[window.currentPlayer].angle);
            expect(angle).toBe(await page.evaluate(() => window.ANGLE_MAX));
        });

        test('power is clamped to its minimum', async ({ page }) => {
            await page.evaluate(() => { window.startGame(1); window.adjustPower(-1000); });
            const power = await page.evaluate(() => window.players[window.currentPlayer].power);
            expect(power).toBe(await page.evaluate(() => window.POWER_MIN));
        });

        test('aiming inputs are ignored before the game starts', async ({ page }) => {
            const before = await page.evaluate(() => window.players[0].angle);
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => window.players[0].angle)).toBe(before);
        });
    });

    // -----------------------------------------------------------------------
    // Firing & resolution
    // -----------------------------------------------------------------------
    test.describe('firing', () => {
        test('a missed shot passes the turn and carves a crater', async ({ page }) => {
            const result = await page.evaluate(async () => {
                window.startGame(3);
                window.loadTerrain(new Array(800).fill(450));
                const p = window.players;
                p[0].y = 450; p[1].y = 450;
                p[0].angle = 45; p[0].power = 15;
                window.setWind(0);
                await window.fireShot();
                const region = window.terrain.slice(90, 200);
                return { current: window.currentPlayer, state: window.state, maxDepth: Math.max(...region) };
            });
            expect(result.current).toBe(1);        // turn passed to Red
            expect(result.state).toBe('aiming');
            expect(result.maxDepth).toBeGreaterThan(450); // crater lowered the surface
        });

        test('a direct hit on the opponent scores and ends the round', async ({ page }) => {
            const result = await page.evaluate(async () => {
                window.startGame(5);
                window.loadTerrain(new Array(800).fill(450));
                const p = window.players;
                p.length = 0;
                p.push({ x: 100, y: 450, angle: 5, power: 40, dir: 1, score: 0 });
                p.push({ x: 250, y: 450, angle: 45, power: 55, dir: -1, score: 0 });
                window.setWind(0);
                const hit = await window.fireShot();
                return { hitType: hit.type, hitIndex: hit.playerIndex, score0: window.players[0].score, state: window.state };
            });
            expect(result.hitType).toBe('player');
            expect(result.hitIndex).toBe(1);
            expect(result.score0).toBe(1);
            expect(result.state).toBe('over');
        });

        test('the win overlay appears after a direct hit', async ({ page }) => {
            await page.evaluate(async () => {
                window.startGame(5);
                window.loadTerrain(new Array(800).fill(450));
                const p = window.players;
                p.length = 0;
                p.push({ x: 100, y: 450, angle: 5, power: 40, dir: 1, score: 0 });
                p.push({ x: 250, y: 450, angle: 45, power: 55, dir: -1, score: 0 });
                window.setWind(0);
                await window.fireShot();
            });
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText('hit');
            await expect(page.locator('#score0')).toHaveText('1');
        });

        test('firing is rejected unless the game is aiming', async ({ page }) => {
            const r = await page.evaluate(() => window.fireShot()); // still idle
            expect(r).toBe(null);
        });
    });

    // -----------------------------------------------------------------------
    // New game
    // -----------------------------------------------------------------------
    test.describe('new game', () => {
        test('pressing N from idle starts a fresh duel', async ({ page }) => {
            await page.keyboard.press('n');
            expect(await page.evaluate(() => window.state)).toBe('aiming');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('starting a new game resets both scores to 0', async ({ page }) => {
            await page.evaluate(() => {
                window.startGame(1);
                window.players[0].score = 3;
                window.players[1].score = 2;
                window.startGame(1);
            });
            const scores = await page.evaluate(() => window.players.map(p => p.score));
            expect(scores).toEqual([0, 0]);
        });
    });
});
