// Soda Tapper — four counters, one soda jerk, and mugs going both ways.
//
// The simulation is one axis per counter: a lane index plus an x. Everything
// moves inside physicsStep(), which the animation loop calls at a fixed
// timestep while `autoRun` is on, and the interesting state (state, score,
// lives, customers, mugs, server) is kept at the top level on purpose — the
// Playwright suite drives the game through exactly these names. See DESIGN.md
// for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 760
const H = canvas.height;             // 600
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const LANES = 4;
const LANE_TOP = 105;                // y of the first counter
const LANE_GAP = 120;                // spacing between counters

const BAR_LEFT = 70;                 // door end: customers enter, full mugs die
const TAP_X = 650;                   // tap line: mugs start here, empties end here
const GRAB_X = 620;                  // a customer this far up grabs you
const CLOSE_X = 480;                 // serving past here pays the close-call bonus
const SERVER_X = 698;                // where the soda jerk stands

const MUG_SPEED = 260;               // px/s, a full mug sliding left
const EMPTY_SPEED = 190;             // px/s, an empty mug sliding back right
const RETREAT_SPEED = 110;           // px/s, a served customer walking out
const DRINK_TIME = 1.0;              // seconds a customer stands and drinks
const POUR_COOLDOWN = 0.3;           // seconds between pours
const CATCH_RANGE = 16;              // px, how close a mug gets before it's taken

const SERVE_POINTS = 50;
const CLOSE_BONUS = 50;
const CATCH_POINTS = 25;
const LIVES_START = 3;
const WAVE_COUNT = 5;

const BEST_KEY = 'sodatapper-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | wavecomplete | gameover | won
let score = 0;
let lives = LIVES_START;
let wave = 1;
let served = 0;                      // customers served this run
let caught = 0;                      // empty mugs caught this run
let best = loadBest();
let autoRun = true;                  // the animation loop only simulates while true
let waveTimer = 0;                   // simulated seconds since the wave began
let pourTimer = 0;                   // cooldown left on the taps
let clock = 0;                       // cosmetic, drives the idle animations

const server = { lane: 1 };
const customers = [];                // { lane, x, phase, drinkTimer }
const mugs = [];                     // { lane, x, kind: 'full' | 'empty' }
const spawnQueue = [];               // { lane, t } entries still to arrive
const splashes = [];                 // cosmetic shards from a smashed mug

const CUSTOMER_TINTS = ['#7ad7ff', '#ffa1c4', '#c4b2ff', '#9ce8a8', '#ffcf6b'];

function laneY(i) {
    return LANE_TOP + i * LANE_GAP;
}

function customerSpeed(n) {
    return 26 + 7 * n;
}

function waveBonus() {
    return 100 * wave + 50 * lives;
}

// --- waves -----------------------------------------------------------------

// The schedule for a wave is drawn from a small LCG seeded from the wave number
// alone, so wave 3 is always the same wave 3 and a test never has to stub the
// randomness out. Consecutive arrivals never share a lane, which keeps a wave
// from degenerating into one very long queue on one counter.
function buildWave(n) {
    let seed = (n * 7919 + 104729) % 2147483647;
    const rand = () => {
        seed = (seed * 48271) % 2147483647;
        return seed / 2147483647;
    };

    const count = 6 + 2 * n;
    const gap = Math.max(0.9, 2.6 - 0.3 * n);
    const out = [];
    let t = 1;
    let lane = Math.floor(rand() * LANES);

    for (let i = 0; i < count; i++) {
        out.push({ lane, t: Math.round(t * 100) / 100 });
        t += gap * (0.6 + rand() * 0.8);
        lane = (lane + 1 + Math.floor(rand() * (LANES - 1))) % LANES;
    }
    return out;
}

function beginWave() {
    customers.length = 0;
    mugs.length = 0;
    splashes.length = 0;
    spawnQueue.length = 0;
    buildWave(wave).forEach((s) => spawnQueue.push(s));
    waveTimer = 0;
    pourTimer = 0;
    state = 'running';
    syncOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = LIVES_START;
    wave = 1;
    served = 0;
    caught = 0;
    server.lane = 1;
    beginWave();
}

