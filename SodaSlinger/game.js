// Soda Slinger — four bar counters, one soda jerk, and a queue that never ends.
//
// The simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, level, served, customers, mugs,
// empties, player) is kept at the top level on purpose: the Playwright suite
// drives the game through exactly these names. See DESIGN.md for the rules and
// the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 720
const H = canvas.height;             // 540
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- geometry --------------------------------------------------------------

const LANES = 4;
const LANE_TOP = 60;
const LANE_H = 112;

const PLAYER_X = 44;                 // where the slinger stands
const TAP_X = 84;                    // mugs are poured and empties caught here
const LOSS_X = 100;                  // an advancing customer this far left wins
const BAR_RIGHT = 686;               // customers walk in here, mugs smash past it

// --- rules -----------------------------------------------------------------

const MUG_SPEED = 300;               // px/s, filled mug sliding away from the taps
const EMPTY_SPEED = 220;             // px/s, empty mug coming back
const DRINK_PUSH = 60;               // px/s, how fast a drink pushes someone back
const DRINK_TIME = 1.2;              // seconds spent drinking
const LEAVE_SPEED = 170;             // px/s, walking out
const CATCH_GAP = 16;                // mug/customer contact distance
const CUST_GAP = 34;                 // customers queue rather than overlap

const POUR_COOLDOWN = 0.18;          // seconds between pours, shared by all counters
const FIRST_SPAWN = 0.6;             // grace period at the start of a level
const MAX_PER_LANE = 3;              // advancing customers allowed on one counter
const LEVEL_COUNT = 5;

const SERVE_POINTS = 50;
const EMPTY_POINTS = 10;
const LEVEL_BONUS = 100;             // per level, paid on a clear
const START_LIVES = 3;

const BEST_KEY = 'sodaslinger-best';

const COLORS = {
    counter: '#4a2f1b',
    counterEdge: '#2a1a0f',
    soda: '#f59e0b',
    foam: '#fde68a',
    empty: '#94a3b8',
    thirsty: '#ef4444',
    drinking: '#34d399',
    leaving: '#64748b',
    player: '#38bdf8',
};

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;                      // customers served this level
let spawned = 0;                     // customers walked in this level
let quota = quotaFor(1);             // customers this level owes
let best = loadBest();
let customers = [];                  // { lane, x, state: advancing|drinking|leaving, drink }
let mugs = [];                       // filled mugs sliding right: { lane, x }
let empties = [];                    // empty mugs sliding left: { lane, x }
let spills = [];                     // short-lived smash markers, cosmetic only
let pourTimer = 0;                   // seconds left on the pour cooldown
let spawnTimer = FIRST_SPAWN;        // seconds until the next customer walks in
let autoRun = true;                  // the animation loop only simulates while true
let rng = mulberry32(1337);

const player = { lane: 0 };

// --- level shape -----------------------------------------------------------

function quotaFor(n) {
    return 5 + 3 * n;
}

function speedFor(n) {
    return 20 + 6 * n;
}

function customerSpeed() {
    return speedFor(level);
}

// Average gap between arrivals, jittered from the seeded PRNG so a level always
// plays out the same way.
function spawnGap() {
    return Math.max(1.1, 3.25 - 0.25 * level) + (rng() - 0.5) * 0.8;
}

function laneY(i) {
    return LANE_TOP + LANE_H * i + LANE_H / 2;
}

// Small seeded PRNG: a level depends only on its number, never on wall time.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadBest() {
    const raw = Number(window.localStorage.getItem(BEST_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* private browsing: keep the in-memory best and carry on */
    }
}

// --- lifecycle -------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    player.lane = 0;
    beginLevel();
}

function beginLevel() {
    quota = quotaFor(level);
    served = 0;
    spawned = 0;
    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    spills.length = 0;
    pourTimer = 0;
    spawnTimer = FIRST_SPAWN;
    rng = mulberry32(1337 + level * 101);
    state = 'running';
    updateHud();
    showOverlay();
}

function nextLevel() {
    level += 1;
    beginLevel();
}

// Space, a click and the Start button all come through here: what it means
// depends on what the game is doing.
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
        case 'running':
            pour();
            break;
        default:
            break;               // paused: only P gets you back behind the bar
    }
}

function togglePause() {
    if (state === 'running') state = 'paused';
    else if (state === 'paused') state = 'running';
    else return;
    showOverlay();
}

