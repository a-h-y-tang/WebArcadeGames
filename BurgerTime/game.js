// ---------------------------------------------------------------------------
// Burger Time — a single-screen arcade platformer on an HTML5 canvas.
//
// A chef walks a lattice of floors and ladders above three plates. Walking the
// full length of an ingredient drops it one floor, shunting whatever it lands on
// one floor further down, until every ingredient has been pushed onto its plate.
// Hot dogs, eggs and pickles patrol the same lattice; a squirt of pepper freezes
// them, and a falling ingredient flattens them.
//
// Written as a classic (non-module) script so the state and logic are reachable
// from the Playwright tests as plain globals, mirroring Kaboom, Snake and Tetris
// in this repo. All motion is expressed per second and advanced through
// `step(dt)` in fixed sub-steps, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 520;

const FLOORS = [80, 180, 280, 380, 470];       // walkable y lines, top to bottom
const LADDERS = [30, 120, 210, 300, 390, 480, 570]; // ladder centre columns
const PLATE_FLOOR = FLOORS.length - 1;         // the floor the plates sit on
const WALK_MIN = 20, WALK_MAX = 580;           // horizontal limits of every floor

const SNAP_Y = 3.5;   // how close to a floor line counts as "standing on it"
const SNAP_X = 8;     // how close to a ladder centre counts as "on the ladder"

// --- Burgers ---
const STACK_XS = [60, 240, 420];               // left edge of each burger stack
const RECIPE = ['bunTop', 'lettuce', 'patty', 'bunBottom']; // top floor downwards
const ING_W = 120, ING_H = 12;
const SEGS = 4, SEG_W = ING_W / SEGS;
const FALL_SPEED = 220;

// --- Actors ---
const CHEF_W = 22, CHEF_H = 26;
const CHEF_SPEED_X = 90, CHEF_SPEED_Y = 70;
const ENEMY_W = 22, ENEMY_H = 24;
const ENEMY_BASE = 52, ENEMY_STEP = 6, ENEMY_MAX_SPEED = 82;
const ENEMY_KINDS = ['hotdog', 'egg', 'pickle'];
const AI_INTERVAL = 0.15;      // seconds between direction decisions
const AI_RANDOM = 0.2;         // chance of ignoring the chase and picking freely

// --- Rules ---
const START_LIVES = 3;
const START_PEPPERS = 5;
const STUN_TIME = 4;           // seconds an enemy stays peppered
const RESPAWN_TIME = 5;        // seconds before a squashed enemy returns
const PEPPER_RX = 22, PEPPER_RY = 15;

// --- Scoring ---
const DROP_POINTS = 50;        // per ingredient dropped by stepping it
const PLATE_POINTS = 100;      // per ingredient that reaches a plate
const SQUASH_POINTS = 500;     // per enemy flattened by a falling pile
const LEVEL_BONUS = 1000;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const peppersEl = document.getElementById('peppers');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, peppers;
const chef = { x: 300, y: FLOORS[PLATE_FLOOR], dx: 0, dy: 0, face: 1, w: CHEF_W, h: CHEF_H };
const enemies = [];
const stacks = STACK_XS.map((x, i) => ({ index: i, x, piles: [], plate: { ings: [] } }));
const fallingPiles = [];
const puffs = [];

// ---------------------------------------------------------------------------
// Seeded RNG — enemy decisions stay reproducible for the tests.
// ---------------------------------------------------------------------------

let rngState = 987654321;

function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

function rand() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// ---------------------------------------------------------------------------
// Lattice helpers
// ---------------------------------------------------------------------------

function floorIndexAt(y) {
    for (let i = 0; i < FLOORS.length; i++) {
        if (Math.abs(y - FLOORS[i]) <= SNAP_Y) return i;
    }
    return -1;
}

function ladderIndexAt(x) {
    for (let i = 0; i < LADDERS.length; i++) {
        if (Math.abs(x - LADDERS[i]) <= SNAP_X) return i;
    }
    return -1;
}

