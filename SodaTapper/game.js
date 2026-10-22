// ---------------------------------------------------------------------------
// Soda Tapper — four counters, one server, and a great deal of fizzy drink.
//
// Customers walk in from the far end of each counter and head for your
// station. The only move you have is to slide a full mug down the counter to
// meet them; they drink, shove the empty back, and you had better be standing
// on that counter to catch it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Gold
// Runner and the rest of the repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
//
// Every entity is a lane index plus an `x` centre in canvas pixels, so each
// rule in the game is a comparison of two numbers; there is no general
// collision geometry anywhere.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;
const LANES = 4;
const LANE_TOP = 96;              // back wall above the first counter
const LANE_H = (CANVAS_H - LANE_TOP) / LANES;   // 96
const BAR_LEFT = 40;              // far end: where customers come in
const BAR_RIGHT = 680;            // near end: the server's side
const CATCH_X = 640;              // an empty mug is caught (or lost) here
const TAP_X = 648;                // a poured mug appears here
const PLAYER_X = 660;             // the server never leaves the station
const CUSTOMER_W = 34;
const MUG_W = 18;

// --- Rules ---------------------------------------------------------------
const MUG_SPEED = 300;            // full mug, sliding away from the tap
const EMPTY_SPEED = 260;          // empty mug, sliding back
const LEAVE_SPEED = 120;          // a satisfied customer heading for the door
const DRINK_TIME = 0.8;
const PUSH_BACK = 72;
const DRINKS_NEEDED = 2;
const POUR_COOLDOWN = 0.2;
const MAX_ONSCREEN = 8;             // hard ceiling; maxOnscreen() ramps up to it
const RESPAWN_PAUSE = 1.2;
const LEVEL_PAUSE = 1.8;

const SCORE_SERVE_MUG = 25;
const SCORE_CATCH = 10;
const SCORE_CUSTOMER = 100;
const LEVEL_BONUS = 200;

// --- State ---------------------------------------------------------------
let state = 'idle';               // idle | playing | paused | respawn | levelclear | over
let player = { lane: 0, x: PLAYER_X };
let customers = [];
let mugs = [];
let score = 0;
let lives = 3;
let level = 1;
let best = 0;
let served = 0;                   // customers sent home this level
let spawned = 0;                  // customers let in this level
let waveSize = 6;
let spawnTimer = 0;
let pourTimer = 0;
let holdTimer = 0;                // counts down the respawn / level-clear pause
let lastLoss = null;              // 'spill' | 'shatter' | 'grabbed'
let autoStep = true;              // tests switch this off to control time
let rngSeed = 1;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScore = document.getElementById('score');
const elServed = document.getElementById('served');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// Level tuning
// ---------------------------------------------------------------------------

// A small LCG rather than Math.random: a run is fully determined by `rngSeed`,
// so a spec (or a bug report) can pin the seed and replay the exact same
// sequence of customers frame for frame. startGame() seeds it from the clock
// so two shifts are never quite alike.
function rand() {
    rngSeed = (rngSeed * 1664525 + 1013904223) % 4294967296;
    return rngSeed / 4294967296;
}

function waveSizeFor(lvl) {
    return 4 + lvl * 2;
}

function spawnInterval() {
    return Math.max(0.7, 2.4 - level * 0.16);
}

function customerSpeed() {
    return 28 + level * 7;
}

// How crowded the bar is allowed to get. Early levels stay sparse enough to
// learn the catch rhythm; by level 7 every counter can be busy at once.
function maxOnscreen() {
    return Math.min(MAX_ONSCREEN, 3 + Math.floor(level * 0.6));
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function makeMug(lane, x, dir) {
    return { lane, x, dir };
}

function spawnCustomer(lane) {
    const c = {
        lane,
        x: BAR_LEFT,
        state: 'advancing',       // advancing | drinking | leaving
        drinks: 0,
        drinkTimer: 0,
    };
    customers.push(c);
    spawned++;
    return c;
}

function laneTop(lane) {
    return LANE_TOP + lane * LANE_H;
}

function laneCentre(lane) {
    return laneTop(lane) + LANE_H / 2;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'playing') return;
    player.lane = Math.max(0, Math.min(LANES - 1, player.lane + delta));
}

