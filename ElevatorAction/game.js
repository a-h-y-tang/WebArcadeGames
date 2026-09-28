// ---------------------------------------------------------------------------
// Elevator Action — a six-storey document raid on an HTML5 canvas.
//
// A spy drops onto the roof of an enemy building. Two elevator shafts cut every
// floor into three sealed segments, so the only way around is to ride a car.
// Red doors hide the secret documents; collect all of them, then ride down to
// the ground floor and slip out of the escape door on the far left, while enemy
// agents patrol the corridors and shoot on sight.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
//
// Every interaction — bullets, contact, documents — is decided on whole floor
// indices rather than pixel rectangles. A rider between two floors carries the
// floor index -1, which matches nothing, so mid-shaft is simply a safe place.
// ---------------------------------------------------------------------------

// --- Building geometry ------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;
const FLOORS = 6;
const FLOOR_H = 70;
const TOP_MARGIN = 50;      // y of the roof floor's walking surface
const WALL = 20;            // thickness of the outer walls
const LOBBY_H = CANVAS_H - (TOP_MARGIN + (FLOORS - 1) * FLOOR_H);

const SHAFT_XS = [250, 470];
const SHAFT_W = 56;
const CAR_H = 8;
const ELEV_SPEED = 70;      // one floor per second

const EXIT_X = 70;          // escape door: ground floor, x <= EXIT_X
const DOOR_W = 30;
const DOOR_H = 44;

// --- Actors -----------------------------------------------------------------
const PLAYER_W = 18;
const PLAYER_H = 34;
const PLAYER_SPEED = 120;
const STEP_OFF_GAP = 2;     // clearance left between the spy and a shaft edge
const START_LIVES = 3;
const INVULN_TIME = 1.5;

const AGENT_W = 18;
const AGENT_H = 34;
const AGENT_FIRST_SHOT = 0.6;

const SHOOT_COOLDOWN = 0.25;
const PLAYER_BULLET_SPEED = 330;
const AGENT_BULLET_SPEED = 260;
const HIT_RANGE = 12;       // bullet-to-body
const TOUCH_RANGE = 16;     // body-to-body

const SCORE_DOC = 100;
const SCORE_AGENT = 200;
const SCORE_LEVEL = 1000;

const SPAWN = { x: 120, floor: 0 };
const BEST_KEY = 'elevatoraction-best';

// --- Floor plans ------------------------------------------------------------
// Doors are listed as [floor, x, red]. The shafts sit at x = 250 and x = 470,
// so a door's 30px body has to stay clear of 222..278 and 442..498, and clear of
// the escape door in the ground floor's left corner.
const LAYOUTS = [
    {
        doors: [
            [0, 60, false], [0, 180, false],
            [1, 100, true], [1, 350, false], [1, 620, false],
            [2, 60, false], [2, 400, true], [2, 560, false],
            [3, 150, false], [3, 320, false], [3, 660, true],
            [4, 80, false], [4, 380, false], [4, 540, false],
            [5, 180, false], [5, 350, false], [5, 600, false],
        ],
        agents: [[1, 180], [3, 600], [4, 350]],
    },
    {
        doors: [
            [0, 100, false], [0, 340, false], [0, 650, true],
            [1, 60, false], [1, 400, false], [1, 530, false],
            [2, 160, true], [2, 310, false], [2, 610, false],
            [3, 90, false], [3, 420, true], [3, 680, false],
            [4, 190, false], [4, 330, false], [4, 570, true],
            [5, 200, false], [5, 380, false], [5, 640, false],
        ],
        agents: [[0, 340], [2, 520], [3, 200], [4, 420]],
    },
    {
        doors: [
            [0, 70, true], [0, 200, false], [0, 560, false],
            [1, 130, false], [1, 360, false], [1, 680, true],
            [2, 90, false], [2, 330, false], [2, 520, false],
            [3, 190, true], [3, 410, false], [3, 600, false],
            [4, 60, false], [4, 300, false], [4, 660, true],
            [5, 150, false], [5, 420, false], [5, 560, false],
        ],
        agents: [[0, 200], [1, 360], [2, 520], [4, 300], [5, 420]],
    },
];

// --- State ------------------------------------------------------------------
let state = 'idle';         // idle | playing | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let docsCollected = 0;
let docsRequired = 0;
let spawnTimer = 0;

