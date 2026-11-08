const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const REPO_ROOT = path.resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Helpers
//
// The simulation runs on a fixed 1/60 s step, so a test can switch off the
// animation loop, empty the sea, drop in exactly the fish or snag it cares
// about and then advance the world one tick at a time.
// ---------------------------------------------------------------------------

// Start the game and freeze the render loop.
async function sandbox(page, level = 1) {
    await page.evaluate((n) => {
        startGame();
        autoRun = false;
        loadLevel(n);
        state = 'running';
        fish.length = 0;
        snags.length = 0;
    }, level);
}

const step = (page, ticks = 1) =>
    page.evaluate((n) => { for (let i = 0; i < n; i++) simStep(); }, ticks);

// Drop one fish into the water at an exact spot, swimming at an exact speed.
const placeFish = (page, spec) =>
    page.evaluate((s) => {
        fish.push(makeFish(s.kind || 'sardine', s.x, s.y, s.dir === undefined ? 1 : s.dir, s.speed || 0));
        return fish.length;
    }, spec);

const placeSnag = (page, spec) =>
    page.evaluate((s) => {
        snags.push(makeSnag(s.x, s.y, s.dir === undefined ? 1 : s.dir, s.speed || 0));
        return snags.length;
    }, spec);

// Put the net exactly where the test wants it.
const putNet = (page, spec) =>
    page.evaluate((s) => {
        net.mode = s.mode;
        net.x = s.x;
        net.y = s.y;
        net.tearCd = 0;
        net.fish = (s.load || []).map((kind) => makeCatch(kind));
        return { x: net.x, y: net.y, mode: net.mode, load: net.fish.length };
    }, spec);

const snapshot = (page) =>
    page.evaluate(() => ({
        state,
        score,
        landed,
        level,
        timeLeft,
        quota: LEVELS[level - 1].quota,
        capacity: LEVELS[level - 1].capacity,
        net: { x: net.x, y: net.y, w: net.w, h: net.h, mode: net.mode, load: net.fish.length },
        boat: { x: boat.x, y: boat.y, w: boat.w, h: boat.h },
        fish: fish.length,
        snags: snags.length,
        tears: tears,
        world: { W, H, WATER_TOP, SEA_FLOOR },
    }));

test.beforeEach(async ({ page }) => {
    await page.goto(GAME_URL);
    await page.waitForFunction(() => typeof simStep === 'function');
});

// ---------------------------------------------------------------------------
// Page scaffolding
// ---------------------------------------------------------------------------
test.describe('page', () => {
    test('has the game title and a canvas of the documented size', async ({ page }) => {
        await expect(page).toHaveTitle(/Fishers of Men/i);
        const canvas = page.locator('#canvas');
        await expect(canvas).toHaveAttribute('width', '640');
        await expect(canvas).toHaveAttribute('height', '520');
    });

    test('shows every HUD readout', async ({ page }) => {
        for (const id of ['#level', '#catch', '#score', '#time', '#best', '#level-name']) {
            await expect(page.locator(id)).toBeVisible();
        }
    });

    test('opens on the title screen with the Matthew 4:19 verse', async ({ page }) => {
        expect(await page.evaluate(() => state)).toBe('title');
        await expect(page.locator('#overlay')).toBeVisible();
        await expect(page.locator('#overlay-title')).toHaveText(/FISHERS OF MEN/i);
        await expect(page.locator('.verse')).toContainText(/Matthew 4:19/);
    });

    test('Space leaves the title screen and starts the level', async ({ page }) => {
        await page.keyboard.press('Space');
        expect(await page.evaluate(() => state)).toBe('running');
        await expect(page.locator('#overlay')).toBeHidden();
    });

    test('the Start button starts the game too', async ({ page }) => {
        await page.locator('#btn-start').click();
        expect(await page.evaluate(() => state)).toBe('running');
    });
});