// Move an actor under the lattice rules: vertical only while aligned with a
// ladder, horizontal only while standing on a floor line. Returns the axis that
// actually moved ('v' | 'h') or null when the move was refused.
function moveActor(a, h, speedX, speedY) {
    if (a.dy !== 0) {
        const li = ladderIndexAt(a.x);
        if (li >= 0) {
            const ny = clamp(a.y + a.dy * speedY * h, FLOORS[0], FLOORS[PLATE_FLOOR]);
            if (ny !== a.y) {
                a.x = LADDERS[li];
                a.y = ny;
                return 'v';
            }
        }
    }
    if (a.dx !== 0) {
        const fi = floorIndexAt(a.y);
        if (fi >= 0) {
            a.y = FLOORS[fi];
            a.face = a.dx;
            const nx = clamp(a.x + a.dx * speedX * h, WALK_MIN + a.w / 2, WALK_MAX - a.w / 2);
            if (nx !== a.x) {
                a.x = nx;
                return 'h';
            }
        }
    }
    return null;
}

function setDir(dx, dy) {
    chef.dx = dx;
    chef.dy = dy;
}

// ---------------------------------------------------------------------------
// Burgers
// ---------------------------------------------------------------------------

function makePile(stackIndex, floor, ings) {
    return {
        stackIndex,
        floor,
        ings,
        steps: [false, false, false, false],
        state: 'resting',
        y: FLOORS[floor],
    };
}

function resetBurgers() {
    fallingPiles.length = 0;
    for (const s of stacks) {
        s.plate.ings = [];
        s.piles = FLOORS.map((_, f) => (f < RECIPE.length ? makePile(s.index, f, [RECIPE[f]]) : null));
    }
}

function platedCount() {
    return stacks.reduce((n, s) => n + s.plate.ings.length, 0);
}

// A pile leaves its slot and starts falling. Player-caused drops score; piles
// shunted by a landing pile above them do not.
function dropPile(p, byPlayer) {
    stacks[p.stackIndex].piles[p.floor] = null;
    p.state = 'falling';
    fallingPiles.push(p);
    if (byPlayer) score += DROP_POINTS * p.ings.length;
}

// The chef's feet mark the segment under them; four marks and the pile goes.
function checkStepping() {
    const fi = floorIndexAt(chef.y);
    if (fi < 0) return;
    for (const s of stacks) {
        const p = s.piles[fi];
        if (!p || p.state !== 'resting') continue;
        const rel = chef.x - s.x;
        if (rel < 0 || rel >= ING_W) continue;
        const idx = Math.floor(rel / SEG_W);
        if (p.steps[idx]) continue;
        p.steps[idx] = true;
        if (p.steps.every(Boolean)) dropPile(p, true);
    }
}

function updateFalling(h) {
    for (let i = fallingPiles.length - 1; i >= 0; i--) {
        const p = fallingPiles[i];
        const target = FLOORS[p.floor + 1];
        p.y = Math.min(target, p.y + FALL_SPEED * h);
        squashCheck(p);
        if (p.y >= target) {
            p.floor += 1;
            landPile(p, i);
        }
    }
}

function landPile(p, index) {
    const s = stacks[p.stackIndex];
    fallingPiles.splice(index, 1);

    if (p.floor === PLATE_FLOOR) {
        for (const ing of p.ings) s.plate.ings.push(ing);
        score += PLATE_POINTS * p.ings.length;
        p.state = 'plated';
        checkLevelComplete();
        return;
    }

    // Landing on a resting pile shunts that pile one floor further down; the
    // ripple continues from there, which is what makes a burger take four
    // passes to serve.
    const occupant = s.piles[p.floor];
    if (occupant) dropPile(occupant, false);

    p.state = 'resting';
    p.steps = [false, false, false, false];
    p.y = FLOORS[p.floor];
    s.piles[p.floor] = p;
}

function squashCheck(p) {
    const s = stacks[p.stackIndex];
    const top = p.y - p.ings.length * ING_H;
    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.x + ENEMY_W / 2 < s.x || e.x - ENEMY_W / 2 > s.x + ING_W) continue;
        if (p.y >= e.y - ENEMY_H && top <= e.y) squashEnemy(e);
    }
}

// Test/debug helper: plate everything left in one stack, bottom ingredient first.
function serveOne(stackIndex) {
    const s = stacks[stackIndex];
    for (let i = fallingPiles.length - 1; i >= 0; i--) {
        if (fallingPiles[i].stackIndex !== stackIndex) continue;
        const p = fallingPiles.splice(i, 1)[0];
        p.state = 'plated';
        s.piles[p.floor] = null;
        for (const ing of p.ings) s.plate.ings.push(ing);
        score += PLATE_POINTS * p.ings.length;
    }
    for (let f = s.piles.length - 1; f >= 0; f--) {
        const p = s.piles[f];
        if (!p) continue;
        s.piles[f] = null;
        p.state = 'plated';
        for (const ing of p.ings) s.plate.ings.push(ing);
        score += PLATE_POINTS * p.ings.length;
    }
    checkLevelComplete();
}

