// Elevator Action — ride a ten-floor building down to the street, lifting the
// documents behind every red door on the way and shooting your way past the
// agents who come out of the blue ones.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, player, enemies, bullets, elevators, doors)
// is kept at the top level on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules behind the numbers.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 900
const H = canvas.height;             // 600
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- building --------------------------------------------------------------

const FLOORS = 10;                   // floor 0 is the roof entrance, 9 the street
const FLOOR_H = 90;                  // floor-to-floor height in pixels
const BUILDING_LEFT = 40;
const BUILDING_RIGHT = 860;

// Three shafts, each serving a slice of the building. Consecutive slices
// overlap by a floor or two, so the descent is a relay: ride one car as far as
// it goes, walk to the next shaft, ride on.
const SHAFTS = [
    { x: 230, top: 0, bottom: 4 },
    { x: 450, top: 3, bottom: 7 },
    { x: 670, top: 6, bottom: 9 },
];
const SHAFT_W = 72;
const ELEV_SPEED = 72;               // px/s while a direction key is held
const ALIGN_TOL = 12;                // how close to a floor line still counts as level

const SLAB_H = 6;                    // thickness of a floor slab

const DOOR_XS = [120, 340, 560, 780];
const DOOR_W = 46;
const DOOR_H = 58;

// The six documents, by floor and door position. Everything else is a blue
// door that enemy agents walk out of.
const RED_DOORS = [
    { floor: 1, x: 120 },
    { floor: 2, x: 780 },
    { floor: 4, x: 340 },
    { floor: 5, x: 560 },
    { floor: 7, x: 120 },
    { floor: 8, x: 780 },
];
const DOC_TOTAL = RED_DOORS.length;

const EXIT = { floor: FLOORS - 1, x: 800, w: 56 };

// --- agent, enemies, gunfire ----------------------------------------------

const PLAYER_W = 22;
const STAND_H = 38;
const CROUCH_H = 22;
const PLAYER_SPEED = 150;            // px/s walking
const START_X = 90;

const GUN_Y = 26;                    // bullet height above the feet, standing
const CROUCH_GUN_Y = 12;
const BULLET_SPEED = 420;
const BULLET_W = 8;
const BULLET_H = 3;
const SHOOT_CD = 0.22;               // seconds between the agent's shots
const MAX_PLAYER_BULLETS = 3;

const ENEMY_W = 22;
const ENEMY_H = 38;
const ENEMY_BULLET_SPEED = 300;
const ENEMY_SHOOT_CD = 1.4;
const SHOOT_RANGE = 340;             // how far down a corridor an enemy will fire

const DOOR_REACH = 24;               // how close to a door counts as standing in it
const EXIT_REACH = 30;

const LEVEL_COUNT = 3;
const DOC_POINTS = 500;
const ENEMY_POINTS = 300;
const LEVEL_BONUS = 1000;
const START_LIVES = 3;

const BEST_KEY = 'elevatoraction-best';

const COLORS = {
    sky: '#070b10',
    wall: '#17222e',
    slab: '#2b3a4c',
    shaft: '#0d141c',
    cable: '#3c4e63',
    car: '#c8d4e2',
    doorRed: '#f05a5a',
    doorBlue: '#3f6d9c',
    doorDone: '#2a3542',
    exit: '#3ddc84',
    exitLocked: '#5a6472',
    player: '#f2f5f9',
    playerTrim: '#4ea8f5',
    enemy: '#f0a24e',
    bullet: '#fff2a8',
    enemyBullet: '#ff8f6b',
};

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = START_LIVES;
let docs = 0;
let best = loadBest();
let autoRun = true;                  // the animation loop only simulates while true
let hudDirty = false;
let spawnTimer = 0;

let doors = [];
let elevators = [];
let enemies = [];
let bullets = [];
let flashes = [];                    // short-lived muzzle/hit sparks, cosmetic only

const player = {
    x: START_X,
    y: FLOOR_H,
    floor: 0,
    facing: 1,
    crouching: false,
    inShaft: -1,                     // index into SHAFTS while riding, else -1
    shootCd: 0,
};

const cam = { y: 0 };
const keys = Object.create(null);

