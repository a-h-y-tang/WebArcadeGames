// Elevator Action — ride ten floors of elevators, empty the red doors, and
// reach the getaway car in the garage with every document in hand.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, player, elevators, doors, agents, bullets)
// is kept at the top level on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules and the constants
// behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const VH = canvas.height;            // 560 — the viewport, not the world
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const FLOOR_COUNT = 10;              // floor 0 is the garage, floor 9 the roof
const FLOOR_H = 96;
const FLOOR_THICK = 8;
const WORLD_H = FLOOR_COUNT * FLOOR_H;
const WALL = 12;                     // inside face of the building's walls

const PLAYER_HW = 10;                // half width of every character
const PLAYER_H = 34;
const CROUCH_H = 18;
const CHEST = 22;                    // bullet height above the feet, standing
const DUCK_CHEST = 10;               // ... and while ducked

const WALK_SPEED = 120;              // px/s
const SHOT_COOLDOWN = 0.3;           // seconds between the player's shots
const PLAYER_BULLET_SPEED = 330;
const AGENT_BULLET_SPEED = 240;
const BULLET_R = 3;

const SHAFT_X = [150, 300];          // shaft centres
const SHAFT_W = 54;
const ALIGN_TOL = 7;                 // px a car may be off a floor and still serve it

const DOOR_X = [48, 104, 206, 248, 352, 432];
const DOOR_W = 34;
const DOOR_H = 52;

const EXIT_X = 400;                  // the garage mouth runs EXIT_X .. W - WALL

const AGENT_SPEED = 56;
const AGENT_RANGE = 260;
const AGENT_FIRE_COOLDOWN = 1.4;

const LIVES_START = 3;
const LEVEL_COUNT = 3;
const DOC_POINTS = 500;
const AGENT_POINTS = 300;
const CLEAR_BONUS = 1000;

const BEST_KEY = 'elevatoraction-best';

// Which door slots hold the documents, per level: [floor, slot].
const RED_DOORS = [
    [[8, 1], [6, 4], [4, 0], [2, 3]],
    [[9, 5], [7, 2], [5, 1], [3, 4], [1, 0]],
    [[9, 0], [8, 3], [6, 5], [5, 2], [3, 1], [1, 4]],
];

// Where each car waits when a level (or a life) begins.
const CAR_START_FLOOR = [FLOOR_COUNT - 1, 4];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = LIVES_START;
let best = loadBest();
let doors = [];
let agents = [];
let bullets = [];
let autoRun = true;                  // the animation loop only simulates while true
let spawnTimer = 0;
let spawnInterval = 2.6;             // seconds between agents, set by loadLevel
let spawnCursor = 0;                 // round-robin over the doors agents come from
let maxAgents = 4;                   // concurrent agents, set by loadLevel
const keys = Object.create(null);

const player = {
    x: 40,
    y: 0,
    floor: FLOOR_COUNT - 1,
    dir: 1,
    crouch: false,
    inElevator: null,                // index into elevators while riding
    cooldown: 0,
};

const elevators = SHAFT_X.map((x, i) => ({ x, w: SHAFT_W, y: 0, floor: CAR_START_FLOOR[i] }));
const camera = { y: 0 };
let visualClock = 0;                 // wall-clock seconds, for cosmetic pulses only

// --- geometry --------------------------------------------------------------

// The y a character's feet rest at on floor `i`. Floor 0 is the garage.
function floorY(i) {
    return WORLD_H - i * FLOOR_H - FLOOR_THICK;
}

// The floor a y is closest to, clamped to the building.
function floorAt(y) {
    const i = Math.round((WORLD_H - FLOOR_THICK - y) / FLOOR_H);
    return Math.max(0, Math.min(FLOOR_COUNT - 1, i));
}

function elevatorSpeed() {
    return 95 + (level - 1) * 10;
}

// A shaft is only crossable where its car is standing.
function shaftOpen(i, floor) {
    return Math.abs(elevators[i].y - floorY(floor)) <= ALIGN_TOL;
}

