// ---------------------------------------------------------------------------
// Root Beer Rush — a four-lane bar-service arcade game on an HTML5 canvas.
//
// You tend four bars at once. Thirsty patrons walk in from the far end of each
// bar and shuffle toward you; slide a mug of root beer down their lane to push
// them back. Push a patron off the end of the bar and they leave happy. Every
// patron who takes a drink slides the empty mug back — catch it or it smashes
// on the floor. Miss a mug at the far end, drop an empty, or let a patron reach
// you and the round costs a life.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per-second and driven
// through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 560;
const CANVAS_H = 460;

const LANES = 4;
const LANE_TOP = 88;            // y of the first bar surface
const LANE_SPACING = 96;
const LANE_Y = Array.from({ length: LANES }, (_, i) => LANE_TOP + i * LANE_SPACING);

const BAR_LEFT = 40;            // far end — where patrons come from
const BAR_RIGHT = 500;          // barkeep end
const BAR_THICK = 12;

// --- Barkeep -------------------------------------------------------------
const KEEP_X = 526;             // centre of the barkeep, right of the taps
const POUR_CD = 0.22;           // seconds between mugs

// --- Mugs ----------------------------------------------------------------
const MUG_START = BAR_RIGHT - 12;
const MUG_SPEED = 240;          // px/s sliding away from the barkeep
const EMPTY_SPEED = 190;        // px/s sliding back toward the barkeep
const MUG_W = 16;
const MUG_H = 20;
const HIT_DIST = 18;            // how close a mug must be to reach a patron

const CATCH_X = BAR_RIGHT - 14; // an empty this far along can be caught
const MISS_X = BAR_RIGHT + 24;  // ...past here it hits the floor

// --- Patrons -------------------------------------------------------------
const PATRON_SPAWN_X = BAR_LEFT + 6;
const EXIT_X = BAR_LEFT - 10;   // pushed past here and the patron leaves happy
const GRAB_X = BAR_RIGHT - 24;  // reach here and the barkeep is done for
const PUSH_DIST = 90;           // how far one mug shoves a patron back
const DRINK_TIME = 1.0;
const PATRON_GAP = 26;          // patrons queue rather than overlap
const PATRON_HW = 11;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const FIRST_SPAWN = 1.2;
const DEATH_PAUSE = 1.2;
const CLEAR_PAUSE = 1.6;

const SERVE_POINTS = 100;       // patron pushed off the end
const DRINK_POINTS = 50;        // mug delivered
const CATCH_POINTS = 25;        // empty caught
const LEVEL_BONUS = 250;

const BEST_KEY = 'rootbeerrush-best';

// --- Colours -------------------------------------------------------------
const SHIRT_COLORS = ['#c8553d', '#3d7ea6', '#7a5ba6', '#4f9d69', '#b0763a'];
const WOOD_DARK = '#4a2f1b';
const WOOD_LIGHT = '#6b452a';
const BREW = '#c07a2c';
const FOAM = '#f6e7cd';

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const servedEl = document.getElementById('served');
const targetEl = document.getElementById('target');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level, served, spawned, target;
let barkeep, patrons, mugs, empties, splashes;
let spawnTimer, spawnEnabled, deathTimer, clearTimer, resumeState;

// ---------------------------------------------------------------------------
// Level tuning — all three curves are plain functions of the level so the
// specs can assert the difficulty ramp without playing through a whole run.
// ---------------------------------------------------------------------------

function levelTarget(l) {
    return Math.min(16, 6 + (l - 1) * 2);
}

function patronSpeed(l) {
    return Math.min(62, 30 + (l - 1) * 6);
}

