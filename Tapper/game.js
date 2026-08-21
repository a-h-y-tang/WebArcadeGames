// ---------------------------------------------------------------------------
// Tapper — a bar-service arcade game on an HTML5 canvas.
//
// Four counters run across the screen. Patrons walk in from the left end of a
// counter and shuffle toward the bartender, who stands at the right end of
// exactly one counter at a time. Sliding a full mug down a counter shoves the
// nearest patron back toward the door; push one past the door and they leave
// happy. Every mug you pour comes back as an empty one, and an empty mug that
// runs off the end — or a patron who reaches you — costs a life.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. All motion is expressed per second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;

const ROWS = 4;
const ROW_Y = [80, 180, 280, 380];   // y of each counter surface
const COUNTER_LEFT = 40;
const COUNTER_RIGHT = 596;
const COUNTER_H = 12;

const BAR_X = 610;                    // where the bartender stands
const GRAB_X = COUNTER_RIGHT - 24;    // a patron this far along grabs you
const CATCH_X = COUNTER_RIGHT - 40;   // an empty mug this far along is catchable
const LOSE_X = COUNTER_RIGHT + 14;    // ...and is gone for good past here

// --- Mugs ----------------------------------------------------------------
const MUG_SPEED = 230;    // px/s, full mug travelling left
const EMPTY_SPEED = 170;  // px/s, empty mug coming back
const MUG_HW = 9;
const MUG_H = 20;
const POUR_COOLDOWN = 0.18;
const POUR_X = COUNTER_RIGHT - 12;

// --- Patrons -------------------------------------------------------------
const PATRON_SPAWN_X = COUNTER_LEFT + 10;
const PATRON_HW = 12;
const PATRON_H = 34;
const PATRON_SPEED_BASE = 25;   // px/s on level 1
const PATRON_SPEED_STEP = 5;    // extra px/s per level
const PATRON_SPEED_MAX = 78;
const PUSH_BACK = 88;
const DRINK_TIME = 0.9;
const SERVE_X = COUNTER_LEFT - 2;
const ENTRANCE_CLEARANCE = 60;  // don't drop a patron on top of another

// --- Waves ---------------------------------------------------------------
const START_LIVES = 3;
const START_ROW = ROWS - 1;
const WAVE_BASE = 5;
const WAVE_MAX = 12;
const SPAWN_INTERVAL_BASE = 2.8;
const SPAWN_INTERVAL_STEP = 0.2;
const SPAWN_INTERVAL_MIN = 1.1;
const FIRST_SPAWN = 1.2;
const RESPAWN_DELAY = 1.5;

// --- Scoring -------------------------------------------------------------
const SCORE_SERVE = 50;
const SCORE_CATCH = 10;
const SCORE_LEVEL = 100;
const SCORE_TIP = 25;      // a departing patron takes one trailing mug with them

const SEED = 0x2f6e2b1;

// --- State ---------------------------------------------------------------
let state = 'idle';        // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;            // patrons satisfied this game
let servedThisWave = 0;
let pending = 0;           // patrons in this wave not released yet
let spawnEnabled = true;
let spawnTimer = FIRST_SPAWN;
let pourTimer = 0;
let rngState = SEED;

const bartender = { row: START_ROW, bob: 0 };
const mugs = [];        // { row, x }
const emptyMugs = [];   // { row, x }
const patrons = [];     // { row, x, drinkTimer, tint }
const shards = [];      // purely decorative shatter particles

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elServed = document.getElementById('served');
const elBest = document.getElementById('best');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Small deterministic PRNG (mulberry32) so an enabled spawner still produces a
// reproducible wave for the tests.
function rng() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function waveSize(lvl) {
    return Math.min(WAVE_MAX, WAVE_BASE + lvl);
}

function patronSpeed() {
    return Math.min(PATRON_SPEED_MAX, PATRON_SPEED_BASE + (level - 1) * PATRON_SPEED_STEP);
}

function spawnInterval() {
    return Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_BASE - (level - 1) * SPAWN_INTERVAL_STEP);
}

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elServed.textContent = String(served);
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

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------

function clearBar() {
    mugs.length = 0;
    emptyMugs.length = 0;
    patrons.length = 0;
    shards.length = 0;
    pourTimer = 0;
}

