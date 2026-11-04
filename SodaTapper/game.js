// ---------------------------------------------------------------------------
// Soda Tapper — four counters, one soda jerk, and a bar full of thirsty
// patrons, on an HTML5 canvas.
//
// Patrons walk in from the door (right) towards your taps (left). Pour a soda
// and it slides down the counter; whoever catches it is shoved back towards the
// door and throws the empty mug straight back at you. Catch the empty, shove
// every patron out of the door, and the shift is clear.
//
// Three mistakes cost a life: a patron reaching the taps, a soda running the
// whole counter and smashing at the door, and an empty mug arriving at a
// counter you are not standing at.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime, Snake and the rest of the repo. Every speed is per second and the
// whole simulation is advanced through `step(dt)`, so tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing. `draw()` is pure rendering and never mutates game state.
//
// All gameplay is one-dimensional per counter: the only vertical movement in
// the game is the jerk hopping counters, which keeps every rule decidable from
// a single x coordinate.
// ---------------------------------------------------------------------------

// --- Board geometry ------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 460;
const LANES = 4;

const BAR_LEFT = 110;              // the taps — where the jerk stands
const BAR_RIGHT = 720;             // the door — where patrons arrive
const LANE_Y = [92, 190, 288, 386];// centre line of each counter
const BAR_THICK = 16;              // drawn thickness of a counter top

const SPAWN_X = BAR_RIGHT - 24;    // patrons step in just inside the door
const CAUGHT_X = BAR_LEFT + 30;    // any closer to the taps and they grab you

// --- Entity sizes --------------------------------------------------------
const PATRON_W = 26;
const PATRON_H = 42;
const MUG_W = 16;
const MUG_H = 20;
const TIP_R = 8;

// --- Speeds (px/s) and distances ----------------------------------------
const MUG_SPEED = 300;             // full mug, towards the door
const EMPTY_SPEED = 230;           // empty mug, back towards the taps
const TIP_SPEED = 180;             // a coin sliding back down the counter
const PUSH_SPEED = 260;            // a shoved patron sliding doorwards
const PUSH_DIST = 150;             // shove delivered by one soda
const POUR_COOLDOWN = 0.22;        // seconds between sodas

// --- Scoring -------------------------------------------------------------
const SERVE_POINTS = 50;
const CATCH_POINTS = 100;
const LEAVE_POINTS = 250;
const TIP_POINTS = 500;
const LEVEL_BONUS = 1000;
const TIP_CHANCE = 0.35;
const START_LIVES = 3;

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const elScore = document.getElementById('score');
const elServed = document.getElementById('served');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Mutable state ------------------------------------------------------
// `let` (not `const`) throughout so the Playwright suite can drive the game by
// assigning straight into these bindings.
let state = 'idle';                // 'idle' | 'playing' | 'paused' | 'over'
let score = 0;
let served = 0;
let level = 1;
let lives = START_LIVES;
let best = 0;

let jerk = { lane: 0 };
let patrons = [];                  // { lane, x, push, drinks }
let mugs = [];                     // { lane, x, kind: 'full' | 'empty' }
let tips = [];                     // { lane, x }

let spawned = 0;                   // arrivals released this shift
let spawnTimer = 0;                // seconds until the next arrival
let pourCooldown = 0;
let autoStep = true;               // tests switch this off to own the clock
let hudDirty = false;
let flash = [];                    // { lane, t } — red wash after a mistake
let banner = null;                 // { text, t } — brief mid-board announcement

// --- Seeded RNG ----------------------------------------------------------
// A tiny LCG, so a test can pin the sequence of spawn lanes and tip drops.
let rngState = 0x9e3779b9;