function spawnInterval(l) {
    return Math.max(1.1, 2.8 - (l - 1) * 0.22);
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function clearBar() {
    patrons = [];
    mugs = [];
    empties = [];
    splashes = [];
}

function startLevel(l) {
    level = l;
    target = levelTarget(l);
    served = 0;
    spawned = 0;
    spawnTimer = FIRST_SPAWN;
    clearBar();
    barkeep = { lane: 0, pourCd: 0 };
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    spawnEnabled = true;
    startLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'over';
    clearBar();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function togglePause() {
    if (state === 'running') {
        resumeState = state;
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = resumeState || 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnPatron(lane) {
    patrons.push({
        lane,
        x: PATRON_SPAWN_X,
        mode: 'walking',      // 'walking' | 'drinking'
        drinkT: 0,
        bob: Math.random() * Math.PI * 2,
        shirt: SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)],
    });
    return patrons[patrons.length - 1];
}

function spawnEmpty(lane, x) {
    empties.push({ lane, x });
    return empties[empties.length - 1];
}

function pour() {
    if (state !== 'running') return false;
    if (barkeep.pourCd > 0) return false;
    mugs.push({ lane: barkeep.lane, x: MUG_START, foam: 1 });
    barkeep.pourCd = POUR_CD;
    return true;
}

function splash(lane, x) {
    splashes.push({ lane, x, life: 0.5 });
}

function addScore(points) {
    score += points;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private browsing — the run just does not persist a best score */
        }
    }
    updateHud();
}

function loseLife() {
    lives -= 1;
    clearBar();
    updateHud();
    if (lives <= 0) {
        gameOver();
        return;
    }
    state = 'dying';
    deathTimer = DEATH_PAUSE;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            clearBar();
            barkeep.pourCd = 0;
            state = 'running';
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            startLevel(level + 1);
            state = 'running';
            hideOverlay();
        }
        return;
    }

    if (state !== 'running') return;

    barkeep.pourCd = Math.max(0, barkeep.pourCd - dt);

    stepSpawning(dt);
    stepMugs(dt);
    stepPatrons(dt);
    stepEmpties(dt);
    stepSplashes(dt);

    if (state === 'running') checkLevelClear();
}

function stepSpawning(dt) {
    if (!spawnEnabled || spawned >= target) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval(level);
    spawnPatron(Math.floor(Math.random() * LANES));
    spawned += 1;
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;

        const patron = nearestPatron(mug);
        if (patron) {
            mugs.splice(i, 1);
            servePatron(patron);
            continue;
        }

        if (mug.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            splash(mug.lane, BAR_LEFT);
            loseLife();
            return;
        }
    }
}

// The rightmost walking patron within reach — a mug is caught by whoever is
// closest to the barkeep, so patrons further down the bar stay thirsty.
function nearestPatron(mug) {
    let hit = null;
    for (const p of patrons) {
        if (p.lane !== mug.lane || p.mode !== 'walking') continue;
        if (Math.abs(p.x - mug.x) > HIT_DIST) continue;
        if (!hit || p.x > hit.x) hit = p;
    }
    return hit;
}

function servePatron(patron) {
    addScore(DRINK_POINTS);
    patron.x -= PUSH_DIST;
    if (patron.x <= EXIT_X) {
        patrons.splice(patrons.indexOf(patron), 1);
        served += 1;
        addScore(SERVE_POINTS);
        updateHud();
        return;
    }
    patron.mode = 'drinking';
    patron.drinkT = DRINK_TIME;
}

function stepPatrons(dt) {
    const speed = patronSpeed(level);
    // Walk from the barkeep end back, so a queued patron sees the up-to-date
    // position of the one ahead of them in the same lane.
    const ordered = [...patrons].sort((a, b) => b.x - a.x);

    for (const p of ordered) {
        if (p.mode === 'drinking') {
            p.drinkT -= dt;
            if (p.drinkT <= 0) {
                p.mode = 'walking';
                spawnEmpty(p.lane, p.x + 14);
            }
            continue;
        }

        p.bob += dt * 6;
        const limit = frontLimit(p);
        p.x = Math.min(limit, p.x + speed * dt);

        if (p.x >= GRAB_X) {
            loseLife();
            return;
        }
    }
}

