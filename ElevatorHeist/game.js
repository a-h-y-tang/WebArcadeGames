// ---------------------------------------------------------------------------
// Elevator Heist — a six-storey document grab on an HTML5 canvas.
//
// Two elevator shafts cut vertical gaps through every floor of the building,
// which leaves each floor split into three corridor segments. A gap is a hole
// you cannot walk into — unless a car happens to be level with your floor, in
// which case its roof is the floor and you step aboard. Boarding stops the
// car: it then goes only where you steer it, and resumes its patrol the moment
// you step off. Enemy agents never ride and never cross a shaft, so every
// corridor segment is its own little arena.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
//
// Positions are continuous rather than tile-based (the cars need sub-floor `y`
// values), but every interaction is decided by one of three small predicates:
// `gapAt(x)` — which shaft gap an x falls in, `carLevelFloor(car)` — which
// floor a car is level with, and `hits()` — whether a bullet meets a body.
// ---------------------------------------------------------------------------

// --- Building geometry ---------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 540;
const FLOORS = 6;
const FLOOR_H = 84;
const TOP_MARGIN = 10;
const SLAB_H = 10;              // thickness of the concrete between floors
const WALL_L = 22;
const WALL_R = 698;

const SHAFT_XS = [230, 470];    // centre of each shaft
const SHAFT_W = 56;
const LEVEL_EPS = 6;            // how close a car must be to count as "level"

// Door slots, chosen to sit clear of both shaft gaps.
const SLOT_XS = [80, 150, 330, 400, 560, 630];
const DOOR_W = 36;
const DOOR_H = 52;
const DOOR_REACH = 20;

const EXIT_X = 660;
const EXIT_W = 56;

// --- Bodies --------------------------------------------------------------
const PLAYER_W = 20;
const PLAYER_H = 36;
const CROUCH_H = 20;
const ENEMY_W = 20;
const ENEMY_H = 34;
const STAND_CHEST = 26;         // bullet height above the feet, standing
const CROUCH_CHEST = 12;        // ... and crouched
const CONTACT_DX = 14;

// --- Speeds (pixels per second) ------------------------------------------
const RUN_SPEED = 150;
const ELEVATOR_SPEED = 90;
const BULLET_SPEED = 420;
const ENEMY_BULLET_SPEED = 300;
const ENEMY_SPEED_BASE = 70;
const ENEMY_SPEED_STEP = 8;
const ENEMY_SPEED_CAP = 118;

// --- Gunfire -------------------------------------------------------------
const MAX_PLAYER_BULLETS = 2;
const SHOT_COOLDOWN = 0.25;
const ENEMY_RANGE = 320;
const ENEMY_FIRE_DELAY = 1.0;   // grace period after an agent appears
const ENEMY_FIRE_COOLDOWN = 1.4;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DOC_POINTS = 500;
const ENEMY_POINTS = 150;
const LEVEL_BONUS = 2000;
const DEATH_PAUSE = 1.3;
const CLEAR_PAUSE = 1.8;
const RESPAWN_GRACE = 1.6;      // untouchable while you find your feet
const ENEMY_CAP = 6;
const SPAWN_CLEARANCE = 80;     // no agent appears this close along your floor

// Door layouts, one string per floor, one character per slot in SLOT_XS:
// '.' nothing  'd' plain door  'D' red door holding a document.
const LEVELS = [
    ['.D..d.', 'd...D.', '.d.d..', '..D..d', 'd..d..', '.d.d..'],
    ['d...D.', '..d..d', 'D.d...', '.d...d', 'd..D..', '.d.d..'],
    ['..d.D.', 'D....d', '.d..d.', 'd...D.', '..d.d.', '.d.d..'],
];

const SPAWN_X = 70;

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const docsEl = document.getElementById('docs');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
let state = 'idle';             // idle | running | paused | dying | levelclear | over
let score = 0;
let lives = START_LIVES;
let level = 1;
let best = 0;
let docsTotal = 0;
let docsCollected = 0;

let player = null;
let doors = [];
let elevators = [];
let enemies = [];
let bullets = [];

let deathTimer = 0;
let clearTimer = 0;
let spawnTimer = 0;
let blink = 0;                  // drives the "exit open" flash

const keys = { left: false, right: false, up: false, down: false };

