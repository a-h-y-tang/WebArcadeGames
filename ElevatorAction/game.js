// ---------------------------------------------------------------------------
// Elevator Action — a top-to-bottom infiltration of a sixteen storey building.
//
// You drop onto the roof, take the secret documents from behind every red door,
// ride the lifts down to the basement and walk out of the getaway exit. The
// building's agents come out of the blue doors and shoot at standing height, so
// crouching is how you survive and a moving lift car is a second kind of weapon.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime, Snake and Tetris in this repo. All motion is expressed per second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
//
// Positions are bottom-anchored: an actor's `y` is the line its feet stand on,
// so it occupies `x - w/2 .. x + w/2` by `y - h .. y`. Every collision in the
// game — bullet against body, car against agent, player against door — is then
// plain rectangle/point maths with no tile grid to keep in step.
// ---------------------------------------------------------------------------

// --- Viewport & building -------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;
const BUILDING_W = 720;
const FLOORS = 16;
const FLOOR_H = 60;
const SLAB_H = 10;                  // thickness of the concrete under each floor
const WORLD_H = FLOORS * FLOOR_H;   // 960 — twice the viewport, so the camera scrolls

// The walking surface of floor `f`. Floor 0 is the roof, FLOORS-1 the basement.
const floorY = (f) => (f + 1) * FLOOR_H - SLAB_H;

// Nearest floor to a world y — used to tell which floor a car's deck is level
// with, and which floor a rider is passing.
const floorAt = (y) => clamp(Math.round((y + SLAB_H) / FLOOR_H) - 1, 0, FLOORS - 1);

// --- Actors --------------------------------------------------------------
const PLAYER_W = 22;
const PLAYER_H = 34;
const CROUCH_H = 18;
const WALK_SPEED = 120;
const START_LIVES = 3;

const ENEMY_W = 22;
const ENEMY_H = 34;
const ENEMY_RANGE = 260;      // how far an agent will shoot
const ENEMY_STANDOFF = 90;    // how close an agent walks before it settles in to fire
const PATROL_FACTOR = 0.6;    // agents amble when the player is not on their line

// --- Guns ----------------------------------------------------------------
// Bullets are points, so these two heights are the whole combat system: an
// agent fires at SHOT_H, which is above a crouching player's CROUCH_H box, and
// a crouching player fires at CROUCH_SHOT_H, which is still inside a standing
// agent's box.
const SHOT_H = 22;
const CROUCH_SHOT_H = 10;
const BULLET_SPEED = 420;
const SHOT_COOLDOWN = 0.25;

// --- Lifts ---------------------------------------------------------------
const SHAFT_W = 52;
const CAR_H = 44;
const CAR_SPEED = 70;   // driven by the player riding inside
const CALL_SPEED = 95;  // summoned towards a player waiting on a floor
const SNAP = 6;         // how level with a floor a deck must be to board or leave

// Each shaft covers a limited band of floors, so a trip to the basement means
// transferring twice. `start` is where the car is parked when a level loads.
const SHAFTS = [
    { x: 150, top: 0, bottom: 7, start: 0 },
    { x: 360, top: 4, bottom: 11, start: 11 },
    { x: 570, top: 8, bottom: 15, start: 15 },
];

// --- Doors ---------------------------------------------------------------
// Four fixed slots per floor, none of them overlapping a shaft.
const DOOR_SLOTS = [60, 240, 440, 640];
const DOOR_W = 44;
const DOOR_H = 38;
const EXIT_X = 60;   // the basement getaway is everything left of here

// --- Scoring -------------------------------------------------------------
const DOC_POINTS = 500;
const ENEMY_POINTS = 100;
const CRUSH_POINTS = 300;
const ESCAPE_POINTS = 1000;

