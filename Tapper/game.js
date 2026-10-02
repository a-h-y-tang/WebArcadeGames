// ---------------------------------------------------------------------------
// Tapper — a four-lane bar service game on an HTML5 canvas.
//
// Patrons shuffle in at the door end (left) of each lane and walk towards the
// taps. You work the tap end: slide between the four lanes and send mugs
// sliding down them. A mug knocks a patron back down the bar while they drink,
// and every drink sends an empty mug sliding back towards you — be in that lane
// to catch it. Serve the whole wave to move up a level.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. All motion is expressed per second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing. `autoStep` can
// switch the render loop's stepping off, and `autoSpawn` the wave timer, which
// lets a spec arrange exactly the bar it wants to talk about.
// ---------------------------------------------------------------------------

// --- Board ---------------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 480;
const LANES = 4;
const LANE_TOP = 40;
const LANE_H = 104;

const BAR_LEFT = 70;        // the doorway: patrons enter, poured mugs smash
const TAP_X = 664;          // the taps
const CATCH_X = 686;        // an empty mug is caught (or lost) crossing this
const PLAYER_X = 704;       // where the bartender stands
const MUG_START_X = TAP_X - 12;
const SMASH_X = BAR_LEFT - 8;
const DOOR_X = BAR_LEFT - 30;

const laneY = (lane) => LANE_TOP + lane * LANE_H + LANE_H / 2;

// --- Speeds (pixels per second) ------------------------------------------
const MUG_SPEED = 320;
const EMPTY_SPEED = 250;
const PUSH_SPEED = 130;
const LEAVE_SPEED = 95;
const CUSTOMER_BASE_SPEED = 28;
const CUSTOMER_LEVEL_SPEED = 5;

const PUSH_DIST = 95;       // how far one mug knocks a patron back
const HIT_DIST = 20;        // how close a mug must get to land
const GRAB_DIST = 20;       // how close a patron must get to the taps to grab you

// --- Run structure -------------------------------------------------------
const START_LIVES = 3;
const SERVE_POINTS = 100;
const CATCH_POINTS = 50;
const LEAVE_POINTS = 150;
const CLEAR_BONUS = 500;
const POUR_COOLDOWN = 0.3;
const DEATH_PAUSE = 1.1;
const CLEAR_PAUSE = 1.5;
const FIRST_SPAWN_DELAY = 1.0;

const waveFor = (lvl) => 3 + lvl;
const customerSpeed = (lvl) => CUSTOMER_BASE_SPEED + (lvl - 1) * CUSTOMER_LEVEL_SPEED;
const spawnInterval = (lvl) => Math.max(0.85, 2.8 - 0.2 * lvl);
const thirstFor = (lvl) => Math.min(3, 1 + Math.floor((lvl - 1) / 3));

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const servedEl = document.getElementById('served');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---------------------------------------------------------------
let state = 'idle';         // idle | playing | paused | dying | clear | over
let prevState = 'idle';     // what to go back to when unpausing
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let served = 0;             // patrons sent out of the door this wave
let spawned = 0;            // patrons let in this wave
let waveSize = waveFor(1);
let customers = [];
let mugs = [];              // full mugs sliding towards the door
let empties = [];           // empty mugs sliding back towards the taps
let player = { lane: 0 };
let pourCd = 0;
let spawnTimer = FIRST_SPAWN_DELAY;
let deathTimer = 0;
let clearTimer = 0;
let lastLoss = '';          // why the current life was lost, shown on the canvas
let splashes = [];          // short-lived breakage marks, decoration only
let autoStep = true;
let autoSpawn = true;

// A level-seeded LCG picks the spawn lanes, so a level always plays out the
// same way — for the player and for the tests.
let rngState = 1;

function seedRng(lvl) {
    rngState = (lvl * 7919 + 1013904223) % 2147483647;
    if (rngState <= 0) rngState += 2147483646;
}

function rnd() {
    rngState = (rngState * 48271) % 2147483647;
    return (rngState - 1) / 2147483646;
}

// ---------------------------------------------------------------------------
// Run and wave setup
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    player = { lane: 0 };
    splashes = [];
    startWave();
    state = 'playing';
    hideOverlay();
    updateHud();
}

// Lay out a fresh attempt at the current level. Used by both the level change
// and a lost life, which replays the wave from the beginning rather than
// resuming it half-poured.
function startWave() {
    waveSize = waveFor(level);
    served = 0;
    spawned = 0;
    customers = [];
    mugs = [];
    empties = [];
    pourCd = 0;
    spawnTimer = FIRST_SPAWN_DELAY;
    deathTimer = 0;
    clearTimer = 0;
    seedRng(level);
    updateHud();
}

function spawnCustomer(lane, x) {
    customers.push({
        lane,
        x: x === undefined ? BAR_LEFT : x,
        need: thirstFor(level),
        state: 'advancing',
        push: 0,
        bob: rnd() * Math.PI * 2,
    });
    spawned++;
    return customers[customers.length - 1];
}

