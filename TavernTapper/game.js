// ---------------------------------------------------------------------------
// Tavern Tapper — a four-bar drink-serving arcade game on an HTML5 canvas.
//
// You are the barkeep at the right-hand end of four parallel bars. Thirsty
// patrons walk in from the left and shuffle toward you; you slide full mugs
// down the bar to shove them back. A patron pushed off the far end leaves
// happy and slides the empty mug back to you — catch it or it shatters on the
// floor. A mug served into an empty bar shatters too, and a patron who reaches
// the tap grabs you. Any of those costs a life.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// BurgerTime and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// (with `autoStep = false`) instead of racing requestAnimationFrame.
// ---------------------------------------------------------------------------

// --- Tavern geometry ---
const CANVAS_W = 600;
const CANVAS_H = 420;
const LANE_COUNT = 4;
const LANE_TOP = 76;                // y of the first bar's counter top
const LANE_H = 86;                  // vertical distance between bars
const COUNTER_LEFT = 40;            // left end of the polished counter
const COUNTER_RIGHT = 540;          // right end, where the taps stand
const LEAVE_X = 24;                 // the tavern door: patrons stack up here
const TAP_X = 536;                  // where a poured mug appears
const GRAB_X = 512;                 // a patron this far right grabs the barkeep
const PLAYER_X = 568;               // the barkeep's own column

// --- Motion (px/s) ---
const MUG_SPEED = 250;              // full mug sliding left
const EMPTY_SPEED = 150;            // empty mug sliding back right
const PUSH_BACK = 70;               // how far a served drink shoves a patron
const DRINK_TIME = 0.8;             // seconds a patron stands still drinking
const HIT_DIST = 18;                // mug/patron contact distance
const SERVE_COOLDOWN = 0.35;        // seconds between pours

// --- Scoring ---
const SCORE_HIT = 50;               // landing a mug on a patron
const SCORE_SERVED = 200;           // sending a patron out of the tavern
const SCORE_CATCH = 100;            // catching a returning empty
const LEVEL_BONUS = 500;            // clearing a level

// --- Run ---
const START_LIVES = 3;
const RESPAWN_GRACE = 1.2;          // quiet seconds after losing a life

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state = 'idle';                 // idle | running | paused | over
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let clock = 0;                      // seconds of simulated time, for animation

let player = { lane: 0, pour: 0 };  // pour = seconds left of the pouring pose
let customers = [];                 // { lane, x, drink, sway }
let mugs = [];                      // full mugs travelling left
let empties = [];                   // empty mugs travelling right
let shards = [];                    // purely decorative smash particles

let toSpawn = 0;                    // patrons of this level not yet through the door
let spawnTimer = 0;
let serveTimer = 0;
let spawnEnabled = true;            // tests switch this off for quiet bars
let autoStep = true;                // tests switch this off to drive step() by hand

// ---------------------------------------------------------------------------
// Level shape
// ---------------------------------------------------------------------------

// Patrons get quicker every level; the ramp is gentle so level 10 is fast but
// still playable rather than instantly fatal.
function customerSpeed() {
    return 20 + (level - 1) * 4;
}

function levelCustomers() {
    return 5 + level;
}

// How many mugs a patron drinks before heading home. One mug is enough early
// on; from level 3 they take two and from level 6 three, which is the cap —
// beyond that the extra pressure comes from speed and numbers instead. The
// ramp was flattened after bot playthroughs died in a wall at the old level 5.
function customerThirst() {
    return Math.min(3, 1 + Math.floor(level / 3));
}

function spawnInterval() {
    return Math.max(1.1, 3.4 - level * 0.25);
}

function laneY(lane) {
    return LANE_TOP + lane * LANE_H;
}

// ---------------------------------------------------------------------------
// Spawning and serving
// ---------------------------------------------------------------------------

function spawnCustomer(lane, thirst = customerThirst()) {
    customers.push({
        lane,
        x: LEAVE_X + 6,
        thirst,
        drink: 0,
        sway: Math.random() * Math.PI * 2,
    });
    return customers[customers.length - 1];
}

