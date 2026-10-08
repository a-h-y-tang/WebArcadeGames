// Elevator Heist — ride the cars, raid the doors, escape the building.
//
// The whole game is a single classic script so the page runs straight off the
// filesystem. Every binding below is top-level, which is what lets the
// Playwright suite drive the simulation directly: tests set `autoRun = false`
// and call `physicsStep(dt)` themselves, so nothing depends on frame timing.

// ---------------------------------------------------------------------------
// Building geometry
// ---------------------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 640;

const FLOORS = 6;          // floor 0 is the roof level, FLOORS - 1 the ground
const FLOOR_H = 96;        // distance between floor surfaces
const TOP_Y = 72;          // y of the roof-level walkway
const SLAB_H = 10;         // thickness of the concrete under a walkway

const WALL_L = 28;
const WALL_R = 692;

const SHAFTS = [180, 420]; // x centre of each elevator shaft
const SHAFT_W = 56;
const ELEV_SPEED = 90;     // px/s — also the auto-levelling speed
const DOCK_TOL = 6;        // how close a car must be to count as "at a floor"

const PLAYER_W = 22;
const PLAYER_H = 34;
const WALK_SPEED = 160;
const SHOOT_CD = 0.3;
const MAX_PLAYER_BULLETS = 3;
const INVULN = 1.5;

const AGENT_W = 22;   // agents are built to the same frame as the player
const AGENT_SHOOT_CD = 1.4;
const AGENT_AIM_DELAY = 0.5;   // reaction time after spotting the player
const AGENT_SIGHT = 420;

const PLAYER_BULLET_SPEED = 420;
const AGENT_BULLET_SPEED = 300;
const BULLET_Y_OFF = 18;   // bullets fly at chest height above the walkway
const BULLET_LEN = 10;

const DOOR_W = 44;
const DOOR_H = 52;
const DOOR_SLOTS = [80, 262, 332, 500, 568, 650];
const DOOR_REACH = 24;
const DOORS_PER_LEVEL = 6;

const EXIT_X = 660;
const EXIT_W = 48;
const EXIT_REACH = 26;

const DOC_SCORE = 200;
const AGENT_SCORE = 150;
const ESCAPE_SCORE = 500;

const BEST_KEY = 'elevatorHeist.best';

const MIN_X = WALL_L + PLAYER_W / 2;
const MAX_X = WALL_R - PLAYER_W / 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'idle';        // idle | running | paused | gameover
let autoRun = true;        // the rAF loop only simulates while this is true
let score = 0;
let best = 0;
let lives = 3;
let level = 1;
let docsCollected = 0;
let docsRequired = 3;

let player = makePlayer();
const elevators = [
    { x: SHAFTS[0], y: TOP_Y, call: null },
    { x: SHAFTS[1], y: TOP_Y, call: null },
];
const doors = [];
const agents = [];
const bullets = [];

const keys = { left: false, right: false, up: false, down: false };

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function floorY(index) {
    return TOP_Y + index * FLOOR_H;
}

// The floor a car counts as serving, or -1 when it hangs between two.
function dockedFloor(y) {
    for (let i = 0; i < FLOORS; i++) {
        if (Math.abs(y - floorY(i)) <= DOCK_TOL) return i;
    }
    return -1;
}

function nearestFloor(y) {
    return clamp(Math.round((y - TOP_Y) / FLOOR_H), 0, FLOORS - 1);
}

function makePlayer() {
    return { x: 60, y: TOP_Y, floor: 0, facing: 1, inShaft: null, shootCd: 0, invuln: 0 };
}

function makeAgent(floor, x, dir) {
    return { floor, x, y: floorY(floor), dir: dir || 1, shootCd: 0.8, sawPlayer: false };
}

function agentSpeed() {
    return 48 + level * 6;
}

function exitOpen() {
    return docsCollected >= docsRequired;
}

// Deterministic PRNG so a level's layout is reproducible for players and tests.
let rngState = 1;

function srand(seed) {
    rngState = (seed >>> 0) || 1;
}

function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

