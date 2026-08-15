// ---------------------------------------------------------------------------
// Soda Tapper — a lane-juggling arcade game on an HTML5 canvas.
//
// Four bars run left to right across the screen. Thirsty patrons come in at the
// far end and walk toward the tap; the bartender hops between bars and slides a
// mug of soda down whichever one they are standing at. A patron who catches a
// mug is pushed back down the bar while they drink, and once they are pushed
// clean off the end they are served and send their empty mug sliding back. The
// empty has to be collected at the tap or it smashes on the floor.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring BurgerTime,
// Snake and Tetris in this repo. All motion is expressed per second and applied
// in `step(dt)`, so tests can simulate frames deterministically without relying
// on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Layout --------------------------------------------------------------
const CANVAS_W = 640;
const CANVAS_H = 480;

const LANES = 4;
const BAR_LEFT = 48;          // the far end, where patrons come in
const BAR_RIGHT = 584;        // the tap end, where the bartender stands
const BAR_TOP = 96;
const BAR_SPACING = 96;
const BAR_Y = Array.from({ length: LANES }, (_, i) => BAR_TOP + i * BAR_SPACING);
const BAR_H = 12;             // thickness of the bar top
const BAR_FRONT = 20;         // the panelled front of the counter, below the top
const FEET_Y = BAR_H + 8;     // offset from the bar line down to standing feet

// --- Bartender -----------------------------------------------------------
const TENDER_X = BAR_RIGHT + 26;
const TENDER_HW = 16;
const TENDER_H = 58;
const SERVE_COOLDOWN = 0.18;  // seconds between pours

// --- Mugs ----------------------------------------------------------------
const MUG_HW = 9;
const MUG_H = 20;
const MUG_SPEED = 230;        // full mug, sliding away from the tap
const EMPTY_SPEED = 190;      // empty mug, sliding back toward the tap
const CATCH_ZONE = 64;        // an empty is collectable within this of the tap

// --- Patrons -------------------------------------------------------------
const PATRON_HW = 15;
const PATRON_H = 58;
const GRAB_X = BAR_RIGHT - PATRON_HW;  // a patron this far along grabs the bartender
const PATRON_SPEED_BASE = 26;
const PATRON_SPEED_STEP = 4.5;
const PATRON_SPEED_CAP = 64;           // always slower than a sliding mug
const PUSH_SPEED = 95;                 // how fast a drinker is pushed back
const DRINK_TIME = 1.2;
const QUEUE_GAP = 110;                 // room a new patron needs at the far end

// --- Rounds --------------------------------------------------------------
const WAVE_BASE = 6;
const WAVE_STEP = 1;
const WAVE_MAX = 14;
const SPAWN_BASE = 2.6;
const SPAWN_STEP = 0.18;
const SPAWN_MIN = 1.0;
const FIRST_SPAWN = 1.2;

// --- Scoring / flow ------------------------------------------------------
const DRINK_POINTS = 25;
const SERVE_POINTS = 120;
const EMPTY_POINTS = 60;
const LEVEL_BONUS = 500;
const START_LIVES = 3;
const DYING_TIME = 1.6;
const CLEAR_TIME = 2.0;
const BEST_KEY = 'sodatapper-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');

let state = 'idle';    // idle | running | paused | dying | levelclear | over
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;

let bartender = { lane: 0, x: TENDER_X, bob: 0 };
let patrons = [];
let mugs = [];
let empties = [];
let splashes = [];     // short-lived decoration for pours, catches and smashes

let serveTimer = 0;    // tap cooldown
let spawnTimer = FIRST_SPAWN;
let spawned = 0;       // patrons let in so far this round
let dyingTimer = 0;
let clearTimer = 0;
let lastLoss = '';     // why the last life was lost, shown while dying

// Test hooks: the specs switch the queue and the animation loop off so they can
// drive step(dt) themselves.
let spawnEnabled = true;
let loopEnabled = true;

// Deterministic queue order — reseeded on every new game so a round always
// plays out the same way for a given set of inputs.
let rngState = 1;

function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// ---------------------------------------------------------------------------
// Difficulty curves
// ---------------------------------------------------------------------------

function patronSpeed() {
    return Math.min(PATRON_SPEED_BASE + (level - 1) * PATRON_SPEED_STEP, PATRON_SPEED_CAP);
}

function spawnInterval() {
    return Math.max(SPAWN_BASE - (level - 1) * SPAWN_STEP, SPAWN_MIN);
}