// A walking patron stops a body's width behind whoever is ahead of them.
function frontLimit(patron) {
    let limit = GRAB_X;
    for (const other of patrons) {
        if (other === patron || other.lane !== patron.lane) continue;
        if (other.x <= patron.x) continue;
        limit = Math.min(limit, other.x - PATRON_GAP);
    }
    return limit;
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const empty = empties[i];
        empty.x += EMPTY_SPEED * dt;

        if (empty.x >= CATCH_X && barkeep.lane === empty.lane) {
            empties.splice(i, 1);
            addScore(CATCH_POINTS);
            continue;
        }

        if (empty.x > MISS_X) {
            empties.splice(i, 1);
            splash(empty.lane, MISS_X);
            loseLife();
            return;
        }
    }
}

function stepSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].life -= dt;
        if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
}

function checkLevelClear() {
    if (spawned < target) return;
    if (patrons.length || mugs.length || empties.length) return;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    addScore(LEVEL_BONUS * level);
    showOverlay(`LEVEL ${level} CLEARED`, `Score ${score}`, 'Next round coming up');
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
    servedEl.textContent = String(served);
    targetEl.textContent = String(target);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine || '';
    overlaySub.textContent = sub || '';
    overlay.classList.add('visible');
    btnStart.textContent = state === 'paused' ? 'Resume' : 'Start Game';
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    // Patrons stand on the far side of the bar, so they are painted first and
    // the plank drawn over them hides everything below chest height.
    for (const p of patrons) drawPatron(p);
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);
    for (const m of mugs) drawMug(m.lane, m.x, true);
    for (const e of empties) drawMug(e.lane, e.x, false);
    for (const s of splashes) drawSplash(s);
    drawBarkeep();
}

function drawRoom() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#221507');
    sky.addColorStop(1, '#140d06');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Panelled back wall.
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 14; x < CANVAS_W; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, CANVAS_H);
        ctx.stroke();
    }

    // Tap column the barkeep works from.
    ctx.fillStyle = '#2a1b10';
    ctx.fillRect(BAR_RIGHT + 2, 0, CANVAS_W - BAR_RIGHT - 2, CANVAS_H);
    ctx.fillStyle = '#3a2616';
    ctx.fillRect(BAR_RIGHT + 2, 0, 3, CANVAS_H);
}

function drawBar(lane) {
    const y = LANE_Y[lane];

    // Bar top with a lighter front edge.
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(BAR_LEFT, y, BAR_RIGHT - BAR_LEFT, BAR_THICK);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(BAR_LEFT, y + BAR_THICK - 4, BAR_RIGHT - BAR_LEFT, 4);

    // Grain.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT, y + 4.5);
    ctx.lineTo(BAR_RIGHT, y + 4.5);
    ctx.stroke();

    // The far end where undelivered mugs drop off.
    ctx.fillStyle = '#31200f';
    ctx.fillRect(BAR_LEFT - 8, y, 8, BAR_THICK + 10);

    // Tap over the barkeep end of this lane.
    ctx.fillStyle = '#8a8f96';
    ctx.fillRect(BAR_RIGHT - 6, y - 20, 5, 20);
    ctx.fillRect(BAR_RIGHT - 12, y - 24, 16, 6);
    ctx.fillStyle = barkeep && barkeep.lane === lane ? '#ffd479' : '#6d5232';
    ctx.fillRect(BAR_RIGHT - 12, y - 30, 16, 6);
}