function serveAll() {
    for (let i = 0; i < stacks.length; i++) serveOne(i);
}

function checkLevelComplete() {
    if (!stacks.every((s) => s.plate.ings.length === RECIPE.length)) return;
    score += LEVEL_BONUS;
    level += 1;
    peppers = START_PEPPERS;
    resetBurgers();
    spawnEnemies();
    resetPositions();
    updateHud();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

const ENEMY_POSTS = [
    { x: LADDERS[0], y: FLOORS[0] },
    { x: LADDERS[6], y: FLOORS[0] },
    { x: LADDERS[1], y: FLOORS[1] },
    { x: LADDERS[5], y: FLOORS[1] },
    { x: LADDERS[3], y: FLOORS[0] },
];

function enemyCount() {
    return Math.min(ENEMY_POSTS.length, level + 1);
}

function enemySpeed() {
    return Math.min(ENEMY_MAX_SPEED, ENEMY_BASE + (level - 1) * ENEMY_STEP);
}

function spawnEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const post = ENEMY_POSTS[i];
        enemies.push({
            kind: ENEMY_KINDS[i % ENEMY_KINDS.length],
            post,
            x: post.x,
            y: post.y,
            dx: 0,
            dy: 0,
            face: 1,
            w: ENEMY_W,
            h: ENEMY_H,
            speed: enemySpeed(),
            stun: 0,
            alive: true,
            respawn: 0,
            think: 0,
        });
    }
}

function chooseEnemyDir(e) {
    const fi = floorIndexAt(e.y);
    const li = ladderIndexAt(e.x);
    const opts = [];
    if (fi >= 0) {
        opts.push({ dx: -1, dy: 0 }, { dx: 1, dy: 0 });
        if (li >= 0) {
            if (fi > 0) opts.push({ dx: 0, dy: -1 });
            if (fi < PLATE_FLOOR) opts.push({ dx: 0, dy: 1 });
        }
    } else if (li >= 0) {
        opts.push({ dx: 0, dy: -1 }, { dx: 0, dy: 1 });
    }
    if (!opts.length) {
        e.dx = 0;
        e.dy = 0;
        return;
    }

    const legal = opts.filter((o) => {
        if (o.dy === -1 && e.y <= FLOORS[0]) return false;
        if (o.dy === 1 && e.y >= FLOORS[PLATE_FLOOR]) return false;
        if (o.dx === -1 && e.x <= WALK_MIN + ENEMY_W / 2) return false;
        if (o.dx === 1 && e.x >= WALK_MAX - ENEMY_W / 2) return false;
        return true;
    });
    const pool = legal.length ? legal : opts;

    // Reversing is a last resort, otherwise enemies dither on the spot.
    const forward = pool.filter((o) => !(o.dx === -e.dx && o.dy === -e.dy && (e.dx || e.dy)));
    const cands = forward.length ? forward : pool;

    let pick = cands[0];
    if (rand() < AI_RANDOM) {
        pick = cands[Math.min(cands.length - 1, Math.floor(rand() * cands.length))];
    } else {
        let bestDist = Infinity;
        for (const o of cands) {
            const px = e.x + o.dx * 24;
            const py = e.y + o.dy * 24;
            const d = Math.abs(px - chef.x) + Math.abs(py - chef.y) * 1.2;
            if (d < bestDist) {
                bestDist = d;
                pick = o;
            }
        }
    }
    e.dx = pick.dx;
    e.dy = pick.dy;
}

function squashEnemy(e) {
    e.alive = false;
    e.stun = 0;
    e.dx = 0;
    e.dy = 0;
    e.respawn = RESPAWN_TIME;
    score += SQUASH_POINTS;
}

function reviveEnemy(e) {
    e.alive = true;
    e.x = e.post.x;
    e.y = e.post.y;
    e.dx = 0;
    e.dy = 0;
    e.stun = 0;
    e.think = 0;
}

