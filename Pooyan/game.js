// ---------------------------------------------------------------------------
// Pooyan — a mother pig defends her house from balloon-riding wolves.
//
// The pig rides a basket up and down a rope on the right of the screen and
// fires arrows to the left. Pop a wolf's balloon and it drops out of the sky;
// let one drift all the way across and it reaches the house, which costs a
// life. Wolves throw rocks back, and once per wave a joint of meat floats
// past — shoot it and it falls, sweeping every wolf beneath it.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Kaboom! and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Canvas --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;
const GROUND_Y = 452;

// --- Basket (the player) -------------------------------------------------
const BASKET_X = 598;      // centre; the basket never moves horizontally
const BASKET_W = 44;
const BASKET_H = 48;
const BASKET_MIN_Y = 72;
const BASKET_MAX_Y = 408;
const BASKET_SPEED = 185;  // px/s
const BASKET_START_Y = (BASKET_MIN_Y + BASKET_MAX_Y) / 2;

// --- Arrows --------------------------------------------------------------
const ARROW_SPEED = 460;   // px/s, travelling left
const ARROW_MAX = 3;       // in flight at once
const ARROW_W = 26;
const ARROW_H = 4;

// --- Wolves --------------------------------------------------------------
const WOLF_W = 36;
const WOLF_H = 58;         // balloon + string + body
const WOLF_BASE_SPEED = 34;
const WOLF_SPEED_STEP = 7;
const WOLF_SPEED_CAP = 92;
const WOLF_MIN_Y = 76;
const WOLF_MAX_Y = 396;
const WOLF_SPAWN_X = -WOLF_W;
// Reaching the basket column and reaching the house are the same event.
const ESCAPE_X = BASKET_X - BASKET_W / 2;

// --- Rocks ---------------------------------------------------------------
const ROCK_SPEED = 235;    // px/s, travelling right
const ROCK_R = 7;
const ROCK_THROW_MIN = 2.4;
const ROCK_THROW_MAX = 4.4;
const ROCK_THROW_X = 90;   // wolves only start throwing once they are on screen

// --- Meat ----------------------------------------------------------------
const MEAT_W = 46;
const MEAT_H = 24;
const MEAT_SWEEP_W = 74;   // the falling joint clears a wider column than it draws
const MEAT_DRIFT = 52;     // px/s while floating
const MEAT_FALL_SPEED = 260;
const MEAT_Y = 236;

// --- Waves ---------------------------------------------------------------
const QUOTA_BASE = 8;
const QUOTA_STEP = 2;
const QUOTA_CAP = 20;
const SPAWN_BASE = 2.6, SPAWN_STEP = 0.15, SPAWN_MIN = 1.2;
const FIRST_SPAWN = 1.4;

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const DEATH_PAUSE = 1.3;
const CLEAR_PAUSE = 1.8;

// --- Scoring -------------------------------------------------------------
const POP_POINTS = 100;
const ROCK_POINTS = 25;
const MEAT_KILL_POINTS = 200;
const LEVEL_BONUS = 500;

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const wolvesEl = document.getElementById('wolves');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state, score, best, lives, level;
let basket, wolves, arrows, rocks, meat;
let spawned, resolved, spawnTimer, meatReleased;
let deathTimer, clearTimer;
let spawnEnabled = true;   // test seam: stop new wolves entering
let rockEnabled = true;    // test seam: stop wolves throwing

// ---------------------------------------------------------------------------
// Seeded randomness — a test can call srand(n) for a repeatable wave.
// ---------------------------------------------------------------------------

let rngSeed = 1;

function srand(seed) {
    rngSeed = (seed >>> 0) || 1;
}

function rand() {
    // Park–Miller style LCG; good enough for spawn jitter and fully repeatable.
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

const randRange = (lo, hi) => lo + rand() * (hi - lo);

// ---------------------------------------------------------------------------
// Geometry helpers — every entity is stored by its centre.
// ---------------------------------------------------------------------------

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return (
        Math.abs(ax - bx) * 2 < aw + bw &&
        Math.abs(ay - by) * 2 < ah + bh
    );
}

const wolfHits = (w, x, y, hw, hh) => overlaps(w.x, w.y, WOLF_W, WOLF_H, x, y, hw, hh);

// ---------------------------------------------------------------------------
// Wave setup
// ---------------------------------------------------------------------------

function quotaFor(lvl) {
    return Math.min(QUOTA_CAP, QUOTA_BASE + (lvl - 1) * QUOTA_STEP);
}

function wolfSpeedFor(lvl) {
    return Math.min(WOLF_SPEED_CAP, WOLF_BASE_SPEED + (lvl - 1) * WOLF_SPEED_STEP);
}

function spawnIntervalFor(lvl) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (lvl - 1) * SPAWN_STEP);
}