// Test hooks: `autoStep` hands time to the spec, `autoSpawn` silences the
// agent spawner, `autoElevators` parks the unoccupied cars, and
// `enemyShotsForTest` counts shots that have already left the screen.
let autoStep = true;
let autoSpawn = true;
let autoElevators = true;
let enemyShotsForTest = 0;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The walking surface (feet level) of a floor; floor 0 is the top one.
function floorY(f) {
    return TOP_MARGIN + (f + 1) * FLOOR_H;
}

function floorIndexAt(y) {
    return clamp(Math.round((y - TOP_MARGIN) / FLOOR_H) - 1, 0, FLOORS - 1);
}

// Which shaft gap this x sits inside, or -1 for solid floor. The edges are
// exclusive, so an x clamped exactly onto a lip counts as standing on floor.
function gapAt(x) {
    for (let i = 0; i < SHAFT_XS.length; i++) {
        if (x > SHAFT_XS[i] - SHAFT_W / 2 && x < SHAFT_XS[i] + SHAFT_W / 2) return i;
    }
    return -1;
}

function gapLeft(i) {
    return SHAFT_XS[i] - SHAFT_W / 2;
}

function gapRight(i) {
    return SHAFT_XS[i] + SHAFT_W / 2;
}

// The floor a car can be stepped on and off at, or null between floors.
function carLevelFloor(car) {
    for (let f = 0; f < FLOORS; f++) {
        if (Math.abs(car.y - floorY(f)) <= LEVEL_EPS) return f;
    }
    return null;
}

function playerFloor() {
    if (player.onElevator) {
        const f = carLevelFloor(player.onElevator);
        if (f !== null) return f;
    }
    return floorIndexAt(player.y);
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_CAP, ENEMY_SPEED_BASE + ENEMY_SPEED_STEP * (level - 1));
}

function maxEnemies() {
    return Math.min(ENEMY_CAP, 1 + level);
}

function spawnInterval() {
    return Math.max(1.2, 3.2 - 0.3 * (level - 1));
}

// ---------------------------------------------------------------------------
// Level set-up
// ---------------------------------------------------------------------------

function loadLevel(n) {
    const layout = LEVELS[(n - 1) % LEVELS.length];
    doors = [];
    for (let f = 0; f < FLOORS; f++) {
        const row = layout[f] || '';
        for (let s = 0; s < SLOT_XS.length; s++) {
            const c = row[s];
            if (c !== 'd' && c !== 'D') continue;
            doors.push({ floor: f, x: SLOT_XS[s], doc: c === 'D', open: false, collected: false });
        }
    }
    docsTotal = doors.filter((d) => d.doc).length;
    docsCollected = 0;

    elevators = [
        { shaft: 0, x: SHAFT_XS[0], y: floorY(2), dir: 1 },
        { shaft: 1, x: SHAFT_XS[1], y: floorY(4), dir: -1 },
    ];

    enemies = [];
    bullets = [];
    player = { x: SPAWN_X, y: floorY(0), dir: 1, crouch: false, onElevator: null, cooldown: 0, grace: 0 };
    spawnTimer = spawnInterval();
}

function placePlayer(floor, x) {
    player.x = x;
    player.y = floorY(floor);
    player.onElevator = null;
    player.crouch = false;
    player.cooldown = 0;
    player.grace = 0;
}

function rideForTest(shaft) {
    const car = elevators[shaft];
    player.onElevator = car;
    player.x = car.x;
    player.y = car.y;
    player.crouch = false;
}