// Pick a lane for the next patron, skipping any lane that still has someone
// loitering by the door so arrivals do not stack on top of each other.
function pickLane() {
    const first = Math.floor(rnd() * LANES) % LANES;
    for (let i = 0; i < LANES; i++) {
        const lane = (first + i) % LANES;
        const crowded = customers.some((c) => c.lane === lane && c.x < BAR_LEFT + 52);
        if (!crowded) return lane;
    }
    return first;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'playing' && state !== 'dying' && state !== 'clear') return;
    player.lane = Math.max(0, Math.min(LANES - 1, player.lane + delta));
}

function pour() {
    if (state !== 'playing' || pourCd > 0) return null;
    pourCd = POUR_COOLDOWN;
    mugs.push({ lane: player.lane, x: MUG_START_X });
    return mugs[mugs.length - 1];
}

function togglePause() {
    if (state === 'paused') {
        state = prevState;
        hideOverlay();
    } else if (state === 'playing' || state === 'dying' || state === 'clear') {
        prevState = state;
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state === 'dying') {
        deathTimer -= dt;
        if (deathTimer <= 0) {
            startWave();
            state = 'playing';
        }
        return;
    }
    if (state === 'clear') {
        clearTimer -= dt;
        if (clearTimer <= 0) {
            level++;
            startWave();
            state = 'playing';
        }
        return;
    }
    if (state !== 'playing') return;

    if (pourCd > 0) pourCd -= dt;
    decaySplashes(dt);

    if (autoSpawn && spawned < waveSize) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
            spawnCustomer(pickLane(), BAR_LEFT);
            spawnTimer = spawnInterval(level);
        }
    }

    // Each of these can end the life in progress, in which case the rest of
    // the frame is abandoned: one incident costs one life, never two.
    if (!stepCustomers(dt)) return;
    if (!stepMugs(dt)) return;
    if (!stepEmpties(dt)) return;

    checkWaveClear();
}

function stepCustomers(dt) {
    const speed = customerSpeed(level);
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.state === 'advancing') {
            c.x += speed * dt;
            if (c.x >= TAP_X - GRAB_DIST) {
                loseLife('A patron got to the taps!');
                return false;
            }
        } else if (c.state === 'drinking') {
            const move = Math.min(c.push, PUSH_SPEED * dt);
            c.push -= move;
            c.x = Math.max(BAR_LEFT, c.x - move);
            if (c.push <= 0) {
                // Finished the pint: the empty comes sliding back up the lane.
                empties.push({ lane: c.lane, x: Math.min(c.x + 16, CATCH_X - 24) });
                c.state = c.need > 0 ? 'advancing' : 'leaving';
            }
        } else if (c.state === 'leaving') {
            c.x -= LEAVE_SPEED * dt;
            if (c.x <= DOOR_X) {
                customers.splice(i, 1);
                served++;
                score += LEAVE_POINTS;
                updateHud();
            }
        }
    }
    return true;
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;

        // The patron closest to the taps in this lane drinks it.
        let target = null;
        for (const c of customers) {
            if (c.lane !== m.lane || c.state === 'leaving') continue;
            if (m.x - c.x > HIT_DIST) continue;
            if (!target || c.x > target.x) target = c;
        }
        if (target) {
            mugs.splice(i, 1);
            target.need--;
            target.state = 'drinking';
            target.push = PUSH_DIST;
            score += SERVE_POINTS;
            updateHud();
            continue;
        }

        if (m.x <= SMASH_X) {
            mugs.splice(i, 1);
            addSplash(m.lane, SMASH_X);
            loseLife('A mug smashed on the floor!');
            return false;
        }
    }
    return true;
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;
        if (e.x < CATCH_X) continue;

        empties.splice(i, 1);
        if (e.lane === player.lane) {
            score += CATCH_POINTS;
            updateHud();
        } else {
            addSplash(e.lane, CATCH_X);
            loseLife('An empty went past you!');
            return false;
        }
    }
    return true;
}

function checkWaveClear() {
    if (spawned < waveSize) return;
    if (customers.length || mugs.length || empties.length) return;
    score += CLEAR_BONUS * level;
    state = 'clear';
    clearTimer = CLEAR_PAUSE;
    updateHud();
}