// --- geometry helpers ------------------------------------------------------

// The walking surface of floor `i`. Floor 0 sits one storey down from the top
// of the building so there is room to draw its ceiling.
function floorY(i) {
    return (i + 1) * FLOOR_H;
}

// The slab under the bottom floor is part of the building's drawn height, so
// the camera scrolls those last few pixels and the street is visible when the
// agent is standing on it.
const BUILDING_H = FLOORS * FLOOR_H + SLAB_H;

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Which floor a y sits on, or -1 when it is between floors.
function alignedFloorOf(y) {
    const i = Math.round(y / FLOOR_H) - 1;
    if (i < 0 || i >= FLOORS) return -1;
    return Math.abs(floorY(i) - y) <= ALIGN_TOL ? i : -1;
}

function shaftServes(shaft, floor) {
    return floor >= shaft.top && floor <= shaft.bottom;
}

// Corridors run the full width of the building and shafts never block them, so
// every door on a floor is always reachable on foot. The shaft index whose car
// is parked level with the floor the agent is standing on, or -1: that is the
// car the agent is standing on and can ride away.
function carUnderPlayer() {
    if (player.floor < 0) return -1;
    for (let i = 0; i < SHAFTS.length; i++) {
        if (!shaftServes(SHAFTS[i], player.floor)) continue;
        if (Math.abs(player.x - SHAFTS[i].x) > SHAFT_W / 2) continue;
        if (Math.abs(elevators[i].y - floorY(player.floor)) <= ALIGN_TOL) return i;
    }
    return -1;
}

function playerHeight() {
    return player.crouching ? CROUCH_H : STAND_H;
}

function gunHeight() {
    return player.crouching ? CROUCH_GUN_Y : GUN_Y;
}

function maxEnemies() {
    return 4 + level;
}

function enemySpeed() {
    return 60 + 14 * (level - 1);
}

function spawnInterval() {
    return Math.max(0.9, 2.4 - 0.4 * (level - 1));
}

// --- level setup -----------------------------------------------------------

function buildDoors() {
    doors = [];
    for (let f = 0; f < FLOORS; f++) {
        for (const x of DOOR_XS) {
            // The bottom floor gives its rightmost slot up to the street exit.
            if (f === EXIT.floor && x === DOOR_XS[DOOR_XS.length - 1]) continue;
            const red = RED_DOORS.some((d) => d.floor === f && d.x === x);
            doors.push({ floor: f, x, type: red ? 'red' : 'blue', collected: false });
        }
    }
}

function resetElevators() {
    elevators = SHAFTS.map((s) => ({ x: s.x, y: floorY(s.top), top: s.top, bottom: s.bottom }));
}

// Put the agent back at the roof entrance and clear the field.
function resetAgent() {
    player.x = START_X;
    player.floor = 0;
    player.y = floorY(0);
    player.facing = 1;
    player.crouching = false;
    player.inShaft = -1;
    player.shootCd = 0;
    enemies = [];
    bullets = [];
    flashes = [];
    spawnTimer = spawnInterval();
    updateCamera();
}

function setupLevel() {
    buildDoors();
    resetElevators();
    docs = 0;
    resetAgent();
    hudDirty = true;
}

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    setupLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

// Space, a click and the Start button all mean "do the obvious thing here".
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'levelclear':
            if (level >= LEVEL_COUNT) {
                state = 'won';
                saveBest();
                showOverlay('YOU WIN!', `Final score ${score}`, 'Press Space to play again');
            } else {
                level += 1;
                setupLevel();
                state = 'running';
                hideOverlay();
            }
            updateHud();
            break;
        case 'paused':
            state = 'running';
            hideOverlay();
            break;
        default:
            break;
    }
}

// --- input ----------------------------------------------------------------

function held(...codes) {
    return codes.some((c) => keys[c]);
}

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];

// --- the agent ------------------------------------------------------------

function updatePlayer(dt) {
    const moveX = (held(...RIGHT) ? 1 : 0) - (held(...LEFT) ? 1 : 0);

    if (player.inShaft >= 0) {
        rideElevator(dt, moveX);
    } else {
        walkFloor(dt, moveX);
    }

    player.shootCd -= dt;
    if (held('Space')) firePlayer();
}