// Pour a mug into the lane the barkeep is standing in. Ignored while the tap
// is still refilling.
function serve() {
    if (state !== 'running' || serveTimer > 0) return false;
    mugs.push({ lane: player.lane, x: TAP_X });
    serveTimer = SERVE_COOLDOWN;
    player.pour = 0.18;
    return true;
}

function moveLane(delta) {
    if (state !== 'running') return;
    player.lane = Math.max(0, Math.min(LANE_COUNT - 1, player.lane + delta));
}

// ---------------------------------------------------------------------------
// Life cycle
// ---------------------------------------------------------------------------

function clearBar() {
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
}

function loseLife() {
    lives--;
    clearBar();
    serveTimer = 0;
    spawnTimer = RESPAWN_GRACE;
    updateHud();
    if (lives <= 0) gameOver();
}

function gameOver() {
    lives = 0;
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tavern-tapper-best', String(best));
        } catch (e) {
            /* storage disabled — the run still shows its own score */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to pull another shift');
}

function levelUp() {
    level++;
    score += LEVEL_BONUS;
    mugs.length = 0;               // last call: mugs still sliding are collected
    toSpawn = levelCustomers();
    spawnTimer = 1.4;
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    clock = 0;
    player = { lane: 0, pour: 0 };
    clearBar();
    shards.length = 0;
    toSpawn = levelCustomers();
    spawnTimer = 1.2;
    serveTimer = 0;
    spawnEnabled = true;
    autoStep = true;
    state = 'running';
    updateHud();
    hideOverlay();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to get back behind the bar');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    clock += dt;
    if (serveTimer > 0) serveTimer -= dt;
    if (player.pour > 0) player.pour -= dt;

    updateSpawning(dt);
    updateCustomers(dt);
    updateMugs(dt);
    updateEmpties(dt);
    updateShards(dt);

    // A level is over once the door has stopped letting patrons in and the bar
    // is quiet. Mugs still sliding are written off rather than smashed.
    if (state === 'running' && toSpawn === 0 && customers.length === 0 && empties.length === 0) {
        levelUp();
    }
}

function updateSpawning(dt) {
    if (!spawnEnabled || toSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnCustomer(Math.floor(Math.random() * LANE_COUNT));
    toSpawn--;
    spawnTimer = spawnInterval();
}

function updateCustomers(dt) {
    const speed = customerSpeed();
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.drink > 0) {
            c.drink -= dt;
            continue;
        }
        c.x += speed * dt;
        if (c.x >= GRAB_X) {
            loseLife();
            return;
        }
    }
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;

        const target = frontCustomer(m);
        if (target) {
            mugs.splice(i, 1);
            drink(target);
            continue;
        }

        if (m.x <= COUNTER_LEFT) {
            mugs.splice(i, 1);
            smash(m.x, m.lane);
            loseLife();
            return;
        }
    }
}

// The patron nearest the tap in this mug's lane, if the mug has caught them.
function frontCustomer(mug) {
    let front = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (Math.abs(c.x - mug.x) > HIT_DIST) continue;
        if (!front || c.x > front.x) front = c;
    }
    return front;
}

// A patron takes the mug, is shoved back down the bar and stands there
// drinking. Thirst alone decides when they go home: a patron shoved as far as
// the door simply stays there until the last mug lands. (Letting them leave
// early stranded mugs already on their way, which smashed through no fault of
// the player — bot playthroughs lost every life that way.)
function drink(c) {
    score += SCORE_HIT;
    c.thirst--;
    c.x = Math.max(LEAVE_X, c.x - PUSH_BACK);
    c.drink = DRINK_TIME;
    if (c.thirst <= 0) {
        customers.splice(customers.indexOf(c), 1);
        score += SCORE_SERVED;
        empties.push({ lane: c.lane, x: c.x });
    }
    updateHud();
}

function updateEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        if (e.x < TAP_X) continue;

        empties.splice(i, 1);
        if (player.lane === e.lane) {
            score += SCORE_CATCH;
            updateHud();
        } else {
            smash(TAP_X, e.lane);
            loseLife();
            return;
        }
    }
}

function smash(x, lane) {
    const y = laneY(lane) + 12;
    for (let i = 0; i < 12; i++) {
        shards.push({
            x,
            y,
            vx: (Math.random() - 0.5) * 160,
            vy: -Math.random() * 150,
            life: 0.6,
        });
    }
}

function updateShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 620 * dt;
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawCounter(lane);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), true);
    for (const e of empties) drawMug(e.x, laneY(e.lane), false);
    drawShards();
    drawBarkeep();
    drawLives();
}

// Spare mugs on the floorboards stand in for the lives still in hand.
function drawLives() {
    const y = laneY(LANE_COUNT - 1) + 62;
    ctx.fillStyle = '#8a6c43';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('SPARE MUGS', 24, y - 16);
    for (let i = 0; i < Math.max(0, lives); i++) drawMug(34 + i * 22, y + 6, true, 0.9);
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2a1a0b');
    wall.addColorStop(1, '#160e06');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // panelling
    ctx.strokeStyle = 'rgba(255, 205, 130, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // hanging lamps over the top bar
    for (let i = 0; i < 5; i++) {
        const lx = 80 + i * 110;
        ctx.strokeStyle = '#4a3117';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx, 26);
        ctx.stroke();
        const glow = ctx.createRadialGradient(lx, 34, 2, lx, 34, 26);
        glow.addColorStop(0, 'rgba(255, 209, 122, 0.55)');
        glow.addColorStop(1, 'rgba(255, 209, 122, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(lx - 26, 8, 52, 52);
        ctx.fillStyle = '#f0b429';
        ctx.beginPath();
        ctx.moveTo(lx - 9, 34);
        ctx.lineTo(lx + 9, 34);
        ctx.lineTo(lx, 22);
        ctx.closePath();
        ctx.fill();
    }

    // floorboards below the bottom bar
    ctx.fillStyle = '#20140a';
    ctx.fillRect(0, laneY(LANE_COUNT - 1) + 30, CANVAS_W, CANVAS_H);

    // the tap station running down the right-hand side
    ctx.fillStyle = '#3a2410';
    ctx.fillRect(COUNTER_RIGHT, 0, CANVAS_W - COUNTER_RIGHT, CANVAS_H);
    ctx.fillStyle = 'rgba(240, 180, 41, 0.18)';
    ctx.fillRect(COUNTER_RIGHT, 0, 2, CANVAS_H);
}

