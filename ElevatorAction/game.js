// Elevator Action — raid a ten-storey building for secret documents and get out
// through the lobby before the agents catch you.
//
// The simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, player, elevators, doors, agents, bullets)
// is kept at the top level on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules behind the numbers.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const H = canvas.height;             // 640
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- building geometry -----------------------------------------------------

const FLOOR_COUNT = 10;              // storeys, index 0 = roof level, 9 = lobby
const FLOOR_H = 76;                  // vertical spacing between floor surfaces
const TOP_MARGIN = 56;               // world y of the top floor's surface
const FLOOR_Y = Array.from({ length: FLOOR_COUNT }, (_, i) => TOP_MARGIN + i * FLOOR_H);
const WORLD_H = FLOOR_Y[FLOOR_COUNT - 1] + 60;
const SLAB_H = 8;                    // drawn thickness of a floor slab

const SHAFT_W = 56;
const SHAFTS = [
    { x: 112, w: SHAFT_W },
    { x: 312, w: SHAFT_W },
];

const CAR_W = SHAFT_W;               // the car fills its shaft, so no gap to fall through
const CAR_H = 10;

const DOOR_W = 30;
const DOOR_H = 46;
const DOOR_X = [56, 240, 424];       // door centres, all clear of both shafts

const EXIT = { x: 396, w: 64 };      // escape doorway, lobby floor only

// --- actors ----------------------------------------------------------------

const PLAYER_W = 18;
const PLAYER_H = 30;
const PLAYER_START_X = 200;
const AGENT_W = 18;
const AGENT_H = 30;

const GRAVITY = 900;                 // px/s^2 down a shaft
const MOVE_SPEED = 120;              // px/s walking
const CAR_SPEED = 90;                // px/s of elevator travel
const CAR_DWELL = 0.3;               // seconds a car waits at a floor before a
                                     // held key sends it on, so you can step off
const BULLET_SPEED = 320;            // px/s, horizontal only
const SHOOT_DELAY = 0.22;            // seconds between the spy's shots
const AGENT_FIRE_DELAY = 1.8;        // seconds between an agent's shots
const AGENT_RANGE = 210;             // how far down a floor an agent will shoot
const AGENT_SPEED_BASE = 52;
const AGENT_SPEED_STEP = 9;          // added per level
const WALL_PAD = 20;                 // how close an agent gets to a wall before turning
const INVULN_TIME = 2.2;             // seconds of blinking after a hit
const KNOCKBACK = 28;                // px the spy is shoved clear of an agent

// --- run rules -------------------------------------------------------------

const LIVES_START = 3;
const LIVES_MAX = 5;                 // clearing a building hands one back, up to this
const LEVEL_COUNT = 3;
const DOC_COUNT = 5;                 // red doors hidden in the building
const DOC_POINTS = 500;
const AGENT_POINTS = 150;
const ESCAPE_BONUS = 1000;
const LIFE_BONUS = 250;              // per life still in hand when you escape
const SPAWN_FIRST = 3;               // seconds before the first agent appears
const SPAWN_DELAY_BASE = 3.8;
const SPAWN_RANGE = 2;               // agents only come out this near the spy
const MAX_AGENTS_BASE = 1;

const BEST_KEY = 'elevatoraction-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = LIVES_START;
let best = loadBest();
let doors = [];                      // { x, floor, slot, type, open, collected }
let elevators = [];                  // { shaft, x, y, w, h, floor, target, moving }
let agents = [];                     // { x, y, floor, dir, cooldown }
let bullets = [];                    // { x, y, vx, from }
let flashes = [];                    // cosmetic hit sparks
let spawnTimer = SPAWN_FIRST;
let autoRun = true;                  // the animation loop only simulates while true
let rand = mulberry32(1);            // reseeded per level, so a level is reproducible
const keys = Object.create(null);

const player = {
    x: PLAYER_START_X,
    y: FLOOR_Y[0],
    vy: 0,
    dir: 1,
    onCar: null,                     // index into elevators while riding a car
    invuln: 0,
    cooldown: 0,
};

// --- helpers ---------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Small deterministic PRNG so every level lays itself out the same way.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadBest() {
    try {
        return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (e) {
        return 0;
    }
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* storage may be unavailable; the score just won't persist */
        }
    }
}