function waveSize() {
    return Math.min(WAVE_BASE + (level - 1) * WAVE_STEP, WAVE_MAX);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function spawnPatron(lane, x = BAR_LEFT) {
    const p = { lane, x, state: 'walking', drinkTimer: 0, wobble: rng() * Math.PI * 2 };
    patrons.push(p);
    return p;
}

function spawnEmpty(lane, x = BAR_LEFT) {
    const e = { lane, x, spin: 0 };
    empties.push(e);
    return e;
}

function spawnMug(lane, x = BAR_RIGHT - MUG_HW) {
    const m = { lane, x, fizz: 0 };
    mugs.push(m);
    return m;
}

function addSplash(lane, x, color) {
    splashes.push({ lane, x, color, life: 0.35 });
}

// A patron takes a mug: they stop, drink, and get shoved back down the bar.
function giveDrink(p) {
    p.state = 'drinking';
    p.drinkTimer = DRINK_TIME;
    score += DRINK_POINTS;
    updateHud();
    return p;
}

function placeBartender(lane) {
    bartender.lane = Math.max(0, Math.min(LANES - 1, lane));
    return bartender;
}

function moveBartender(delta) {
    placeBartender(bartender.lane + delta);
}

function serve() {
    if (state !== 'running' || serveTimer > 0) return null;
    serveTimer = SERVE_COOLDOWN;
    const mug = spawnMug(bartender.lane);
    addSplash(bartender.lane, BAR_RIGHT - MUG_HW, '#ffd98a');
    return mug;
}

// ---------------------------------------------------------------------------
// Round flow
// ---------------------------------------------------------------------------

function clearBar() {
    mugs = [];
    empties = [];
    splashes = [];
}

function startRound() {
    clearBar();
    patrons = [];
    spawned = 0;
    spawnTimer = FIRST_SPAWN;
    serveTimer = 0;
    placeBartender(0);
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    rngState = 20240817;
    lastLoss = '';
    startRound();
    state = 'running';
    hideOverlay();
    updateHud();
}

function loseLife(reason = 'lost') {
    if (state !== 'running') return;
    lives -= 1;
    lastLoss = reason;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        updateHud();
        gameOver();
        return;
    }
    state = 'dying';
    dyingTimer = DYING_TIME;
}

// After a fumble the bar is wiped and everyone still waiting is sent back to
// the far end, so play always resumes from a survivable position.
function recoverFromLoss() {
    clearBar();
    for (const p of patrons) {
        p.x = BAR_LEFT;
        p.state = 'walking';
        p.drinkTimer = 0;
    }
    serveTimer = 0;
    state = 'running';
}

function gameOver() {
    state = 'over';
    saveBest();
    showOverlay('LAST CALL', `Score ${score} · Round ${level}`, 'Press Space or Enter to play again');
}

function roundComplete() {
    return spawned >= waveSize() && patrons.length === 0 && mugs.length === 0 && empties.length === 0;
}

function completeRound() {
    state = 'levelclear';
    clearTimer = CLEAR_TIME;
    score += LEVEL_BONUS;
    updateHud();
    showOverlay(`ROUND ${level} CLEAR`, `Bonus ${LEVEL_BONUS}`, 'Next round coming up...');
}

function nextLevel() {
    level += 1;
    startRound();
    state = 'running';
    hideOverlay();
    updateHud();
}

// Test helper: finish the round's queue instantly.
function clearRoundForTest() {
    spawned = waveSize();
    patrons = [];
    clearBar();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        dyingTimer -= dt;
        if (dyingTimer <= 0) recoverFromLoss();
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    bartender.bob += dt;
    if (serveTimer > 0) serveTimer -= dt;

    stepQueue(dt);
    stepMugs(dt);
    stepPatrons(dt);
    stepEmpties(dt);
    stepSplashes(dt);

    if (state === 'running' && roundComplete()) completeRound();
}

function stepQueue(dt) {
    if (!spawnEnabled || spawned >= waveSize()) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    const lane = pickLane();
    if (lane === -1) {
        spawnTimer = 0.4;   // every bar is crowded at the far end; try again soon
        return;
    }
    spawnPatron(lane);
    spawned += 1;
    spawnTimer = spawnInterval();
}

