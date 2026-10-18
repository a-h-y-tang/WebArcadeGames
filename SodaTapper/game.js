// ---------------------------------------------------------------------------
// Soda Tapper — four bars, one bartender, and a lot of thirsty patrons.
//
// Patrons walk in from the far right end of each bar and advance on the taps.
// Filling a mug and sliding it down the bar shoves whoever catches it back
// toward the door; shove them all the way out and they leave happy. A mug slid
// down an empty bar smashes off the far end, and every mug a patron finishes
// comes sliding back, so you have to be standing in that lane to catch it.
// Smashes and patrons who reach the taps both cost a life.
//
// Written as a single classic (non-module) script so every piece of state and
// every helper is reachable from the Playwright tests as a plain global,
// mirroring Gold Runner, Snake and Tetris in this repo. All motion is per
// second and applied through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing: `autoStep = false` hands time entirely to the spec, and
// `spawnEnabled = false` stops new patrons walking in behind its back.
// ---------------------------------------------------------------------------

// --- Playfield -----------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 460;
const LANE_COUNT = 4;
const LANE_TOP = 70;
const LANE_GAP = 100;
const FOOTER_Y = 408;   // the strip under the bars: lives and round progress

const TAP_X = 90;         // the taps; the bartender never leaves this column
const BAR_RIGHT = 690;    // far end of every bar
const SPAWN_X = 690;      // where a patron walks in
const CATCH_X = 118;      // an empty mug at or left of here can be caught
const SMASH_X = 70;       // an empty mug left of here has hit the floor
const GRAB_X = 116;       // a patron at or left of here has reached the taps

// --- Speeds (pixels per second) ------------------------------------------
const MUG_SPEED = 300;    // a full mug, sliding away from the taps
const EMPTY_SPEED = 240;  // an empty mug, coming back

// --- Serving -------------------------------------------------------------
const SERVE_COOLDOWN = 0.18;
const HIT_DIST = 22;      // how close a full mug gets before it is caught
const PUSH_BACK = 150;    // how far one mug shoves a patron
const DRINK_TIME = 0.9;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const SERVE_POINTS = 50;
const CATCH_POINTS = 25;
const SATISFIED_POINTS = 200;
const LEVEL_BONUS = 500;
const DEATH_PAUSE = 1.1;
const CLEAR_PAUSE = 1.6;
const SPAWN_GRACE = 0.8;  // head start before a round's first patron walks in

const ROUNDS = [
    { patrons: 8, patronSpeed: 46, spawnGap: 2.2, maxActive: 3 },
    { patrons: 10, patronSpeed: 56, spawnGap: 1.9, maxActive: 4 },
    { patrons: 12, patronSpeed: 66, spawnGap: 1.6, maxActive: 5 },
    { patrons: 14, patronSpeed: 76, spawnGap: 1.35, maxActive: 6 },
    { patrons: 16, patronSpeed: 88, spawnGap: 1.1, maxActive: 7 },
];

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const roundEl = document.getElementById('round');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'dying' | 'paused' | 'levelclear' | 'gameover' | 'won'
let state = 'idle';
let score = 0;
let best = 0;
let lives = START_LIVES;
let roundIndex = 0;

let patrons = [];     // { lane, x, phase: 'walking' | 'drinking', timer }
let mugs = [];        // { lane, x, full }
let splashes = [];    // purely decorative smash / catch sparks

const bartender = { lane: 0, bob: 0 };

let spawned = 0;          // patrons sent in during this round
let spawnTimer = 0;
let serveCooldown = 0;
let deathTimer = 0;
let clearTimer = 0;

// Test hooks: the Playwright suite switches these off so it owns the clock and
// nothing wanders onto the bars between assertions.
let autoStep = true;
let spawnEnabled = true;

// --- Helpers -------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function laneY(lane) {
    return LANE_TOP + lane * LANE_GAP;
}

function round() {
    return ROUNDS[clamp(roundIndex, 0, ROUNDS.length - 1)];
}

function addScore(points) {
    score += points;
    updateHud();
}