let doors = [];
let agents = [];
let bullets = [];
let cars = [];

const player = {
    x: SPAWN.x,
    y: 0,
    floor: SPAWN.floor,
    ride: -1,               // shaft index while riding, -1 while walking
    rideLatch: false,       // true until the boarding key is released
    dir: 1,
    shootCd: 0,
    invuln: 0,
};

const keys = { left: false, right: false, up: false, down: false };
let autoStep = true;

// --- Seeded randomness ------------------------------------------------------
// A tiny LCG so agent respawns are reproducible: a test pins the seed and gets
// the same building activity every run.
let seed = 123456789;

function setSeed(s) {
    seed = (s >>> 0) || 1;
}

function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

// --- Geometry helpers -------------------------------------------------------
function floorY(f) {
    return TOP_MARGIN + f * FLOOR_H;
}

// The floor a car is level with, or -1 while it is between floors.
function carFloor(car) {
    return car.y === floorY(car.target) ? car.target : -1;
}

function shaftBounds(i) {
    return [SHAFT_XS[i] - SHAFT_W / 2, SHAFT_XS[i] + SHAFT_W / 2];
}

// --- Difficulty -------------------------------------------------------------
function agentSpeed() {
    return Math.min(45 + 7 * (level - 1), 90);
}

function agentFireCooldown() {
    return Math.max(0.7, 1.8 - 0.15 * (level - 1));
}

function maxAgents() {
    return Math.min(3 + level, 8);
}

function spawnInterval() {
    return Math.max(2.5, 6 - 0.4 * (level - 1));
}

// --- DOM --------------------------------------------------------------------
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

function updateHud() {
    elScore.textContent = String(score);
    elDocs.textContent = `${docsCollected} / ${docsRequired}`;
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

// --- Level setup ------------------------------------------------------------
function makeAgent(floor, x, dir) {
    return { floor, x, dir, cd: AGENT_FIRST_SHOT };
}

function loadLevel(n) {
    const layout = LAYOUTS[(n - 1) % LAYOUTS.length];
    doors = layout.doors.map(([floor, x, red]) => ({ floor, x, red, collected: false }));
    agents = layout.agents.map(([floor, x]) => makeAgent(floor, x, rand() < 0.5 ? -1 : 1));
    bullets = [];
    cars = [
        { y: floorY(0), target: 0 },
        { y: floorY(3), target: 3 },
    ];
    docsRequired = doors.filter((d) => d.red).length;
    docsCollected = 0;
    spawnTimer = spawnInterval();
    resetPlayer();
}

function resetPlayer() {
    // The spy respawns on the roof, so the roof car is recalled with them —
    // otherwise a death while both cars were parked low would strand them in a
    // sealed segment with no way to call one back.
    if (cars.length) {
        cars[0].y = floorY(SPAWN.floor);
        cars[0].target = SPAWN.floor;
    }
    player.x = SPAWN.x;
    player.floor = SPAWN.floor;
    player.ride = -1;
    player.rideLatch = false;
    player.dir = 1;
    player.shootCd = 0;
    player.y = floorY(SPAWN.floor) - PLAYER_H;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    setSeed(20260927);
    loadLevel(level);
    player.invuln = 0;
    state = 'playing';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'playing') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Space to resume');
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
            localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing — the run just does not persist */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space or click Start to play again');
}

// --- Elevators --------------------------------------------------------------
function updateElevators(dt) {
    for (const car of cars) {
        const goal = floorY(car.target);
        if (car.y === goal) continue;
        const stepPx = ELEV_SPEED * dt;
        // Land exactly on the target floor rather than drifting past it, so
        // `carFloor` can test alignment with plain equality.
        car.y = Math.abs(goal - car.y) <= stepPx ? goal : car.y + Math.sign(goal - car.y) * stepPx;
    }
}

function boardElevator(i) {
    player.ride = i;
    player.x = SHAFT_XS[i];
    player.rideLatch = true;
}

function stepOff(i, dir) {
    player.ride = -1;
    player.rideLatch = false;
    player.x = SHAFT_XS[i] + dir * (SHAFT_W / 2 + PLAYER_W / 2 + STEP_OFF_GAP);
}