function resetWave(delay) {
    clearBar();
    pending = waveSize(level);
    servedThisWave = 0;
    spawnTimer = delay;
}

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    rngState = SEED;
    bartender.row = START_ROW;
    bartender.bob = 0;
    spawnEnabled = true;
    resetWave(FIRST_SPAWN);
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += SCORE_LEVEL * level;
    level += 1;
    resetWave(RESPAWN_DELAY);
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (err) {
            /* private mode — the run just doesn't persist */
        }
    }
    clearBar();
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
}

function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        gameOver();
        return;
    }
    resetWave(RESPAWN_DELAY);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or click Resume');
        btnStart.textContent = 'Resume';
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        btnStart.textContent = 'Start Game';
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveBartender(delta) {
    if (state !== 'running') return;
    bartender.row = Math.max(0, Math.min(ROWS - 1, bartender.row + delta));
}

function pour() {
    if (state !== 'running' || pourTimer > 0) return;
    mugs.push({ row: bartender.row, x: POUR_X });
    pourTimer = POUR_COOLDOWN;
}

function spawnPatron(row) {
    patrons.push({
        row,
        x: PATRON_SPAWN_X,
        drinkTimer: 0,
        tint: Math.floor(rng() * 4),
    });
}

function shatter(x, y, color) {
    for (let i = 0; i < 10; i++) {
        shards.push({
            x,
            y,
            vx: (rng() - 0.5) * 180,
            vy: -rng() * 160,
            life: 0.6,
            color,
        });
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

// The frontmost (right-most) patron on a row that a mug at `x` overlaps.
function patronHitBy(mug) {
    let hit = null;
    for (const p of patrons) {
        if (p.row !== mug.row) continue;
        if (Math.abs(p.x - mug.x) > PATRON_HW + MUG_HW) continue;
        if (!hit || p.x > hit.x) hit = p;
    }
    return hit;
}

function servePatron(p) {
    served += 1;
    servedThisWave += 1;
    score += SCORE_SERVE;
    patrons.splice(patrons.indexOf(p), 1);

    // One for the road: a patron heading out the door takes the mug still
    // sliding behind them, so a sensible double-pour isn't punished with the
    // shatter that an empty counter earns.
    let trailing = -1;
    for (let i = 0; i < mugs.length; i++) {
        if (mugs[i].row !== p.row) continue;
        if (trailing < 0 || mugs[i].x < mugs[trailing].x) trailing = i;
    }
    if (trailing >= 0) {
        mugs.splice(trailing, 1);
        score += SCORE_TIP;
    }
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;

        const hit = patronHitBy(mug);
        if (hit) {
            mugs.splice(i, 1);
            hit.x -= PUSH_BACK;
            hit.drinkTimer = DRINK_TIME;
            emptyMugs.push({ row: hit.row, x: Math.min(POUR_X, hit.x + PATRON_HW + MUG_HW) });
            if (hit.x < SERVE_X) servePatron(hit);
            continue;
        }

        if (mug.x < COUNTER_LEFT) {
            mugs.splice(i, 1);
            shatter(COUNTER_LEFT, ROW_Y[mug.row] - 8, '#f5c451');
            loseLife();
            return true;
        }
    }
    return false;
}

function stepEmptyMugs(dt) {
    for (let i = emptyMugs.length - 1; i >= 0; i--) {
        const mug = emptyMugs[i];
        mug.x += EMPTY_SPEED * dt;

        if (mug.x >= CATCH_X && bartender.row === mug.row) {
            emptyMugs.splice(i, 1);
            score += SCORE_CATCH;
            continue;
        }

        if (mug.x > LOSE_X) {
            emptyMugs.splice(i, 1);
            shatter(LOSE_X, ROW_Y[mug.row] - 8, '#9fd6e8');
            loseLife();
            return true;
        }
    }
    return false;
}

function stepPatrons(dt) {
    const speed = patronSpeed();
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];
        if (p.drinkTimer > 0) {
            p.drinkTimer -= dt;
            continue;
        }
        p.x += speed * dt;
        if (p.x >= GRAB_X) {
            loseLife();
            return true;
        }
    }
    return false;
}