function nextWave() {
    wave += 1;
    beginWave();
}

// Space / click / the Start button all land here.
function advance() {
    if (state === 'idle' || state === 'gameover' || state === 'won') startGame();
    else if (state === 'wavecomplete') nextWave();
}

function togglePause() {
    if (state === 'running') state = 'paused';
    else if (state === 'paused') state = 'running';
    else return;
    syncOverlay();
}

// --- player actions --------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return false;
    const next = Math.min(LANES - 1, Math.max(0, server.lane + delta));
    if (next === server.lane) return false;
    server.lane = next;
    return true;
}

function moveToLane(lane) {
    if (state !== 'running') return false;
    const next = Math.min(LANES - 1, Math.max(0, lane));
    if (next === server.lane) return false;
    server.lane = next;
    return true;
}

function pour() {
    if (state !== 'running' || pourTimer > 0) return false;
    mugs.push({ lane: server.lane, x: TAP_X, kind: 'full' });
    pourTimer = POUR_COOLDOWN;
    return true;
}

// --- simulation ------------------------------------------------------------

function frontmostThirsty(lane) {
    let front = null;
    for (const c of customers) {
        if (c.lane !== lane || c.phase !== 'advancing') continue;
        if (!front || c.x > front.x) front = c;
    }
    return front;
}

function splash(x, lane, color) {
    const y = laneY(lane) + TOP_Y + 4;   // on the counter top, where the mug broke
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        splashes.push({
            x,
            y,
            lane,
            vx: Math.cos(a) * (40 + (i % 3) * 25),
            vy: Math.sin(a) * (30 + (i % 4) * 18) - 40,
            life: 0.55,
            max: 0.55,
            color,
        });
    }
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endRun('gameover');
    }
}

function endRun(result) {
    state = result;
    saveBest();
    syncOverlay();
    updateHud();
}

function serve(customer, mugIndex) {
    mugs.splice(mugIndex, 1);
    customer.phase = 'drinking';
    customer.drinkTimer = DRINK_TIME;
    score += SERVE_POINTS + (customer.x > CLOSE_X ? CLOSE_BONUS : 0);
    served += 1;
}

function updateMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const m = mugs[i];

        if (m.kind === 'full') {
            m.x -= MUG_SPEED * dt;
            const target = frontmostThirsty(m.lane);
            if (target && m.x <= target.x + CATCH_RANGE) {
                serve(target, i);
                continue;
            }
            if (m.x <= BAR_LEFT) {
                mugs.splice(i, 1);
                splash(BAR_LEFT, m.lane, '#ffb347');
                loseLife();
            }
            continue;
        }

        m.x += EMPTY_SPEED * dt;
        if (m.x >= TAP_X) {
            mugs.splice(i, 1);
            if (server.lane === m.lane) {
                score += CATCH_POINTS;
                caught += 1;
            } else {
                splash(TAP_X, m.lane, '#cfe3ff');
                loseLife();
            }
        }
    }
}

function updateCustomers(dt) {
    const speed = customerSpeed(wave);

    for (let i = customers.length - 1; i >= 0; i--) {
        const c = customers[i];

        if (c.phase === 'advancing') {
            c.x += speed * dt;
            if (c.x >= GRAB_X) {
                customers.splice(i, 1);
                splash(GRAB_X, c.lane, '#ff5f6d');
                loseLife();
            }
        } else if (c.phase === 'drinking') {
            c.drinkTimer -= dt;
            if (c.drinkTimer <= 0) {
                // The empty mug is released from wherever the customer stood.
                // Mugs are stepped before customers, so it starts moving on the
                // next step rather than jumping forward on this one.
                c.phase = 'leaving';
                mugs.push({ lane: c.lane, x: c.x, kind: 'empty' });
            }
        } else {
            c.x -= RETREAT_SPEED * dt;
            if (c.x <= BAR_LEFT) customers.splice(i, 1);
        }
    }
}