function updateHud() {
    scoreEl.textContent = String(score);
    roundEl.textContent = String(roundIndex + 1);
    livesEl.textContent = String(Math.max(0, lives));
    bestEl.textContent = String(best);
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

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('sodatapper-best', String(best));
        } catch (err) {
            // Private browsing or a file:// sandbox — the run still works.
        }
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    roundIndex = 0;
    bartender.lane = 0;
    bartender.bob = 0;
    spawnEnabled = true;
    splashes = [];
    startRound();
}

function startRound() {
    patrons = [];
    mugs = [];
    spawned = 0;
    spawnTimer = Math.max(0, round().spawnGap - SPAWN_GRACE);
    serveCooldown = 0;
    deathTimer = 0;
    clearTimer = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextRound() {
    roundIndex += 1;
    if (roundIndex >= ROUNDS.length) {
        winRun();
        return;
    }
    startRound();
}

function winRun() {
    roundIndex = ROUNDS.length - 1;
    state = 'won';
    saveBest();
    showOverlay('LAST CALL — YOU WIN', `Final score ${score}`, 'Press Space to play again');
}

function gameOver() {
    state = 'gameover';
    lives = 0;
    saveBest();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or Space to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// A smash or a grab: clear the bars, send the survivors back to the door and
// hold play for a beat — this game's take on the arcade round restart.
function loseLife() {
    lives -= 1;
    mugs = [];
    for (const p of patrons) {
        p.x = SPAWN_X;
        p.phase = 'walking';
        p.timer = 0;
    }
    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'dying';
    deathTimer = DEATH_PAUSE;
    updateHud();
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveBartender(delta) {
    if (state !== 'running' && state !== 'dying') return;
    bartender.lane = clamp(bartender.lane + delta, 0, LANE_COUNT - 1);
}

function serve() {
    if (state !== 'running') return;
    if (serveCooldown > 0) return;
    mugs.push({ lane: bartender.lane, x: TAP_X + 24, full: true });
    serveCooldown = SERVE_COOLDOWN;
    bartender.bob = 1;
}

function spawnPatron(lane) {
    patrons.push({ lane, x: SPAWN_X, phase: 'walking', timer: 0 });
    spawned += 1;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        updateSplashes(dt);
        if (deathTimer <= 0) {
            deathTimer = 0;
            state = 'running';
        }
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        updateSplashes(dt);
        if (clearTimer <= 0) {
            clearTimer = 0;
            nextRound();
        }
        return;
    }
    if (state !== 'running') return;

    serveCooldown = Math.max(0, serveCooldown - dt);
    bartender.bob = Math.max(0, bartender.bob - dt * 4);
    updateSplashes(dt);
    if (spawnEnabled) maybeSpawn(dt);

    moveMugs(dt);
    if (state !== 'running') return;   // a smash ended the frame

    movePatrons(dt);
    if (state !== 'running') return;   // a grab ended the frame

    checkRoundClear();
}

function maybeSpawn(dt) {
    const cfg = round();
    spawnTimer += dt;
    if (spawnTimer < cfg.spawnGap) return;
    if (spawned >= cfg.patrons) return;
    if (patrons.length >= cfg.maxActive) return;
    spawnTimer = 0;
    spawnPatron(Math.floor(Math.random() * LANE_COUNT));
}

function moveMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x += (m.full ? MUG_SPEED : -EMPTY_SPEED) * dt;

        if (m.full) {
            const target = nearestPatron(m.lane, m.x);
            if (target) {
                mugs.splice(i, 1);
                drinkUp(target);
                continue;
            }
            if (m.x > BAR_RIGHT) {
                smashMug(m);
                return;
            }
        } else {
            if (m.x <= CATCH_X && m.lane === bartender.lane) {
                mugs.splice(i, 1);
                spark(TAP_X + 18, laneY(m.lane), '#8ef7c4');
                addScore(CATCH_POINTS);
                continue;
            }
            if (m.x <= SMASH_X) {
                smashMug(m);
                return;
            }
        }
    }
}