// ---------------------------------------------------------------------------
// The boat
// ---------------------------------------------------------------------------
test.describe('the boat', () => {
    test('sails right and left with the arrow keys', async ({ page }) => {
        await sandbox(page);
        const start = (await snapshot(page)).boat.x;

        await page.keyboard.down('ArrowRight');
        await step(page, 30);
        await page.keyboard.up('ArrowRight');
        const right = (await snapshot(page)).boat.x;
        expect(right).toBeGreaterThan(start);

        await page.keyboard.down('ArrowLeft');
        await step(page, 30);
        await page.keyboard.up('ArrowLeft');
        expect((await snapshot(page)).boat.x).toBeLessThan(right);
    });

    test('never sails off either edge of the sea', async ({ page }) => {
        await sandbox(page);
        await page.keyboard.down('ArrowLeft');
        await step(page, 600);
        await page.keyboard.up('ArrowLeft');
        expect((await snapshot(page)).boat.x).toBe(0);

        await page.keyboard.down('ArrowRight');
        await step(page, 600);
        await page.keyboard.up('ArrowRight');
        const after = await snapshot(page);
        expect(after.boat.x).toBe(after.world.W - after.boat.w);
    });

    test('stays put while the net is in the water', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => castNet());
        const before = (await snapshot(page)).boat.x;
        await page.keyboard.down('ArrowRight');
        await step(page, 30);
        await page.keyboard.up('ArrowRight');
        expect((await snapshot(page)).boat.x).toBe(before);
    });
});

