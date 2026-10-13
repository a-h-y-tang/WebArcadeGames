// Elevator Action — raid a ministry: take every document, ride down, escape.
//
// The whole simulation runs through physicsStep() on a fixed timestep, and the
// interesting state (state, score, player, shafts, doors, enemies, bullets) is
// kept in top-level bindings on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules and the constants.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;                 // 640
const H = canvas.height;                // 600
const DT = 1 / 120;                     // fixed simulation timestep, seconds

const FLOOR_H = 100;                    // distance between floor surfaces
const PLINTH = 14;                      // thickness of a floor slab
const FLOOR_SNAP = 6;                   // tolerance for "level with a floor"

const PLAYER_W = 16;
const PLAYER_H = 34;
const ENEMY_W = 16;
const ENEMY_H = 32;
const EDGE = 4;                         // gap kept between a body and a wall

const PLAYER_SPEED = 150;               // px/s
const ENEMY_SPEED = 74;                 // px/s
const ENEMY_STOP = 12;                  // agents stop closing in this near
const ELEV_SPEED = 92;                  // px/s while driven by the player
const ELEV_IDLE_SPEED = 55;             // px/s while homing to the player's floor
const BULLET_SPEED = 430;               // px/s
const EBULLET_SPEED = 300;              // px/s
const SHOT_COOLDOWN = 0.22;             // s between player shots
const ENEMY_SHOT_CD = 1.1;              // s between agent shots

const SHAFT_W = 56;
const SHAFT_XS = [120, 300, 480];
const CAR_H = 74;                       // drawn height of an elevator car

const DOOR_W = 38;
const DOOR_H = 52;
const DOOR_REACH = 20;                  // pickup radius around a red door
const DOOR_XS = [40, 210, 390, 560];
const LOBBY_DOOR_XS = [210, 390];

const PLAYER_START_X = 60;
const MAX_ENEMIES = 4;
const RESPAWN_DELAY = 1.3;              // s between losing a life and restarting
const LEVEL_COUNT = 4;

const DOC_POINTS = 500;
const SHOOT_POINTS = 300;
const CRUSH_POINTS = 800;
const LEVEL_BONUS = 1000;
const LIFE_BONUS = 250;

const BEST_KEY = 'elevatoraction-best';

// --- state -----------------------------------------------------------------

let state = 'idle';        // idle | running | paused | dying | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = 3;
let best = loadBest();

let floorCount = 0;
let worldH = 0;
let shafts = [];           // { x, w, lo, hi, y, dir }  y = the car's standing surface
let doors = [];            // { x, floor, red, taken }
let enemies = [];          // { x, y, floor, facing, shootCd }
let bullets = [];          // { x, y, vx, owner }
let pops = [];             // short-lived sparks, cosmetic only
let windows = [];          // lit facade windows, cosmetic only
let exitZone = { x: W - 96, w: 72 };

const player = { x: 60, y: 0, facing: 1, onCar: -1, shotCd: 0, step: 0 };
const camera = { y: 0 };
const keys = Object.create(null);

let autoRun = true;        // the animation loop only simulates while true
let carHoming = true;      // idle cars drift to the player's floor (test seam)
let spawnEnabled = true;   // agents step out of grey doors (test seam)
let spawnTimer = 0;
let spawnInterval = 2.6;
let respawnTimer = 0;
let hintTimer = 0;         // "documents still missing" flash at the exit
let animTime = 0;
let rng = mulberry32(1);

// --- helpers ---------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Small deterministic PRNG so a level's layout and its agents are reproducible.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadBest() {
    const raw = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private mode — the run simply isn't remembered */
        }
    }
}

// The walking surface of a floor, in world coordinates (y grows downward).
function floorSurfaceY(i) {
    return worldH - i * FLOOR_H - PLINTH;
}

// The floor a y belongs to, or -1 when it is not level with one.
function floorAt(y) {
    const i = Math.round((worldH - PLINTH - y) / FLOOR_H);
    if (i < 0 || i >= floorCount) return -1;
    return Math.abs(floorSurfaceY(i) - y) <= FLOOR_SNAP ? i : -1;
}

