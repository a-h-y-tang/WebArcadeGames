// Soda Tapper — four lanes of thirsty patrons, one pair of taps, three lives.
//
// Patrons walk in through the doorway on the left and head for the taps on the
// right. You slide full mugs down a lane to push them back out of the door, and
// catch the empties they send back. A mug that runs off either end of the bar
// smashes, and a patron that reaches the taps takes a life.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, patrons, mugs, server, ...) is kept at the
// top level on purpose: the Playwright suite drives the game through exactly
// these names. See DESIGN.md for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 560
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- geometry --------------------------------------------------------------

const LANE_COUNT = 4;
const LANE_TOP = 80;                 // y of the first lane's counter
const LANE_GAP = 120;                // vertical distance between lanes
const BAR_LEFT = 44;                 // doorway end of a counter
const TAP_X = 556;                   // the nozzle a fresh mug starts from
const SERVER_X = 598;                // where the server stands, behind the taps
const GRAB_X = TAP_X - 26;           // a patron this far along has you: 530
const CATCH_X = TAP_X - 48;          // an empty can be caught from here: 508
const SHATTER_X = TAP_X + 16;        // ...and smashes past here: 572
const COUNTER_HALF = 26;             // half-height of a counter band

const PATRON_HALF = 11;
const MUG_R = 9;
const HIT_DIST = 20;                 // mug-to-patron gap that counts as served

// --- speeds and timings ----------------------------------------------------

const MUG_SPEED = 185;               // px/s, a full mug sliding left
const EMPTY_SPEED = 150;             // px/s, an empty mug sliding back right
const PUSH_SPEED = 110;              // px/s, a drinking patron being pushed back
const PUSH_TIME = 0.75;              // seconds one mug keeps a patron drinking
const POUR_COOLDOWN = 0.25;          // seconds the tap needs between mugs

const PATRON_SPEED_BASE = 26;        // px/s on wave 1
const PATRON_SPEED_STEP = 5;         // px/s added per wave
const PATRON_SPEED_MAX = 70;

const SPAWN_BASE = 2.6;              // seconds between arrivals on wave 1
const SPAWN_STEP = 0.18;             // shaved off per wave
const SPAWN_MIN = 0.9;               // floor for the gap between arrivals
const SPAWN_JITTER = 0.6;            // random extra added to every gap
const FIRST_SPAWN = 0.8;             // grace period at the start of a wave

const QUOTA_BASE = 5;                // patrons in wave 1
const QUOTA_STEP = 2;                // more per wave
const QUOTA_MAX = 15;
const MAX_PER_LANE = 3;              // patrons allowed in one lane at once
const SPAWN_CLEARANCE = 30;          // keep the doorway clear by this much

const LIVES_START = 3;
const PATRON_POINTS = 150;           // serving a patron out of the door
const CATCH_POINTS = 25;             // catching an empty mug
const WAVE_BONUS = 200;              // × the wave just finished

const BEST_KEY = 'sodatapper-best';

const LANE_COLORS = ['#e4674a', '#6fd3c7', '#c58be6', '#8fc45a'];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | waveclear | gameover
let score = 0;
let lives = LIVES_START;
let wave = 1;
let best = loadBest();
let patrons = [];                    // { lane, x, state, pushTimer, owed }
let mugs = [];                       // { lane, x, dir, full }
let splashes = [];                   // short-lived smash/catch sparkles, cosmetic
let spawnTimer = 0;                  // seconds until the next arrival
let spawnedThisWave = 0;
let servedThisWave = 0;
let waveQuota = waveQuotaFor(1);
let pourCooldown = 0;
let autoRun = true;                  // the animation loop only simulates while true

const server = { lane: 1, bob: 0 };
const keys = Object.create(null);

// --- deterministic randomness ----------------------------------------------
//
// Everything random goes through rng() so a test can seed it and replay an
// identical wave. mulberry32 — small, fast, good enough for arcade jitter.

let rngState = 0x9e3779b9;