function nearestPatron(lane, x) {
    let found = null;
    let bestGap = HIT_DIST;
    for (const p of patrons) {
        if (p.lane !== lane) continue;
        const gap = Math.abs(p.x - x);
        if (gap <= bestGap) {
            bestGap = gap;
            found = p;
        }
    }
    return found;
}

// A patron catches a mug: shoved back toward the door, then head down for a
// drink. The empty comes back when they are done.
function drinkUp(p) {
    p.x += PUSH_BACK;
    p.phase = 'drinking';
    p.timer = DRINK_TIME;
    spark(Math.min(p.x, BAR_RIGHT), laneY(p.lane), '#ffd98a');
    addScore(SERVE_POINTS);
}

function smashMug(m) {
    for (let i = 0; i < 10; i++) spark(clamp(m.x, SMASH_X, BAR_RIGHT), laneY(m.lane), '#ff7a7a');
    loseLife();
}

function movePatrons(dt) {
    const speed = round().patronSpeed;
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];

        if (p.phase === 'drinking') {
            p.timer -= dt;
            if (p.timer > 0) continue;
            // One code path covers both outcomes, so the empty mug is sent
            // back exactly once per mug served.
            mugs.push({ lane: p.lane, x: Math.min(p.x, BAR_RIGHT) - 6, full: false });
            if (p.x >= BAR_RIGHT) {
                patrons.splice(i, 1);
                for (let k = 0; k < 6; k++) spark(BAR_RIGHT, laneY(p.lane), '#8ef7c4');
                addScore(SATISFIED_POINTS);
            } else {
                p.phase = 'walking';
                p.timer = 0;
            }
            continue;
        }

        p.x -= speed * dt;
        if (p.x <= GRAB_X) {
            for (let k = 0; k < 10; k++) spark(GRAB_X, laneY(p.lane), '#ff7a7a');
            loseLife();
            return;
        }
    }
}

function checkRoundClear() {
    if (spawned < round().patrons) return;
    if (patrons.length > 0 || mugs.length > 0) return;
    addScore(LEVEL_BONUS * (roundIndex + 1));
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    showOverlay(`ROUND ${roundIndex + 1} CLEAR`, `Score ${score}`, 'Next round coming up…');
}

// --- Decoration ----------------------------------------------------------

function spark(x, y, color) {
    splashes.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 160,
        vy: (Math.random() - 0.9) * 140,
        life: 0.5 + Math.random() * 0.3,
        color,
    });
}

function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.life -= dt;
        if (s.life <= 0) {
            splashes.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 520 * dt;
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANE_COUNT; lane++) drawBar(lane);
    for (const p of patrons) drawPatron(p);
    for (const m of mugs) drawMug(m);
    drawTaps();
    drawBartender();
    drawSplashes();
    drawFooter();
}

function drawRoom() {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#2a1a3a');
    grad.addColorStop(0.75, '#170f21');
    grad.addColorStop(1, '#120c18');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Wall panelling behind the bars.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 2;
    for (let x = TAP_X; x < BAR_RIGHT; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, FOOTER_Y);
        ctx.stroke();
    }

    // The doorway wall on the right: one lit arch per bar, which is where the
    // patrons come from and where a satisfied one leaves.
    ctx.fillStyle = '#1b1226';
    ctx.fillRect(BAR_RIGHT + 6, 0, CANVAS_W - BAR_RIGHT - 6, FOOTER_Y);
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const glow = ctx.createLinearGradient(BAR_RIGHT + 6, 0, CANVAS_W, 0);
        glow.addColorStop(0, 'rgba(255, 180, 61, 0.35)');
        glow.addColorStop(1, 'rgba(255, 180, 61, 0.05)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.moveTo(BAR_RIGHT + 8, y + 16);
        ctx.lineTo(BAR_RIGHT + 8, y - 20);
        ctx.quadraticCurveTo(BAR_RIGHT + 8, y - 36, CANVAS_W, y - 36);
        ctx.lineTo(CANVAS_W, y + 16);
        ctx.closePath();
        ctx.fill();
    }
    ctx.strokeStyle = '#3b2a4c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_RIGHT + 6, 0);
    ctx.lineTo(BAR_RIGHT + 6, FOOTER_Y);
    ctx.stroke();
}