function updateSplashes(dt) {
    for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        s.life -= dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 420 * dt;
        if (s.life <= 0) splashes.splice(i, 1);
    }
}

function checkWave() {
    if (state !== 'running') return;
    if (spawnQueue.length || customers.length || mugs.length) return;

    score += waveBonus();
    if (wave >= WAVE_COUNT) {
        endRun('won');
    } else {
        state = 'wavecomplete';
        syncOverlay();
    }
}

function physicsStep(dt) {
    if (state !== 'running') return;

    clock += dt;
    pourTimer = Math.max(0, pourTimer - dt);
    waveTimer += dt;

    while (spawnQueue.length && spawnQueue[0].t <= waveTimer) {
        const s = spawnQueue.shift();
        customers.push({
            lane: s.lane,
            x: BAR_LEFT - 24,
            phase: 'advancing',
            drinkTimer: 0,
            tint: CUSTOMER_TINTS[(customers.length + s.lane) % CUSTOMER_TINTS.length],
        });
    }

    updateMugs(dt);
    updateCustomers(dt);
    updateSplashes(dt);
    checkWave();
    updateHud();
}

// --- best score ------------------------------------------------------------

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* private browsing — the run just isn't remembered */
    }
}

// --- HUD and overlay -------------------------------------------------------

const hud = {
    score: document.getElementById('score'),
    wave: document.getElementById('wave'),
    lives: document.getElementById('lives'),
    served: document.getElementById('served'),
    best: document.getElementById('best'),
};

const shown = {};

function setText(el, key, value) {
    const text = String(value);
    if (shown[key] === text) return;
    shown[key] = text;
    el.textContent = text;
}

function updateHud() {
    setText(hud.score, 'score', score);
    setText(hud.wave, 'wave', wave);
    setText(hud.lives, 'lives', lives);
    setText(hud.served, 'served', served);
    setText(hud.best, 'best', best);
}

const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const OVERLAY_TEXT = {
    idle: {
        title: 'SODA TAPPER',
        sub: 'Press Space or click Start to play',
        button: 'Start Game',
    },
    paused: { title: 'PAUSED', sub: 'Press P to get back behind the bar', button: 'Resume' },
    wavecomplete: { title: 'WAVE CLEARED', sub: 'Press Space for the next wave', button: 'Next Wave' },
    gameover: { title: 'GAME OVER', sub: 'Press Space to open up again', button: 'Play Again' },
    won: { title: 'CLOSING TIME!', sub: 'Every wave served. Press Space to go again', button: 'Play Again' },
};

function syncOverlay() {
    if (state === 'running') {
        overlay.classList.remove('visible');
        return;
    }

    const copy = OVERLAY_TEXT[state] || OVERLAY_TEXT.idle;
    overlayTitle.textContent = state === 'wavecomplete' ? `WAVE ${wave} CLEARED` : copy.title;
    overlaySub.textContent = copy.sub;
    btnStart.textContent = copy.button;

    if (state === 'idle') overlayScore.textContent = '';
    else if (state === 'wavecomplete') {
        overlayScore.textContent = `Score ${score} — bonus ${waveBonus()} — ${lives} ${lives === 1 ? 'life' : 'lives'} left`;
    } else {
        overlayScore.textContent = `Score ${score} — ${served} served, ${caught} mugs caught`;
    }

    overlay.classList.add('visible');
}

// --- rendering -------------------------------------------------------------
//
// A lane is drawn back to front: booth wall, door, the people standing behind
// the bar, then the counter itself (which hides their legs and gives the scene
// its depth), then whatever is sliding along the counter top.