// --- Player -----------------------------------------------------------------
function updatePlayer(dt) {
    if (player.shootCd > 0) player.shootCd = Math.max(0, player.shootCd - dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    if (player.ride >= 0) updateRider();
    else updateWalker(dt);
}

// The spy's floor and y both come from whatever they are standing on, so they
// are recomputed once the elevators have moved for this frame.
function syncPlayerPosition() {
    if (player.ride >= 0) player.floor = carFloor(cars[player.ride]);
    player.y = (player.ride >= 0 ? cars[player.ride].y : floorY(player.floor)) - PLAYER_H;
}

function updateRider() {
    const car = cars[player.ride];
    const at = carFloor(car);
    player.floor = at;
    if (at < 0) return;     // in transit: the car ignores input and so does the spy

    // Boarding latches the direction key that carried the spy in, so walking
    // into a car does not immediately walk back out of it.
    if (!keys.left && !keys.right) player.rideLatch = false;

    if (keys.up && at > 0) car.target = at - 1;
    else if (keys.down && at < FLOORS - 1) car.target = at + 1;
    else if (player.rideLatch) return;
    else if (keys.left) stepOff(player.ride, -1);
    else if (keys.right) stepOff(player.ride, 1);
}

function updateWalker(dt) {
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (!dir) return;
    player.dir = dir;

    const half = PLAYER_W / 2;
    let nx = player.x + dir * PLAYER_SPEED * dt;
    nx = Math.max(WALL + half, Math.min(CANVAS_W - WALL - half, nx));

    for (let i = 0; i < SHAFT_XS.length; i++) {
        const [left, right] = shaftBounds(i);
        if (nx + half <= left || nx - half >= right) continue;
        if (carFloor(cars[i]) === player.floor) {
            boardElevator(i);
            return;
        }
        nx = dir > 0 ? left - half : right + half;  // an empty shaft is a wall
    }
    player.x = nx;
}

function shoot() {
    if (state !== 'playing' || player.ride >= 0 || player.floor < 0) return;
    if (player.shootCd > 0) return;
    player.shootCd = SHOOT_COOLDOWN;
    bullets.push({ x: player.x, floor: player.floor, dir: player.dir, from: 'player' });
}

// --- Documents and the escape door -----------------------------------------
function collectDocuments() {
    if (player.ride >= 0 || player.floor < 0) return;
    for (const door of doors) {
        if (!door.red || door.collected) continue;
        if (door.floor !== player.floor) continue;
        if (Math.abs(door.x - player.x) > DOOR_W / 2) continue;
        door.collected = true;
        docsCollected++;
        score += SCORE_DOC;
    }
}

function checkEscape() {
    if (docsCollected < docsRequired) return;
    if (player.ride >= 0 || player.floor !== FLOORS - 1) return;
    if (player.x > EXIT_X) return;
    score += SCORE_LEVEL;
    level++;
    loadLevel(level);
}

// --- Agents -----------------------------------------------------------------
function updateAgents(dt) {
    const speed = agentSpeed();
    const half = AGENT_W / 2;

    for (const agent of agents) {
        const chasing = agent.floor === player.floor && player.ride < 0;
        if (chasing && player.x !== agent.x) agent.dir = Math.sign(player.x - agent.x);

        let nx = agent.x + agent.dir * speed * dt;
        let blocked = false;
        if (nx < WALL + half || nx > CANVAS_W - WALL - half) {
            nx = Math.max(WALL + half, Math.min(CANVAS_W - WALL - half, nx));
            blocked = true;
        }
        for (let i = 0; i < SHAFT_XS.length; i++) {
            const [left, right] = shaftBounds(i);
            if (nx + half <= left || nx - half >= right) continue;
            nx = agent.dir > 0 ? left - half : right + half;
            blocked = true;
        }
        agent.x = nx;
        // A patrolling agent turns around at an obstacle; one that is closing in
        // on the spy holds its ground at the shaft edge and keeps firing.
        if (blocked && !chasing) agent.dir = -agent.dir;

        agent.cd -= dt;
        if (agent.cd <= 0) {
            agent.cd = agentFireCooldown();
            if (chasing) bullets.push({ x: agent.x, floor: agent.floor, dir: agent.dir, from: 'agent' });
        }
    }
}

function spawnAgents(dt) {
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (agents.length >= maxAgents()) return;
    const hatches = doors.filter((d) => !d.red);
    if (!hatches.length) return;
    const door = hatches[Math.floor(rand() * hatches.length)];
    agents.push(makeAgent(door.floor, door.x, rand() < 0.5 ? -1 : 1));
}

// --- Bullets and collisions -------------------------------------------------
function updateBullets(dt) {
    const alive = [];
    for (const b of bullets) {
        const speed = b.from === 'player' ? PLAYER_BULLET_SPEED : AGENT_BULLET_SPEED;
        b.x += b.dir * speed * dt;
        if (b.x < WALL || b.x > CANVAS_W - WALL) continue;
        if (resolveBullet(b)) continue;
        alive.push(b);
    }
    bullets = alive;
}

// Returns true when the bullet was spent on something.
function resolveBullet(b) {
    if (b.from === 'player') {
        for (let i = 0; i < agents.length; i++) {
            const a = agents[i];
            if (a.floor !== b.floor || Math.abs(a.x - b.x) > HIT_RANGE) continue;
            agents.splice(i, 1);
            score += SCORE_AGENT;
            return true;
        }
        return false;
    }
    if (!playerIsHittable() || b.floor !== player.floor) return false;
    if (Math.abs(player.x - b.x) > HIT_RANGE) return false;
    hitPlayer();
    return true;
}

function playerIsHittable() {
    return state === 'playing' && player.invuln <= 0 && player.ride < 0 && player.floor >= 0;
}

function checkContact() {
    if (!playerIsHittable()) return;
    for (const a of agents) {
        if (a.floor !== player.floor) continue;
        if (Math.abs(a.x - player.x) > TOUCH_RANGE) continue;
        hitPlayer();
        return;
    }
}

function hitPlayer() {
    lives--;
    bullets = [];
    resetPlayer();
    player.invuln = INVULN_TIME;
    updateHud();
    if (lives <= 0) gameOver();
}

// --- Simulation -------------------------------------------------------------
function step(dt) {
    if (state !== 'playing' || dt <= 0) return;
    updatePlayer(dt);
    updateElevators(dt);
    syncPlayerPosition();
    updateBullets(dt);
    updateAgents(dt);
    checkContact();
    if (state !== 'playing') return;    // the last life ran out mid-frame
    collectDocuments();
    spawnAgents(dt);
    checkEscape();
    updateHud();
}

// --- Rendering --------------------------------------------------------------
function draw() {
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBuilding();
    drawShafts();
    drawDoors();
    drawExit();
    for (const a of agents) drawAgent(a);
    drawBullets();
    drawPlayer();
    drawWalls();
}

function drawBuilding() {
    ctx.fillStyle = '#0d1320';
    ctx.fillRect(WALL, 0, CANVAS_W - 2 * WALL, CANVAS_H);

    // Faint back-wall pinstripes so the corridors read as rooms rather than voids.
    ctx.fillStyle = 'rgba(79, 209, 255, 0.05)';
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        for (let x = WALL + 14; x < CANVAS_W - WALL - 10; x += 24) {
            ctx.fillRect(x, y - FLOOR_H + 26, 10, FLOOR_H - 34);
        }
    }

    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = '#243247';
        ctx.fillRect(WALL, y, CANVAS_W - 2 * WALL, 5);
        ctx.fillStyle = '#131c2b';
        ctx.fillRect(WALL, y + 5, CANVAS_W - 2 * WALL, 4);
    }

    // Ceiling above the roof floor and the lobby floor at the very bottom.
    ctx.fillStyle = '#2f3f59';
    ctx.fillRect(WALL, 0, CANVAS_W - 2 * WALL, 6);
    ctx.fillRect(WALL, floorY(FLOORS - 1) + LOBBY_H - 12, CANVAS_W - 2 * WALL, 6);
}