function stepSpawner(dt) {
    if (!spawnEnabled || pending <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    // Only counters whose entrance is clear can take a new patron; if the bar
    // is jammed at the door, try again shortly.
    const free = [];
    for (let row = 0; row < ROWS; row++) {
        const blocked = patrons.some((p) => p.row === row && p.x < COUNTER_LEFT + ENTRANCE_CLEARANCE);
        if (!blocked) free.push(row);
    }
    if (!free.length) {
        spawnTimer = 0.4;
        return;
    }

    spawnPatron(free[Math.floor(rng() * free.length)]);
    pending -= 1;
    spawnTimer = spawnInterval();
}

function stepShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 520 * dt;
    }
}

function waveCleared() {
    return (
        servedThisWave > 0 &&
        pending <= 0 &&
        patrons.length === 0 &&
        mugs.length === 0 &&
        emptyMugs.length === 0
    );
}

function step(dt) {
    if (state !== 'running' || dt <= 0) return;

    if (pourTimer > 0) pourTimer -= dt;
    bartender.bob += dt;

    // Each of these returns true when a life was lost, which resets the bar —
    // so the frame ends there and a second disaster can't cost a second life.
    if (stepMugs(dt)) return;
    if (stepEmptyMugs(dt)) return;
    if (stepPatrons(dt)) return;

    stepSpawner(dt);
    stepShards(dt);

    if (waveCleared()) nextLevel();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const TINTS = ['#e8734a', '#d95c9a', '#6f8ce8', '#8fbf4a'];
const HATS = ['#2a1a12', '#3d2a4a', '#1f3a4a', '#4a3a1c'];

const FLOOR_Y = ROW_Y[ROWS - 1] + 34;

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#153035');
    wall.addColorStop(0.7, '#0b1a1d');
    wall.addColorStop(1, '#060f11');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Wall panelling — faint vertical planks behind the whole bar.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
    for (let x = 0; x < CANVAS_W; x += 32) ctx.fillRect(x, 0, 16, CANVAS_H);

    // Hanging lamp glow over each counter.
    for (let row = 0; row < ROWS; row++) {
        const y = ROW_Y[row];
        const glow = ctx.createRadialGradient(CANVAS_W / 2, y - 60, 6, CANVAS_W / 2, y - 60, 300);
        glow.addColorStop(0, 'rgba(255, 214, 140, 0.10)');
        glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, y - 78, CANVAS_W, 78);
    }
}

// The swinging door each patron walks in through.
function drawDoorway(row) {
    const y = ROW_Y[row];
    const w = COUNTER_LEFT - 10;

    ctx.fillStyle = '#050d0e';
    ctx.fillRect(2, y - 54, w, 54);

    // Door frame, with the street light behind it spilling onto the counter.
    ctx.fillStyle = '#3a6b68';
    ctx.fillRect(2, y - 58, w + 4, 5);
    ctx.fillRect(2, y - 54, 4, 54);
    ctx.fillRect(w - 2, y - 54, 4, 54);

    ctx.fillStyle = '#2c5250';
    ctx.fillRect(6, y - 40, w - 10, 3);

    ctx.fillStyle = 'rgba(120, 210, 190, 0.18)';
    ctx.fillRect(6, y - 50, w - 10, 46);
}

function drawCounter(row) {
    const y = ROW_Y[row];
    const x0 = COUNTER_LEFT - 8;
    const w = COUNTER_RIGHT - COUNTER_LEFT + 22;

    // Counter top, then the darker front face below it for a little depth.
    const grad = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    grad.addColorStop(0, '#c2853f');
    grad.addColorStop(1, '#7a4a20');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y, w, COUNTER_H);

    ctx.fillStyle = '#472a13';
    ctx.fillRect(x0, y + COUNTER_H, w, 5);

    ctx.fillStyle = 'rgba(255, 233, 190, 0.45)';
    ctx.fillRect(x0, y, w, 2);

    // Wood grain.
    ctx.fillStyle = 'rgba(60, 30, 10, 0.18)';
    for (let x = x0 + 12; x < x0 + w; x += 46) ctx.fillRect(x, y + 5, 22, 2);

    drawDoorway(row);
    drawTap(row);
}

