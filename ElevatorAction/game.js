// Elevator Action — raid an eight-floor building, loot the red doors and leave
// through the ground-floor exit before the guards get you.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, player, elevators, doors, enemies, bullets)
// is kept at the top level on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules and the constants
// behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const H = canvas.height;             // 640
const DT = 1 / 60;                   // fixed simulation timestep, seconds

// --- building --------------------------------------------------------------

const FLOORS = 8;
const FLOOR_H = 68;                  // distance between two floor surfaces
const FLOOR1_Y = 568;                // y of the ground-floor surface
const SLAB_H = 7;                    // drawn thickness of a floor slab
const STREET_Y = 606;                // the pavement the building stands on

// Both shafts run the full height of the building; x is the left edge.
const SHAFTS = [
    { x: 144, w: 48 },
    { x: 300, w: 48 },
];
const CAR_SPEED = 95;                // px/s — a floor takes a little over 0.7s
const CAR_W = 44;
const CAR_H = 52;

// Doors sit in fixed slots so a level is a choice of which slots hold
// documents rather than a free-form layout. No slot overlaps a shaft.
const DOOR_SLOTS = [24, 74, 214, 264, 370, 420];
const DOOR_W = 30;
const DOOR_H = 42;

// The exit replaces the left-most door slot on the ground floor.
const EXIT = { floor: 1, x: 16, y: FLOOR1_Y - 46, w: 40, h: 46 };

// --- actors ----------------------------------------------------------------

const PLAYER_W = 16;
const PLAYER_H = 28;
const WALK_SPEED = 115;              // px/s
const SPAWN_X = 120;                 // where the agent drops in, clear of doors
const CHEST = 16;                    // bullet height above the feet
const INVULN = 1.6;                  // seconds of grace after a hit

const BULLET_SPEED = 300;
const BULLET_W = 7;
const BULLET_H = 3;
const FIRE_COOLDOWN = 0.28;
const MAX_PLAYER_SHOTS = 3;
const ENEMY_RELOAD = 1.5;
const ENEMY_RANGE = 300;             // how far down a corridor a guard shoots
const TURN_DELAY = 0.4;              // a guard cannot shoot as it spins around
const SAFE_SPAWN_GAP = 70;           // a guard never steps out this close to the agent
const NEARBY_SPAWN_CHANCE = 0.65;    // how often a guard is sent to the agent's floor
const GUARD_PATIENCE = 11;           // seconds a guard patrols an empty floor before it leaves

// --- scoring ---------------------------------------------------------------

const DOCS_PER_LEVEL = 4;
const DOC_POINTS = 500;
const KILL_POINTS = 150;
const LEVEL_BONUS = 1000;
const LIFE_BONUS = 100;
const START_LIVES = 3;

const BEST_KEY = 'elevatoraction-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = loadBest();
let doors = [];
let elevators = [];
let enemies = [];
let bullets = [];
let docsLeft = DOCS_PER_LEVEL;
let docsTotal = DOCS_PER_LEVEL;
let spawnCd = 0;
let autoRun = true;                  // the animation loop only simulates while true
let rngState = 1;
const keys = Object.create(null);

const player = {
    x: SPAWN_X,
    y: floorY(FLOORS),
    floor: FLOORS,
    dir: 1,
    riding: null,                    // the elevator car being ridden, or null
    fireCd: 0,
    invuln: 0,
};

// --- geometry helpers ------------------------------------------------------

function floorY(i) {
    return FLOOR1_Y - (i - 1) * FLOOR_H;
}

function shaftAt(x) {
    for (let i = 0; i < SHAFTS.length; i++) {
        const s = SHAFTS[i];
        if (x >= s.x && x <= s.x + s.w) return i;
    }
    return -1;
}

