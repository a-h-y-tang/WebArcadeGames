// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// The chef walks the girders of a diner kitchen, treading across burger
// ingredients to knock them down onto the plates below while hot dogs, eggs and
// pickles give chase. Written as a single classic (non-module) script so the
// game state and logic are reachable from the Playwright tests as plain
// globals, mirroring Kaboom!, Dino Run and Tetris in this repo. All motion is
// expressed per-second and advanced through `step(dt)`, so tests can simulate
// frames deterministically without depending on requestAnimationFrame
// wall-clock timing. Nothing in the simulation uses Math.random().
// ---------------------------------------------------------------------------

// --- World geometry ---
const TILE = 32;
const COLS = 20;
const ROWS = 15;
const CANVAS_W = COLS * TILE;   // 640
const CANVAS_H = ROWS * TILE;   // 480

// Girder rows, top to bottom. The last one is the plate floor: ingredients that
// reach it are served, and it doubles as the ground the chef walks on.
const FLOOR_ROWS = [2, 4, 6, 8, 10, 12, 14];
const PLATE_FLOOR = FLOOR_ROWS.length - 1;

// Ladder columns. Every ladder runs the full height of the kitchen, which
// guarantees the level is always solvable (see DESIGN.md → Assumptions).
const LADDER_COLS = [0, 6, 12, 18];

// Left-hand tile column of each burger stack. A piece is 4 tiles wide, so the
// stacks occupy columns 1-4, 7-10 and 13-16 — clear of every ladder.
const STACK_COLS = [1, 7, 13];
const PIECE_TYPES = ['bunTop', 'lettuce', 'patty', 'bunBottom'];

// Which girder each ingredient of each burger starts on. There are six burger
// girders for four ingredients, so every stack has gaps: a knocked-down piece
// only sweeps up the ingredients directly beneath it and then comes to rest on
// the first clear girder, and has to be trodden on again. That is what turns a
// burger into several runs rather than one.
const STACK_HOMES = [
    [0, 1, 3, 4],
    [0, 2, 3, 5],
    [1, 2, 4, 5],
];
const PIECE_W = 4 * TILE;
const PIECE_H = 12;

// --- Actors ---
const CHEF_HALF_W = 11;
const CHEF_H = 28;
const ENEMY_HALF_W = 13;
const ENEMY_H = 26;
const CHEF_SPEED = 110;         // px/s
const ENEMY_BASE = 62;          // px/s at level 1
const ENEMY_STEP = 9;           // px/s added per level
const FALL_SPEED = 210;         // px/s for a knocked-down ingredient

const FLOOR_SNAP = 2;           // px tolerance for "standing on a girder"
const LADDER_SNAP = 6;          // px tolerance for "lined up with a ladder"

// --- Rules ---
const START_LIVES = 3;
const PEPPER_START = 5;
const PEPPER_W = 40;
const PEPPER_LIFE = 0.45;       // seconds the cloud lingers
const STUN_TIME = 4;            // seconds an enemy stays peppered
const RESPAWN_DELAY = 4;        // seconds before a squashed enemy returns
const INVULN_TIME = 1.5;        // grace period after losing a life

const DROP_POINTS = 50;
const SQUASH_POINTS = 500;
const PLATE_POINTS = 100;
const LEVEL_BONUS = 1000;