function drawShafts() {
    for (let i = 0; i < SHAFT_XS.length; i++) {
        const [left] = shaftBounds(i);
        ctx.fillStyle = '#06090f';
        ctx.fillRect(left, TOP_MARGIN - PLAYER_H - 8, SHAFT_W, floorY(FLOORS - 1) - TOP_MARGIN + PLAYER_H + 8);
        ctx.strokeStyle = '#1d2941';
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 1, TOP_MARGIN - PLAYER_H - 7, SHAFT_W - 2, floorY(FLOORS - 1) - TOP_MARGIN + PLAYER_H + 6);

        const car = cars[i];
        ctx.strokeStyle = '#2a3a55';     // hoist cable
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(SHAFT_XS[i], 6);
        ctx.lineTo(SHAFT_XS[i], car.y - CAR_H);
        ctx.stroke();
        ctx.fillStyle = '#4fd1ff';
        ctx.fillRect(left + 4, car.y - CAR_H, SHAFT_W - 8, CAR_H);
        ctx.fillStyle = 'rgba(79, 209, 255, 0.18)';
        ctx.fillRect(left + 4, car.y - 34, SHAFT_W - 8, 34);
    }
}

function drawDoors() {
    for (const d of doors) {
        const y = floorY(d.floor) - DOOR_H;
        const open = d.red && d.collected;
        ctx.fillStyle = d.red && !d.collected ? '#c8384a' : '#3a4a66';
        ctx.fillRect(d.x - DOOR_W / 2, y, DOOR_W, DOOR_H);
        ctx.fillStyle = open ? '#0a0f18' : 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(d.x - DOOR_W / 2 + 3, y + 3, DOOR_W - 6, DOOR_H - 6);
        if (d.red && !d.collected) {
            ctx.fillStyle = '#ffe9a8';
            ctx.fillRect(d.x - 5, y + DOOR_H / 2 - 7, 10, 14);
        }
    }
}