function collectAllDocsForTest() {
    for (const d of doors) {
        if (d.doc && !d.collected) {
            d.collected = true;
            d.open = true;
            docsCollected++;
        }
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Run control
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    enemyShotsForTest = 0;
    keys.left = keys.right = keys.up = keys.down = false;
    loadLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or Space to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function killPlayer() {
    if (state !== 'running') return;
    if (player.grace > 0) return;
    lives--;
    bullets = [];
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
}

function respawn() {
    enemies = [];
    bullets = [];
    placePlayer(0, SPAWN_X);
    player.dir = 1;
    player.grace = RESPAWN_GRACE;
    spawnTimer = spawnInterval();
    state = 'running';
    hideOverlay();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('elevatorheist-best', String(best));
        } catch (e) {
            /* private mode — the best score simply does not persist */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function clearLevel() {
    score += LEVEL_BONUS;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    updateHud();
}

function nextLevel() {
    level++;
    loadLevel(level);
    state = 'running';
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            if (lives <= 0) gameOver();
            else respawn();
        }
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    blink += dt;
    updateElevators(dt);
    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    checkContact();
    checkDoors();
    checkExit();
    updateSpawner(dt);
}

// A car with a passenger does only what the passenger asks; an empty one
// patrols the full height of its shaft, which is what stops the building from
// deadlocking with every car parked out of reach.
function updateElevators(dt) {
    const top = floorY(0);
    const bottom = floorY(FLOORS - 1);
    for (const car of elevators) {
        const ridden = player.onElevator === car;
        if (ridden) {
            if (keys.up) car.dir = -1;
            else if (keys.down) car.dir = 1;
            else continue;
        } else if (!autoElevators) {
            continue;
        }
        car.y += car.dir * ELEVATOR_SPEED * dt;
        if (car.y <= top) {
            car.y = top;
            car.dir = 1;
        } else if (car.y >= bottom) {
            car.y = bottom;
            car.dir = -1;
        }
    }
}

function updatePlayer(dt) {
    if (state !== 'running') return;

    // Crouching only makes sense on a floor: in a car, down is a command.
    player.crouch = keys.down && !player.onElevator;
    if (player.cooldown > 0) player.cooldown -= dt;
    if (player.grace > 0) player.grace -= dt;

    let dx = 0;
    if (!player.crouch) {
        if (keys.left) dx -= RUN_SPEED * dt;
        if (keys.right) dx += RUN_SPEED * dt;
    }
    if (dx !== 0) {
        player.dir = dx > 0 ? 1 : -1;
        moveX(dx);
    }
    if (player.onElevator) player.y = player.onElevator.y;
}

function moveX(dx) {
    const lo = WALL_L + PLAYER_W / 2;
    const hi = WALL_R - PLAYER_W / 2;
    const nx = clamp(player.x + dx, lo, hi);
    const gap = gapAt(nx);

    if (player.onElevator) {
        const car = player.onElevator;
        if (gap === car.shaft) {
            player.x = nx;              // still inside the car
            return;
        }
        const lf = carLevelFloor(car);
        if (lf === null) {
            // Penned in between floors: hug the inside of the gap.
            player.x = clamp(nx, gapLeft(car.shaft) + 0.5, gapRight(car.shaft) - 0.5);
            return;
        }
        if (gap >= 0) {
            // Walking straight from one car into the other, if it is level too.
            const other = elevators[gap];
            if (carLevelFloor(other) === lf) {
                player.x = nx;
                player.y = other.y;
                player.onElevator = other;
                return;
            }
            player.x = dx > 0 ? gapLeft(gap) : gapRight(gap);
            player.onElevator = null;
            player.y = floorY(lf);
            return;
        }
        player.x = nx;                  // out onto the corridor
        player.onElevator = null;
        player.y = floorY(lf);
        return;
    }

    if (gap >= 0) {
        const car = elevators[gap];
        if (carLevelFloor(car) === floorIndexAt(player.y)) {
            player.x = nx;              // the car's roof is the floor here
            player.y = car.y;
            player.onElevator = car;
            return;
        }
        player.x = dx > 0 ? gapLeft(gap) : gapRight(gap);
        return;
    }
    player.x = nx;
}

function shoot() {
    if (state !== 'running') return false;
    if (player.cooldown > 0) return false;
    if (bullets.filter((b) => b.from === 'player').length >= MAX_PLAYER_BULLETS) return false;
    bullets.push({
        x: player.x + player.dir * (PLAYER_W / 2 + 4),
        y: player.y - (player.crouch ? CROUCH_CHEST : STAND_CHEST),
        vx: player.dir * BULLET_SPEED,
        from: 'player',
    });
    player.cooldown = SHOT_COOLDOWN;
    return true;
}

function spawnEnemy(floor, x, dir) {
    const e = {
        x,
        y: floorY(floor),
        dir: dir || 1,
        cooldown: ENEMY_FIRE_DELAY,
        frozen: false,
        age: 0,
    };
    enemies.push(e);
    return e;
}

function updateEnemies(dt) {
    if (state !== 'running') return;
    const speed = enemySpeed();
    for (const e of enemies) {
        e.age += dt;
        e.cooldown -= dt;
        const sameFloor = Math.abs(e.y - player.y) < 4;
        if (sameFloor) {
            const toward = Math.sign(player.x - e.x);
            if (toward !== 0) e.dir = toward;
        }

        if (!e.frozen) {
            const nx = e.x + e.dir * speed * dt;
            const blocked =
                nx < WALL_L + ENEMY_W / 2 || nx > WALL_R - ENEMY_W / 2 || gapAt(nx) >= 0;
            if (!blocked) e.x = nx;
            else if (!sameFloor) e.dir *= -1;   // patrol: turn back at the lip
        }

        if (
            sameFloor &&
            e.cooldown <= 0 &&
            Math.abs(player.x - e.x) < ENEMY_RANGE &&
            Math.sign(player.x - e.x) === e.dir
        ) {
            bullets.push({
                x: e.x + e.dir * (ENEMY_W / 2 + 4),
                y: e.y - STAND_CHEST,
                vx: e.dir * ENEMY_BULLET_SPEED,
                from: 'enemy',
            });
            e.cooldown = ENEMY_FIRE_COOLDOWN;
            enemyShotsForTest++;
        }
    }
}

// A bullet carries an absolute y, so meeting a body is purely a question of
// geometry — and a shot can never reach another floor.
function hits(b, x, y, w, h) {
    return Math.abs(b.x - x) <= w / 2 + 3 && b.y >= y - h && b.y <= y;
}

function updateBullets(dt) {
    if (state !== 'running') return;
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < -10 || b.x > CANVAS_W + 10) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.from === 'player') {
            let hitIndex = -1;
            for (let j = 0; j < enemies.length; j++) {
                const e = enemies[j];
                if (hits(b, e.x, e.y, ENEMY_W, ENEMY_H)) {
                    hitIndex = j;
                    break;
                }
            }
            if (hitIndex >= 0) {
                enemies.splice(hitIndex, 1);
                bullets.splice(i, 1);
                score += ENEMY_POINTS;
                updateHud();
            }
        } else if (hits(b, player.x, player.y, PLAYER_W, player.crouch ? CROUCH_H : PLAYER_H)) {
            bullets.splice(i, 1);
            killPlayer();
            return;
        }
    }
}