function rideElevator(dt, moveX) {
    const car = elevators[player.inShaft];
    const up = held(...UP);
    const down = held(...DOWN);

    if (up !== down) {
        const dir = down ? 1 : -1;
        car.y = clamp(car.y + dir * ELEV_SPEED * dt, floorY(car.top), floorY(car.bottom));
    } else {
        // Letting go parks the car if it is already close to a floor line.
        const f = alignedFloorOf(car.y);
        if (f >= 0) car.y = floorY(f);
    }

    player.y = car.y;
    player.crouching = false;

    const aligned = alignedFloorOf(car.y);
    player.floor = aligned;

    const half = PLAYER_W / 2;
    const left = car.x - SHAFT_W / 2;
    const right = car.x + SHAFT_W / 2;

    if (aligned < 0) {
        // Mid-shaft: the agent can shuffle inside the car but not step out.
        player.x = clamp(player.x + moveX * PLAYER_SPEED * dt, left + half, right - half);
        if (moveX) player.facing = moveX;
        return;
    }

    player.x += moveX * PLAYER_SPEED * dt;
    if (moveX) player.facing = moveX;

    if (player.x < left || player.x > right) {
        player.inShaft = -1;
        player.y = floorY(aligned);
        clampToCorridor();
    }
}

function walkFloor(dt, moveX) {
    // Up or down while standing on a level car takes it. Down therefore rides
    // rather than crouches in that one spot, which is the trade for not having
    // to line yourself up with a doorway to board.
    const car = carUnderPlayer();
    if (car >= 0 && (held(...UP) || held(...DOWN))) {
        player.inShaft = car;
        player.y = elevators[car].y;
        player.crouching = false;
        rideElevator(dt, moveX);
        return;
    }

    player.crouching = held(...DOWN);

    if (!player.crouching && moveX) {
        player.x += moveX * PLAYER_SPEED * dt;
        player.facing = moveX;
    }

    clampToCorridor();
}

function clampToCorridor() {
    const half = PLAYER_W / 2;
    player.x = clamp(player.x, BUILDING_LEFT + half, BUILDING_RIGHT - half);
}

function firePlayer() {
    if (player.shootCd > 0) return;
    if (bullets.filter((b) => b.from === 'player').length >= MAX_PLAYER_BULLETS) return;
    const x = player.x + player.facing * (PLAYER_W / 2 + 4);
    const y = player.y - gunHeight();
    bullets.push({ x, y, vx: player.facing * BULLET_SPEED, from: 'player' });
    flashes.push({ x, y, life: 0.06 });
    player.shootCd = SHOOT_CD;
}

// --- enemies --------------------------------------------------------------

function spawnEnemy(floor, x, dir) {
    enemies.push({ x, y: floorY(floor), floor, dir, shootCd: ENEMY_SHOOT_CD });
    return enemies[enemies.length - 1];
}

function updateSpawns(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (enemies.length >= maxEnemies()) return;

    const near = player.floor >= 0 ? player.floor : alignedFloorOf(player.y);
    const base = near >= 0 ? near : 0;
    const options = doors.filter((d) => {
        if (d.type !== 'blue') return false;
        if (Math.abs(d.floor - base) > 3) return false;
        // Never drop an agent right on top of the player.
        if (d.floor === base && Math.abs(d.x - player.x) <= 60) return false;
        return true;
    });
    if (!options.length) return;

    const door = options[Math.floor(Math.random() * options.length)];
    spawnEnemy(door.floor, door.x, door.x > player.x ? -1 : 1);
}

function updateEnemies(dt) {
    const speed = enemySpeed();
    const half = ENEMY_W / 2;

    for (const e of enemies) {
        const chasing = e.floor === player.floor;
        if (chasing) e.dir = player.x < e.x ? -1 : 1;

        // Enemy agents never ride the cars, but the corridor is theirs end to
        // end, so there is nowhere on a floor they cannot follow you.
        const x = clamp(e.x + e.dir * speed * dt, BUILDING_LEFT + half, BUILDING_RIGHT - half);
        if (x === e.x && !chasing) e.dir *= -1;  // bounced off a corridor wall
        e.x = x;

        e.shootCd -= dt;
        if (!chasing || e.shootCd > 0) continue;
        const dx = player.x - e.x;
        if (Math.abs(dx) > SHOOT_RANGE || Math.sign(dx) !== e.dir) continue;
        bullets.push({
            x: e.x + e.dir * (ENEMY_W / 2 + 4),
            y: e.y - GUN_Y,
            vx: e.dir * ENEMY_BULLET_SPEED,
            from: 'enemy',
        });
        e.shootCd = ENEMY_SHOOT_CD;
    }
}