function randInt(n) {
    return Math.floor(rand() * n) % n;
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------
function buildLevel() {
    srand(level * 7919 + 1013);

    doors.length = 0;
    const doorFloors = FLOORS - 1; // the ground floor stays clear for the exit
    for (let f = 0; f < doorFloors; f++) {
        doors.push({ floor: f, x: DOOR_SLOTS[randInt(DOOR_SLOTS.length)], hasDoc: false, opened: false });
    }
    while (doors.length < DOORS_PER_LEVEL) {
        const floor = randInt(doorFloors);
        const x = DOOR_SLOTS[randInt(DOOR_SLOTS.length)];
        if (doors.some((d) => d.floor === floor && d.x === x)) continue;
        doors.push({ floor, x, hasDoc: false, opened: false });
    }

    // Hand documents to three of the six doors.
    const order = doors.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
    }
    docsRequired = 3;
    order.slice(0, docsRequired).forEach((i) => { doors[i].hasDoc = true; });
    docsCollected = 0;

    elevators[0].y = floorY(0);
    elevators[1].y = floorY(FLOORS - 1);
    elevators.forEach((car) => { car.call = null; });

    agents.length = 0;
    const count = Math.min(2 + level, 6);
    for (let i = 0; i < count; i++) {
        const floor = 1 + randInt(FLOORS - 1);     // never the roof the player starts on
        const x = clamp(60 + randInt(560), MIN_X, MAX_X);
        agents.push(makeAgent(floor, x, rand() < 0.5 ? -1 : 1));
    }

    bullets.length = 0;
    player = makePlayer();
    updateHud();
}

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    state = 'running';
    autoRun = true;
    keys.left = keys.right = keys.up = keys.down = false;
    buildLevel();
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += ESCAPE_SCORE;
    level += 1;
    buildLevel();
    updateHud();
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space or click Start to try again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Player actions (edge triggered — keyboard handlers and tests call these)
// ---------------------------------------------------------------------------

// Up/down press, in order: board a car that is level with the player, call a car
// to this floor if the player is standing in a shaft doorway, or open the door
// in front of them. Doors never sit near a shaft, so this is never ambiguous.
function pressVertical(dir) {
    if (state !== 'running') return;
    if (player.inShaft !== null) return;

    for (let i = 0; i < elevators.length; i++) {
        const car = elevators[i];
        if (Math.abs(player.x - car.x) <= SHAFT_W / 2 && Math.abs(car.y - floorY(player.floor)) <= DOCK_TOL) {
            player.inShaft = i;
            player.x = car.x;
            player.y = car.y;
            car.call = null;
            return;
        }
    }

    // Standing in a doorway with no car there: push the button and wait for one.
    // Without this a player could be stranded on a floor both cars have left.
    const shaft = elevators.findIndex((car) => Math.abs(player.x - car.x) <= SHAFT_W / 2);
    if (shaft >= 0 && player.floor >= 0) {
        elevators[shaft].call = player.floor;
        return;
    }

    if (dir < 0) openDoor();
}

// Left/right press: step out of a car, but only while it is level with a floor.
function pressHorizontal(dir) {
    if (state !== 'running') return;
    player.facing = dir < 0 ? -1 : 1;
    if (player.inShaft === null) return;

    const car = elevators[player.inShaft];
    const floor = dockedFloor(car.y);
    if (floor < 0) return;

    player.inShaft = null;
    player.floor = floor;
    player.y = floorY(floor);
    player.x = clamp(car.x + dir * (SHAFT_W / 2 + 12), MIN_X, MAX_X);
}

function openDoor() {
    const door = doors.find(
        (d) => d.floor === player.floor && !d.opened && Math.abs(d.x - player.x) <= DOOR_REACH
    );
    if (!door) return;

    door.opened = true;
    if (door.hasDoc) {
        docsCollected += 1;
        score += DOC_SCORE;
    } else {
        // A trap: security was waiting behind that one.
        agents.push(makeAgent(door.floor, door.x, player.x < door.x ? -1 : 1));
    }
    updateHud();
}

