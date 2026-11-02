// ---------------------------------------------------------------------------
// Elevator Heist — a vertical break-in on an HTML5 canvas.
//
// A spy has to loot every red door in a high-rise archive and then reach the
// getaway car at the left end of the ground floor. The building has no stairs:
// the only way between floors is one of the two elevator cars, and each car
// stays wherever it was last left. Security agents walk out of the blue doors,
// close in along the floor you are on, and shoot at chest height — so ducking
// and timing a ride matter as much as aim.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 520;
const WALL_L = 24;              // inner face of the left outer wall
const WALL_R = 696;             // inner face of the right outer wall
const TOP_Y = 86;               // walking surface of the top floor
const FLOOR_SPAN = 384;         // top floor to ground floor, however many floors
let FLOOR_H = 76;               // vertical distance between floors (set per level)
const FLOOR_T = 8;              // drawn thickness of a floor slab
const SHAFT_W = 44;
const CAR_H = 14;
const DOOR_W = 28;
let DOOR_H = 40;                // trimmed to fit when floors are close together
const DOORS_PER_FLOOR = 4;
const EXIT_W = 46;              // getaway-car zone at the left of the ground floor

// --- Actors --------------------------------------------------------------
const PLAYER_W = 18;
const PLAYER_H = 34;
const DUCK_H = 16;
const PLAYER_SPEED = 160;
const CAR_SPEED = 95;
const BULLET_SPEED = 400;
const AGENT_BULLET_SPEED = 260;
const AGENT_W = 18;
const AGENT_H = 34;
const AGENT_EMERGE = 0.5;       // agents stand in the doorway before patrolling
const AGENT_RANGE = 340;        // how far an agent will take a shot
const CHEST = 22;               // bullets fly this far above the floor
const DUCK_CHEST = 10;

// --- Scoring -------------------------------------------------------------
const SCORE_DOC = 250;
const SCORE_AGENT = 100;
const SCORE_CRUSH = 150;
const SCORE_LEVEL = 500;
const FLOOR_BONUS = 100;

const BEST_KEY = 'elevatorheist-best';

// ---------------------------------------------------------------------------
// State
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

let state = 'idle';             // idle | playing | paused | over
let score = 0;
let best = 0;
let lives = 3;
let level = 1;
let docsTaken = 0;
let docsNeeded = 0;
let agentsSpawned = 0;
let agentShots = 0;
let spawnCd = 0;
let autoStep = true;            // tests switch this off and drive step() directly
let rng = Math.random;

let FLOORS = 6;
let shaftX = [];
let doors = [];
let cars = [];
let agents = [];
let bullets = [];
let startX = (WALL_L + WALL_R) / 2;

let player = {
    x: startX,
    y: TOP_Y,
    floor: 0,
    riding: null,
    dir: 1,
    duck: false,
};

const keys = { left: false, right: false, up: false, down: false, fire: false };
let prevKeys = { ...keys };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

// Deterministic PRNG so a level number always generates the same building.
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

function floorY(i) {
    return TOP_Y + i * FLOOR_H;
}

// The floor a y sits exactly on, or null when it is between floors.
function floorAt(y) {
    for (let i = 0; i < FLOORS; i++) {
        if (Math.abs(floorY(i) - y) < 1.2) return i;
    }
    return null;
}

function shaftCenter(s) {
    return shaftX[s] + SHAFT_W / 2;
}

function inShaft(s, x) {
    return x > shaftX[s] && x < shaftX[s] + SHAFT_W;
}

function levelSpec(n) {
    return {
        floors: Math.min(6 + Math.floor((n - 1) / 2), 9),
        docs: Math.min(2 + n, 6),
        maxAgents: Math.min(1 + n, 5),
        agentSpeed: Math.min(66 + 6 * (n - 1), 110),
        agentFireDelay: Math.max(1.4 - 0.08 * (n - 1), 0.7),
        spawnDelay: Math.max(3.2 - 0.2 * (n - 1), 1.4),
    };
}

// A stable fingerprint of the generated building, used by the tests to prove
// level generation is reproducible.
function layoutSignature() {
    return JSON.stringify({
        floors: FLOORS,
        shafts: shaftX,
        start: startX,
        doors: doors.map((d) => [d.floor, Math.round(d.x), d.kind]),
    });
}

// ---------------------------------------------------------------------------
// Level generation
// ---------------------------------------------------------------------------