function seedRng(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Shift difficulty
// ---------------------------------------------------------------------------

function levelConfig(n) {
    return {
        walkSpeed: 24 + 5 * (n - 1),
        spawnInterval: Math.max(1.6, 4.2 - 0.35 * (n - 1)),
        patrons: 5 + 2 * n,
        maxOnScreen: Math.min(2 + n, 6),
    };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    served = 0;
    level = 1;
    lives = START_LIVES;
    jerk.lane = 0;
    state = 'playing';
    autoStep = true;
    flash.length = 0;
    banner = null;
    startLevel();
    hideOverlay();
    updateHud();
}

function startLevel() {
    patrons.length = 0;
    mugs.length = 0;
    tips.length = 0;
    spawned = 0;
    pourCooldown = 0;
    // The first arrival of a shift comes in early, so a shift never opens with
    // several idle seconds.
    spawnTimer = levelConfig(level).spawnInterval * 0.4;
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
            localStorage.setItem('sodatapper-best', String(best));
        } catch (err) {
            /* private browsing — the run just isn't recorded */
        }
    }
    updateHud();
    showOverlay('BAR CLOSED', `Score ${score} — Shift ${level}`, 'Press Space or click Start for another shift');
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(dir) {
    if (state !== 'playing') return;
    jerk.lane = Math.max(0, Math.min(LANES - 1, jerk.lane + dir));
}

function pour() {
    if (state !== 'playing') return;
    if (pourCooldown > 0) return;
    mugs.push({ lane: jerk.lane, x: BAR_LEFT + 8, kind: 'full' });
    pourCooldown = POUR_COOLDOWN;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;

    pourCooldown = Math.max(0, pourCooldown - dt);

    // Mistakes are queued rather than applied mid-sweep: clearing a counter
    // splices three arrays, which no in-progress loop should have to survive.
    const losses = [];

    stepMugs(dt, losses);
    stepPatrons(dt, losses);
    stepTips(dt);
    stepFlash(dt);

    prune(mugs);
    prune(patrons);
    prune(tips);

    applyLosses(losses);
    stepSpawning(dt);
    checkShiftComplete();

    if (hudDirty) updateHud();
}

function stepMugs(dt, losses) {
    // Snapshot the length: serving appends the empty mug, which should not be
    // simulated until the next frame.
    const n = mugs.length;
    for (let i = 0; i < n; i++) {
        const m = mugs[i];
        if (m.dead) continue;

        if (m.kind === 'full') {
            m.x += MUG_SPEED * dt;
            const catcher = patronAt(m);
            if (catcher) {
                serve(catcher, m);
                continue;
            }
            if (m.x > BAR_RIGHT) {
                m.dead = true;
                losses.push({ lane: m.lane, reason: 'spill' });
            }
        } else {
            m.x -= EMPTY_SPEED * dt;
            if (m.x <= BAR_LEFT) {
                m.dead = true;
                if (jerk.lane === m.lane) addScore(CATCH_POINTS);
                else losses.push({ lane: m.lane, reason: 'smash' });
            }
        }
    }
}

// The patron a full mug has just run into: same counter, overlapping, and the
// one nearest the taps if several are bunched up (that is the one the mug
// physically reaches first).
function patronAt(mug) {
    const reach = (MUG_W + PATRON_W) / 2;
    let found = null;
    for (const p of patrons) {
        if (p.dead || p.lane !== mug.lane) continue;
        if (Math.abs(p.x - mug.x) >= reach) continue;
        if (!found || p.x < found.x) found = p;
    }
    return found;
}

function serve(patron, mug) {
    mug.dead = true;
    patron.drinks += 1;
    patron.push += PUSH_DIST;              // shoves stack
    addScore(SERVE_POINTS);
    mugs.push({ lane: patron.lane, x: patron.x, kind: 'empty' });
}

function stepPatrons(dt, losses) {
    const cfg = levelConfig(level);
    for (const p of patrons) {
        if (p.dead) continue;

        if (p.push > 0) {
            const d = Math.min(PUSH_SPEED * dt, p.push);
            p.x += d;
            p.push -= d;
        } else {
            p.x -= cfg.walkSpeed * dt;
        }

        if (p.x >= BAR_RIGHT) {
            p.dead = true;
            served += 1;
            addScore(LEAVE_POINTS);
            if (rand() < TIP_CHANCE) tips.push({ lane: p.lane, x: BAR_RIGHT - 8 });
        } else if (p.x <= CAUGHT_X) {
            losses.push({ lane: p.lane, reason: 'patron' });
        }
    }
}

function stepTips(dt) {
    for (const t of tips) {
        if (t.dead) continue;
        t.x -= TIP_SPEED * dt;
        if (t.x <= BAR_LEFT) {
            t.dead = true;
            if (jerk.lane === t.lane) addScore(TIP_POINTS);
        }
    }
}