// The tap station the bartender pours from, at the right end of a counter.
function drawTap(row) {
    const y = ROW_Y[row];

    ctx.fillStyle = '#33565a';
    ctx.fillRect(COUNTER_RIGHT + 2, y - 38, 18, 38);
    ctx.fillStyle = '#48757a';
    ctx.fillRect(COUNTER_RIGHT + 2, y - 38, 18, 3);

    // Tap column and spout.
    ctx.fillStyle = '#d6e4e0';
    ctx.fillRect(COUNTER_RIGHT + 7, y - 34, 6, 20);
    ctx.fillRect(COUNTER_RIGHT - 2, y - 18, 16, 5);

    ctx.fillStyle = '#f0b52f';
    ctx.fillRect(COUNTER_RIGHT + 5, y - 40, 10, 5);
}

function drawMug(x, y, full) {
    const top = y - MUG_H;

    if (full) {
        ctx.fillStyle = '#fdf6e3';
        ctx.fillRect(x - MUG_HW, top - 5, MUG_HW * 2 - 3, 6);
    }

    const glass = ctx.createLinearGradient(x - MUG_HW, 0, x + MUG_HW, 0);
    if (full) {
        glass.addColorStop(0, '#f7cf63');
        glass.addColorStop(0.5, '#f0b52f');
        glass.addColorStop(1, '#c9871a');
    } else {
        glass.addColorStop(0, 'rgba(214, 238, 238, 0.75)');
        glass.addColorStop(0.5, 'rgba(160, 200, 202, 0.55)');
        glass.addColorStop(1, 'rgba(120, 165, 168, 0.55)');
    }
    ctx.fillStyle = glass;
    ctx.fillRect(x - MUG_HW, top, MUG_HW * 2 - 3, MUG_H);

    // Handle.
    ctx.fillStyle = full ? '#c9871a' : 'rgba(160, 200, 202, 0.7)';
    ctx.fillRect(x + MUG_HW - 4, top + 5, 4, 9);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x - MUG_HW + 2, top + 3, 2, MUG_H - 7);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - MUG_HW + 0.5, top + 0.5, MUG_HW * 2 - 4, MUG_H - 1);
}

function drawPatron(p) {
    const y = ROW_Y[p.row];
    const body = TINTS[p.tint % TINTS.length];
    const drinking = p.drinkTimer > 0;
    // Walking patrons rock slightly; drinking ones hold still.
    const bob = drinking ? 0 : Math.round(Math.sin(p.x * 0.22) * 1.2);
    const headY = y - PATRON_H - 14 + bob;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(p.x - PATRON_HW - 2, y - 3, PATRON_HW * 2 + 4, 3);

    ctx.fillStyle = body;
    ctx.fillRect(p.x - PATRON_HW, y - PATRON_H + bob, PATRON_HW * 2, PATRON_H - bob);

    // Shoulders catch the lamp light.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(p.x - PATRON_HW, y - PATRON_H + bob, PATRON_HW * 2, 3);

    // Arm reaching for the bar.
    ctx.fillStyle = body;
    ctx.fillRect(p.x + PATRON_HW - 2, y - PATRON_H + 10 + bob, 8, 5);

    ctx.fillStyle = '#f0d3b0';
    ctx.fillRect(p.x - 8, headY, 16, 14);

    ctx.fillStyle = HATS[p.tint % HATS.length];
    ctx.fillRect(p.x - 10, headY - 4, 20, 5);
    ctx.fillRect(p.x - 7, headY - 8, 14, 4);

    ctx.fillStyle = '#1b1410';
    if (drinking) {
        ctx.fillRect(p.x - 5, headY + 6, 4, 2);
        ctx.fillRect(p.x + 2, headY + 6, 4, 2);
    } else {
        ctx.fillRect(p.x - 4, headY + 5, 3, 4);
        ctx.fillRect(p.x + 2, headY + 5, 3, 4);
    }

    if (drinking) {
        // Mug raised to the face while they drink.
        ctx.fillStyle = '#f0b52f';
        ctx.fillRect(p.x + 7, headY + 4, 8, 11);
        ctx.fillStyle = '#fdf6e3';
        ctx.fillRect(p.x + 7, headY + 2, 8, 3);
    }
}