function doorSlots(floor) {
    const slots = [];
    const first = WALL_L + DOOR_W / 2 + 8;
    const last = WALL_R - DOOR_W / 2 - 8;
    for (let x = first; x <= last; x += 46) {
        const l = x - DOOR_W / 2;
        const r = x + DOOR_W / 2;
        // Keep clear of the shafts (with margin) so "open door" and "board the
        // car" can never both apply to the same spot.
        if (shaftX.some((sx) => r > sx - 12 && l < sx + SHAFT_W + 12)) continue;
        // Keep the getaway car's bay clear on the ground floor.
        if (floor === FLOORS - 1 && l < WALL_L + EXIT_W + 10) continue;
        slots.push(x);
    }
    return slots;
}

function buildLevel(n) {
    const spec = levelSpec(n);
    FLOORS = spec.floors;
    // Taller buildings pack their floors closer together so every level fills
    // the same canvas from roof to street.
    FLOOR_H = Math.round(FLOOR_SPAN / (FLOORS - 1));
    DOOR_H = Math.min(40, FLOOR_H - 14);

    shaftX = [
        Math.round(150 + rng() * 70),
        Math.round(420 + rng() * 70),
    ];

    doors = [];
    for (let f = 0; f < FLOORS; f++) {
        const slots = doorSlots(f);
        // Shuffle, then take a few slots per floor.
        for (let i = slots.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [slots[i], slots[j]] = [slots[j], slots[i]];
        }
        const count = Math.min(slots.length, 2 + Math.floor(rng() * (DOORS_PER_FLOOR - 1)));
        slots.slice(0, count).forEach((x) => {
            doors.push({ x, floor: f, kind: 'blue', opened: false, flash: 0 });
        });
    }
    doors.sort((a, b) => a.floor - b.floor || a.x - b.x);

    // Scatter the documents over the blue doors, at most one per floor pass so
    // they are not all stacked on the same storey.
    docsNeeded = Math.min(spec.docs, doors.length);
    const pool = doors.map((_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const used = new Set();
    let placed = 0;
    for (let pass = 0; pass < 3 && placed < docsNeeded; pass++) {
        const floorsSeen = new Set();
        for (const idx of pool) {
            if (placed >= docsNeeded) break;
            if (used.has(idx)) continue;
            const d = doors[idx];
            if (pass < 2 && floorsSeen.has(d.floor)) continue;
            floorsSeen.add(d.floor);
            d.kind = 'red';
            used.add(idx);
            placed++;
        }
    }
    docsNeeded = placed;

    startX = Math.round((shaftX[0] + SHAFT_W + shaftX[1]) / 2);

    cars = [
        { shaft: 0, x: shaftCenter(0), y: floorY(0) },
        { shaft: 1, x: shaftCenter(1), y: floorY(FLOORS - 1) },
    ];
}

function resetSpy() {
    player.x = startX;
    player.floor = 0;
    player.y = floorY(0);
    player.riding = null;
    player.dir = 1;
    player.duck = false;
    keys.left = keys.right = keys.up = keys.down = keys.fire = false;
    prevKeys = { ...keys };
}

function loadLevel(n) {
    level = n;
    rng = mulberry32(Math.imul(n, 2654435761));
    buildLevel(n);
    docsTaken = 0;
    agents = [];
    bullets = [];
    spawnCd = levelSpec(n).spawnDelay;
    resetSpy();
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = 3;
    agentsSpawned = 0;
    agentShots = 0;
    loadLevel(1);
    state = 'playing';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += SCORE_LEVEL + FLOOR_BONUS * FLOORS;
    loadLevel(level + 1);
    state = 'playing';
    updateHud();
}

function loseLife() {
    lives--;
    agents = [];
    bullets = [];
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        resetSpy();
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private browsing — the score just will not persist */
        }
    }
    updateHud();
    showOverlay('CAUGHT!', `Score ${score}`, 'Press Space to try again');
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'playing';
        hideOverlay();
    }
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

