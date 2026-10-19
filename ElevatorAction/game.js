// Elevator Action — break into a six-storey building, take every secret
// document and ride the elevators down to the exit while agents shoot back.
//
// The simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, player, elevators, doors, enemies,
// bullets) is kept at the top level on purpose: the Playwright suite drives
// the game through exactly these names. There is no randomness anywhere — a
// level number fully determines its building. See DESIGN.md for the rules.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const H = canvas.height;             // 640
const DT = 1 / 120;                  // fixed simulation timestep, seconds
const EPS = 0.001;                   // "level with a floor" tolerance, px

// --- building geometry -----------------------------------------------------

const FLOOR_COUNT = 6;
const FLOOR_TOP = 108;               // y of the top floor's surface
const FLOOR_H = 92;
const SLAB_H = 7;                    // thickness drawn under a floor surface
const WALL_L = 28;
const WALL_R = 452;
const ROOF_Y = FLOOR_TOP - 56;

const SHAFT_XS = [150, 330];         // shaft centres
const SHAFT_W = 54;
const ELEVATOR_SPEED = 95;           // px/s while a rider holds up or down — about a floor a second

const DOOR_W = 30;
const DOOR_H = 46;
const DOOR_X = [68, 105, 215, 265, 395, 430];

const EXIT_W = 56;
const exitZone = { x: WALL_R - EXIT_W, w: EXIT_W, floor: FLOOR_COUNT - 1 };

// --- actors ----------------------------------------------------------------

const PLAYER_W = 16;
const PLAYER_H = 34;
const CROUCH_H = 20;
const PLAYER_SPEED = 110;            // px/s

const ENEMY_W = 18;
const ENEMY_H = 32;

const BULLET_SPEED = 320;            // px/s, the player's shots
const ENEMY_BULLET_SPEED = 224;      // px/s, slower so they can be outrun
const BULLET_HIGH = 22;              // px above the floor — chest height
const BULLET_LOW = 10;               // px above the floor — fired crouched
const BULLET_R = 3;
const MAX_PLAYER_BULLETS = 3;

// --- rules -----------------------------------------------------------------

const START_LIVES = 3;
const INVULN_TIME = 1.5;             // seconds of immunity after a respawn
const LEVEL_COUNT = 5;

const DOC_POINTS = 300;
const ENEMY_POINTS = 150;
const CLEAR_BONUS = 500;
const LIFE_BONUS = 200;              // per life still in hand when a level ends

const BEST_KEY = 'elevatoraction-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = loadBest();
let config = levelConfig(1);         // pacing for the current level
let doors = [];
let elevators = [];
let enemies = [];
let bullets = [];
let sparks = [];                     // short-lived hit flashes, cosmetic only
let spawnTimer = 0;
let spawnCursor = 0;                 // round-robin index into the agent doors
let autoRun = true;                  // the animation loop only simulates while true
const keys = Object.create(null);

let player = makePlayer();

// --- geometry helpers ------------------------------------------------------

function floorY(i) {
    return FLOOR_TOP + i * FLOOR_H;
}

// The floor a car at y is closest to — where it settles when let go.
function nearestFloor(y) {
    const i = Math.round((y - FLOOR_TOP) / FLOOR_H);
    return Math.max(0, Math.min(FLOOR_COUNT - 1, i));
}

// Which floor a y sits exactly on, or -1 for a car between two floors.
function floorAt(y) {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        if (Math.abs(y - floorY(i)) < EPS) return i;
    }
    return -1;
}

function clampX(x, half) {
    return Math.max(WALL_L + half, Math.min(WALL_R - half, x));
}

// --- level construction ----------------------------------------------------

function levelConfig(n) {
    return {
        spawnInterval: Math.max(1.2, 3.4 - (n - 1) * 0.4),
        enemySpeed: 46 + (n - 1) * 8,
        fireInterval: Math.max(0.9, 2.0 - (n - 1) * 0.2),
        maxEnemies: Math.min(8, 3 + (n - 1)),
    };
}

// Door kinds come from an index formula rather than a random draw, so every
// run of a level is the same building: one slot in five is a document, one in
// five is an agent door, and the level number shifts the whole pattern.
function buildDoors(n) {
    const list = [];
    for (let f = 0; f < FLOOR_COUNT; f++) {
        for (let k = 0; k < DOOR_X.length; k++) {
            const kind = (f * DOOR_X.length + k + (n - 1) * 7) % 5;
            if (kind !== 0 && kind !== 2) continue;
            list.push({
                x: DOOR_X[k],
                floor: f,
                type: kind === 0 ? 'document' : 'enemy',
                collected: false,
                flash: 0,
            });
        }
    }
    return list;
}