function pour() {
    if (state !== 'playing' || pourTimer > 0) return null;
    pourTimer = POUR_COOLDOWN;
    const mug = makeMug(player.lane, TAP_X, -1);
    mugs.push(mug);
    return mug;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'respawn' || state === 'levelclear') {
        holdTimer -= dt;
        if (holdTimer <= 0) {
            if (state === 'respawn') resumePlay();
            else startLevel(level + 1);
        }
        return;
    }
    if (state !== 'playing') return;

    if (pourTimer > 0) pourTimer -= dt;

    stepMugs(dt);
    if (state !== 'playing') return;   // a mug may have cost us the life
    stepCustomers(dt);
    if (state !== 'playing') return;
    stepSpawning(dt);
    checkLevelClear();
    updateHud();
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x += mug.dir * (mug.dir < 0 ? MUG_SPEED : EMPTY_SPEED) * dt;

        if (mug.dir < 0) {
            const target = customerForMug(mug);
            if (target) {
                mugs.splice(i, 1);
                serve(target);
                continue;
            }
            if (mug.x <= BAR_LEFT) {
                mugs.splice(i, 1);
                loseLife('spill');
                return;
            }
        } else if (mug.x >= CATCH_X) {
            mugs.splice(i, 1);
            if (player.lane === mug.lane) {
                score += SCORE_CATCH;
            } else {
                loseLife('shatter');
                return;
            }
        }
    }
}

// The right-most customer on the mug's lane that the mug has caught up with.
// Drinking and leaving customers have their hands full and are skipped.
function customerForMug(mug) {
    let best = null;
    for (const c of customers) {
        if (c.lane !== mug.lane || c.state !== 'advancing') continue;
        if (mug.x - c.x > (CUSTOMER_W + MUG_W) / 2) continue;   // not reached yet
        if (c.x - mug.x > (CUSTOMER_W + MUG_W) / 2) continue;   // already behind it
        if (!best || c.x > best.x) best = c;
    }
    return best;
}

function serve(customer) {
    customer.drinks++;
    customer.state = 'drinking';
    customer.drinkTimer = DRINK_TIME;
    customer.x = Math.max(BAR_LEFT, customer.x - PUSH_BACK);
    score += SCORE_SERVE_MUG;
}

function stepCustomers(dt) {
    const speed = customerSpeed();
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.state === 'drinking') {
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) {
                mugs.push(makeMug(c.lane, c.x, 1));
                c.state = c.drinks >= DRINKS_NEEDED ? 'leaving' : 'advancing';
            }
            continue;
        }

        if (c.state === 'leaving') {
            c.x -= LEAVE_SPEED * dt;
            if (c.x <= BAR_LEFT - CUSTOMER_W) {
                customers.splice(i, 1);
                served++;
                score += SCORE_CUSTOMER;
            }
            continue;
        }

        c.x += speed * dt;
        if (c.x >= BAR_RIGHT - CUSTOMER_W / 2) {
            loseLife('grabbed');
            return;
        }
    }
}

function stepSpawning(dt) {
    if (spawned >= waveSize) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    if (customers.length >= maxOnscreen()) return;
    spawnCustomer(Math.floor(rand() * LANES));
}

function checkLevelClear() {
    if (served < waveSize) return;
    score += LEVEL_BONUS * level;
    state = 'levelclear';
    holdTimer = LEVEL_PAUSE;
    updateHud();
    showOverlay(`LEVEL ${level} CLEARED`, `Score ${score}`, 'Next shift starting…');
}

// ---------------------------------------------------------------------------
// Lives and level flow
// ---------------------------------------------------------------------------

const LOSS_TEXT = {
    spill: ['SODA SPILLED', 'A mug ran off the end of the counter.'],
    shatter: ['MUG SHATTERED', 'An empty came back and nobody caught it.'],
    grabbed: ['GRABBED!', 'A customer made it all the way to the station.'],
};

function loseLife(reason) {
    lastLoss = reason;
    lives--;
    // Customers still on the bar never got served, so they go back into the
    // wave's queue: the level still has to be worked through in full.
    spawned -= customers.length;
    customers = [];
    mugs = [];
    pourTimer = 0;
    updateHud();

    const [title, sub] = LOSS_TEXT[reason];
    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'respawn';
    holdTimer = RESPAWN_PAUSE;
    showOverlay(title, `${lives} ${lives === 1 ? 'life' : 'lives'} left`, sub);
}

function resumePlay() {
    state = 'playing';
    spawnTimer = 0.6;
    hideOverlay();
}

function startLevel(lvl) {
    level = lvl;
    waveSize = waveSizeFor(lvl);
    served = 0;
    spawned = 0;
    customers = [];
    mugs = [];
    pourTimer = 0;
    spawnTimer = 0.8;
    player.lane = 0;
    player.x = PLAYER_X;
    state = 'playing';
    updateHud();
    hideOverlay();
}

