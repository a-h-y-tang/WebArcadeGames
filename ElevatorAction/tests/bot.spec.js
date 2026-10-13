const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(
    path.resolve(__dirname, '../index.html')
).href;

// End-to-end playability proof. The unit suite in elevator-action.spec.js
// checks the rules one at a time; this file asks the harder question — can a
// building actually be finished? An autopilot plans a route over the
// (floor, segment) graph and then plays it through the real key handling:
// walk, wait for a car, board, drive, step off, repeat. If a shaft layout ever
// strands a document, or stepping on and off a car ever goes wrong, the run
// cannot reach `levelclear` and these tests fail.
const BOT = (wantedLevel) => {
    const log = [];
    let budget = 200000;

    const tick = () => {
        physicsStep(1 / 120);
        budget--;
    };
    const press = (code, on) => {
        keys[code] = on;
    };
    const release = () => {
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].forEach((k) => press(k, false));
    };
    const segsOf = (f) => floorSegments(f, shafts);
    const regionOf = (f, x) => `${f}:${segmentIndexAt(segsOf(f), x)}`;

    // Shortest route of hops { shaft, toFloor } to the region holding (tf, tx).
    function route(fromFloor, fromX, tf, tx) {
        const goal = regionOf(tf, tx);
        const start = regionOf(fromFloor, fromX);
        if (start === goal) return [];
        const prev = new Map([[start, null]]);
        const queue = [[fromFloor, segmentIndexAt(segsOf(fromFloor), fromX)]];
        while (queue.length) {
            const [f, si] = queue.shift();
            const [a, b] = segsOf(f)[si];
            for (let i = 0; i < shafts.length; i++) {
                const s = shafts[i];
                if (f < s.lo || f > s.hi || s.x < a || s.x > b) continue;
                for (let f2 = s.lo; f2 <= s.hi; f2++) {
                    const key = regionOf(f2, s.x);
                    if (prev.has(key)) continue;
                    prev.set(key, { from: `${f}:${si}`, shaft: i, toFloor: f2 });
                    if (key === goal) {
                        const hops = [];
                        let at = key;
                        while (prev.get(at)) {
                            const h = prev.get(at);
                            hops.unshift({ shaft: h.shaft, toFloor: h.toFloor });
                            at = h.from;
                        }
                        return hops;
                    }
                    queue.push([f2, segmentIndexAt(segsOf(f2), s.x)]);
                }
            }
        }
        return null;
    }

    // Walk to x, waiting out any serving shaft whose car has not arrived yet.
    function walkTo(x, stopOnCar) {
        let stalled = 0;
        for (let i = 0; i < 4000 && budget > 0; i++) {
            if (state !== 'running') {
                release();
                return true; // the building ended under our feet — that is a win
            }
            const dx = x - player.x;
            if (Math.abs(dx) < 2) {
                release();
                return true;
            }
            if (stopOnCar !== undefined && player.onCar === stopOnCar) {
                release();
                return true;
            }
            const before = player.x;
            press('ArrowRight', dx > 0);
            press('ArrowLeft', dx < 0);
            tick();
            if (Math.abs(player.x - before) < 1e-6) {
                stalled++;
                if (stalled > 30) {
                    release();
                    for (let w = 0; w < 240 && budget > 0; w++) tick(); // let a car arrive
                    stalled = 0;
                }
            } else {
                stalled = 0;
            }
        }
        release();
        return false;
    }

    function ride(shaftIndex, toFloor) {
        const target = floorSurfaceY(toFloor);
        for (let i = 0; i < 4000 && budget > 0; i++) {
            const d = target - shafts[shaftIndex].y;
            if (Math.abs(d) < 1) break;
            press('ArrowDown', d > 0);
            press('ArrowUp', d < 0);
            tick();
        }
        release();
        return Math.abs(shafts[shaftIndex].y - target) < 6;
    }

    function goTo(tf, tx) {
        for (let guard = 0; guard < 40 && budget > 0; guard++) {
            const here = player.onCar >= 0 ? carFloor(shafts[player.onCar]) : floorAt(player.y);
            if (here === tf && regionOf(here, player.x) === regionOf(tf, tx)) {
                return walkTo(tx);
            }
            const hops = route(here, player.x, tf, tx);
            if (!hops) {
                log.push(`no route from ${here}:${Math.round(player.x)} to ${tf}:${tx}`);
                return false;
            }
            if (hops.length === 0) return walkTo(tx);
            const hop = hops[0];
            const s = shafts[hop.shaft];
            if (!walkTo(s.x + s.w / 2, hop.shaft)) return false;
            if (player.onCar !== hop.shaft) {
                log.push(`failed to board shaft ${hop.shaft} on floor ${here}`);
                return false;
            }
            if (!ride(hop.shaft, hop.toFloor)) return false;
            // step out of the car toward wherever we are heading next
            const after = route(hop.toFloor, s.x + s.w / 2, tf, tx);
            const nextX = after && after.length ? shafts[after[0].shaft].x + 28 : tx;
            const dir = nextX >= player.x ? 1 : -1;
            for (let i = 0; i < 600 && player.onCar >= 0 && budget > 0; i++) {
                press(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
                tick();
            }
            release();
        }
        return false;
    }

    startGame();
    autoRun = false;
    spawnEnabled = false; // the route, not the gunfight, is what we are proving
    level = wantedLevel;
    startLevel();

    const targets = doors
        .filter((d) => d.red)
        .map((d) => ({ floor: d.floor, x: d.x }))
        .sort((a, b) => b.floor - a.floor);

    for (const t of targets) {
        const ok = goTo(t.floor, t.x);
        log.push(`doc floor ${t.floor} x${t.x}: ${ok ? 'taken' : 'FAILED'} (docs left ${docsRemaining()})`);
        if (!ok) break;
    }
    let escaped = false;
    if (docsRemaining() === 0) {
        escaped = goTo(0, exitZone.x + exitZone.w / 2) && state === 'levelclear';
        log.push(`escape: ${escaped ? 'reached' : 'FAILED'} state=${state}`);
    }
    return { log, state, score, docsLeft: docsRemaining(), budget, escaped };
};

test.describe('playability', () => {
    for (const n of [1, 2, 3, 4]) {
        test(`an autopilot can clear building ${n}`, async ({ page }) => {
            test.setTimeout(60000);
            await page.goto(GAME_URL);
            const res = await page.evaluate(BOT, n);
            const report = `${res.log.join('\n')}\nstate=${res.state} score=${res.score}`;
            expect(res.docsLeft, report).toBe(0);
            expect(res.state, report).toBe('levelclear');
            expect(res.escaped, report).toBe(true);
        });
    }
});