// The player drops in at the left edge of the roof floor, clear of the
// nearest door so a level never opens by handing out a free document.
function makePlayer(invuln = 0) {
    return {
        x: WALL_L + 8,
        y: floorY(0),
        floor: 0,
        dir: 1,
        crouch: false,
        inCar: null,
        carLock: false,              // true right after boarding, until the walk key is released
        invuln,
        walk: 0,                     // stride phase, cosmetic only
    };
}

function makeEnemy(x, floor, dir) {
    return {
        x,
        y: floorY(floor),
        floor,
        dir,
        cooldown: config.fireInterval,
        spawnX: x,
        walk: 0,
    };
}

function makeEnemyBullet(x, floor, dir) {
    return {
        x,
        y: floorY(floor) - BULLET_HIGH,
        vx: dir * ENEMY_BULLET_SPEED,
        floor,
        low: false,
        from: 'enemy',
    };
}

function buildLevel(n) {
    config = levelConfig(n);
    doors = buildDoors(n);
    elevators = SHAFT_XS.map((x, i) => ({
        x,
        y: floorY(i === 0 ? 0 : FLOOR_COUNT - 1),
    }));
    enemies = [];
    bullets = [];
    sparks = [];
    spawnTimer = config.spawnInterval;
    spawnCursor = 0;
    player = makePlayer();
    updateHud();
}

function docsRemaining() {
    return doors.filter((d) => d.type === 'document' && !d.collected).length;
}

// --- game flow -------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    buildLevel(1);
    state = 'running';
    updateHud();
}

function nextLevel() {
    level++;
    buildLevel(level);
    state = 'running';
    updateHud();
}

function completeLevel() {
    score += CLEAR_BONUS + LIFE_BONUS * lives;
    saveBest();
    state = level >= LEVEL_COUNT ? 'won' : 'levelclear';
    updateHud();
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    bullets.length = 0;
    if (lives === 0) {
        state = 'gameover';
        saveBest();
    } else {
        player = makePlayer(INVULN_TIME);
    }
    updateHud();
}

function togglePause() {
    if (state === 'running') state = 'paused';
    else if (state === 'paused') state = 'running';
    else return;
    updateHud();
}

// Space and the overlay button both land here: start, resume, fire, or move on
// to whatever comes after the current overlay.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'levelclear':
            nextLevel();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            fire();
            break;
    }
}

function fire() {
    if (state !== 'running') return;
    if (bullets.filter((b) => b.from === 'player').length >= MAX_PLAYER_BULLETS) return;
    bullets.push({
        x: player.x + player.dir * 10,
        y: player.y - (player.crouch ? BULLET_LOW : BULLET_HIGH),
        vx: player.dir * BULLET_SPEED,
        floor: player.floor,
        low: player.crouch,
        from: 'player',
    });
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    updatePlayer(dt);
    updateEnemies(dt);
    updateBullets(dt);
    updateSpawns(dt);
    updateSparks(dt);

    if (state !== 'running') return;  // a hit during the step ended the run

    checkContact();
    checkExit();

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    updateHud();
}

function updatePlayer(dt) {
    const left = !!(keys['ArrowLeft'] || keys['KeyA']);
    const right = !!(keys['ArrowRight'] || keys['KeyD']);
    const up = !!(keys['ArrowUp'] || keys['KeyW']);
    const down = !!(keys['ArrowDown'] || keys['KeyS']);

    if (player.inCar !== null) {
        rideCar(dt, { left, right, up, down });
        return;
    }

    player.crouch = down;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (dir !== 0) player.dir = dir;

    if (dir !== 0 && !player.crouch) {
        walk(dir * PLAYER_SPEED * dt);
        player.walk += Math.abs(dir) * dt;
    }

    collectDocuments();
}