// --- Levels --------------------------------------------------------------
// One four character row per floor: '.' nothing, 'R' a red door holding a
// secret document, 'B' a blue door agents come out of. The roof and the
// basement are kept clear.
const LEVELS = [
    {
        doors: [
            '....', '..B.', '.R..', 'B...', '...B', '..R.', '.B..', 'B..R',
            '...B', '.B..', '....', 'B...', '...B', '.B..', '..B.', '....',
        ],
        maxEnemies: 3,
        spawnInterval: 2.8,
        enemySpeed: 58,
        enemyFireInterval: 2.0,
    },
    {
        doors: [
            '....', 'B..R', '..B.', '.R.B', 'B...', '..B.', '.B.R', 'B..B',
            '..R.', '.B.B', 'B...', '..B.', '.B..', 'B..B', '..B.', '....',
        ],
        maxEnemies: 4,
        spawnInterval: 2.3,
        enemySpeed: 70,
        enemyFireInterval: 1.7,
    },
    {
        doors: [
            '....', '.B.R', 'B.B.', '..R.', 'BB..', '..BR', 'R.B.', '.B.B',
            'B..R', '.B.B', 'B.B.', '..B.', 'B.BB', '.B..', 'B..B', '....',
        ],
        maxEnemies: 5,
        spawnInterval: 1.9,
        enemySpeed: 82,
        enemyFireInterval: 1.4,
    },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'idle';   // 'idle' | 'playing' | 'paused' | 'over'
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let docsLeft = 0;
let won = false;
let camY = 0;
let autoStep = true;
let spawnTimer = 0;
let banner = '';
let bannerTimer = 0;

const keys = { left: false, right: false, up: false, down: false };

const player = {
    x: 0,
    y: 0,
    floor: 0,
    facing: -1,
    crouching: false,
    onElevator: -1,
    cooldown: 0,
    alive: true,
};

let elevators = [];
let doors = [];
const enemies = [];
const bullets = [];

const playerHeight = () => (player.crouching ? CROUCH_H : PLAYER_H);

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elDocs = document.getElementById('docs');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function updateHud() {
    elScore.textContent = String(score);
    elDocs.textContent = String(docsLeft);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
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

// ---------------------------------------------------------------------------
// Building setup
// ---------------------------------------------------------------------------

function loadLevel(n) {
    const cfg = LEVELS[clamp(n, 1, LEVELS.length) - 1];

    doors = [];
    cfg.doors.forEach((row, floor) => {
        row.split('').forEach((cell, slot) => {
            if (cell !== 'R' && cell !== 'B') return;
            doors.push({
                floor,
                slot,
                x: DOOR_SLOTS[slot],
                kind: cell === 'R' ? 'red' : 'blue',
                open: false,
            });
        });
    });

    elevators = SHAFTS.map((s) => ({ x: s.x, w: SHAFT_W, y: floorY(s.start), vy: 0 }));

    docsLeft = doors.filter((d) => d.kind === 'red').length;
    enemies.length = 0;
    bullets.length = 0;
    spawnTimer = cfg.spawnInterval;
    resetPlayer();
}

function resetPlayer() {
    player.x = BUILDING_W - 60;
    player.floor = 0;
    player.y = floorY(0);
    player.facing = -1;
    player.crouching = false;
    player.onElevator = -1;
    player.cooldown = 0;
    player.alive = true;
    updateCamera();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    won = false;
    banner = '';
    bannerTimer = 0;
    keys.left = keys.right = keys.up = keys.down = false;
    loadLevel(1);
    state = 'playing';
    updateHud();
    hideOverlay();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score, 'Press P or Space to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('elevatoraction-best', String(best));
        } catch (err) {
            /* private browsing — the run still counts, it just is not remembered */
        }
    }
    updateHud();
    showOverlay(
        won ? 'ESCAPED' : 'BUSTED',
        'Score ' + score,
        won ? 'Every document, every floor. Press Space to go again' : 'Press Space to try again',
    );
}

// ---------------------------------------------------------------------------
// Lifts
// ---------------------------------------------------------------------------

// The index of the shaft the given spot is inside, or -1. A shaft only answers
// for the floors it actually reaches.
function shaftAt(x, floor) {
    for (let i = 0; i < SHAFTS.length; i++) {
        const s = SHAFTS[i];
        if (floor < s.top || floor > s.bottom) continue;
        if (x >= s.x && x <= s.x + SHAFT_W) return i;
    }
    return -1;
}