// ---------------------------------------------------------------------------
// Casting and steering the net
// ---------------------------------------------------------------------------
test.describe('the net', () => {
    test('starts stowed and casts from the middle of the boat', async ({ page }) => {
        await sandbox(page);
        expect((await snapshot(page)).net.mode).toBe('stowed');
        await page.keyboard.press('Space');
        const s = await snapshot(page);
        expect(s.net.mode).toBe('down');
        expect(s.net.x + s.net.w / 2).toBeCloseTo(s.boat.x + s.boat.w / 2, 5);
        expect(s.net.y).toBe(await page.evaluate(() => WATER_TOP));
    });

    test('sinks while it is down', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => castNet());
        const y0 = (await snapshot(page)).net.y;
        await step(page, 30);
        expect((await snapshot(page)).net.y).toBeGreaterThan(y0);
    });

    test('cannot be cast twice before it comes home', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => castNet());
        await step(page, 30);
        const mid = (await snapshot(page)).net.y;
        await page.evaluate(() => castNet());
        expect((await snapshot(page)).net.y).toBe(mid);
    });

    test('steers sideways with the arrow keys and stays in the water', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => { castNet(); net.x = 300; });

        await page.keyboard.down('ArrowLeft');
        await step(page, 20);
        await page.keyboard.up('ArrowLeft');
        expect((await snapshot(page)).net.x).toBeLessThan(300);

        // Steer into each wall from just beside it; 30 ticks of steering covers
        // far more ground than the gap, and the net is still well clear of the
        // sea floor so it keeps sinking rather than turning for home.
        await page.evaluate(() => { net.x = 10; });
        await page.keyboard.down('ArrowLeft');
        await step(page, 30);
        await page.keyboard.up('ArrowLeft');
        expect((await snapshot(page)).net.x).toBe(0);

        await page.evaluate(() => { net.x = W - net.w - 10; });
        await page.keyboard.down('ArrowRight');
        await step(page, 30);
        await page.keyboard.up('ArrowRight');
        const s = await snapshot(page);
        expect(s.net.mode).toBe('down');
        expect(s.net.x).toBe(s.world.W - s.net.w);
    });

    test('Space hauls a sinking net back up', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => castNet());
        await step(page, 60);
        const deep = (await snapshot(page)).net.y;
        await page.keyboard.press('Space');
        expect((await snapshot(page)).net.mode).toBe('up');
        await step(page, 20);
        expect((await snapshot(page)).net.y).toBeLessThan(deep);
    });

    test('hauls itself up when it touches the sea floor', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => { castNet(); net.y = SEA_FLOOR - net.h - 1; });
        await step(page, 2);
        expect((await snapshot(page)).net.mode).toBe('up');
    });

    test('a loaded net is slower to haul than an empty one', async ({ page }) => {
        const speeds = await page.evaluate(() => {
            startGame();
            autoRun = false;
            net.fish = [];
            const empty = haulSpeed();
            net.fish = [makeCatch('tilapia'), makeCatch('tilapia'), makeCatch('tilapia')];
            const loaded = haulSpeed();
            net.fish = [];
            return { empty, loaded };
        });
        expect(speeds.loaded).toBeLessThan(speeds.empty);
        expect(speeds.loaded).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Catching fish
// ---------------------------------------------------------------------------
test.describe('catching fish', () => {
    test('a fish the net reaches is scooped out of the water', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'down', x: 200, y: 200 });
        await placeFish(page, { kind: 'sardine', x: 210, y: 210, speed: 0 });
        await step(page, 1);
        const s = await snapshot(page);
        expect(s.net.load).toBe(1);
        expect(s.fish).toBe(0);
    });

    test('a fish swimming well clear of the net is left alone', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'down', x: 200, y: 200 });
        await placeFish(page, { kind: 'sardine', x: 500, y: 450, speed: 0 });
        await step(page, 1);
        const s = await snapshot(page);
        expect(s.net.load).toBe(0);
        expect(s.fish).toBe(1);
    });

    test('a stowed net catches nothing', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'stowed', x: 200, y: 200 });
        await placeFish(page, { kind: 'bream', x: 210, y: 210, speed: 0 });
        await step(page, 1);
        expect((await snapshot(page)).net.load).toBe(0);
    });

    test('the net holds no more than the level capacity and then hauls itself up', async ({ page }) => {
        await sandbox(page);
        const capacity = (await snapshot(page)).capacity;
        await putNet(page, { mode: 'down', x: 200, y: 200 });
        for (let i = 0; i < capacity + 3; i++) {
            await placeFish(page, { kind: 'sardine', x: 205 + i, y: 205, speed: 0 });
        }
        await step(page, 1);
        const s = await snapshot(page);
        expect(s.net.load).toBe(capacity);
        expect(s.net.mode).toBe('up');
        expect(s.fish).toBe(3);
    });

    test('fish only count once the net is back at the boat', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'up', x: 200, y: 200 });
        await placeFish(page, { kind: 'tilapia', x: 210, y: 210, speed: 0 });
        await step(page, 1);
        let s = await snapshot(page);
        expect(s.net.load).toBe(1);
        expect(s.landed).toBe(0);
        expect(s.score).toBe(0);

        await step(page, 600);
        s = await snapshot(page);
        expect(s.net.mode).toBe('stowed');
        expect(s.landed).toBe(1);
        expect(s.score).toBe(await page.evaluate(() => FISH_POINTS('tilapia')));
    });

    test('a full haul pays a bonus over landing the same fish one at a time', async ({ page }) => {
        const single = await page.evaluate(() => {
            startGame();
            autoRun = false;
            loadLevel(1);
            state = 'running';
            fish.length = 0;
            snags.length = 0;
            net.mode = 'up';
            net.y = WATER_TOP + 10;
            net.fish = [makeCatch('sardine')];
            landCatch();
            return score;
        });
        const triple = await page.evaluate(() => {
            loadLevel(1);
            state = 'running';
            net.mode = 'up';
            net.y = WATER_TOP + 10;
            net.fish = [makeCatch('sardine'), makeCatch('sardine'), makeCatch('sardine')];
            landCatch();
            return score;
        });
        expect(triple).toBeGreaterThan(single * 3);
    });

    test('bigger fish are worth more', async ({ page }) => {
        const points = await page.evaluate(() => [
            FISH_POINTS('sardine'),
            FISH_POINTS('bream'),
            FISH_POINTS('tilapia'),
        ]);
        expect(points[0]).toBeLessThan(points[1]);
        expect(points[1]).toBeLessThan(points[2]);
    });
});