// Exposed so tests (and the spawner) can place a wolf exactly where they want.
function spawnWolf(y, x = WOLF_SPAWN_X) {
    const wolf = {
        x,
        y,
        speed: wolfSpeedFor(level),
        throwTimer: randRange(ROCK_THROW_MIN, ROCK_THROW_MAX),
    };
    wolves.push(wolf);
    return wolf;
}

function startLevel() {
    wolves = [];
    arrows = [];
    rocks = [];
    meat = null;
    spawned = 0;
    resolved = 0;
    meatReleased = false;
    spawnTimer = FIRST_SPAWN;
    basket.y = BASKET_START_Y;
    basket.dir = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    basket = { x: BASKET_X, y: BASKET_START_Y, dir: 0 };
    startLevel();
    deathTimer = 0;
    clearTimer = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function shoot() {
    if (state !== 'running') return;
    if (arrows.length >= ARROW_MAX) return;
    arrows.push({ x: BASKET_X - BASKET_W / 2 - ARROW_W / 2, y: basket.y });
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or Enter to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Losing a life — the only path that decrements `lives`.
//
// It always clears the field, counting the wolves it removes towards the wave
// quota, so a wave can always be finished after a death.
// ---------------------------------------------------------------------------

function loseLife() {
    resolved += wolves.length;
    wolves = [];
    rocks = [];
    arrows = [];
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        state = 'dying';
        deathTimer = DEATH_PAUSE;
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('pooyan-best', String(best));
        } catch (e) {
            /* private browsing — the run still plays, the best just isn't kept */
        }
    }
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
    updateHud();
}

function clearLevel() {
    score += LEVEL_BONUS;
    state = 'levelclear';
    clearTimer = CLEAR_PAUSE;
    showOverlay(`WAVE ${level} CLEAR`, `Score ${score}`, 'Next wave incoming…');
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            basket.y = BASKET_START_Y;
            basket.dir = 0;
            state = 'running';
            hideOverlay();
        }
        return;
    }

    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level += 1;
            startLevel();
            state = 'running';
            hideOverlay();
            updateHud();
        }
        return;
    }

    if (state !== 'running') return;

    moveBasket(dt);
    moveArrows(dt);

    // A wolf reaching the house or a rock hitting the basket ends the life
    // mid-frame; the rest of the frame belongs to the next state, not this one.
    moveWolves(dt);
    if (state !== 'running') return;
    moveRocks(dt);
    if (state !== 'running') return;

    moveMeat(dt);
    resolveArrowHits();
    spawnWave(dt);

    if (resolved >= quotaFor(level) && wolves.length === 0) clearLevel();

    updateHud();
}

function moveBasket(dt) {
    basket.y += basket.dir * BASKET_SPEED * dt;
    basket.y = Math.max(BASKET_MIN_Y, Math.min(BASKET_MAX_Y, basket.y));
}

function moveArrows(dt) {
    for (const arrow of arrows) arrow.x -= ARROW_SPEED * dt;
    arrows = arrows.filter((a) => a.x + ARROW_W / 2 > 0);
}

function moveWolves(dt) {
    for (const wolf of wolves) {
        wolf.x += wolf.speed * dt;
        if (!rockEnabled || wolf.x < ROCK_THROW_X) continue;
        wolf.throwTimer -= dt;
        if (wolf.throwTimer <= 0) {
            wolf.throwTimer = randRange(ROCK_THROW_MIN, ROCK_THROW_MAX);
            rocks.push({ x: wolf.x + WOLF_W / 2, y: wolf.y + 6, r: ROCK_R });
        }
    }

    // A wolf reaching the house ends the life immediately; loseLife() clears
    // the rest of the sky, so there is nothing left to iterate afterwards.
    if (wolves.some((w) => w.x + WOLF_W / 2 >= ESCAPE_X)) loseLife();
}

function moveRocks(dt) {
    for (const rock of rocks) rock.x += ROCK_SPEED * dt;
    const hit = rocks.some((r) =>
        overlaps(r.x, r.y, r.r * 2, r.r * 2, BASKET_X, basket.y, BASKET_W, BASKET_H)
    );
    rocks = rocks.filter((r) => r.x - r.r <= CANVAS_W);
    if (hit) loseLife();
}

function moveMeat(dt) {
    if (!meat) return;
    if (meat.falling) {
        meat.y += MEAT_FALL_SPEED * dt;
        const survivors = [];
        for (const wolf of wolves) {
            if (wolfHits(wolf, meat.x, meat.y, MEAT_SWEEP_W, MEAT_H)) {
                score += MEAT_KILL_POINTS;
                resolved += 1;
            } else {
                survivors.push(wolf);
            }
        }
        wolves = survivors;
        if (meat.y - MEAT_H / 2 > CANVAS_H) meat = null;
    } else {
        meat.x += MEAT_DRIFT * dt;
        if (meat.x - MEAT_W / 2 > CANVAS_W) meat = null;
    }
}