// Prefer the emptiest bar, and never drop a patron on top of one that has only
// just come in.
function pickLane() {
    const counts = new Array(LANES).fill(0);
    const nearest = new Array(LANES).fill(Infinity);
    for (const p of patrons) {
        counts[p.lane] += 1;
        nearest[p.lane] = Math.min(nearest[p.lane], p.x);
    }
    let choice = -1;
    let fewest = Infinity;
    for (let i = 0; i < LANES; i++) {
        const lane = (i + Math.floor(rng() * LANES)) % LANES;
        if (nearest[lane] < BAR_LEFT + QUEUE_GAP) continue;
        if (counts[lane] < fewest) {
            fewest = counts[lane];
            choice = lane;
        }
    }
    return choice;
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;
        m.fizz += dt;

        // The patron closest to the tap gets the mug.
        let taker = null;
        for (const p of patrons) {
            if (p.lane !== m.lane || p.state !== 'walking') continue;
            if (Math.abs(p.x - m.x) > PATRON_HW + MUG_HW) continue;
            if (!taker || p.x > taker.x) taker = p;
        }
        if (taker) {
            mugs.splice(i, 1);
            giveDrink(taker);
            addSplash(m.lane, m.x, '#ffe6a8');
            continue;
        }

        if (m.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            addSplash(m.lane, BAR_LEFT, '#ff8f6b');
            loseLife('spilled');
            return;
        }
    }
}

function stepPatrons(dt) {
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];
        if (p.state === 'drinking') {
            p.drinkTimer -= dt;
            p.x -= PUSH_SPEED * dt;
            if (p.x <= BAR_LEFT) {
                // Pushed clean off the end: served, and the empty comes back.
                patrons.splice(i, 1);
                score += SERVE_POINTS;
                updateHud();
                spawnEmpty(p.lane, BAR_LEFT + MUG_HW);
                addSplash(p.lane, BAR_LEFT + MUG_HW, '#7ee0d0');
                continue;
            }
            if (p.drinkTimer <= 0) p.state = 'walking';
            continue;
        }

        p.x += patronSpeed() * dt;
        p.wobble += dt * 6;
        if (p.x >= GRAB_X) {
            p.x = GRAB_X;
            addSplash(p.lane, GRAB_X, '#ff8f6b');
            loseLife('grabbed');
            return;
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        e.spin += dt * 8;

        if (e.x >= BAR_RIGHT - CATCH_ZONE && bartender.lane === e.lane) {
            empties.splice(i, 1);
            score += EMPTY_POINTS;
            updateHud();
            addSplash(e.lane, e.x, '#7ee0d0');
            continue;
        }
        if (e.x > BAR_RIGHT) {
            empties.splice(i, 1);
            addSplash(e.lane, BAR_RIGHT, '#ff8f6b');
            loseLife('smashed');
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

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage disabled — the score just does not persist */
        }
    }
    updateHud();
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    drawRoom();
    for (let lane = 0; lane < LANES; lane++) drawDoorway(lane);
    for (const p of patrons) drawPatron(p);
    drawBartender();
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);
    for (const e of empties) drawEmpty(e);
    for (const m of mugs) drawMug(m);
    drawTapPost();
    for (const s of splashes) drawSplash(s);
    if (state === 'dying') drawLossBanner();
}

function drawRoom() {
    const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    g.addColorStop(0, '#2a1739');
    g.addColorStop(1, '#150c1d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall panelling.
    ctx.strokeStyle = 'rgba(255, 233, 196, 0.05)';
    ctx.lineWidth = 2;
    for (let x = 20; x < CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }

    // Neon sign above the top bar.
    ctx.save();
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 179, 71, 0.85)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffb347';
    ctx.fillText('SODA TAPPER', CANVAS_W / 2, 34);
    ctx.restore();
}

// The swing door each patron walks in through, at the far end of a bar.
function drawDoorway(lane) {
    const y = BAR_Y[lane];
    const top = y + FEET_Y - PATRON_H - 12;
    ctx.fillStyle = 'rgba(8, 4, 12, 0.65)';
    ctx.fillRect(BAR_LEFT - 40, top, 22, PATRON_H + 12);
    ctx.strokeStyle = 'rgba(255, 233, 196, 0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(BAR_LEFT - 40, top, 22, PATRON_H + 12);
}