function driveCar(index, dir, dt) {
    const car = elevators[index];
    const s = SHAFTS[index];
    if (dir !== 0) {
        car.y = clamp(car.y + dir * CAR_SPEED * dt, floorY(s.top), floorY(s.bottom));
    }
    car.vy = dir;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function updatePlayer(dt) {
    // --- riding ---------------------------------------------------------
    if (player.onElevator >= 0) {
        const index = player.onElevator;
        const car = elevators[index];
        let dir = 0;
        if (keys.up) dir -= 1;
        if (keys.down) dir += 1;
        driveCar(index, dir, dt);
        player.y = car.y;
        player.floor = floorAt(car.y);
        player.crouching = false;

        // Stepping out is only possible when the deck is level with a floor;
        // park between floors and you are stuck, but safe from every bullet.
        if (keys.left || keys.right) {
            const f = floorAt(car.y);
            if (Math.abs(car.y - floorY(f)) <= SNAP) {
                player.onElevator = -1;
                player.floor = f;
                player.y = floorY(f);
                player.facing = keys.left ? -1 : 1;
            }
        }
        return;
    }

    // --- standing on a floor --------------------------------------------
    const index = shaftAt(player.x, player.floor);
    if (index >= 0 && (keys.up || keys.down)) {
        const car = elevators[index];
        if (Math.abs(car.y - player.y) <= SNAP) {
            // Board, and let the same keypress drive the car straight away.
            player.onElevator = index;
            player.crouching = false;
            car.y = player.y;
            let dir = 0;
            if (keys.up) dir -= 1;
            if (keys.down) dir += 1;
            driveCar(index, dir, dt);
            player.y = car.y;
            player.floor = floorAt(car.y);
            return;
        }
        // Summon: either key calls the car, and it always stops level with the
        // player rather than running them down.
        const gap = player.y - car.y;
        const travel = CALL_SPEED * dt;
        car.y = Math.abs(gap) <= travel ? player.y : car.y + Math.sign(gap) * travel;
        car.vy = Math.sign(gap);
    }

    player.crouching = keys.down && index < 0;

    if (!player.crouching) {
        let dir = 0;
        if (keys.left) dir -= 1;
        if (keys.right) dir += 1;
        if (dir !== 0) {
            player.facing = dir;
            player.x = clamp(player.x + dir * WALK_SPEED * dt, PLAYER_W / 2, BUILDING_W - PLAYER_W / 2);
        }
    }
}

function shoot() {
    if (state !== 'playing') return;
    if (player.cooldown > 0) return;
    player.cooldown = SHOT_COOLDOWN;
    const h = player.crouching ? CROUCH_SHOT_H : SHOT_H;
    bullets.push({
        x: player.x + player.facing * (PLAYER_W / 2 + 2),
        y: player.y - h,
        vx: player.facing * BULLET_SPEED,
        from: 'player',
    });
}

function killPlayer() {
    lives -= 1;
    enemies.length = 0;
    bullets.length = 0;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        gameOver();
        return;
    }
    resetPlayer();
    banner = 'AGENT DOWN';
    bannerTimer = 1.4;
    updateHud();
}

// ---------------------------------------------------------------------------
// Doors and the exit
// ---------------------------------------------------------------------------

function updateDoors() {
    if (player.onElevator >= 0) return;
    for (const d of doors) {
        if (d.kind !== 'red' || d.open) continue;
        if (d.floor !== player.floor) continue;
        if (player.x < d.x || player.x > d.x + DOOR_W) continue;
        d.open = true;
        docsLeft -= 1;
        score += DOC_POINTS;
        banner = docsLeft > 0 ? docsLeft + ' TO GO' : 'GET OUT';
        bannerTimer = 1.2;
    }
}

function exitCheck() {
    if (player.onElevator >= 0) return;
    if (player.floor !== FLOORS - 1) return;
    if (docsLeft > 0) return;
    if (player.x > EXIT_X) return;
    clearLevel();
}