function drawBartender() {
    const y = ROW_Y[bartender.row];
    const lean = Math.sin(bartender.bob * 6) * 1.5;

    // The counter you are serving is lit up.
    ctx.fillStyle = 'rgba(63, 214, 163, 0.10)';
    ctx.fillRect(COUNTER_LEFT - 8, y - 70, COUNTER_RIGHT - COUNTER_LEFT + 22, 70);
    ctx.fillStyle = 'rgba(63, 214, 163, 0.5)';
    ctx.fillRect(COUNTER_LEFT - 8, y - 2, COUNTER_RIGHT - COUNTER_LEFT + 22, 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(BAR_X - 14, y - 3, 28, 3);

    // Legs, apron, shirt, head — drawn bottom-up.
    ctx.fillStyle = '#20383a';
    ctx.fillRect(BAR_X - 10, y - 14, 8, 14);
    ctx.fillRect(BAR_X + 2, y - 14, 8, 14);

    ctx.fillStyle = '#e8f6f1';
    ctx.fillRect(BAR_X - 12, y - 40, 24, 26);

    ctx.fillStyle = '#3fd6a3';
    ctx.fillRect(BAR_X - 12, y - 26, 24, 14);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(BAR_X - 12, y - 26, 24, 2);

    // Pouring arm, reaching over the counter toward the tap.
    ctx.fillStyle = '#f0d3b0';
    ctx.fillRect(BAR_X - 22 + lean, y - 36, 11, 6);
    ctx.fillRect(BAR_X + 11, y - 34, 8, 6);

    ctx.fillStyle = '#f0d3b0';
    ctx.fillRect(BAR_X - 9, y - 54, 18, 14);

    ctx.fillStyle = '#1b1410';
    ctx.fillRect(BAR_X - 6, y - 49, 3, 4);
    ctx.fillRect(BAR_X + 1, y - 49, 3, 4);

    // Bartender's cap.
    ctx.fillStyle = '#3fd6a3';
    ctx.fillRect(BAR_X - 11, y - 58, 22, 5);
    ctx.fillRect(BAR_X - 15, y - 54, 6, 3);
}

// A strip along the bottom of the screen: kegs, plus a pip per patron still to
// come in this wave, so the pressure ahead is visible without reading the HUD.
function drawFloor() {
    ctx.fillStyle = '#0a1517';
    ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
    ctx.fillStyle = '#16292b';
    ctx.fillRect(0, FLOOR_Y, CANVAS_W, 3);

    for (let i = 0; i < 5; i++) {
        const x = 28 + i * 44;
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(x, FLOOR_Y + 14, 26, 30);
        ctx.fillStyle = '#5d4326';
        ctx.fillRect(x, FLOOR_Y + 20, 26, 4);
        ctx.fillRect(x, FLOOR_Y + 34, 26, 4);
    }

    ctx.fillStyle = '#7fa79c';
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('STILL COMING', 268, FLOOR_Y + 24);

    for (let i = 0; i < Math.min(pending, 14); i++) {
        ctx.fillStyle = '#f0b52f';
        ctx.fillRect(268 + i * 12, FLOOR_Y + 32, 8, 10);
        ctx.fillStyle = '#fdf6e3';
        ctx.fillRect(268 + i * 12, FLOOR_Y + 30, 8, 3);
    }

    ctx.fillStyle = '#7fa79c';
    ctx.textAlign = 'right';
    ctx.fillText(`LEVEL ${level}`, CANVAS_W - 20, FLOOR_Y + 24);
    ctx.textAlign = 'left';
}

function draw() {
    drawRoom();
    for (let row = 0; row < ROWS; row++) drawCounter(row);
    drawBartender();

    for (const p of patrons) drawPatron(p);
    for (const m of mugs) drawMug(m.x, ROW_Y[m.row], true);
    for (const m of emptyMugs) drawMug(m.x, ROW_Y[m.row], false);

    for (const s of shards) {
        ctx.globalAlpha = Math.max(0, s.life / 0.6);
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    drawFloor();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const key = e.key;

    if (key === 'p' || key === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }

    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') pour();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        moveBartender(-1);
        e.preventDefault();
        return;
    }

    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        moveBartender(1);
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

try {
    best = parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
} catch (err) {
    best = 0;
}

state = 'idle';
pending = waveSize(level);
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