const CHEF_SPAWN = { x: 320, y: FLOOR_ROWS[PLATE_FLOOR] * TILE };
const ENEMY_SPAWNS = [
    { x: LADDER_COLS[3] * TILE + TILE / 2, y: FLOOR_ROWS[1] * TILE },
    { x: LADDER_COLS[0] * TILE + TILE / 2, y: FLOOR_ROWS[3] * TILE },
    { x: LADDER_COLS[2] * TILE + TILE / 2, y: FLOOR_ROWS[0] * TILE },
    { x: LADDER_COLS[1] * TILE + TILE / 2, y: FLOOR_ROWS[4] * TILE },
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const pepperEl = document.getElementById('pepper');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, pepper;
const chef = { x: CHEF_SPAWN.x, y: CHEF_SPAWN.y, dirX: 0, dirY: 0, face: 1, invuln: 0, walk: 0 };
const enemies = [];
const pieces = [];
const peppers = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(i) { return FLOOR_ROWS[i] * TILE; }
function ladderX(i) { return LADDER_COLS[i] * TILE + TILE / 2; }
function stackX(i) { return STACK_COLS[i] * TILE; }
function pieceLeft(p) { return stackX(p.stack); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Index of the girder an actor is standing on, or -1 when mid-ladder.
function floorIndexNear(y) {
    for (let i = 0; i < FLOOR_ROWS.length; i++) {
        if (Math.abs(floorY(i) - y) <= FLOOR_SNAP) return i;
    }
    return -1;
}

// Index of the ladder an actor is lined up with, or -1.
function ladderIndexNear(x) {
    for (let i = 0; i < LADDER_COLS.length; i++) {
        if (Math.abs(ladderX(i) - x) <= LADDER_SNAP) return i;
    }
    return -1;
}

function enemySpeed() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function enemyCount() { return Math.min(1 + level, ENEMY_SPAWNS.length); }

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

// Build (or reset) the burgers: one piece of every type in every stack, each
// resting on its own girder from the top down.
function buildPieces() {
    pieces.length = 0;
    for (let s = 0; s < STACK_COLS.length; s++) {
        for (let t = 0; t < PIECE_TYPES.length; t++) {
            const home = STACK_HOMES[s][t];
            pieces.push({
                stack: s,
                type: PIECE_TYPES[t],
                home,
                floor: home,
                target: home,
                y: floorY(home),
                state: 'rest',
                segs: [false, false, false, false],
                squashed: 0,
                pile: 0,
            });
        }
    }
}

// The four ingredients of one burger, top bun first.
function burger(stack) {
    return pieces.filter((p) => p.stack === stack);
}

function pieceAt(stack, floor) {
    return pieces.find((p) => p.stack === stack && p.floor === floor);
}

function resetActors() {
    chef.x = CHEF_SPAWN.x;
    chef.y = CHEF_SPAWN.y;
    chef.dirX = 0;
    chef.dirY = 0;
    chef.face = 1;
    peppers.length = 0;
    for (const e of enemies) {
        e.x = e.spawn.x;
        e.y = e.spawn.y;
        e.dirX = 0;
        e.dirY = 0;
        e.state = 'chase';
        e.timer = 0;
    }
    refreshKeyDir();
}

function spawnEnemy(x, y) {
    const e = {
        x, y,
        dirX: 0, dirY: 0,
        state: 'chase',
        timer: 0,
        kind: enemies.length % 3,
        spawn: { x, y },
    };
    enemies.push(e);
    return e;
}

function spawnEnemiesForLevel() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        spawnEnemy(ENEMY_SPAWNS[i].x, ENEMY_SPAWNS[i].y);
    }
}

// ---------------------------------------------------------------------------
// Chef controls (also used by the tests)
// ---------------------------------------------------------------------------

function placeChef(x, y) {
    chef.x = clamp(x, CHEF_HALF_W, CANVAS_W - CHEF_HALF_W);
    chef.y = clamp(y, floorY(0), floorY(PLATE_FLOOR));
}

function moveChef(dx, dy) {
    chef.dirX = dx;
    chef.dirY = dy;
    if (dx !== 0) chef.face = dx > 0 ? 1 : -1;
}

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return null;
    pepper -= 1;
    const x0 = chef.face > 0 ? chef.x + CHEF_HALF_W : chef.x - CHEF_HALF_W - PEPPER_W;
    const cloud = {
        x0, x1: x0 + PEPPER_W,
        y0: chef.y - CHEF_H, y1: chef.y,
        life: PEPPER_LIFE,
    };
    peppers.push(cloud);
    updateHud();
    return cloud;
}

// ---------------------------------------------------------------------------
// Movement shared by the chef and the enemies
// ---------------------------------------------------------------------------

