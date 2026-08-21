// ---------------------------------------------------------------------------
// Tapper — a four-counter soda fountain on an HTML5 canvas.
//
// Patrons push in through the door at the far end of each counter and shuffle
// toward the taps. Slide a full mug down the counter and whoever catches it is
// knocked back a few paces while they drink; knock a patron all the way back
// out of the door and they leave happy. Every mug caught comes sliding back as
// an empty, and an empty that reaches the taps un-caught shatters on the floor.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris
// and BurgerTime in this repo. All motion is expressed per-second and advanced
// through `step(dt)`, so the tests can simulate frames deterministically —
// setting `autoStep = false` detaches the animation loop's own call to `step`
// and leaves the tests in sole control of the clock.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- Layout --------------------------------------------------------------
const CANVAS_W = 560;
const CANVAS_H = 440;

const LANES = 4;
const LANE_TOP = 80;
const LANE_SPACING = 96;
// The y of each counter's top surface: everything on a counter rests on it.
const LANE_Y = Array.from({ length: LANES }, (_, i) => LANE_TOP + i * LANE_SPACING);

const COUNTER_LEFT = 40;    // the doorway end
const COUNTER_RIGHT = 496;  // the tap end
const SPAWN_X = COUNTER_LEFT;
const EXIT_X = COUNTER_LEFT;
const SERVE_X = COUNTER_RIGHT;
const GRAB_X = 470;         // a patron this far along grabs the soda jerk
const CATCH_X = 486;        // where a returning empty is caught or smashed
const PLAYER_X = 528;

const COUNTER_H = 16;       // drawn thickness of a counter slab
const FLOOR_Y = 400;        // decorative tiled floor below the bottom counter

// --- Speeds --------------------------------------------------------------
const MUG_SPEED = 220;      // px/s, full mug sliding toward the door
const EMPTY_SPEED = 170;    // px/s, empty mug sliding back toward the taps
const PUSH_SPEED = 210;     // px/s, a patron reeling back after a catch
const PATRON_BASE_SPEED = 26;
const PATRON_SPEED_STEP = 5;
const PATRON_MAX_SPEED = 60;

const PUSH_DIST = 96;       // how far one mug knocks a patron back
const DRINK_TIME = 1;       // seconds a knocked-back patron stands and drinks
const SERVE_COOLDOWN = 0.22;
const HIT_R = 15;           // mug/patron contact distance
const LANE_EASE = 14;       // how fast the drawn player catches up to its lane

// --- Rules ---------------------------------------------------------------
const START_LIVES = 3;
const MAX_PER_LANE = 3;
const RESPAWN_DELAY = 0.8;  // pause after losing a life
const FIRST_SPAWN = 1.5;
const SPAWN_BASE = 3.2;
const SPAWN_STEP = 0.25;
const SPAWN_MIN = 1.2;
const SPAWN_JITTER = 0.6;
const BANNER_TIME = 1.4;

const MUG_SCORE = 50;       // a patron catches a mug
const SERVE_SCORE = 200;    // a patron is pushed out of the door
const EMPTY_SCORE = 25;     // an empty mug is caught
const LEVEL_BONUS = 500;    // a shift is cleared

const targetFor = (n) => 4 + n * 2;

// --- State ---------------------------------------------------------------
let state = 'idle';         // idle | running | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;             // patrons served this shift
let spawned = 0;            // patrons that have arrived this shift
let levelTarget = targetFor(1);

let spawnEnabled = true;    // random arrivals (tests switch this off)
let autoStep = true;        // the rAF loop drives step() (tests switch this off)
let spawnTimer = FIRST_SPAWN;
let serveCooldown = 0;
let respawnDelay = 0;

let player = { lane: 0, y: LANE_Y[0], pour: 0, bob: 0 };
let patrons = [];
let mugs = [];
let empties = [];
let shards = [];
let floats = [];
let banner = null;