function clearLevel() {
    score += ESCAPE_POINTS;
    if (level >= LEVELS.length) {
        won = true;
        gameOver();
        return;
    }
    level += 1;
    loadLevel(level);
    banner = 'BUILDING ' + level;
    bannerTimer = 1.8;
    updateHud();
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function spawnEnemyAt(floor, x, facing) {
    const cfg = LEVELS[level - 1];
    const e = {
        x,
        y: floorY(floor),
        floor,
        facing: facing || -1,
        speed: cfg.enemySpeed,
        cooldown: cfg.enemyFireInterval * 0.5,
        alive: true,
    };
    enemies.push(e);
    return e;
}

function updateSpawner(dt) {
    const cfg = LEVELS[level - 1];
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = cfg.spawnInterval;
    if (enemies.length >= cfg.maxEnemies) return;

    const blue = doors.filter((d) => d.kind === 'blue');
    const near = blue.filter((d) => Math.abs(d.floor - player.floor) <= 2);
    const pool = near.length ? near : blue;
    if (!pool.length) return;
    const d = pool[Math.floor(Math.random() * pool.length)];
    const x = d.x + DOOR_W / 2;
    spawnEnemyAt(d.floor, x, player.x < x ? -1 : 1);
}

function updateEnemies(dt) {
    const cfg = LEVELS[level - 1];
    for (const e of enemies) {
        e.cooldown = Math.max(0, e.cooldown - dt);

        // An agent only reacts to a player standing on its own line — a rider
        // stopped between floors is out of reach and out of sight.
        if (Math.abs(e.y - player.y) <= 2) {
            const dx = player.x - e.x;
            if (Math.abs(dx) > ENEMY_STANDOFF) {
                e.facing = Math.sign(dx);
                e.x = clamp(e.x + e.facing * e.speed * dt, ENEMY_W / 2, BUILDING_W - ENEMY_W / 2);
            } else if (dx !== 0) {
                e.facing = Math.sign(dx);
            }
            if (Math.abs(dx) <= ENEMY_RANGE && e.cooldown === 0) {
                e.cooldown = cfg.enemyFireInterval;
                bullets.push({
                    x: e.x + e.facing * (ENEMY_W / 2 + 2),
                    y: e.y - SHOT_H,
                    vx: e.facing * BULLET_SPEED,
                    from: 'enemy',
                });
            }
        } else {
            e.x += e.facing * e.speed * PATROL_FACTOR * dt;
            if (e.x < ENEMY_W / 2) {
                e.x = ENEMY_W / 2;
                e.facing = 1;
            } else if (e.x > BUILDING_W - ENEMY_W / 2) {
                e.x = BUILDING_W - ENEMY_W / 2;
                e.facing = -1;
            }
        }
    }
}

// A car on the move flattens any agent its body runs through. Only agents are
// ever crushed: a car summoned to a waiting player stops level with them.
function crushCheck() {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        for (const car of elevators) {
            if (!car.vy) continue;
            if (e.x + ENEMY_W / 2 < car.x || e.x - ENEMY_W / 2 > car.x + car.w) continue;
            if (car.y < e.y - ENEMY_H || car.y - CAR_H > e.y) continue;
            enemies.splice(i, 1);
            score += CRUSH_POINTS;
            break;
        }
    }
}

function contactCheck() {
    for (const e of enemies) {
        if (Math.abs(e.y - player.y) > 2) continue;
        if (Math.abs(e.x - player.x) > (ENEMY_W + PLAYER_W) / 2) continue;
        killPlayer();
        return;
    }
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

const hitsActor = (b, x, y, w, h) =>
    b.x >= x - w / 2 && b.x <= x + w / 2 && b.y >= y - h && b.y <= y;

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < -4 || b.x > BUILDING_W + 4) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.from === 'player') {
            const hit = enemies.findIndex((e) => hitsActor(b, e.x, e.y, ENEMY_W, ENEMY_H));
            if (hit >= 0) {
                enemies.splice(hit, 1);
                score += ENEMY_POINTS;
                bullets.splice(i, 1);
            }
        } else if (hitsActor(b, player.x, player.y, PLAYER_W, playerHeight())) {
            bullets.splice(i, 1);
            killPlayer();
            return;
        }
    }
}

