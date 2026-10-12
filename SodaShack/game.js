// Soda Shack — work the four counters of a soda bar: pour a mug down a lane to
// stop a thirsty patron, then be standing in the right lane when the empty
// comes sliding back.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, patrons, mugs, keeper) is kept at the
// top level on purpose: the Playwright suite drives the game through exactly
// these names. See DESIGN.md for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 520
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const LANES = 4;
const LANE_Y = [110, 212, 314, 416]; // centre line of each counter
const BAR_LEFT = 70;                 // door end: patrons walk in here
const BAR_RIGHT = 560;               // tap end: the barkeep's side
const TAP_X = BAR_RIGHT - 18;        // where a poured mug appears
const KEEPER_X = 596;                // the barkeep stands off the end of the bar

const MUG_R = 9;
const PATRON_R = 16;
const MUG_SPEED = 260;               // px/s, a full mug sliding toward the door
const EMPTY_SPEED = 200;             // px/s, an empty coming back to the taps
const POUR_COOLDOWN = 0.28;          // seconds the tap needs between mugs

const DRINK_TIME = 1.1;              // seconds a served patron spends drinking
const PUSHBACK = 70;                 // px a drinking patron slides back
const LEAVE_SPEED = 85;              // px/s on the way out

const SERVE_POINTS = 50;
const CATCH_POINTS = 25;
const START_LIVES = 3;

const SPAWN_GRACE = 1.2;             // quiet moment at the top of a shift
const RESPAWN_GRACE = 1.6;           // and a slightly longer one after a smash
const SPILL_LIFE = 1.2;              // seconds a smash mark stays on the floor

const LANE_TINT = ['#e2574c', '#6aa9f2', '#8bd46a', '#d58ae8'];

const BEST_KEY = 'sodashack-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let best = loadBest();
let patrons = [];                    // { lane, x, state, timer, targetX, speed, tint }
let mugs = [];                       // { lane, x, full }
let spills = [];                     // fading smash marks, cosmetic only
let toSpawn = 0;                      // patrons of this wave still to walk in
let spawnTimer = 0;                  // seconds until the next arrival
let pourTimer = 0;                   // seconds left on the tap cooldown
let rngState = 1;                    // lane order for the current shift
let autoRun = true;                  // the animation loop only simulates while true

const keeper = { lane: 0 };
const keys = Object.create(null);

// --- difficulty ------------------------------------------------------------

// A shift gets busier in three ways at once: more patrons, arriving closer
// together, walking faster. All three settle at a level a player can hold.
function patronsForLevel(n) {
    return Math.min(20, 5 + n);
}

function spawnInterval(n) {
    return Math.max(0.9, 2.6 - 0.18 * (n - 1));
}

function patronSpeed(n) {
    return Math.min(70, 26 + 4 * (n - 1));
}

function levelBonus() {
    return 100 * level + 50 * lives;
}

// A small deterministic generator so every shift deals the same lane order —
// the bar is a test of reflexes, not of luck, and the suite can replay a wave.
function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

function nextLane() {
    return Math.floor(rng() * LANES) % LANES;
}

// --- factories -------------------------------------------------------------

function makePatron(lane, x) {
    return {
        lane,
        x,
        state: 'walking',            // walking | drinking | leaving
        timer: 0,
        targetX: x,
        speed: patronSpeed(level),
        tint: LANE_TINT[lane % LANE_TINT.length],
    };
}

function makeMug(lane, x, full = true) {
    return { lane, x, full };
}

// --- game flow -------------------------------------------------------------

function loadLevel(n) {
    level = n;
    patrons = [];
    mugs = [];
    spills = [];
    toSpawn = patronsForLevel(n);
    spawnTimer = SPAWN_GRACE;
    pourTimer = 0;
    rngState = (n * 9781 + 1) >>> 0;
    keeper.lane = 0;
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    autoRun = true;
    loadLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

function levelClear() {
    score += levelBonus();
    state = 'levelclear';
    saveBest();
    updateHud();
    showOverlay('SHIFT CLEAR', `Score ${score}`, 'Press Space for the next shift');
}

function gameOver() {
    state = 'gameover';
    saveBest();
    updateHud();
    showOverlay('GAME OVER', `Score ${score}`, 'Press Space to open up again');
}

// A smash or a patron reaching the taps costs a life and resets the counters:
// the wave starts over at the same level, so nothing is half-served.
function loseLife() {
    lives = Math.max(0, lives - 1);
    patrons = [];
    mugs = [];
    pourTimer = 0;
    if (lives <= 0) {
        gameOver();
        return;
    }
    toSpawn = patronsForLevel(level);
    spawnTimer = RESPAWN_GRACE;
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P or Space to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// One button for everything the overlay offers, plus the pour while playing.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
            startGame();
            break;
        case 'levelclear':
            loadLevel(level + 1);
            state = 'running';
            hideOverlay();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            pour();
            break;
    }
}