function shaftCenter(i) {
    return SHAFTS[i].x + SHAFTS[i].w / 2;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function playerRect() {
    return { x: player.x - PLAYER_W / 2, y: player.y - PLAYER_H, w: PLAYER_W, h: PLAYER_H };
}

function enemyRect(e) {
    return { x: e.x - PLAYER_W / 2, y: e.y - PLAYER_H, w: PLAYER_W, h: PLAYER_H };
}

function bulletRect(b) {
    return { x: b.x - BULLET_W / 2, y: b.y - BULLET_H / 2, w: BULLET_W, h: BULLET_H };
}

function doorRect(d) {
    return { x: d.x, y: floorY(d.floor) - DOOR_H, w: DOOR_W, h: DOOR_H };
}

function exitRect() {
    return { x: EXIT.x, y: floorY(EXIT.floor) - EXIT.h, w: EXIT.w, h: EXIT.h };
}

// --- deterministic randomness ---------------------------------------------

// A level is built from a seed derived from its number, so level 3 always has
// its documents behind the same doors — handy for players and for tests.
function seedRng(n) {
    rngState = (Math.imul(n, 2654435761) + 12345) >>> 0;
}

function rng() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// --- levels ----------------------------------------------------------------

function buildLevel(n) {
    seedRng(n * 101 + 7);

    const list = [];
    for (let f = 1; f <= FLOORS; f++) {
        DOOR_SLOTS.forEach((x, i) => {
            if (f === EXIT.floor && i === 0) return; // the exit stands in this slot
            list.push({ floor: f, x, kind: 'plain', opened: false });
        });
    }

    // Shuffle the upstairs doors and take the first one on each of four
    // different floors: the documents are always spread over the building.
    const upstairs = list.filter((d) => d.floor > 1);
    for (let i = upstairs.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = upstairs[i];
        upstairs[i] = upstairs[j];
        upstairs[j] = tmp;
    }
    const usedFloors = [];
    for (const d of upstairs) {
        if (usedFloors.length >= DOCS_PER_LEVEL) break;
        if (usedFloors.includes(d.floor)) continue;
        usedFloors.push(d.floor);
        d.kind = 'red';
    }

    return list;
}

function maxEnemies(n) {
    return Math.min(6, 2 + Math.floor((n - 1) / 2));
}

function spawnInterval(n) {
    return Math.max(1.2, 3.4 - 0.3 * (n - 1));
}

function enemySpeed(n) {
    return Math.min(115, 55 + 8 * (n - 1));
}

function docsRemaining() {
    return doors.filter((d) => d.kind === 'red' && !d.opened).length;
}

function startLevel() {
    doors = buildLevel(level);
    docsTotal = DOCS_PER_LEVEL;
    docsLeft = docsRemaining();
    enemies = [];
    bullets = [];
    elevators = SHAFTS.map((s, i) => {
        const f = i === 0 ? 1 : FLOORS - 2;
        return {
            shaft: i,
            x: s.x + s.w / 2,
            floor: f,
            y: floorY(f),
            targetFloor: f,
            moving: false,
        };
    });
    spawnCd = spawnInterval(level);
    resetPlayer();
}

function resetPlayer() {
    player.riding = null;
    player.floor = FLOORS;
    player.y = floorY(FLOORS);
    player.x = SPAWN_X;
    player.dir = 1;
    player.fireCd = 0;
    player.invuln = INVULN;
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    startLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    startLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function completeLevel() {
    score += LEVEL_BONUS + LIFE_BONUS * lives;
    saveBest();
    state = 'levelclear';
    showOverlay('BUILDING CLEARED', `Score ${score}`, 'Press Space for the next building');
    updateHud();
}

function hitPlayer() {
    if (state !== 'running' || player.invuln > 0) return false;
    lives -= 1;
    bullets = [];
    if (lives <= 0) {
        lives = 0;
        saveBest();
        state = 'gameover';
        showOverlay('GAME OVER', `Score ${score}`, 'Press Space to try again');
    } else {
        resetPlayer();
    }
    updateHud();
    return true;
}

// --- guards ----------------------------------------------------------------

function spawnEnemy(floor) {
    const plain = doors.filter((d) => d.floor === floor && d.kind === 'plain');
    // Never step out right on top of the agent: on its floor, use a door it has
    // room to react to.
    const roomy =
        floor === player.floor
            ? plain.filter((d) => Math.abs(d.x + DOOR_W / 2 - player.x) > SAFE_SPAWN_GAP)
            : plain;
    const options = roomy.length ? roomy : plain;
    const door = options.length
        ? options[Math.floor(rng() * options.length)]
        : { x: W / 2 - DOOR_W / 2 };
    const x = door.x + DOOR_W / 2;
    const e = {
        x,
        y: floorY(floor),
        floor,
        dir: player.x > x ? 1 : -1,
        fireCd: TURN_DELAY + 0.4,     // a guard takes a moment to draw
        speed: enemySpeed(level),
        patience: GUARD_PATIENCE,
    };
    enemies.push(e);
    return e;
}

// Most guards are sent to the agent's floor or the ones next to it, so the
// building keeps the pressure on wherever the agent hides; the rest come from
// anywhere.
function pickSpawnFloor() {
    if (rng() < NEARBY_SPAWN_CHANCE) {
        const offset = Math.floor(rng() * 3) - 1;   // -1, 0 or +1
        return clamp(player.floor + offset, 1, FLOORS);
    }
    return 1 + Math.floor(rng() * FLOORS);
}

// --- player actions --------------------------------------------------------

function fire() {
    if (state !== 'running') return null;
    if (player.fireCd > 0) return null;
    if (bullets.filter((b) => b.from === 'player').length >= MAX_PLAYER_SHOTS) return null;
    player.fireCd = FIRE_COOLDOWN;
    const b = {
        x: player.x + player.dir * 12,
        y: player.y - CHEST,
        vx: player.dir * BULLET_SPEED,
        from: 'player',
    };
    bullets.push(b);
    return b;
}

// Up/down either drives the car the agent is riding, boards the car standing
// on this floor, or calls a car that is parked somewhere else.
function useElevator(d) {
    if (state !== 'running') return false;

    if (player.riding) {
        const car = player.riding;
        if (car.moving) return false;
        const target = clamp(car.floor + d, 1, FLOORS);
        if (target === car.floor) return false;
        car.targetFloor = target;
        car.moving = true;
        return true;
    }

    const i = shaftAt(player.x);
    if (i === -1) return false;
    const car = elevators[i];
    if (car.moving) return false;

    if (car.floor === player.floor) {
        player.riding = car;
        player.x = car.x;
        const target = clamp(car.floor + d, 1, FLOORS);
        if (target !== car.floor) {
            car.targetFloor = target;
            car.moving = true;
        }
        return true;
    }

    car.targetFloor = player.floor;   // call it to this floor, empty
    car.moving = true;
    return true;
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

function onAction() {
    if (state === 'idle' || state === 'gameover') startGame();
    else if (state === 'levelclear') nextLevel();
    else if (state === 'running') fire();
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    const left = keys['ArrowLeft'] || keys['a'] || keys['A'];
    const right = keys['ArrowRight'] || keys['d'] || keys['D'];
    const dirInput = (right ? 1 : 0) - (left ? 1 : 0);

    if (player.fireCd > 0) player.fireCd = Math.max(0, player.fireCd - dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    moveCars(dt);

    if (player.riding) {
        const car = player.riding;
        player.x = car.x;
        player.y = car.y;
        if (!car.moving) {
            player.floor = car.floor;
            if (dirInput !== 0) {
                player.riding = null;     // step out onto the landing
                player.dir = dirInput;
            }
        }
    }

    if (!player.riding && dirInput !== 0) {
        player.x = clamp(player.x + dirInput * WALK_SPEED * dt, PLAYER_W / 2, W - PLAYER_W / 2);
        player.dir = dirInput;
    }

    if (!player.riding) {
        collectDocuments();
        if (
            state === 'running' &&
            player.floor === EXIT.floor &&
            docsLeft === 0 &&
            overlaps(playerRect(), exitRect())
        ) {
            completeLevel();
            return;
        }
    }

    spawnCd -= dt;
    if (spawnCd <= 0) {
        if (enemies.length < maxEnemies(level)) spawnEnemy(pickSpawnFloor());
        spawnCd = spawnInterval(level);
    }

    moveEnemies(dt);
    if (moveBullets(dt)) return;      // the agent was hit; the step is over

    if (player.invuln <= 0 && !player.riding) {
        const pr = playerRect();
        if (enemies.some((e) => e.floor === player.floor && overlaps(pr, enemyRect(e)))) {
            hitPlayer();
            return;
        }
    }

    updateHud();
}

function moveCars(dt) {
    elevators.forEach((car) => {
        if (!car.moving) return;
        const goal = floorY(car.targetFloor);
        const delta = goal - car.y;
        const stepAmt = CAR_SPEED * dt;
        if (Math.abs(delta) <= stepAmt) {
            car.y = goal;
            car.floor = car.targetFloor;
            car.moving = false;
        } else {
            car.y += Math.sign(delta) * stepAmt;
        }
    });
}

function collectDocuments() {
    const pr = playerRect();
    doors.forEach((d) => {
        if (d.kind !== 'red' || d.opened) return;
        if (d.floor !== player.floor) return;
        if (!overlaps(pr, doorRect(d))) return;
        d.opened = true;
        docsLeft = Math.max(0, docsLeft - 1);
        score += DOC_POINTS;
    });
}

function moveEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.fireCd -= dt;
        const sameFloor = e.floor === player.floor && !player.riding;

        // A guard that has patrolled an empty floor for long enough goes back
        // through a door, which frees its slot for one sent where the agent is.
        if (sameFloor) {
            e.patience = GUARD_PATIENCE;
        } else {
            e.patience = (e.patience === undefined ? GUARD_PATIENCE : e.patience) - dt;
            if (e.patience <= 0) {
                enemies.splice(i, 1);
                continue;
            }
        }

        if (sameFloor) {
            const want = player.x > e.x ? 1 : -1;
            if (want !== e.dir) {
                e.dir = want;
                e.fireCd = Math.max(e.fireCd, TURN_DELAY);
            }
        }

        if (
            sameFloor &&
            e.fireCd <= 0 &&
            Math.sign(player.x - e.x) === e.dir &&
            Math.abs(player.x - e.x) < ENEMY_RANGE
        ) {
            bullets.push({
                x: e.x + e.dir * 12,
                y: e.y - CHEST,
                vx: e.dir * BULLET_SPEED,
                from: 'enemy',
            });
            e.fireCd = ENEMY_RELOAD;
        }

        e.x += e.dir * e.speed * dt;
        if (e.x < PLAYER_W / 2) {
            e.x = PLAYER_W / 2;
            e.dir = 1;
        } else if (e.x > W - PLAYER_W / 2) {
            e.x = W - PLAYER_W / 2;
            e.dir = -1;
        }
    }
}

// Returns true when the agent was hit, because hitPlayer() rebuilds the world
// underneath this loop.
function moveBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < -12 || b.x > W + 12) {
            bullets.splice(i, 1);
            continue;
        }
        const br = bulletRect(b);
        if (b.from === 'player') {
            const j = enemies.findIndex((e) => overlaps(br, enemyRect(e)));
            if (j >= 0) {
                enemies.splice(j, 1);
                score += KILL_POINTS;
                bullets.splice(i, 1);
            }
        } else if (player.invuln <= 0 && overlaps(br, playerRect())) {
            bullets.splice(i, 1);
            hitPlayer();
            return true;
        }
    }
    return false;
}