// Which shaft, if any, a world x sits over. -1 when the floor is solid there.
function inShaft(x) {
    for (let i = 0; i < SHAFTS.length; i++) {
        if (x >= SHAFTS[i].x && x <= SHAFTS[i].x + SHAFTS[i].w) return i;
    }
    return -1;
}

// Nearest floor index to a world y, clamped to the building.
function floorIndexFor(y) {
    return clamp(Math.round((y - TOP_MARGIN) / FLOOR_H), 0, FLOOR_COUNT - 1);
}

// The floor the spy is actually standing on, or -1 while falling / in transit.
function onFloorIndex() {
    const i = floorIndexFor(player.y);
    return Math.abs(FLOOR_Y[i] - player.y) < 1.5 ? i : -1;
}

function onCarSpan(car, x) {
    return x >= car.x && x <= car.x + CAR_W;
}

function docsLeft() {
    return doors.filter((d) => d.type === 'red' && !d.collected).length;
}

function maxAgents() {
    return MAX_AGENTS_BASE + level;
}

function spawnDelay() {
    return SPAWN_DELAY_BASE / (1 + 0.4 * (level - 1));
}

function agentSpeed() {
    return AGENT_SPEED_BASE + AGENT_SPEED_STEP * (level - 1);
}

function addFlash(x, y) {
    flashes.push({ x, y, life: 0.25 });
}

// --- building a level ------------------------------------------------------

// Every floor above the lobby gets the same three doorways; DOC_COUNT of them,
// each on a different floor, hide a document and are painted red. The rest are
// grey doors that agents come out of.
function buildLevel(n) {
    rand = mulberry32(1337 + n * 7919);

    doors = [];
    for (let f = 0; f < FLOOR_COUNT - 1; f++) {
        DOOR_X.forEach((x, slot) => {
            doors.push({ x, floor: f, slot, type: 'grey', open: 0, collected: false });
        });
    }

    const floors = [];
    for (let f = 0; f < FLOOR_COUNT - 1; f++) floors.push(f);
    for (let i = floors.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [floors[i], floors[j]] = [floors[j], floors[i]];
    }
    floors.slice(0, DOC_COUNT).forEach((f) => {
        const slot = Math.floor(rand() * DOOR_X.length);
        const door = doors.find((d) => d.floor === f && d.slot === slot);
        door.type = 'red';
    });

    elevators = SHAFTS.map((s, i) => {
        const floor = i === 0 ? 2 : 6;
        return {
            shaft: i,
            x: s.x,
            y: FLOOR_Y[floor],
            w: CAR_W,
            h: CAR_H,
            floor,
            target: floor,
            moving: false,
            dwell: 0,
        };
    });

    agents = [];
    bullets = [];
    flashes = [];
    spawnTimer = SPAWN_FIRST;

    player.x = PLAYER_START_X;
    player.y = FLOOR_Y[0];
    player.vy = 0;
    player.dir = 1;
    player.onCar = null;
    player.invuln = 0;
    player.cooldown = 0;

    updateHud();
}

function startGame() {
    score = 0;
    lives = LIVES_START;
    level = 1;
    buildLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    if (level >= LEVEL_COUNT) {
        startGame();
        return;
    }
    level += 1;
    lives = Math.min(lives + 1, LIVES_MAX);
    buildLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or Space to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// Space / click / the overlay button all funnel through here, so what they do
// depends on what the game is currently showing.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'paused':
            togglePause();
            break;
        case 'levelclear':
            nextLevel();
            break;
        case 'running':
            shoot();
            break;
    }
}

// --- the spy ---------------------------------------------------------------

function shoot() {
    if (state !== 'running' || player.cooldown > 0) return;
    bullets.push({
        x: player.x + player.dir * 12,
        y: player.y - 18,
        vx: player.dir * BULLET_SPEED,
        from: 'player',
    });
    player.cooldown = SHOOT_DELAY;
}

// Send the car the spy is standing on one floor up (-1) or down (+1). Standing
// on a floor instead of a car, the same keys work the call button: the nearer
// idle car comes to this floor. Without that there is no way back up once you
// have dropped past both cars, and a run can strand itself.
function driveElevator(dir) {
    if (state !== 'running') return;
    if (player.onCar === null) {
        callElevator();
        return;
    }
    const car = elevators[player.onCar];
    if (!car) return;

    // Already in transit: the only input that lands is the opposite direction,
    // which turns the car round and takes it back to the floor it left.
    if (car.moving) {
        const travelling = Math.sign(FLOOR_Y[car.target] - FLOOR_Y[car.floor]);
        if (travelling !== 0 && dir === -travelling) car.target = car.floor;
        return;
    }

    const target = clamp(car.floor + dir, 0, FLOOR_COUNT - 1);
    if (target === car.floor) return;
    car.target = target;
    car.moving = true;
}