function moveLane(delta) {
    if (state !== 'running') return;
    player.lane = Math.min(LANES - 1, Math.max(0, player.lane + delta));
}

function pour() {
    if (state !== 'running') return;
    if (pourTimer > 0) return;
    mugs.push({ lane: player.lane, x: TAP_X });
    pourTimer = POUR_COOLDOWN;
}

function spawnCustomer(lane) {
    customers.push({ lane, x: BAR_RIGHT, state: 'advancing', drink: 0 });
    spawned += 1;
}

function laneCrowd(lane) {
    return customers.filter((c) => c.lane === lane && c.state === 'advancing').length;
}

// A mistake costs a life and wipes the counter it happened on, so one pile-up
// cannot cascade into three lives.
function loseLife(lane) {
    lives = Math.max(0, lives - 1);
    clearLane(lane);
    spills.push({ lane, x: TAP_X + 30, life: 0.6 });
    updateHud();
    if (lives === 0) {
        state = 'gameover';
        saveBest();
        updateHud();
        showOverlay();
    }
}

function clearLane(lane) {
    for (let i = customers.length - 1; i >= 0; i--) {
        if (customers[i].lane === lane) customers.splice(i, 1);
    }
    for (let i = mugs.length - 1; i >= 0; i--) {
        if (mugs[i].lane === lane) mugs.splice(i, 1);
    }
    for (let i = empties.length - 1; i >= 0; i--) {
        if (empties[i].lane === lane) empties.splice(i, 1);
    }
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    pourTimer = Math.max(0, pourTimer - dt);

    for (let i = spills.length - 1; i >= 0; i--) {
        spills[i].life -= dt;
        if (spills[i].life <= 0) spills.splice(i, 1);
    }

    runSpawner(dt);
    if (state !== 'running') return;
    moveCustomers(dt);
    if (state !== 'running') return;
    moveMugs(dt);
    if (state !== 'running') return;
    moveEmpties(dt);
    if (state !== 'running') return;
    checkLevelClear();
}

function runSpawner(dt) {
    if (spawned >= quota) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    const start = Math.floor(rng() * LANES) % LANES;
    for (let k = 0; k < LANES; k++) {
        const lane = (start + k) % LANES;
        if (laneCrowd(lane) < MAX_PER_LANE) {
            spawnCustomer(lane);
            spawnTimer = spawnGap();
            return;
        }
    }
    spawnTimer = 0.5;                // every counter is full: look again shortly
}

function moveCustomers(dt) {
    const speed = customerSpeed();

    for (let lane = 0; lane < LANES; lane++) {
        const row = customers.filter((c) => c.lane === lane).sort((a, b) => a.x - b.x);
        let ahead = null;

        for (const c of row) {
            if (c.state === 'advancing') {
                // Queue up behind whoever is already closer to the taps rather
                // than walking through them.
                const limit = ahead ? ahead.x + CUST_GAP : -Infinity;
                c.x = Math.max(c.x - speed * dt, Math.min(c.x, limit));
            } else if (c.state === 'drinking') {
                c.x += DRINK_PUSH * dt;
                c.drink -= dt;
                if (c.drink <= 0) {
                    c.state = 'leaving';
                    empties.push({ lane: c.lane, x: c.x });
                }
            } else {
                c.x += LEAVE_SPEED * dt;
            }
            ahead = c;
        }
    }

    // Anyone who got all the way to the taps grabs the slinger.
    for (const c of customers) {
        if (c.state === 'advancing' && c.x <= LOSS_X) {
            loseLife(c.lane);
            return;
        }
    }

    for (let i = customers.length - 1; i >= 0; i--) {
        if (customers[i].state === 'leaving' && customers[i].x > BAR_RIGHT + 40) {
            customers.splice(i, 1);
        }
    }
}

