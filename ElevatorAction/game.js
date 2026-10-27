// Elevator Action — ride the lifts down a seven-storey building, loot every
// red door and drive off in the getaway car before the agents shoot you.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, player, elevators, doors, enemies,
// bullets) is kept at the top level on purpose: the Playwright suite drives the
// game through exactly these names. See DESIGN.md for the rules behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 600
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const MARGIN = 24;                   // outer wall thickness
const FLOOR_COUNT = 7;               // 0 = roof floor, 6 = garage
const FLOOR_H = 74;
const FLOOR_TOP = 92;
const SLAB_H = 6;

const SHAFTS = [192, 408];           // left edge of each shaft
const CAR_W = 64;
const CAR_H = 12;
const CAR_SPEED = 90;                // px/s while a drive key is held
const ALIGN_EPS = 10;                // how level a car must be to step across

const PLAYER_W = 18;
const PLAYER_H = 30;
const DUCK_H = 16;
const WALK_SPEED = 130;
const START_X = 596;
const START_LIVES = 3;
const DEATH_PAUSE = 0.9;             // seconds between a hit and the respawn

const ENEMY_W = 18;
const ENEMY_H = 30;
const ENEMY_SPEED = 52;
const ENEMY_SIGHT = 320;
const ENEMY_FIRST_SHOT = 0.8;        // grace period after an agent appears

const BULLET_W = 8;
const BULLET_H = 3;
const BULLET_Y_OFF = 20;             // bullets fly this far above the floor
const BULLET_SPEED = 300;
const ENEMY_BULLET_SPEED = 210;
const MAX_PLAYER_BULLETS = 3;

const DOOR_W = 34;
const DOOR_H = 46;

const ENEMY_POINTS = 200;
const DOC_POINTS = 500;
const ESCAPE_BONUS = 1000;

const EXIT = { x: 56, w: 100, h: 34, floor: FLOOR_COUNT - 1 };

const SPAWN_GRACE = 1.5;             // quiet seconds after a start or respawn

const BEST_KEY = 'elevatoraction-best';

// Three doors per office floor, each clear of both shafts.
const DOOR_X = [
    [80, 332, 544],
    [150, 290, 500],
    [60, 370, 580],
    [110, 300, 520],
    [70, 350, 560],
    [130, 310, 510],
];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | dying | levelclear | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = loadBest();

let doors = [];
let elevators = [];
let enemies = [];
let bullets = [];
let sparks = [];                     // short-lived hit flashes, cosmetic only

let player = {
    x: START_X,
    y: FLOOR_TOP,
    facing: -1,
    ducking: false,
    alive: true,
    support: { type: 'floor', index: 0 },
};

let autoRun = true;                  // the animation loop only simulates while true
let spawnEnabled = true;             // tests switch the agents off to pose a scene
let spawnTimer = SPAWN_GRACE;
let deathTimer = 0;
let rng = mulberry32(1);

const keys = Object.create(null);

// --- small helpers ---------------------------------------------------------

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function floorY(i) {
    return FLOOR_TOP + i * FLOOR_H;
}

// The walkway containing x: a floor is solid except where a shaft cuts it.
function segmentFor(x) {
    let left = MARGIN;
    let right = W - MARGIN;
    for (const sx of SHAFTS) {
        if (x >= sx + CAR_W) left = Math.max(left, sx + CAR_W);
        else if (x <= sx) right = Math.min(right, sx);
    }
    return { left, right };
}

// The shaft whose walls form a given walkway boundary, or -1 for an outer wall.
function shaftLeftOf(boundary) {
    return SHAFTS.findIndex((sx) => sx + CAR_W === boundary);
}

function shaftRightOf(boundary) {
    return SHAFTS.findIndex((sx) => sx === boundary);
}

function nearestFloor(y) {
    return clamp(Math.round((y - FLOOR_TOP) / FLOOR_H), 0, FLOOR_COUNT - 1);
}