function drawPatron(p) {
    // The waistline sits below the plank, so only the torso and head show.
    const waist = LANE_Y[p.lane] + BAR_THICK;
    // Bobbing only ever lifts the patron, so no torso pokes out below the plank.
    const bob = p.mode === 'walking' ? -Math.abs(Math.sin(p.bob)) * 2 : 0;
    const base = waist + bob;

    // Torso.
    ctx.fillStyle = p.shirt;
    ctx.fillRect(p.x - 9, base - 26, 18, 26);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(p.x - 9, base - 26, 4, 26);
    // Head.
    ctx.fillStyle = '#e6b98d';
    ctx.beginPath();
    ctx.arc(p.x, base - 33, 7, 0, Math.PI * 2);
    ctx.fill();
    // Hat.
    ctx.fillStyle = '#3b2a1b';
    ctx.fillRect(p.x - 12, base - 39, 24, 3);
    ctx.fillRect(p.x - 7, base - 45, 14, 6);
    // Arm reaching along the bar toward the barkeep.
    ctx.fillStyle = p.shirt;
    ctx.fillRect(p.x + 7, base - 24, 11, 5);

    if (p.mode === 'drinking') {
        // Mug raised to the mouth, plus a couple of happy bubbles.
        drawMug(p.lane, p.x + 15, true, -26);
        ctx.fillStyle = FOAM;
        ctx.fillRect(p.x - 6, base - 52, 3, 3);
        ctx.fillRect(p.x + 4, base - 57, 2, 2);
    }
}

function drawMug(lane, x, full, lift = 0) {
    const y = LANE_Y[lane] + 2 + lift;
    const top = y - MUG_H;

    ctx.fillStyle = full ? BREW : 'rgba(214, 226, 236, 0.55)';
    ctx.fillRect(x - MUG_W / 2, top, MUG_W, MUG_H);

    if (full) {
        ctx.fillStyle = FOAM;
        ctx.fillRect(x - MUG_W / 2, top, MUG_W, 5);
    }

    // Glass outline and handle.
    ctx.strokeStyle = '#e9f2f8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - MUG_W / 2, top, MUG_W, MUG_H);
    ctx.beginPath();
    ctx.arc(x + MUG_W / 2 + 2, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawSplash(s) {
    const y = LANE_Y[s.lane] + BAR_THICK;
    const spread = (0.5 - s.life) * 40 + 8;
    ctx.strokeStyle = `rgba(246, 231, 205, ${Math.max(0, s.life * 2)})`;
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(s.x, y);
        ctx.lineTo(s.x + i * spread, y + spread * 0.6);
        ctx.stroke();
    }
}

function drawBarkeep() {
    if (!barkeep) return;
    const base = LANE_Y[barkeep.lane] + BAR_THICK + 4;

    // Shirt and apron.
    ctx.fillStyle = '#2f6f8f';
    ctx.fillRect(KEEP_X - 12, base - 32, 24, 32);
    ctx.fillStyle = '#e8e2d4';
    ctx.fillRect(KEEP_X - 9, base - 18, 18, 18);
    // Head.
    ctx.fillStyle = '#f0c49a';
    ctx.beginPath();
    ctx.arc(KEEP_X, base - 40, 8, 0, Math.PI * 2);
    ctx.fill();
    // Cap.
    ctx.fillStyle = '#d8593f';
    ctx.fillRect(KEEP_X - 10, base - 48, 20, 5);
    ctx.fillRect(KEEP_X - 16, base - 44, 8, 3);
    // Arm on the tap handle of the current lane.
    ctx.fillStyle = '#2f6f8f';
    ctx.fillRect(KEEP_X - 24, base - 30, 14, 5);

    // Pour meter beneath the barkeep: full means the next mug is ready.
    const ready = 1 - Math.min(1, barkeep.pourCd / POUR_CD);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(KEEP_X - 12, base + 4, 24, 4);
    ctx.fillStyle = ready >= 1 ? '#ffd479' : '#a5762f';
    ctx.fillRect(KEEP_X - 12, base + 4, 24 * ready, 4);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') pour();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (state !== 'running') return;
    if (UP_KEYS.includes(e.key)) {
        barkeep.lane = Math.max(0, barkeep.lane - 1);
        e.preventDefault();
    } else if (DOWN_KEYS.includes(e.key)) {
        barkeep.lane = Math.min(LANES - 1, barkeep.lane + 1);
        e.preventDefault();
    }
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
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
score = 0;
lives = START_LIVES;
spawnEnabled = true;
startLevel(1);
state = 'idle';
updateHud();
showOverlay('ROOT BEER RUSH', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