function moveMugs(dt) {
    for (const m of mugs) m.x += MUG_SPEED * dt;

    // Resolve at most one serve per mug, against the thirsty customer nearest
    // the taps on that counter.
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        const hit = customers
            .filter(
                (c) =>
                    c.lane === m.lane &&
                    c.state === 'advancing' &&
                    Math.abs(c.x - m.x) <= CATCH_GAP
            )
            .sort((a, b) => a.x - b.x)[0];
        if (!hit) continue;

        hit.state = 'drinking';
        hit.drink = DRINK_TIME;
        mugs.splice(i, 1);
        score += SERVE_POINTS;
        served += 1;
        updateHud();
    }

    // A mug nobody caught goes off the end of the bar.
    for (let i = 0; i < mugs.length; i++) {
        if (mugs[i].x > BAR_RIGHT) {
            const lane = mugs[i].lane;
            mugs.splice(i, 1);
            spills.push({ lane, x: BAR_RIGHT, life: 0.6 });
            loseLife(lane);
            return;
        }
    }
}

function moveEmpties(dt) {
    for (const e of empties) e.x -= EMPTY_SPEED * dt;

    for (let i = 0; i < empties.length; i++) {
        if (empties[i].x > TAP_X) continue;
        const e = empties[i];
        empties.splice(i, 1);
        if (player.lane === e.lane) {
            score += EMPTY_POINTS;
            updateHud();
        } else {
            loseLife(e.lane);
        }
        return;                      // one arrival per step keeps the loops simple
    }
}

// A level is done once every customer it owed has come and gone and the bar is
// clear — see DESIGN.md for why this keys off `spawned` and not `served`.
function checkLevelClear() {
    if (spawned < quota) return;
    if (customers.length || mugs.length || empties.length) return;

    score += LEVEL_BONUS * level;
    if (level >= LEVEL_COUNT) {
        state = 'won';
        saveBest();
    } else {
        state = 'levelclear';
    }
    updateHud();
    showOverlay();
}

// --- presentation ----------------------------------------------------------

const hud = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    served: document.getElementById('served'),
    best: document.getElementById('best'),
};

const overlay = {
    box: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    score: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
};

function updateHud() {
    hud.score.textContent = String(score);
    hud.level.textContent = String(level);
    hud.lives.textContent = String(lives);
    hud.served.textContent = `${served} / ${quota}`;
    hud.best.textContent = String(best);
}