function loseLife(reason) {
    lives--;
    lastLoss = reason;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    state = 'dying';
    deathTimer = DEATH_PAUSE;
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('tapper-best', String(best));
        } catch (err) {
            /* private browsing — the run just does not persist */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Level ${level}`, 'Press Space to play again');
}

function addSplash(lane, x) {
    splashes.push({ lane, x, life: 0.6 });
}

function decaySplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].life -= dt;
        if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    servedEl.textContent = `${served}/${waveSize}`;
    levelEl.textContent = String(level);
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
// Drawing
// ---------------------------------------------------------------------------

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall and floor.
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#1b2130');
    wall.addColorStop(1, '#0a0e16');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (let lane = 0; lane < LANES; lane++) drawLane(lane);

    for (const s of splashes) drawSplash(s);
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m.x, laneY(m.lane), true);
    for (const e of empties) drawMug(e.x, laneY(e.lane), false);
    drawPlayer();

    if (state === 'dying') drawBanner(lastLoss);
    else if (state === 'clear') drawBanner(`BAR CLEARED  +${CLEAR_BONUS * level}`);
}

function drawLane(lane) {
    const y = laneY(lane);
    const top = LANE_TOP + lane * LANE_H;

    // Bar counter.
    const counter = ctx.createLinearGradient(0, y - 20, 0, y + 26);
    counter.addColorStop(0, '#6b4524');
    counter.addColorStop(0.5, '#8a5a2e');
    counter.addColorStop(1, '#4a2e17');
    ctx.fillStyle = counter;
    ctx.fillRect(BAR_LEFT - 34, y - 20, TAP_X - BAR_LEFT + 60, 46);

    ctx.strokeStyle = 'rgba(255, 220, 160, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT - 34, y - 19);
    ctx.lineTo(TAP_X + 26, y - 19);
    ctx.stroke();

    // Doorway at the far end.
    ctx.fillStyle = '#121724';
    ctx.fillRect(0, top + 8, 36, LANE_H - 16);
    ctx.strokeStyle = '#2a3348';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, top + 8.5, 36, LANE_H - 17);

    // Tap at the service end.
    ctx.fillStyle = '#9aa7bd';
    ctx.fillRect(TAP_X + 10, y - 40, 8, 22);
    ctx.fillRect(TAP_X + 4, y - 22, 20, 7);
    ctx.fillStyle = '#f5b942';
    ctx.fillRect(TAP_X + 12, y - 48, 4, 8);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const lean = c.state === 'drinking' ? -3 : 0;
    const x = c.x;

    // Body.
    ctx.fillStyle = c.state === 'leaving' ? '#5a6b8c' : '#c0543f';
    ctx.fillRect(x - 11, y - 16, 22, 30);
    // Head.
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(x, y - 24 + lean, 9, 0, Math.PI * 2);
    ctx.fill();
    // Hat brim.
    ctx.fillStyle = '#2d3650';
    ctx.fillRect(x - 11, y - 31 + lean, 22, 4);

    // Thirst pips: one per drink still wanted.
    ctx.fillStyle = '#f5b942';
    for (let i = 0; i < c.need; i++) {
        ctx.fillRect(x - 10 + i * 8, y + 18, 6, 4);
    }

    if (c.state === 'drinking') drawMug(x + 14, y - 18, true, 0.9);
}

function drawMug(x, y, full, scale = 1) {
    const w = 14 * scale;
    const h = 18 * scale;
    ctx.fillStyle = full ? '#f0a32c' : 'rgba(210, 226, 255, 0.35)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    if (full) {
        ctx.fillStyle = '#fff6e0';
        ctx.fillRect(x - w / 2, y - h / 2, w, 4 * scale);
    }
    ctx.strokeStyle = '#e9eef8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    // Handle.
    ctx.beginPath();
    ctx.arc(x + w / 2 + 2 * scale, y, 4 * scale, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawPlayer() {
    const y = laneY(player.lane);

    // Apron and body.
    ctx.fillStyle = '#eceff6';
    ctx.fillRect(PLAYER_X - 13, y - 14, 26, 32);
    ctx.fillStyle = '#4a5a7a';
    ctx.fillRect(PLAYER_X - 13, y + 2, 26, 16);
    // Head.
    ctx.fillStyle = '#e8c39a';
    ctx.beginPath();
    ctx.arc(PLAYER_X, y - 23, 9, 0, Math.PI * 2);
    ctx.fill();
    // Catching arm, reaching back down the bar.
    ctx.strokeStyle = '#e8c39a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(PLAYER_X - 10, y - 6);
    ctx.lineTo(CATCH_X - 6, y - 2);
    ctx.stroke();
}

function drawSplash(s) {
    const y = laneY(s.lane);
    const a = Math.max(0, s.life / 0.6);
    ctx.strokeStyle = `rgba(245, 185, 66, ${a})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(s.x, y);
        ctx.lineTo(s.x + Math.cos(ang) * 16 * (1.4 - a), y + Math.sin(ang) * 12 * (1.4 - a));
        ctx.stroke();
    }
}

function drawBanner(text) {
    ctx.fillStyle = 'rgba(6, 9, 15, 0.72)';
    ctx.fillRect(0, CANVAS_H / 2 - 32, CANVAS_W, 64);
    ctx.fillStyle = '#f5b942';
    ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
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
        moveLane(-1);
        return;
    }
    if (k === 'ArrowDown' || k === 's') {
        e.preventDefault();
        moveLane(1);
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    const lane = Math.max(0, Math.min(LANES - 1, Math.floor((y - LANE_TOP) / LANE_H)));
    player.lane = lane;
    pour();
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

best = parseInt(localStorage.getItem('tapper-best') || '0', 10) || 0;
seedRng(1);
updateHud();
showOverlay('TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