// ---------------------------------------------------------------------------
// Snags
// ---------------------------------------------------------------------------
test.describe('snags', () => {
    test('a snag tears the net and one fish escapes back into the sea', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'up', x: 200, y: 300, load: ['bream', 'bream'] });
        await placeSnag(page, { x: 205, y: 305, speed: 0 });
        await step(page, 1);
        const s = await snapshot(page);
        expect(s.net.load).toBe(1);
        expect(s.fish).toBe(1);
        expect(s.tears).toBe(1);
    });

    test('a fish that escapes darts clear instead of falling straight back in', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'up', x: 200, y: 300, load: ['bream', 'bream'] });
        await placeSnag(page, { x: 205, y: 305, speed: 0 });
        await step(page, 2);
        const immune = await page.evaluate(() => fish.map((f) => f.immune));
        expect(immune.length).toBe(1);
        expect(immune[0]).toBeGreaterThan(0);
        expect((await snapshot(page)).net.load).toBe(1);
    });

    test('one snag cannot empty the net in a single pass', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'up', x: 200, y: 300, load: ['bream', 'bream', 'bream'] });
        await placeSnag(page, { x: 205, y: 305, speed: 0 });
        await step(page, 10);
        expect((await snapshot(page)).net.load).toBe(2);
    });

    test('an empty net can pass a snag unharmed', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'down', x: 200, y: 300 });
        await placeSnag(page, { x: 205, y: 305, speed: 0 });
        await step(page, 5);
        const s = await snapshot(page);
        expect(s.net.load).toBe(0);
        expect(s.net.mode).toBe('down');
    });

    test('escaped fish are not scored', async ({ page }) => {
        await sandbox(page);
        await putNet(page, { mode: 'up', x: 200, y: 300, load: ['tilapia', 'tilapia'] });
        await placeSnag(page, { x: 205, y: 305, speed: 0 });
        await step(page, 1);
        await page.evaluate(() => { snags.length = 0; fish.length = 0; });
        await step(page, 600);
        const s = await snapshot(page);
        expect(s.landed).toBe(1);
        expect(s.score).toBe(await page.evaluate(() => FISH_POINTS('tilapia')));
    });
});