function carFloor(s) {
    const i = floorAt(s.y);
    return i >= s.lo && i <= s.hi ? i : -1;
}

function carLevelWith(s, floor) {
    if (floor < s.lo || floor > s.hi) return false;
    return Math.abs(s.y - floorSurfaceY(floor)) <= FLOOR_SNAP;
}

function playerFloor() {
    return player.onCar >= 0 ? carFloor(shafts[player.onCar]) : floorAt(player.y);
}

function docsRemaining() {
    return doors.reduce((n, d) => n + (d.red && !d.taken ? 1 : 0), 0);
}

// --- reachability ----------------------------------------------------------

// A shaft that does not serve a floor is a wall on it, so every floor is a row
// of walkable segments. A shaft that *does* serve the floor is both a gap
// between two segments and a lift to the other floors it serves, because an
// idle car answers the call of whatever floor the player stands on.
function floorSegments(floor, shaftList) {
    const walls = shaftList
        .filter((s) => floor < s.lo || floor > s.hi)
        .slice()
        .sort((a, b) => a.x - b.x);
    const segments = [];
    let start = 0;
    for (const wall of walls) {
        segments.push([start, wall.x]);
        start = wall.x + wall.w;
    }
    segments.push([start, W]);
    return segments;
}

function segmentIndexAt(segments, x) {
    return segments.findIndex(([a, b]) => x >= a && x <= b);
}

// Breadth-first search over (floor, segment) regions from where the player
// enters the building. Used to keep documents out of walled-off corners.
function reachableRegions(floors, shaftList, fromFloor, fromX) {
    const segmentsByFloor = [];
    for (let f = 0; f < floors; f++) segmentsByFloor.push(floorSegments(f, shaftList));

    const start = `${fromFloor}:${segmentIndexAt(segmentsByFloor[fromFloor], fromX)}`;
    const seen = new Set([start]);
    const queue = [[fromFloor, segmentIndexAt(segmentsByFloor[fromFloor], fromX)]];

    while (queue.length) {
        const [floor, si] = queue.shift();
        const [a, b] = segmentsByFloor[floor][si];
        for (const s of shaftList) {
            if (floor < s.lo || floor > s.hi) continue;   // not a lift here
            if (s.x < a || s.x > b) continue;             // not in this segment
            for (let f2 = s.lo; f2 <= s.hi; f2++) {
                const si2 = segmentIndexAt(segmentsByFloor[f2], s.x);
                const key = `${f2}:${si2}`;
                if (seen.has(key)) continue;
                seen.add(key);
                queue.push([f2, si2]);
            }
        }
    }
    return seen;
}

function isReachable(floor, x) {
    if (floorCount === 0) return false;
    const reach = reachableRegions(floorCount, shafts, floorCount - 1, PLAYER_START_X);
    return reach.has(`${floor}:${segmentIndexAt(floorSegments(floor, shafts), x)}`);
}

// --- level construction ----------------------------------------------------

// Pure: the same level number always yields the same building.
function buildLevel(n) {
    const rand = mulberry32(n * 7919 + 13);
    const floors = 8 + (n - 1);
    const top = floors - 1;
    const mid = Math.floor(top / 2);

    const shaftSpans = [
        { lo: mid, hi: top },
        { lo: Math.max(1, mid - 2), hi: top - 1 },
        { lo: 0, hi: mid + 1 },
    ];
    const builtShafts = shaftSpans.map((span, i) => ({
        x: SHAFT_XS[i],
        w: SHAFT_W,
        lo: span.lo,
        hi: span.hi,
        y: 0,
        dir: 0,
    }));

    // One document per floor, on distinct floors drawn from 1 .. top - 1, and
    // never in a corner the player cannot walk to: a shaft that skips a floor
    // seals off whatever lies beyond it.
    const docCount = 3 + n;
    const reach = reachableRegions(floors, builtShafts, floors - 1, PLAYER_START_X);
    const candidates = [];
    for (let f = 1; f < top; f++) candidates.push(f);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const docFloors = new Map();
    for (const f of candidates) {
        if (docFloors.size >= docCount) break;
        const segments = floorSegments(f, builtShafts);
        const slots = DOOR_XS.map((x, slot) => ({ x, slot })).filter(({ x }) =>
            reach.has(`${f}:${segmentIndexAt(segments, x)}`)
        );
        if (slots.length === 0) continue;
        docFloors.set(f, slots[Math.floor(rand() * slots.length)].slot);
    }

    const builtDoors = [];
    for (let f = 0; f < floors; f++) {
        const xs = f === 0 ? LOBBY_DOOR_XS : DOOR_XS;
        xs.forEach((x, slot) => {
            builtDoors.push({ x, floor: f, red: docFloors.get(f) === slot, taken: false });
        });
    }

    // Lit facade windows: cosmetic, but seeded so a building always looks alike.
    const litWindows = [];
    for (let f = 0; f < floors; f++) {
        for (let c = 0; c < 14; c++) {
            if (rand() < 0.34) litWindows.push({ floor: f, col: c, warm: rand() < 0.5 });
        }
    }

    return {
        floorCount: floors,
        worldH: floors * FLOOR_H,
        shafts: builtShafts,
        doors: builtDoors,
        windows: litWindows,
        spawnInterval: Math.max(1.05, 2.6 - 0.3 * (n - 1)),
    };
}