function checkContact() {
    if (state !== 'running') return;
    for (const e of enemies) {
        if (Math.abs(e.y - player.y) < 4 && Math.abs(e.x - player.x) < CONTACT_DX) {
            killPlayer();
            return;
        }
    }
}

function checkDoors() {
    if (state !== 'running') return;
    for (const d of doors) {
        if (!d.doc || d.collected) continue;
        if (Math.abs(player.y - floorY(d.floor)) > 3) continue;
        if (Math.abs(player.x - d.x) > DOOR_REACH) continue;
        d.collected = true;
        d.open = true;
        docsCollected++;
        score += DOC_POINTS;
        updateHud();
    }
}

function checkExit() {
    if (state !== 'running') return;
    if (docsCollected < docsTotal) return;
    if (Math.abs(player.y - floorY(FLOORS - 1)) > 3) return;
    if (Math.abs(player.x - EXIT_X) > EXIT_W / 2) return;
    clearLevel();
}

function updateSpawner(dt) {
    if (state !== 'running' || !autoSpawn) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (enemies.length >= maxEnemies() || doors.length === 0) return;

    const pf = playerFloor();
    const near = doors.filter((d) => Math.abs(d.floor - pf) <= 2);
    const pool = near.length ? near : doors;
    const d = pool[Math.floor(Math.random() * pool.length)];
    // Never drop an agent straight on top of the player.
    if (Math.abs(floorY(d.floor) - player.y) < 4 && Math.abs(d.x - player.x) < SPAWN_CLEARANCE) return;
    spawnEnemy(d.floor, d.x, Math.sign(player.x - d.x) || 1);
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    docsEl.textContent = `${docsCollected}/${docsTotal}`;
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub || '';
    overlaySub.textContent = hint || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Night sky behind the building.
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#0b1020');
    sky.addColorStop(1, '#141a2b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBuilding();
    drawShafts();
    drawDoors();
    drawExit();
    drawElevators();
    drawEnemies();
    drawBullets();
    drawPlayer();
    drawFrame();
}

function drawBuilding() {
    ctx.fillStyle = '#1b2436';
    ctx.fillRect(WALL_L, TOP_MARGIN, WALL_R - WALL_L, floorY(FLOORS - 1) + 26 - TOP_MARGIN);

    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);

        // Wallpaper band for the corridor above this slab.
        ctx.fillStyle = f % 2 ? '#202a40' : '#243049';
        ctx.fillRect(WALL_L, y - FLOOR_H + SLAB_H, WALL_R - WALL_L, FLOOR_H - SLAB_H);

        // Skirting glow, so the walkable line reads clearly.
        ctx.fillStyle = 'rgba(255, 212, 120, 0.09)';
        ctx.fillRect(WALL_L, y - 7, WALL_R - WALL_L, 7);

        // The slab itself.
        ctx.fillStyle = '#39465f';
        ctx.fillRect(WALL_L, y, WALL_R - WALL_L, SLAB_H);
        ctx.fillStyle = '#4b5a78';
        ctx.fillRect(WALL_L, y, WALL_R - WALL_L, 2);
    }
}