// --- HUD and overlay -------------------------------------------------------

const els = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    docs: document.getElementById('docs'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    sub: document.getElementById('overlay-sub'),
    overlayScore: document.getElementById('overlay-score'),
    start: document.getElementById('btn-start'),
};

function updateHud() {
    els.score.textContent = String(score);
    els.level.textContent = String(level);
    els.lives.textContent = String(lives);
    els.docs.textContent = String(docsLeft);
    els.best.textContent = String(best);
}

function showOverlay(title, scoreText, sub) {
    els.title.textContent = title;
    els.overlayScore.textContent = scoreText || '';
    els.sub.textContent = sub || '';
    els.overlay.classList.add('visible');
}

function hideOverlay() {
    els.overlay.classList.remove('visible');
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

// --- rendering -------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackdrop();
    drawShafts();
    drawFloors();
    doors.forEach(drawDoor);
    if (doors.length) drawExit();
    elevators.forEach(drawCar);
    enemies.forEach(drawGuard);
    bullets.forEach(drawBullet);
    if (state !== 'idle') drawAgent();
}

function drawBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1222');
    sky.addColorStop(1, '#050811');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // the building face
    ctx.fillStyle = '#121a2c';
    ctx.fillRect(8, floorY(FLOORS) - FLOOR_H + SLAB_H, W - 16, STREET_Y - (floorY(FLOORS) - FLOOR_H));

    // roof and pavement
    ctx.fillStyle = '#1d2740';
    ctx.fillRect(8, floorY(FLOORS) - FLOOR_H, W - 16, SLAB_H);
    ctx.fillStyle = '#0a0f1b';
    ctx.fillRect(0, STREET_Y, W, H - STREET_Y);
    ctx.strokeStyle = '#223049';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, STREET_Y);
    ctx.lineTo(W, STREET_Y);
    ctx.stroke();
}