// --- gunfire --------------------------------------------------------------

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) * 2 < aw + bw && Math.abs(ay - by) * 2 < ah + bh;
}

// A bullet's box, centred on (x, y).
function bulletHits(b, cx, cy, w, h) {
    return overlaps(b.x, b.y, BULLET_W, BULLET_H, cx, cy, w, h);
}

// Returns true when the agent was shot, so the caller can stop the step.
function updateBullets(dt) {
    for (const b of bullets) b.x += b.vx * dt;

    bullets = bullets.filter((b) => b.x > BUILDING_LEFT && b.x < BUILDING_RIGHT);

    // Agent bullets first: an enemy dropped this frame cannot shoot back.
    for (const b of bullets) {
        if (b.from !== 'player') continue;
        const hit = enemies.find((e) =>
            bulletHits(b, e.x, e.y - ENEMY_H / 2, ENEMY_W, ENEMY_H)
        );
        if (!hit) continue;
        enemies = enemies.filter((e) => e !== hit);
        bullets = bullets.filter((x) => x !== b);
        flashes.push({ x: hit.x, y: hit.y - ENEMY_H / 2, life: 0.18 });
        score += ENEMY_POINTS;
        hudDirty = true;
    }

    const ph = playerHeight();
    const shot = bullets.find(
        (b) => b.from === 'enemy' && bulletHits(b, player.x, player.y - ph / 2, PLAYER_W, ph)
    );
    if (shot) {
        killPlayer();
        return true;
    }
    return false;
}

function checkContacts() {
    const ph = playerHeight();
    const touched = enemies.find((e) =>
        overlaps(player.x, player.y - ph / 2, PLAYER_W, ph, e.x, e.y - ENEMY_H / 2, ENEMY_W, ENEMY_H)
    );
    if (!touched) return false;

    // An agent caught in a shaft by a car under power is crushed. You cannot
    // dodge inside a car, so a moving car would otherwise be an undodgeable
    // death every time it passed a floor someone happened to be standing on. A
    // car sitting still crushes nothing, so parking in one is no shelter.
    if (player.inShaft >= 0 && (held(...UP) || held(...DOWN))) {
        enemies = enemies.filter((e) => e !== touched);
        flashes.push({ x: touched.x, y: touched.y - ENEMY_H / 2, life: 0.18 });
        score += ENEMY_POINTS;
        hudDirty = true;
        return false;
    }

    killPlayer();
    return true;
}

function killPlayer() {
    lives -= 1;
    hudDirty = true;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        updateHud();
        showOverlay('GAME OVER', `Final score ${score}`, 'Press Space to try again');
        return;
    }
    resetElevators();
    resetAgent();
}

// --- documents and the exit ----------------------------------------------

function checkDoors() {
    if (player.inShaft >= 0 || player.floor < 0) return;

    if (held(...UP)) {
        const door = doors.find(
            (d) =>
                d.type === 'red' &&
                !d.collected &&
                d.floor === player.floor &&
                Math.abs(d.x - player.x) <= DOOR_REACH
        );
        if (door) {
            door.collected = true;
            docs += 1;
            score += DOC_POINTS;
            hudDirty = true;
        }
    }

    if (
        player.floor === EXIT.floor &&
        Math.abs(player.x - EXIT.x) <= EXIT_REACH &&
        docs >= DOC_TOTAL
    ) {
        score += LEVEL_BONUS;
        state = 'levelclear';
        updateHud();
        showOverlay(
            'FLOOR CLEAR',
            `Score ${score}`,
            level >= LEVEL_COUNT ? 'Press Space to finish' : `Press Space for level ${level + 1}`
        );
    }
}