function drawShafts() {
    for (let i = 0; i < SHAFT_XS.length; i++) {
        const x = gapLeft(i);
        ctx.fillStyle = '#080c16';
        ctx.fillRect(x, TOP_MARGIN, SHAFT_W, floorY(FLOORS - 1) + SLAB_H - TOP_MARGIN);

        // Guide rails.
        ctx.fillStyle = '#2b3550';
        ctx.fillRect(x + 4, TOP_MARGIN, 3, floorY(FLOORS - 1) + SLAB_H - TOP_MARGIN);
        ctx.fillRect(x + SHAFT_W - 7, TOP_MARGIN, 3, floorY(FLOORS - 1) + SLAB_H - TOP_MARGIN);

        // Lips, which is where a blocked player comes to rest.
        for (let f = 0; f < FLOORS; f++) {
            ctx.fillStyle = '#5b6d92';
            ctx.fillRect(x - 3, floorY(f) - 3, 3, SLAB_H + 3);
            ctx.fillRect(x + SHAFT_W, floorY(f) - 3, 3, SLAB_H + 3);
        }
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor);
        const x = d.x - DOOR_W / 2;
        const top = y - DOOR_H;

        ctx.fillStyle = '#121a2a';
        ctx.fillRect(x - 3, top - 3, DOOR_W + 6, DOOR_H + 3);

        if (d.open) {
            const glow = ctx.createLinearGradient(0, top, 0, y);
            glow.addColorStop(0, d.doc ? '#ffe9a8' : '#cfe0ff');
            glow.addColorStop(1, '#6b5c2a');
            ctx.fillStyle = glow;
            ctx.fillRect(x, top, DOOR_W, DOOR_H);
        } else {
            ctx.fillStyle = d.doc ? '#b8333a' : '#3f4f72';
            ctx.fillRect(x, top, DOOR_W, DOOR_H);
            ctx.fillStyle = d.doc ? '#d9535a' : '#51648d';
            ctx.fillRect(x, top, DOOR_W, 6);
            ctx.fillStyle = '#d8c98a';
            ctx.fillRect(x + DOOR_W - 8, y - DOOR_H / 2, 4, 4);
            if (d.doc) {
                // A sliver of paper showing round the edge.
                ctx.fillStyle = '#f2ead0';
                ctx.fillRect(x + 6, y - 16, 10, 12);
            }
        }
    }
}

function drawExit() {
    const y = floorY(FLOORS - 1);
    const x = EXIT_X - EXIT_W / 2;
    const armed = docsCollected >= docsTotal && docsTotal > 0;
    const pulse = armed ? 0.55 + 0.45 * Math.abs(Math.sin(blink * 3)) : 0.25;

    ctx.fillStyle = `rgba(86, 226, 150, ${pulse * 0.5})`;
    ctx.fillRect(x, y - 58, EXIT_W, 58);
    ctx.fillStyle = `rgba(16, 32, 26, ${armed ? 0.3 : 0.75})`;
    ctx.fillRect(x + 5, y - 52, EXIT_W - 10, 52);

    ctx.fillStyle = `rgba(120, 255, 190, ${pulse})`;
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', EXIT_X, y - 58 - 6);
    ctx.textAlign = 'left';
}