function updateHud() {
    elScore.textContent = String(score);
    elDocs.textContent = `${docsTaken}/${docsNeeded}`;
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elBest.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// The shaft the spy could step into right now: standing on a floor, inside the
// shaft, with that shaft's car level with the floor.
function boardableShaft() {
    if (player.riding !== null || player.floor === null) return null;
    for (let s = 0; s < cars.length; s++) {
        if (!inShaft(s, player.x)) continue;
        if (Math.abs(cars[s].y - player.y) < 1.2) return s;
    }
    return null;
}

function board(s) {
    player.riding = s;
    player.x = shaftCenter(s);
    player.duck = false;
}

function tryOpenDoor() {
    const reach = DOOR_W / 2 + PLAYER_W / 2 - 4;
    const door = doors.find((d) => d.floor === player.floor && Math.abs(d.x - player.x) <= reach);
    if (!door) return false;
    door.flash = 0.35;
    if (door.kind === 'red' && !door.opened) {
        door.opened = true;
        docsTaken++;
        score += SCORE_DOC;
    }
    return true;
}

function fire() {
    if (bullets.some((b) => b.owner === 'player')) return;
    bullets.push({
        x: player.x + player.dir * (PLAYER_W / 2 + 4),
        y: player.y - (player.duck ? DUCK_CHEST : CHEST),
        vx: player.dir * BULLET_SPEED,
        owner: 'player',
    });
}

function spawnAgent(floor, x) {
    const spec = levelSpec(level);
    agents.push({
        x: clamp(x, WALL_L + AGENT_W / 2, WALL_R - AGENT_W / 2),
        y: floorY(floor),
        floor,
        dir: x > player.x ? -1 : 1,
        speed: spec.agentSpeed,
        fireCd: spec.agentFireDelay,
        emerge: AGENT_EMERGE,
    });
    agentsSpawned++;
    return agents[agents.length - 1];
}

function trySpawnAgent(dt) {
    const spec = levelSpec(level);
    spawnCd -= dt;
    if (spawnCd > 0) return;
    spawnCd = spec.spawnDelay;
    if (agents.length >= spec.maxAgents) return;
    // Security comes out of the blue doors, on the spy's floor or below it, so
    // the pressure is always between the spy and the ground.
    const base = player.floor === null ? floorAt(player.y) : player.floor;
    const from = base === null ? 0 : base;
    const choices = doors.filter((d) => d.kind !== 'red' && d.floor >= from);
    const pool = choices.length ? choices : doors;
    if (!pool.length) return;
    const door = pool[Math.floor(rng() * pool.length)];
    spawnAgent(door.floor, door.x);
}

function updatePlayer(dt, edge) {
    if (player.riding !== null) {
        const car = cars[player.riding];
        let vy = 0;
        if (keys.up) vy -= CAR_SPEED;
        if (keys.down) vy += CAR_SPEED;
        car.y = clamp(car.y + vy * dt, floorY(0), floorY(FLOORS - 1));
        player.y = car.y;
        player.duck = false;
        const f = floorAt(car.y);
        player.floor = f;
        if (f !== null && (edge.left || edge.right)) {
            const dir = edge.right ? 1 : -1;
            const from = player.riding;
            player.riding = null;
            player.dir = dir;
            player.floor = f;
            player.y = floorY(f);
            player.x = clamp(
                shaftCenter(from) + dir * (SHAFT_W / 2 + PLAYER_W / 2 + 2),
                WALL_L + PLAYER_W / 2,
                WALL_R - PLAYER_W / 2
            );
        }
        return;
    }

    const s = boardableShaft();
    if (s !== null && (edge.up || edge.down)) {
        board(s);
        return;
    }
    if (edge.up) tryOpenDoor();

    player.duck = keys.down && s === null;
    if (player.duck) return;

    let vx = 0;
    if (keys.left) vx -= 1;
    if (keys.right) vx += 1;
    if (vx !== 0) {
        player.dir = vx;
        player.x = clamp(
            player.x + vx * PLAYER_SPEED * dt,
            WALL_L + PLAYER_W / 2,
            WALL_R - PLAYER_W / 2
        );
    }
}

// A car that comes down on an agent standing in the shaft flattens it.
function crushAgents() {
    for (const car of cars) {
        for (let i = agents.length - 1; i >= 0; i--) {
            const a = agents[i];
            const l = shaftX[car.shaft] - AGENT_W / 2;
            const r = shaftX[car.shaft] + SHAFT_W + AGENT_W / 2;
            if (a.x < l || a.x > r) continue;
            if (car.y > a.y - AGENT_H && car.y <= a.y + 2) {
                agents.splice(i, 1);
                score += SCORE_CRUSH;
            }
        }
    }
}

function updateAgents(dt) {
    const spec = levelSpec(level);
    for (const a of agents) {
        if (a.emerge > 0) {
            a.emerge -= dt;
        } else if (a.floor === player.floor && player.riding === null) {
            const dx = player.x - a.x;
            a.dir = sign(dx) || a.dir;
            if (Math.abs(dx) > 40) a.x += a.dir * a.speed * dt;
        } else {
            a.x += a.dir * a.speed * 0.7 * dt;
            if (a.x < WALL_L + AGENT_W / 2) {
                a.x = WALL_L + AGENT_W / 2;
                a.dir = 1;
            } else if (a.x > WALL_R - AGENT_W / 2) {
                a.x = WALL_R - AGENT_W / 2;
                a.dir = -1;
            }
        }

        a.fireCd -= dt;
        const sameFloor = a.floor === player.floor;
        const dx = player.x - a.x;
        if (a.fireCd <= 0 && sameFloor && Math.abs(dx) < AGENT_RANGE && sign(dx) === a.dir) {
            bullets.push({
                x: a.x + a.dir * (AGENT_W / 2 + 4),
                y: a.y - CHEST,
                vx: a.dir * AGENT_BULLET_SPEED,
                owner: 'agent',
            });
            a.fireCd = spec.agentFireDelay;
            agentShots++;
        }
    }
}

function playerRect() {
    const h = player.duck ? DUCK_H : PLAYER_H;
    return { l: player.x - PLAYER_W / 2, r: player.x + PLAYER_W / 2, t: player.y - h, b: player.y };
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < WALL_L || b.x > WALL_R) {
            bullets.splice(i, 1);
            continue;
        }
        if (b.owner === 'player') {
            const hit = agents.findIndex(
                (a) =>
                    b.x > a.x - AGENT_W / 2 &&
                    b.x < a.x + AGENT_W / 2 &&
                    b.y > a.y - AGENT_H &&
                    b.y < a.y
            );
            if (hit >= 0) {
                agents.splice(hit, 1);
                score += SCORE_AGENT;
                bullets.splice(i, 1);
            }
        } else {
            const p = playerRect();
            if (b.x > p.l && b.x < p.r && b.y > p.t && b.y < p.b) {
                bullets.splice(i, 1);
                loseLife();
                return;
            }
        }
    }
}