function callElevator() {
    const f = onFloorIndex();
    if (f < 0) return;

    let pick = null;
    let bestDist = Infinity;
    elevators.forEach((car) => {
        if (car.moving || car.floor === f) return;
        const dist = Math.abs(player.x - (car.x + CAR_W / 2));
        if (dist < bestDist) {
            bestDist = dist;
            pick = car;
        }
    });
    if (!pick) return;

    pick.target = f;
    pick.moving = true;
}

function movePlayer(dt) {
    let mx = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) mx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) mx += 1;
    if (mx !== 0) {
        player.dir = mx;
        player.x += mx * MOVE_SPEED * dt;
    }
    player.x = clamp(player.x, PLAYER_W / 2, W - PLAYER_W / 2);

    // A held drive key keeps a car going floor by floor — or, standing on a
    // floor, keeps the call in until a car is on its way. A car that has just
    // arrived is left alone for CAR_DWELL first: without that pause it departs
    // the same frame it arrives and there is no instant in which to step off.
    const car = player.onCar === null ? null : elevators[player.onCar];
    if (car && car.dwell > 0) return;
    const up = keys['ArrowUp'] || keys['KeyW'];
    const down = keys['ArrowDown'] || keys['KeyS'];
    if (up && !down) driveElevator(-1);
    else if (down && !up) driveElevator(1);
}

function moveElevators(dt) {
    elevators.forEach((car) => {
        if (car.dwell > 0) car.dwell = Math.max(0, car.dwell - dt);
        if (!car.moving) return;
        const ty = FLOOR_Y[car.target];
        const dir = Math.sign(ty - car.y);
        car.y += dir * CAR_SPEED * dt;
        if (dir === 0 || (dir > 0 && car.y >= ty) || (dir < 0 && car.y <= ty)) {
            car.y = ty;
            car.floor = car.target;
            car.moving = false;
            car.dwell = CAR_DWELL;
        }
    });
}

// The highest surface in the span the spy's feet are sweeping through, if any.
// Floor slabs hold everywhere except over an open shaft; the lobby slab closes
// both shafts off, so a long fall ends there.
function supportBetween(x, from, to) {
    let best = null;
    const consider = (y, car) => {
        if (y < from - 1e-6 || y > to + 1e-6) return;
        // A car wins a tie against a floor at the same height. That tie only
        // happens in the lobby, where the slab closes the shafts off — and if
        // the slab won it, a car parked in the lobby could never be boarded and
        // a spy who got there early would be stranded.
        if (!best || y < best.y - 1e-6 || (Math.abs(y - best.y) < 1e-6 && car !== null)) {
            best = { y, car };
        }
    };

    const shaft = inShaft(x);
    FLOOR_Y.forEach((y, i) => {
        if (shaft === -1 || i === FLOOR_COUNT - 1) consider(y, null);
    });
    elevators.forEach((car, i) => {
        if (onCarSpan(car, x)) consider(car.y, i);
    });
    return best;
}

function resolvePlayerVertical(dt) {
    if (player.onCar !== null) {
        const car = elevators[player.onCar];
        if (car && onCarSpan(car, player.x)) {
            player.y = car.y;
            player.vy = 0;
            return;
        }
        player.onCar = null;
    }

    player.vy += GRAVITY * dt;
    const ny = player.y + player.vy * dt;
    const land = supportBetween(player.x, player.y, ny);
    if (land) {
        player.y = land.y;
        player.vy = 0;
        player.onCar = land.car;
    } else {
        player.y = ny;
        player.onCar = null;
    }
}

function damagePlayer() {
    if (state !== 'running' || player.invuln > 0) return;
    lives -= 1;
    player.invuln = INVULN_TIME;
    addFlash(player.x, player.y - PLAYER_H / 2);
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('CAUGHT', `Score ${score}`, 'Press Space to try again');
    }
}

function hitsPlayer(x, y) {
    return (
        x > player.x - PLAYER_W / 2 - 2 &&
        x < player.x + PLAYER_W / 2 + 2 &&
        y > player.y - PLAYER_H &&
        y < player.y
    );
}

// --- agents ----------------------------------------------------------------

