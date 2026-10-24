// Elevator Action — raid every red door on the way down a ten-storey building
// and escape by the getaway car parked in the basement.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, player, enemies, bullets, cars,
// doors, stairs) is kept at the top level on purpose: the Playwright suite
// drives the game through exactly these names. See DESIGN.md for the rules and
// the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 480
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const FLOORS = 10;                   // index 0 = top floor, FLOORS - 1 = basement
const FLOOR_H = 76;                  // height of one floor strip
const BUILDING_H = FLOORS * FLOOR_H; // 760 — taller than the canvas, so it scrolls
const WALL = 16;                     // outer wall thickness
const SLAB = 7;                      // thickness of the floor slab under the feet

const PLAYER_W = 18;
const PLAYER_H = 34;
const CROUCH_H = 18;                 // short enough to duck under torso-height fire
const ENEMY_W = 18;
const ENEMY_H = 32;
const TORSO = 24;                    // height bullets fly at, above the feet

const WALK_SPEED = 118;              // px/s on foot
const CAR_SPEED = 72;                // px/s for a ridden elevator car
const CLIMB_SPEED = 62;              // px/s in a stairwell
const ENEMY_WALK = 52;               // px/s chasing the player
const BULLET_SPEED = 320;

const SHAFT_W = 56;
const CAR_W = 44;
const BOARD_HALF = 14;               // how centred you must be to board a car
const CALL_DX = 36;                  // how close to a shaft the call button works
const SNAP = 3;                      // "level with the floor" tolerance
const DOOR_W = 28;
const STAIR_W = 20;
const STAIR_SNAP = 12;               // how close to a stairwell you must stand

const SHOT_COOLDOWN = 0.35;          // seconds between player shots
const FIRE_INTERVAL = 1.1;           // seconds between agent shots
const FIRE_RANGE = 260;
const STOP_DX = 46;                  // agents stop this close and shoot
const SPAWN_INTERVAL = 2.4;
const SPAWN_MIN_DX = 110;            // agents never step out this close to you
const MAX_ENEMIES = 4;
const INVULN_TIME = 1.5;

const DOC_TOTAL = 5;
const DOC_POINTS = 500;
const ENEMY_POINTS = 100;
const ESCAPE_BONUS = 2000;
const LIFE_BONUS = 250;
const ESCAPE_X = 60;                 // getaway car sits at the basement's left edge
const LIVES_START = 3;

const DOOR_SLOTS = [56, 104, 264, 312, 360, 544, 592];
const STAIR_SLOTS = [128, 224, 412, 504];
const SHAFT_XS = [180, 460];

const BEST_KEY = 'elevatoraction-best';

const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
const RIGHT_KEYS = ['ArrowRight', 'KeyD'];
const UP_KEYS = ['ArrowUp', 'KeyW'];
const DOWN_KEYS = ['ArrowDown', 'KeyS'];
const SHOOT_KEYS = ['Space'];
const CALL_KEYS = ['KeyE', 'Enter'];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | gameover | won
let score = 0;
let lives = LIVES_START;
let level = 1;
let docsCollected = 0;
let best = loadBest();

let shafts = [];
let cars = [];
let doors = [];
let stairs = [];
let enemies = [];
let bullets = [];
let sparks = [];                     // short-lived hit flashes, cosmetic only

let spawnTimer = 0;
let camY = 0;
let autoRun = true;                  // the animation loop only simulates while true
let rng = mulberry32(1);

const keys = Object.create(null);

const player = {
    x: W / 2,
    y: FLOOR_H,
    dir: 1,
    mode: 'floor',                   // floor | ladder | elevator
    floor: 0,
    car: -1,
    stair: -1,
    crouch: false,
    invuln: 0,
    shotCd: 0,
};

// --- geometry --------------------------------------------------------------

// Feet level of a floor, in world coordinates.
function floorY(i) {
    return (i + 1) * FLOOR_H;
}

// How a lift panel would label the floor: the top floor is the highest number
// and the bottom one is the basement.
function floorLabel(i) {
    return i === FLOORS - 1 ? 'B' : String(FLOORS - 1 - i);
}