// The floor a car is level enough with to step across, or -1 if it is mid-shaft.
function carAlignedFloor(id) {
    const f = nearestFloor(elevators[id].y);
    return Math.abs(elevators[id].y - floorY(f)) <= ALIGN_EPS ? f : -1;
}

function playerHeight() {
    return player.ducking ? DUCK_H : PLAYER_H;
}

function docsLeft() {
    return doors.filter((d) => d.red && !d.taken).length;
}

function exitReady() {
    return docsLeft() === 0;
}

function maxEnemies() {
    return Math.min(3 + level, 6);
}

function enemySpeed() {
    return ENEMY_SPEED + (level - 1) * 6;
}

function fireInterval() {
    return Math.max(0.7, 1.8 - 0.15 * (level - 1));
}

function spawnInterval() {
    return Math.max(1.0, 2.6 - 0.2 * level);
}

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage is optional */
    }
}

// --- building --------------------------------------------------------------

// Doors are a pure function of the level, so level 1 is the same building every
// time; only which agent walks out of which grey door is left to the RNG.
function buildLevel(n) {
    doors = [];
    for (let f = 0; f < DOOR_X.length; f++) {
        for (const x of DOOR_X[f]) {
            doors.push({ floor: f, x, red: false, open: false, taken: false });
        }
    }

    const wanted = Math.min(3 + n, 6);
    const start = ((n - 1) * 5) % doors.length;
    for (let k = 0; k < wanted; k++) {
        doors[(start + k * 7) % doors.length].red = true;
    }

    elevators = SHAFTS.map((x, id) => ({ id, x, y: floorY(0), vy: 0 }));
    enemies = [];
    bullets = [];
    sparks = [];
    spawnTimer = SPAWN_GRACE;
    rng = mulberry32(1337 + n * 101);
}

function placePlayerOnFloor(f, x) {
    player.x = x;
    player.y = floorY(f);
    player.support = { type: 'floor', index: f };
}

// Put the spy on a car at a given height — the way a test poses a ride.
function boardElevator(id, y) {
    elevators[id].y = y;
    elevators[id].vy = 0;
    player.x = SHAFTS[id] + CAR_W / 2;
    player.y = y;
    player.ducking = false;
    player.support = { type: 'elevator', id };
}

function resetSpy() {
    placePlayerOnFloor(0, START_X);
    player.facing = -1;
    player.ducking = false;
    player.alive = true;
}

// --- lifecycle -------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    buildLevel(level);
    resetSpy();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    buildLevel(level);
    resetSpy();
    state = 'running';
    hideOverlay();
    updateHud();
}