function stepFlash(dt) {
    for (let i = flash.length - 1; i >= 0; i--) {
        flash[i].t -= dt;
        if (flash[i].t <= 0) flash.splice(i, 1);
    }
    if (banner) {
        banner.t -= dt;
        if (banner.t <= 0) banner = null;
    }
}

function applyLosses(losses) {
    const hit = new Set();
    for (const l of losses) {
        if (state !== 'playing') return;      // already closed up
        if (hit.has(l.lane)) continue;        // one counter, one mistake a frame
        hit.add(l.lane);
        loseLife(l.lane);
    }
}

function loseLife(lane) {
    clearLane(lane);
    lives = Math.max(0, lives - 1);
    flash.push({ lane, t: 0.7 });
    markHud();
    if (lives <= 0) gameOver();
}

function clearLane(lane) {
    [patrons, mugs, tips].forEach((arr) => {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (arr[i].lane === lane) arr.splice(i, 1);
        }
    });
}

function stepSpawning(dt) {
    const cfg = levelConfig(level);
    if (spawned >= cfg.patrons) return;

    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    if (patrons.length >= cfg.maxOnScreen) {
        spawnTimer = 0.4;                     // bar is full — try again shortly
        return;
    }

    const lane = pickLane();
    if (lane < 0) {
        spawnTimer = 0.4;                     // every doorway is blocked
        return;
    }

    spawnPatron(lane);
    spawnTimer = cfg.spawnInterval;
}