function touching(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function updateEnemies(h) {
    for (const e of enemies) {
        if (!e.alive) {
            e.respawn -= h;
            if (e.respawn <= 0) reviveEnemy(e);
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - h);
            continue;
        }
        e.think -= h;
        if (e.think <= 0) {
            chooseEnemyDir(e);
            e.think = AI_INTERVAL;
        }
        const moved = moveActor(e, h, e.speed, e.speed * 0.85);
        if (!moved) {
            chooseEnemyDir(e);
            e.think = AI_INTERVAL;
        }
        if (touching(chef, e)) {
            loseLife();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function firePepper() {
    if (state !== 'running' || peppers <= 0) return;
    peppers -= 1;
    const dir = chef.face >= 0 ? 1 : -1;
    const x = chef.x + dir * (CHEF_W / 2 + PEPPER_RX);
    const y = chef.y - CHEF_H / 2;
    puffs.push({ x, y, life: 0.4 });
    for (const e of enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.x - x) <= PEPPER_RX + ENEMY_W / 2 &&
            Math.abs((e.y - ENEMY_H / 2) - y) <= PEPPER_RY + ENEMY_H / 2) {
            e.stun = STUN_TIME;
        }
    }
    updateHud();
}

function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
        puffs[i].life -= dt;
        if (puffs[i].life <= 0) puffs.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    const axis = moveActor(chef, h, CHEF_SPEED_X, CHEF_SPEED_Y);
    if (axis === 'h') checkStepping();
    updateFalling(h);
    updateEnemies(h);
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so nothing
// tunnels through a floor, an ingredient or an enemy at low frame rates.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updatePuffs(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function resetPositions() {
    chef.x = 300;
    chef.y = FLOORS[PLATE_FLOOR];
    chef.dx = 0;
    chef.dy = 0;
    chef.face = 1;
    for (const e of enemies) reviveEnemy(e);
    puffs.length = 0;
}

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    resetBurgers();
    spawnEnemies();
    resetPositions();
    hideOverlay();
    updateHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }
    resetPositions();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_STYLE = {
    bunTop: { fill: '#e0a260', shade: '#c1793c' },
    lettuce: { fill: '#7bc043', shade: '#4f9127' },
    patty: { fill: '#8b4a2b', shade: '#65321b' },
    bunBottom: { fill: '#d0904d', shade: '#a96c2e' },
};

function drawLattice() {
    // Ladders behind the floors.
    for (const x of LADDERS) {
        ctx.strokeStyle = '#3b6ea5';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 9, FLOORS[0]);
        ctx.lineTo(x - 9, FLOORS[PLATE_FLOOR]);
        ctx.moveTo(x + 9, FLOORS[0]);
        ctx.lineTo(x + 9, FLOORS[PLATE_FLOOR]);
        ctx.stroke();
        ctx.strokeStyle = '#2b527b';
        ctx.beginPath();
        for (let y = FLOORS[0] + 8; y < FLOORS[PLATE_FLOOR]; y += 14) {
            ctx.moveTo(x - 9, y);
            ctx.lineTo(x + 9, y);
        }
        ctx.stroke();
    }

    // Floors.
    for (const y of FLOORS) {
        ctx.fillStyle = '#4f6fa1';
        ctx.fillRect(WALK_MIN - 10, y, WALK_MAX - WALK_MIN + 20, 4);
        ctx.fillStyle = '#2e4467';
        ctx.fillRect(WALK_MIN - 10, y + 4, WALK_MAX - WALK_MIN + 20, 3);
    }
}

function drawIngredient(kind, x, y, offsets) {
    const style = ING_STYLE[kind];
    for (let s = 0; s < SEGS; s++) {
        const sx = x + s * SEG_W;
        const sy = y + (offsets && offsets[s] ? 4 : 0);
        ctx.fillStyle = style.fill;
        ctx.fillRect(sx, sy, SEG_W - 1, ING_H - 3);
        ctx.fillStyle = style.shade;
        ctx.fillRect(sx, sy + ING_H - 4, SEG_W - 1, 3);
        if (kind === 'bunTop') {
            ctx.fillStyle = '#fff3d6';
            ctx.fillRect(sx + 8, sy + 3, 3, 2);
            ctx.fillRect(sx + 18, sy + 5, 3, 2);
        }
    }
}

function drawPile(p) {
    const x = stacks[p.stackIndex].x;
    for (let i = 0; i < p.ings.length; i++) {
        const y = p.y - (i + 1) * ING_H;
        const topMost = i === p.ings.length - 1;
        drawIngredient(p.ings[i], x, y, topMost && p.state === 'resting' ? p.steps : null);
    }
}