function firePlayerBullet() {
    if (state !== 'running') return;
    // Inside a car you are behind its doors: safe from gunfire, but no shooting
    // out either. Safety and firepower are the trade the player keeps making.
    if (player.inShaft !== null) return;
    if (player.shootCd > 0) return;
    if (bullets.filter((b) => b.from === 'player').length >= MAX_PLAYER_BULLETS) return;

    bullets.push({
        x: player.x + player.facing * (PLAYER_W / 2 + 6),
        y: player.y - BULLET_Y_OFF,
        vx: player.facing * PLAYER_BULLET_SPEED,
        from: 'player',
    });
    player.shootCd = SHOOT_CD;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function physicsStep(dt) {
    updatePlayer(dt);
    updateElevators(dt);
    updateAgents(dt);
    updateBullets(dt);
    checkContacts();
    checkExit();
    player.shootCd = Math.max(0, player.shootCd - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    updateHud();
}

// The gate the animation loop goes through; `physicsStep` stays time-pure.
function tick(dt) {
    if (state !== 'running') return;
    physicsStep(dt);
}

// Cars nobody is riding answer the call button and then sit still.
function updateElevators(dt) {
    for (let i = 0; i < elevators.length; i++) {
        const car = elevators[i];
        if (player.inShaft === i || car.call === null) continue;
        const target = floorY(car.call);
        const delta = target - car.y;
        if (Math.abs(delta) <= ELEV_SPEED * dt) {
            car.y = target;
            car.call = null;
        } else {
            car.y += Math.sign(delta) * ELEV_SPEED * dt;
        }
    }
}

function updatePlayer(dt) {
    if (player.inShaft !== null) {
        const car = elevators[player.inShaft];
        const drive = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
        if (drive !== 0) {
            car.y = clamp(car.y + drive * ELEV_SPEED * dt, floorY(0), floorY(FLOORS - 1));
        } else {
            // Nobody is driving: ease to the nearest floor so stepping out is
            // never a game of pixel-perfect timing.
            const target = floorY(nearestFloor(car.y));
            const delta = target - car.y;
            if (Math.abs(delta) <= ELEV_SPEED * dt) car.y = target;
            else car.y += Math.sign(delta) * ELEV_SPEED * dt;
        }
        player.x = car.x;
        player.y = car.y;
        player.floor = dockedFloor(car.y);
        return;
    }

    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir !== 0) {
        player.x = clamp(player.x + dir * WALK_SPEED * dt, MIN_X, MAX_X);
        player.facing = dir;
    }
    player.y = floorY(player.floor);
}

// A player inside a car is behind the shaft wall: agents can neither see nor
// touch them. That is the one safe spot in the building.
function playerExposed() {
    return player.inShaft === null && player.floor >= 0;
}

function updateAgents(dt) {
    const speed = agentSpeed();
    const minX = WALL_L + AGENT_W / 2;
    const maxX = WALL_R - AGENT_W / 2;

    for (const agent of agents) {
        const sees = playerExposed() && agent.floor === player.floor;
        if (sees) {
            agent.dir = Math.sign(player.x - agent.x) || agent.dir;
            // Spotting someone is not the same as having them in your sights:
            // every acquisition costs the agent a moment, which is the window
            // the player gets to shoot first or duck back into a car.
            if (!agent.sawPlayer) agent.shootCd = Math.max(agent.shootCd, AGENT_AIM_DELAY);
        }
        agent.sawPlayer = sees;

        agent.x += agent.dir * speed * dt;
        if (agent.x <= minX) {
            agent.x = minX;
            agent.dir = 1;
        } else if (agent.x >= maxX) {
            agent.x = maxX;
            agent.dir = -1;
        }
        agent.y = floorY(agent.floor);

        agent.shootCd = Math.max(0, agent.shootCd - dt);
        const dx = player.x - agent.x;
        if (sees && agent.shootCd <= 0 && Math.abs(dx) < AGENT_SIGHT && Math.sign(dx) === agent.dir) {
            bullets.push({
                x: agent.x + agent.dir * (AGENT_W / 2 + 6),
                y: agent.y - BULLET_Y_OFF,
                vx: agent.dir * AGENT_BULLET_SPEED,
                from: 'agent',
            });
            agent.shootCd = AGENT_SHOOT_CD;
        }
    }
}

function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.x += bullet.vx * dt;

        if (bullet.x < WALL_L - BULLET_LEN || bullet.x > WALL_R + BULLET_LEN) {
            bullets.splice(i, 1);
            continue;
        }

        if (bullet.from === 'player') {
            const hit = agents.findIndex(
                (a) => Math.abs(a.x - bullet.x) <= AGENT_W / 2 + 4
                    && Math.abs(a.y - BULLET_Y_OFF - bullet.y) <= 14
            );
            if (hit >= 0) {
                agents.splice(hit, 1);
                score += AGENT_SCORE;
                bullets.splice(i, 1);
            }
        } else if (playerExposed() && player.invuln === 0 && hitsPlayer(bullet)) {
            bullets.splice(i, 1);
            hitPlayer();
            return; // hitPlayer() clears the list; nothing left to walk
        }
    }
}