function drawElevators() {
    for (const car of elevators) {
        const x = gapLeft(car.shaft) + 4;
        const w = SHAFT_W - 8;
        const h = 58;
        const top = car.y - h;

        // Cable.
        ctx.strokeStyle = '#3a4762';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(car.x, TOP_MARGIN);
        ctx.lineTo(car.x, top);
        ctx.stroke();

        ctx.fillStyle = '#6f7d9b';
        ctx.fillRect(x, top, w, h);
        ctx.fillStyle = '#9aa8c6';
        ctx.fillRect(x, top, w, 4);
        ctx.fillStyle = '#2d3850';
        ctx.fillRect(x + 3, top + 8, w - 6, h - 14);
        ctx.fillStyle = '#48567a';
        ctx.fillRect(car.x - 1, top + 8, 2, h - 14);

        // The roof is the surface a rider stands on.
        ctx.fillStyle = carLevelFloor(car) === null ? '#8d9ab8' : '#ffd447';
        ctx.fillRect(x, car.y - 3, w, 3);
    }
}

function drawPlayer() {
    if (!player) return;
    const h = player.crouch ? CROUCH_H : PLAYER_H;
    const x = player.x;
    const y = player.y;
    const dying = state === 'dying';

    ctx.save();
    if (dying) ctx.globalAlpha = 0.45;
    else if (player.grace > 0) ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(player.grace * 18));

    // Coat.
    ctx.fillStyle = '#e9eef8';
    ctx.fillRect(x - PLAYER_W / 2, y - h, PLAYER_W, h - (player.crouch ? 2 : 10));

    // Legs.
    if (!player.crouch) {
        ctx.fillStyle = '#2b3450';
        ctx.fillRect(x - 7, y - 10, 5, 10);
        ctx.fillRect(x + 2, y - 10, 5, 10);
    }

    // Head and hat brim.
    ctx.fillStyle = '#f6d9b0';
    ctx.beginPath();
    ctx.arc(x + player.dir * 2, y - h - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d2740';
    ctx.fillRect(x - 9 + player.dir * 2, y - h - 9, 18, 3);
    ctx.fillRect(x - 5 + player.dir * 2, y - h - 14, 11, 5);

    // Arm, levelled with wherever the next shot would leave.
    const chest = player.crouch ? CROUCH_CHEST : STAND_CHEST;
    ctx.fillStyle = '#cdd6e8';
    ctx.fillRect(player.dir > 0 ? x + 4 : x - 14, y - chest - 2, 10, 4);

    ctx.restore();
}

function drawEnemies() {
    for (const e of enemies) {
        const x = e.x;
        const y = e.y;
        ctx.fillStyle = '#1f2740';
        ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H, ENEMY_W, ENEMY_H - 9);
        ctx.fillStyle = '#121828';
        ctx.fillRect(x - 7, y - 9, 5, 9);
        ctx.fillRect(x + 2, y - 9, 5, 9);
        ctx.fillStyle = '#e0565f';
        ctx.fillRect(x - 1, y - ENEMY_H + 4, 3, 10);
        ctx.fillStyle = '#d8b48c';
        ctx.beginPath();
        ctx.arc(x + e.dir * 2, y - ENEMY_H - 5, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0e1322';
        ctx.fillRect(x - 8 + e.dir * 2, y - ENEMY_H - 10, 17, 4);
        ctx.fillStyle = '#2b3450';
        ctx.fillRect(e.dir > 0 ? x + 4 : x - 14, y - STAND_CHEST - 2, 10, 4);
    }
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.from === 'player' ? '#ffe9a0' : '#ff8d7a';
        ctx.fillRect(b.x - 4, b.y - 1.5, 8, 3);
    }
}

function drawFrame() {
    ctx.strokeStyle = '#4d5d80';
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL_L - 1, TOP_MARGIN - 1, WALL_R - WALL_L + 2, floorY(FLOORS - 1) + 27 - TOP_MARGIN);

    if (state === 'running' && docsCollected >= docsTotal && docsTotal > 0) {
        ctx.fillStyle = `rgba(120, 255, 190, ${0.5 + 0.5 * Math.abs(Math.sin(blink * 3))})`;
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ALL DOCUMENTS — GET TO THE GROUND FLOOR EXIT', CANVAS_W / 2, CANVAS_H - 8);
        ctx.textAlign = 'left';
    }
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
    if (k === 'j') {
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

best = parseInt(localStorage.getItem('elevatorheist-best') || '0', 10) || 0;
loadLevel(1);
state = 'idle';
updateHud();
showOverlay('ELEVATOR HEIST', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