function startLevel() {
    const built = buildLevel(level);
    floorCount = built.floorCount;
    worldH = built.worldH;
    shafts = built.shafts;
    doors = built.doors;
    windows = built.windows;
    spawnInterval = built.spawnInterval;
    exitZone = { x: W - 96, w: 72 };

    rng = mulberry32(level * 104729 + 7);
    enemies = [];
    bullets = [];
    pops = [];
    spawnTimer = spawnInterval;
    respawnTimer = 0;
    hintTimer = 0;

    shafts.forEach((s) => {
        s.y = floorSurfaceY(s.hi);
        s.dir = 0;
    });

    placePlayerAtRoof();
    state = 'running';
    hideOverlay();
    updateCamera();
    updateHud();
}

function placePlayerAtRoof() {
    player.x = PLAYER_START_X;
    player.y = floorSurfaceY(floorCount - 1);
    player.facing = 1;
    player.onCar = -1;
    player.shotCd = 0;
    player.step = 0;
}

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    startLevel();
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state === 'dying') {
        respawnTimer -= dt;
        if (respawnTimer <= 0) respawn();
        return;
    }
    if (state !== 'running') return;

    animTime += dt;
    player.shotCd -= dt;
    if (hintTimer > 0) hintTimer -= dt;

    movePlayer(dt);
    moveCars(dt);
    moveEnemies(dt);
    moveBullets(dt);
    if (state !== 'running') return;

    collectDocs();
    spawnTick(dt);
    retireEnemies();
    updatePops(dt);
    updateCamera();
    checkExit();
    updateHud();
}

function inputDir() {
    let dir = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) dir -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) dir += 1;
    return dir;
}

function movePlayer(dt) {
    const dir = inputDir();
    if (dir === 0) return;
    player.facing = dir;
    player.step += dt;

    const minX = PLAYER_W / 2 + EDGE;
    const maxX = W - PLAYER_W / 2 - EDGE;
    let nx = clamp(player.x + dir * PLAYER_SPEED * dt, minX, maxX);

    // Riding a car between floors: the car is a cage.
    if (player.onCar >= 0 && carFloor(shafts[player.onCar]) < 0) {
        const car = shafts[player.onCar];
        player.x = clamp(nx, car.x + PLAYER_W / 2, car.x + car.w - PLAYER_W / 2);
        player.y = car.y;
        return;
    }

    // Otherwise the player stands on a floor — either its slab or a level car.
    const floor = player.onCar >= 0 ? carFloor(shafts[player.onCar]) : floorAt(player.y);
    if (floor < 0) return;

    for (const s of shafts) {
        const a = s.x;
        const b = s.x + s.w;
        const insideNow = player.x > a && player.x < b;
        const insideNext = nx > a && nx < b;
        if (insideNext && !insideNow && !carLevelWith(s, floor)) {
            nx = dir > 0 ? a - PLAYER_W / 2 : b + PLAYER_W / 2;
        }
    }
    player.x = nx;

    const boarded = shafts.findIndex(
        (s) => nx > s.x && nx < s.x + s.w && carLevelWith(s, floor)
    );
    if (boarded >= 0) {
        player.onCar = boarded;
        player.y = shafts[boarded].y;
    } else {
        player.onCar = -1;
        player.y = floorSurfaceY(floor);
    }
}