// ---------------------------------------------------------------------------
// Levels, timer and game state
// ---------------------------------------------------------------------------
test.describe('levels and state', () => {
    test('every level has a name, a quota, a time limit and a net capacity', async ({ page }) => {
        const levels = await page.evaluate(() => LEVELS);
        expect(levels.length).toBeGreaterThanOrEqual(5);
        for (const l of levels) {
            expect(l.name.length).toBeGreaterThan(3);
            expect(l.quota).toBeGreaterThan(0);
            expect(l.seconds).toBeGreaterThan(10);
            expect(l.capacity).toBeGreaterThan(1);
        }
        for (let i = 1; i < levels.length; i++) {
            expect(levels[i].quota).toBeGreaterThanOrEqual(levels[i - 1].quota);
        }
    });

    test('filling the quota clears the level and Space moves on', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            landed = LEVELS[0].quota - 1;
            net.mode = 'up';
            net.y = WATER_TOP + 10;
            net.fish = [makeCatch('sardine')];
            landCatch();
        });
        let s = await snapshot(page);
        expect(s.state).toBe('cleared');
        await expect(page.locator('#overlay')).toBeVisible();
        await expect(page.locator('#overlay-title')).toHaveText(/NET FULL|LEVEL/i);

        await page.keyboard.press('Space');
        s = await snapshot(page);
        expect(s.level).toBe(2);
        expect(s.state).toBe('running');
        expect(s.landed).toBe(0);
    });

    test('clearing the last level wins the game', async ({ page }) => {
        await page.evaluate(() => {
            startGame();
            autoRun = false;
            loadLevel(LEVELS.length);
            state = 'running';
            landed = LEVELS[LEVELS.length - 1].quota;
            net.mode = 'up';
            net.y = WATER_TOP + 10;
            net.fish = [makeCatch('sardine')];
            landCatch();
        });
        expect((await snapshot(page)).state).toBe('won');
        await expect(page.locator('#overlay-title')).toHaveText(/WELL DONE|FISHERS/i);
    });

    test('the clock runs down while the level is running and ends the game at zero', async ({ page }) => {
        await sandbox(page);
        const full = (await snapshot(page)).timeLeft;
        await step(page, 60);
        const after = (await snapshot(page)).timeLeft;
        expect(after).toBeLessThan(full);
        expect(after).toBeCloseTo(full - 1, 1);

        await page.evaluate(() => { timeLeft = 0.01; });
        await step(page, 5);
        expect((await snapshot(page)).state).toBe('gameover');
        await expect(page.locator('#overlay-title')).toHaveText(/TIME/i);
    });

    test('the clock stops when the game is over', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => { timeLeft = 0.01; });
        await step(page, 5);
        const frozen = (await snapshot(page)).timeLeft;
        await step(page, 60);
        expect((await snapshot(page)).timeLeft).toBe(frozen);
    });

    test('P pauses and unpauses', async ({ page }) => {
        await sandbox(page);
        await page.keyboard.press('KeyP');
        expect((await snapshot(page)).state).toBe('paused');
        const held = (await snapshot(page)).timeLeft;
        await step(page, 60);
        expect((await snapshot(page)).timeLeft).toBe(held);
        await page.keyboard.press('KeyP');
        expect((await snapshot(page)).state).toBe('running');
    });

    test('R restarts the level with a fresh clock, an empty net and no catch', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            net.mode = 'down';
            net.fish = [makeCatch('bream')];
            landed = 3;
            timeLeft = 5;
        });
        await page.keyboard.press('KeyR');
        const s = await snapshot(page);
        expect(s.landed).toBe(0);
        expect(s.net.load).toBe(0);
        expect(s.net.mode).toBe('stowed');
        expect(s.timeLeft).toBe(await page.evaluate(() => LEVELS[level - 1].seconds));
        expect(s.score).toBe(0);
    });

    test('the HUD reports the level, catch, score and clock', async ({ page }) => {
        await sandbox(page, 2);
        await page.evaluate(() => {
            net.mode = 'up';
            net.y = WATER_TOP + 10;
            net.fish = [makeCatch('bream'), makeCatch('bream')];
            landCatch();
            draw();
        });
        await expect(page.locator('#level')).toHaveText('2');
        await expect(page.locator('#catch')).toHaveText(`2 / ${(await snapshot(page)).quota}`);
        await expect(page.locator('#score')).toHaveText(String((await snapshot(page)).score));
        await expect(page.locator('#time')).not.toHaveText('');
    });

    test('the best score is remembered across a reload', async ({ page }) => {
        await sandbox(page);
        await page.evaluate(() => {
            score = 1234;
            timeLeft = 0.01;
            simStep();
        });
        expect(await page.evaluate(() => window.localStorage.getItem(BEST_KEY))).toBe('1234');
        await page.reload();
        await page.waitForFunction(() => typeof simStep === 'function');
        expect(await page.evaluate(() => best)).toBe(1234);
        await expect(page.locator('#best')).toHaveText('1234');
    });
});