// Move along a floor. A shaft is a wall unless its car is parked level with
// the floor, in which case walking into it boards the car.
function walk(dx) {
    const half = PLAYER_W / 2;
    let x = clampX(player.x + dx, half);

    for (let i = 0; i < elevators.length; i++) {
        const car = elevators[i];
        const l = car.x - SHAFT_W / 2;
        const r = car.x + SHAFT_W / 2;
        if (!(x + half > l && x - half < r)) continue;

        if (Math.abs(car.y - player.y) < EPS) {
            player.inCar = i;
            player.x = car.x;
            player.y = car.y;
            player.floor = floorAt(car.y);
            player.crouch = false;
            // Hold the rider in the car: the key that walked them in must be
            // released before it can walk them back out, otherwise holding a
            // direction would carry them straight through the shaft.
            player.carLock = true;
            return;
        }
        x = dx > 0 ? l - half : r + half;
    }

    player.x = x;
}

function rideCar(dt, k) {
    const car = elevators[player.inCar];

    const travel = ELEVATOR_SPEED * dt;
    if (k.up) {
        car.y = Math.max(floorY(0), car.y - travel);
    } else if (k.down) {
        car.y = Math.min(floorY(FLOOR_COUNT - 1), car.y + travel);
    } else {
        // Let go of the controls and the car settles on the nearest floor, so
        // lining up with a landing is a matter of timing, not pixel accuracy.
        const target = floorY(nearestFloor(car.y));
        const gap = target - car.y;
        car.y = Math.abs(gap) <= travel ? target : car.y + Math.sign(gap) * travel;
    }

    player.x = car.x;
    player.y = car.y;
    player.floor = floorAt(car.y);
    player.crouch = false;

    if (!k.left && !k.right) player.carLock = false;

    // Stepping sideways out of a car only works when it is level with a floor.
    if ((k.left || k.right) && !player.carLock && player.floor >= 0) {
        player.inCar = null;
        player.dir = k.right ? 1 : -1;
        player.x = clampX(car.x + player.dir * (SHAFT_W / 2 + PLAYER_W / 2), PLAYER_W / 2);
    }

    collectDocuments();
}

function collectDocuments() {
    if (player.floor < 0) return;
    const reach = DOOR_W / 2 + PLAYER_W / 2;
    for (const d of doors) {
        if (d.type !== 'document' || d.collected) continue;
        if (d.floor !== player.floor) continue;
        if (Math.abs(d.x - player.x) > reach) continue;
        d.collected = true;
        d.flash = 0.6;
        score += DOC_POINTS;
    }
}

function updateEnemies(dt) {
    for (const e of enemies) {
        const half = ENEMY_W / 2;
        const x = e.x + e.dir * config.enemySpeed * dt;

        let blocked = x - half < WALL_L || x + half > WALL_R;
        for (const car of elevators) {
            if (x + half > car.x - SHAFT_W / 2 && x - half < car.x + SHAFT_W / 2) blocked = true;
        }

        if (blocked) {
            e.dir = -e.dir;
        } else {
            e.x = x;
            e.walk += dt;
        }

        e.cooldown -= dt;
        if (e.cooldown <= 0 && seesPlayer(e)) {
            bullets.push(makeEnemyBullet(e.x + e.dir * 12, e.floor, e.dir));
            e.cooldown = config.fireInterval;
        }
    }
}

// An agent shoots only along its own floor, and only forwards.
function seesPlayer(e) {
    return player.floor === e.floor && Math.sign(player.x - e.x) === e.dir;
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;

        if (b.x < WALL_L || b.x > WALL_R) {
            bullets.splice(i, 1);
            continue;
        }

        if (b.from === 'player') {
            const hit = enemies.findIndex(
                (e) => e.floor === b.floor && Math.abs(e.x - b.x) <= ENEMY_W / 2 + BULLET_R
            );
            if (hit >= 0) {
                sparks.push({ x: enemies[hit].x, y: enemies[hit].y - ENEMY_H / 2, life: 0.35 });
                enemies.splice(hit, 1);
                bullets.splice(i, 1);
                score += ENEMY_POINTS;
            }
            continue;
        }

        // Enemy fire is always chest high: it sails over a crouching player.
        if (player.invuln > 0 || player.floor !== b.floor) continue;
        if (Math.abs(player.x - b.x) > PLAYER_W / 2 + BULLET_R) continue;
        const top = player.y - (player.crouch ? CROUCH_H : PLAYER_H);
        if (b.y < top || b.y > player.y) continue;

        bullets.splice(i, 1);
        sparks.push({ x: player.x, y: player.y - PLAYER_H / 2, life: 0.35 });
        loseLife();
        return;
    }
}

