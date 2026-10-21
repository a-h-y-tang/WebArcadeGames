// ---------------------------------------------------------------------------
// Soda Rush — a four-counter soda bar on an HTML5 canvas.
//
// You stand at the tap. Thirsty customers walk in from the open end of each
// counter and head towards you. Pull the tap on a counter and a full mug slides
// out to meet the nearest one; they drink, wander off satisfied, and send the
// empty mug sliding back. Be on that counter when it arrives or it tips off the
// end and smashes.
//
// Written as a single classic (non-module) script so the state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Gold Runner,
// BurgerTime and Snake in this repo. Every speed is per second and every rule
// lives in `step(dt)`, so the tests can advance the simulation frame by frame
// without depending on requestAnimationFrame wall-clock timing; `autoStep`
// takes the render loop's call to `step()` out of the way entirely.
//
// Everything on a counter is positioned by a single `x` between TAP_X and
// END_X, which is what keeps the rules decidable: a frame is a handful of
// one-dimensional comparisons per lane.
// ---------------------------------------------------------------------------

// --- Geometry ------------------------------------------------------------
const CANVAS_W = 760;
const CANVAS_H = 480;
const LANES = 4;
const LANE_TOP = 104;       // y of the top counter's surface
const LANE_GAP = 98;        // vertical distance between counters
const TAP_X = 150;          // the tap, where the bartender stands
const END_X = 706;          // the open end, where customers walk in
const CUST_W = 34;
const MUG_W = 18;
const GRAB_X = 26;          // how close to the tap a customer gets before trouble

// --- Tuning --------------------------------------------------------------
const MUG_SPEED = 250;      // full mug, sliding away from the tap
const EMPTY_SPEED = 190;    // empty mug, sliding back towards it
const EXIT_SPEED = 170;     // a satisfied customer heading for the door
const DRINK_TIME = 0.9;
const CATCH_GRACE = 0.9;    // how long an empty waits at the tap before smashing
const POUR_COOLDOWN = 0.22;
const POUR_ANIM = 0.18;
const CATCH_ANIM = 0.2;
const RESET_PUSH = 70;      // how far customers are pushed back when a life is lost
const NOTICE_TIME = 1.3;
const SHARD_LIFE = 0.9;
const FLASH_TIME = 1.4;
const START_LIVES = 3;
const COMBO_MAX = 5;

// --- Scoring -------------------------------------------------------------
const SCORE_SERVE = 50;       // a customer catches a mug
const SCORE_SATISFIED = 100;  // that customer leaves happy
const SCORE_EMPTY = 25;       // per combo step, for collecting the empty
const SCORE_LEVEL = 300;      // per round number, for clearing a round

const BEST_KEY = 'sodarush-best';
const SHIRTS = ['#d8584f', '#4f8fd8', '#53b36a', '#c96fc0', '#d9a13c', '#49b5ad'];

// --- DOM -----------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
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

// --- State ---------------------------------------------------------------
let state = 'idle';         // idle | playing | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let combo = 0;
let resolved = 0;           // customers this round that have left the counter
let levelTime = 0;
let spawnIndex = 0;
let autoStep = true;
let flash = 0;
let flashText = '';
let notice = 0;             // the "here is what just went wrong" banner
let noticeText = '';
let hitFlash = 0;
let shirtSeq = 0;

const bartender = { lane: 0, pourCooldown: 0, pourAnim: 0, catchAnim: 0 };
const customers = [];
const mugs = [];
const shards = [];
const spawnQueue = [];

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

// Rounds are derived from their number rather than authored, so the game never
// runs out and there is no layout data that can rot.
function levelConfig(n) {
    return {
        customers: Math.min(20, 6 + 2 * (n - 1)),
        gap: Math.max(0.8, 2.4 - 0.15 * (n - 1)),
        walkSpeed: Math.min(95, 30 + 7 * (n - 1)),
    };
}