const PATRON_COLORS = ['#e35d6a', '#4fa3d1', '#63c07a', '#c48cdd', '#e0a34b'];
const PATRON_SKIN = ['#f0c39a', '#d39a6a', '#a9703f', '#6d452a'];

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const servedEl = document.getElementById('served');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    servedEl.textContent = `${served}/${levelTarget}`;
    livesEl.textContent = String(lives);
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

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const laneCount = (lane) => patrons.reduce((n, p) => n + (p.lane === lane ? 1 : 0), 0);

function patronSpeed() {
    return Math.min(PATRON_MAX_SPEED, PATRON_BASE_SPEED + (level - 1) * PATRON_SPEED_STEP);
}

function spawnInterval() {
    const base = Math.max(SPAWN_MIN, SPAWN_BASE - level * SPAWN_STEP);
    return base + Math.random() * SPAWN_JITTER;
}

// Returns the new patron, or null when the counter is already full.
function spawnPatron(lane) {
    if (laneCount(lane) >= MAX_PER_LANE) return null;
    const p = {
        lane,
        x: SPAWN_X,
        mode: 'walk',       // walk | slide | drink
        target: SPAWN_X,
        timer: 0,
        sips: 0,
        bob: Math.random() * Math.PI * 2,
        color: PATRON_COLORS[Math.floor(Math.random() * PATRON_COLORS.length)],
        skin: PATRON_SKIN[Math.floor(Math.random() * PATRON_SKIN.length)],
    };
    patrons.push(p);
    spawned++;
    return p;
}

function spawnEmpty(lane, x) {
    const e = { lane, x, t: 0 };
    empties.push(e);
    return e;
}

// Pour a mug on the player's counter. False when the game isn't accepting one.
function serve() {
    if (state !== 'running' || respawnDelay > 0 || serveCooldown > 0) return false;
    mugs.push({ lane: player.lane, x: SERVE_X, t: 0 });
    serveCooldown = SERVE_COOLDOWN;
    player.pour = 0.18;
    return true;
}

function addFloat(lane, x, text) {
    floats.push({ x, y: LANE_Y[lane] - 26, text, life: 0.9 });
}

function smash(lane, x) {
    for (let i = 0; i < 12; i++) {
        shards.push({
            x,
            y: LANE_Y[lane] - 8,
            vx: (Math.random() - 0.5) * 180,
            vy: -60 - Math.random() * 140,
            life: 0.6 + Math.random() * 0.3,
            color: Math.random() < 0.5 ? '#cfd8e6' : '#8fa2bd',
        });
    }
}