function docsDone() {
    return docsNeeded > 0 && docsTaken >= docsNeeded;
}

function checkEscape() {
    if (player.riding !== null) return;
    if (player.floor !== FLOORS - 1) return;
    if (!docsDone()) return;
    if (player.x - PLAYER_W / 2 > WALL_L + EXIT_W) return;
    nextLevel();
}

function step(dt) {
    if (state !== 'playing') return;
    const edge = {
        left: keys.left && !prevKeys.left,
        right: keys.right && !prevKeys.right,
        up: keys.up && !prevKeys.up,
        down: keys.down && !prevKeys.down,
        fire: keys.fire && !prevKeys.fire,
    };

    if (edge.fire) fire();
    updatePlayer(dt, edge);
    crushAgents();
    updateAgents(dt);
    updateBullets(dt);
    if (state === 'playing') {
        trySpawnAgent(dt);
        checkEscape();
    }
    doors.forEach((d) => {
        if (d.flash > 0) d.flash = Math.max(0, d.flash - dt);
    });
    updateHud();
    prevKeys = { ...keys };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#0a1020');
    sky.addColorStop(1, '#05070c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Building shell.
    ctx.fillStyle = '#141b29';
    ctx.fillRect(WALL_L - 14, TOP_Y - FLOOR_H + 6, WALL_R - WALL_L + 28, floorY(FLOORS - 1) - TOP_Y + FLOOR_H + 20);
    ctx.strokeStyle = '#27334a';
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL_L - 14, TOP_Y - FLOOR_H + 6, WALL_R - WALL_L + 28, floorY(FLOORS - 1) - TOP_Y + FLOOR_H + 20);

    // Rooftop sign.
    ctx.fillStyle = '#58e2ff';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(WALL_L - 14, TOP_Y - FLOOR_H + 6, WALL_R - WALL_L + 28, 3);
    ctx.globalAlpha = 1;
}