function seedRng(seed) {
    rngState = seed >>> 0;
}

function rng() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// --- helpers ---------------------------------------------------------------

function laneY(i) {
    return LANE_TOP + i * LANE_GAP;
}

function laneFromY(y) {
    const i = Math.round((y - LANE_TOP) / LANE_GAP);
    return Math.max(0, Math.min(LANE_COUNT - 1, i));
}

function patronSpeed(w) {
    return Math.min(PATRON_SPEED_MAX, PATRON_SPEED_BASE + PATRON_SPEED_STEP * (w - 1));
}

function waveQuotaFor(w) {
    return Math.min(QUOTA_MAX, QUOTA_BASE + QUOTA_STEP * (w - 1));
}

function spawnInterval() {
    const base = Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (wave - 1));
    return base + rng() * SPAWN_JITTER;
}

function patronsLeft() {
    return Math.max(0, waveQuota - spawnedThisWave) + patrons.length;
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
    } catch (e) {
        /* private browsing — the run just does not record a best */
    }
}

function splash(x, y, color) {
    splashes.push({ x, y, age: 0, life: 0.45, color });
}

// --- game flow -------------------------------------------------------------

function startGame() {
    score = 0;
    lives = LIVES_START;
    wave = 1;
    startWave();
}

function startWave() {
    waveQuota = waveQuotaFor(wave);
    spawnedThisWave = 0;
    servedThisWave = 0;
    spawnTimer = FIRST_SPAWN;
    pourCooldown = 0;
    patrons.length = 0;
    mugs.length = 0;
    splashes.length = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

// Space, a click, or the Start button all funnel through here: whatever the
// current state asks for next.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
            startGame();
            break;
        case 'waveclear':
            wave++;
            startWave();
            break;
        case 'running':
            pour();
            break;
        default:
            break;
    }
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

function moveServer(delta) {
    if (state !== 'running') return;
    server.lane = Math.max(0, Math.min(LANE_COUNT - 1, server.lane + delta));
}

function pour() {
    if (state !== 'running' || pourCooldown > 0) return false;
    mugs.push({ lane: server.lane, x: TAP_X, dir: -1, full: true });
    pourCooldown = POUR_COOLDOWN;
    return true;
}