function moveCars(dt) {
    const pf = playerFloor();
    for (let i = 0; i < shafts.length; i++) {
        const s = shafts[i];
        const topY = floorSurfaceY(s.hi);
        const botY = floorSurfaceY(s.lo);
        let dir = 0;
        let speed = ELEV_SPEED;
        let target = null;

        if (player.onCar === i) {
            if (keys['ArrowUp'] || keys['KeyW']) dir = -1;
            else if (keys['ArrowDown'] || keys['KeyS']) dir = 1;
        } else if (carHoming && pf >= s.lo && pf <= s.hi) {
            // An unoccupied car answers the call of the floor you stand on.
            target = floorSurfaceY(pf);
            if (Math.abs(target - s.y) > 0.5) {
                dir = Math.sign(target - s.y);
                speed = ELEV_IDLE_SPEED;
            }
        }

        s.dir = dir;
        if (dir === 0) continue;

        let ny = clamp(s.y + dir * speed * dt, topY, botY);
        if (target !== null) ny = dir > 0 ? Math.min(ny, target) : Math.max(ny, target);
        if (dir > 0) crushUnder(s, ny);
        s.y = ny;
        if (player.onCar === i) player.y = ny;
    }
}

// A descending car flattens any agent its floor passes through.
function crushUnder(s, ny) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const overlapX = e.x + ENEMY_W / 2 > s.x && e.x - ENEMY_W / 2 < s.x + s.w;
        if (overlapX && ny > e.y - ENEMY_H && ny <= e.y) {
            enemies.splice(i, 1);
            score += CRUSH_POINTS;
            pops.push({ x: e.x, y: e.y - 8, life: 0.45, kind: 'crush' });
        }
    }
}

// Clamp a walker to the walls and to the lip of any shaft it cannot cross.
function walkLimit(fromX, toX, dir, floor, halfW) {
    let nx = clamp(toX, halfW + EDGE, W - halfW - EDGE);
    for (const s of shafts) {
        const a = s.x;
        const b = s.x + s.w;
        const insideNow = fromX > a && fromX < b;
        const insideNext = nx > a && nx < b;
        if (insideNext && !insideNow && !carLevelWith(s, floor)) {
            nx = dir > 0 ? a - halfW : b + halfW;
        }
    }
    return nx;
}

function moveEnemies(dt) {
    const pf = playerFloor();
    for (const e of enemies) {
        e.shootCd -= dt;
        let dir = 0;

        if (e.floor === pf) {
            const dx = player.x - e.x;
            e.facing = dx >= 0 ? 1 : -1;
            if (Math.abs(dx) > ENEMY_STOP) dir = e.facing;
            if (e.shootCd <= 0) {
                bullets.push({
                    x: e.x + e.facing * 12,
                    y: e.y - 20,
                    vx: e.facing * EBULLET_SPEED,
                    owner: 'enemy',
                });
                e.shootCd = ENEMY_SHOT_CD;
            }
        } else {
            dir = e.facing;
        }

        if (dir === 0) continue;
        const want = e.x + dir * ENEMY_SPEED * dt;
        const got = walkLimit(e.x, want, dir, e.floor, ENEMY_W / 2);
        if (Math.abs(got - want) > 1e-9 && e.floor !== pf) e.facing = -e.facing;
        e.x = got;
    }
}

function moveBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < -24 || b.x > W + 24) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.owner === 'player') {
            const hit = enemies.findIndex((e) => hitsBox(b, e.x, e.y, ENEMY_W, ENEMY_H));
            if (hit >= 0) {
                pops.push({ x: enemies[hit].x, y: enemies[hit].y - 16, life: 0.35, kind: 'shot' });
                enemies.splice(hit, 1);
                bullets.splice(i, 1);
                score += SHOOT_POINTS;
            }
        } else if (hitsBox(b, player.x, player.y, PLAYER_W, PLAYER_H)) {
            bullets.splice(i, 1);
            loseLife();
            return;
        }
    }
}