function updateSpawns(dt) {
    const spawners = doors.filter((d) => d.type === 'enemy');
    if (!spawners.length) return;

    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    spawnTimer = config.spawnInterval;
    if (enemies.length >= config.maxEnemies) return;

    const door = spawners[spawnCursor % spawners.length];
    spawnCursor++;
    door.flash = 0.5;
    enemies.push(makeEnemy(door.x, door.floor, door.x > W / 2 ? -1 : 1));
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i].life -= dt;
        if (sparks[i].life <= 0) sparks.splice(i, 1);
    }
    for (const d of doors) {
        if (d.flash > 0) d.flash = Math.max(0, d.flash - dt);
    }
}

function checkContact() {
    if (player.invuln > 0 || player.floor < 0) return;
    for (const e of enemies) {
        if (e.floor !== player.floor) continue;
        if (Math.abs(e.x - player.x) <= (PLAYER_W + ENEMY_W) / 2) {
            loseLife();
            return;
        }
    }
}

function atExit() {
    return (
        player.inCar === null &&
        player.floor === exitZone.floor &&
        player.x >= exitZone.x &&
        player.x <= exitZone.x + exitZone.w
    );
}

function checkExit() {
    if (docsRemaining() > 0) return;
    if (!atExit()) return;
    completeLevel();
}

// --- best score ------------------------------------------------------------

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
        /* private mode: keep the best score in memory only */
    }
}

// --- HUD and overlay -------------------------------------------------------

const hudCache = Object.create(null);

function setText(id, value) {
    if (hudCache[id] === value) return;
    hudCache[id] = value;
    document.getElementById(id).textContent = value;
}

function updateHud() {
    setText('score', String(score));
    setText('level', String(level));
    setText('lives', String(lives));
    setText('docs', String(docsRemaining()));
    setText('best', String(best));
    updateOverlay();
}

function updateOverlay() {
    const overlay = document.getElementById('overlay');
    if (state === 'running') {
        overlay.classList.remove('visible');
        return;
    }
    overlay.classList.add('visible');

    let title = 'ELEVATOR ACTION';
    let line = '';
    let sub = 'Press Space or click Start to play';
    let button = 'Start Game';

    switch (state) {
        case 'paused':
            title = 'PAUSED';
            line = `Score ${score}`;
            sub = 'Press P or Space to resume';
            button = 'Resume';
            break;
        case 'levelclear':
            title = `BUILDING ${level} CLEAR`;
            line = `Score ${score}`;
            sub = 'Press Space for the next building';
            button = 'Next Building';
            break;
        case 'gameover':
            title = 'GAME OVER';
            line = `Score ${score} · Best ${best}`;
            sub = 'Press Space to try again';
            button = 'Play Again';
            break;
        case 'won':
            title = 'YOU WIN';
            line = `Score ${score} · Best ${best}`;
            sub = 'Every building cleared — press Space to run it again';
            button = 'Play Again';
            break;
        default:
            line = best > 0 ? `Best ${best}` : '';
            break;
    }

    setText('overlay-title', title);
    setText('overlay-score', line);
    setText('overlay-sub', sub);
    setText('btn-start', button);
}

// --- rendering -------------------------------------------------------------

function draw() {
    drawBackdrop();
    drawShafts();
    drawFloors();
    drawDoors();
    drawExit();
    drawCars();
    enemies.forEach(drawEnemy);
    drawPlayer();
    bullets.forEach(drawBullet);
    drawSparks();
    drawFrame();
}

function drawBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1120');
    sky.addColorStop(1, '#101a2e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // a distant block of lit windows, well above the building we are in
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(0, 0, W, ROOF_Y - 6);
    ctx.fillStyle = 'rgba(248, 213, 126, 0.10)';
    for (let i = 0; i < 26; i++) {
        if ((i * 7) % 5 === 0) continue;
        ctx.fillRect(10 + (i % 13) * 36, 10 + Math.floor(i / 13) * 20, 14, 10);
    }

    // the street the exit opens onto
    const groundY = floorY(FLOOR_COUNT - 1) + SLAB_H;
    ctx.fillStyle = '#0a1120';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = '#16213a';
    ctx.fillRect(0, groundY + 28, W, 4);

    // the building shell, with a floor-by-floor wall panel behind the action
    ctx.fillStyle = '#131c30';
    ctx.fillRect(WALL_L - 10, ROOF_Y, WALL_R - WALL_L + 20, groundY + 17 - ROOF_Y);

    ctx.fillStyle = '#16203a';
    for (let i = 0; i < FLOOR_COUNT; i++) {
        ctx.fillRect(WALL_L, floorY(i) - FLOOR_H + SLAB_H + 10, WALL_R - WALL_L, FLOOR_H - 18);
    }

    ctx.fillStyle = 'rgba(96, 165, 250, 0.07)';
    for (let i = 0; i < FLOOR_COUNT; i++) {
        const y = floorY(i) - 62;
        for (let x = WALL_L + 12; x < WALL_R - 20; x += 46) {
            if (SHAFT_XS.some((sx) => Math.abs(sx - x) < SHAFT_W)) continue;
            ctx.fillRect(x, y, 26, 14);
        }
    }

    // roof parapet
    ctx.fillStyle = '#1b2742';
    ctx.fillRect(WALL_L - 10, ROOF_Y, WALL_R - WALL_L + 20, 12);
}

function drawShafts() {
    for (const car of elevators) {
        const x = car.x - SHAFT_W / 2;
        ctx.fillStyle = '#0a0f1c';
        ctx.fillRect(x, ROOF_Y + 10, SHAFT_W, floorY(FLOOR_COUNT - 1) - ROOF_Y - 10);
        ctx.strokeStyle = '#223050';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(car.x - 10, ROOF_Y + 10);
        ctx.lineTo(car.x - 10, floorY(FLOOR_COUNT - 1));
        ctx.moveTo(car.x + 10, ROOF_Y + 10);
        ctx.lineTo(car.x + 10, floorY(FLOOR_COUNT - 1));
        ctx.stroke();
    }
}

function drawFloors() {
    for (let i = 0; i < FLOOR_COUNT; i++) {
        const y = floorY(i);
        for (const seg of floorSegments()) {
            ctx.fillStyle = '#24345a';
            ctx.fillRect(seg[0], y, seg[1] - seg[0], SLAB_H);
            ctx.fillStyle = '#3d558c';
            ctx.fillRect(seg[0], y, seg[1] - seg[0], 2);
        }
    }
}

// A floor surface runs wall to wall except where the shafts cut through it.
function floorSegments() {
    const cuts = SHAFT_XS.map((x) => [x - SHAFT_W / 2, x + SHAFT_W / 2]).sort((a, b) => a[0] - b[0]);
    const segs = [];
    let from = WALL_L;
    for (const [l, r] of cuts) {
        if (l > from) segs.push([from, l]);
        from = Math.max(from, r);
    }
    if (from < WALL_R) segs.push([from, WALL_R]);
    return segs;
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor);
        const x = d.x - DOOR_W / 2;
        const top = y - DOOR_H;
        const taken = d.type === 'document' && d.collected;

        ctx.fillStyle = '#0d1424';                        // door frame
        ctx.fillRect(x - 3, top - 3, DOOR_W + 6, DOOR_H + 3);
        ctx.fillStyle = taken ? '#1d2742' : d.type === 'document' ? '#b3344a' : '#2d4f8f';
        ctx.fillRect(x, top, DOOR_W, DOOR_H);
        ctx.fillStyle = taken ? '#2a3550' : 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(x, top, DOOR_W, 3);
        ctx.fillStyle = taken ? '#3b4a6b' : 'rgba(12, 18, 32, 0.7)';
        ctx.fillRect(x + DOOR_W - 7, top + DOOR_H / 2 - 2, 4, 4);

        if (d.type === 'document' && !d.collected) {
            ctx.fillStyle = '#ffd98a';
            ctx.fillRect(d.x - 6, y - 26, 12, 14);
            ctx.fillStyle = '#b3344a';
            ctx.fillRect(d.x - 3, y - 22, 6, 2);
        }
        if (d.flash > 0) {
            ctx.fillStyle = `rgba(255, 236, 170, ${Math.min(0.7, d.flash)})`;
            ctx.fillRect(x - 3, top - 3, DOOR_W + 6, DOOR_H + 6);
        }
    }
}