function moveActor(a, halfW, speed, h) {
    if (a.dirY !== 0) {
        const li = ladderIndexNear(a.x);
        if (li >= 0) {
            a.x = ladderX(li);
            a.y = clamp(a.y + a.dirY * speed * h, floorY(0), floorY(PLATE_FLOOR));
            return;
        }
    }
    if (a.dirX !== 0) {
        const fi = floorIndexNear(a.y);
        if (fi >= 0) {
            a.y = floorY(fi);
            a.x = clamp(a.x + a.dirX * speed * h, halfW, CANVAS_W - halfW);
        }
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Mark the segments of any resting ingredient the chef is standing on. Once all
// four segments have been trodden, the piece drops.
function treadOnPieces() {
    const fi = floorIndexNear(chef.y);
    if (fi < 0) return;
    for (const p of pieces) {
        if (p.state !== 'rest' || p.floor !== fi) continue;
        const rel = chef.x - pieceLeft(p);
        if (rel < 0 || rel >= PIECE_W) continue;
        const seg = Math.floor(rel / TILE);
        if (p.segs[seg]) continue;
        p.segs[seg] = true;
        if (p.segs.every(Boolean)) dropPiece(p);
    }
}

// Every resting piece sharing a stack and a girder forms one pile.
function pileAt(stack, floor) {
    return pieces.filter((q) => q.state === 'rest' && q.stack === stack && q.floor === floor);
}

// Knock a piece down. It carries its pile with it and lands on the first girder
// below that is clear of ingredients — every pile it meets on the way is swept
// along, so treading on an untouched top bun cascades the whole burger onto the
// plate. The destination is resolved here, once, which keeps the fall
// independent of the order pieces happen to be updated in.
function dropPiece(p) {
    if (p.state !== 'rest') return false;
    const falling = pileAt(p.stack, p.floor);
    let target = p.floor + 1;
    while (target < PLATE_FLOOR) {
        const below = pileAt(p.stack, target);
        if (below.length === 0) break;
        falling.push(...below);
        target += 1;
    }
    for (const q of falling) {
        q.state = 'fall';
        q.target = target;
        q.squashed = 0;
        q.segs = [false, false, false, false];
        // Take the piled-up drawing offset into the real position so the pieces
        // fall as separate bodies. The lowest one then lands first and the
        // burger rebuilds itself in the right order rather than in array order.
        q.y -= q.pile * PIECE_H;
        q.pile = 0;
    }
    score += DROP_POINTS;
    updateHud();
    return true;
}

function landPiece(p, floor) {
    p.floor = floor;
    p.y = floorY(floor);
    p.pile = pieces.filter((q) => q !== p && q.stack === p.stack && q.floor === floor
        && (q.state === 'rest' || q.state === 'plate')).length;
    if (floor === PLATE_FLOOR) {
        p.state = 'plate';
        score += PLATE_POINTS;
    } else {
        p.state = 'rest';
        p.segs = [false, false, false, false];
    }
}

function overlapsPiece(p, x0, x1, y0, y1) {
    const px0 = pieceLeft(p), px1 = px0 + PIECE_W;
    return x1 > px0 && x0 < px1 && y1 > p.y - PIECE_H && y0 < p.y;
}

function updatePieces(h) {
    let served = false;
    for (const p of pieces) {
        if (p.state !== 'fall') continue;
        p.y += FALL_SPEED * h;

        // Anything caught under a falling ingredient is flattened.
        for (const e of enemies) {
            if (e.state === 'dead') continue;
            if (!overlapsPiece(p, e.x - ENEMY_HALF_W, e.x + ENEMY_HALF_W, e.y - ENEMY_H, e.y)) continue;
            e.state = 'dead';
            e.timer = RESPAWN_DELAY;
            p.squashed += 1;
            score += SQUASH_POINTS * p.squashed;
        }

        if (p.y < floorY(p.target)) continue;
        landPiece(p, p.target);
        if (p.state === 'plate') served = true;
    }
    if (served && pieces.every((p) => p.state === 'plate')) completeLevel();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

// The ladder that best serves an enemy heading for the chef: the one with the
// shortest detour, measured as the walk to it plus the walk from it. Ties break
// on the lower index, so the choice is deterministic.
function bestLadderFor(x) {
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < LADDER_COLS.length; i++) {
        const cost = Math.abs(ladderX(i) - x) + Math.abs(ladderX(i) - chef.x);
        if (cost < bestCost - 1e-9) { bestCost = cost; best = i; }
    }
    return best;
}

// Greedy chase: on the chef's girder, walk straight at them; anywhere else,
// climb if already on a ladder, otherwise head for the handiest one. Fully
// deterministic — no randomness anywhere in the AI.
function enemyThink(e) {
    const fi = floorIndexNear(e.y);
    if (fi < 0) return;             // mid-ladder: keep climbing
    e.y = floorY(fi);
    const dy = chef.y - e.y;
    if (Math.abs(dy) > FLOOR_SNAP) {
        const li = ladderIndexNear(e.x);
        if (li >= 0) {
            e.x = ladderX(li);
            e.dirX = 0;
            e.dirY = dy > 0 ? 1 : -1;
            return;
        }
        e.dirY = 0;
        e.dirX = ladderX(bestLadderFor(e.x)) > e.x ? 1 : -1;
        return;
    }
    e.dirY = 0;
    const dx = chef.x - e.x;
    if (Math.abs(dx) > 1) e.dirX = dx > 0 ? 1 : -1;
    else if (e.dirX === 0) e.dirX = 1;
}

function updateEnemies(h) {
    for (const e of enemies) {
        if (e.state === 'dead') {
            e.timer -= h;
            if (e.timer <= 0) {
                e.x = e.spawn.x;
                e.y = e.spawn.y;
                e.dirX = 0;
                e.dirY = 0;
                e.state = 'chase';
            }
            continue;
        }
        if (e.state === 'stunned') {
            e.timer -= h;
            if (e.timer <= 0) e.state = 'chase';
            continue;
        }
        enemyThink(e);
        moveActor(e, ENEMY_HALF_W, enemySpeed(), h);
    }
}

function updatePeppers(h) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const c = peppers[i];
        c.life -= h;
        for (const e of enemies) {
            if (e.state !== 'chase') continue;
            if (e.x + ENEMY_HALF_W <= c.x0 || e.x - ENEMY_HALF_W >= c.x1) continue;
            if (e.y <= c.y0 || e.y - ENEMY_H >= c.y1) continue;
            e.state = 'stunned';
            e.timer = STUN_TIME;
        }
        if (c.life <= 0) peppers.splice(i, 1);
    }
}