function drawBar(lane) {
    const y = laneY(lane);
    const top = y + 14;
    const active = lane === bartender.lane;

    if (active) {
        ctx.fillStyle = 'rgba(255, 180, 61, 0.06)';
        ctx.fillRect(TAP_X - 10, y - 44, BAR_RIGHT - TAP_X + 24, 62);
    }

    ctx.fillStyle = active ? '#6d4a2a' : '#593c22';
    ctx.fillRect(TAP_X - 10, top, BAR_RIGHT - TAP_X + 24, 16);
    ctx.fillStyle = active ? '#d6a066' : '#a97b48';
    ctx.fillRect(TAP_X - 10, top, BAR_RIGHT - TAP_X + 24, 5);

    // Plank seams, so sliding mugs read as moving.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    for (let x = TAP_X + 40; x < BAR_RIGHT; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + 16);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(TAP_X - 10, top + 16, BAR_RIGHT - TAP_X + 24, 5);
}

function drawTaps() {
    ctx.fillStyle = '#2b1f3a';
    ctx.fillRect(0, 0, TAP_X - 18, FOOTER_Y);
    ctx.strokeStyle = '#4b3663';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TAP_X - 18, 0);
    ctx.lineTo(TAP_X - 18, FOOTER_Y);
    ctx.stroke();

    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const y = laneY(lane);
        const active = lane === bartender.lane;

        // Barrel and spout.
        ctx.fillStyle = '#d6d9e4';
        ctx.fillRect(TAP_X - 20, y - 28, 20, 8);
        ctx.fillRect(TAP_X - 13, y - 22, 7, 20);
        ctx.fillStyle = active ? '#ffb43d' : '#7a6a8c';
        ctx.fillRect(TAP_X - 16, y - 4, 13, 6);

        if (active && serveCooldown > 0) {
            ctx.fillStyle = 'rgba(255, 214, 138, 0.8)';
            ctx.fillRect(TAP_X - 12, y + 2, 5, 12);
        }
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const lean = bartender.bob * 7;
    const x = TAP_X - 44 + lean;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs, apron, shirt.
    ctx.fillStyle = '#2f2440';
    ctx.fillRect(x - 8, y + 6, 6, 12);
    ctx.fillRect(x + 2, y + 6, 6, 12);
    ctx.fillStyle = '#e9eef7';
    ctx.fillRect(x - 11, y - 14, 22, 22);
    ctx.fillStyle = '#ffb43d';
    ctx.fillRect(x - 11, y - 1, 22, 10);
    ctx.fillStyle = '#d99429';
    ctx.fillRect(x - 11, y - 1, 22, 2);

    // Head and cap.
    ctx.fillStyle = '#f1d4b3';
    ctx.beginPath();
    ctx.arc(x, y - 23, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9eef7';
    ctx.fillRect(x - 10, y - 32, 20, 6);

    // Pouring arm, reaching for the tap.
    ctx.strokeStyle = '#f1d4b3';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 9);
    ctx.lineTo(x + 24 + lean, y - 6);
    ctx.stroke();
    ctx.lineCap = 'butt';
}

