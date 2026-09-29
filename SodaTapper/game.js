// ---------------------------------------------------------------------------
// Soda Tapper — a four-lane bar-service arcade game on an HTML5 canvas.
//
// Customers walk in from the far end of each bar and head for the bartender.
// Slide a mug down the lane to stop one: they drink, stagger back, and send the
// empty glass sliding back at you. Shove a customer off the far end and they are
// served. Let a customer reach you, let a mug run off the end of an empty lane,
// or miss an empty coming home, and it costs a life.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. All motion is per-second and advanced
// through `step(dt)`, so tests can simulate exact spans of time without leaning
// on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 720;
const CANVAS_H = 480;

const LANES = 4;
const LANE_TOP = 96;         // y of the first bar surface
const LANE_GAP = 96;         // vertical distance between bars

const BAR_LEFT = 60;         // far end: customers enter, stray mugs fall off
const BAR_RIGHT = 620;       // bartender end: mugs are poured from here
const GRAB_X = 590;          // a customer this far along grabs the bartender
const CATCH_X = 555;         // the near stretch of bar: empties past here are catchable

const CUSTOMER_W = 30;
const CUSTOMER_H = 40;
const MUG_W = 18;
const MUG_H = 22;
const BAR_TOP = 11;          // laneY() is the middle of the bar; this is its surface

// --- Tuning --------------------------------------------------------------
const MUG_SPEED = 260;             // full mug, sliding away from the bartender
const EMPTY_SPEED = 180;           // empty mug, coming home
const BASE_CUSTOMER_SPEED = 26;    // level 1 walking pace
const LEVEL_SPEEDUP = 4;           // added per level
const PUSHBACK = 110;              // stagger per drink
const DRINK_TIME = 0.8;
const POUR_COOLDOWN = 0.18;
const MUGS_PER_LANE = 4;
const START_LIVES = 3;

const SCORE_SERVE = 150;
const SCORE_CATCH = 50;
const LEVEL_BONUS = 500;

const FIRST_SPAWN_DELAY = 1.5;
const BASE_SPAWN_INTERVAL = 2.6;
const MIN_SPAWN_INTERVAL = 1.0;

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
let state = 'idle';          // 'idle' | 'playing' | 'paused' | 'over'
let score = 0;
let served = 0;
let level = 1;
let lives = START_LIVES;
let best = 0;

const customers = [];
const mugs = [];             // full mugs, travelling left
const empties = [];          // empty mugs, travelling right
const shards = [];           // purely decorative breakage

const bartender = { lane: 0, pourCooldown: 0, pourFlash: 0 };

let spawned = 0;             // customers released in the current wave
let spawnTimer = FIRST_SPAWN_DELAY;

let autoStep = true;         // tests turn this off to own the clock
let autoSpawn = true;        // tests turn this off to own the bar

// A small LCG so a wave's lane order is reproducible from a seed.
let seed = 1;

function setSeed(n) {
    seed = (n >>> 0) || 1;
}

function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function laneY(lane) {
    return LANE_TOP + lane * LANE_GAP;
}

function customerSpeed(lvl) {
    return BASE_CUSTOMER_SPEED + LEVEL_SPEEDUP * (lvl - 1);
}

function waveSize(lvl) {
    return 4 + 2 * lvl;
}