function trySpawn() {
    if (agents.length >= maxAgents()) return;
    const pf = floorIndexFor(player.y);
    const near = (d) => Math.abs(d.floor - pf) <= SPAWN_RANGE;
    const tooClose = (d) => d.floor === pf && Math.abs(d.x - player.x) < 48;

    let pool = doors.filter((d) => d.type === 'grey' && near(d) && !tooClose(d));
    if (!pool.length) pool = doors.filter((d) => d.type === 'grey' && !tooClose(d));
    if (!pool.length) return;

    const door = pool[Math.floor(rand() * pool.length)];
    door.open = 0.7;
    agents.push({
        x: door.x,
        y: FLOOR_Y[door.floor],
        floor: door.floor,
        dir: player.x < door.x ? -1 : 1,
        cooldown: AGENT_FIRE_DELAY,
    });
}

function moveAgents(dt) {
    const pf = floorIndexFor(player.y);
    // Agents shoot along the floor they stand on, so a spy in transit between
    // floors is out of the line of fire: the elevator is worth riding.
    const standing = onFloorIndex();
    agents.forEach((a) => {
        if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);

        if (a.floor === pf) a.dir = player.x < a.x ? -1 : 1;
        a.x += a.dir * agentSpeed() * dt;
        if (a.x < WALL_PAD) {
            a.x = WALL_PAD;
            a.dir = 1;
        } else if (a.x > W - WALL_PAD) {
            a.x = W - WALL_PAD;
            a.dir = -1;
        }
        a.y = FLOOR_Y[a.floor];

        const lined = a.floor === standing && Math.abs(player.x - a.x) < AGENT_RANGE;
        if (lined && a.cooldown === 0 && Math.sign(player.x - a.x) === a.dir) {
            bullets.push({
                x: a.x + a.dir * 12,
                y: a.y - 16,
                vx: a.dir * BULLET_SPEED,
                from: 'agent',
            });
            a.cooldown = AGENT_FIRE_DELAY;
        }

        // Same rule as shooting: an agent can only reach a spy standing on the
        // floor they are standing on, never one riding past in a shaft. A shove
        // comes with the hit — without it the agent is still on top of the spy
        // when the blink ends, and takes the next life for free.
        if (a.floor === standing && Math.abs(a.x - player.x) < (AGENT_W + PLAYER_W) / 2) {
            const landed = state === 'running' && player.invuln === 0;
            damagePlayer();
            if (landed) {
                const away = Math.sign(player.x - a.x) || -a.dir;
                player.x = clamp(player.x + away * KNOCKBACK, PLAYER_W / 2, W - PLAYER_W / 2);
            }
        }
    });
}

function moveBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < -10 || b.x > W + 10) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.from === 'player') {
            const j = agents.findIndex(
                (a) => Math.abs(b.x - a.x) < AGENT_W / 2 + 2 && b.y > a.y - AGENT_H && b.y < a.y
            );
            if (j >= 0) {
                addFlash(agents[j].x, agents[j].y - AGENT_H / 2);
                agents.splice(j, 1);
                score += AGENT_POINTS;
                bullets.splice(i, 1);
            }
        } else if (player.invuln === 0 && hitsPlayer(b.x, b.y)) {
            bullets.splice(i, 1);
            damagePlayer();
        }
    }
}

// --- documents and the exit ------------------------------------------------

function collectDocs() {
    const f = onFloorIndex();
    if (f < 0) return;
    doors.forEach((d) => {
        if (d.floor !== f || d.type !== 'red' || d.collected) return;
        if (Math.abs(player.x - d.x) < (PLAYER_W + DOOR_W) / 2) {
            d.collected = true;
            d.open = 0.7;
            score += DOC_POINTS;
            addFlash(d.x, FLOOR_Y[f] - DOOR_H / 2);
        }
    });
}

function checkExit() {
    if (docsLeft() > 0) return;
    if (onFloorIndex() !== FLOOR_COUNT - 1) return;
    if (player.x + PLAYER_W / 2 < EXIT.x || player.x - PLAYER_W / 2 > EXIT.x + EXIT.w) return;

    score += ESCAPE_BONUS + LIFE_BONUS * lives;
    saveBest();
    if (level >= LEVEL_COUNT) {
        state = 'won';
        showOverlay('ESCAPED!', `Score ${score}`, 'Press Space to raid it again');
    } else {
        state = 'levelclear';
        showOverlay('FLOOR CLEARED', `Score ${score}`, 'Press Space for the next building');
    }
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    doors.forEach((d) => {
        if (d.open > 0) d.open = Math.max(0, d.open - dt);
    });
    for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].life -= dt;
        if (flashes[i].life <= 0) flashes.splice(i, 1);
    }

    movePlayer(dt);
    moveElevators(dt);
    resolvePlayerVertical(dt);
    moveAgents(dt);
    moveBullets(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        trySpawn();
        spawnTimer = spawnDelay();
    }

    collectDocs();
    checkExit();
    updateHud();
}