// A counter is available if nobody is still standing in its doorway, so
// arrivals never materialise on top of each other.
function pickLane() {
    const free = [];
    for (let l = 0; l < LANES; l++) {
        if (!patrons.some((p) => p.lane === l && p.x > BAR_RIGHT - 90)) free.push(l);
    }
    if (!free.length) return -1;
    return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

function spawnPatron(lane) {
    patrons.push({ lane, x: SPAWN_X, push: 0, drinks: 0 });
    spawned += 1;
}

function checkShiftComplete() {
    if (state !== 'playing') return;
    if (spawned < levelConfig(level).patrons) return;
    if (patrons.length > 0) return;

    addScore(LEVEL_BONUS * level);
    level += 1;
    markHud();
    banner = { text: `SHIFT ${level}`, t: 1.6 };
    startLevel();
}

function addScore(points) {
    score += points;
    markHud();
}

function markHud() {
    hudDirty = true;
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    elScore.textContent = String(score);
    elServed.textContent = String(served);
    elLevel.textContent = String(level);
    elLives.textContent = String(lives);
    elBest.textContent = String(Math.max(best, score));
    hudDirty = false;
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

// ---------------------------------------------------------------------------
// Rendering — read-only over game state
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let l = 0; l < LANES; l++) drawCounter(l);
    tips.forEach(drawTip);
    mugs.forEach(drawMug);
    patrons.forEach(drawPatron);
    drawJerk();
    drawPourMeter();
    drawFlashes();
    if (state === 'playing') drawCoverHint();
    drawBanner();
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#1b1026');
    g.addColorStop(1, '#0a0613');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Tap station down the left-hand side.
    ctx.fillStyle = '#241737';
    ctx.fillRect(0, 0, BAR_LEFT - 24, CANVAS_H);
    ctx.fillStyle = '#2f1f45';
    ctx.fillRect(BAR_LEFT - 24, 0, 10, CANVAS_H);

    // Doorway down the right-hand side.
    ctx.fillStyle = '#170f23';
    ctx.fillRect(BAR_RIGHT + 6, 0, CANVAS_W - BAR_RIGHT - 6, CANVAS_H);
    ctx.fillStyle = 'rgba(255, 159, 28, 0.08)';
    ctx.fillRect(BAR_RIGHT + 6, 0, 4, CANVAS_H);

    // Floorboards below the lowest counter.
    const floorY = LANE_Y[LANES - 1] + 44;
    ctx.fillStyle = '#150d20';
    ctx.fillRect(0, floorY, CANVAS_W, CANVAS_H - floorY);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    for (let x = 0; x < CANVAS_W; x += 48) ctx.fillRect(x, floorY, 2, CANVAS_H - floorY);
    ctx.fillStyle = 'rgba(255, 159, 28, 0.10)';
    ctx.fillRect(0, floorY, CANVAS_W, 2);

    ctx.fillStyle = 'rgba(255, 159, 28, 0.55)';
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(CANVAS_W - 18, CANVAS_H / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText('D O O R', 0, 0);
    ctx.restore();
    ctx.textAlign = 'left';
}

function drawCounter(lane) {
    const y = LANE_Y[lane];
    const covered = jerk.lane === lane;

    // Counter top.
    ctx.fillStyle = covered ? '#6b4a24' : '#50371b';
    ctx.fillRect(BAR_LEFT - 14, y + 10, BAR_RIGHT - BAR_LEFT + 28, BAR_THICK);
    ctx.fillStyle = covered ? '#8d6330' : '#6a4a24';
    ctx.fillRect(BAR_LEFT - 14, y + 10, BAR_RIGHT - BAR_LEFT + 28, 4);

    // Plank seams, spaced deterministically so draw() stays pure.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    for (let x = BAR_LEFT + 10; x < BAR_RIGHT; x += 61) {
        ctx.fillRect(x, y + 10, 2, BAR_THICK);
    }

    // The tap head for this counter.
    const tapGlow = covered ? '#ffd27a' : '#8a6c3f';
    ctx.fillStyle = '#39284f';
    ctx.fillRect(BAR_LEFT - 34, y - 20, 16, 30);
    ctx.fillStyle = tapGlow;
    ctx.fillRect(BAR_LEFT - 24, y - 6, 14, 5);
    ctx.beginPath();
    ctx.arc(BAR_LEFT - 26, y - 16, 5, 0, Math.PI * 2);
    ctx.fill();

    // The grab line: a patron past this point ends a life.
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.35)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(CAUGHT_X, y - 26);
    ctx.lineTo(CAUGHT_X, y + 12);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawPatron(p) {
    const y = LANE_Y[p.lane];
    const foot = y + 12;
    const shoved = p.push > 0;
    // Lean backwards while being shoved out, forwards while walking in.
    const lean = shoved ? -2 : 2;
    const bodyTop = foot - PATRON_H;

    // Legs, planted in a stride so the crowd does not read as a row of blocks.
    ctx.fillStyle = '#2b1b3f';
    ctx.fillRect(p.x - 9, foot - 9, 6, 9);
    ctx.fillRect(p.x + 3, foot - 9, 6, 9);

    // Body.
    ctx.fillStyle = shoved ? '#6fd3ff' : '#ff6f91';
    ctx.fillRect(p.x - PATRON_W / 2, bodyTop, PATRON_W, PATRON_H - 8);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(p.x - PATRON_W / 2, bodyTop, 5, PATRON_H - 8);

    // Arm, reaching towards the taps for the next soda.
    ctx.fillStyle = '#ffe0c2';
    const armX = shoved ? p.x + PATRON_W / 2 : p.x - PATRON_W / 2 - 12;
    ctx.fillRect(armX, bodyTop + 9, 12, 5);

    // Head and hat.
    ctx.fillStyle = '#ffe0c2';
    ctx.beginPath();
    ctx.arc(p.x + lean, bodyTop - 8, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1b3f';
    ctx.fillRect(p.x + lean - 11, bodyTop - 14, 22, 4);
    ctx.fillRect(p.x + lean - 7, bodyTop - 20, 14, 7);

    // A mug in hand once they have been served at least once.
    if (p.drinks > 0 && !shoved) {
        ctx.fillStyle = '#c9721f';
        ctx.fillRect(armX - 6, bodyTop + 4, 8, 11);
        ctx.fillStyle = '#fff4dd';
        ctx.fillRect(armX - 6, bodyTop + 4, 8, 3);
    }

    // One pip per soda already drunk.
    ctx.fillStyle = '#ffd27a';
    for (let i = 0; i < Math.min(p.drinks, 5); i++) {
        ctx.fillRect(p.x - PATRON_W / 2 + 3 + i * 5, bodyTop + 4, 3, 3);
    }
}

function drawMug(m) {
    const y = LANE_Y[m.lane];
    const top = y + 10 - MUG_H;

    ctx.fillStyle = m.kind === 'full' ? '#3a2a14' : '#2a2436';
    ctx.fillRect(m.x - MUG_W / 2, top, MUG_W, MUG_H);

    if (m.kind === 'full') {
        ctx.fillStyle = '#c9721f';
        ctx.fillRect(m.x - MUG_W / 2 + 2, top + 6, MUG_W - 4, MUG_H - 8);
        ctx.fillStyle = '#fff4dd';                       // foam
        ctx.fillRect(m.x - MUG_W / 2 + 2, top + 2, MUG_W - 4, 5);
    } else {
        ctx.strokeStyle = '#8f7fb0';
        ctx.lineWidth = 2;
        ctx.strokeRect(m.x - MUG_W / 2 + 1, top + 1, MUG_W - 2, MUG_H - 2);
        ctx.lineWidth = 1;
    }

    // Handle.
    ctx.fillStyle = m.kind === 'full' ? '#8a5a22' : '#6d5f8a';
    ctx.fillRect(m.x + MUG_W / 2, top + 5, 4, 8);
}

function drawTip(t) {
    const y = LANE_Y[t.lane];
    ctx.fillStyle = '#ffd447';
    ctx.beginPath();
    ctx.arc(t.x, y + 10 - TIP_R - 2, TIP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    ctx.arc(t.x, y + 10 - TIP_R - 2, TIP_R - 3, 0, Math.PI * 2);
    ctx.fill();
}

function drawJerk() {
    const y = LANE_Y[jerk.lane];
    const x = BAR_LEFT - 56;
    const foot = y + 12;

    ctx.fillStyle = '#f4ecff';                            // apron
    ctx.fillRect(x - 11, foot - 34, 22, 34);
    ctx.fillStyle = '#ff9f1c';                            // shirt
    ctx.fillRect(x - 11, foot - 34, 22, 10);
    ctx.fillStyle = '#ffe0c2';                            // head
    ctx.beginPath();
    ctx.arc(x, foot - 42, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';                            // paper cap
    ctx.fillRect(x - 10, foot - 52, 20, 6);

    // Arm reaching for the tap of the covered counter.
    ctx.fillStyle = '#ffe0c2';
    ctx.fillRect(x + 9, foot - 30, 18, 5);
}

// A short bar under the jerk that drains as the tap recharges, so the only
// invisible rule in the game — the pour cooldown — is readable.
function drawPourMeter() {
    const y = LANE_Y[jerk.lane];
    const x = BAR_LEFT - 56;
    const w = 34;
    const ready = pourCooldown <= 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(x - w / 2, y + 32, w, 5);
    ctx.fillStyle = ready ? '#8ef08a' : '#ff9f1c';
    const filled = ready ? w : w * (1 - pourCooldown / POUR_COOLDOWN);
    ctx.fillRect(x - w / 2, y + 32, filled, 5);
}

function drawBanner() {
    if (!banner) return;
    const alpha = Math.min(1, banner.t / 0.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(9, 6, 18, 0.72)';
    ctx.fillRect(CANVAS_W / 2 - 110, CANVAS_H / 2 - 28, 220, 56);
    ctx.fillStyle = '#ff9f1c';
    ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

function drawFlashes() {
    flash.forEach((f) => {
        const y = LANE_Y[f.lane];
        ctx.fillStyle = `rgba(255, 70, 70, ${0.32 * Math.min(1, f.t / 0.7)})`;
        ctx.fillRect(BAR_LEFT - 40, y - 48, BAR_RIGHT - BAR_LEFT + 60, 76);
    });
}

function drawCoverHint() {
    // A soft marker on the counter the jerk is covering, so the covered lane is
    // readable at a glance even in a crowded bar.
    const y = LANE_Y[jerk.lane];
    ctx.fillStyle = 'rgba(255, 212, 71, 0.10)';
    ctx.fillRect(BAR_LEFT - 14, y - 40, BAR_RIGHT - BAR_LEFT + 28, 68);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function prune(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i].dead) arr.splice(i, 1);
    }
}

function laneFromY(y) {
    let closest = 0;
    LANE_Y.forEach((ly, i) => {
        if (Math.abs(ly - y) < Math.abs(LANE_Y[closest] - y)) closest = i;
    });
    return closest;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = {
    ArrowUp: -1,
    ArrowDown: 1,
    w: -1,
    s: 1,
};

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Enter') {
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
    const dir = MOVE_KEYS[k] !== undefined ? MOVE_KEYS[k] : MOVE_KEYS[e.key];
    if (dir !== undefined) {
        e.preventDefault();
        moveLane(dir);
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    jerk.lane = laneFromY(y);
    pour();
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
seedRng(Date.now() & 0x7fffffff);
state = 'idle';
autoStep = false;
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