function checkCaught() {
    if (chef.invuln > 0) return;
    for (const e of enemies) {
        if (e.state !== 'chase') continue;
        if (e.x + ENEMY_HALF_W <= chef.x - CHEF_HALF_W) continue;
        if (e.x - ENEMY_HALF_W >= chef.x + CHEF_HALF_W) continue;
        if (e.y <= chef.y - CHEF_H) continue;
        if (e.y - ENEMY_H >= chef.y) continue;
        loseLife();
        return;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (chef.invuln > 0) chef.invuln = Math.max(0, chef.invuln - h);

    const x0 = chef.x, y0 = chef.y;
    moveActor(chef, CHEF_HALF_W, CHEF_SPEED, h);
    if (chef.x !== x0 || chef.y !== y0) chef.walk += Math.abs(chef.x - x0) + Math.abs(chef.y - y0);

    treadOnPieces();
    updatePieces(h);
    if (state !== 'running') return;
    updateEnemies(h);
    updatePeppers(h);
    checkCaught();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast
// movers never tunnel through a girder, an ingredient segment or each other.
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
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = PEPPER_START;
    chef.invuln = 0;
    buildPieces();
    spawnEnemiesForLevel();
    resetActors();
    hideOverlay();
    updateHud();
}

function completeLevel() {
    level += 1;
    score += LEVEL_BONUS;
    pepper = PEPPER_START;
    chef.invuln = INVULN_TIME;
    buildPieces();
    spawnEnemiesForLevel();
    resetActors();
    updateHud();
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    resetActors();
    chef.invuln = INVULN_TIME;
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
    pepperEl.textContent = String(pepper);
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

const PIECE_COLORS = {
    bunTop: '#e0a458',
    lettuce: '#7ac74f',
    patty: '#8d5524',
    bunBottom: '#c98a45',
};

const ENEMY_COLORS = ['#ef5350', '#f6e27a', '#68b16b'];

function drawLadders() {
    for (let i = 0; i < LADDER_COLS.length; i++) {
        const cx = ladderX(i);
        const top = floorY(0), bottom = floorY(PLATE_FLOOR);
        ctx.strokeStyle = '#4b5b7a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 9, top); ctx.lineTo(cx - 9, bottom);
        ctx.moveTo(cx + 9, top); ctx.lineTo(cx + 9, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = top + 8; y < bottom; y += 12) {
            ctx.beginPath();
            ctx.moveTo(cx - 9, y); ctx.lineTo(cx + 9, y);
            ctx.stroke();
        }
    }
}

function drawFloors() {
    for (let i = 0; i < FLOOR_ROWS.length; i++) {
        const y = floorY(i);
        ctx.fillStyle = i === PLATE_FLOOR ? '#5b6a86' : '#3f4c66';
        ctx.fillRect(0, y, CANVAS_W, 5);
        ctx.fillStyle = '#6f7f9e';
        for (let x = 0; x < CANVAS_W; x += 16) ctx.fillRect(x, y + 1, 8, 2);
    }
}

function drawPlates() {
    const y = floorY(PLATE_FLOOR) + 6;
    for (let s = 0; s < STACK_COLS.length; s++) {
        const x = stackX(s);
        ctx.fillStyle = '#d8d2e0';
        ctx.beginPath();
        ctx.ellipse(x + PIECE_W / 2, y + 8, PIECE_W / 2 + 6, 8, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPiece(p) {
    const x = pieceLeft(p);
    const y = p.y - p.pile * PIECE_H;   // ingredients piled on one girder stack up
    ctx.fillStyle = PIECE_COLORS[p.type];
    if (p.type === 'bunTop') {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 4);
        ctx.quadraticCurveTo(x + PIECE_W / 2, y - PIECE_H - 8, x + PIECE_W, y - 4);
        ctx.lineTo(x + PIECE_W, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fbe7c6';
        for (let i = 1; i <= 3; i++) ctx.fillRect(x + i * 30, y - PIECE_H - 1, 4, 3);
        return;
    }
    ctx.fillRect(x, y - PIECE_H, PIECE_W, PIECE_H);
    if (p.type === 'lettuce') {
        ctx.fillStyle = '#a5df7d';
        for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            ctx.arc(x + 8 + i * 16, y - PIECE_H, 8, Math.PI, 0);
            ctx.fill();
        }
    } else if (p.type === 'patty') {
        ctx.fillStyle = '#6b3c19';
        for (let i = 0; i < 5; i++) ctx.fillRect(x + 12 + i * 24, y - PIECE_H + 3, 10, 3);
    }
    // Trodden segments read as a dent in the ingredient.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (let i = 0; i < p.segs.length; i++) {
        if (p.segs[i]) ctx.fillRect(x + i * TILE, y - 4, TILE, 4);
    }
}

function drawChef() {
    if (chef.invuln > 0 && Math.floor(chef.invuln * 12) % 2 === 0) return;
    const x = chef.x, y = chef.y;
    // hat
    ctx.fillStyle = '#f4ece2';
    ctx.fillRect(x - 9, y - CHEF_H, 18, 7);
    // face
    ctx.fillStyle = '#f2c39b';
    ctx.fillRect(x - 7, y - CHEF_H + 7, 14, 7);
    ctx.fillStyle = '#20141c';
    ctx.fillRect(x + (chef.face > 0 ? 1 : -4), y - CHEF_H + 9, 3, 3);
    // apron & legs
    ctx.fillStyle = '#f4ece2';
    ctx.fillRect(x - 9, y - CHEF_H + 14, 18, 9);
    ctx.fillStyle = '#3c6fd1';
    const stride = Math.floor(chef.walk / 8) % 2 === 0 ? 3 : -3;
    ctx.fillRect(x - 8, y - 5, 6, 5);
    ctx.fillRect(x + 2 + stride, y - 5, 6, 5);
}

function drawEnemy(e) {
    const c = e.state === 'stunned' ? '#b7a8c9' : ENEMY_COLORS[e.kind];
    const x = e.x, y = e.y;
    if (e.state === 'dead') {
        ctx.fillStyle = 'rgba(180, 170, 190, 0.5)';
        ctx.fillRect(x - ENEMY_HALF_W, y - 5, ENEMY_HALF_W * 2, 5);
        return;
    }
    ctx.fillStyle = c;
    ctx.fillRect(x - ENEMY_HALF_W, y - ENEMY_H, ENEMY_HALF_W * 2, ENEMY_H - 5);
    ctx.fillStyle = '#20141c';
    ctx.fillRect(x - 6, y - ENEMY_H + 6, 4, 4);
    ctx.fillRect(x + 2, y - ENEMY_H + 6, 4, 4);
    ctx.fillStyle = e.state === 'stunned' ? '#8d7fa0' : '#2a1a24';
    ctx.fillRect(x - 9, y - 5, 6, 5);
    ctx.fillRect(x + 3, y - 5, 6, 5);
    if (e.state === 'stunned') {
        ctx.fillStyle = '#f4a13c';
        ctx.fillRect(x - 3, y - ENEMY_H - 6, 6, 4);
    }
}

function drawPeppers() {
    for (const c of peppers) {
        ctx.globalAlpha = Math.max(0, Math.min(1, c.life / PEPPER_LIFE));
        ctx.fillStyle = '#efe6b8';
        for (let i = 0; i < 10; i++) {
            const px = c.x0 + ((i * 13) % PEPPER_W);
            const py = c.y0 + ((i * 7) % (c.y1 - c.y0));
            ctx.fillRect(px, py, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#120c18';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawFloors();
    drawPlates();
    for (const p of pieces) drawPiece(p);
    for (const e of enemies) drawEnemy(e);
    drawPeppers();
    drawChef();
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    step(dt);
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

function held(keys) { return keys.some((k) => heldKeys.has(k)); }

function refreshKeyDir() {
    const dx = (held(RIGHT_KEYS) ? 1 : 0) - (held(LEFT_KEYS) ? 1 : 0);
    const dy = (held(DOWN_KEYS) ? 1 : 0) - (held(UP_KEYS) ? 1 : 0);
    // Climbing wins over walking when both are held, matching the arcade feel.
    moveChef(dy !== 0 ? 0 : dx, dy);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') sprayPepper();
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
pepper = PEPPER_START;
buildPieces();
updateHud();
requestAnimationFrame(frame);