// --- HUD and overlay -------------------------------------------------------

function setText(id, value) {
    document.getElementById(id).textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('floor', FLOOR_COUNT - floorIndexFor(player.y));
    setText('docs', docsLeft());
    setText('lives', lives);
    setText('level', level);
    setText('best', Math.max(best, score));
}

function showOverlay(title, scoreLine, sub) {
    setText('overlay-title', title);
    setText('overlay-score', scoreLine);
    setText('overlay-sub', sub);
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

function cameraY() {
    return clamp(player.y - H * 0.62, 0, WORLD_H - H);
}

function drawBuilding() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, WORLD_H);

    // Shafts, drawn first so slabs and cars sit on top. They stop at the lobby
    // slab, which is what closes them off to a falling spy.
    const shaftBottom = FLOOR_Y[FLOOR_COUNT - 1];
    SHAFTS.forEach((s) => {
        ctx.fillStyle = '#060a14';
        ctx.fillRect(s.x, 0, s.w, shaftBottom);
        ctx.strokeStyle = '#1b2540';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x + 1, 0, s.w - 2, shaftBottom);
        ctx.strokeStyle = '#141d33';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x + s.w / 2, 0);
        ctx.lineTo(s.x + s.w / 2, shaftBottom);
        ctx.stroke();
    });

    FLOOR_Y.forEach((y, i) => {
        const lobby = i === FLOOR_COUNT - 1;
        // wall band above each slab
        ctx.fillStyle = i % 2 ? '#111a2e' : '#131d33';
        ctx.fillRect(0, y - FLOOR_H + SLAB_H, W, FLOOR_H - SLAB_H);

        // slab segments, skipping the shaft openings except in the lobby
        const segments = [];
        let cursor = 0;
        if (!lobby) {
            SHAFTS.forEach((s) => {
                segments.push([cursor, s.x]);
                cursor = s.x + s.w;
            });
        }
        segments.push([cursor, W]);
        segments.forEach(([x0, x1]) => {
            ctx.fillStyle = lobby ? '#44507a' : '#2f3b5c';
            ctx.fillRect(x0, y, x1 - x0, SLAB_H);
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            ctx.fillRect(x0, y, x1 - x0, 2);
        });

        // floor number on the left wall
        ctx.fillStyle = '#44527a';
        ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(FLOOR_COUNT - i), 6, y - 6);
    });

    // foundation under the lobby
    const base = FLOOR_Y[FLOOR_COUNT - 1] + SLAB_H;
    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(0, base, W, WORLD_H - base);
    ctx.strokeStyle = '#161f36';
    ctx.lineWidth = 1;
    for (let x = -WORLD_H; x < W; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, WORLD_H);
        ctx.lineTo(x + (WORLD_H - base), base);
        ctx.stroke();
    }
}

function drawDoors() {
    doors.forEach((d) => {
        const y = FLOOR_Y[d.floor];
        const open = d.open > 0;
        const red = d.type === 'red' && !d.collected;
        ctx.fillStyle = '#0d1424';
        ctx.fillRect(d.x - DOOR_W / 2, y - DOOR_H, DOOR_W, DOOR_H);
        ctx.strokeStyle = red ? '#ef4444' : d.collected ? '#3f4a6b' : '#64739c';
        ctx.lineWidth = 2;
        ctx.strokeRect(d.x - DOOR_W / 2 + 1, y - DOOR_H + 1, DOOR_W - 2, DOOR_H - 2);

        if (open) {
            ctx.fillStyle = 'rgba(248, 250, 255, 0.18)';
            ctx.fillRect(d.x - DOOR_W / 2 + 3, y - DOOR_H + 3, DOOR_W - 6, DOOR_H - 6);
        } else {
            ctx.fillStyle = red ? '#7f1d1d' : '#1b2540';
            ctx.fillRect(d.x - DOOR_W / 2 + 3, y - DOOR_H + 3, DOOR_W - 6, DOOR_H - 6);
        }

        if (red) {
            ctx.fillStyle = '#fca5a5';
            ctx.fillRect(d.x - 5, y - DOOR_H / 2 - 7, 10, 13);
            ctx.fillStyle = '#7f1d1d';
            ctx.fillRect(d.x - 3, y - DOOR_H / 2 - 4, 6, 2);
            ctx.fillRect(d.x - 3, y - DOOR_H / 2, 6, 2);
        } else {
            ctx.fillStyle = '#8c9ac4';
            ctx.fillRect(d.x + DOOR_W / 2 - 8, y - DOOR_H / 2, 3, 3);
        }
    });
}