function updateCamera() {
    camY = clamp(player.y - CANVAS_H / 2, 0, WORLD_H - CANVAS_H);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;

    if (bannerTimer > 0) bannerTimer = Math.max(0, bannerTimer - dt);
    player.cooldown = Math.max(0, player.cooldown - dt);
    for (const car of elevators) car.vy = 0;

    updatePlayer(dt);
    updateDoors();
    updateSpawner(dt);
    updateEnemies(dt);
    updateBullets(dt);
    if (state !== 'playing') return;   // the player was shot and the run ended
    crushCheck();
    contactCheck();
    if (state !== 'playing') return;
    exitCheck();
    updateCamera();
    updateHud();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawBackground() {
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // A faint window grid, so the scrolling reads as a building.
    ctx.fillStyle = 'rgba(80, 110, 160, 0.10)';
    const first = Math.floor(camY / 20) * 20;
    for (let y = first; y < camY + CANVAS_H; y += 20) {
        for (let x = 10; x < BUILDING_W; x += 40) {
            ctx.fillRect(x, y - camY, 18, 8);
        }
    }
}

function drawShafts() {
    for (const s of SHAFTS) {
        const top = floorY(s.top) - FLOOR_H + SLAB_H;
        const bottom = floorY(s.bottom);
        ctx.fillStyle = 'rgba(16, 23, 36, 0.96)';
        ctx.fillRect(s.x, top - camY, SHAFT_W, bottom - top);
        // Rungs, so a hoistway reads as a hoistway and not as a dark wall.
        ctx.fillStyle = 'rgba(120, 150, 200, 0.10)';
        for (let y = Math.ceil(top / 16) * 16; y < bottom; y += 16) {
            ctx.fillRect(s.x + 10, y - camY, SHAFT_W - 20, 2);
        }
        // Guide rails.
        ctx.fillStyle = 'rgba(140, 170, 220, 0.30)';
        ctx.fillRect(s.x + 5, top - camY, 2, bottom - top);
        ctx.fillRect(s.x + SHAFT_W - 7, top - camY, 2, bottom - top);
        ctx.strokeStyle = 'rgba(140, 170, 220, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x + 0.5, top - camY + 0.5, SHAFT_W - 1, bottom - top - 1);
    }
}

function drawFloors() {
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f) - camY;
        if (y < -FLOOR_H || y > CANVAS_H + FLOOR_H) continue;
        ctx.fillStyle = f === FLOORS - 1 ? '#2b3448' : '#1d2434';
        ctx.fillRect(0, y, BUILDING_W, SLAB_H);
        ctx.fillStyle = 'rgba(150, 180, 230, 0.25)';
        ctx.fillRect(0, y, BUILDING_W, 1);

        ctx.fillStyle = 'rgba(125, 139, 163, 0.75)';
        ctx.font = '9px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        const label = f === 0 ? 'ROOF' : f === FLOORS - 1 ? 'BASEMENT' : String(FLOORS - 1 - f);
        ctx.fillText(label, 4, y - 2);
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor) - camY;
        if (y < -FLOOR_H || y > CANVAS_H + FLOOR_H) continue;
        const top = y - DOOR_H;
        if (d.kind === 'red') {
            ctx.fillStyle = d.open ? '#2a1a1c' : '#c8343a';
            ctx.fillRect(d.x, top, DOOR_W, DOOR_H);
            if (!d.open) {
                ctx.fillStyle = '#ffd9a0';
                ctx.fillRect(d.x + DOOR_W / 2 - 7, top + 12, 14, 10);
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.fillRect(d.x + DOOR_W / 2 - 7, top + 15, 14, 1);
            }
        } else {
            ctx.fillStyle = '#2f5f8d';
            ctx.fillRect(d.x, top, DOOR_W, DOOR_H);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(d.x + DOOR_W / 2 - 1, top + 6, 2, DOOR_H - 12);
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(d.x + 0.5, top + 0.5, DOOR_W - 1, DOOR_H - 1);
    }
}

function drawExit() {
    const y = floorY(FLOORS - 1) - camY;
    if (y < -FLOOR_H || y > CANVAS_H + FLOOR_H) return;
    const live = docsLeft === 0;
    ctx.fillStyle = live ? 'rgba(90, 220, 140, 0.22)' : 'rgba(120, 140, 170, 0.10)';
    ctx.fillRect(0, y - 40, EXIT_X, 40);
    ctx.fillStyle = live ? '#7ef0a8' : 'rgba(125, 139, 163, 0.8)';
    ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', EXIT_X / 2, y - 16);
}

function drawCars() {
    elevators.forEach((car, i) => {
        const top = car.y - CAR_H - camY;
        // Hoist cable, so a car hanging between floors still reads as a lift.
        // It hangs from the head of its own shaft, never through the floors above it.
        const head = floorY(SHAFTS[i].top) - FLOOR_H + SLAB_H;
        ctx.fillStyle = 'rgba(160, 185, 225, 0.35)';
        ctx.fillRect(car.x + car.w / 2 - 1, head - camY, 2, Math.max(0, car.y - CAR_H - head));

        ctx.fillStyle = '#39465c';
        ctx.fillRect(car.x + 2, top, car.w - 4, CAR_H);
        ctx.fillStyle = 'rgba(255, 228, 150, 0.14)';   // the lit interior
        ctx.fillRect(car.x + 6, top + 6, car.w - 12, CAR_H - 10);
        ctx.fillStyle = '#9db2d4';
        ctx.fillRect(car.x + 2, top, car.w - 4, 5);          // headboard
        ctx.fillRect(car.x + 2, car.y - camY - 4, car.w - 4, 4);  // deck
        ctx.fillStyle = 'rgba(12, 17, 26, 0.85)';
        ctx.fillRect(car.x + car.w / 2 - 1, top + 6, 2, CAR_H - 10);   // door seam
        ctx.strokeStyle = 'rgba(12, 17, 26, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(car.x + 2.5, top + 0.5, car.w - 5, CAR_H - 1);
    });
}