function loseLife() {
    lives--;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Score ${score} · Wave ${wave}`, 'Press Space to open up again');
    }
    updateHud();
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;
    pourCooldown = Math.max(0, pourCooldown - dt);
    updateSpawning(dt);
    if (state !== 'running') return;
    updateMugs(dt);
    if (state !== 'running') return;
    updatePatrons(dt);
    updateSplashes(dt);
    if (state !== 'running') return;
    checkWave();
}

// A lane can take another arrival while it is under its patron limit and the
// doorway itself is clear, so patrons never spawn on top of each other.
function laneOpen(lane) {
    let count = 0;
    for (const p of patrons) {
        if (p.lane !== lane) continue;
        count++;
        if (p.x < BAR_LEFT + SPAWN_CLEARANCE) return false;
    }
    return count < MAX_PER_LANE;
}

function updateSpawning(dt) {
    if (spawnedThisWave >= waveQuota) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    const open = [];
    for (let i = 0; i < LANE_COUNT; i++) if (laneOpen(i)) open.push(i);
    if (!open.length) {
        spawnTimer = 0.4;            // the bar is packed; try again shortly
        return;
    }

    const lane = open[Math.min(open.length - 1, Math.floor(rng() * open.length))];
    patrons.push({ lane, x: BAR_LEFT, state: 'advancing', pushTimer: 0, owed: 0 });
    spawnedThisWave++;
    spawnTimer = spawnInterval();
    updateHud();
}

// The patron nearest the taps gets the mug — they are the one it reaches first.
function hitTarget(mug) {
    let nearest = null;
    for (const p of patrons) {
        if (p.lane !== mug.lane) continue;
        if (Math.abs(mug.x - p.x) > HIT_DIST) continue;
        if (!nearest || p.x > nearest.x) nearest = p;
    }
    return nearest;
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x += m.dir * (m.full ? MUG_SPEED : EMPTY_SPEED) * dt;

        if (m.full) {
            const target = hitTarget(m);
            if (target) {
                mugs.splice(i, 1);
                drink(target);
                continue;
            }
            if (m.x <= BAR_LEFT) {   // off the end and onto the floor
                mugs.splice(i, 1);
                splash(BAR_LEFT, laneY(m.lane), '#f4b63f');
                loseLife();
            }
        } else {
            if (m.x >= CATCH_X && server.lane === m.lane) {
                mugs.splice(i, 1);
                score += CATCH_POINTS;
                splash(m.x, laneY(m.lane) - 14, '#9fe8df');
                updateHud();
                continue;
            }
            if (m.x > SHATTER_X) {   // nobody there to take it
                mugs.splice(i, 1);
                splash(SHATTER_X, laneY(m.lane), '#dbe5ef');
                loseLife();
            }
        }
        if (state !== 'running') return;
    }
}

// A mug handed to a patron who is already drinking tops them up: it buys
// another push, but they still send back only the one empty.
function drink(patron) {
    patron.state = 'drinking';
    patron.pushTimer = PUSH_TIME;
    patron.owed = 1;
}

function returnEmpty(patron) {
    mugs.push({
        lane: patron.lane,
        x: Math.max(BAR_LEFT + 8, patron.x),
        dir: 1,
        full: false,
    });
}

function updatePatrons(dt) {
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];

        if (p.state === 'drinking') {
            p.x -= PUSH_SPEED * dt;
            p.pushTimer -= dt;
            if (p.x <= BAR_LEFT) {   // pushed out through the door: served
                patrons.splice(i, 1);
                score += PATRON_POINTS;
                servedThisWave++;
                if (p.owed) returnEmpty(p);
                splash(BAR_LEFT + 14, laneY(p.lane) - 16, '#ffd98a');
                updateHud();
                continue;
            }
            if (p.pushTimer <= 0) {
                p.state = 'advancing';
                if (p.owed) {
                    returnEmpty(p);
                    p.owed = 0;
                }
            }
        } else {
            p.x += patronSpeed(wave) * dt;
            if (p.x >= GRAB_X) {     // they made it to the taps
                patrons.splice(i, 1);
                splash(GRAB_X, laneY(p.lane) - 18, '#ff8c6b');
                loseLife();
                if (state !== 'running') return;
            }
        }
    }
}

function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.age += dt;
        if (s.age >= s.life) splashes.splice(i, 1);
    }
}

// A wave is over once the last arrival has been dealt with and the bar is clear
// of mugs — whether every patron was served or some of them got through.
function checkWave() {
    if (spawnedThisWave < waveQuota) return;
    if (patrons.length || mugs.length) return;
    score += WAVE_BONUS * wave;
    state = 'waveclear';
    updateHud();
    showOverlay(
        `WAVE ${wave} CLEARED`,
        `Score ${score} · Served ${servedThisWave}/${waveQuota}`,
        'Press Space for the next wave'
    );
}

// --- HUD and overlay -------------------------------------------------------

function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('wave').textContent = String(wave);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('left').textContent = String(patronsLeft());
    document.getElementById('best').textContent = String(Math.max(best, score));
}

function showOverlay(title, scoreLine, sub) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = scoreLine || '';
    document.getElementById('overlay-sub').textContent = sub || '';
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- rendering -------------------------------------------------------------

function drawBackground() {
    const room = ctx.createLinearGradient(0, 0, 0, H);
    room.addColorStop(0, '#22150a');
    room.addColorStop(0.6, '#150d06');
    room.addColorStop(1, '#0d0804');
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, W, H);

    // wall panelling behind the bar
    ctx.strokeStyle = 'rgba(255, 214, 150, 0.035)';
    ctx.lineWidth = 1;
    for (let x = 30; x < W; x += 60) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }
}

// The doorway patrons arrive through, and leave by: a lit opening with a frame.
function drawDoorway() {
    const glow = ctx.createLinearGradient(0, 0, BAR_LEFT + 26, 0);
    glow.addColorStop(0, '#ffd89a');
    glow.addColorStop(0.55, 'rgba(255, 190, 110, 0.32)');
    glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, BAR_LEFT + 26, H);

    // swing-door panels, so the left edge reads as a way in and out
    ctx.strokeStyle = 'rgba(90, 54, 20, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < LANE_COUNT; i++) {
        const top = laneY(i) + COUNTER_HALF - 14;
        ctx.strokeRect(4, top - 70, BAR_LEFT - 14, 62);
    }

    ctx.fillStyle = '#4a3016';
    ctx.fillRect(BAR_LEFT - 6, 0, 6, H);
    ctx.fillStyle = 'rgba(255, 226, 180, 0.35)';
    ctx.fillRect(BAR_LEFT - 6, 0, 2, H);
}

function drawCounters() {
    for (let i = 0; i < LANE_COUNT; i++) {
        const y = laneY(i);
        const top = y + COUNTER_HALF - 14;
        const left = BAR_LEFT - 12;
        const width = TAP_X + 12 - left;
        const live = i === server.lane && (state === 'running' || state === 'paused');

        // alcove: a touch of light behind the lane so the four read apart
        const alcove = ctx.createLinearGradient(0, top - 64, 0, top);
        alcove.addColorStop(0, live ? 'rgba(240, 169, 59, 0.10)' : 'rgba(255, 228, 184, 0.035)');
        alcove.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = alcove;
        ctx.fillRect(left, top - 64, width, 64);

        // counter front, then the top surface over it
        ctx.fillStyle = '#301c0b';
        ctx.fillRect(left, top + 14, width, 12);

        const wood = ctx.createLinearGradient(0, top, 0, top + 15);
        wood.addColorStop(0, '#b07a3c');
        wood.addColorStop(0.45, '#8a5a28');
        wood.addColorStop(1, '#5a3614');
        ctx.fillStyle = wood;
        ctx.fillRect(left, top, width, 15);

        ctx.fillStyle = 'rgba(255, 233, 190, 0.5)';   // polished lip
        ctx.fillRect(left, top, width, 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';        // shadow under the counter
        ctx.fillRect(left, top + 26, width, 4);

        ctx.fillStyle = live ? 'rgba(240, 169, 59, 0.85)' : 'rgba(176, 140, 94, 0.5)';
        ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`LANE ${i + 1}`, BAR_LEFT + 6, top - 56);
    }
}

function drawTaps() {
    // the post the taps hang off
    const post = ctx.createLinearGradient(TAP_X + 6, 0, W, 0);
    post.addColorStop(0, '#5d3c1b');
    post.addColorStop(0.35, '#3d2710');
    post.addColorStop(1, '#1d1207');
    ctx.fillStyle = post;
    ctx.fillRect(TAP_X + 6, 0, W - TAP_X - 6, H);
    ctx.fillStyle = 'rgba(255, 226, 180, 0.22)';
    ctx.fillRect(TAP_X + 6, 0, 2, H);

    // bottle shelf on the post between the lanes
    const bottleColors = ['#e4674a', '#6fd3c7', '#c58be6', '#8fc45a', '#f0a93b'];
    for (let i = 0; i < LANE_COUNT; i++) {
        const shelf = laneY(i) + COUNTER_HALF + 34;
        if (shelf > H - 40) continue;
        ctx.fillStyle = 'rgba(255, 226, 180, 0.18)';
        ctx.fillRect(TAP_X + 12, shelf, W - TAP_X - 20, 3);
        for (let b = 0; b < 4; b++) {
            ctx.fillStyle = bottleColors[(i * 3 + b) % bottleColors.length];
            ctx.globalAlpha = 0.55;
            ctx.fillRect(TAP_X + 18 + b * 16, shelf - 16, 7, 16);
            ctx.globalAlpha = 1;
        }
    }

    for (let i = 0; i < LANE_COUNT; i++) {
        const top = laneY(i) + COUNTER_HALF - 14;
        const live = i === server.lane;

        ctx.fillStyle = live ? '#f6c457' : '#9a7840';
        ctx.fillRect(TAP_X + 2, top - 40, 10, 8);       // bracket into the post
        ctx.fillRect(TAP_X - 3, top - 36, 7, 26);       // spout
        ctx.beginPath();
        ctx.arc(TAP_X + 0.5, top - 40, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = live ? 'rgba(255, 245, 215, 0.9)' : 'rgba(255, 240, 210, 0.3)';
        ctx.beginPath();
        ctx.arc(TAP_X - 1.5, top - 42, 2.5, 0, Math.PI * 2);   // highlight
        ctx.fill();

        if (live && state === 'running' && pourCooldown > 0) {
            ctx.fillStyle = 'rgba(246, 196, 87, 0.8)';
            ctx.fillRect(TAP_X - 1.5, top - 10, 4, 10);        // a last trickle
        }
    }
}

function drawPatron(p) {
    const y = laneY(p.lane);
    const top = y + COUNTER_HALF - 14;
    const drinking = p.state === 'drinking';
    const bob = drinking ? 0 : Math.sin(p.x * 0.22) * 1.6;
    const color = LANE_COLORS[p.lane];
    const feet = top + 2;

    // legs
    ctx.strokeStyle = '#6b4a24';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - 4, feet - 10);
    ctx.lineTo(p.x - 6 - bob, feet);
    ctx.moveTo(p.x + 4, feet - 10);
    ctx.lineTo(p.x + 6 + bob, feet);
    ctx.stroke();

    // body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(p.x - PATRON_HALF, feet - 34 + bob, PATRON_HALF * 2, 26, 5);
    ctx.fill();

    // head
    ctx.fillStyle = '#f2d4ad';
    ctx.beginPath();
    ctx.arc(p.x + (drinking ? -2 : 1), feet - 41 + bob, 8, 0, Math.PI * 2);
    ctx.fill();

    // a cap, so the crowd reads as a crowd even at a glance
    const capX = p.x + (drinking ? -2 : 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(capX, feet - 42 + bob, 8, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(capX - 9, feet - 43 + bob, 18, 2.5);

    if (drinking) {
        // tipped-back mug and a couple of happy bubbles
        ctx.fillStyle = '#f4b63f';
        ctx.beginPath();
        ctx.roundRect(p.x + 7, feet - 48 + bob, 10, 11, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        const phase = (PUSH_TIME - p.pushTimer) * 6;
        for (let b = 0; b < 2; b++) {
            const t = (phase + b * 0.5) % 1;
            ctx.beginPath();
            ctx.arc(p.x + 16, feet - 44 - t * 12 + bob, 2 - t, 0, Math.PI * 2);
            ctx.fill();
        }
    } else {
        // reaching for the taps
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x + PATRON_HALF - 2, feet - 28 + bob);
        ctx.lineTo(p.x + PATRON_HALF + 9, feet - 33 + bob);
        ctx.stroke();
    }
}

function drawMug(m) {
    const y = laneY(m.lane);
    const top = y + COUNTER_HALF - 14;
    const base = top - 2;

    ctx.save();
    ctx.translate(m.x, base);

    // glass
    ctx.fillStyle = m.full ? '#f4b63f' : 'rgba(216, 232, 248, 0.78)';
    ctx.beginPath();
    ctx.roundRect(-MUG_R, -16, MUG_R * 2, 16, 2);
    ctx.fill();
    ctx.strokeStyle = m.full ? '#fde9b5' : '#dceaf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-MUG_R, -16, MUG_R * 2, 16, 2);
    ctx.stroke();

    // handle
    ctx.beginPath();
    ctx.arc(MUG_R + 2, -8, 4, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    if (m.full) {
        ctx.fillStyle = '#fff6e0';
        ctx.beginPath();
        ctx.roundRect(-MUG_R - 1, -19, MUG_R * 2 + 2, 5, 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawServer() {
    const y = laneY(server.lane);
    const top = y + COUNTER_HALF - 14;
    const feet = top + 4;

    ctx.strokeStyle = '#2d1c0c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(SERVER_X - 4, feet - 12);
    ctx.lineTo(SERVER_X - 7, feet);
    ctx.moveTo(SERVER_X + 4, feet - 12);
    ctx.lineTo(SERVER_X + 7, feet);
    ctx.stroke();

    ctx.fillStyle = '#f4ead7';                        // shirt
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 12, feet - 38, 24, 27, 5);
    ctx.fill();
    ctx.fillStyle = '#2e6f63';                        // apron
    ctx.beginPath();
    ctx.roundRect(SERVER_X - 10, feet - 26, 20, 15, 3);
    ctx.fill();
    ctx.fillStyle = '#f2d4ad';                        // head
    ctx.beginPath();
    ctx.arc(SERVER_X, feet - 46, 9, 0, Math.PI * 2);
    ctx.fill();

    // arm reaching over the counter toward the lane
    ctx.strokeStyle = '#f2d4ad';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(SERVER_X - 10, feet - 31);
    ctx.lineTo(SERVER_X - 24, feet - 24);
    ctx.stroke();
}

function drawSplashes() {
    for (const s of splashes) {
        const t = s.age / s.life;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 + t * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = s.color;
        for (let d = 0; d < 4; d++) {
            const a = (d / 4) * Math.PI * 2 + t * 2;
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(a) * (6 + t * 18), s.y + Math.sin(a) * (4 + t * 12), 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

// Bottom strip: lives as spare mugs, plus how far the wave has to go.
function drawFooter() {
    const y = H - 34;

    ctx.fillStyle = 'rgba(240, 169, 59, 0.6)';
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MUGS', 14, y);

    for (let i = 0; i < lives; i++) {
        const x = 62 + i * 20;
        ctx.fillStyle = '#f4b63f';
        ctx.beginPath();
        ctx.roundRect(x, y - 8, 11, 15, 2);
        ctx.fill();
        ctx.fillStyle = '#fff6e0';
        ctx.beginPath();
        ctx.roundRect(x - 1, y - 11, 13, 4, 2);
        ctx.fill();
    }

    const barW = 200;
    const barX = W - barW - 24;
    const done = waveQuota ? Math.min(1, servedThisWave / waveQuota) : 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.roundRect(barX, y - 6, barW, 11, 5);
    ctx.fill();
    ctx.fillStyle = '#6fd3c7';
    ctx.beginPath();
    ctx.roundRect(barX, y - 6, Math.max(2, barW * done), 11, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(244, 234, 215, 0.75)';
    ctx.textAlign = 'right';
    ctx.fillText(`WAVE ${wave} — SERVED ${servedThisWave}/${waveQuota}`, barX - 10, y);
}

function draw() {
    drawBackground();
    drawDoorway();
    drawCounters();
    drawTaps();
    for (const m of mugs) drawMug(m);
    for (const p of patrons) drawPatron(p);
    drawServer();
    drawSplashes();
    drawFooter();
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            moveServer(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            moveServer(1);
            break;
        case 'KeyP':
            togglePause();
            break;
        default:
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    server.lane = laneFromY(e.clientY - rect.top);
});

canvas.addEventListener('click', () => advance());

// The overlay covers the canvas, so it takes the click when one is up. The
// Start button inside it already advances, so ignore the click it bubbles.
document.getElementById('overlay').addEventListener('click', (e) => {
    if (e.target.id !== 'btn-start') advance();
});

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

seedRng((Date.now() ^ 0x5bf03635) >>> 0);
updateHud();
draw();
requestAnimationFrame(frame);