function playerHeight() {
    return player.crouch ? CROUCH_H : PLAYER_H;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// The floor a given feet level belongs to, or -1 when it is between floors.
function levelFloor(y) {
    for (let i = 0; i < FLOORS; i++) {
        if (Math.abs(y - floorY(i)) <= SNAP) return i;
    }
    return -1;
}

// A stairwell whose `end` ('top' or 'bottom') meets this floor at this x.
function stairAt(x, feet, end) {
    for (const s of stairs) {
        if (Math.abs(s[end] - feet) > SNAP) continue;
        if (Math.abs(s.x - x) <= STAIR_SNAP) return s;
    }
    return null;
}

// Small deterministic PRNG so a level number always builds the same building.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- level building --------------------------------------------------------

function buildLevel() {
    rng = mulberry32(level * 7919 + 13);

    shafts = SHAFT_XS.map((x) => ({ x, w: SHAFT_W }));
    cars = SHAFT_XS.map((x, i) => ({ x, y: floorY(i === 0 ? 0 : 4), w: CAR_W }));

    doors = [];
    for (let f = 0; f < FLOORS - 1; f++) {
        for (const x of DOOR_SLOTS) {
            doors.push({ floor: f, x, red: false, open: false, flash: 0 });
        }
    }

    // Spread the five documents over distinct floors so the descent cannot be
    // short-circuited by clearing one floor.
    const floorsPool = [];
    for (let f = 0; f < FLOORS - 1; f++) floorsPool.push(f);
    for (let i = floorsPool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [floorsPool[i], floorsPool[j]] = [floorsPool[j], floorsPool[i]];
    }
    for (let i = 0; i < DOC_TOTAL; i++) {
        const f = floorsPool[i];
        const slot = DOOR_SLOTS[Math.floor(rng() * DOOR_SLOTS.length)];
        const door = doors.find((d) => d.floor === f && d.x === slot);
        door.red = true;
    }

    // One guaranteed stairwell between every adjacent pair of floors, plus a
    // second one now and then so a floor is not a single choke point.
    stairs = [];
    for (let f = 0; f < FLOORS - 1; f++) {
        const order = STAIR_SLOTS.slice();
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const count = rng() < 0.45 ? 2 : 1;
        for (let i = 0; i < count; i++) {
            stairs.push({
                x: order[i],
                top: floorY(f),
                bottom: floorY(f + 1),
                upper: f,
                lower: f + 1,
            });
        }
    }
}

// --- lifecycle -------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = LIVES_START;
    docsCollected = 0;
    level = 1;
    buildLevel();

    enemies = [];
    bullets = [];
    sparks = [];
    spawnTimer = 0;

    player.x = W / 2;
    player.y = floorY(0);
    player.dir = 1;
    player.mode = 'floor';
    player.floor = 0;
    player.car = -1;
    player.stair = -1;
    player.crouch = false;
    player.invuln = INVULN_TIME;
    player.shotCd = 0;

    for (const code of Object.keys(keys)) keys[code] = false;

    hideOverlay();
    updateHud();
}