function drawBar(lane) {
    const y = BAR_Y[lane];
    const active = lane === bartender.lane;
    const left = BAR_LEFT - 18;
    const width = BAR_RIGHT - left + 6;

    // Polished top, brighter on the bar the bartender is working.
    const top = ctx.createLinearGradient(0, y, 0, y + BAR_H);
    top.addColorStop(0, active ? '#d59a58' : '#a97640');
    top.addColorStop(1, '#7a4f27');
    ctx.fillStyle = top;
    ctx.fillRect(left, y, width, BAR_H);
    ctx.fillStyle = active ? 'rgba(255, 240, 210, 0.6)' : 'rgba(255, 240, 210, 0.22)';
    ctx.fillRect(left, y, width, 2);

    // Panelled front of the counter — patrons stand behind this.
    const front = ctx.createLinearGradient(0, y + BAR_H, 0, y + BAR_H + BAR_FRONT);
    front.addColorStop(0, '#5b3b1f');
    front.addColorStop(1, '#361f10');
    ctx.fillStyle = front;
    ctx.fillRect(left, y + BAR_H, width, BAR_FRONT);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let x = left + 24; x < left + width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, y + BAR_H + 4);
        ctx.lineTo(x, y + BAR_H + BAR_FRONT - 4);
        ctx.stroke();
    }

    // The stretch of bar where a returning empty can still be caught.
    ctx.fillStyle = active ? 'rgba(126, 224, 208, 0.3)' : 'rgba(126, 224, 208, 0.08)';
    ctx.fillRect(BAR_RIGHT - CATCH_ZONE, y - 3, CATCH_ZONE, 3);
}