// ---------------------------------------------------------------------------
// The sea
// ---------------------------------------------------------------------------
test.describe('the sea', () => {
    test('a level stocks the sea with fish and snags', async ({ page }) => {
        await page.evaluate(() => { startGame(); autoRun = false; loadLevel(1); });
        const s = await snapshot(page);
        expect(s.fish).toBeGreaterThan(5);
        expect(s.snags).toBeGreaterThan(0);
    });

    test('every fish and snag swims below the waterline and above the sea floor', async ({ page }) => {
        await page.evaluate(() => { startGame(); autoRun = false; loadLevel(3); state = 'running'; });
        await step(page, 240);
        const bad = await page.evaluate(() =>
            [...fish, ...snags].filter((f) => f.y < WATER_TOP || f.y + f.h > SEA_FLOOR).length);
        expect(bad).toBe(0);
    });

    test('fish swim and are recycled at the far edge rather than vanishing', async ({ page }) => {
        await page.evaluate(() => { startGame(); autoRun = false; loadLevel(2); state = 'running'; });
        const before = await page.evaluate(() => ({ n: fish.length, xs: fish.map((f) => f.x) }));
        await step(page, 30);
        const after = await page.evaluate(() => ({ n: fish.length, xs: fish.map((f) => f.x) }));
        expect(after.n).toBe(before.n);
        expect(after.xs).not.toEqual(before.xs);

        await step(page, 1800);
        expect(await page.evaluate(() => fish.length)).toBe(before.n);
        const offscreen = await page.evaluate(() =>
            fish.filter((f) => f.x + f.w < -80 || f.x > W + 80).length);
        expect(offscreen).toBe(0);
    });

    test('the same level always lays out the same sea', async ({ page }) => {
        const a = await page.evaluate(() => { startGame(); loadLevel(4); return JSON.stringify(fish); });
        const b = await page.evaluate(() => { loadLevel(4); return JSON.stringify(fish); });
        expect(a).toBe(b);
    });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
test.describe('rendering', () => {
    test('the canvas is painted', async ({ page }) => {
        const painted = await page.evaluate(() => {
            const ctx = document.getElementById('canvas').getContext('2d');
            const { data } = ctx.getImageData(0, 0, W, H);
            for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1] || data[i + 2]) return true;
            return false;
        });
        expect(painted).toBe(true);
    });

    test('draw() can be called in any state without throwing', async ({ page }) => {
        const ok = await page.evaluate(() => {
            for (const s of ['title', 'running', 'paused', 'cleared', 'gameover', 'won']) {
                state = s;
                draw();
            }
            return true;
        });
        expect(ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Repository wiring
// ---------------------------------------------------------------------------
test.describe('repository', () => {
    const catalog = () =>
        JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'game-browser/src/assets/games.json'), 'utf8'));

    test('the game browser catalogues the game', () => {
        const entry = catalog().find((g) => g.id === 'fishers-of-men');
        expect(entry).toBeTruthy();
        expect(entry.name).toBe('Fishers of Men');
        expect(entry.dir).toBe('FishersOfMen');
        expect(entry.path).toBe('games/FishersOfMen/index.html');
        expect(entry.thumbnail).toBe('games/FishersOfMen/screenshot.png');
        expect(entry.category).toBe('Action');
        expect(entry.description.length).toBeGreaterThan(10);
    });

    test('the games.json entry sits alphabetically among its neighbours', () => {
        const games = catalog();
        const i = games.findIndex((g) => g.id === 'fishers-of-men');
        expect(i).toBeGreaterThan(0);
        expect(games[i - 1].name.localeCompare(games[i].name)).toBeLessThanOrEqual(0);
        expect(games[i].name.localeCompare(games[i + 1].name)).toBeLessThanOrEqual(0);
    });

    test('the thumbnail the browser points at exists', () => {
        expect(fs.existsSync(path.join(REPO_ROOT, 'FishersOfMen/screenshot.png'))).toBe(true);
    });

    test('the root README lists the game', () => {
        const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
        expect(readme).toMatch(/\|\s*Fishers of Men\s*\|\s*\[FishersOfMen\/\]\(FishersOfMen\/\)\s*\|\s*(Complete|In Progress)\s*\|/);
    });

    test('the game ships its own README and DESIGN docs', () => {
        expect(fs.existsSync(path.join(REPO_ROOT, 'FishersOfMen/README.md'))).toBe(true);
        expect(fs.existsSync(path.join(REPO_ROOT, 'FishersOfMen/DESIGN.md'))).toBe(true);
    });
});