function loseLife() {
    lives -= 1;
    enemies = [];
    bullets = [];
    player.crouch = false;
    player.invuln = INVULN_TIME;
    sparks.push({ x: player.x, y: player.y - PLAYER_H / 2, life: 0.5 });

    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Final score ${score}`, 'Press Space to try again');
    }
    updateHud();
}

function escape() {
    state = 'won';
    score += ESCAPE_BONUS + lives * LIFE_BONUS;
    saveBest();
    showOverlay('ESCAPED!', `Final score ${score}`, 'Press Space to play again');
    updateHud();
}

// Space, a click and the Start button all mean "do the obvious thing here".
function advance() {
    if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// --- input helpers ---------------------------------------------------------

function held(list) {
    return list.some((code) => keys[code]);
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.shotCd > 0) player.shotCd = Math.max(0, player.shotCd - dt);

    movePlayer(dt);
    playerShooting(dt);
    moveBullets(dt);
    moveEnemies(dt);
    spawnAgents(dt);
    checkDoors();
    checkContact();
    checkEscape();

    for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i].life -= dt;
        if (sparks[i].life <= 0) sparks.splice(i, 1);
    }
    for (const d of doors) if (d.flash > 0) d.flash = Math.max(0, d.flash - dt);

    updateHud();
}

function movePlayer(dt) {
    const left = held(LEFT_KEYS);
    const right = held(RIGHT_KEYS);
    const up = held(UP_KEYS);
    const down = held(DOWN_KEYS);

    if (player.mode === 'elevator') rideCar(dt, left, right, up, down);
    else if (player.mode === 'ladder') climbStairs(dt, up, down);
    else walkFloor(dt, left, right, up, down);
}

function walkFloor(dt, left, right, up, down) {
    const feet = floorY(player.floor);
    player.y = feet;
    player.crouch = false;

    if (left !== right) player.dir = left ? -1 : 1;

    // The call key summons a car in the shaft beside you. It is deliberately
    // not Up or Down: a stairwell slot can sit well inside the call range, and
    // sharing the key would leave only a few pixels where calling is possible.
    if (held(CALL_KEYS)) {
        const sh = shaftBeside(player.x);
        if (sh) callCar(sh, feet, dt);
    }

    // Down means: take the stairs if you are standing on them, else crouch.
    if (down !== up) {
        const s = stairAt(player.x, feet, down ? 'top' : 'bottom');
        if (s) {
            enterStairs(s, down ? 1 : -1);
            return;
        }
        if (down) player.crouch = true;
    }

    if (player.crouch || left === right) return;

    const sign = left ? -1 : 1;
    let nx = player.x + sign * WALK_SPEED * dt;
    nx = clamp(nx, WALL + PLAYER_W / 2, W - WALL - PLAYER_W / 2);

    // A shaft is a hole in the floor unless a car's roof is level with it.
    for (const sh of shafts) {
        if (carLevelWith(sh, feet) >= 0) continue;
        const l = sh.x - sh.w / 2;
        const r = sh.x + sh.w / 2;
        if (sign > 0 && player.x <= l) nx = Math.min(nx, l - PLAYER_W / 2);
        else if (sign < 0 && player.x >= r) nx = Math.max(nx, r + PLAYER_W / 2);
    }
    player.x = nx;

    // Walking onto the roof of a level car boards it.
    for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (Math.abs(c.y - feet) <= SNAP && Math.abs(player.x - c.x) <= BOARD_HALF) {
            player.mode = 'elevator';
            player.car = i;
            player.y = c.y;
            return;
        }
    }
}

// The shaft whose doorway the player is standing next to, if any.
function shaftBeside(x) {
    for (const sh of shafts) {
        const l = sh.x - sh.w / 2;
        const r = sh.x + sh.w / 2;
        if (x >= l - CALL_DX && x <= r + CALL_DX) return sh;
    }
    return null;
}

// Summon the nearest car in a shaft to this floor. Returns false when there is
// nothing to move: no car in that shaft, or one already level with the floor.
function callCar(shaft, feet, dt) {
    let idx = -1;
    let bestGap = Infinity;
    for (let i = 0; i < cars.length; i++) {
        if (cars[i].x !== shaft.x) continue;
        const gap = Math.abs(cars[i].y - feet);
        if (gap < bestGap) {
            bestGap = gap;
            idx = i;
        }
    }
    if (idx < 0) return false;

    const c = cars[idx];
    if (Math.abs(c.y - feet) <= SNAP) {
        c.y = feet;
        return false;
    }

    const dir = c.y < feet ? 1 : -1;
    c.y += dir * CAR_SPEED * dt;
    if ((dir > 0 && c.y > feet) || (dir < 0 && c.y < feet)) c.y = feet;
    c.y = clamp(c.y, floorY(0), floorY(FLOORS - 1));
    return true;
}

// The index of a car in this shaft whose roof is level with `feet`, else -1.
function carLevelWith(shaft, feet) {
    for (let i = 0; i < cars.length; i++) {
        if (cars[i].x !== shaft.x) continue;
        if (Math.abs(cars[i].y - feet) <= SNAP) return i;
    }
    return -1;
}

function rideCar(dt, left, right, up, down) {
    const c = cars[player.car];
    if (!c) {
        player.mode = 'floor';
        return;
    }

    if (up !== down) {
        c.y += (down ? 1 : -1) * CAR_SPEED * dt;
        c.y = clamp(c.y, floorY(0), floorY(FLOORS - 1));
    }
    player.y = c.y;
    player.crouch = false;

    const atFloor = levelFloor(c.y);
    if (atFloor >= 0) player.floor = atFloor;

    if (left === right) return;

    const sign = left ? -1 : 1;
    player.dir = sign;
    const nx = player.x + sign * WALK_SPEED * dt;

    if (Math.abs(nx - c.x) <= CAR_W / 2) {
        player.x = nx;
        return;
    }

    if (atFloor >= 0) {
        // Step out onto the floor the car is level with.
        player.mode = 'floor';
        player.car = -1;
        player.floor = atFloor;
        player.y = floorY(atFloor);
        player.x = clamp(nx, WALL + PLAYER_W / 2, W - WALL - PLAYER_W / 2);
    } else {
        player.x = c.x + Math.sign(nx - c.x) * (CAR_W / 2);
    }
}

function enterStairs(s, dir) {
    player.mode = 'ladder';
    player.stair = stairs.indexOf(s);
    player.x = s.x;
    player.crouch = false;
    player.y = dir > 0 ? s.top + 1 : s.bottom - 1;
}

function climbStairs(dt, up, down) {
    const s = stairs[player.stair];
    if (!s) {
        player.mode = 'floor';
        return;
    }

    player.x = s.x;
    player.crouch = false;

    if (down && !up) player.y = Math.min(s.bottom, player.y + CLIMB_SPEED * dt);
    else if (up && !down) player.y = Math.max(s.top, player.y - CLIMB_SPEED * dt);

    if (player.y >= s.bottom) {
        player.y = s.bottom;
        player.mode = 'floor';
        player.floor = s.lower;
        player.stair = -1;
    } else if (player.y <= s.top) {
        player.y = s.top;
        player.mode = 'floor';
        player.floor = s.upper;
        player.stair = -1;
    }
}

function playerShooting() {
    if (!held(SHOOT_KEYS) || player.shotCd > 0 || player.mode === 'ladder') return;
    player.shotCd = SHOT_COOLDOWN;
    bullets.push({
        x: player.x + player.dir * 14,
        y: player.y - (player.crouch ? 10 : TORSO),
        vx: player.dir * BULLET_SPEED,
        from: 'player',
    });
}

function moveBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;

        if (b.x < -20 || b.x > W + 20) {
            bullets.splice(i, 1);
            continue;
        }

        if (b.from === 'player') {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (Math.abs(b.x - e.x) > ENEMY_W / 2 + 3) continue;
                if (b.y < e.y - ENEMY_H || b.y > e.y) continue;
                enemies.splice(j, 1);
                bullets.splice(i, 1);
                score += ENEMY_POINTS;
                sparks.push({ x: e.x, y: e.y - ENEMY_H / 2, life: 0.35 });
                break;
            }
        } else if (player.invuln <= 0) {
            const top = player.y - playerHeight();
            if (Math.abs(b.x - player.x) <= PLAYER_W / 2 + 3 && b.y >= top && b.y <= player.y) {
                bullets.splice(i, 1);
                loseLife();
                return;
            }
        }
    }
}

function makeEnemy(floor, x) {
    return {
        x,
        y: floorY(floor),
        floor,
        dir: -1,
        cooldown: FIRE_INTERVAL * 0.5,
    };
}

function moveEnemies(dt) {
    for (const e of enemies) {
        if (e.cooldown > 0) e.cooldown -= dt;

        const sameLevel = Math.abs(e.y - player.y) <= SNAP;
        if (sameLevel) {
            const dx = player.x - e.x;
            e.dir = dx >= 0 ? 1 : -1;
            if (Math.abs(dx) > STOP_DX) e.x += e.dir * ENEMY_WALK * dt;
            if (e.cooldown <= 0 && Math.abs(dx) <= FIRE_RANGE) {
                e.cooldown = FIRE_INTERVAL;
                bullets.push({
                    x: e.x + e.dir * 14,
                    y: e.y - TORSO,
                    vx: e.dir * BULLET_SPEED,
                    from: 'enemy',
                });
            }
        } else {
            e.x += e.dir * ENEMY_WALK * 0.6 * dt;
            if (e.x <= WALL + ENEMY_W / 2 || e.x >= W - WALL - ENEMY_W / 2) e.dir *= -1;
        }
        e.x = clamp(e.x, WALL + ENEMY_W / 2, W - WALL - ENEMY_W / 2);
    }
}

function spawnAgents(dt) {
    spawnTimer += dt;
    if (spawnTimer < SPAWN_INTERVAL || enemies.length >= MAX_ENEMIES) return;
    spawnTimer = 0;

    const options = doors.filter(
        (d) =>
            !d.red &&
            Math.abs(d.floor - player.floor) <= 1 &&
            Math.abs(d.x - player.x) >= SPAWN_MIN_DX
    );
    if (!options.length) return;

    const d = options[Math.floor(rng() * options.length)];
    const e = makeEnemy(d.floor, d.x);
    e.dir = d.x > player.x ? -1 : 1;
    enemies.push(e);
    d.flash = 0.45;
}

function collectDoor(d) {
    if (!d || !d.red || d.open) return;
    d.open = true;
    docsCollected += 1;
    score += DOC_POINTS;
    sparks.push({ x: d.x, y: floorY(d.floor) - 30, life: 0.4 });
    updateHud();
}

function checkDoors() {
    if (player.mode !== 'floor') return;
    for (const d of doors) {
        if (d.floor !== player.floor || !d.red || d.open) continue;
        if (Math.abs(d.x - player.x) <= DOOR_W / 2) collectDoor(d);
    }
}

function checkContact() {
    if (player.invuln > 0) return;
    for (const e of enemies) {
        if (Math.abs(e.x - player.x) > (PLAYER_W + ENEMY_W) / 2) continue;
        if (Math.abs(e.y - player.y) >= 8) continue;
        loseLife();
        return;
    }
}

function checkEscape() {
    if (state !== 'running' || docsCollected < DOC_TOTAL) return;
    if (player.mode !== 'floor' || player.floor !== FLOORS - 1) return;
    if (player.x <= ESCAPE_X) escape();
}

// --- HUD / overlay ---------------------------------------------------------

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== value) el.textContent = value;
}

function updateHud() {
    setText('score', String(score));
    setText('docs', `${docsCollected}/${DOC_TOTAL}`);
    setText('lives', String(lives));
    setText('floor', floorLabel(clamp(player.floor, 0, FLOORS - 1)));
    setText('best', String(best));
}

function showOverlay(title, scoreLine, sub) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = scoreLine || '';
    document.getElementById('overlay-sub').textContent = sub || '';
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
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
        /* private browsing — the run just will not be remembered */
    }
}

// --- rendering -------------------------------------------------------------

function draw() {
    camY = clamp(player.y - H * 0.62, 0, BUILDING_H - H);

    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(0, -camY);

    drawBuilding();
    drawShafts();
    drawStairs();
    drawDoors();
    drawGetawayCar();
    drawEnemies();
    drawPlayer();
    drawBullets();
    drawSparks();

    ctx.restore();

    drawFloorStrip();
}

function drawBuilding() {
    const top = camY - 20;
    const bottom = camY + H + 20;

    ctx.fillStyle = '#121a2e';
    ctx.fillRect(0, top, W, bottom - top);

    // Outer walls.
    ctx.fillStyle = '#1d2740';
    ctx.fillRect(0, top, WALL, bottom - top);
    ctx.fillRect(W - WALL, top, WALL, bottom - top);

    for (let f = 0; f < FLOORS; f++) {
        const feet = floorY(f);
        if (feet < top - FLOOR_H || feet > bottom + FLOOR_H) continue;

        // Wallpaper band and skirting for each floor.
        ctx.fillStyle = f === FLOORS - 1 ? '#0d1322' : '#16203a';
        ctx.fillRect(WALL, feet - FLOOR_H + SLAB, W - WALL * 2, FLOOR_H - SLAB);

        ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.lineWidth = 1;
        for (let x = WALL + 24; x < W - WALL; x += 48) {
            ctx.beginPath();
            ctx.moveTo(x, feet - FLOOR_H + SLAB + 6);
            ctx.lineTo(x, feet - 10);
            ctx.stroke();
        }

        // The slab the player stands on.
        ctx.fillStyle = '#2b3a5c';
        ctx.fillRect(WALL, feet, W - WALL * 2, SLAB);
        ctx.fillStyle = 'rgba(125, 211, 252, 0.18)';
        ctx.fillRect(WALL, feet, W - WALL * 2, 2);

        // Floor number stencilled on the back wall.
        ctx.fillStyle = 'rgba(125, 138, 165, 0.35)';
        ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(floorLabel(f), WALL + 8, feet - 12);
    }
}

function drawShafts() {
    for (const sh of shafts) {
        const l = sh.x - sh.w / 2;
        ctx.fillStyle = '#070b14';
        ctx.fillRect(l, 0, sh.w, BUILDING_H);
        ctx.strokeStyle = '#223152';
        ctx.lineWidth = 2;
        ctx.strokeRect(l, 0, sh.w, BUILDING_H);

        // Guide cable.
        ctx.strokeStyle = 'rgba(125, 138, 165, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sh.x, 0);
        ctx.lineTo(sh.x, BUILDING_H);
        ctx.stroke();
    }

    // Call plates beside each doorway, lit when the player is close enough to
    // use them.
    const beside = player.mode === 'floor' ? shaftBeside(player.x) : null;
    for (const sh of shafts) {
        const lit = beside === sh;
        for (let f = 0; f < FLOORS; f++) {
            const feet = floorY(f);
            const onThisFloor = lit && Math.abs(player.y - feet) <= SNAP;
            for (const side of [-1, 1]) {
                const px = sh.x + side * (sh.w / 2 + 7);
                ctx.fillStyle = onThisFloor ? '#38bdf8' : '#2b3a5c';
                ctx.fillRect(px - 3, feet - 26, 6, 9);
                ctx.fillStyle = onThisFloor ? '#e0f2fe' : '#16203a';
                ctx.fillRect(px - 2, feet - 24, 4, 2);
            }
        }
    }

    for (const c of cars) {
        const l = c.x - CAR_W / 2;
        ctx.fillStyle = '#334867';
        ctx.fillRect(l, c.y - 44, CAR_W, 44);
        ctx.fillStyle = '#54709a';
        ctx.fillRect(l, c.y - 6, CAR_W, 6);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.fillRect(l + 5, c.y - 38, CAR_W - 10, 24);
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1;
        ctx.strokeRect(l + 0.5, c.y - 44.5, CAR_W - 1, 44);
    }
}

function drawStairs() {
    for (const s of stairs) {
        ctx.fillStyle = 'rgba(8, 12, 22, 0.9)';
        ctx.fillRect(s.x - STAIR_W / 2, s.top, STAIR_W, FLOOR_H);
        ctx.strokeStyle = '#8aa0c8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - STAIR_W / 2 + 2, s.top);
        ctx.lineTo(s.x - STAIR_W / 2 + 2, s.bottom);
        ctx.moveTo(s.x + STAIR_W / 2 - 2, s.top);
        ctx.lineTo(s.x + STAIR_W / 2 - 2, s.bottom);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(138, 160, 200, 0.75)';
        ctx.lineWidth = 2;
        for (let y = s.top + 8; y < s.bottom; y += 12) {
            ctx.beginPath();
            ctx.moveTo(s.x - STAIR_W / 2 + 2, y);
            ctx.lineTo(s.x + STAIR_W / 2 - 2, y);
            ctx.stroke();
        }
    }
}

function drawDoors() {
    for (const d of doors) {
        const feet = floorY(d.floor);
        const h = 44;
        const x = d.x - DOOR_W / 2;
        const y = feet - h;

        if (d.red) {
            ctx.fillStyle = d.open ? '#3f1d2a' : '#ef4444';
        } else {
            ctx.fillStyle = d.flash > 0 ? '#8aa0c8' : '#3a4a6d';
        }
        ctx.fillRect(x, y, DOOR_W, h);

        ctx.strokeStyle = 'rgba(5, 7, 13, 0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 0.5, y + 0.5, DOOR_W - 1, h - 1);

        if (d.red && !d.open) {
            ctx.fillStyle = '#fee2e2';
            ctx.fillRect(d.x - 4, y + 16, 8, 10);
        } else if (!d.red) {
            ctx.fillStyle = '#9fb2d6';
            ctx.fillRect(d.x + 8, y + h / 2 - 2, 4, 4);
        }
    }
}

function drawGetawayCar() {
    const feet = floorY(FLOORS - 1);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(WALL + 6, feet - 20, 46, 14);
    ctx.fillRect(WALL + 16, feet - 28, 24, 10);
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(WALL + 18, feet - 5, 5, 0, Math.PI * 2);
    ctx.arc(WALL + 42, feet - 5, 5, 0, Math.PI * 2);
    ctx.fill();

    const ready = docsCollected >= DOC_TOTAL;
    ctx.fillStyle = ready ? '#34d399' : 'rgba(125, 138, 165, 0.7)';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(ready ? 'GO!' : `${DOC_TOTAL - docsCollected} left`, WALL + 62, feet - 10);
}

function drawFigure(x, feet, h, dir, coat, trim) {
    const headR = 5;
    const headY = feet - h + headR;
    const bodyTop = headY + headR;
    const legTop = feet - Math.min(8, h * 0.3);

    // Coat.
    ctx.fillStyle = coat;
    ctx.fillRect(x - PLAYER_W / 2, bodyTop, PLAYER_W, legTop - bodyTop);

    // Legs, planted slightly apart so a figure reads as a person at a glance.
    ctx.fillStyle = trim;
    ctx.fillRect(x - PLAYER_W / 2 + 1, legTop, 5, feet - legTop);
    ctx.fillRect(x + PLAYER_W / 2 - 6, legTop, 5, feet - legTop);

    // Head and hat.
    ctx.fillStyle = '#f3d6b5';
    ctx.beginPath();
    ctx.arc(x, headY, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trim;
    ctx.fillRect(x - headR - 3, headY - headR, headR * 2 + 6, 3);
    ctx.fillRect(x - headR + 1, headY - headR - 3, headR * 2 - 2, 3);

    // Eye line, so you can tell which way the figure is facing.
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x + (dir > 0 ? 1 : -3), headY - 1, 2, 2);

    // Gun arm, held at the height bullets fly.
    const armY = feet - Math.min(h - 2, TORSO);
    ctx.fillStyle = coat;
    ctx.fillRect(x - (dir > 0 ? 0 : PLAYER_W / 2 + 9), armY, PLAYER_W / 2 + 9, 4);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x + (dir > 0 ? PLAYER_W / 2 + 5 : -PLAYER_W / 2 - 11), armY, 6, 3);
}

function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    drawFigure(player.x, player.y, playerHeight(), player.dir, '#38bdf8', '#dbeafe');
}

function drawEnemies() {
    for (const e of enemies) {
        drawFigure(e.x, e.y, ENEMY_H, e.dir, '#9f1239', '#111827');
    }
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.from === 'player' ? '#fef9c3' : '#fca5a5';
        ctx.fillRect(b.x - 3, b.y - 1.5, 6, 3);
    }
}

function drawSparks() {
    for (const s of sparks) {
        const r = 14 * (1 - s.life);
        ctx.strokeStyle = `rgba(254, 240, 138, ${Math.max(0, s.life * 2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 + r, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// A thin strip at the top of the viewport: which floor, and how the raid is
// going. Drawn in screen space, over the scrolling building.
function drawFloorStrip() {
    ctx.fillStyle = 'rgba(5, 7, 13, 0.72)';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = '#7d8aa5';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`FLOOR ${floorLabel(clamp(player.floor, 0, FLOORS - 1))}`, 10, 15);
    ctx.textAlign = 'center';
    ctx.fillText(`DOCUMENTS ${docsCollected}/${DOC_TOTAL}`, W / 2, 15);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('♦'.repeat(Math.max(0, lives)), W - 10, 15);
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
    }
    keys[e.code] = true;

    if (e.code === 'KeyP') togglePause();
    if (e.code === 'Space' && state !== 'running' && state !== 'paused') advance();
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', () => advance());
canvas.addEventListener('click', () => {
    if (state !== 'running' && state !== 'paused') advance();
});

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && state === 'running') {
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

buildLevel();
updateHud();
draw();
requestAnimationFrame(frame);