function drawPatron(p) {
    const x = Math.min(p.x, BAR_RIGHT + 2);
    const y = laneY(p.lane);
    const drinking = p.phase === 'drinking';
    // A two-frame walk cycle driven by position, so patrons shuffle along.
    const stride = drinking ? 0 : (Math.floor(x / 14) % 2 ? 1 : -1);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 16, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2f2440';
    ctx.fillRect(x - 8 - stride, y + 6, 6, 10);
    ctx.fillRect(x + 2 + stride, y + 6, 6, 10);

    ctx.fillStyle = drinking ? '#59c49a' : '#c96f97';
    ctx.fillRect(x - 10, y - 12, 20, 20);
    ctx.fillStyle = drinking ? '#7ddcb4' : '#e089ae';
    ctx.fillRect(x - 10, y - 12, 20, 4);

    ctx.fillStyle = '#f1d4b3';
    ctx.beginPath();
    ctx.arc(x, y - (drinking ? 18 : 21), 8, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim — a tell for which way they are facing.
    ctx.fillStyle = '#3a2b14';
    ctx.fillRect(x - 12, y - (drinking ? 26 : 29), 22, 5);
    ctx.fillRect(x - 8, y - (drinking ? 31 : 34), 14, 5);

    if (drinking) {
        ctx.fillStyle = '#ffe9a8';
        ctx.fillRect(x + 5, y - 20, 8, 10);
        ctx.strokeStyle = '#e8eef8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 5, y - 20, 8, 10);
    }
}

function drawMug(m) {
    const y = laneY(m.lane) + 10;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(m.x - 8, y + 2, 17, 3);

    ctx.fillStyle = m.full ? '#c87a2a' : 'rgba(214, 222, 240, 0.35)';
    ctx.fillRect(m.x - 8, y - 16, 16, 18);
    ctx.strokeStyle = '#e8eef8';
    ctx.lineWidth = 2;
    ctx.strokeRect(m.x - 8, y - 16, 16, 18);

    if (m.full) {
        ctx.fillStyle = '#fff6df';
        ctx.fillRect(m.x - 8, y - 20, 16, 6);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fillRect(m.x - 5, y - 13, 4, 12);
    }

    ctx.beginPath();
    ctx.arc(m.x + 10, y - 8, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

// The strip under the bars: lives left, and how much of the round remains.
function drawFooter() {
    ctx.fillStyle = '#1a1024';
    ctx.fillRect(0, FOOTER_Y, CANVAS_W, CANVAS_H - FOOTER_Y);
    ctx.strokeStyle = '#3b2a4c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FOOTER_Y);
    ctx.lineTo(CANVAS_W, FOOTER_Y);
    ctx.stroke();

    for (let i = 0; i < Math.max(0, lives); i++) {
        const x = 24 + i * 26;
        const y = FOOTER_Y + 34;
        ctx.fillStyle = '#c87a2a';
        ctx.fillRect(x - 7, y - 15, 14, 16);
        ctx.strokeStyle = '#e8eef8';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 7, y - 15, 14, 16);
        ctx.fillStyle = '#fff6df';
        ctx.fillRect(x - 7, y - 18, 14, 5);
    }

    const cfg = round();
    const done = clamp(spawned - patrons.length, 0, cfg.patrons);
    ctx.fillStyle = '#9b87b4';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ROUND ${roundIndex + 1}`, 150, FOOTER_Y + 26);
    ctx.fillText(`${done}/${cfg.patrons} SERVED`, CANVAS_W - 120, FOOTER_Y + 26);

    const barX = 240;
    const barW = CANVAS_W - barX - 140;
    ctx.fillStyle = '#2b1f3a';
    ctx.fillRect(barX, FOOTER_Y + 20, barW, 12);
    ctx.fillStyle = '#ffb43d';
    ctx.fillRect(barX, FOOTER_Y + 20, (barW * done) / cfg.patrons, 12);
    ctx.strokeStyle = '#4b3663';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, FOOTER_Y + 20, barW, 12);
}

function drawSplashes() {
    for (const s of splashes) {
        ctx.globalAlpha = clamp(s.life * 2, 0, 1);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const LANE_KEYS = {
    ArrowUp: -1,
    ArrowDown: 1,
    w: -1,
    s: 1,
};

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
        else if (state === 'paused') togglePause();
        else serve();
        return;
    }
    if (k === 'p') {
        togglePause();
        return;
    }
    const delta = LANE_KEYS[k];
    if (delta) {
        e.preventDefault();
        moveBartender(delta);
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const lane = clamp(Math.round((y - LANE_TOP) / LANE_GAP), 0, LANE_COUNT - 1);
    bartender.lane = lane;
    serve();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'running') serve();
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

try {
    best = parseInt(localStorage.getItem('sodatapper-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}

state = 'idle';
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