function startGame() {
    score = 0;
    lives = 3;
    lastLoss = null;
    rngSeed = (Date.now() >>> 0) || 1;
    startLevel(1);
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('sodatapper-best', String(best));
        } catch (err) {
            /* private browsing — the best score just will not persist */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to serve another shift');
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

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elServed.textContent = `${served}/${waveSize}`;
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing — a pure function of the state above
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawBackWall();
    for (let lane = 0; lane < LANES; lane++) drawCounter(lane);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    drawServer();
}

function drawBackWall() {
    const grad = ctx.createLinearGradient(0, 0, 0, LANE_TOP);
    grad.addColorStop(0, '#241a33');
    grad.addColorStop(1, '#160f21');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, LANE_TOP);

    // Soda dispensers along the back wall, one per counter.
    ctx.fillStyle = '#3a2b52';
    for (let i = 0; i < 6; i++) {
        ctx.fillRect(60 + i * 100, 24, 46, 48);
        ctx.fillStyle = '#ff9f1c';
        ctx.fillRect(68 + i * 100, 32, 30, 8);
        ctx.fillStyle = '#3a2b52';
    }

    ctx.fillStyle = '#8d82a3';
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`LEVEL ${level}`, 16, 22);
    ctx.textAlign = 'right';
    ctx.fillText(`SERVED ${served}/${waveSize}`, CANVAS_W - 16, 22);
}

function drawCounter(lane) {
    const top = laneTop(lane);
    const y = laneCentre(lane);

    ctx.fillStyle = lane % 2 ? '#120e1b' : '#150f20';
    ctx.fillRect(0, top, CANVAS_W, LANE_H);

    // The counter top itself.
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(BAR_LEFT, y + 14, BAR_RIGHT - BAR_LEFT, 12);
    ctx.fillStyle = '#9a6c3e';
    ctx.fillRect(BAR_LEFT, y + 14, BAR_RIGHT - BAR_LEFT, 4);

    // Far end (the door) and the station end.
    ctx.fillStyle = '#2d2340';
    ctx.fillRect(0, top + 6, BAR_LEFT, LANE_H - 12);
    ctx.fillRect(BAR_RIGHT, top + 6, CANVAS_W - BAR_RIGHT, LANE_H - 12);

    // Catch line, so the player can see where an empty has to be met.
    ctx.strokeStyle = 'rgba(255, 159, 28, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CATCH_X, top + 8);
    ctx.lineTo(CATCH_X, top + LANE_H - 8);
    ctx.stroke();
}

function drawCustomer(c) {
    const y = laneCentre(c.lane);
    const facing = c.state === 'leaving' ? -1 : 1;

    ctx.fillStyle = c.state === 'drinking' ? '#7be0a4' : '#ff6b6b';
    ctx.fillRect(c.x - CUSTOMER_W / 2, y - 26, CUSTOMER_W, 40);

    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath();
    ctx.arc(c.x, y - 34, 11, 0, Math.PI * 2);
    ctx.fill();

    // Which way they are looking, and how thirsty they still are.
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(c.x + facing * 4 - 2, y - 36, 4, 4);
    for (let i = 0; i < DRINKS_NEEDED - c.drinks; i++) {
        ctx.fillStyle = '#ffd447';
        ctx.fillRect(c.x - 8 + i * 9, y - 50, 6, 6);
    }
}

function drawMug(mug) {
    const base = laneCentre(mug.lane) + 14;   // mugs sit on the counter top
    ctx.fillStyle = '#d9d2e6';
    ctx.fillRect(mug.x - MUG_W / 2, base - 20, MUG_W, 20);
    if (mug.dir < 0) {
        ctx.fillStyle = '#ff9f1c';
        ctx.fillRect(mug.x - MUG_W / 2 + 2, base - 18, MUG_W - 4, 14);
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(mug.x - MUG_W / 2 + 2, base - 20, MUG_W - 4, 3);
    }
    ctx.strokeStyle = '#d9d2e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mug.x + MUG_W / 2 + 2, base - 11, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawServer() {
    const y = laneCentre(player.lane);
    ctx.fillStyle = '#4cc9f0';
    ctx.fillRect(player.x - 14, y - 26, 28, 42);
    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath();
    ctx.arc(player.x, y - 34, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff9f1c';
    ctx.fillRect(player.x - 14, y - 44, 28, 6);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        else pour();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    if (k === 'ArrowUp' || k === 'w') {
        e.preventDefault();
        if (!e.repeat) moveLane(-1);
        return;
    }
    if (k === 'ArrowDown' || k === 's') {
        e.preventDefault();
        if (!e.repeat) moveLane(1);
    }
});

canvas.addEventListener('click', () => {
    if (state === 'idle' || state === 'over') startGame();
    else pour();
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

best = parseInt(localStorage.getItem('sodatapper-best') || '0', 10) || 0;
waveSize = waveSizeFor(1);
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