function showOverlay() {
    let title = 'SODA SLINGER';
    let sub = 'Press Space or click Start to open the bar';
    let line = '';

    switch (state) {
        case 'running':
            overlay.box.classList.remove('visible');
            return;
        case 'paused':
            title = 'PAUSED';
            sub = 'Press P to get back behind the bar';
            line = `Score ${score}`;
            break;
        case 'levelclear':
            title = `LEVEL ${level} CLEARED`;
            sub = 'Press Space to open the next shift';
            line = `Score ${score}`;
            break;
        case 'gameover':
            title = 'GAME OVER';
            sub = 'Press Space to open up again';
            line = `Score ${score}`;
            break;
        case 'won':
            title = 'CLOSING TIME';
            sub = 'Every shift served. Press Space to go again';
            line = `Final score ${score}`;
            break;
        default:
            break;
    }

    overlay.title.textContent = title;
    overlay.score.textContent = line;
    overlay.sub.textContent = sub;
    overlay.box.classList.add('visible');
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// The counter is drawn as a surface the mugs slide along, with customers
// standing behind it and the slinger working in front of it.
const SURFACE_TOP = -8;              // relative to laneY
const SURFACE_BOT = 18;
const FRONT_BOT = 28;
const MUG_Y = 4;                     // mugs sit on the surface

function drawCounter(lane) {
    const y = laneY(lane);
    const left = TAP_X - 14;
    const width = BAR_RIGHT - left + 26;

    // front face, in shadow
    ctx.fillStyle = COLORS.counterEdge;
    ctx.fillRect(left, y + SURFACE_BOT, width, FRONT_BOT - SURFACE_BOT);

    // top surface
    ctx.fillStyle = COLORS.counter;
    roundRect(left, y + SURFACE_TOP, width, SURFACE_BOT - SURFACE_TOP, 6);
    ctx.fill();

    // grain, and a brighter lip along the near edge
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
        const gy = y + SURFACE_TOP + ((SURFACE_BOT - SURFACE_TOP) / 3) * i;
        ctx.beginPath();
        ctx.moveTo(left + 6, gy);
        ctx.lineTo(left + width - 6, gy);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(217, 164, 106, 0.45)';
    ctx.beginPath();
    ctx.moveTo(left, y + SURFACE_BOT);
    ctx.lineTo(left + width, y + SURFACE_BOT);
    ctx.stroke();

    // the stretch where a customer is about to reach the taps
    const grad = ctx.createLinearGradient(TAP_X, 0, LOSS_X + 90, 0);
    grad.addColorStop(0, 'rgba(239, 68, 68, 0.18)');
    grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(TAP_X, y + SURFACE_TOP, 90, SURFACE_BOT - SURFACE_TOP);

    // the doorway customers walk in through
    ctx.fillStyle = '#1b2742';
    roundRect(BAR_RIGHT + 6, y - 52, 24, 72, 6);
    ctx.fill();
    ctx.strokeStyle = '#2c3c60';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawTap(lane) {
    const y = laneY(lane);
    ctx.fillStyle = '#334155';
    roundRect(TAP_X - 30, y - 46, 15, 54, 5);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.fillRect(TAP_X - 26, y + 2, 7, 8);
    ctx.fillStyle = COLORS.soda;
    ctx.fillRect(TAP_X - 17, y - 14, 11, 5);
}

function drawPlayer() {
    const y = laneY(player.lane);

    ctx.fillStyle = COLORS.player;
    roundRect(PLAYER_X - 12, y - 6, 24, 30, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(PLAYER_X, y - 15, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';           // apron
    ctx.fillRect(PLAYER_X - 9, y + 8, 18, 14);
    ctx.fillStyle = '#0f172a';           // visor
    ctx.fillRect(PLAYER_X - 9, y - 20, 18, 4);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const feet = y + SURFACE_TOP;
    const color =
        c.state === 'advancing'
            ? COLORS.thirsty
            : c.state === 'drinking'
              ? COLORS.drinking
              : COLORS.leaving;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x, feet, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    roundRect(c.x - 11, feet - 28, 22, 28, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(c.x, feet - 36, 9, 0, Math.PI * 2);
    ctx.fill();

    if (c.state === 'drinking') {
        drawMug(c.x - 15, feet - 22, true, 0.8);
    } else if (c.state === 'advancing') {
        ctx.fillStyle = 'rgba(248, 250, 252, 0.75)';   // an impatient tapping hand
        ctx.fillRect(c.x - 16, feet - 18, 6, 5);
    }
}

function drawMug(x, y, filled, scale = 1) {
    const w = 14 * scale;
    const h = 18 * scale;
    ctx.fillStyle = filled ? COLORS.soda : 'rgba(148, 163, 184, 0.3)';
    roundRect(x - w / 2, y - h / 2, w, h, 3 * scale);
    ctx.fill();
    ctx.strokeStyle = filled ? COLORS.foam : COLORS.empty;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    if (filled) {
        ctx.fillStyle = COLORS.foam;
        ctx.fillRect(x - w / 2, y - h / 2 - 2 * scale, w, 4 * scale);
    }
    ctx.beginPath();
    ctx.arc(x + w / 2 + 3 * scale, y, 5 * scale, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawSpill(s) {
    const y = laneY(s.lane) + MUG_Y;
    const t = 1 - s.life / 0.6;
    ctx.strokeStyle = `rgba(248, 113, 113, ${1 - t})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(s.x, y, 6 + t * 22, 0, Math.PI * 2);
    ctx.stroke();
}

function draw() {
    // room
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#111a2e');
    bg.addColorStop(1, '#070b16');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // the wall the slinger works against
    ctx.fillStyle = '#16203a';
    ctx.fillRect(0, 0, TAP_X - 40, H);
    ctx.strokeStyle = '#243355';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TAP_X - 40, 0);
    ctx.lineTo(TAP_X - 40, H);
    ctx.stroke();

    for (let lane = 0; lane < LANES; lane++) {
        drawCounter(lane);
        drawTap(lane);
    }

    for (const s of spills) drawSpill(s);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane) + MUG_Y, true);
    for (const e of empties) drawMug(e.x, laneY(e.lane) + MUG_Y, false);
    drawPlayer();

    // remaining lives, drawn as spare mugs along the bottom strip
    for (let i = 0; i < lives; i++) drawMug(26 + i * 28, H - 22, true, 0.9);

    ctx.fillStyle = '#7d8aa5';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`LEVEL ${level}  ·  ${served}/${quota} SERVED`, W - 16, H - 16);
    ctx.textAlign = 'left';
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            moveLane(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            moveLane(1);
            break;
        case 'KeyP':
            togglePause();
            break;
        default:
            break;
    }
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