function drawExit() {
    const y = floorY(exitZone.floor);
    const open = docsRemaining() === 0;
    ctx.fillStyle = '#0d1424';
    ctx.fillRect(exitZone.x - 3, y - DOOR_H - 12, exitZone.w + 6, DOOR_H + 12);
    ctx.fillStyle = open ? '#1b7a4b' : '#20304f';
    ctx.fillRect(exitZone.x, y - DOOR_H - 9, exitZone.w, DOOR_H + 9);
    if (open) {
        ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
        ctx.fillRect(exitZone.x - 10, y - DOOR_H - 16, exitZone.w + 20, DOOR_H + 16);
    }
    ctx.fillStyle = open ? '#4ade80' : '#46587f';
    ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', exitZone.x + exitZone.w / 2, y - DOOR_H / 2);
    ctx.textAlign = 'left';
}

function drawCars() {
    elevators.forEach((car, i) => {
        const w = SHAFT_W - 8;
        const h = 48;
        const x = car.x - w / 2;
        const y = car.y - h;
        const riding = player.inCar === i;

        ctx.fillStyle = '#2b3c62';                       // car body
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(12, 18, 32, 0.45)';        // sliding door seam
        ctx.fillRect(car.x - 1, y + 6, 2, h - 12);
        ctx.fillStyle = riding ? '#f8d57e' : '#60a5fa';  // frame
        ctx.fillRect(x, y, w, 3);
        ctx.fillRect(x, car.y - 4, w, 4);
        ctx.fillRect(x, y, 3, h);
        ctx.fillRect(x + w - 3, y, 3, h);

        ctx.fillStyle = 'rgba(248, 213, 126, 0.16)';     // ceiling light
        ctx.fillRect(x + 6, y + 3, w - 12, 10);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';   // cable
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(car.x, ROOF_Y + 12);
        ctx.lineTo(car.x, y);
        ctx.stroke();
    });
}

function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    drawAgent(player.x, player.y, player.dir, player.crouch ? CROUCH_H : PLAYER_H, '#e7ecf6', '#3b82f6', player.walk);
}

function drawEnemy(e) {
    drawAgent(e.x, e.y, e.dir, ENEMY_H, '#f8b4b4', '#b3344a', e.walk);
}

// One little suited figure, used for the player and the agents alike.
function drawAgent(x, y, dir, height, skin, suit, phase) {
    const w = PLAYER_W;
    const top = y - height;
    const stride = Math.sin(phase * 14) * 3;

    ctx.fillStyle = suit;
    ctx.fillRect(x - w / 2, top + height * 0.3, w, height * 0.7);

    ctx.fillStyle = skin;
    ctx.fillRect(x - 5, top + 4, 10, height * 0.3 - 4);

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(x - 7, top, 14, 5);          // hat brim
    ctx.fillRect(x - 5, top - 3, 10, 3);      // crown

    ctx.fillStyle = suit;
    ctx.fillRect(x - w / 2 - 1 + stride * 0.2, y - 5, 6, 5);
    ctx.fillRect(x + w / 2 - 5 - stride * 0.2, y - 5, 6, 5);

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(x + dir * 3, top + height * 0.42, dir * 10, 3);  // the gun
}

function drawBullet(b) {
    ctx.fillStyle = b.from === 'player' ? '#f8d57e' : '#f87171';
    ctx.fillRect(b.x - 4, b.y - 1.5, 8, 3);
}

function drawSparks() {
    for (const s of sparks) {
        ctx.fillStyle = `rgba(248, 213, 126, ${Math.max(0, s.life * 2)})`;
        const r = 14 - s.life * 20;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(2, r), 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFrame() {
    ctx.strokeStyle = '#223050';
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL_L - 10, ROOF_Y, WALL_R - WALL_L + 20, floorY(FLOOR_COUNT - 1) + 24 - ROOF_Y);
}

// --- input -----------------------------------------------------------------

const HELD_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'KeyA',
    'KeyD',
    'KeyW',
    'KeyS',
]);

document.addEventListener('keydown', (e) => {
    if (HELD_KEYS.has(e.code) || e.code === 'Space') e.preventDefault();

    if (e.code === 'KeyP') {
        togglePause();
        return;
    }
    if (e.code === 'Space') {
        if (!e.repeat) advance();
        return;
    }
    if (HELD_KEYS.has(e.code)) keys[e.code] = true;
});

document.addEventListener('keyup', (e) => {
    if (HELD_KEYS.has(e.code)) keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', () => advance());

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

updateHud();
draw();
requestAnimationFrame(frame);