const FEET_DROP = 18;                // figure's feet, relative to the lane y
const TOP_Y = 10;                    // counter top surface, relative to lane y
const TOP_H = 12;
const FRONT_H = 22;                  // the counter's front face below that

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b1233');
    g.addColorStop(0.75, '#0d0819');
    g.addColorStop(1, '#070510');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // tiled back wall
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.022)';
    ctx.lineWidth = 1;
    for (let x = 19; x <= W; x += 38) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, H);
        ctx.stroke();
    }

    // the floor in front of the bottom counter
    const floorY = laneY(LANES - 1) + 56;
    ctx.fillStyle = '#0a0714';
    ctx.fillRect(0, floorY, W, H - floorY);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.022)';
    for (let x = 0; x < W; x += 56) {
        for (let y = floorY; y < H; y += 28) {
            if (((x / 56) + (y - floorY) / 28) % 2 < 1) ctx.fillRect(x, y, 56, 28);
        }
    }
    ctx.fillStyle = 'rgba(90, 209, 255, 0.12)';
    ctx.fillRect(0, floorY, W, 2);
}

function drawBooth(i) {
    const y = laneY(i);
    const active = i === server.lane;

    const wall = ctx.createLinearGradient(0, y - 66, 0, y + TOP_Y + FRONT_H);
    wall.addColorStop(0, active ? '#2a1b4a' : '#1a1133');
    wall.addColorStop(1, active ? '#160e2b' : '#110a21');
    ctx.fillStyle = wall;
    roundRect(8, y - 66, TAP_X + 4, 66 + TOP_Y + FRONT_H, 10);
    ctx.fill();

    ctx.strokeStyle = active ? 'rgba(255, 179, 71, 0.3)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = active ? 2 : 1;
    roundRect(8, y - 66, TAP_X + 4, 66 + TOP_Y + FRONT_H, 10);
    ctx.stroke();

    // doorway the customers come through
    ctx.fillStyle = '#0b0718';
    roundRect(18, y - 56, 48, 78, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 209, 255, 0.45)';
    ctx.lineWidth = 2;
    roundRect(18, y - 56, 48, 78, 6);
    ctx.stroke();

    // light spilling out of the doorway onto the counter
    const spill = ctx.createLinearGradient(66, 0, 190, 0);
    spill.addColorStop(0, 'rgba(90, 209, 255, 0.12)');
    spill.addColorStop(1, 'rgba(90, 209, 255, 0)');
    ctx.fillStyle = spill;
    ctx.fillRect(66, y - 56, 124, 78);

    ctx.fillStyle = 'rgba(90, 209, 255, 0.7)';
    ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('IN', 42, y - 42);
}

function drawCounter(i) {
    const y = laneY(i);
    const active = i === server.lane;
    const x0 = 40;
    const x1 = TAP_X + 12;

    // top surface
    const top = ctx.createLinearGradient(0, y + TOP_Y, 0, y + TOP_Y + TOP_H);
    top.addColorStop(0, active ? '#d2a05f' : '#b4854b');
    top.addColorStop(1, active ? '#9a6a33' : '#7d5428');
    ctx.fillStyle = top;
    ctx.fillRect(x0, y + TOP_Y, x1 - x0, TOP_H);

    // front face
    const front = ctx.createLinearGradient(0, y + TOP_Y + TOP_H, 0, y + TOP_Y + TOP_H + FRONT_H);
    front.addColorStop(0, '#5c3a1b');
    front.addColorStop(1, '#2c1a0c');
    ctx.fillStyle = front;
    ctx.fillRect(x0, y + TOP_Y + TOP_H, x1 - x0, FRONT_H);

    // grain on the front face
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    for (let x = x0 + 18; x < x1; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, y + TOP_Y + TOP_H + 3);
        ctx.lineTo(x + 0.5, y + TOP_Y + TOP_H + FRONT_H - 3);
        ctx.stroke();
    }

    // lacquer highlight along the lip
    ctx.fillStyle = active ? 'rgba(255, 232, 186, 0.6)' : 'rgba(255, 232, 186, 0.25)';
    ctx.fillRect(x0, y + TOP_Y, x1 - x0, 2);

    // the danger end of the counter, where a customer can reach you
    const warn = ctx.createLinearGradient(CLOSE_X, 0, GRAB_X, 0);
    warn.addColorStop(0, 'rgba(255, 95, 109, 0)');
    warn.addColorStop(1, 'rgba(255, 95, 109, 0.28)');
    ctx.fillStyle = warn;
    ctx.fillRect(CLOSE_X, y + TOP_Y, GRAB_X - CLOSE_X, TOP_H);
}