// Bullets are small rectangles; bodies hang above their feet position.
function hitsBox(b, cx, feetY, w, h) {
    return (
        b.x + 8 > cx - w / 2 &&
        b.x < cx + w / 2 &&
        b.y + 2 > feetY - h &&
        b.y - 2 < feetY
    );
}

function collectDocs() {
    const pf = playerFloor();
    if (pf < 0) return;
    for (const d of doors) {
        if (d.red && !d.taken && d.floor === pf && Math.abs(d.x - player.x) <= DOOR_REACH) {
            d.taken = true;
            score += DOC_POINTS;
            pops.push({ x: d.x, y: floorSurfaceY(pf) - DOOR_H, life: 0.6, kind: 'doc' });
        }
    }
}

function spawnTick(dt) {
    if (!spawnEnabled) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval;
    if (enemies.length >= MAX_ENEMIES) return;

    const pf = playerFloor();
    const home = pf >= 0 ? pf : floorAt(camera.y + H / 2);
    const base = home >= 0 ? home : floorCount - 1;
    const choices = doors.filter((d) => !d.red && Math.abs(d.floor - base) <= 2);
    if (choices.length === 0) return;

    const d = choices[Math.floor(rng() * choices.length)];
    enemies.push({
        x: d.x,
        y: floorSurfaceY(d.floor),
        floor: d.floor,
        facing: d.x > W / 2 ? -1 : 1,
        shootCd: ENEMY_SHOT_CD,
    });
}

// Agents far outside the view are retired so the simulation stays bounded.
function retireEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const y = enemies[i].y;
        if (y < camera.y - FLOOR_H * 3 || y > camera.y + H + FLOOR_H * 3) enemies.splice(i, 1);
    }
}

function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
    }
}

function updateCamera() {
    camera.y = clamp(player.y - H * 0.45, 0, Math.max(0, worldH - H));
}

function checkExit() {
    if (playerFloor() !== 0) return;
    if (player.x < exitZone.x || player.x > exitZone.x + exitZone.w) return;
    if (docsRemaining() > 0) {
        hintTimer = 1.5;
        return;
    }
    score += LEVEL_BONUS + LIFE_BONUS * lives;
    state = 'levelclear';
    saveBest();
    updateHud();
    showOverlay(
        'BUILDING CLEAR',
        level >= LEVEL_COUNT ? 'Press Space for the final word' : 'Press Space for the next building'
    );
}

function loseLife() {
    lives -= 1;
    bullets.length = 0;
    enemies.length = 0;
    pops.push({ x: player.x, y: player.y - 18, life: 0.6, kind: 'hit' });
    updateHud();
    if (lives <= 0) {
        state = 'gameover';
        saveBest();
        updateHud();
        showOverlay('GAME OVER', 'Press Space to try again');
    } else {
        state = 'dying';
        respawnTimer = RESPAWN_DELAY;
    }
}

function respawn() {
    bullets.length = 0;
    enemies.length = 0;
    shafts.forEach((s) => {
        s.y = floorSurfaceY(s.hi);
        s.dir = 0;
    });
    placePlayerAtRoof();
    spawnTimer = spawnInterval;
    respawnTimer = 0;
    state = 'running';
    updateCamera();
    updateHud();
}

function playerShoot() {
    if (state !== 'running' || player.shotCd > 0) return;
    bullets.push({
        x: player.x + player.facing * 12,
        y: player.y - 22,
        vx: player.facing * BULLET_SPEED,
        owner: 'player',
    });
    player.shotCd = SHOT_COOLDOWN;
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// Space / click: start, shoot, or move past an overlay.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'paused':
            state = 'running';
            hideOverlay();
            break;
        case 'levelclear':
            if (level >= LEVEL_COUNT) {
                state = 'won';
                saveBest();
                updateHud();
                showOverlay('YOU ESCAPED', 'Press Space to raid them again');
            } else {
                level += 1;
                startLevel();
            }
            break;
        default:
            break; // running / dying ignore it
    }
}