function hitsPlayer(bullet) {
    return Math.abs(bullet.x - player.x) <= PLAYER_W / 2 + 4
        && bullet.y >= player.y - PLAYER_H
        && bullet.y <= player.y;
}

function checkContacts() {
    if (!playerExposed() || player.invuln > 0) return;
    const reach = (AGENT_W + PLAYER_W) / 2 - 4;
    const caught = agents.some((a) => a.floor === player.floor && Math.abs(a.x - player.x) < reach);
    if (caught) hitPlayer();
}

function hitPlayer() {
    lives -= 1;
    bullets.length = 0;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        gameOver();
        return;
    }
    player = makePlayer();
    player.invuln = INVULN;
    updateHud();
}

function checkExit() {
    if (!exitOpen()) return;
    if (player.inShaft !== null || player.floor !== FLOORS - 1) return;
    if (Math.abs(player.x - EXIT_X) > EXIT_REACH) return;
    nextLevel();
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('level', level);
    setText('docs', `${docsCollected}/${docsRequired}`);
    setText('lives', lives);
    setText('best', best);
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
        /* storage unavailable (private mode, file restrictions) — keep playing */
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    ctx.fillStyle = '#0a0f1c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Shafts go in behind the walkways so a floor reads as continuous concrete
    // with a lift car running past it, not as a hole in the building.
    drawShell();
    drawShafts();
    drawSlabs();
    drawDoors();
    drawExit();
    drawAgents();
    drawBullets();
    drawPlayer();
    drawStreet();
}

function shellTop() {
    return TOP_Y - 54;
}

function shellBottom() {
    return floorY(FLOORS - 1) + 56;
}

function drawShell() {
    ctx.fillStyle = '#101a2e';
    ctx.fillRect(WALL_L - 14, shellTop(), WALL_R - WALL_L + 28, shellBottom() - shellTop());
    ctx.strokeStyle = '#2b3c5e';
    ctx.lineWidth = 2;
    ctx.strokeRect(WALL_L - 14, shellTop(), WALL_R - WALL_L + 28, shellBottom() - shellTop());

    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = 'rgba(55, 214, 196, 0.04)';
        ctx.fillRect(WALL_L, y - 46, WALL_R - WALL_L, 40);
        ctx.fillStyle = '#1b2742';
        for (let x = WALL_L + 10; x < WALL_R - 20; x += 46) {
            ctx.fillRect(x, y - 40, 26, 24);
        }
        ctx.fillStyle = '#4d5f85';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(f === FLOORS - 1 ? 'GROUND' : `FLOOR ${FLOORS - 1 - f}`, WALL_L - 2, y - 50);
    }
}

function drawSlabs() {
    for (let f = 0; f < FLOORS; f++) {
        const y = floorY(f);
        ctx.fillStyle = f === FLOORS - 1 ? '#3b4a6d' : '#2a3a5c';
        ctx.fillRect(WALL_L - 6, y, WALL_R - WALL_L + 12, SLAB_H);
        ctx.fillStyle = 'rgba(55, 214, 196, 0.35)';
        ctx.fillRect(WALL_L - 6, y, WALL_R - WALL_L + 12, 2);
    }
}