// --- camera ---------------------------------------------------------------

function updateCamera() {
    cam.y = clamp(player.y - H * 0.6, 0, BUILDING_H - H);
}

// --- the step -------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    updatePlayer(dt);
    updateEnemies(dt);
    if (updateBullets(dt)) return flushHud();
    updateSpawns(dt);
    if (checkContacts()) return flushHud();
    checkDoors();
    updateCamera();

    for (const f of flashes) f.life -= dt;
    flashes = flashes.filter((f) => f.life > 0);

    flushHud();
}

function flushHud() {
    if (!hudDirty) return;
    hudDirty = false;
    updateHud();
}

// --- drawing --------------------------------------------------------------

function draw() {
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(0, -cam.y);

    drawBuilding();
    drawShafts();
    drawSlabs();
    drawCars();
    drawDoors();
    drawExit();
    drawEnemies();
    drawBullets();
    drawPlayer();
    drawFlashes();

    ctx.restore();

    drawFloorStrip();
}

function drawBuilding() {
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(BUILDING_LEFT, 0, BUILDING_RIGHT - BUILDING_LEFT, BUILDING_H);

    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        // A faint band of windows behind each corridor.
        ctx.fillStyle = 'rgba(78, 168, 245, 0.06)';
        ctx.fillRect(BUILDING_LEFT + 8, y - FLOOR_H + 14, BUILDING_RIGHT - BUILDING_LEFT - 16, 20);
    }
}