// --- HUD and overlay -------------------------------------------------------

const hudEls = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    docs: document.getElementById('docs'),
    lives: document.getElementById('lives'),
    best: document.getElementById('best'),
};
const overlayEl = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const hudCache = Object.create(null);

function setHud(key, value) {
    const text = String(value);
    if (hudCache[key] === text) return;
    hudCache[key] = text;
    hudEls[key].textContent = text;
}

function updateHud() {
    setHud('score', score);
    setHud('level', level);
    setHud('docs', docsRemaining());
    setHud('lives', Math.max(0, lives));
    setHud('best', best);
}

function showOverlay(title, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = state === 'idle' ? '' : `Score ${score}`;
    overlaySub.textContent = sub;
    overlayEl.classList.add('visible');
}

function hideOverlay() {
    overlayEl.classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

const SKY = ['#0a1024', '#121a33'];

function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY[0]);
    g.addColorStop(1, SKY[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (state === 'idle' || floorCount === 0) {
        drawSkyline();
        drawTitleCard();
        return;
    }

    drawSkyline();
    ctx.save();
    ctx.translate(0, -camera.y);
    drawFacade();
    drawShafts();
    drawDoors();
    drawExit();
    drawCars();
    drawEnemies();
    if (state !== 'dying' || Math.floor(animTime * 12) % 2 === 0) drawPlayer();
    drawBullets();
    drawPops();
    ctx.restore();
    drawVignette();
    drawHint();
}

function drawSkyline() {
    ctx.fillStyle = '#0c1430';
    for (let i = 0; i < 9; i++) {
        const bw = 40 + ((i * 37) % 48);
        const bh = 60 + ((i * 53) % 90);
        ctx.fillRect(i * 74 - 10, H - bh, bw, bh);
    }
    ctx.fillStyle = 'rgba(255, 221, 128, 0.25)';
    for (let i = 0; i < 40; i++) {
        const x = (i * 97) % W;
        const y = H - 20 - ((i * 53) % 90);
        ctx.fillRect(x, y, 3, 4);
    }
}

function drawFacade() {
    ctx.fillStyle = '#131c2e';
    ctx.fillRect(0, 0, W, worldH);

    // Window grid, lit from the seeded layout.
    for (const win of windows) {
        const surface = floorSurfaceY(win.floor);
        const x = 14 + win.col * 44;
        const y = surface - FLOOR_H + 20;
        ctx.fillStyle = win.warm ? 'rgba(252, 211, 77, 0.22)' : 'rgba(56, 189, 248, 0.16)';
        ctx.fillRect(x, y, 30, 24);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, 29, 23);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
        ctx.fillRect(x + 14, y, 2, 24);
    }

    for (let f = 0; f < floorCount; f++) {
        const y = floorSurfaceY(f);
        ctx.fillStyle = f === 0 ? '#243350' : '#1f2b44';
        ctx.fillRect(0, y, W, PLINTH);
        ctx.fillStyle = '#2f3f61';
        ctx.fillRect(0, y, W, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(0, y + PLINTH - 3, W, 3);

        // The label lives on the slab itself, where no door can cover it.
        const label = f === 0 ? 'LOBBY' : `FLOOR ${f}`;
        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, 6, y + PLINTH - 4);
        ctx.textAlign = 'right';
        ctx.fillText(label, W - 6, y + PLINTH - 4);
    }
}