function drawShafts() {
    for (const car of elevators) {
        const left = car.x - SHAFT_W / 2;
        const top = shellTop() + 8;
        const bottom = floorY(FLOORS - 1);

        ctx.fillStyle = '#060a14';
        ctx.fillRect(left, top, SHAFT_W, bottom - top);
        ctx.strokeStyle = '#243557';
        ctx.lineWidth = 1;
        ctx.strokeRect(left, top, SHAFT_W, bottom - top);

        // Landing marks, so it is obvious where a car can be boarded.
        ctx.fillStyle = 'rgba(55, 214, 196, 0.18)';
        for (let f = 0; f < FLOORS; f++) {
            ctx.fillRect(left, floorY(f) - 3, SHAFT_W, 3);
        }

        if (car.call !== null) {
            const y = floorY(car.call);
            ctx.fillStyle = '#ffd36b';
            ctx.beginPath();
            ctx.moveTo(car.x, y - 8);
            ctx.lineTo(car.x - 6, y - 18);
            ctx.lineTo(car.x + 6, y - 18);
            ctx.closePath();
            ctx.fill();
        }

        ctx.strokeStyle = '#33456b';
        ctx.beginPath();
        ctx.moveTo(car.x, top);
        ctx.lineTo(car.x, car.y - 44);
        ctx.stroke();

        const docked = dockedFloor(car.y) >= 0;
        ctx.fillStyle = docked ? '#2c4a63' : '#1e3048';
        ctx.fillRect(left + 4, car.y - 46, SHAFT_W - 8, 46);
        ctx.strokeStyle = docked ? '#37d6c4' : '#56688c';
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 4, car.y - 46, SHAFT_W - 8, 46);
        ctx.fillStyle = 'rgba(232, 238, 252, 0.07)';
        ctx.fillRect(left + 10, car.y - 40, SHAFT_W - 20, 18);
        ctx.fillStyle = docked ? '#9bffd4' : '#56688c';
        ctx.fillRect(car.x - 1, car.y - 46, 2, 46); // the car's door seam
    }
}

function drawDoors() {
    for (const door of doors) {
        const y = floorY(door.floor);
        const left = door.x - DOOR_W / 2;

        if (door.opened) {
            ctx.fillStyle = '#060a14';
            ctx.fillRect(left, y - DOOR_H, DOOR_W, DOOR_H);
            ctx.fillStyle = '#16223a';
            ctx.fillRect(left, y - DOOR_H, 9, DOOR_H);  // the door swung back
            ctx.strokeStyle = '#3a4c71';
        } else {
            ctx.fillStyle = '#7a2436';
            ctx.fillRect(left, y - DOOR_H, DOOR_W, DOOR_H);
            ctx.fillStyle = '#9c2f44';
            ctx.fillRect(left + 4, y - DOOR_H + 4, DOOR_W - 8, DOOR_H - 8);
            ctx.fillStyle = '#5d1b29';
            ctx.fillRect(left + DOOR_W / 2 - 1, y - DOOR_H + 4, 2, DOOR_H - 8);
            ctx.fillStyle = '#ffd36b';
            ctx.fillRect(left + DOOR_W - 14, y - DOOR_H / 2 - 2, 4, 4);
            ctx.strokeStyle = '#ff8c9c';
        }
        ctx.lineWidth = 2;
        ctx.strokeRect(left, y - DOOR_H, DOOR_W, DOOR_H);
    }
}

function drawExit() {
    const y = floorY(FLOORS - 1);
    const left = EXIT_X - EXIT_W / 2;
    const open = exitOpen();

    if (open) {
        ctx.fillStyle = 'rgba(78, 242, 161, 0.14)';
        ctx.fillRect(left - 10, y - DOOR_H - 10, EXIT_W + 20, DOOR_H + 10);
    }
    ctx.fillStyle = open ? '#17533f' : '#1b2740';
    ctx.fillRect(left, y - DOOR_H, EXIT_W, DOOR_H);
    ctx.strokeStyle = open ? '#4ef2a1' : '#3a4c71';
    ctx.lineWidth = 2;
    ctx.strokeRect(left, y - DOOR_H, EXIT_W, DOOR_H);
    ctx.fillStyle = open ? '#9bffd4' : '#56688c';
    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EXIT', EXIT_X, y - DOOR_H / 2 + 4);
}