// Floor slabs run the full width, over the shafts: the corridor is continuous
// and an empty shaft is something you walk across, not into.
function drawSlabs() {
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = COLORS.slab;
        ctx.fillRect(BUILDING_LEFT, y, BUILDING_RIGHT - BUILDING_LEFT, SLAB_H);
        ctx.fillStyle = '#5d6c80';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${FLOORS - f}`, BUILDING_LEFT + 6, y - 6);
    }
}

function drawShafts() {
    for (let i = 0; i < SHAFTS.length; i++) {
        const s = SHAFTS[i];
        const top = floorY(s.top) - FLOOR_H + SLAB_H;
        const h = floorY(s.bottom) - top;
        ctx.fillStyle = COLORS.shaft;
        ctx.fillRect(s.x - SHAFT_W / 2, top, SHAFT_W, h);
        ctx.strokeStyle = COLORS.cable;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x, top);
        ctx.lineTo(s.x, top + h);
        ctx.stroke();
    }
}

function drawCars() {
    for (let i = 0; i < SHAFTS.length; i++) {
        const s = SHAFTS[i];
        const car = elevators[i];
        if (!car) continue;
        ctx.fillStyle = COLORS.car;
        ctx.fillRect(s.x - SHAFT_W / 2 + 4, car.y - 46, SHAFT_W - 8, 46);
        ctx.fillStyle = '#8d9cb0';
        ctx.fillRect(s.x - SHAFT_W / 2 + 4, car.y - 6, SHAFT_W - 8, 6);
        // A green lamp while the car is level with a floor and safe to leave.
        ctx.fillStyle = alignedFloorOf(car.y) >= 0 ? COLORS.exit : COLORS.exitLocked;
        ctx.fillRect(s.x - 6, car.y - 44, 12, 4);
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor);
        ctx.fillStyle = d.collected
            ? COLORS.doorDone
            : d.type === 'red'
              ? COLORS.doorRed
              : COLORS.doorBlue;
        ctx.fillRect(d.x - DOOR_W / 2, y - DOOR_H, DOOR_W, DOOR_H);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(d.x - DOOR_W / 2 + 4, y - DOOR_H + 4, DOOR_W - 8, DOOR_H - 8);
        if (d.type === 'red' && !d.collected) {
            ctx.fillStyle = '#ffe9a8';
            ctx.fillRect(d.x - 7, y - DOOR_H / 2 - 7, 14, 14);
        }
    }
}

function drawExit() {
    const y = floorY(EXIT.floor);
    const open = docs >= DOC_TOTAL;
    ctx.fillStyle = open ? COLORS.exit : COLORS.exitLocked;
    ctx.fillRect(EXIT.x - EXIT.w / 2, y - DOOR_H, EXIT.w, DOOR_H);
    ctx.fillStyle = '#07110b';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(open ? 'EXIT' : 'LOCK', EXIT.x, y - DOOR_H / 2 + 4);
}

function drawPlayer() {
    const h = playerHeight();
    ctx.fillStyle = COLORS.player;
    ctx.fillRect(player.x - PLAYER_W / 2, player.y - h, PLAYER_W, h);
    ctx.fillStyle = COLORS.playerTrim;
    ctx.fillRect(player.x - PLAYER_W / 2, player.y - h, PLAYER_W, 7);
    // The drawn pistol doubles as a facing indicator.
    ctx.fillStyle = '#20303f';
    const gx = player.facing > 0 ? player.x + PLAYER_W / 2 : player.x - PLAYER_W / 2 - 8;
    ctx.fillRect(gx, player.y - gunHeight() - 2, 8, 4);
}

function drawEnemies() {
    for (const e of enemies) {
        ctx.fillStyle = COLORS.enemy;
        ctx.fillRect(e.x - ENEMY_W / 2, e.y - ENEMY_H, ENEMY_W, ENEMY_H);
        ctx.fillStyle = '#8a4f18';
        ctx.fillRect(e.x - ENEMY_W / 2, e.y - ENEMY_H, ENEMY_W, 7);
        ctx.fillStyle = '#20303f';
        const gx = e.dir > 0 ? e.x + ENEMY_W / 2 : e.x - ENEMY_W / 2 - 8;
        ctx.fillRect(gx, e.y - GUN_Y - 2, 8, 4);
    }
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.from === 'player' ? COLORS.bullet : COLORS.enemyBullet;
        ctx.fillRect(b.x - BULLET_W / 2, b.y - BULLET_H / 2, BULLET_W, BULLET_H);
    }
}

function drawFlashes() {
    for (const f of flashes) {
        ctx.fillStyle = `rgba(255, 226, 138, ${Math.max(0, f.life * 5)})`;
        const r = 10 - f.life * 20;
        ctx.beginPath();
        ctx.arc(f.x, f.y, Math.max(3, r), 0, Math.PI * 2);
        ctx.fill();
    }
}

// A slim strip down the right edge showing where in the building you are and
// which floors still hold a document.
function drawFloorStrip() {
    const x = W - 20;
    ctx.fillStyle = 'rgba(13, 20, 28, 0.85)';
    ctx.fillRect(x - 6, 10, 16, H - 20);
    const span = H - 40;
    for (let f = 0; f < FLOORS; f++) {
        const y = 20 + (span * f) / (FLOORS - 1);
        const pending = doors.some((d) => d.floor === f && d.type === 'red' && !d.collected);
        ctx.fillStyle = pending ? COLORS.doorRed : '#394a5e';
        ctx.fillRect(x - 2, y - 2, 8, 4);
    }
    const here = clamp(player.y / BUILDING_H, 0, 1);
    ctx.fillStyle = COLORS.playerTrim;
    ctx.fillRect(x - 6, 20 + span * here - 2, 16, 3);
}

// --- HUD and overlay -----------------------------------------------------

function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('docs').textContent = `${docs}/${DOC_TOTAL}`;
    document.getElementById('best').textContent = String(best);
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
        /* storage blocked — the score just does not persist */
    }
    updateHud();
}

// --- wiring --------------------------------------------------------------

const TRACKED = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space',
]);

document.addEventListener('keydown', (e) => {
    if (TRACKED.has(e.code)) {
        e.preventDefault();
        keys[e.code] = true;
        if (e.code === 'Space' && state !== 'running') advance();
        return;
    }
    if (e.code === 'KeyP') {
        e.preventDefault();
        if (state === 'running') {
            state = 'paused';
            showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
        } else if (state === 'paused') {
            advance();
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (TRACKED.has(e.code)) keys[e.code] = false;
});

canvas.addEventListener('click', () => {
    if (state !== 'running') advance();
});
document.getElementById('btn-start').addEventListener('click', () => advance());

// --- main loop -----------------------------------------------------------

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

buildDoors();
resetElevators();
resetAgent();
updateHud();
draw();
requestAnimationFrame(frame);