function drawShafts() {
    for (const s of shafts) {
        const top = floorSurfaceY(s.hi) - FLOOR_H + PLINTH;
        const bottom = floorSurfaceY(s.lo) + PLINTH;

        ctx.fillStyle = '#070b14';
        ctx.fillRect(s.x, top, s.w, bottom - top);

        // guide rails and the landing mark of every floor this shaft serves
        ctx.fillStyle = '#1b2439';
        ctx.fillRect(s.x + 6, top, 3, bottom - top);
        ctx.fillRect(s.x + s.w - 9, top, 3, bottom - top);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        for (let f = s.lo; f <= s.hi; f++) {
            const y = floorSurfaceY(f);
            ctx.fillRect(s.x + 2, y, s.w - 4, 2);
        }

        // the shaft is capped where its service ends
        ctx.fillStyle = '#2b3850';
        ctx.fillRect(s.x, top - 6, s.w, 6);
        ctx.fillRect(s.x, bottom, s.w, 6);
        ctx.strokeStyle = '#26324c';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 1, top, s.w - 2, bottom - top);

        // a plate naming the floors served, hung at the top of the shaft
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${s.lo}-${s.hi}`, s.x + s.w / 2, top - 9);
    }
}

function drawDoors() {
    for (const d of doors) {
        const surface = floorSurfaceY(d.floor);
        const y = surface - DOOR_H;
        if (d.red && !d.taken) {
            ctx.fillStyle = '#b91c1c';
            ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, DOOR_H);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, 4);
            ctx.fillStyle = '#fde68a';
            ctx.fillRect(d.x - 7, y + 18, 14, 18);
            ctx.fillStyle = '#b45309';
            ctx.fillRect(d.x - 7, y + 22, 14, 2);
            ctx.fillRect(d.x - 7, y + 27, 14, 2);
        } else if (d.red) {
            ctx.fillStyle = '#1b2234';
            ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, DOOR_H);
            ctx.strokeStyle = '#7f1d1d';
            ctx.lineWidth = 2;
            ctx.strokeRect(d.x - DOOR_W / 2 + 1, y + 1, DOOR_W - 2, DOOR_H - 2);
        } else {
            ctx.fillStyle = '#2b3850';
            ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, DOOR_H);
            ctx.fillStyle = '#3a4a68';
            ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, 3);
            ctx.fillStyle = '#8c9ab5';
            ctx.fillRect(d.x + DOOR_W / 2 - 8, y + DOOR_H / 2 - 1, 4, 3);
        }
    }
}

function drawExit() {
    const surface = floorSurfaceY(0);
    const x = exitZone.x;
    const ready = docsRemaining() === 0;

    ctx.fillStyle = ready ? '#22c55e' : '#334155';
    ctx.fillRect(x, surface - 26, exitZone.w, 20);
    ctx.fillStyle = ready ? '#16a34a' : '#1e293b';
    ctx.fillRect(x + 10, surface - 36, exitZone.w - 30, 12);
    ctx.fillStyle = '#0b1220';
    ctx.beginPath();
    ctx.arc(x + 16, surface - 5, 7, 0, Math.PI * 2);
    ctx.arc(x + exitZone.w - 16, surface - 5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ready ? 'rgba(34, 197, 94, 0.9)' : 'rgba(125, 138, 165, 0.7)';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ready ? 'ESCAPE' : 'LOCKED', x + exitZone.w / 2, surface - 42);
}

function drawCars() {
    for (let i = 0; i < shafts.length; i++) {
        const s = shafts[i];
        const y = s.y;
        const occupied = player.onCar === i;

        ctx.fillStyle = '#16203a';
        ctx.fillRect(s.x + 3, y - CAR_H, s.w - 6, CAR_H);
        ctx.fillStyle = occupied ? 'rgba(252, 211, 77, 0.16)' : 'rgba(148, 163, 184, 0.10)';
        ctx.fillRect(s.x + 6, y - CAR_H + 5, s.w - 12, CAR_H - 10);

        // sliding doors, parted only while someone is aboard
        ctx.fillStyle = '#2a3a5c';
        const gap = occupied ? 9 : 1;
        ctx.fillRect(s.x + 6, y - CAR_H + 5, s.w / 2 - 6 - gap, CAR_H - 10);
        ctx.fillRect(s.x + s.w / 2 + gap, y - CAR_H + 5, s.w / 2 - 6 - gap, CAR_H - 10);

        ctx.strokeStyle = '#4b5f86';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 4, y - CAR_H + 1, s.w - 8, CAR_H - 2);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
        ctx.fillRect(s.x + 6, y - CAR_H + 5, s.w - 12, 2);   // ceiling strip light
        ctx.fillStyle = '#64748b';
        ctx.fillRect(s.x + 3, y - 4, s.w - 6, 6);            // car floor

        // travel lamp on the roof: blue going up, amber going down
        ctx.fillStyle = s.dir === 0 ? '#475569' : s.dir < 0 ? '#38bdf8' : '#fbbf24';
        ctx.fillRect(s.x + s.w / 2 - 5, y - CAR_H - 6, 10, 4);
    }
}

function drawPerson(x, feetY, facing, coat, skin, hat, walkPhase) {
    const h = PLAYER_H;
    ctx.save();
    ctx.translate(x, feetY);

    // legs
    const swing = Math.sin(walkPhase * 12) * 4;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-1, -12);
    ctx.lineTo(-3 + swing, 0);
    ctx.moveTo(1, -12);
    ctx.lineTo(3 - swing, 0);
    ctx.stroke();

    // coat
    ctx.fillStyle = coat;
    ctx.fillRect(-6, -h + 10, 12, h - 22);
    // arm / gun
    ctx.fillStyle = coat;
    ctx.fillRect(facing > 0 ? 4 : -10, -h + 15, 6, 4);
    ctx.fillStyle = '#cbd5f5';
    ctx.fillRect(facing > 0 ? 10 : -14, -h + 16, 5, 2);

    // head and hat
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -h + 5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hat;
    ctx.fillRect(-7, -h + 1, 14, 3);
    ctx.fillRect(-4, -h - 3, 8, 4);
    ctx.restore();
}

function drawPlayer() {
    drawPerson(player.x, player.y, player.facing, '#38bdf8', '#f6d7b0', '#0f172a', player.step);
}

function drawEnemies() {
    for (const e of enemies) {
        drawPerson(e.x, e.y, e.facing, '#9ca3af', '#f6d7b0', '#b91c1c', animTime + e.x * 0.01);
    }
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#e0f2fe' : '#fca5a5';
        ctx.fillRect(b.x, b.y - 1, 8, 3);
    }
}

function drawPops() {
    for (const p of pops) {
        const a = clamp(p.life * 2, 0, 1);
        ctx.strokeStyle =
            p.kind === 'doc'
                ? `rgba(253, 230, 138, ${a})`
                : p.kind === 'hit'
                  ? `rgba(248, 113, 113, ${a})`
                  : `rgba(226, 232, 240, ${a})`;
        ctx.lineWidth = 2;
        const r = 20 - a * 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawVignette() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(5, 7, 13, 0.55)');
    g.addColorStop(0.2, 'rgba(5, 7, 13, 0)');
    g.addColorStop(0.8, 'rgba(5, 7, 13, 0)');
    g.addColorStop(1, 'rgba(5, 7, 13, 0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

function drawHint() {
    if (hintTimer <= 0) return;
    ctx.fillStyle = `rgba(252, 211, 77, ${clamp(hintTimer, 0, 1)})`;
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${docsRemaining()} document(s) still in the building`, W / 2, 30);
}