function drawTapStation() {
    const panel = ctx.createLinearGradient(TAP_X, 0, W, 0);
    panel.addColorStop(0, '#30204a');
    panel.addColorStop(1, '#150d24');
    ctx.fillStyle = panel;
    ctx.fillRect(TAP_X + 12, 0, W - TAP_X - 12, H);
    ctx.fillStyle = 'rgba(90, 209, 255, 0.3)';
    ctx.fillRect(TAP_X + 12, 0, 2, H);

    for (let i = 0; i < LANES; i++) {
        const y = laneY(i);
        const lit = i === server.lane;
        const cx = TAP_X + 30;
        const base = y + TOP_Y + 10;

        // mounting block on the counter end
        ctx.fillStyle = '#241634';
        roundRect(cx - 14, base - 10, 28, 12, 4);
        ctx.fill();

        // chrome column
        ctx.fillStyle = '#8e9bb8';
        roundRect(cx - 7, base - 48, 14, 40, 6);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(cx - 4, base - 45, 3, 34);

        // spout reaching back over the counter
        ctx.fillStyle = '#8e9bb8';
        roundRect(cx - 26, base - 30, 22, 7, 3);
        ctx.fill();
        ctx.fillStyle = '#6f7d9c';
        roundRect(cx - 26, base - 24, 7, 9, 3);
        ctx.fill();

        // handle
        ctx.fillStyle = lit ? '#ffb347' : '#5d4f7a';
        roundRect(cx - 4, base - 64, 8, 18, 4);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, base - 66, 5, 0, Math.PI * 2);
        ctx.fill();

        if (lit && pourTimer > 0) {
            ctx.fillStyle = 'rgba(232, 160, 70, 0.9)';
            ctx.fillRect(cx - 25, base - 16, 5, 16);
        }
    }
}