function sparkle(lane, x) {
    for (let i = 0; i < 8; i++) {
        shards.push({
            x,
            y: LANE_Y[lane] - 10,
            vx: (Math.random() - 0.5) * 90,
            vy: -40 - Math.random() * 90,
            life: 0.4 + Math.random() * 0.25,
            color: '#ffd36b',
        });
    }
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    spawned = 0;
    levelTarget = targetFor(level);
    patrons = [];
    mugs = [];
    empties = [];
    shards = [];
    floats = [];
    banner = null;
    player.lane = 0;
    player.y = LANE_Y[0];
    player.pour = 0;
    serveCooldown = 0;
    respawnDelay = 0;
    spawnTimer = FIRST_SPAWN;
    spawnEnabled = true;
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Enter to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// Every way of losing a life clears the bar: patrons that were cleared have not
// been served, so the shift's arrival counter is rolled back to let them come
// back later.
function loseLife() {
    lives--;
    spawned = Math.max(0, spawned - patrons.length);
    patrons = [];
    mugs = [];
    empties = [];
    serveCooldown = 0;
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    respawnDelay = RESPAWN_DELAY;
    banner = { text: 'OOPS!', color: '#ff5d73', life: BANNER_TIME };
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (e) {
            /* storage unavailable — the run just isn't remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to play again');
}

function nextLevel() {
    level++;
    score += LEVEL_BONUS;
    served = 0;
    spawned = 0;
    levelTarget = targetFor(level);
    spawnTimer = FIRST_SPAWN;
    banner = { text: `SHIFT ${level}`, color: '#ffc247', life: BANNER_TIME };
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function easePlayer(dt) {
    const target = LANE_Y[player.lane];
    player.y += (target - player.y) * Math.min(1, LANE_EASE * dt);
    player.pour = Math.max(0, player.pour - dt);
    player.bob += dt * 5;
}

// The first patron a mug meets: the right-most one on its counter that the mug
// has reached.
function mugTarget(mug) {
    let hit = null;
    for (const p of patrons) {
        if (p.lane !== mug.lane) continue;
        if (mug.x > p.x + HIT_R) continue;
        if (!hit || p.x > hit.x) hit = p;
    }
    return hit;
}

function catchMug(p) {
    score += MUG_SCORE;
    addFloat(p.lane, p.x, `+${MUG_SCORE}`);
    spawnEmpty(p.lane, p.x);
    sparkle(p.lane, p.x);
    p.sips++;
    // Knocking a patron who is already reeling adds to the distance travelled.
    const base = p.mode === 'slide' ? Math.min(p.target, p.x) : p.x;
    p.target = Math.max(EXIT_X, base - PUSH_DIST);
    p.mode = 'slide';
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;
        m.t += dt;
        const hit = mugTarget(m);
        if (hit) {
            mugs.splice(i, 1);
            catchMug(hit);
            continue;
        }
        if (m.x <= EXIT_X) {
            mugs.splice(i, 1);
            smash(m.lane, EXIT_X);
            loseLife();
            return;
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        e.t += dt;
        if (e.x < CATCH_X) continue;
        empties.splice(i, 1);
        if (player.lane === e.lane) {
            score += EMPTY_SCORE;
            addFloat(e.lane, CATCH_X - 20, `+${EMPTY_SCORE}`);
            sparkle(e.lane, CATCH_X - 10);
        } else {
            smash(e.lane, CATCH_X);
            loseLife();
            return;
        }
    }
}

function stepPatrons(dt) {
    const speed = patronSpeed();
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];
        p.bob += dt * 6;
        if (p.mode === 'walk') {
            p.x += speed * dt;
            if (p.x >= GRAB_X) {
                loseLife();
                return;
            }
        } else if (p.mode === 'slide') {
            p.x -= PUSH_SPEED * dt;
            if (p.x <= p.target) {
                p.x = p.target;
                if (p.x <= EXIT_X + 0.0001) {
                    patrons.splice(i, 1);
                    served++;
                    score += SERVE_SCORE;
                    addFloat(p.lane, EXIT_X + 24, `+${SERVE_SCORE}`);
                    continue;
                }
                p.mode = 'drink';
                p.timer = DRINK_TIME;
            }
        } else {
            p.timer -= dt;
            if (p.timer <= 0) p.mode = 'walk';
        }
    }
}

function stepSpawner(dt) {
    if (!spawnEnabled || spawned >= levelTarget) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    const open = [];
    for (let lane = 0; lane < LANES; lane++) {
        if (laneCount(lane) < MAX_PER_LANE) open.push(lane);
    }
    if (open.length) spawnPatron(open[Math.floor(Math.random() * open.length)]);
    spawnTimer = spawnInterval();
}

// A shift ends only when the quota is met and nothing is left on the bar — the
// last empty mug still has to make it home.
function checkShift() {
    if (served < levelTarget) return;
    if (patrons.length || mugs.length || empties.length) return;
    nextLevel();
}

function stepEffects(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.vy += 520 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= dt;
        if (f.life <= 0) floats.splice(i, 1);
        else f.y -= 26 * dt;
    }
    if (banner) {
        banner.life -= dt;
        if (banner.life <= 0) banner = null;
    }
}

function step(dt) {
    if (state !== 'running') return;

    if (respawnDelay > 0) {
        respawnDelay = Math.max(0, respawnDelay - dt);
        easePlayer(dt);
        stepEffects(dt);
        updateHud();
        return;
    }

    serveCooldown = Math.max(0, serveCooldown - dt);
    easePlayer(dt);

    stepMugs(dt);
    if (state !== 'running' || respawnDelay > 0) { stepEffects(dt); updateHud(); return; }

    stepEmpties(dt);
    if (state !== 'running' || respawnDelay > 0) { stepEffects(dt); updateHud(); return; }

    stepPatrons(dt);
    if (state !== 'running' || respawnDelay > 0) { stepEffects(dt); updateHud(); return; }

    stepSpawner(dt);
    checkShift();
    stepEffects(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Darken (amount < 0) or lighten a #rrggbb colour, for hats and shading.
function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) =>
        Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `rgb(${r}, ${g}, ${b})`;
}

function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#241a44');
    g.addColorStop(1, '#120d24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Tiled back wall behind the counters.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, FLOOR_Y);
        ctx.stroke();
    }
    for (let y = 0; y <= FLOOR_Y; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(CANVAS_W, y + 0.5);
        ctx.stroke();
    }

    // Tiled floor below the bottom counter, where dropped mugs land.
    const f = ctx.createLinearGradient(0, FLOOR_Y, 0, CANVAS_H);
    f.addColorStop(0, '#2c2350');
    f.addColorStop(1, '#181234');
    ctx.fillStyle = f;
    ctx.fillRect(0, FLOOR_Y, CANVAS_W, CANVAS_H - FLOOR_Y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    for (let x = 0; x < CANVAS_W; x += 40) {
        for (let y = FLOOR_Y; y < CANVAS_H; y += 20) {
            if (((x / 40) + (y / 20)) % 2 === 0) ctx.fillRect(x, y, 40, 20);
        }
    }
    ctx.fillStyle = 'rgba(255, 194, 71, 0.18)';
    ctx.fillRect(0, FLOOR_Y - 2, CANVAS_W, 2);
}

// A soft contact shadow so figures and mugs read as standing on the counter
// rather than floating above it.
function drawShadow(x, y, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 1, w, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawCounter(lane) {
    const y = LANE_Y[lane];
    const left = COUNTER_LEFT - 18;
    const w = COUNTER_RIGHT + 46 - left;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    const g = ctx.createLinearGradient(0, y, 0, y + COUNTER_H);
    g.addColorStop(0, '#a3703c');
    g.addColorStop(0.35, '#7d4f24');
    g.addColorStop(1, '#4c2e14');
    ctx.fillStyle = g;
    roundRect(left, y, w, COUNTER_H, 4);
    ctx.fill();
    ctx.restore();

    // Polished top surface.
    ctx.fillStyle = 'rgba(255, 226, 178, 0.35)';
    ctx.fillRect(left, y, w, 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(left, y + COUNTER_H - 3, w, 3);

    // Grain.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    for (let x = left + 12; x < left + w; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, y + 5);
        ctx.lineTo(x + 10, y + COUNTER_H - 4);
        ctx.stroke();
    }
}

function drawDoor(lane) {
    const y = LANE_Y[lane];
    ctx.fillStyle = '#0e0a1c';
    roundRect(2, y - 46, 34, 46, 6);
    ctx.fill();
    ctx.strokeStyle = '#4a3a7a';
    ctx.lineWidth = 2;
    roundRect(2, y - 46, 34, 46, 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120, 100, 190, 0.25)';
    ctx.fillRect(8, y - 38, 22, 16);
}

function drawTaps(lane) {
    const y = LANE_Y[lane];
    const x = COUNTER_RIGHT + 8;

    // Chrome tower.
    const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
    g.addColorStop(0, '#7c8798');
    g.addColorStop(0.4, '#e2e9f2');
    g.addColorStop(1, '#68717f');
    ctx.fillStyle = g;
    roundRect(x - 7, y - 44, 14, 44, 3);
    ctx.fill();

    // Spout and handle.
    ctx.fillStyle = '#b9c4d2';
    ctx.fillRect(x - 16, y - 22, 10, 5);
    ctx.fillStyle = '#ffc247';
    roundRect(x - 4, y - 54, 8, 12, 3);
    ctx.fill();
}

function drawMugBody(x, y, full, alpha, shadow = true) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shadow) drawShadow(x, y, 11);
    // Handle.
    ctx.strokeStyle = full ? '#c98f36' : '#6d7789';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + 10, y - 10, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    // Glass.
    const g = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
    if (full) {
        g.addColorStop(0, '#c1802f');
        g.addColorStop(0.45, '#f0b657');
        g.addColorStop(1, '#a76c25');
    } else {
        g.addColorStop(0, '#5d6779');
        g.addColorStop(0.45, '#9dabbf');
        g.addColorStop(1, '#525c6d');
    }
    ctx.fillStyle = g;
    roundRect(x - 8, y - 18, 16, 18, 3);
    ctx.fill();
    if (full) {
        ctx.fillStyle = '#fff6e2';
        roundRect(x - 8, y - 22, 16, 7, 3);
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    roundRect(x - 8, y - 18, 16, 18, 3);
    ctx.stroke();
    ctx.restore();
}

function drawMugs() {
    for (const m of mugs) {
        const y = LANE_Y[m.lane];
        const wobble = Math.sin(m.t * 22) * 1.2;
        drawMugBody(m.x, y + wobble, true, 1);
    }
    for (const e of empties) {
        const y = LANE_Y[e.lane];
        const wobble = Math.sin(e.t * 26) * 1.6;
        drawMugBody(e.x, y + wobble, false, 0.92);
    }
}

function drawPatron(p) {
    const y = LANE_Y[p.lane];
    const bob = p.mode === 'walk' ? Math.sin(p.bob) * 1.5 : 0;
    const lean = p.mode === 'slide' ? 6 : 0;
    const x = p.x;

    ctx.save();
    ctx.translate(x + lean, y + bob);
    drawShadow(0, -bob, 13);

    // Legs — kept light enough to stay visible against the dark wall.
    const stride = p.mode === 'walk' ? Math.sin(p.bob) * 2 : 0;
    ctx.fillStyle = '#6b5fa8';
    ctx.fillRect(-8 - stride, -13, 6, 13);
    ctx.fillRect(2 + stride, -13, 6, 13);
    ctx.fillStyle = '#2a2246';
    ctx.fillRect(-9 - stride, -3, 8, 3);
    ctx.fillRect(1 + stride, -3, 8, 3);

    // Body.
    ctx.fillStyle = p.color;
    roundRect(-11, -33, 22, 22, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    roundRect(-11, -18, 22, 7, 3);
    ctx.fill();

    // Arm — reaching ahead while walking, tucked in while drinking.
    ctx.fillStyle = p.skin;
    if (p.mode === 'drink') ctx.fillRect(-16, -29, 8, 5);
    else ctx.fillRect(6, -29, 11, 5);

    // Head.
    ctx.beginPath();
    ctx.arc(0, -41, 9, 0, Math.PI * 2);
    ctx.fill();

    // Cap, so patrons read at a glance against the wall.
    ctx.fillStyle = shade(p.color, -0.35);
    ctx.fillRect(-11, -47, 20, 3);
    roundRect(-8, -55, 16, 9, 3);
    ctx.fill();

    // Thirst pips: one per mug already drunk.
    ctx.fillStyle = '#ffe6a0';
    for (let i = 0; i < Math.min(p.sips, 3); i++) {
        ctx.fillRect(-9 + i * 7, -27, 4, 4);
    }

    if (p.mode === 'drink') drawMugBody(-20, 0, true, 1);
    ctx.restore();
}

function drawPlayer() {
    const y = player.y;
    const x = PLAYER_X;
    const bob = state === 'running' ? Math.sin(player.bob) * 1.2 : 0;

    ctx.save();
    ctx.translate(x, y + bob);
    drawShadow(0, -bob, 14);

    // Legs.
    ctx.fillStyle = '#5a86c9';
    ctx.fillRect(-8, -13, 6, 13);
    ctx.fillRect(2, -13, 6, 13);
    ctx.fillStyle = '#22203c';
    ctx.fillRect(-9, -3, 8, 3);
    ctx.fillRect(1, -3, 8, 3);

    // Apron / body.
    ctx.fillStyle = '#f4f1ff';
    roundRect(-11, -35, 22, 24, 5);
    ctx.fill();
    ctx.fillStyle = '#e05a6b';
    ctx.fillRect(-11, -23, 22, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    roundRect(-11, -17, 22, 6, 3);
    ctx.fill();

    // The pouring arm swings out to the taps just after a mug is served.
    ctx.fillStyle = '#f0c39a';
    if (player.pour > 0) ctx.fillRect(-20, -33, 12, 5);
    else ctx.fillRect(-16, -30, 8, 5);

    // Head and soda-jerk cap.
    ctx.beginPath();
    ctx.arc(0, -43, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f1ff';
    roundRect(-9, -55, 18, 9, 3);
    ctx.fill();
    ctx.fillStyle = '#e05a6b';
    ctx.fillRect(-10, -47, 20, 3);
    ctx.restore();
}

function drawEffects() {
    for (const s of shards) {
        ctx.globalAlpha = Math.max(0, Math.min(1, s.life * 2));
        ctx.fillStyle = s.color;
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    for (const f of floats) {
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
        ctx.fillStyle = '#ffe08a';
        ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
}

function drawBanner() {
    if (!banner) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, banner.life * 1.6));
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(banner.text, CANVAS_W / 2 + 2, CANVAS_H / 2 + 2);
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.restore();
}

function drawCooldownBar() {
    if (serveCooldown <= 0) return;
    const y = LANE_Y[player.lane] + COUNTER_H + 4;
    const w = 30 * (serveCooldown / SERVE_COOLDOWN);
    ctx.fillStyle = 'rgba(255, 194, 71, 0.55)';
    ctx.fillRect(PLAYER_X - 15, y, w, 3);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawBackground();

    for (let lane = 0; lane < LANES; lane++) {
        drawDoor(lane);
        drawCounter(lane);
    }

    // Patrons furthest along the counter are drawn last so they overlap
    // correctly as they bunch up near the taps.
    for (const p of [...patrons].sort((a, b) => a.x - b.x)) drawPatron(p);

    drawMugs();
    for (let lane = 0; lane < LANES; lane++) drawTaps(lane);
    drawPlayer();
    drawCooldownBar();
    drawEffects();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return;
    player.lane = Math.max(0, Math.min(LANES - 1, player.lane + delta));
}

window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'p' || k === 'P') {
        togglePause();
        e.preventDefault();
        return;
    }
    if (k === 'Enter') {
        if (state === 'paused') togglePause();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (k === ' ' || e.code === 'Space') {
        if (state === 'running') serve();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
        moveLane(-1);
        e.preventDefault();
        return;
    }
    if (k === 'ArrowDown' || k === 's' || k === 'S') {
        moveLane(1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// A tap or click on the canvas is a serve; the upper/lower edges change lanes,
// so the game is playable without a keyboard.
canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    const lane = LANE_Y.reduce(
        (bestLane, laneY, i) =>
            Math.abs(laneY - y) < Math.abs(LANE_Y[bestLane] - y) ? i : bestLane,
        0
    );
    if (lane !== player.lane) player.lane = lane;
    else serve();
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
    best = parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
} catch (e) {
    best = 0;
}
state = 'idle';
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