function drawExit() {
    const y = FLOOR_Y[FLOOR_COUNT - 1];
    ctx.fillStyle = '#064e3b';
    ctx.fillRect(EXIT.x, y - 52, EXIT.w, 52);
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 2;
    ctx.strokeRect(EXIT.x + 1, y - 51, EXIT.w - 2, 50);
    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', EXIT.x + EXIT.w / 2, y - 20);
    if (docsLeft() === 0) {
        ctx.fillStyle = 'rgba(52, 211, 153, 0.18)';
        ctx.fillRect(EXIT.x, y - 52, EXIT.w, 52);
    }
}

function drawElevators() {
    elevators.forEach((car) => {
        // cable
        ctx.strokeStyle = '#333f5e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(car.x + CAR_W / 2, 0);
        ctx.lineTo(car.x + CAR_W / 2, car.y);
        ctx.stroke();

        ctx.fillStyle = '#9aa7cc';
        ctx.fillRect(car.x, car.y, CAR_W, CAR_H);
        ctx.fillStyle = '#e7ecf6';
        ctx.fillRect(car.x, car.y, CAR_W, 3);
        ctx.fillStyle = car.moving ? '#fbbf24' : '#64739c';
        ctx.fillRect(car.x + 4, car.y + CAR_H, CAR_W - 8, 3);
    });
}

function drawFigure(x, y, dir, body, head, dim) {
    ctx.globalAlpha = dim ? 0.45 : 1;
    // legs
    ctx.fillStyle = body;
    ctx.fillRect(x - 7, y - 12, 5, 12);
    ctx.fillRect(x + 2, y - 12, 5, 12);
    // torso
    ctx.fillRect(x - 8, y - 24, 16, 13);
    // arm pointing the way the figure faces
    ctx.fillRect(dir > 0 ? x + 6 : x - 12, y - 20, 6, 4);
    // head
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(x, y - 27, 5, 0, Math.PI * 2);
    ctx.fill();
    // hat brim
    ctx.fillStyle = body;
    ctx.fillRect(x - 7, y - 30, 14, 3);
    ctx.globalAlpha = 1;
}

function drawPlayer() {
    const blink = player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0;
    drawFigure(player.x, player.y, player.dir, '#60a5fa', '#f2d5b1', blink);
}

function drawAgents() {
    agents.forEach((a) => drawFigure(a.x, a.y, a.dir, '#ef4444', '#f2d5b1', false));
}

function drawBullets() {
    bullets.forEach((b) => {
        ctx.fillStyle = b.from === 'player' ? '#e7ecf6' : '#fbbf24';
        ctx.fillRect(b.x - 3, b.y - 1.5, 6, 3);
    });
}

function drawFlashes() {
    flashes.forEach((f) => {
        const t = clamp(f.life / 0.25, 0, 1);
        ctx.globalAlpha = t;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(f.x, f.y, 4 + (1 - t) * 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, W, H);

    const cam = cameraY();
    ctx.save();
    ctx.translate(0, -cam);

    drawBuilding();
    drawExit();
    drawDoors();
    drawElevators();
    drawAgents();
    drawPlayer();
    drawBullets();
    drawFlashes();

    ctx.restore();

    // Once the documents are all in hand, say so loudly: the exit is the only
    // thing left to do and it may be nine floors away.
    if (state === 'running' && docsLeft() === 0) {
        ctx.fillStyle = 'rgba(5, 7, 13, 0.72)';
        ctx.fillRect(W / 2 - 62, 8, 124, 22);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('ESCAPE NOW', W / 2, 23);
    }
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            driveElevator(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            driveElevator(1);
            break;
        case 'ArrowLeft':
        case 'ArrowRight':
            e.preventDefault();
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('click', () => advance());
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