// An arrow is consumed by the first thing it hits: wolf, then rock, then meat.
function resolveArrowHits() {
    const spent = new Set();

    for (const arrow of arrows) {
        const wolfIndex = wolves.findIndex((w) => wolfHits(w, arrow.x, arrow.y, ARROW_W, ARROW_H));
        if (wolfIndex !== -1) {
            wolves.splice(wolfIndex, 1);
            score += POP_POINTS;
            resolved += 1;
            spent.add(arrow);
            continue;
        }

        const rockIndex = rocks.findIndex((r) =>
            overlaps(r.x, r.y, r.r * 2, r.r * 2, arrow.x, arrow.y, ARROW_W, ARROW_H)
        );
        if (rockIndex !== -1) {
            rocks.splice(rockIndex, 1);
            score += ROCK_POINTS;
            spent.add(arrow);
            continue;
        }

        if (meat && !meat.falling && overlaps(meat.x, meat.y, MEAT_W, MEAT_H, arrow.x, arrow.y, ARROW_W, ARROW_H)) {
            meat.falling = true;
            spent.add(arrow);
        }
    }

    if (spent.size) arrows = arrows.filter((a) => !spent.has(a));
}

function spawnWave(dt) {
    if (!spawnEnabled) return;

    const quota = quotaFor(level);
    if (spawned < quota) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnWolf(Math.round(randRange(WOLF_MIN_Y, WOLF_MAX_Y)));
            spawned += 1;
            spawnTimer = spawnIntervalFor(level) * randRange(0.8, 1.2);
        }
    }

    // One joint of meat per wave, released at the halfway mark.
    if (!meatReleased && !meat && spawned >= Math.ceil(quota / 2)) {
        meat = { x: -MEAT_W, y: MEAT_Y, falling: false };
        meatReleased = true;
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    livesEl.textContent = lives;
    wolvesEl.textContent = Math.max(0, quotaFor(level) - resolved);
    bestEl.textContent = Math.max(best, score);
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
// Rendering — every sprite is drawn from canvas primitives, so the game runs
// straight from file:// with no assets to load.
// ---------------------------------------------------------------------------

function draw() {
    drawSky();
    drawScenery();
    if (meat) drawMeat(meat);
    for (const wolf of wolves) drawWolf(wolf);
    for (const rock of rocks) drawRock(rock);
    for (const arrow of arrows) drawArrow(arrow);
    drawBasket();
    drawBanner();
}

function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0, '#123249');
    sky.addColorStop(0.55, '#1d4c63');
    sky.addColorStop(1, '#2b6b6f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    for (let i = 0; i < 5; i++) {
        const cx = 60 + i * 140;
        const cy = 60 + ((i * 53) % 90);
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.arc(cx + 26, cy + 6, 20, 0, Math.PI * 2);
        ctx.arc(cx - 24, cy + 8, 17, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawScenery() {
    // Hills behind the play area.
    ctx.fillStyle = '#1b4a45';
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= CANVAS_W; x += 40) {
        ctx.lineTo(x, GROUND_Y - 30 - 18 * Math.sin(x / 70));
    }
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.lineTo(0, CANVAS_H);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#20614f';
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

    // The wolves' tree on the left.
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(16, 300, 18, GROUND_Y - 300);
    ctx.fillStyle = '#2f7a4f';
    ctx.beginPath();
    ctx.arc(25, 288, 42, 0, Math.PI * 2);
    ctx.fill();

    // The mast and rope the basket rides on. Drawn first, so the house below
    // covers the bottom of the rope and the rope reads as anchored to it.
    const houseLeft = BASKET_X - 44;
    const houseTop = 376;
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(BASKET_X - 40, 36, 80, 10);
    ctx.fillRect(BASKET_X - 5, 40, 10, 26);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(BASKET_X, 46);
    ctx.lineTo(BASKET_X, GROUND_Y);
    ctx.stroke();

    // The pig's house at the bottom right.
    ctx.fillStyle = '#5d4630';
    ctx.beginPath();
    ctx.moveTo(houseLeft - 14, houseTop);
    ctx.lineTo(BASKET_X + 6, houseTop - 34);
    ctx.lineTo(CANVAS_W, houseTop);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2a4257';
    ctx.fillRect(houseLeft, houseTop, CANVAS_W - houseLeft, GROUND_Y - houseTop);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(houseLeft + 10, houseTop + 16, 16, 14);
    ctx.fillStyle = '#3d2b1c';
    ctx.fillRect(houseLeft + 42, houseTop + 20, 20, GROUND_Y - houseTop - 20);
}

function drawWolf(wolf) {
    const top = wolf.y - WOLF_H / 2;

    // Balloon.
    ctx.fillStyle = '#e05a4a';
    ctx.beginPath();
    ctx.ellipse(wolf.x, top + 15, 15, 17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(wolf.x - 5, top + 9, 4, 6, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // String.
    ctx.strokeStyle = '#d8d8d8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wolf.x, top + 32);
    ctx.lineTo(wolf.x, top + 40);
    ctx.stroke();

    // Wolf — facing left, the way it is travelling to reach the house.
    const bodyY = top + 40;
    ctx.fillStyle = '#6f7b8c';
    ctx.fillRect(wolf.x - 12, bodyY + 2, 24, 14);      // body
    ctx.fillRect(wolf.x - 9, bodyY + 14, 4, 5);        // legs
    ctx.fillRect(wolf.x + 3, bodyY + 14, 4, 5);
    ctx.fillStyle = '#59657a';
    ctx.beginPath();                                    // tail
    ctx.moveTo(wolf.x + 11, bodyY + 4);
    ctx.lineTo(wolf.x + 19, bodyY - 2);
    ctx.lineTo(wolf.x + 12, bodyY + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7e8b9d';
    ctx.fillRect(wolf.x - 17, bodyY, 10, 11);          // head
    ctx.fillStyle = '#59657a';
    ctx.beginPath();                                    // ear
    ctx.moveTo(wolf.x - 15, bodyY);
    ctx.lineTo(wolf.x - 12, bodyY - 6);
    ctx.lineTo(wolf.x - 8, bodyY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a4252';
    ctx.fillRect(wolf.x - 22, bodyY + 5, 6, 4);        // snout
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(wolf.x - 14, bodyY + 3, 3, 3);        // eye
}

function drawRock(rock) {
    ctx.fillStyle = '#9aa3ad';
    ctx.beginPath();
    ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(rock.x + 2, rock.y + 2, rock.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
}

function drawArrow(arrow) {
    ctx.fillStyle = '#f3e7d8';
    ctx.fillRect(arrow.x - ARROW_W / 2, arrow.y - ARROW_H / 2, ARROW_W, ARROW_H);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(arrow.x - ARROW_W / 2 - 7, arrow.y);
    ctx.lineTo(arrow.x - ARROW_W / 2, arrow.y - 5);
    ctx.lineTo(arrow.x - ARROW_W / 2, arrow.y + 5);
    ctx.closePath();
    ctx.fill();
}

function drawMeat(m) {
    ctx.fillStyle = '#b5533c';
    ctx.fillRect(m.x - MEAT_W / 2, m.y - MEAT_H / 2, MEAT_W, MEAT_H);
    ctx.fillStyle = '#f0d9b5';
    ctx.beginPath();
    ctx.arc(m.x + MEAT_W / 2, m.y, MEAT_H / 2, 0, Math.PI * 2);
    ctx.fill();
    if (m.falling) {
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(m.x - MEAT_SWEEP_W / 2, m.y - MEAT_H / 2, MEAT_SWEEP_W, MEAT_H);
    }
}

function drawBasket() {
    if (!basket) return;
    const left = BASKET_X - BASKET_W / 2;
    const top = basket.y - BASKET_H / 2;

    // Basket.
    ctx.fillStyle = '#a9772f';
    ctx.fillRect(left, top + 20, BASKET_W, BASKET_H - 20);
    ctx.strokeStyle = '#6f4d1d';
    ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(left, top + 20 + i * 9);
        ctx.lineTo(left + BASKET_W, top + 20 + i * 9);
        ctx.stroke();
    }

    // Pig.
    ctx.fillStyle = '#f2a6b8';
    ctx.beginPath();
    ctx.arc(BASKET_X - 2, top + 14, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e08aa0';
    ctx.beginPath();
    ctx.ellipse(BASKET_X - 12, top + 15, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d22';
    ctx.fillRect(BASKET_X - 6, top + 10, 3, 3);
    ctx.fillRect(BASKET_X + 2, top + 10, 3, 3);
}

function drawBanner() {
    if (state !== 'running' && state !== 'dying') return;
    ctx.fillStyle = 'rgba(232, 242, 247, 0.5)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`WAVE ${level}`, 12, 22);
    if (state === 'dying') {
        ctx.fillStyle = '#ef5b4c';
        ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('OUCH!', CANVAS_W / 2, CANVAS_H / 2);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...UP_KEYS, ...DOWN_KEYS];

function refreshDir() {
    const held = (keys) => keys.some((k) => heldKeys.has(k));
    basket.dir = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
        return;
    }
    if (e.key === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (state === 'running') shoot();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshDir();
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

best = parseInt(localStorage.getItem('pooyan-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
level = 1;
basket = { x: BASKET_X, y: BASKET_START_Y, dir: 0 };
startLevel();
deathTimer = 0;
clearTimer = 0;
srand(Date.now() % 2147483647);
updateHud();
showOverlay('POOYAN', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