function drawShafts() {
    SHAFTS.forEach((s) => {
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(s.x, floorY(FLOORS) - FLOOR_H + SLAB_H, s.w, STREET_Y - floorY(FLOORS) + FLOOR_H - SLAB_H);
        ctx.strokeStyle = '#24314d';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x + 0.5, floorY(FLOORS) - FLOOR_H + SLAB_H, s.w - 1, STREET_Y - floorY(FLOORS) + FLOOR_H - SLAB_H);
    });
}

function drawFloors() {
    for (let f = 1; f <= FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = '#26324c';
        ctx.fillRect(8, y, W - 16, SLAB_H);
        ctx.fillStyle = '#334160';
        ctx.fillRect(8, y, W - 16, 2);
        // The shafts cut through the slab, but each floor keeps a thin landing
        // inside the shaft — that is the ledge the agent waits on for a car.
        SHAFTS.forEach((s) => {
            ctx.fillStyle = '#0b1220';
            ctx.fillRect(s.x, y, s.w, SLAB_H);
            ctx.fillStyle = '#1b2742';
            ctx.fillRect(s.x, y, s.w, 2);
        });
    }
}

function drawDoor(d) {
    const r = doorRect(d);
    if (d.kind === 'red' && !d.opened) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        ctx.fillStyle = '#fca5a5';
        ctx.fillRect(r.x + r.w / 2 - 5, r.y + r.h / 2 - 7, 10, 14);
    } else if (d.opened) {
        ctx.fillStyle = '#1b2436';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = '#3f4f72';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    } else {
        ctx.fillStyle = '#1f2b42';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#2c3b59';
        ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        ctx.fillStyle = '#7b89a6';
        ctx.fillRect(r.x + r.w - 9, r.y + r.h / 2 - 1, 4, 3);
    }
}