function drawServer() {
    const y = laneY(server.lane);
    const f = y + FEET_DROP;
    const bob = Math.sin(clock * 6) * 1.5;
    const x = SERVER_X;

    ctx.save();
    ctx.translate(0, bob);

    // glow so the counter you are standing at reads at a glance
    const glow = ctx.createRadialGradient(x, f - 26, 4, x, f - 26, 48);
    glow.addColorStop(0, 'rgba(255, 179, 71, 0.3)');
    glow.addColorStop(1, 'rgba(255, 179, 71, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 52, f - 78, 104, 104);

    // legs
    ctx.strokeStyle = '#2b2142';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 6, f - 16);
    ctx.lineTo(x - 6, f);
    ctx.moveTo(x + 6, f - 16);
    ctx.lineTo(x + 6, f);
    ctx.stroke();

    // shirt and apron
    ctx.fillStyle = '#f6f3ff';
    roundRect(x - 15, f - 44, 30, 30, 9);
    ctx.fill();
    ctx.fillStyle = '#5ad1ff';
    roundRect(x - 13, f - 26, 26, 14, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(x - 13, f - 26, 26, 2);

    // arm on the tap handle
    ctx.strokeStyle = '#ffd9b3';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 10, f - 38);
    ctx.lineTo(TAP_X + 32, f - 54);
    ctx.stroke();

    // head and soda-jerk cap
    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath();
    ctx.arc(x, f - 55, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2b1d';
    ctx.fillRect(x - 4, f - 57, 2, 2);
    ctx.fillRect(x + 3, f - 57, 2, 2);
    ctx.fillStyle = '#ffb347';
    roundRect(x - 12, f - 69, 24, 9, 4);
    ctx.fill();
    ctx.fillStyle = '#ffc978';
    ctx.fillRect(x - 16, f - 62, 9, 3);

    ctx.restore();
}

function drawMugGlass(x, base, kind) {
    const h = 24;
    const w = 18;
    const top = base - h;

    // the glass body
    roundRect(x - w / 2, top, w, h, 4);
    ctx.save();
    ctx.clip();

    if (kind === 'full') {
        const soda = ctx.createLinearGradient(0, top + 7, 0, base);
        soda.addColorStop(0, '#e8a046');
        soda.addColorStop(1, '#b85f18');
        ctx.fillStyle = soda;
        ctx.fillRect(x - w / 2, top + 7, w, h - 7);

        // foam head
        ctx.fillStyle = '#fff6e8';
        ctx.fillRect(x - w / 2, top, w, 8);
        ctx.beginPath();
        ctx.arc(x - 4, top + 8, 4, 0, Math.PI * 2);
        ctx.arc(x + 4, top + 8, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // bubbles
        ctx.fillStyle = 'rgba(255, 246, 232, 0.65)';
        ctx.beginPath();
        ctx.arc(x - 3, top + 15, 1.6, 0, Math.PI * 2);
        ctx.arc(x + 3, top + 19, 1.3, 0, Math.PI * 2);
        ctx.arc(x + 1, top + 12, 1, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(190, 212, 240, 0.16)';
        ctx.fillRect(x - w / 2, top, w, h);
        // the dregs of the last soda
        ctx.fillStyle = 'rgba(184, 95, 24, 0.5)';
        ctx.fillRect(x - w / 2, base - 4, w, 4);
    }

    // glass highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(x - w / 2 + 3, top + 2, 2.5, h - 5);
    ctx.restore();

    // rim and handle
    ctx.strokeStyle = kind === 'full' ? 'rgba(244, 250, 255, 0.95)' : 'rgba(205, 222, 245, 0.7)';
    ctx.lineWidth = 2;
    roundRect(x - w / 2, top, w, h, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + w / 2 + 3, base - 13, 6, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawMug(m) {
    const y = laneY(m.lane);
    const base = y + TOP_Y + 9;

    // shadow on the counter top
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(m.x + 1, base + 1, 11, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    drawMugGlass(m.x, base, m.kind);
}

function drawCustomer(c) {
    const y = laneY(c.lane);
    const f = y + FEET_DROP;
    const tint = c.tint || '#7ad7ff';
    const impatient = c.phase === 'advancing' && c.x > CLOSE_X;
    const step = c.phase === 'advancing' ? Math.sin(clock * 7 + c.x * 0.05) * 2 : 0;

    if (impatient) {
        const pulse = 0.16 + 0.12 * Math.sin(clock * 9);
        ctx.fillStyle = `rgba(255, 95, 109, ${pulse})`;
        ctx.beginPath();
        ctx.ellipse(c.x, f - 22, 24, 36, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // legs (the counter hides the lower half of them)
    ctx.strokeStyle = '#241b3a';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c.x - 5 - step, f - 16);
    ctx.lineTo(c.x - 5 - step * 2, f);
    ctx.moveTo(c.x + 5 + step, f - 16);
    ctx.lineTo(c.x + 5 + step * 2, f);
    ctx.stroke();

    // torso
    ctx.fillStyle = c.phase === 'leaving' ? '#8fe0a0' : tint;
    roundRect(c.x - 11, f - 40, 22, 26, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    roundRect(c.x - 11, f - 22, 22, 8, 4);
    ctx.fill();

    // arms
    ctx.strokeStyle = '#ffd9b3';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(c.x - 10, f - 34);
    ctx.lineTo(c.x - 14 - step, f - 20);
    ctx.moveTo(c.x + 10, f - 34);
    ctx.lineTo(c.x + (c.phase === 'drinking' ? 14 : 14 + step), f - (c.phase === 'drinking' ? 30 : 20));
    ctx.stroke();

    // head
    ctx.fillStyle = '#ffd9b3';
    ctx.beginPath();
    ctx.arc(c.x, f - 49, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2b1d';
    roundRect(c.x - 9, f - 58, 18, 6, 3);
    ctx.fill();

    // eyes, and a frown that turns into a smile on the way out
    ctx.fillStyle = '#3b2b1d';
    const look = c.phase === 'leaving' ? -2 : 2;
    ctx.fillRect(c.x - 4 + look, f - 51, 2, 2);
    ctx.fillRect(c.x + 2 + look, f - 51, 2, 2);
    ctx.strokeStyle = '#3b2b1d';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (c.phase === 'leaving') ctx.arc(c.x, f - 46, 3.5, 0.15 * Math.PI, 0.85 * Math.PI);
    else ctx.arc(c.x, f - 42, 3.5, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();

    if (c.phase === 'drinking') {
        drawMugGlass(c.x + 16, f - 20, 'full');
        ctx.fillStyle = 'rgba(255, 244, 226, 0.8)';
        for (let i = 0; i < 3; i++) {
            const t = (clock * 1.6 + i * 0.33) % 1;
            ctx.beginPath();
            ctx.arc(c.x + 16 + Math.sin((t + i) * 6) * 3, f - 44 - t * 14, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (c.phase === 'advancing') {
        // a little "where's my soda" bubble
        const bx = c.x + 14;
        const by = f - 70;
        ctx.fillStyle = impatient ? 'rgba(255, 95, 109, 0.9)' : 'rgba(255, 255, 255, 0.16)';
        roundRect(bx, by, 22, 16, 6);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(bx + 5, by + 15);
        ctx.lineTo(bx + 3, by + 21);
        ctx.lineTo(bx + 11, by + 15);
        ctx.fill();

        ctx.fillStyle = impatient ? '#2a0a0e' : 'rgba(255, 179, 71, 0.95)';
        ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(impatient ? '!!' : '?', bx + 11, by + 12);
    }
}

function drawSplash(s) {
    const a = Math.max(0, s.life / s.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 2, s.y - 2, 4 + a * 2, 4 + a * 2);
    ctx.globalAlpha = 1;
}

function drawWaveMeter() {
    const total = buildWave(wave).length;
    const left = spawnQueue.length + customers.filter((c) => c.phase === 'advancing').length;
    const done = Math.max(0, total - left);
    const w = 160;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundRect(20, 22, w, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#5ad1ff';
    roundRect(20, 22, Math.max(3, (w * done) / total), 10, 5);
    ctx.fill();

    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(243, 236, 255, 0.6)';
    ctx.textAlign = 'left';
    ctx.fillText(`WAVE ${wave} / ${WAVE_COUNT}`, 20, 50);

    ctx.textAlign = 'right';
    for (let i = 0; i < LIVES_START; i++) {
        const x = W - 26 - i * 18;
        ctx.fillStyle = i < lives ? '#ffb347' : 'rgba(255, 179, 71, 0.2)';
        ctx.beginPath();
        ctx.arc(x, 28, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(243, 236, 255, 0.6)';
    ctx.fillText('LIVES', W - 20, 50);
}

function draw() {
    drawBackground();

    for (let i = 0; i < LANES; i++) {
        drawBooth(i);
        customers.filter((c) => c.lane === i).forEach(drawCustomer);
        drawCounter(i);
        mugs.filter((m) => m.lane === i).forEach(drawMug);
        splashes.filter((s) => s.lane === i).forEach(drawSplash);
    }

    drawTapStation();
    drawServer();
    drawWaveMeter();
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            if (state === 'running') pour();
            else advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            moveLane(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            moveLane(1);
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const y = (e.clientY - rect.top) * (H / rect.height);
    moveToLane(Math.round((y - LANE_TOP) / LANE_GAP));
});

canvas.addEventListener('click', () => {
    if (state === 'running') pour();
    else advance();
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else advance();
});

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
        clock += dt;
    }

    draw();
    requestAnimationFrame(frame);
}

updateHud();
syncOverlay();
draw();
requestAnimationFrame(frame);