function drawExit() {
    const y = floorY(FLOORS - 1);
    ctx.fillStyle = '#1b6b4a';
    ctx.fillRect(WALL, y - DOOR_H, EXIT_X - WALL, DOOR_H);
    ctx.fillStyle = docsCollected >= docsRequired ? '#5bffa8' : '#2c8a63';
    ctx.fillRect(WALL + 3, y - DOOR_H + 3, EXIT_X - WALL - 6, DOOR_H - 6);
    ctx.fillStyle = '#04121c';
    ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', (WALL + EXIT_X) / 2, y - DOOR_H / 2 + 4);
    ctx.textAlign = 'left';
}

function drawAgent(a) {
    const y = floorY(a.floor) - AGENT_H;
    ctx.fillStyle = '#e06a3c';
    ctx.fillRect(a.x - AGENT_W / 2, y, AGENT_W, AGENT_H);
    ctx.fillStyle = '#2a1408';
    ctx.fillRect(a.x - AGENT_W / 2, y, AGENT_W, 8);
    ctx.fillStyle = '#ffd9c2';
    ctx.fillRect(a.x - 3 + a.dir * 4, y + 11, 6, 5);
}

function drawPlayer() {
    if (player.floor < 0 && player.ride < 0) return;
    // Blink through the invulnerable window so a fresh life is obvious.
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    const y = player.y;
    ctx.fillStyle = '#e7edf7';
    ctx.fillRect(player.x - PLAYER_W / 2, y, PLAYER_W, PLAYER_H);
    ctx.fillStyle = '#1b2333';
    ctx.fillRect(player.x - PLAYER_W / 2, y, PLAYER_W, 8);
    ctx.fillStyle = '#4fd1ff';
    ctx.fillRect(player.x - 3 + player.dir * 4, y + 11, 6, 5);
}

function drawBullets() {
    for (const b of bullets) {
        ctx.fillStyle = b.from === 'player' ? '#fff3b0' : '#ff8a6b';
        ctx.fillRect(b.x - 3, floorY(b.floor) - 20, 6, 3);
    }
}

function drawWalls() {
    ctx.fillStyle = '#1a2436';
    ctx.fillRect(0, 0, WALL, CANVAS_H);
    ctx.fillRect(CANVAS_W - WALL, 0, WALL, CANVAS_H);
    ctx.fillStyle = '#0f1726';
    for (let f = 0; f < FLOORS; f++) ctx.fillRect(3, floorY(f) - 16, WALL - 6, 12);
}

// --- Input ------------------------------------------------------------------
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

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
loadLevel(1);
agents = [];
state = 'idle';
updateHud();
showOverlay('ELEVATOR ACTION', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