function drawExit() {
    const r = exitRect();
    const open = docsLeft === 0;
    ctx.fillStyle = open ? '#22c55e' : '#14532d';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = open ? '#064e3b' : '#0b2d1a';
    ctx.fillRect(r.x + 4, r.y + 6, r.w - 8, r.h - 6);
    ctx.fillStyle = open ? '#bbf7d0' : '#4b6c57';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', r.x + r.w / 2, r.y + 4 + 10);
    ctx.textAlign = 'left';
}

function drawCar(car) {
    const x = car.x - CAR_W / 2;
    const y = car.y - CAR_H;
    const shaftTop = floorY(FLOORS) - FLOOR_H + SLAB_H;

    // the cable the car hangs from
    ctx.strokeStyle = '#2a3a5a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(car.x, shaftTop);
    ctx.lineTo(car.x, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.fillRect(x, y, CAR_W, CAR_H);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CAR_W - 2, CAR_H - 2);

    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x, y, CAR_W, 4);                 // roof
    ctx.fillRect(x, car.y - 4, CAR_W, 4);         // cab floor
    ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.fillRect(car.x - 1, y + 6, 2, CAR_H - 12); // the gap between the doors
}

function drawFigure(x, y, dir, body, head) {
    const left = x - PLAYER_W / 2;
    const top = y - PLAYER_H;
    ctx.fillStyle = body;
    ctx.fillRect(left + 2, top + 9, PLAYER_W - 4, PLAYER_H - 13);   // torso
    ctx.fillRect(left + 3, y - 5, 4, 5);                            // legs
    ctx.fillRect(left + PLAYER_W - 7, y - 5, 4, 5);
    ctx.fillStyle = head;
    ctx.fillRect(left + 4, top, PLAYER_W - 8, 8);                   // head
    ctx.fillStyle = body;
    const gunX = dir > 0 ? left + PLAYER_W - 2 : left - 6;
    ctx.fillRect(gunX, top + 13, 8, 3);                             // arm + gun
}

function drawAgent() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    drawFigure(player.x, player.y, player.dir, '#e2e8f5', '#f8b4a0');
}

function drawGuard(e) {
    drawFigure(e.x, e.y, e.dir, '#ef4444', '#f8b4a0');
}

function drawBullet(b) {
    const r = bulletRect(b);
    ctx.fillStyle = b.from === 'player' ? '#fde68a' : '#fca5a5';
    ctx.fillRect(r.x, r.y, r.w, r.h);
}

// --- input -----------------------------------------------------------------

const HELD_KEYS = [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

window.addEventListener('keydown', (e) => {
    if (HELD_KEYS.includes(e.key)) e.preventDefault();
    keys[e.key] = true;

    const low = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (e.key === ' ') {
        onAction();
    } else if (low === 'p') {
        togglePause();
    } else if (e.key === 'ArrowUp' || low === 'w') {
        useElevator(1);
    } else if (e.key === 'ArrowDown' || low === 's') {
        useElevator(-1);
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

els.start.addEventListener('click', () => {
    els.start.blur();
    if (state === 'levelclear') nextLevel();
    else if (state !== 'running' && state !== 'paused') startGame();
});

// --- main loop -------------------------------------------------------------

let lastT = 0;
let acc = 0;

function frame(t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    if (autoRun) {
        acc += dt;
        let guard = 0;
        while (acc >= DT && guard++ < 8) {
            physicsStep(DT);
            acc -= DT;
        }
    }
    draw();
    requestAnimationFrame(frame);
}

updateHud();
requestAnimationFrame(frame);