// Keep a walker inside the open stretch of floor that `fromX` sits in: the
// walls bound it, and so does any shaft whose car is somewhere else.
function clampWalk(x, fromX, floor) {
    let lo = WALL + PLAYER_HW;
    let hi = W - WALL - PLAYER_HW;
    for (let i = 0; i < elevators.length; i++) {
        if (shaftOpen(i, floor)) continue;
        const left = SHAFT_X[i] - SHAFT_W / 2;
        const right = SHAFT_X[i] + SHAFT_W / 2;
        if (fromX <= SHAFT_X[i]) hi = Math.min(hi, left - PLAYER_HW);
        else lo = Math.max(lo, right + PLAYER_HW);
    }
    if (lo > hi) return fromX;
    return Math.max(lo, Math.min(hi, x));
}

// --- building --------------------------------------------------------------

// Deterministic floor plan: the level's table names the document doors, and
// every other slot that fits the pattern becomes a door agents come out of.
function buildLevel(n) {
    const reds = RED_DOORS[(n - 1) % RED_DOORS.length];
    const isRed = (floor, slot) => reds.some((r) => r[0] === floor && r[1] === slot);
    const list = [];
    for (let floor = 1; floor < FLOOR_COUNT; floor++) {
        DOOR_X.forEach((x, slot) => {
            const red = isRed(floor, slot);
            if (!red && (floor + slot) % 2 !== 0) return;
            list.push({ x, floor, type: red ? 'red' : 'grey', collected: false });
        });
    }
    return list;
}

function docsLeft() {
    return doors.filter((d) => d.type === 'red' && !d.collected).length;
}

function resetElevators() {
    elevators.forEach((e, i) => {
        e.floor = CAR_START_FLOOR[i];
        e.y = floorY(e.floor);
    });
}

function spawnPlayer() {
    player.x = 40;
    player.floor = FLOOR_COUNT - 1;
    player.y = floorY(player.floor);
    player.dir = 1;
    player.crouch = false;
    player.inElevator = null;
    player.cooldown = 0;
}

function loadLevel(n) {
    level = n;
    doors = buildLevel(n);
    agents = [];
    bullets = [];
    spawnTimer = 0;
    spawnCursor = 0;
    spawnInterval = Math.max(1.1, 2.6 - (n - 1) * 0.35);
    maxAgents = 3 + n;
    resetElevators();
    spawnPlayer();
    updateCamera();
}

// --- game flow -------------------------------------------------------------

function startGame() {
    score = 0;
    lives = LIVES_START;
    autoRun = true;
    loadLevel(1);
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
            loadLevel(level + 1);
            state = 'running';
            hideOverlay();
            updateHud();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            playerShoot();
            break;
    }
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