function drawFloors() {
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = '#1e2838';
        ctx.fillRect(WALL_L - 10, y, WALL_R - WALL_L + 20, FLOOR_T);
        ctx.fillStyle = '#2d3c55';
        ctx.fillRect(WALL_L - 10, y, WALL_R - WALL_L + 20, 2);

        // Faint wall panelling above each floor.
        ctx.fillStyle = 'rgba(255,255,255,0.025)';
        for (let x = WALL_L; x < WALL_R; x += 24) {
            ctx.fillRect(x, y - FLOOR_H + FLOOR_T + 4, 2, FLOOR_H - FLOOR_T - 8);
        }
    }

    // Outer walls.
    ctx.fillStyle = '#28344a';
    ctx.fillRect(WALL_L - 14, TOP_Y - FLOOR_H + 6, 10, floorY(FLOORS - 1) - TOP_Y + FLOOR_H + 14);
    ctx.fillRect(WALL_R + 4, TOP_Y - FLOOR_H + 6, 10, floorY(FLOORS - 1) - TOP_Y + FLOOR_H + 14);
}

function drawShafts() {
    for (let s = 0; s < shaftX.length; s++) {
        const x = shaftX[s];
        const top = TOP_Y - FLOOR_H + 10;
        const bottom = floorY(FLOORS - 1);
        ctx.fillStyle = '#0a0f18';
        ctx.fillRect(x, top, SHAFT_W, bottom - top);
        ctx.strokeStyle = '#243149';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, top + 0.5, SHAFT_W - 1, bottom - top - 1);

        // Guide rails.
        ctx.fillStyle = '#1b2638';
        ctx.fillRect(x + 4, top, 3, bottom - top);
        ctx.fillRect(x + SHAFT_W - 7, top, 3, bottom - top);

        const car = cars[s];
        if (!car) continue;

        // Cable.
        ctx.strokeStyle = '#3b4a66';
        ctx.beginPath();
        ctx.moveTo(car.x, top);
        ctx.lineTo(car.x, car.y - CAR_H);
        ctx.stroke();

        // Car.
        const cw = SHAFT_W - 10;
        ctx.fillStyle = '#3a4c6b';
        ctx.fillRect(car.x - cw / 2, car.y - CAR_H, cw, CAR_H);
        ctx.fillStyle = '#58e2ff';
        ctx.fillRect(car.x - cw / 2, car.y - 3, cw, 3);
        ctx.fillStyle = 'rgba(88,226,255,0.18)';
        ctx.fillRect(car.x - cw / 2, car.y - CAR_H - 20, cw, 20);
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor);
        const x = d.x - DOOR_W / 2;
        const top = y - DOOR_H;
        let fill = '#2f4f7a';
        if (d.kind === 'red') fill = d.opened ? '#454e5c' : '#b8333f';
        ctx.fillStyle = fill;
        ctx.fillRect(x, top, DOOR_W, DOOR_H);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, top + 1, DOOR_W - 2, DOOR_H - 2);

        // Frosted glass panel and handle.
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(x + 5, top + 6, DOOR_W - 10, 12);
        ctx.fillStyle = '#d9e2f0';
        ctx.fillRect(x + DOOR_W - 8, top + DOOR_H / 2 - 2, 4, 4);

        if (d.kind === 'red' && !d.opened) {
            ctx.fillStyle = '#ffd447';
            ctx.fillRect(x + 6, top + DOOR_H - 12, DOOR_W - 12, 4);
        }
        if (d.flash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${0.5 * (d.flash / 0.35)})`;
            ctx.fillRect(x, top, DOOR_W, DOOR_H);
        }
    }
}

function drawExit() {
    const y = floorY(FLOORS - 1);
    const lit = docsDone();
    ctx.fillStyle = lit ? '#58e2ff' : '#2a3448';
    // Getaway car silhouette.
    ctx.beginPath();
    ctx.moveTo(WALL_L, y);
    ctx.lineTo(WALL_L, y - 12);
    ctx.lineTo(WALL_L + 10, y - 20);
    ctx.lineTo(WALL_L + 30, y - 20);
    ctx.lineTo(WALL_L + EXIT_W - 2, y - 12);
    ctx.lineTo(WALL_L + EXIT_W - 2, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0a0f18';
    ctx.fillRect(WALL_L + 6, y - 4, 10, 4);
    ctx.fillRect(WALL_L + EXIT_W - 18, y - 4, 10, 4);
    if (lit) {
        ctx.fillStyle = 'rgba(88,226,255,0.25)';
        ctx.fillRect(WALL_L - 2, y - 26, EXIT_W + 4, 26);
    }
}

function drawSpy(x, y, dir, duck) {
    const h = duck ? DUCK_H : PLAYER_H;
    const top = y - h;
    // Coat.
    ctx.fillStyle = '#20314d';
    ctx.fillRect(x - PLAYER_W / 2, top + (duck ? 3 : 10), PLAYER_W, h - (duck ? 3 : 10));
    // Head / hat.
    ctx.fillStyle = '#e9d3a6';
    ctx.fillRect(x - 5, top + (duck ? 0 : 3), 10, duck ? 4 : 8);
    ctx.fillStyle = '#121a2a';
    ctx.fillRect(x - 8, top, 16, duck ? 3 : 4);
    ctx.fillRect(x + (dir > 0 ? 2 : -8), top, 6, duck ? 3 : 4);
    // Scarf.
    ctx.fillStyle = '#58e2ff';
    ctx.fillRect(x - PLAYER_W / 2, top + (duck ? 4 : 11), PLAYER_W, 3);
    // Legs.
    if (!duck) {
        ctx.fillStyle = '#121a2a';
        ctx.fillRect(x - 6, y - 6, 4, 6);
        ctx.fillRect(x + 2, y - 6, 4, 6);
    }
}

function drawAgent(a) {
    const top = a.y - AGENT_H;
    ctx.fillStyle = a.emerge > 0 ? '#6c2630' : '#9c3340';
    ctx.fillRect(a.x - AGENT_W / 2, top + 10, AGENT_W, AGENT_H - 10);
    ctx.fillStyle = '#e9d3a6';
    ctx.fillRect(a.x - 5, top + 3, 10, 8);
    ctx.fillStyle = '#1b1f28';
    ctx.fillRect(a.x - 6, top + 4, 12, 3);
    ctx.fillStyle = '#ffd447';
    ctx.fillRect(a.x - 2, top + 13, 4, 8);
    ctx.fillStyle = '#121a2a';
    ctx.fillRect(a.x - 6, a.y - 6, 4, 6);
    ctx.fillRect(a.x + 2, a.y - 6, 4, 6);
    // Muzzle.
    ctx.fillStyle = '#d9e2f0';
    ctx.fillRect(a.x + (a.dir > 0 ? AGENT_W / 2 : -AGENT_W / 2 - 5), a.y - CHEST - 1, 5, 2);
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#ffd447' : '#ff7a6b';
        ctx.fillRect(b.x - 4, b.y - 1.5, 8, 3);
    }
}

function draw() {
    drawBackdrop();
    drawFloors();
    drawExit();
    drawDoors();
    drawShafts();
    for (const a of agents) drawAgent(a);
    drawSpy(player.x, player.y, player.dir, player.duck);
    drawBullets();

    // Floor plate numbers down the left wall.
    ctx.fillStyle = '#4a5a78';
    ctx.font = '9px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let f = 0; f < FLOORS; f++) {
        ctx.fillText(String(FLOORS - f), 6, floorY(f) - 2);
    }

    // Status line on the street below the building.
    const streetY = Math.min(CANVAS_H - 16, floorY(FLOORS - 1) + 36);
    ctx.textAlign = 'center';
    if (state === 'playing' && docsDone()) {
        ctx.fillStyle = '#58e2ff';
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('ALL DOCUMENTS TAKEN — GET TO THE CAR', CANVAS_W / 2, streetY);
    } else {
        const left = Math.max(0, docsNeeded - docsTaken);
        ctx.fillStyle = '#7d8ba3';
        ctx.font = '12px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`${left} document${left === 1 ? '' : 's'} still behind a red door`, CANVAS_W / 2, streetY);
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

const FIRE_KEYS = [' ', 'z', 'Z'];

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') {
            startGame();
            return;
        }
        if (state === 'paused') {
            togglePause();
            return;
        }
        keys.fire = true;
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    if (k === 'z') {
        keys.fire = true;
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
    if (FIRE_KEYS.includes(k) || k === 'Spacebar') {
        keys.fire = false;
        return;
    }
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

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
loadLevel(1);
state = 'idle';
updateHud();
showOverlay('ELEVATOR HEIST', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