function drawPlates() {
    for (const s of stacks) {
        const cx = s.x + ING_W / 2;
        const y = FLOORS[PLATE_FLOOR] + 6;
        ctx.fillStyle = '#d9dee8';
        ctx.beginPath();
        ctx.ellipse(cx, y, ING_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a9b2c4';
        ctx.fillRect(cx - ING_W / 2 - 6, y, ING_W + 12, 4);

        for (let i = 0; i < s.plate.ings.length; i++) {
            drawIngredient(s.plate.ings[i], s.x, FLOORS[PLATE_FLOOR] - (i + 1) * ING_H, null);
        }
    }
}

function drawChef() {
    const x = chef.x, y = chef.y;
    // legs
    ctx.fillStyle = '#2b3f63';
    ctx.fillRect(x - 8, y - 9, 6, 9);
    ctx.fillRect(x + 2, y - 9, 6, 9);
    // whites
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(x - CHEF_W / 2, y - 22, CHEF_W, 14);
    // scarf
    ctx.fillStyle = '#ef5350';
    ctx.fillRect(x - CHEF_W / 2, y - 22, CHEF_W, 3);
    // head + hat
    ctx.fillStyle = '#f0c9a0';
    ctx.fillRect(x - 6, y - 30, 12, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 9, y - 36, 18, 6);
    // eye, facing the way the chef last walked
    ctx.fillStyle = '#221a12';
    ctx.fillRect(x + (chef.face >= 0 ? 2 : -4), y - 28, 2, 2);
}

function drawEnemy(e) {
    if (!e.alive) return;
    const x = e.x, y = e.y;
    const body = { hotdog: '#e2703a', egg: '#f6e7c1', pickle: '#5f9c3a' }[e.kind];
    ctx.fillStyle = e.stun > 0 ? '#8fa3bf' : body;
    if (e.kind === 'egg') {
        ctx.beginPath();
        ctx.ellipse(x, y - ENEMY_H / 2, ENEMY_W / 2, ENEMY_H / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = e.stun > 0 ? '#c3cedd' : '#f6b93b';
        ctx.beginPath();
        ctx.arc(x, y - ENEMY_H / 2, 5, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillRect(x - ENEMY_W / 2, y - ENEMY_H, ENEMY_W, ENEMY_H - 4);
        ctx.fillStyle = e.stun > 0 ? '#6f8299' : '#3a2a1c';
        ctx.fillRect(x - ENEMY_W / 2, y - 6, 6, 6);
        ctx.fillRect(x + ENEMY_W / 2 - 6, y - 6, 6, 6);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - ENEMY_H + 5, 4, 4);
    ctx.fillRect(x + 2, y - ENEMY_H + 5, 4, 4);
    ctx.fillStyle = '#1b1310';
    ctx.fillRect(x - 5, y - ENEMY_H + 6, 2, 2);
    ctx.fillRect(x + 3, y - ENEMY_H + 6, 2, 2);
    if (e.stun > 0) {
        ctx.fillStyle = '#c9d6e8';
        ctx.fillRect(x - 3, y - ENEMY_H - 6, 6, 2);
    }
}

function drawPuffs() {
    for (const p of puffs) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
        ctx.fillStyle = '#e9e2d0';
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(p.x + Math.cos(a) * PEPPER_RX * 0.6, p.y + Math.sin(a) * PEPPER_RY * 0.6, 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#120c17';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLattice();
    drawPlates();

    for (const s of stacks) {
        for (const p of s.piles) {
            if (p) drawPile(p);
        }
    }
    for (const p of fallingPiles) drawPile(p);

    for (const e of enemies) drawEnemy(e);
    drawChef();
    drawPuffs();

    // Remaining lives as little chef hats along the bottom edge.
    for (let i = 0; i < lives; i++) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(12 + i * 20, CANVAS_H - 16, 14, 5);
        ctx.fillStyle = '#e5e0d4';
        ctx.fillRect(15 + i * 20, CANVAS_H - 11, 8, 4);
    }
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    else updatePuffs(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function held(keys) {
    return keys.some((k) => heldKeys.has(k));
}

function refreshKeyDir() {
    setDir(
        (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0),
        (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0),
    );
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') firePepper();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeyDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeyDir();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
peppers = START_PEPPERS;
resetBurgers();
updateHud();
requestAnimationFrame(frame);