function killPlayer() {
    agents = [];
    bullets = [];
    lives--;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Final score ${score}`, 'Press Space to try again');
    } else {
        resetElevators();
        spawnPlayer();
        spawnTimer = 0;
    }
    updateHud();
}

function clearLevel() {
    score += CLEAR_BONUS * level;
    agents = [];
    bullets = [];
    if (level >= LEVEL_COUNT) {
        state = 'won';
        saveBest();
        showOverlay('YOU WIN!', `Final score ${score}`, 'Press Space to play again');
    } else {
        state = 'levelclear';
        saveBest();
        showOverlay('FLOOR CLEARED', `Score ${score}`, `Press Space for building ${level + 1}`);
    }
    updateHud();
}

// --- the player ------------------------------------------------------------

function heldDir() {
    return (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
}

function heldVertical() {
    return (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
}

function playerHeight() {
    return player.crouch ? CROUCH_H : PLAYER_H;
}

// Board the car standing at the player's floor, if they are inside its shaft.
function enterElevator() {
    if (state !== 'running' || player.inElevator !== null) return false;
    for (let i = 0; i < elevators.length; i++) {
        if (Math.abs(player.x - SHAFT_X[i]) > SHAFT_W / 2) continue;
        if (!shaftOpen(i, player.floor)) continue;
        elevators[i].y = floorY(player.floor);
        elevators[i].floor = player.floor;
        player.inElevator = i;
        player.x = SHAFT_X[i];
        player.y = elevators[i].y;
        player.crouch = false;
        return true;
    }
    return false;
}

// Step off onto the floor the car is level with. Mid-flight, nothing happens.
function leaveElevator(dir) {
    if (player.inElevator === null) return false;
    const car = elevators[player.inElevator];
    const floor = floorAt(car.y);
    if (Math.abs(car.y - floorY(floor)) > ALIGN_TOL) return false;
    const side = dir < 0 ? -1 : 1;
    player.floor = floor;
    player.y = floorY(floor);
    player.x = Math.max(
        WALL + PLAYER_HW,
        Math.min(W - WALL - PLAYER_HW, SHAFT_X[player.inElevator] + side * (SHAFT_W / 2 + PLAYER_HW))
    );
    player.dir = side;
    player.inElevator = null;
    return true;
}

function playerShoot() {
    if (state !== 'running' || player.cooldown > 0) return false;
    player.cooldown = SHOT_COOLDOWN;
    bullets.push({
        x: player.x + player.dir * (PLAYER_HW + 2),
        y: player.y - (player.crouch ? DUCK_CHEST : CHEST),
        vx: player.dir * PLAYER_BULLET_SPEED,
        from: 'player',
    });
    return true;
}

function updatePlayer(dt) {
    if (player.cooldown > 0) player.cooldown = Math.max(0, player.cooldown - dt);

    if (player.inElevator !== null) {
        const car = elevators[player.inElevator];
        const vertical = heldVertical();
        if (vertical) {
            car.y = Math.max(
                floorY(FLOOR_COUNT - 1),
                Math.min(floorY(0), car.y + vertical * elevatorSpeed() * dt)
            );
        }
        car.floor = floorAt(car.y);
        player.y = car.y;
        player.x = SHAFT_X[player.inElevator];
        player.floor = car.floor;
        player.crouch = false;

        const sideways = heldDir();
        if (sideways) leaveElevator(sideways);
        return;
    }

    if (heldVertical() && enterElevator()) return;

    player.crouch = heldVertical() > 0;

    const dir = heldDir();
    if (dir) player.dir = dir;
    if (dir && !player.crouch) {
        const from = player.x;
        player.x = clampWalk(from + dir * WALK_SPEED * dt, from, player.floor);
    } else {
        // standing still still means honouring a car that has left this floor
        player.x = clampWalk(player.x, player.x, player.floor);
    }
}

function collectDoors() {
    if (player.inElevator !== null) return;
    doors.forEach((d) => {
        if (d.type !== 'red' || d.collected) return;
        if (d.floor !== player.floor) return;
        if (Math.abs(d.x - player.x) > DOOR_W / 2 + PLAYER_HW) return;
        d.collected = true;
        score += DOC_POINTS;
    });
}

function atExit() {
    return (
        player.inElevator === null &&
        player.floor === 0 &&
        player.x + PLAYER_HW > EXIT_X &&
        docsLeft() === 0
    );
}

// --- agents ----------------------------------------------------------------

function spawnAgent() {
    const grey = doors.filter((d) => d.type === 'grey');
    if (!grey.length) return;
    const near = grey.filter(
        (d) =>
            Math.abs(d.floor - player.floor) <= 3 &&
            !(d.floor === player.floor && Math.abs(d.x - player.x) < 60)
    );
    const pool = near.length ? near : grey;
    const door = pool[spawnCursor++ % pool.length];
    agents.push({
        x: door.x,
        y: floorY(door.floor),
        floor: door.floor,
        dir: door.x > player.x ? -1 : 1,
        cooldown: 0.6,
    });
}

function updateAgents(dt) {
    const chaseable = player.inElevator === null;
    agents.forEach((a) => {
        if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - dt);

        const sameFloor = chaseable && a.floor === player.floor;
        if (sameFloor) a.dir = player.x >= a.x ? 1 : -1;

        const from = a.x;
        const want = from + a.dir * AGENT_SPEED * dt;
        a.x = clampWalk(want, from, a.floor);
        // a patrolling agent turns around at a wall or an empty shaft; one that
        // is chasing keeps facing its target across the gap instead
        if (a.x !== want && !sameFloor) a.dir *= -1;

        if (sameFloor && a.cooldown === 0 && Math.abs(player.x - a.x) <= AGENT_RANGE) {
            const facing = (player.x - a.x) * a.dir >= 0;
            if (facing) {
                a.cooldown = AGENT_FIRE_COOLDOWN;
                bullets.push({
                    x: a.x + a.dir * (PLAYER_HW + 2),
                    y: a.y - CHEST,
                    vx: a.dir * AGENT_BULLET_SPEED,
                    from: 'agent',
                });
            }
        }
    });
}

function agentTouchesPlayer() {
    if (player.inElevator !== null) return false;
    return agents.some(
        (a) => a.floor === player.floor && Math.abs(a.x - player.x) < PLAYER_HW * 2
    );
}

// --- bullets ---------------------------------------------------------------

function hitsBox(bullet, cx, feet, height) {
    if (Math.abs(bullet.x - cx) > PLAYER_HW + BULLET_R) return false;
    return bullet.y >= feet - height && bullet.y <= feet;
}

// Returns true when the player was hit, which ends the step early.
function updateBullets(dt) {
    let playerHit = false;
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        if (b.x < 0 || b.x > W) {
            bullets.splice(i, 1);
            continue;
        }

        if (b.from === 'player') {
            const target = agents.findIndex((a) => hitsBox(b, a.x, a.y, PLAYER_H));
            if (target >= 0) {
                agents.splice(target, 1);
                bullets.splice(i, 1);
                score += AGENT_POINTS;
            }
        } else if (
            player.inElevator === null &&
            hitsBox(b, player.x, player.y, playerHeight())
        ) {
            bullets.splice(i, 1);
            playerHit = true;
            break;
        }
    }
    return playerHit;
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    updatePlayer(dt);
    collectDoors();

    if (atExit()) {
        clearLevel();
        updateCamera();
        updateHud();
        return;
    }

    updateAgents(dt);

    if (updateBullets(dt) || agentTouchesPlayer()) {
        killPlayer();
        updateCamera();
        return;
    }

    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        if (agents.length < maxAgents) spawnAgent();
    }

    updateCamera();
    updateHud();
}

function updateCamera() {
    camera.y = Math.max(0, Math.min(WORLD_H - VH, player.y - VH / 2));
}

// --- HUD and overlay -------------------------------------------------------

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

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('level', level);
    setText('lives', lives);
    setText('docs', docsLeft());
    setText('best', best);
}

function showOverlay(title, scoreLine, sub) {
    setText('overlay-title', title);
    setText('overlay-score', scoreLine || '');
    setText('overlay-sub', sub || '');
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

function drawBuilding() {
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, camera.y, W, VH);

    // outer walls
    ctx.fillStyle = '#1b2235';
    ctx.fillRect(0, 0, WALL, WORLD_H);
    ctx.fillRect(W - WALL, 0, WALL, WORLD_H);

    for (let f = 0; f < FLOOR_COUNT; f++) {
        const y = floorY(f);
        ctx.fillStyle = '#24304a';
        ctx.fillRect(WALL, y, W - WALL * 2, FLOOR_THICK);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(WALL, y - 1, W - WALL * 2, 1);

        ctx.fillStyle = 'rgba(148, 163, 190, 0.7)';
        ctx.font = '9px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(f === 0 ? 'G' : String(f + 1), WALL + 3, y - 4);
    }
}

function drawShafts() {
    SHAFT_X.forEach((x, i) => {
        const left = x - SHAFT_W / 2;
        ctx.fillStyle = '#0b1020';
        ctx.fillRect(left, 0, SHAFT_W, WORLD_H);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, 0.5, SHAFT_W - 1, WORLD_H - 1);

        // call lamps beside the shaft, one per floor, breathing on their own clock
        for (let f = 0; f < FLOOR_COUNT; f++) {
            const lampY = floorY(f) - 18;
            const pulse = 0.3 + 0.28 * Math.sin(visualClock * 3 + f * 0.7 + i);
            ctx.fillStyle = `rgba(56, 189, 248, ${pulse.toFixed(3)})`;
            ctx.fillRect(left - 5, lampY, 3, 8);
            ctx.fillRect(left + SHAFT_W + 2, lampY, 3, 8);
        }

        // cable
        ctx.strokeStyle = 'rgba(126, 138, 163, 0.35)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, elevators[i].y);
        ctx.stroke();

        // the car
        const car = elevators[i];
        const h = 56;
        ctx.fillStyle = '#334765';
        ctx.fillRect(left + 3, car.y - h, SHAFT_W - 6, h);
        ctx.fillStyle = 'rgba(226, 232, 240, 0.16)';
        ctx.fillRect(left + 7, car.y - h + 5, SHAFT_W - 14, h - 14);
        ctx.fillStyle = '#9fb3d1';
        ctx.fillRect(left + 3, car.y - 4, SHAFT_W - 6, 4);
    });
}

function drawDoors() {
    doors.forEach((d) => {
        const y = floorY(d.floor) - DOOR_H;
        const x = d.x - DOOR_W / 2;
        if (d.type === 'red' && !d.collected) {
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(x, y, DOOR_W, DOOR_H);
            const glow = 0.25 + 0.2 * Math.sin(visualClock * 4 + d.floor);
            ctx.strokeStyle = `rgba(248, 113, 113, ${glow.toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.strokeRect(x - 2.5, y - 2.5, DOOR_W + 5, DOOR_H + 5);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.fillRect(x + DOOR_W / 2 - 5, y + DOOR_H / 2 - 7, 10, 14);
        } else if (d.type === 'red') {
            ctx.fillStyle = '#3b4762';
            ctx.fillRect(x, y, DOOR_W, DOOR_H);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, DOOR_W - 1, DOOR_H - 1);
        } else {
            ctx.fillStyle = '#2d374d';
            ctx.fillRect(x, y, DOOR_W, DOOR_H);
            ctx.fillStyle = 'rgba(226, 232, 240, 0.25)';
            ctx.fillRect(x + DOOR_W - 8, y + DOOR_H / 2 - 2, 4, 4);
        }
    });
}