function killPlayer() {
    if (state !== 'running') return;
    player.alive = false;
    player.ducking = false;
    bullets = [];
    lives = Math.max(0, lives - 1);
    addSpark(player.x, player.y - PLAYER_H / 2, '#f87171');
    if (lives === 0) {
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Score ${score}`, 'Press Space to try again');
    } else {
        state = 'dying';
        deathTimer = DEATH_PAUSE;
    }
    updateHud();
}

function respawn() {
    enemies = [];
    bullets = [];
    elevators.forEach((car) => {
        car.y = floorY(0);
        car.vy = 0;
    });
    resetSpy();
    spawnTimer = SPAWN_GRACE;
    state = 'running';
    updateHud();
}

function levelClear() {
    score += ESCAPE_BONUS + 100 * level;
    state = 'levelclear';
    saveBest();
    showOverlay('ESCAPED', `Score ${score}`, 'Press Space for the next building');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// Space (and the start button) means "shoot" in play and "carry on" otherwise.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
            startGame();
            break;
        case 'levelclear':
            nextLevel();
            break;
        case 'paused':
            togglePause();
            break;
        default:
            break;
    }
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        updateSparks(dt);
        if (deathTimer <= 0) respawn();
        return;
    }
    if (state !== 'running') return;

    updateElevator(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    if (state !== 'running') return; // the spy was shot by one of those bullets
    updateSparks(dt);
    collectDocuments();
    checkExit();

    if (spawnEnabled) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            trySpawn();
            spawnTimer = spawnInterval();
        }
    }

    updateHud();
}

// Only the car the spy is standing on moves, and it carries them with it.
function updateElevator(dt) {
    if (player.support.type !== 'elevator') return;
    const car = elevators[player.support.id];
    const up = keys.ArrowUp || keys.KeyW;
    const down = keys.ArrowDown || keys.KeyS;
    const dir = (down ? 1 : 0) - (up ? 1 : 0);

    if (dir !== 0) {
        car.vy = dir * CAR_SPEED;
        car.y = clamp(car.y + car.vy * dt, floorY(0), floorY(FLOOR_COUNT - 1));
    } else {
        car.vy = 0;
        const f = nearestFloor(car.y);
        if (Math.abs(car.y - floorY(f)) <= ALIGN_EPS) car.y = floorY(f);
    }
    player.y = car.y;
}

function updatePlayer(dt) {
    if (!player.alive) return;

    const onFloor = player.support.type === 'floor';
    player.ducking = onFloor && !!(keys.ArrowDown || keys.KeyS);

    let dir = 0;
    if (!player.ducking) {
        if (keys.ArrowLeft || keys.KeyA) dir -= 1;
        if (keys.ArrowRight || keys.KeyD) dir += 1;
    }
    if (dir !== 0) player.facing = dir;
    if (dir === 0) return;

    const half = PLAYER_W / 2;
    const nx = clamp(player.x + dir * WALK_SPEED * dt, MARGIN + half, W - MARGIN - half);

    if (onFloor) walkOnFloor(nx, dir, half);
    else walkOnCar(nx, dir, half);
}

// On a floor the spy is stopped by walls and by shafts, unless that shaft's car
// happens to be level — then they walk straight onto it.
function walkOnFloor(nx, dir, half) {
    const f = player.support.index;
    const seg = segmentFor(player.x);

    if (dir < 0 && nx - half < seg.left) {
        const s = shaftLeftOf(seg.left);
        if (s >= 0 && carAlignedFloor(s) === f) stepOntoCar(s, dir, half);
        else player.x = seg.left + half;
        return;
    }
    if (dir > 0 && nx + half > seg.right) {
        const s = shaftRightOf(seg.right);
        if (s >= 0 && carAlignedFloor(s) === f) stepOntoCar(s, dir, half);
        else player.x = seg.right - half;
        return;
    }
    player.x = nx;
}

function stepOntoCar(s, dir, half) {
    player.support = { type: 'elevator', id: s };
    player.x = dir > 0 ? SHAFTS[s] + half : SHAFTS[s] + CAR_W - half;
    player.y = elevators[s].y;
}

// On a car the spy can only leave when the car is level with a floor.
function walkOnCar(nx, dir, half) {
    const id = player.support.id;
    const left = SHAFTS[id];
    const right = SHAFTS[id] + CAR_W;

    if (dir < 0 && nx - half < left) {
        const f = carAlignedFloor(id);
        if (f >= 0) stepOntoFloor(f, left - half);
        else player.x = left + half;
        return;
    }
    if (dir > 0 && nx + half > right) {
        const f = carAlignedFloor(id);
        if (f >= 0) stepOntoFloor(f, right + half);
        else player.x = right - half;
        return;
    }
    player.x = nx;
}

function stepOntoFloor(f, x) {
    player.support = { type: 'floor', index: f };
    player.x = x;
    player.y = floorY(f);
}

function spawnEnemyAt(floor, x) {
    const e = {
        x,
        y: floorY(floor),
        floor,
        dir: rng() < 0.5 ? -1 : 1,
        cooldown: ENEMY_FIRST_SHOT,
        spawnX: x,
        alive: true,
    };
    enemies.push(e);
    return e;
}

function trySpawn() {
    if (enemies.length >= maxEnemies()) return;
    const grey = doors.filter((d) => !d.red);
    if (grey.length === 0) return;

    for (let tries = 0; tries < 8; tries++) {
        const d = grey[Math.floor(rng() * grey.length)];
        const onTopOfSpy =
            player.support.type === 'floor' &&
            player.support.index === d.floor &&
            Math.abs(d.x - player.x) < 60;
        const crowded = enemies.some((e) => e.floor === d.floor && Math.abs(e.x - d.x) < 24);
        if (onTopOfSpy || crowded) continue;
        spawnEnemyAt(d.floor, d.x);
        return;
    }
}

function sharesFloorWithSpy(e) {
    return player.alive && Math.abs(player.y - e.y) < 1;
}

function updateEnemies(dt) {
    const speed = enemySpeed();
    for (const e of enemies) {
        if (sharesFloorWithSpy(e)) {
            const towards = Math.sign(player.x - e.x);
            if (towards !== 0) e.dir = towards;
        }

        e.x += e.dir * speed * dt;
        const seg = segmentFor(e.x);
        if (e.x - ENEMY_W / 2 < seg.left) {
            e.x = seg.left + ENEMY_W / 2;
            e.dir = 1;
        } else if (e.x + ENEMY_W / 2 > seg.right) {
            e.x = seg.right - ENEMY_W / 2;
            e.dir = -1;
        }

        e.cooldown -= dt;
        if (e.cooldown <= 0 && canShootSpy(e)) {
            bullets.push({
                x: e.x + e.dir * (ENEMY_W / 2 + 4),
                y: e.y - BULLET_Y_OFF,
                vx: e.dir * ENEMY_BULLET_SPEED,
                from: 'enemy',
            });
            e.cooldown = fireInterval();
        }
    }
}

function canShootSpy(e) {
    if (!sharesFloorWithSpy(e)) return false;
    const dx = player.x - e.x;
    return Math.sign(dx) === e.dir && Math.abs(dx) < ENEMY_SIGHT;
}

function shoot() {
    if (state !== 'running' || !player.alive || player.ducking) return false;
    const mine = bullets.reduce((n, b) => n + (b.from === 'player' ? 1 : 0), 0);
    if (mine >= MAX_PLAYER_BULLETS) return false;
    bullets.push({
        x: player.x + player.facing * (PLAYER_W / 2 + 6),
        y: player.y - BULLET_Y_OFF,
        vx: player.facing * BULLET_SPEED,
        from: 'player',
    });
    return true;
}

function hitsBox(b, cx, feetY, w, h) {
    if (Math.abs(b.x - cx) > (BULLET_W + w) / 2) return false;
    return b.y + BULLET_H / 2 > feetY - h && b.y - BULLET_H / 2 < feetY;
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;

        if (b.x < MARGIN - 20 || b.x > W - MARGIN + 20) {
            bullets.splice(i, 1);
            continue;
        }

        if (b.from === 'player') {
            const hit = enemies.findIndex((e) => hitsBox(b, e.x, e.y, ENEMY_W, ENEMY_H));
            if (hit >= 0) {
                addSpark(enemies[hit].x, enemies[hit].y - ENEMY_H / 2, '#fbbf24');
                enemies.splice(hit, 1);
                bullets.splice(i, 1);
                score += ENEMY_POINTS;
            }
        } else if (player.alive && hitsBox(b, player.x, player.y, PLAYER_W, playerHeight())) {
            bullets.splice(i, 1);
            killPlayer();
            return;
        }
    }
}

function addSpark(x, y, color) {
    sparks.push({ x, y, life: 0.35, color });
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i].life -= dt;
        if (sparks[i].life <= 0) sparks.splice(i, 1);
    }
}

function collectDocuments() {
    if (!player.alive || player.support.type !== 'floor') return;
    const reach = DOOR_W / 2 + PLAYER_W / 2;
    for (const d of doors) {
        if (!d.red || d.taken) continue;
        if (d.floor !== player.support.index) continue;
        if (Math.abs(player.x - d.x) > reach) continue;
        d.taken = true;
        d.open = true;
        score += DOC_POINTS;
        addSpark(d.x, floorY(d.floor) - DOOR_H / 2, '#f87171');
    }
}

function checkExit() {
    if (!player.alive || !exitReady()) return;
    if (player.support.type !== 'floor' || player.support.index !== EXIT.floor) return;
    const centre = EXIT.x + EXIT.w / 2;
    if (Math.abs(player.x - centre) < EXIT.w / 2 + PLAYER_W / 2) levelClear();
}

// --- rendering -------------------------------------------------------------

function drawBuilding() {
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, W, H);

    // outer shell
    ctx.fillStyle = '#0d1426';
    ctx.fillRect(MARGIN - 10, FLOOR_TOP - 56, W - 2 * (MARGIN - 10), floorY(FLOOR_COUNT - 1) - FLOOR_TOP + 112);
    ctx.strokeStyle = '#243253';
    ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN - 10, FLOOR_TOP - 56, W - 2 * (MARGIN - 10), floorY(FLOOR_COUNT - 1) - FLOOR_TOP + 112);

    // shafts behind everything else
    for (const sx of SHAFTS) {
        ctx.fillStyle = '#060a14';
        ctx.fillRect(sx, FLOOR_TOP - 56, CAR_W, floorY(FLOOR_COUNT - 1) - FLOOR_TOP + 60);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, FLOOR_TOP - 56);
        ctx.lineTo(sx + 0.5, floorY(FLOOR_COUNT - 1) + 4);
        ctx.moveTo(sx + CAR_W - 0.5, FLOOR_TOP - 56);
        ctx.lineTo(sx + CAR_W - 0.5, floorY(FLOOR_COUNT - 1) + 4);
        ctx.stroke();
    }

    // alternating bands give the storeys some depth behind the doors
    for (let f = 0; f < FLOOR_COUNT; f++) {
        if (f % 2 === 0) continue;
        ctx.fillStyle = 'rgba(96, 165, 250, 0.035)';
        ctx.fillRect(MARGIN, floorY(f) - FLOOR_H + SLAB_H, W - 2 * MARGIN, FLOOR_H - SLAB_H);
    }

    // floor slabs, broken where a shaft passes through
    for (let f = 0; f < FLOOR_COUNT; f++) {
        const y = floorY(f);
        const spans = [
            [MARGIN, SHAFTS[0]],
            [SHAFTS[0] + CAR_W, SHAFTS[1]],
            [SHAFTS[1] + CAR_W, W - MARGIN],
        ];
        for (const [a, b] of spans) {
            ctx.fillStyle = f === FLOOR_COUNT - 1 ? '#334155' : '#1e293b';
            ctx.fillRect(a, y, b - a, SLAB_H);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.28)';
            ctx.fillRect(a, y, b - a, 1.5);
        }
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor) - DOOR_H;
        const x = d.x - DOOR_W / 2;
        if (d.open) {
            ctx.fillStyle = '#0b1120';
            ctx.fillRect(x, y, DOOR_W, DOOR_H);
            ctx.strokeStyle = '#7f1d1d';
        } else {
            ctx.fillStyle = d.red ? '#b91c1c' : '#334155';
            ctx.fillRect(x, y, DOOR_W, DOOR_H);
            ctx.strokeStyle = d.red ? '#fca5a5' : '#64748b';
        }
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, DOOR_W - 1, DOOR_H - 1);
        if (!d.open) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
            ctx.fillRect(x + DOOR_W - 9, y + DOOR_H / 2 - 2, 4, 4);
        }
    }
}

function drawExit() {
    const y = floorY(EXIT.floor);
    const ready = exitReady();
    ctx.fillStyle = ready ? '#16a34a' : '#1f2937';
    ctx.fillRect(EXIT.x, y - EXIT.h, EXIT.w, EXIT.h);
    ctx.fillStyle = ready ? '#86efac' : '#374151';
    ctx.fillRect(EXIT.x + 14, y - EXIT.h - 12, EXIT.w - 40, 14);
    ctx.fillStyle = '#0b1120';
    for (const wheelX of [EXIT.x + 20, EXIT.x + EXIT.w - 22]) {
        ctx.beginPath();
        ctx.arc(wheelX, y - 2, 7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = ready ? 'rgba(134, 239, 172, 0.9)' : 'rgba(100, 116, 139, 0.6)';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ready ? 'GO' : 'LOCKED', EXIT.x + EXIT.w / 2, y - EXIT.h - 18);
    ctx.textAlign = 'left';
}

function drawCars() {
    for (const car of elevators) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(car.x + CAR_W / 2, FLOOR_TOP - 56);
        ctx.lineTo(car.x + CAR_W / 2, car.y);
        ctx.stroke();

        ctx.fillStyle = '#475569';
        ctx.fillRect(car.x, car.y, CAR_W, CAR_H);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(car.x, car.y, CAR_W, 2);
        ctx.fillStyle = 'rgba(96, 165, 250, 0.5)';
        ctx.fillRect(car.x + 4, car.y + CAR_H - 3, CAR_W - 8, 2);
    }
}

function drawFigure(x, feetY, h, body, head) {
    ctx.fillStyle = body;
    ctx.fillRect(x - PLAYER_W / 2, feetY - h, PLAYER_W, h);
    ctx.fillStyle = head;
    ctx.fillRect(x - PLAYER_W / 2 - 2, feetY - h - 4, PLAYER_W + 4, 4);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fillRect(x - PLAYER_W / 2, feetY - h * 0.45, PLAYER_W, 2);
}

function drawPlayer() {
    if (!player.alive) return;
    const h = playerHeight();
    drawFigure(player.x, player.y, h, '#e2e8f0', '#f8fafc');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(player.x + player.facing * 4 - 2, player.y - h + 4, 4, 4);
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(player.x + player.facing * (PLAYER_W / 2), player.y - BULLET_Y_OFF - 1, 6 * player.facing, 3);
}

function drawEnemies() {
    for (const e of enemies) {
        drawFigure(e.x, e.y, ENEMY_H, '#1d4ed8', '#1e3a8a');
        ctx.fillStyle = '#bfdbfe';
        ctx.fillRect(e.x + e.dir * 4 - 2, e.y - ENEMY_H + 5, 4, 3);
    }
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.from === 'player' ? '#fde68a' : '#fca5a5';
        ctx.fillRect(b.x - BULLET_W / 2, b.y - BULLET_H / 2, BULLET_W, BULLET_H);
    }
}

function drawSparks() {
    for (const s of sparks) {
        const k = Math.max(0, s.life / 0.35);
        ctx.globalAlpha = k;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 + (1 - k) * 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function draw() {
    drawBuilding();
    drawDoors();
    drawExit();
    drawCars();
    drawEnemies();
    drawPlayer();
    drawBullets();
    drawSparks();
}

// --- HUD and overlay -------------------------------------------------------

const hudScore = document.getElementById('score');
const hudLevel = document.getElementById('level');
const hudDocs = document.getElementById('docs');
const hudLives = document.getElementById('lives');
const hudBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');

function updateHud() {
    hudScore.textContent = String(score);
    hudLevel.textContent = String(level);
    hudDocs.textContent = String(docsLeft());
    hudLives.textContent = String(lives);
    hudBest.textContent = String(Math.max(best, score));
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (state === 'running') shoot();
            else advance();
            break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
            e.preventDefault();
            break;
        case 'KeyP':
            togglePause();
            break;
        default:
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', () => advance());

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

buildLevel(level);
updateHud();
draw();
requestAnimationFrame(frame);