// One sprite routine for both the player and the agents: a coat, a head and two
// legs, drawn from the feet up so crouching is just a shorter body.
function drawFigure(x, y, h, facing, coat, skin) {
    const left = x - PLAYER_W / 2;
    const top = y - camY - h;
    const bodyH = Math.max(6, h - 10);

    ctx.fillStyle = coat;
    ctx.fillRect(left + 3, top + 8, PLAYER_W - 6, bodyH - 8);
    ctx.fillStyle = skin;
    ctx.fillRect(left + 6, top, PLAYER_W - 12, 9);
    ctx.fillStyle = '#131a26';
    ctx.fillRect(left + 4, top - 2, PLAYER_W - 8, 3);   // hat
    ctx.fillStyle = coat;
    ctx.fillRect(left + 4, y - camY - 8, 5, 8);
    ctx.fillRect(left + PLAYER_W - 9, y - camY - 8, 5, 8);
    // The gun arm, pointing the way the figure faces.
    ctx.fillStyle = '#d7dce6';
    const gunY = top + (h === CROUCH_H ? bodyH - 10 : 12);
    ctx.fillRect(facing > 0 ? left + PLAYER_W - 2 : left - 7, gunY, 9, 3);
}

function drawPlayer() {
    drawFigure(player.x, player.y, playerHeight(), player.facing, '#e8eef9', '#f0c59a');
}

function drawEnemies() {
    for (const e of enemies) {
        const y = e.y - camY;
        if (y < -FLOOR_H || y > CANVAS_H + FLOOR_H) continue;
        drawFigure(e.x, e.y, ENEMY_H, e.facing, '#ff5f56', '#f0c59a');
    }
}

function drawBullets() {
    ctx.fillStyle = '#ffe49a';
    for (const b of bullets) {
        const y = b.y - camY;
        if (y < -8 || y > CANVAS_H + 8) continue;
        ctx.fillRect(b.x - 3, y - 1, 6, 2);
    }
}

function drawBanner() {
    if (bannerTimer <= 0 || !banner) return;
    ctx.globalAlpha = Math.min(1, bannerTimer);
    ctx.fillStyle = '#ffe49a';
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner, CANVAS_W / 2, 40);
    ctx.globalAlpha = 1;
}

function drawMinimap() {
    // A slim column on the right showing where the player is in the building
    // and how far the lifts have travelled.
    const x = CANVAS_W - 12;
    ctx.fillStyle = 'rgba(120, 150, 200, 0.18)';
    ctx.fillRect(x, 10, 4, CANVAS_H - 20);
    const toBar = (worldY) => 10 + (worldY / WORLD_H) * (CANVAS_H - 20);
    ctx.fillStyle = 'rgba(255, 228, 150, 0.55)';
    for (const car of elevators) ctx.fillRect(x - 2, toBar(car.y) - 1, 8, 2);
    ctx.fillStyle = '#e8eef9';
    ctx.fillRect(x - 3, toBar(player.y) - 2, 10, 4);
}

function draw() {
    drawBackground();
    drawShafts();
    drawFloors();
    drawDoors();
    drawExit();
    drawCars();
    drawEnemies();
    drawPlayer();
    drawBullets();
    drawMinimap();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    d: 'right',
    w: 'up',
    s: 'down',
};

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        else shoot();
        return;
    }
    if (k === 'z' || k === 'x') {
        shoot();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    const dir = MOVE_KEYS[k] || MOVE_KEYS[e.key];
    if (dir) {
        e.preventDefault();
        keys[dir] = true;
    }
});

window.addEventListener('keyup', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const dir = MOVE_KEYS[k] || MOVE_KEYS[e.key];
    if (dir) keys[dir] = false;
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('elevatoraction-best') || '0', 10) || 0;
loadLevel(1);
state = 'idle';
updateHud();
showOverlay('ELEVATOR ACTION', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