function drawMug(m) {
    const y = BAR_Y[m.lane];
    const top = y - MUG_H;
    ctx.fillStyle = '#f4f2e8';
    ctx.fillRect(m.x - MUG_HW, top, MUG_HW * 2, MUG_H);
    ctx.fillStyle = '#c8731d';
    ctx.fillRect(m.x - MUG_HW + 2, top + 6, MUG_HW * 2 - 4, MUG_H - 8);
    // Foam, sloshing as the mug slides.
    ctx.fillStyle = '#fffaf0';
    const wob = Math.sin(m.fizz * 22) * 1.5;
    ctx.fillRect(m.x - MUG_HW + 1, top + 2 + wob, MUG_HW * 2 - 2, 5);
    // Handle.
    ctx.strokeStyle = '#f4f2e8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(m.x + MUG_HW + 1, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawEmpty(e) {
    const y = BAR_Y[e.lane];
    ctx.save();
    ctx.translate(e.x, y - MUG_H / 2);
    ctx.rotate(Math.sin(e.spin) * 0.2);
    ctx.fillStyle = 'rgba(214, 228, 240, 0.8)';
    ctx.fillRect(-MUG_HW + 1, -MUG_H / 2, MUG_HW * 2 - 2, MUG_H);
    ctx.strokeStyle = '#a9c0d6';
    ctx.lineWidth = 2;
    ctx.strokeRect(-MUG_HW + 1, -MUG_H / 2, MUG_HW * 2 - 2, MUG_H);
    ctx.strokeStyle = 'rgba(169, 192, 214, 0.9)';
    ctx.beginPath();
    ctx.arc(MUG_HW + 1, 0, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.restore();
}

function drawPatron(p) {
    const feet = BAR_Y[p.lane] + FEET_Y;
    const bodyTop = feet - PATRON_H;
    const drinking = p.state === 'drinking';
    const stride = drinking ? 0 : Math.sin(p.wobble) * 3;

    ctx.save();
    ctx.translate(p.x, 0);

    // Legs, striding while they close in on the tap.
    ctx.fillStyle = '#3a2b4f';
    ctx.fillRect(-9 - stride * 0.4, feet - 18, 7, 18);
    ctx.fillRect(2 + stride * 0.4, feet - 18, 7, 18);

    // Coat.
    ctx.fillStyle = drinking ? '#5fae9f' : '#8d5fa8';
    ctx.fillRect(-PATRON_HW + 2, bodyTop + 16, PATRON_HW * 2 - 4, PATRON_H - 34);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(-PATRON_HW + 2, bodyTop + 16, 5, PATRON_H - 34);

    // Head and hat.
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(0, bodyTop + 10, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f2140';
    ctx.fillRect(-12, bodyTop + 2, 24, 3);
    ctx.fillRect(-8, bodyTop - 5, 16, 7);

    // Impatient stare, or a contented squint mid-drink.
    ctx.fillStyle = '#26182e';
    if (drinking) {
        ctx.fillRect(-6, bodyTop + 9, 4, 2);
        ctx.fillRect(2, bodyTop + 9, 4, 2);
    } else {
        ctx.fillRect(-6, bodyTop + 8, 3, 4);
        ctx.fillRect(3, bodyTop + 8, 3, 4);
    }

    // A drinker tips a mug back.
    if (drinking) {
        ctx.save();
        ctx.translate(9, bodyTop + 12);
        ctx.rotate(-0.5);
        ctx.fillStyle = '#f4f2e8';
        ctx.fillRect(0, 0, 11, 14);
        ctx.fillStyle = '#c8731d';
        ctx.fillRect(2, 3, 7, 9);
        ctx.restore();
    }
    ctx.restore();
}

function drawBartender() {
    const feet = BAR_Y[bartender.lane] + FEET_Y;
    const top = feet - TENDER_H;
    const bob = Math.sin(bartender.bob * 3) * 1.5;
    const pouring = serveTimer > 0;

    ctx.save();
    ctx.translate(bartender.x, bob);

    // Trousers, shirt and apron.
    ctx.fillStyle = '#2a2038';
    ctx.fillRect(-TENDER_HW + 5, feet - 20, TENDER_HW * 2 - 10, 20);
    ctx.fillStyle = '#2f5f8a';
    ctx.fillRect(-TENDER_HW + 3, top + 18, TENDER_HW * 2 - 6, TENDER_H - 36);
    ctx.fillStyle = '#f5f2e8';
    ctx.fillRect(-TENDER_HW + 6, top + 28, TENDER_HW * 2 - 12, TENDER_H - 40);

    // Head, with a neat side part.
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(0, top + 12, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(-10, top + 3, 20, 5);
    ctx.fillStyle = '#26182e';
    ctx.fillRect(-6, top + 11, 3, 3);
    ctx.fillRect(3, top + 11, 3, 3);
    // Bow tie.
    ctx.fillStyle = '#c2413f';
    ctx.fillRect(-5, top + 21, 10, 4);

    // The arm on the tap handle drops as a mug is poured.
    ctx.strokeStyle = '#f2c9a0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-TENDER_HW + 5, top + 26);
    ctx.lineTo(-TENDER_HW - 10, top + 22 + (pouring ? 8 : 0));
    ctx.stroke();
    ctx.restore();
}

function drawTapPost() {
    // The bank of taps the bartender works, one over each bar.
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(BAR_RIGHT + 2, 56, 9, CANVAS_H - 96);
    for (let lane = 0; lane < LANES; lane++) {
        const y = BAR_Y[lane];
        const active = lane === bartender.lane;
        ctx.fillStyle = active ? '#ffd98a' : '#8a6a3a';
        ctx.fillRect(BAR_RIGHT - 8, y - 30, 18, 6);
        ctx.fillRect(BAR_RIGHT + 1, y - 30, 5, 18);
        if (active && serveTimer > 0) {
            ctx.fillStyle = 'rgba(255, 217, 138, 0.8)';
            ctx.fillRect(BAR_RIGHT - 7, y - 24, 3, 16);
        }
    }
}

function drawSplash(s) {
    const y = BAR_Y[s.lane];
    const t = Math.max(0, s.life / 0.35);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = s.color;
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const r = (1 - t) * 18 + 4;
        ctx.fillRect(s.x + Math.cos(a) * r - 2, y - 10 + Math.sin(a) * r - 2, 4, 4);
    }
    ctx.restore();
}

function drawLossBanner() {
    const words = {
        spilled: 'SODA SPILLED!',
        grabbed: 'CUSTOMER GRABBED YOU!',
        smashed: 'MUG SMASHED!',
    };
    ctx.save();
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(12, 6, 15, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 26, CANVAS_W, 52);
    ctx.fillStyle = '#ff8f6b';
    ctx.fillText(words[lastLoss] || 'OOPS!', CANVAS_W / 2, CANVAS_H / 2);
    ctx.restore();
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
    if (key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') serve();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        if (state === 'running') moveBartender(-1);
        e.preventDefault();
        return;
    }
    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        if (state === 'running') moveBartender(1);
        e.preventDefault();
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    // Clicking a bar moves the bartender there and pours; handy on a trackpad.
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    let nearest = 0;
    for (let lane = 1; lane < LANES; lane++) {
        if (Math.abs(BAR_Y[lane] - y) < Math.abs(BAR_Y[nearest] - y)) nearest = lane;
    }
    placeBartender(nearest);
    serve();
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
    if (loopEnabled) {
        step(dt);
        draw();
    }
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
startRound();
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