function drawTitleCard() {
    ctx.fillStyle = 'rgba(19, 28, 46, 0.9)';
    ctx.fillRect(60, 180, W - 120, 240);
    ctx.strokeStyle = '#2f3f61';
    ctx.lineWidth = 2;
    ctx.strokeRect(60, 180, W - 120, 240);

    for (let i = 0; i < 3; i++) {
        const y = 230 + i * 70;
        ctx.fillStyle = '#1f2b44';
        ctx.fillRect(80, y, W - 160, 10);
        ctx.fillStyle = i === 1 ? '#b91c1c' : '#2b3850';
        ctx.fillRect(150 + i * 120, y - 40, DOOR_W, 40);
    }
    drawPerson(110, 310, 1, '#38bdf8', '#f6d7b0', '#0f172a', 0);
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (state === 'running') playerShoot();
            else advance();
            break;
        case 'KeyP':
            togglePause();
            break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
            e.preventDefault();
            break;
        default:
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', () => advance());
canvas.addEventListener('click', () => {
    if (state === 'running') playerShoot();
    else advance();
});

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && (state === 'running' || state === 'dying')) {
        carry += dt;
        while (carry >= DT) {
            physicsStep(DT);
            carry -= DT;
        }
    } else {
        carry = 0;
    }

    draw();
    requestAnimationFrame(frame);
}

updateHud();
draw();
requestAnimationFrame(frame);