function drawCounter(lane) {
    const y = laneY(lane);
    const w = COUNTER_RIGHT - LEAVE_X;

    // counter top
    const top = ctx.createLinearGradient(0, y, 0, y + 16);
    top.addColorStop(0, '#a4703a');
    top.addColorStop(1, '#6b4520');
    ctx.fillStyle = top;
    ctx.fillRect(LEAVE_X, y, w, 16);

    // front edge in shadow
    ctx.fillStyle = '#40270f';
    ctx.fillRect(LEAVE_X, y + 16, w, 8);

    // grain
    ctx.strokeStyle = 'rgba(60, 35, 12, 0.35)';
    for (let i = 0; i < 3; i++) {
        const gy = y + 4 + i * 4.5;
        ctx.beginPath();
        ctx.moveTo(LEAVE_X, gy);
        ctx.lineTo(LEAVE_X + w, gy);
        ctx.stroke();
    }

    // the tap for this bar
    ctx.fillStyle = '#d8b46a';
    ctx.fillRect(COUNTER_RIGHT - 8, y - 18, 6, 18);
    ctx.fillRect(COUNTER_RIGHT - 14, y - 20, 14, 5);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const bob = c.drink > 0 ? 0 : Math.sin(clock * 6 + c.sway) * 1.5;
    const bx = c.x;
    const by = y - 6 + bob;

    // body
    ctx.fillStyle = c.drink > 0 ? '#7f9bd6' : '#5d76ad';
    ctx.beginPath();
    ctx.moveTo(bx - 10, by);
    ctx.lineTo(bx + 10, by);
    ctx.lineTo(bx + 7, by - 22);
    ctx.lineTo(bx - 7, by - 22);
    ctx.closePath();
    ctx.fill();

    // head
    ctx.fillStyle = '#e8c09a';
    ctx.beginPath();
    ctx.arc(bx, by - 29, 8, 0, Math.PI * 2);
    ctx.fill();

    // hat
    ctx.fillStyle = '#3d4f76';
    ctx.fillRect(bx - 10, by - 36, 20, 4);
    ctx.fillRect(bx - 6, by - 42, 12, 6);

    // a raised mug while drinking, an empty grabby hand otherwise
    if (c.drink > 0) {
        drawMug(bx + 13, by - 14, true, 0.8);
    } else {
        ctx.fillStyle = '#e8c09a';
        ctx.fillRect(bx + 8, by - 18, 8, 4);
    }

    // thirst pips: one dot per mug this patron is still waiting for
    ctx.fillStyle = '#f0b429';
    for (let i = 0; i < c.thirst; i++) {
        ctx.beginPath();
        ctx.arc(bx - (c.thirst - 1) * 3 + i * 6, by - 50, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawMug(x, y, full, scale = 1) {
    const w = 12 * scale;
    const h = 14 * scale;
    const top = y - h;

    ctx.fillStyle = '#e7e2d6';
    ctx.fillRect(x - w / 2, top, w, h);

    if (full) {
        ctx.fillStyle = '#d79a24';
        ctx.fillRect(x - w / 2 + 1, top + 4 * scale, w - 2, h - 5 * scale);
        ctx.fillStyle = '#fdf6e3';
        ctx.fillRect(x - w / 2 + 1, top + 1, w - 2, 4 * scale);
    }

    // handle
    ctx.strokeStyle = '#cfc7b6';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 1, top + h / 2, 3.5 * scale, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawShards() {
    for (const s of shards) {
        ctx.globalAlpha = Math.max(0, s.life / 0.6);
        ctx.fillStyle = '#e7e2d6';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function drawBarkeep() {
    const y = laneY(player.lane);
    const x = PLAYER_X;
    const lean = player.pour > 0 ? -3 : 0;

    // apron/body
    ctx.fillStyle = '#f0b429';
    ctx.beginPath();
    ctx.moveTo(x - 11 + lean, y - 2);
    ctx.lineTo(x + 11, y - 2);
    ctx.lineTo(x + 8, y - 26);
    ctx.lineTo(x - 8 + lean, y - 26);
    ctx.closePath();
    ctx.fill();

    // head
    ctx.fillStyle = '#f2d3ae';
    ctx.beginPath();
    ctx.arc(x + lean / 2, y - 33, 8, 0, Math.PI * 2);
    ctx.fill();

    // moustache
    ctx.fillStyle = '#6b4520';
    ctx.fillRect(x - 5 + lean / 2, y - 31, 10, 3);

    // pouring arm
    ctx.fillStyle = '#f2d3ae';
    ctx.fillRect(x - 18 + lean, y - 22, 10, 4);
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;      // clamp after tab switches / long frames
    if (autoStep) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault();
    }

    if (state === 'idle' || state === 'over') {
        if (key === ' ' || key === 'Spacebar' || key === 'Enter') startGame();
        return;
    }

    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }

    if (state !== 'running') return;

    switch (key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            moveLane(-1);
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            moveLane(1);
            break;
        case ' ':
        case 'Spacebar':
            serve();
            break;
        default:
            break;
    }
});

canvas.addEventListener('click', () => {
    if (state === 'running') serve();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem('tavern-tapper-best') || '0', 10) || 0;
} catch (e) {
    best = 0;
}
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
toSpawn = 0;
updateHud();
showOverlay('TAVERN TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