// --- player actions --------------------------------------------------------

function setLane(i) {
    if (state !== 'running') return;
    if (typeof i !== 'number' || !Number.isFinite(i)) return;
    keeper.lane = Math.max(0, Math.min(LANES - 1, Math.round(i)));
}

function laneBy(delta) {
    setLane(keeper.lane + delta);
}

function laneAt(y) {
    let best_ = 0;
    for (let i = 1; i < LANES; i++) {
        if (Math.abs(y - LANE_Y[i]) < Math.abs(y - LANE_Y[best_])) best_ = i;
    }
    return best_;
}

function pour() {
    if (state !== 'running') return;
    if (pourTimer > 0) return;
    mugs.push(makeMug(keeper.lane, TAP_X, true));
    pourTimer = POUR_COOLDOWN;
}

// --- simulation ------------------------------------------------------------

function spawnPatron(lane) {
    patrons.push(makePatron(lane, BAR_LEFT));
}

function updateSpawning(dt) {
    if (toSpawn <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnPatron(nextLane());
    toSpawn--;
    spawnTimer = spawnInterval(level);
}

function movePatrons(dt) {
    for (const p of patrons) {
        if (p.state === 'walking') {
            p.x += p.speed * dt;
        } else if (p.state === 'drinking') {
            // Slide back over exactly the drink, so the push-back and the
            // empty mug land together.
            p.x = Math.max(p.targetX, p.x - (PUSHBACK / DRINK_TIME) * dt);
            p.timer -= dt;
            if (p.timer <= 0) {
                mugs.push(makeMug(p.lane, p.x, false));
                p.state = 'leaving';
            }
        } else {
            p.x -= LEAVE_SPEED * dt;
        }
    }
    patrons = patrons.filter((p) => p.state !== 'leaving' || p.x > BAR_LEFT - 40);
}

function moveMugs(dt) {
    for (const m of mugs) {
        m.x += (m.full ? -MUG_SPEED : EMPTY_SPEED) * dt;
    }
}

// A full mug is taken by the patron furthest up its lane — the one in most
// need of a drink.
function serveCollisions() {
    const taken = new Set();
    for (const m of mugs) {
        if (!m.full) continue;
        let target = null;
        for (const p of patrons) {
            if (p.lane !== m.lane || p.state !== 'walking' || taken.has(p)) continue;
            if (Math.abs(p.x - m.x) > MUG_R + PATRON_R) continue;
            if (!target || p.x > target.x) target = p;
        }
        if (!target) continue;
        taken.add(target);
        target.state = 'drinking';
        target.timer = DRINK_TIME;
        target.targetX = Math.max(BAR_LEFT, target.x - PUSHBACK);
        m.done = true;
        score += SERVE_POINTS;
    }
    mugs = mugs.filter((m) => !m.done);
}

// Mugs leave the bar at one of its two ends: a full one that nobody took runs
// off the door end and smashes; an empty one is a catch if the barkeep is
// standing in its lane, and a smash if not.
function resolveMugs() {
    const kept = [];
    let lost = 0;
    for (const m of mugs) {
        if (m.full) {
            if (m.x <= BAR_LEFT) {
                spill(m.x, m.lane);
                lost++;
            } else {
                kept.push(m);
            }
        } else if (m.x >= BAR_RIGHT) {
            if (m.lane === keeper.lane) {
                score += CATCH_POINTS;
            } else {
                spill(BAR_RIGHT, m.lane);
                lost++;
            }
        } else {
            kept.push(m);
        }
    }
    mugs = kept;
    for (let i = 0; i < lost && state === 'running'; i++) loseLife();
}

function checkPatronReach() {
    const reached = patrons.some((p) => p.state === 'walking' && p.x + PATRON_R >= BAR_RIGHT);
    if (reached) loseLife();
}

function spill(x, lane) {
    spills.push({ x, y: LANE_Y[lane], life: SPILL_LIFE });
}

function decaySpills(dt) {
    for (const s of spills) s.life -= dt;
    spills = spills.filter((s) => s.life > 0);
}

function waveComplete() {
    return toSpawn <= 0 && patrons.length === 0 && mugs.length === 0;
}

function physicsStep(dt) {
    if (state !== 'running') return;

    pourTimer = Math.max(0, pourTimer - dt);
    decaySpills(dt);

    updateSpawning(dt);
    movePatrons(dt);
    moveMugs(dt);

    serveCollisions();
    resolveMugs();
    if (state !== 'running') return;

    checkPatronReach();
    if (state !== 'running') return;

    if (waveComplete()) {
        levelClear();
        return;
    }
    updateHud();
}

// --- persistence -----------------------------------------------------------

function loadBest() {
    try {
        const raw = Number(window.localStorage.getItem(BEST_KEY));
        return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
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
        /* private mode — the run just will not be remembered */
    }
}

// --- HUD / overlay ---------------------------------------------------------

function remaining() {
    return toSpawn + patrons.filter((p) => p.state !== 'leaving').length;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('level', level);
    setText('lives', lives);
    setText('left', remaining());
    setText('best', best);
}

function showOverlay(title, scoreLine, sub) {
    setText('overlay-title', title);
    setText('overlay-score', scoreLine || '');
    setText('overlay-sub', sub || '');
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

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
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#241508');
    sky.addColorStop(1, '#0d0906');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // panelled back wall
    ctx.strokeStyle = 'rgba(255, 210, 150, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, H);
        ctx.stroke();
    }

    // back-bar shelf: bottles and a neon strip over the top counter
    ctx.fillStyle = 'rgba(14, 9, 6, 0.9)';
    roundRect(BAR_LEFT - 34, 14, BAR_RIGHT - BAR_LEFT + 60, 56, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(95, 211, 196, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BAR_LEFT - 22, 66);
    ctx.lineTo(BAR_RIGHT + 14, 66);
    ctx.stroke();
    for (let i = 0; i < 16; i++) {
        const bx = BAR_LEFT - 12 + i * 32;
        const tall = 20 + ((i * 7) % 16);
        ctx.fillStyle = ['#5fd3c4', '#f0a132', '#e2574c', '#8bd46a'][i % 4];
        ctx.globalAlpha = 0.55;
        roundRect(bx, 64 - tall, 10, tall, 3);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.fillRect(bx + 3.5, 64 - tall - 5, 3, 5);
        ctx.globalAlpha = 1;
    }

    // the door the patrons come through
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, BAR_LEFT - 34, H);
    ctx.save();
    ctx.translate(20, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(240, 161, 50, 0.45)';
    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D O O R', 0, 0);
    ctx.restore();
}

function drawCounters() {
    for (let i = 0; i < LANES; i++) {
        const y = LANE_Y[i];
        const top = y + 16;

        // counter slab
        const wood = ctx.createLinearGradient(0, top, 0, top + 26);
        wood.addColorStop(0, '#9a6434');
        wood.addColorStop(0.35, '#6f4522');
        wood.addColorStop(1, '#3a2312');
        ctx.fillStyle = wood;
        roundRect(BAR_LEFT - 34, top, BAR_RIGHT - BAR_LEFT + 60, 26, 6);
        ctx.fill();

        // polished front edge
        ctx.fillStyle = 'rgba(255, 224, 180, 0.22)';
        ctx.fillRect(BAR_LEFT - 34, top, BAR_RIGHT - BAR_LEFT + 60, 3);

        // sliding groove the mugs run along
        ctx.strokeStyle = 'rgba(255, 236, 200, 0.10)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(BAR_LEFT - 30, y + 13);
        ctx.lineTo(BAR_RIGHT + 18, y + 13);
        ctx.stroke();

        // lane badge at the tap end
        ctx.fillStyle = LANE_TINT[i];
        ctx.globalAlpha = keeper.lane === i && state === 'running' ? 0.95 : 0.35;
        roundRect(BAR_RIGHT + 6, y - 26, 6, 40, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function drawTaps() {
    const station = ctx.createLinearGradient(BAR_RIGHT, 0, W, 0);
    station.addColorStop(0, 'rgba(60, 40, 24, 0.0)');
    station.addColorStop(1, 'rgba(26, 18, 12, 0.95)');
    ctx.fillStyle = station;
    ctx.fillRect(BAR_RIGHT + 14, 0, W - BAR_RIGHT - 14, H);

    for (let i = 0; i < LANES; i++) {
        const y = LANE_Y[i];
        const hot = keeper.lane === i;
        ctx.strokeStyle = hot ? '#f0a132' : '#6d5436';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(TAP_X + 24, y - 34);
        ctx.lineTo(TAP_X + 24, y - 12);
        ctx.lineTo(TAP_X + 10, y - 12);
        ctx.stroke();

        ctx.fillStyle = hot ? '#ffd27a' : '#4a3a26';
        ctx.beginPath();
        ctx.arc(TAP_X + 24, y - 36, 4, 0, Math.PI * 2);
        ctx.fill();

        if (hot && state === 'running' && pourTimer > 0) {
            ctx.strokeStyle = 'rgba(240, 161, 50, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(TAP_X + 10, y - 10);
            ctx.lineTo(TAP_X + 10, y + 2);
            ctx.stroke();
        }
    }
}

function drawMug(m) {
    const y = LANE_Y[m.lane] + 8;
    const w = MUG_R * 2;
    const h = MUG_R * 2 + 2;
    const x = m.x - MUG_R;

    // handle
    ctx.strokeStyle = '#cfd6e2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + w + 2, y, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // an empty glows cyan: it is the thing the player must not lose track of
    if (!m.full) {
        ctx.fillStyle = 'rgba(95, 211, 196, 0.18)';
        ctx.beginPath();
        ctx.arc(m.x, y, 15, 0, Math.PI * 2);
        ctx.fill();
    }

    // glass
    ctx.fillStyle = m.full ? 'rgba(236, 244, 255, 0.5)' : 'rgba(170, 236, 228, 0.35)';
    roundRect(x, y - h / 2, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = m.full ? '#eef4ff' : '#7ee6d6';
    ctx.lineWidth = m.full ? 1.5 : 2;
    ctx.stroke();

    if (m.full) {
        ctx.fillStyle = '#e08a1e';
        roundRect(x + 2, y - h / 2 + 5, w - 4, h - 7, 2);
        ctx.fill();
        ctx.fillStyle = '#fff6e2';
        roundRect(x + 1, y - h / 2 + 1, w - 2, 5, 2);
        ctx.fill();
    } else {
        ctx.strokeStyle = 'rgba(126, 230, 214, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 10, y);
        ctx.lineTo(x - 4, y);
        ctx.moveTo(x - 7, y - 3);
        ctx.lineTo(x - 4, y);
        ctx.lineTo(x - 7, y + 3);
        ctx.stroke();
    }
}

function drawPatron(p) {
    const y = LANE_Y[p.lane];
    const bob = p.state === 'walking' ? Math.sin(p.x / 9) * 1.6 : 0;
    const fade = p.state === 'leaving' ? 0.55 : 1;

    ctx.globalAlpha = fade;

    // body
    ctx.fillStyle = p.tint;
    roundRect(p.x - 11, y - 6 + bob, 22, 24, 7);
    ctx.fill();

    // head
    ctx.fillStyle = '#f3d6b0';
    ctx.beginPath();
    ctx.arc(p.x, y - 14 + bob, 9, 0, Math.PI * 2);
    ctx.fill();

    // hat brim, so a crowd reads as a crowd
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRect(p.x - 11, y - 22 + bob, 22, 5, 2);
    ctx.fill();

    // eyes, looking the way they are headed
    const look = p.state === 'leaving' ? -3 : 3;
    ctx.fillStyle = '#2b1c10';
    ctx.beginPath();
    ctx.arc(p.x + look - 2, y - 15 + bob, 1.6, 0, Math.PI * 2);
    ctx.arc(p.x + look + 2.5, y - 15 + bob, 1.6, 0, Math.PI * 2);
    ctx.fill();

    if (p.state === 'drinking') {
        // tipped-back mug
        ctx.fillStyle = 'rgba(236, 244, 255, 0.75)';
        roundRect(p.x + 7, y - 20 + bob, 10, 12, 3);
        ctx.fill();
        ctx.fillStyle = '#e08a1e';
        roundRect(p.x + 9, y - 16 + bob, 6, 7, 2);
        ctx.fill();
    } else if (p.state === 'walking') {
        // thirst meter: how far they still are from the taps
        const fraction = Math.min(1, Math.max(0, (p.x - BAR_LEFT) / (BAR_RIGHT - BAR_LEFT)));
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        roundRect(p.x - 12, y - 32 + bob, 24, 4, 2);
        ctx.fill();
        ctx.fillStyle = fraction > 0.7 ? '#e2574c' : '#8bd46a';
        roundRect(p.x - 12, y - 32 + bob, 24 * fraction, 4, 2);
        ctx.fill();
    }

    ctx.globalAlpha = 1;
}

function drawKeeper() {
    const y = LANE_Y[keeper.lane];

    const glow = ctx.createRadialGradient(KEEPER_X, y, 4, KEEPER_X, y, 40);
    glow.addColorStop(0, 'rgba(240, 161, 50, 0.30)');
    glow.addColorStop(1, 'rgba(240, 161, 50, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(KEEPER_X, y + 6, 34, 40, 0, 0, Math.PI * 2);
    ctx.fill();

    // a bar of light across the counter the barkeep is covering
    ctx.fillStyle = 'rgba(240, 161, 50, 0.10)';
    ctx.fillRect(BAR_LEFT - 34, y - 36, BAR_RIGHT - BAR_LEFT + 60, 56);

    // apron body
    ctx.fillStyle = '#e9eef7';
    roundRect(KEEPER_X - 13, y - 8, 26, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#5fd3c4';
    roundRect(KEEPER_X - 9, y + 2, 18, 18, 4);
    ctx.fill();

    // head and cap
    ctx.fillStyle = '#f3d6b0';
    ctx.beginPath();
    ctx.arc(KEEPER_X, y - 17, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0a132';
    roundRect(KEEPER_X - 11, y - 28, 22, 7, 3);
    ctx.fill();

    ctx.fillStyle = '#2b1c10';
    ctx.beginPath();
    ctx.arc(KEEPER_X - 4.5, y - 17, 1.7, 0, Math.PI * 2);
    ctx.arc(KEEPER_X - 0.5, y - 17, 1.7, 0, Math.PI * 2);
    ctx.fill();

    // reaching arm along the counter
    ctx.strokeStyle = '#f3d6b0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(KEEPER_X - 10, y + 2);
    ctx.lineTo(KEEPER_X - 24, y + 10);
    ctx.stroke();
    ctx.lineCap = 'butt';
}

function drawSpills() {
    for (const s of spills) {
        const t = Math.max(0, s.life / SPILL_LIFE);
        ctx.globalAlpha = t;
        ctx.fillStyle = '#e08a1e';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + 16, 16 * (1.4 - t * 0.4), 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(238, 244, 255, 0.8)';
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + t * 3;
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(a) * 18 * (1.2 - t), s.y + 14 + Math.sin(a) * 7 * (1.2 - t), 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function drawLives() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, H - 34, W, 34);
    ctx.fillStyle = 'rgba(240, 161, 50, 0.5)';
    ctx.font = 'bold 10px "Segoe UI", sans-serif';
    ctx.fillText('MUGS LEFT', 16, H - 28);
    for (let i = 0; i < lives; i++) {
        const x = 90 + i * 16;
        ctx.fillStyle = 'rgba(240, 161, 50, 0.9)';
        roundRect(x, H - 25, 10, 14, 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 246, 226, 0.95)';
        ctx.fillRect(x, H - 25, 10, 4);
        ctx.strokeStyle = 'rgba(255, 246, 226, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + 13, H - 19, 3.5, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
    }
}

function draw() {
    drawBackground();
    drawCounters();
    drawSpills();
    drawTaps();
    for (const p of patrons) drawPatron(p);
    for (const m of mugs) drawMug(m);
    drawKeeper();
    drawLives();

    if (state === 'idle') {
        ctx.fillStyle = 'rgba(240, 161, 50, 0.75)';
        ctx.font = 'bold 15px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('four counters, one barkeep', W / 2, H - 26);
        ctx.textAlign = 'left';
    }
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    switch (e.code) {
        case 'Space':
        case 'Enter':
            e.preventDefault();
            advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            laneBy(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            laneBy(1);
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('mousemove', (e) => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    setLane(laneAt(((e.clientY - rect.top) * H) / rect.height));
});

canvas.addEventListener('click', () => advance());
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

updateHud();
draw();
requestAnimationFrame(frame);