function spawnInterval(lvl) {
    return Math.max(MIN_SPAWN_INTERVAL, BASE_SPAWN_INTERVAL - 0.15 * (lvl - 1));
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function makeCustomer(lane) {
    return {
        lane,
        x: BAR_LEFT - CUSTOMER_W,
        state: 'advancing',   // 'advancing' | 'drinking'
        timer: 0,
        queued: 0,            // mugs taken while already drinking
        bob: rand() * Math.PI * 2,
    };
}

function makeMug(lane, x) {
    return { lane, x };
}

function makeEmpty(lane, x) {
    return { lane, x };
}

function spawnCustomer(lane) {
    customers.push(makeCustomer(lane));
    return customers[customers.length - 1];
}

function makeShards(lane, x) {
    for (let i = 0; i < 8; i++) {
        shards.push({
            x,
            y: laneY(lane) - BAR_TOP,
            vx: (rand() - 0.5) * 160,
            vy: -40 - rand() * 120,
            life: 0.5 + rand() * 0.3,
        });
    }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function moveLane(dir) {
    if (state !== 'playing') return;
    bartender.lane = Math.max(0, Math.min(LANES - 1, bartender.lane + dir));
}

function pour() {
    if (state !== 'playing') return;
    if (bartender.pourCooldown > 0) return;
    if (mugs.filter((m) => m.lane === bartender.lane).length >= MUGS_PER_LANE) return;
    mugs.push(makeMug(bartender.lane, BAR_RIGHT));
    bartender.pourCooldown = POUR_COOLDOWN;
    bartender.pourFlash = 0.12;
}

function loseLife() {
    if (state !== 'playing') return;
    lives -= 1;

    // Sweep the bar: glassware is gone, anyone already on top of the bartender
    // leaves, and the rest are pushed back out of arm's reach.
    mugs.length = 0;
    empties.length = 0;
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];
        if (c.x >= GRAB_X - CUSTOMER_W) customers.splice(i, 1);
        else {
            c.x = Math.max(BAR_LEFT - CUSTOMER_W, c.x - PUSHBACK);
            c.state = 'advancing';
            c.timer = 0;
            c.queued = 0;
        }
    }

    if (lives <= 0) {
        lives = 0;
        gameOver();
    }
    updateHud();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('sodatapper-best', String(best));
        } catch (err) {
            /* private browsing — the run simply isn't remembered */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · ${served} served · level ${level}`, 'Press Space to play again');
}

function startGame() {
    state = 'playing';
    score = 0;
    served = 0;
    level = 1;
    lives = START_LIVES;

    customers.length = 0;
    mugs.length = 0;
    empties.length = 0;
    shards.length = 0;

    bartender.lane = 0;
    bartender.pourCooldown = 0;
    bartender.pourFlash = 0;

    spawned = 0;
    spawnTimer = FIRST_SPAWN_DELAY;
    autoSpawn = true;

    updateHud();
    hideOverlay();
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

function nextLevel() {
    level += 1;
    score += LEVEL_BONUS;
    spawned = 0;
    spawnTimer = FIRST_SPAWN_DELAY;
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing') return;

    bartender.pourCooldown = Math.max(0, bartender.pourCooldown - dt);
    bartender.pourFlash = Math.max(0, bartender.pourFlash - dt);

    stepSpawning(dt);
    stepCustomers(dt);
    if (state === 'playing') stepMugs(dt);
    if (state === 'playing') stepEmpties(dt);
    stepShards(dt);

    if (state === 'playing' && waveCleared()) nextLevel();

    updateHud();
}

function stepSpawning(dt) {
    if (!autoSpawn) return;
    if (spawned >= waveSize(level)) return;

    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    spawnTimer = spawnInterval(level);
    spawnCustomer(Math.floor(rand() * LANES));
    spawned += 1;
}

function stepCustomers(dt) {
    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.state === 'drinking') {
            c.timer -= dt;
            if (c.timer > 0) continue;

            // Done drinking: the empty comes back and the customer staggers off.
            empties.push(makeEmpty(c.lane, c.x + CUSTOMER_W));
            c.x -= PUSHBACK;

            if (c.x < BAR_LEFT) {
                // Leaving does not cancel the round: a mug poured is an empty
                // owed, so anything still queued comes back down the bar too,
                // spaced out rather than stacked into one free catch.
                for (let q = 0; q < c.queued; q++) {
                    empties.push(makeEmpty(c.lane, c.x + CUSTOMER_W - (q + 1) * 26));
                }
                customers.splice(i, 1);
                served += 1;
                score += SCORE_SERVE;
                continue;
            }

            // A mug taken mid-drink is simply the next round.
            if (c.queued > 0) {
                c.queued -= 1;
                c.timer = DRINK_TIME;
            } else {
                c.state = 'advancing';
                c.timer = 0;
            }
            continue;
        }

        c.x += customerSpeed(level) * dt;

        if (c.x + CUSTOMER_W >= GRAB_X) {
            customers.splice(i, 1);
            loseLife();
            return;   // loseLife() rewrote the list; pick up again next frame
        }
    }
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];
        m.x -= MUG_SPEED * dt;

        const taker = customerFor(m);
        if (taker) {
            mugs.splice(i, 1);
            if (taker.state === 'drinking') {
                // Already got one to their lips — this one waits its turn.
                taker.queued += 1;
            } else {
                taker.state = 'drinking';
                taker.timer = DRINK_TIME;
            }
            continue;
        }

        if (m.x <= BAR_LEFT) {
            mugs.splice(i, 1);
            makeShards(m.lane, BAR_LEFT);
            loseLife();
            return;
        }
    }
}

// The customer nearest the bartender is the one who reaches out for a mug, so
// mugs never slip past a thirsty customer to reach someone further down the bar
// — including a customer who is still working on the last one, which is what
// makes queuing mugs into a lane a real tactic rather than a suicide note.
function customerFor(mug) {
    let nearest = null;
    for (const c of customers) {
        if (c.lane !== mug.lane) continue;
        if (mug.x > c.x + CUSTOMER_W || mug.x + MUG_W < c.x) continue;
        if (!nearest || c.x > nearest.x) nearest = c;
    }
    return nearest;
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const e = empties[i];
        e.x += EMPTY_SPEED * dt;

        if (e.x >= CATCH_X && bartender.lane === e.lane) {
            empties.splice(i, 1);
            score += SCORE_CATCH;
            continue;
        }

        if (e.x > BAR_RIGHT) {
            empties.splice(i, 1);
            makeShards(e.lane, BAR_RIGHT);
            loseLife();
            return;
        }
    }
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
        spawned >= waveSize(level) &&
        customers.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    );
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    servedEl.textContent = String(served);
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

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Back wall
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2a1d12');
    wall.addColorStop(1, '#130d08');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTapWall();
    for (let lane = 0; lane < LANES; lane++) drawBar(lane);

    customers.forEach(drawCustomer);
    mugs.forEach((m) => drawMug(m, true));
    empties.forEach((e) => drawMug(e, false));
    shards.forEach(drawShard);

    drawBartender();
    drawStatusStrip();
}

// The bartender's alley: a lit strip down the right of the screen, with a tap
// rig on every lane so it reads as "this column is you".
function drawTapWall() {
    const x = BAR_RIGHT + 4;

    const alley = ctx.createLinearGradient(x, 0, CANVAS_W, 0);
    alley.addColorStop(0, 'rgba(255, 176, 54, 0.05)');
    alley.addColorStop(1, 'rgba(255, 176, 54, 0.14)');
    ctx.fillStyle = alley;
    ctx.fillRect(x, 0, CANVAS_W - x, CANVAS_H);

    ctx.fillStyle = 'rgba(255, 176, 54, 0.3)';
    ctx.fillRect(x, 0, 2, CANVAS_H);

    for (let lane = 0; lane < LANES; lane++) {
        const y = laneY(lane);
        const lit = lane === bartender.lane;

        // Tap column and spout
        ctx.fillStyle = lit ? '#c9922f' : '#5c4526';
        ctx.fillRect(CANVAS_W - 30, y - 62, 10, 30);
        ctx.fillRect(CANVAS_W - 34, y - 36, 18, 5);

        // Handle
        ctx.fillStyle = lit ? '#ffb036' : '#6d5330';
        ctx.beginPath();
        ctx.arc(CANVAS_W - 25, y - 66, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBar(lane) {
    const y = laneY(lane);
    const active = lane === bartender.lane;
    const x0 = BAR_LEFT - 30;
    const w = BAR_RIGHT - x0 + 24;

    // The lane the bartender is standing in is washed with light.
    if (active) {
        ctx.fillStyle = 'rgba(255, 176, 54, 0.05)';
        ctx.fillRect(0, y - LANE_GAP / 2 + 8, CANVAS_W, LANE_GAP - 12);
    }

    // Bar top
    const top = ctx.createLinearGradient(0, y - 11, 0, y + 11);
    top.addColorStop(0, active ? '#a06e39' : '#6d4a27');
    top.addColorStop(0.45, active ? '#7b5329' : '#57381c');
    top.addColorStop(1, '#2e1e10');
    ctx.fillStyle = top;
    ctx.fillRect(x0, y - 11, w, 22);

    // The stretch of bar where an empty can still be caught
    ctx.fillStyle = active ? 'rgba(255, 176, 54, 0.22)' : 'rgba(255, 176, 54, 0.07)';
    ctx.fillRect(CATCH_X, y - 11, BAR_RIGHT - CATCH_X, 22);
    ctx.fillStyle = active ? 'rgba(255, 210, 130, 0.7)' : 'rgba(255, 176, 54, 0.22)';
    ctx.fillRect(CATCH_X, y - 11, 2, 22);

    // Polished front edge
    ctx.fillStyle = active ? 'rgba(255, 210, 130, 0.75)' : 'rgba(255, 176, 54, 0.18)';
    ctx.fillRect(x0, y - 12, w, 2);

    // Far end of the bar — where stray mugs drop
    ctx.fillStyle = '#1d1209';
    ctx.fillRect(x0 - 8, y - 14, 8, 28);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(x0, y + 11, w, 5);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const drinking = c.state === 'drinking';

    // A drinking customer tips their head back; a walking one bobs along.
    const bob = drinking ? 0 : Math.sin(c.bob + c.x / 9) * 1.5;
    const feet = y - BAR_TOP + bob;
    const lean = drinking ? -3 : 0;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(c.x + CUSTOMER_W / 2, y - BAR_TOP + 2, 13, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs
    ctx.fillStyle = '#23384d';
    ctx.fillRect(c.x + 6, feet - 11, 6, 11);
    ctx.fillRect(c.x + CUSTOMER_W - 12, feet - 11, 6, 11);

    // Body
    const torso = ctx.createLinearGradient(c.x, feet - 40, c.x + CUSTOMER_W, feet - 11);
    torso.addColorStop(0, drinking ? '#6fc4ff' : '#4a95d6');
    torso.addColorStop(1, drinking ? '#2f7fbd' : '#2b6699');
    ctx.fillStyle = torso;
    ctx.fillRect(c.x + 4, feet - 36, CUSTOMER_W - 8, 25);

    // Arms — the near one reaches out for a drink
    ctx.fillStyle = drinking ? '#6fc4ff' : '#3d86c6';
    ctx.fillRect(c.x + CUSTOMER_W - 6, feet - (drinking ? 34 : 30), 8, 5);

    // Head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(c.x + CUSTOMER_W / 2 + lean, feet - 44, 8, 0, Math.PI * 2);
    ctx.fill();

    // Cap
    ctx.fillStyle = drinking ? '#ffd98a' : '#c8553d';
    ctx.beginPath();
    ctx.arc(c.x + CUSTOMER_W / 2 + lean, feet - 46, 8, Math.PI, 0);
    ctx.fill();

    if (drinking) {
        // The mug, held up to the face
        ctx.fillStyle = '#ffb036';
        ctx.fillRect(c.x + CUSTOMER_W - 4, feet - 40, 9, 12);
        ctx.strokeStyle = '#f7f1e4';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(c.x + CUSTOMER_W - 4.5, feet - 40.5, 10, 13);
    }
}

function drawMug(m, full) {
    const y = laneY(m.lane);
    const top = y - BAR_TOP - MUG_H + 1;

    ctx.fillStyle = full ? '#ffb036' : 'rgba(226, 238, 255, 0.5)';
    ctx.fillRect(m.x, top, MUG_W, MUG_H);

    ctx.strokeStyle = '#f7f1e4';
    ctx.lineWidth = 2;
    ctx.strokeRect(m.x + 0.5, top + 0.5, MUG_W - 1, MUG_H - 1);

    if (full) {
        ctx.fillStyle = '#fff6e0';
        ctx.fillRect(m.x + 1, top + 1, MUG_W - 2, 5);
    }

    // Handle
    ctx.beginPath();
    ctx.arc(m.x + MUG_W + 2, top + MUG_H / 2, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawShard(s) {
    ctx.fillStyle = `rgba(226, 238, 255, ${Math.max(0, Math.min(1, s.life * 2))})`;
    ctx.fillRect(s.x, s.y, 4, 4);
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const x = BAR_RIGHT + 14;
    const pouring = bartender.pourFlash > 0;

    const feet = y - BAR_TOP;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 12, feet + 2, 15, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Trousers
    ctx.fillStyle = '#2a1f16';
    ctx.fillRect(x + 2, feet - 12, 20, 12);

    // Apron and shirt
    ctx.fillStyle = pouring ? '#ffe9a8' : '#f6ecdc';
    ctx.fillRect(x, feet - 42, 24, 30);
    ctx.fillStyle = 'rgba(255, 176, 54, 0.35)';
    ctx.fillRect(x + 3, feet - 28, 18, 16);

    // Arm, thrown out over the bar while pouring
    ctx.fillStyle = pouring ? '#ffe9a8' : '#f6ecdc';
    ctx.fillRect(pouring ? x - 14 : x - 8, feet - 36, pouring ? 16 : 10, 6);

    // Head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x + 12, feet - 50, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3b2a1b';
    ctx.beginPath();
    ctx.arc(x + 12, feet - 52, 9, Math.PI, 0);
    ctx.fill();
}

function drawStatusStrip() {
    ctx.fillStyle = 'rgba(160, 141, 117, 0.85)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    const remaining = Math.max(0, waveSize(level) - spawned) + customers.length;
    ctx.fillText(`LEVEL ${level}  ·  ${remaining} thirsty`, 14, 24);

    ctx.textAlign = 'right';
    ctx.fillText('♥'.repeat(lives), CANVAS_W - 14, 24);
    ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

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

canvas.addEventListener('click', () => {
    if (state === 'playing') pour();
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
setSeed(Date.now() % 2147483647);
state = 'idle';
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