// A small LCG seeded from the round number: round 3 always deals round 3.
function makeRng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function buildQueue(n) {
    const cfg = levelConfig(n);
    const rng = makeRng(n * 7919 + 104729);
    const queue = [];
    let t = 0;
    for (let i = 0; i < cfg.customers; i++) {
        t += cfg.gap * (0.8 + 0.4 * rng());
        let lane = Math.floor(rng() * LANES) % LANES;
        const prev = queue[queue.length - 1];
        const prev2 = queue[queue.length - 2];
        // Two in a row on one counter is a nice squeeze; three is a pile-up.
        if (prev && prev2 && prev.lane === lane && prev2.lane === lane) {
            lane = (lane + 1 + Math.floor(rng() * (LANES - 1))) % LANES;
        }
        queue.push({ lane, time: Math.round(t * 1000) / 1000 });
    }
    return queue;
}

function loadLevel(n) {
    customers.length = 0;
    mugs.length = 0;
    spawnQueue.length = 0;
    spawnQueue.push(...buildQueue(n));
    spawnIndex = 0;
    levelTime = 0;
    resolved = 0;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const laneY = (i) => LANE_TOP + i * LANE_GAP;

const laneAt = (y) =>
    Math.max(0, Math.min(LANES - 1, Math.round((y - LANE_TOP) / LANE_GAP)));

function spawnCustomer(lane, x) {
    const customer = {
        lane,
        x,
        state: 'walking',
        timer: 0,
        tint: SHIRTS[shirtSeq++ % SHIRTS.length],
        bob: (shirtSeq * 37) % 100,
    };
    customers.push(customer);
    return customer;
}

function spawnEmpty(lane, x) {
    const mug = { lane, x, full: false, resting: false, timer: 0 };
    mugs.push(mug);
    return mug;
}

function smash(mug) {
    const y = laneY(mug.lane) - 8;
    for (let i = 0; i < 12; i++) {
        shards.push({
            x: mug.x,
            y,
            vx: (Math.random() - 0.5) * 260,
            vy: -Math.random() * 220 - 40,
            spin: Math.random() * Math.PI,
            vs: (Math.random() - 0.5) * 14,
            life: SHARD_LIFE * (0.6 + Math.random() * 0.4),
            size: 2 + Math.random() * 3,
        });
    }
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function setLane(i) {
    if (!Number.isInteger(i) || i < 0 || i >= LANES) return;
    bartender.lane = i;
}

function moveLane(d) {
    setLane(Math.max(0, Math.min(LANES - 1, bartender.lane + d)));
}

function pour() {
    if (state !== 'playing') return false;
    if (bartender.pourCooldown > 0) return false;
    mugs.push({ lane: bartender.lane, x: TAP_X, full: true, resting: false, timer: 0 });
    bartender.pourCooldown = POUR_COOLDOWN;
    bartender.pourAnim = POUR_ANIM;
    return true;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    combo = 0;
    shards.length = 0;
    hitFlash = 0;
    notice = 0;
    bartender.lane = 0;
    bartender.pourCooldown = 0;
    bartender.pourAnim = 0;
    bartender.catchAnim = 0;
    loadLevel(1);
    state = 'playing';
    flash = FLASH_TIME;
    flashText = 'ROUND 1';
    hideOverlay();
    updateHud();
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

const LOSS_NOTICE = {
    grabbed: 'A CUSTOMER REACHED THE TAP',
    spilled: 'MUG OFF THE END',
    dropped: 'EMPTY GLASS SMASHED',
};

function loseLife(reason) {
    lives--;
    combo = 0;
    hitFlash = 0.5;
    notice = NOTICE_TIME;
    noticeText = LOSS_NOTICE[reason] || 'LIFE LOST';
    // Clear the counters and shove the queue back, so one disaster cannot
    // cascade into the rest of your lives over the following frames.
    mugs.length = 0;
    for (const c of customers) {
        if (c.state === 'walking') c.x = Math.min(END_X, c.x + RESET_PUSH);
    }
    if (lives <= 0) {
        lives = 0;
        gameOver();
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing: the best score simply does not persist */
        }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} · Round ${level}`, 'Press Space or click Start to play again');
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'playing' || dt <= 0) return;

    bartender.pourCooldown = Math.max(0, bartender.pourCooldown - dt);
    bartender.pourAnim = Math.max(0, bartender.pourAnim - dt);
    bartender.catchAnim = Math.max(0, bartender.catchAnim - dt);
    flash = Math.max(0, flash - dt);
    notice = Math.max(0, notice - dt);
    hitFlash = Math.max(0, hitFlash - dt);
    levelTime += dt;

    const walkSpeed = levelConfig(level).walkSpeed;
    const deadCustomers = new Set();
    const deadMugs = new Set();
    let loss = null;            // at most one life per frame

    // --- customers ---------------------------------------------------------
    for (const c of customers) {
        if (c.state === 'walking') {
            c.x -= walkSpeed * dt;
            if (c.x <= TAP_X + GRAB_X) {
                deadCustomers.add(c);
                resolved++;
                loss = loss || 'grabbed';
            }
        } else if (c.state === 'drinking') {
            c.timer -= dt;
            if (c.timer <= 0) {
                c.state = 'leaving';
                spawnEmpty(c.lane, c.x);
            }
        } else {
            c.x += EXIT_SPEED * dt;
            if (c.x > END_X + CUST_W) {
                deadCustomers.add(c);
                resolved++;
                score += SCORE_SATISFIED;
            }
        }
    }

    // --- mugs --------------------------------------------------------------
    for (const m of mugs) {
        if (m.full) {
            m.x += MUG_SPEED * dt;
            // The mug comes from the tap, so the customer nearest it is the one
            // it meets — drinkers and leavers never reach for a second mug.
            let target = null;
            for (const c of customers) {
                if (c.lane !== m.lane || c.state !== 'walking' || deadCustomers.has(c)) continue;
                if (!target || c.x < target.x) target = c;
            }
            if (target && m.x + MUG_W / 2 >= target.x - CUST_W / 2) {
                target.state = 'drinking';
                target.timer = DRINK_TIME;
                score += SCORE_SERVE;
                deadMugs.add(m);
            } else if (m.x > END_X) {
                deadMugs.add(m);
                smash(m);
                loss = loss || 'spilled';
            }
        } else if (!m.resting) {
            m.x -= EMPTY_SPEED * dt;
            if (m.x <= TAP_X) {
                m.x = TAP_X;
                m.resting = true;
                m.timer = CATCH_GRACE;
            }
        } else {
            m.timer -= dt;
            if (m.timer <= 0) {
                deadMugs.add(m);
                smash(m);
                loss = loss || 'dropped';
            }
        }
    }

    // --- collect the empties waiting on this counter ------------------------
    for (const m of mugs) {
        if (m.full || !m.resting || m.lane !== bartender.lane || deadMugs.has(m)) continue;
        deadMugs.add(m);
        combo = Math.min(COMBO_MAX, combo + 1);
        score += SCORE_EMPTY * combo;
        bartender.catchAnim = CATCH_ANIM;
    }

    for (let i = customers.length - 1; i >= 0; i--) {
        if (deadCustomers.has(customers[i])) customers.splice(i, 1);
    }
    for (let i = mugs.length - 1; i >= 0; i--) {
        if (deadMugs.has(mugs[i])) mugs.splice(i, 1);
    }
    if (loss) loseLife(loss);

    // Arrivals are resolved after the frame's movement, so a customer always
    // appears exactly at the open end rather than a frame inside it.
    while (spawnIndex < spawnQueue.length && spawnQueue[spawnIndex].time <= levelTime) {
        spawnCustomer(spawnQueue[spawnIndex++].lane, END_X);
    }

    // A round is cleared, not merely survived: the queue has to be spent and
    // the counters empty, so it cannot tick over while a mug is still sliding.
    if (state === 'playing' && spawnIndex >= spawnQueue.length && !customers.length && !mugs.length) {
        score += SCORE_LEVEL * level;
        level++;
        loadLevel(level);
        flash = FLASH_TIME;
        flashText = `ROUND ${level}`;
    }

    for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        s.life -= dt;
        if (s.life <= 0) {
            shards.splice(i, 1);
            continue;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 900 * dt;
        s.spin += s.vs * dt;
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    servedEl.textContent = `${resolved}/${levelConfig(level).customers}`;
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
// Rendering — a pure read of the state; draw() never mutates the simulation
// ---------------------------------------------------------------------------

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#241a14');
    wall.addColorStop(0.5, '#140e0a');
    wall.addColorStop(1, '#0c0806');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // lamp pools hanging over each counter
    for (let i = 0; i < LANES; i++) {
        const y = laneY(i);
        const cone = ctx.createRadialGradient(440, y - 74, 8, 440, y - 74, 240);
        cone.addColorStop(0, 'rgba(255, 198, 112, 0.3)');
        cone.addColorStop(1, 'rgba(255, 198, 112, 0)');
        ctx.fillStyle = cone;
        ctx.fillRect(TAP_X - 60, y - 92, CANVAS_W - TAP_X + 60, 96);
    }

    drawBackBar();
    drawFloor();

    const vignette = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 180, CANVAS_W / 2, CANVAS_H / 2, 520);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

// The shelving behind the bartender: it fills the strip left of the taps that
// would otherwise read as empty wall.
function drawBackBar() {
    const w = TAP_X - 96;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, w, CANVAS_H);

    for (let shelf = 0; shelf < 5; shelf++) {
        const y = 60 + shelf * 92;
        ctx.fillStyle = '#4b2d18';
        ctx.fillRect(0, y, w, 7);
        ctx.fillStyle = 'rgba(255, 206, 140, 0.18)';
        ctx.fillRect(0, y, w, 2);

        for (let b = 0; b < 4; b++) {
            const bx = 8 + b * 13 + ((shelf * 5 + b * 7) % 4);
            const bh = 20 + ((shelf * 3 + b * 5) % 4) * 5;
            if (bx > w - 10) continue;
            ctx.fillStyle = ['#6e8f5a', '#8a4a3c', '#7b6a3e', '#4f6b82'][(shelf + b) % 4];
            roundRect(bx, y - bh, 8, bh, 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 236, 200, 0.22)';
            ctx.fillRect(bx + 1, y - bh + 2, 2, bh - 5);
        }
    }
}

function drawFloor() {
    const y = laneY(LANES - 1) + 34;
    const floor = ctx.createLinearGradient(0, y, 0, CANVAS_H);
    floor.addColorStop(0, '#241509');
    floor.addColorStop(1, '#120b06');
    ctx.fillStyle = floor;
    ctx.fillRect(0, y, CANVAS_W, CANVAS_H - y);
    ctx.strokeStyle = 'rgba(255, 206, 140, 0.05)';
    ctx.lineWidth = 1;
    for (let x = -60; x < CANVAS_W + 120; x += 72) {
        ctx.beginPath();
        ctx.moveTo(x, CANVAS_H);
        ctx.lineTo(x + 46, y);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 206, 140, 0.04)';
    for (let yy = y + 18; yy < CANVAS_H; yy += 22) {
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(CANVAS_W, yy);
        ctx.stroke();
    }
}

function drawCounter(i) {
    const y = laneY(i);
    const x0 = TAP_X - 54;
    const x1 = END_X + 50;
    const active = i === bartender.lane;

    if (active) {
        const glow = ctx.createLinearGradient(0, y - 70, 0, y + 6);
        glow.addColorStop(0, 'rgba(255, 180, 61, 0)');
        glow.addColorStop(1, 'rgba(255, 180, 61, 0.22)');
        ctx.fillStyle = glow;
        ctx.fillRect(x0, y - 70, x1 - x0, 76);

        // a marker at the tap end, so the live counter is unmistakable
        ctx.fillStyle = '#ffb43d';
        ctx.beginPath();
        ctx.moveTo(x0 - 16, y - 12);
        ctx.lineTo(x0 - 4, y - 5);
        ctx.lineTo(x0 - 16, y + 2);
        ctx.closePath();
        ctx.fill();
    }

    // the bar top, seen slightly from above
    const top = ctx.createLinearGradient(0, y - 8, 0, y + 5);
    top.addColorStop(0, active ? '#e0a865' : '#bd8447');
    top.addColorStop(1, active ? '#99673a' : '#7d522c');
    ctx.fillStyle = top;
    ctx.fillRect(x0, y - 8, x1 - x0, 13);

    // the front face, in shadow
    const face = ctx.createLinearGradient(0, y + 5, 0, y + 26);
    face.addColorStop(0, '#5c361c');
    face.addColorStop(1, '#241509');
    ctx.fillStyle = face;
    ctx.fillRect(x0, y + 5, x1 - x0, 21);

    ctx.fillStyle = active ? 'rgba(255, 233, 186, 0.95)' : 'rgba(221, 177, 120, 0.6)';
    ctx.fillRect(x0, y - 9, x1 - x0, 2);
    ctx.fillStyle = 'rgba(255, 214, 150, 0.18)';
    ctx.fillRect(x0, y + 5, x1 - x0, 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x0, y + 26, x1 - x0, 6);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1;
    for (let x = x0 + 30; x < x1; x += 58) {
        ctx.beginPath();
        ctx.moveTo(x, y + 7);
        ctx.lineTo(x, y + 25);
        ctx.stroke();
    }

    // the swing door at the open end that customers come through
    ctx.fillStyle = 'rgba(255, 198, 112, 0.14)';
    ctx.fillRect(x1 - 10, y - 54, 10, 47);
    ctx.fillStyle = 'rgba(255, 198, 112, 0.3)';
    ctx.fillRect(x1 - 10, y - 54, 10, 3);
}

function drawTaps() {
    for (let i = 0; i < LANES; i++) {
        const y = laneY(i);
        const x = TAP_X - 24;
        const active = i === bartender.lane;
        const pulled = active && bartender.pourAnim > 0;

        // base plate bolted to the bar
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(x - 10, y - 10, 22, 8);
        const metal = ctx.createLinearGradient(x - 9, 0, x + 11, 0);
        metal.addColorStop(0, '#5a4019');
        metal.addColorStop(0.45, active ? '#e5bb63' : '#a37c35');
        metal.addColorStop(1, '#5a4019');
        ctx.fillStyle = metal;
        roundRect(x - 9, y - 14, 20, 10, 3);
        ctx.fill();

        // post and the spout arching over the counter
        ctx.fillStyle = metal;
        roundRect(x - 4, y - 44, 9, 32, 4);
        ctx.fill();
        ctx.strokeStyle = active ? '#e5bb63' : '#a37c35';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y - 42);
        ctx.quadraticCurveTo(x + 22, y - 44, TAP_X, y - 28);
        ctx.stroke();

        // handle, pulled down while pouring
        ctx.strokeStyle = active ? '#ffd08a' : '#8f6a2c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, y - 42);
        ctx.lineTo(x - (pulled ? 12 : 7), y - (pulled ? 50 : 56));
        ctx.stroke();
        ctx.fillStyle = active ? '#ffb43d' : '#7a5a26';
        ctx.beginPath();
        ctx.arc(x - (pulled ? 12 : 7), y - (pulled ? 52 : 58), 4.5, 0, Math.PI * 2);
        ctx.fill();

        if (pulled) {
            ctx.fillStyle = 'rgba(255, 190, 96, 0.9)';
            ctx.fillRect(TAP_X - 3, y - 26, 4, 18);
        }
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const x = TAP_X - 62;
    const t = performance.now() / 1000;
    const idle = Math.sin(t * 2.4) * 1.2;
    const lean = bartender.pourAnim > 0 ? 5 : 0;
    const lift = bartender.catchAnim > 0 ? -4 : 0;
    const base = y + 6 + idle + lift;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
    ctx.beginPath();
    ctx.ellipse(x, y + 20, 20, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.fillStyle = '#2b3542';
    ctx.fillRect(x - 10, base - 16, 7, 18);
    ctx.fillRect(x + 3, base - 16, 7, 18);

    // torso and apron
    ctx.fillStyle = '#39506b';
    roundRect(x - 14 + lean, base - 46, 28, 32, 7);
    ctx.fill();
    ctx.fillStyle = '#efe6d2';
    roundRect(x - 11 + lean, base - 28, 22, 20, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(x - 11 + lean, base - 20, 22, 2);

    // arm on the tap handle
    ctx.strokeStyle = '#f0c9a0';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 9 + lean, base - 40);
    ctx.lineTo(TAP_X - 32, y - 48);
    ctx.stroke();

    // head, face and cap
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x + lean, base - 58, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d12';
    ctx.fillRect(x + 3 + lean, base - 60, 3, 3);
    ctx.fillStyle = '#ffb43d';
    roundRect(x - 13 + lean, base - 72, 26, 9, 3);
    ctx.fill();
    ctx.fillStyle = '#e09b22';
    ctx.fillRect(x + lean, base - 65, 16, 4);

    if (bartender.catchAnim > 0) {
        drawGlass(x + 20 + lean, base - 30, false, 0.9);
    }
}

function drawGlass(x, y, full, scale) {
    const w = 15 * scale;
    const h = 21 * scale;
    const top = y - h;

    // handle
    ctx.strokeStyle = full ? 'rgba(255, 233, 185, 0.9)' : 'rgba(206, 228, 238, 0.7)';
    ctx.lineWidth = 2.5 * scale;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 3 * scale, y - h / 2, 5 * scale, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // glass body
    const body = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    if (full) {
        body.addColorStop(0, '#c9741d');
        body.addColorStop(0.4, '#ffbe55');
        body.addColorStop(1, '#b4620f');
    } else {
        body.addColorStop(0, 'rgba(150, 186, 200, 0.42)');
        body.addColorStop(0.4, 'rgba(226, 244, 250, 0.52)');
        body.addColorStop(1, 'rgba(140, 176, 190, 0.42)');
    }
    ctx.fillStyle = body;
    roundRect(x - w / 2, top, w, h, 3 * scale);
    ctx.fill();
    ctx.strokeStyle = full ? 'rgba(255, 241, 208, 0.85)' : 'rgba(221, 240, 247, 0.8)';
    ctx.lineWidth = 1.5;
    roundRect(x - w / 2, top, w, h, 3 * scale);
    ctx.stroke();

    // a lit edge so the glass reads against the wood
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x - w / 2 + 2 * scale, top + 4 * scale, 2 * scale, h - 8 * scale);

    if (full) {
        ctx.fillStyle = '#fff7e8';
        roundRect(x - w / 2 - 1, top - 5 * scale, w + 2, 8 * scale, 4 * scale);
        ctx.fill();
    }
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const walk = c.state === 'walking' ? Math.sin((c.x + c.bob) / 6) : 0;
    const bob = c.state === 'walking' ? Math.abs(walk) * 2 : 0;
    const base = y - bob;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(c.x, y + 1, 17, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs, swinging when walking
    ctx.strokeStyle = '#2d2a3a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x - 4, base - 16);
    ctx.lineTo(c.x - 4 - walk * 4, base);
    ctx.moveTo(c.x + 4, base - 16);
    ctx.lineTo(c.x + 4 + walk * 4, base);
    ctx.stroke();

    // torso
    ctx.fillStyle = c.tint;
    roundRect(c.x - 12, base - 40, 24, 26, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(c.x - 12, base - 20, 24, 6);

    // head
    ctx.fillStyle = '#eec49b';
    ctx.beginPath();
    ctx.arc(c.x, base - 49, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1d';
    roundRect(c.x - 10, base - 58, 20, 7, 3);
    ctx.fill();

    if (c.state === 'walking') {
        // thirsty: eyes forward, hand drumming the bar
        ctx.fillStyle = '#2b1d12';
        ctx.fillRect(c.x - 7, base - 50, 3, 3);
        ctx.strokeStyle = '#eec49b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(c.x - 10, base - 34);
        ctx.lineTo(c.x - 17, base - 16 + Math.sin(c.x / 3) * 3);
        ctx.stroke();
    } else if (c.state === 'drinking') {
        ctx.strokeStyle = '#eec49b';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(c.x - 9, base - 34);
        ctx.lineTo(c.x - 15, base - 44);
        ctx.stroke();
        drawGlass(c.x - 17, base - 40, true, 0.85);
        ctx.fillStyle = 'rgba(255, 246, 226, 0.8)';
        ctx.beginPath();
        ctx.arc(c.x + 10, base - 60, 2.5, 0, Math.PI * 2);
        ctx.arc(c.x + 15, base - 67, 1.8, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = '#ffd08a';
        ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('\u266a', c.x + 17, base - 52);
        ctx.fillStyle = '#2b1d12';
        ctx.fillRect(c.x + 4, base - 50, 3, 3);
    }
}

function drawMug(m) {
    const y = laneY(m.lane);

    if (m.full) {
        // a wet streak trailing back towards the tap
        ctx.fillStyle = 'rgba(255, 196, 108, 0.16)';
        ctx.fillRect(m.x - 26, y - 5, 24, 4);
        drawGlass(m.x, y - 3, true, 1);
        return;
    }

    if (m.resting) {
        const left = Math.max(0, m.timer / CATCH_GRACE);
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
        const halo = ctx.createRadialGradient(m.x, y - 10, 2, m.x, y - 10, 30);
        halo.addColorStop(0, `rgba(255, 180, 61, ${0.2 + 0.3 * pulse})`);
        halo.addColorStop(1, 'rgba(255, 180, 61, 0)');
        ctx.fillStyle = halo;
        ctx.fillRect(m.x - 32, y - 42, 64, 52);
        drawGlass(m.x, y - 3, false, 1);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(m.x - 15, y + 7, 30, 4);
        ctx.fillStyle = left > 0.35 ? '#8ad6a0' : '#e8734f';
        ctx.fillRect(m.x - 15, y + 7, 30 * left, 4);
        return;
    }

    ctx.fillStyle = 'rgba(214, 232, 240, 0.13)';
    ctx.fillRect(m.x + 4, y - 5, 24, 4);
    drawGlass(m.x, y - 3, false, 1);
}

function drawShard(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.spin);
    ctx.fillStyle = `rgba(226, 240, 246, ${Math.max(0, Math.min(1, s.life / SHARD_LIFE))})`;
    ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
}

function drawCombo() {
    if (combo < 2) return;
    // down on the floor, clear of the top counter's customers
    const y = CANVAS_H - 48;
    ctx.fillStyle = 'rgba(255, 180, 61, 0.16)';
    roundRect(CANVAS_W - 146, y, 120, 32, 16);
    ctx.fill();
    ctx.fillStyle = '#ffb43d';
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`COMBO x${combo}`, CANVAS_W - 86, y + 16);
}

function drawNotice() {
    if (notice <= 0) return;
    const a = Math.min(1, notice / 0.4);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * a})`;
    roundRect(CANVAS_W / 2 - 170, CANVAS_H / 2 - 24, 340, 44, 22);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 128, 96, ${a})`;
    ctx.font = 'bold 20px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(noticeText, CANVAS_W / 2, CANVAS_H / 2 - 1);
}

function drawFlash() {
    if (flash <= 0) return;
    const a = Math.min(1, flash / 0.5);
    ctx.fillStyle = `rgba(255, 180, 61, ${a})`;
    ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(flashText, CANVAS_W / 2, CANVAS_H - 32);
}

function draw() {
    drawRoom();
    for (let i = 0; i < LANES; i++) drawCounter(i);
    drawTaps();
    drawBartender();
    for (const c of customers) drawCustomer(c);
    for (const m of mugs) drawMug(m);
    for (const s of shards) drawShard(s);
    drawCombo();
    drawNotice();
    drawFlash();

    if (hitFlash > 0) {
        ctx.fillStyle = `rgba(255, 86, 56, ${0.3 * Math.min(1, hitFlash / 0.5)})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
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
        return;
    }
    if (k >= '1' && k <= String(LANES)) {
        setLane(Number(k) - 1);
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    setLane(laneAt(y));
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

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
loadLevel(1);
state = 'idle';
updateHud();
showOverlay('SODA RUSH', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