function drawStreet() {
    const top = floorY(FLOORS - 1) + SLAB_H;
    ctx.fillStyle = '#0c1322';
    ctx.fillRect(WALL_L - 13, top, WALL_R - WALL_L + 26, shellBottom() - top - 1);
    ctx.strokeStyle = 'rgba(55, 214, 196, 0.12)';
    ctx.lineWidth = 1;
    for (let x = WALL_L; x < WALL_R; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, shellBottom() - 1);
        ctx.lineTo(x + 16, top);
        ctx.stroke();
    }
    ctx.fillStyle = exitOpen() ? '#4ef2a1' : '#3f5177';
    ctx.font = '10px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    const left = docsRequired - docsCollected;
    ctx.fillText(
        exitOpen()
            ? 'STREET LEVEL — GET OUT'
            : `STREET LEVEL — ${left} DOCUMENT${left === 1 ? '' : 'S'} STILL INSIDE`,
        (WALL_L + WALL_R) / 2,
        top + 26
    );
}

function drawFigure(x, y, facing, bodyColor, trimColor) {
    const left = x - PLAYER_W / 2;
    const top = y - PLAYER_H;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left - 2, y - 3, PLAYER_W + 4, 4);            // shadow at the feet
    ctx.fillStyle = bodyColor;
    ctx.fillRect(left, top + 11, PLAYER_W, PLAYER_H - 13);     // coat
    ctx.fillRect(left + 3, y - 3, 6, 3);                       // legs
    ctx.fillRect(left + PLAYER_W - 9, y - 3, 6, 3);
    ctx.fillStyle = trimColor;
    ctx.fillRect(left + 4, top + 1, PLAYER_W - 8, 10);         // head
    ctx.fillRect(left + 2, top, PLAYER_W - 4, 3);              // hat brim
    ctx.fillStyle = bodyColor;
    ctx.fillRect(facing > 0 ? x : left - 6, top + 15, PLAYER_W / 2 + 6, 4); // arm + pistol
}

function drawPlayer() {
    if (state === 'idle') return;
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return; // blink
    drawFigure(player.x, player.y, player.facing, '#37d6c4', '#d8fff8');
}

function drawAgents() {
    for (const agent of agents) {
        drawFigure(agent.x, agent.y, agent.dir, '#ff5d6c', '#ffd7db');
    }
}

function drawBullets() {
    for (const bullet of bullets) {
        const player_shot = bullet.from === 'player';
        ctx.fillStyle = player_shot ? 'rgba(155, 255, 212, 0.25)' : 'rgba(255, 211, 107, 0.25)';
        ctx.fillRect(bullet.x - BULLET_LEN, bullet.y - 4, BULLET_LEN * 2, 8);
        ctx.fillStyle = player_shot ? '#9bffd4' : '#ffd36b';
        ctx.fillRect(bullet.x - BULLET_LEN / 2, bullet.y - 2, BULLET_LEN, 4);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const HELD = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
};

window.addEventListener('keydown', (event) => {
    const held = HELD[event.code];
    if (held) {
        event.preventDefault();
        const first = !keys[held];
        keys[held] = true;
        if (first) {
            if (held === 'left') pressHorizontal(-1);
            else if (held === 'right') pressHorizontal(1);
            else if (held === 'up') pressVertical(-1);
            else pressVertical(1);
        }
        return;
    }

    if (event.code === 'Space') {
        event.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'running') firePlayerBullet();
        return;
    }

    if (event.code === 'KeyP') {
        event.preventDefault();
        togglePause();
    }
});

window.addEventListener('keyup', (event) => {
    const held = HELD[event.code];
    if (held) keys[held] = false;
});

document.getElementById('btn-start').addEventListener('click', () => {
    if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (autoRun) {
        tick(dt);
        render();
    }
    requestAnimationFrame(frame);
}

best = loadBest();
updateHud();
render();
requestAnimationFrame(frame);