function drawGarage() {
    const y = floorY(0);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.fillRect(EXIT_X, y - 60, W - WALL - EXIT_X, 60);
    ctx.strokeStyle = docsLeft() === 0 ? '#38bdf8' : 'rgba(126, 138, 163, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(EXIT_X + 1, y - 59, W - WALL - EXIT_X - 2, 58);

    // the getaway car
    ctx.fillStyle = docsLeft() === 0 ? '#38bdf8' : '#55657f';
    ctx.fillRect(EXIT_X + 6, y - 22, 46, 12);
    ctx.fillRect(EXIT_X + 16, y - 31, 26, 10);
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(EXIT_X + 17, y - 9, 5, 0, Math.PI * 2);
    ctx.arc(EXIT_X + 42, y - 9, 5, 0, Math.PI * 2);
    ctx.fill();
}

function drawCharacter(c, height, body, head, hat) {
    const top = c.y - height;
    const shoulder = top + height * 0.32;

    // a dark outline keeps a character readable against a door or a dark floor
    ctx.fillStyle = 'rgba(5, 7, 13, 0.85)';
    ctx.fillRect(c.x - PLAYER_HW - 2, shoulder - 2, PLAYER_HW * 2 + 4, c.y - shoulder + 2);

    ctx.fillStyle = body;
    ctx.fillRect(c.x - PLAYER_HW, shoulder, PLAYER_HW * 2, c.y - shoulder);

    // legs, so a standing character does not read as a block
    ctx.fillStyle = 'rgba(5, 7, 13, 0.6)';
    ctx.fillRect(c.x - 1, c.y - height * 0.22, 2, height * 0.22);

    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(c.x, top + height * 0.2, height * 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (hat) {
        ctx.fillStyle = hat;
        ctx.fillRect(c.x - height * 0.26, top + height * 0.13, height * 0.52, 3);
        ctx.fillRect(c.x - height * 0.16, top + height * 0.02, height * 0.32, height * 0.12);
    }

    // the gun arm, pointing the way the character faces
    ctx.fillStyle = head;
    ctx.fillRect(c.x + (c.dir > 0 ? PLAYER_HW - 2 : -PLAYER_HW - 6), c.y - height * 0.62, 8, 3);
}

function drawAgents() {
    agents.forEach((a) => drawCharacter(a, PLAYER_H, '#55617d', '#ef4444', '#11182a'));
}

function drawPlayer() {
    drawCharacter(player, playerHeight(), '#2563eb', '#f1f5f9');
}

function drawBullets() {
    bullets.forEach((b) => {
        ctx.fillStyle = b.from === 'player' ? '#f8fafc' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(b.x, b.y, BULLET_R, 0, Math.PI * 2);
        ctx.fill();
    });
}

function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#070a12';
    ctx.fillRect(0, 0, W, VH);

    ctx.save();
    ctx.translate(0, -camera.y);
    drawBuilding();
    drawShafts();
    drawDoors();
    drawGarage();
    drawAgents();
    drawBullets();
    drawPlayer();
    ctx.restore();
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            if (state === 'running' && player.inElevator === null && !enterElevator()) {
                player.crouch = true;
            }
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            if (state === 'running') enterElevator();
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
    visualClock = ts / 1000;

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

resetElevators();
spawnPlayer();
updateCamera();
updateHud();
draw();
requestAnimationFrame(frame);
