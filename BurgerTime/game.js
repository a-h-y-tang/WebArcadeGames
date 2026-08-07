// ---------------------------------------------------------------------------
// Burger Time — a platform-and-ladder arcade game on an HTML5 canvas.
//
// The chef runs along floors and climbs ladders. Walking across every slice of
// a burger ingredient makes it fall one floor; ingredients cascade down onto
// each other until they land on the plate at the bottom. Roaming enemies chase
// the chef, a falling ingredient squashes any enemy underneath it, and a shake
// of pepper freezes them for a few seconds.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// Snake and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so the tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 500;

// Walkable floors, top to bottom. The last one carries the plates, so it is
// both a floor the chef can run along and the resting place for finished
// burgers.
const FLOOR_Y = [70, 150, 230, 310, 390, 465];
const PLATE_IDX = FLOOR_Y.length - 1;
const PLATE_Y = FLOOR_Y[PLATE_IDX];
const FLOOR_X1 = 30;
const FLOOR_X2 = 570;
const FLOOR_H = 5;

// Ladder columns per gap: LADDER_GAPS[i] connects FLOOR_Y[i] to FLOOR_Y[i + 1].
// The columns are staggered so the chef has to plan a route rather than run
// straight up one side.
const LADDER_GAPS = [
    [170, 430],
    [34, 300, 566],
    [170, 430],
    [34, 300, 566],
    [170, 430],
];

// --- Burgers ---
const LANE_X = [53, 183, 313, 443]; // left edge of each burger column
const PIECES = 4;                   // slices per ingredient
const PIECE_W = 26;
const ING_W = PIECES * PIECE_W;
const SLICE_H = 10;
// Ingredient stacked top-to-bottom on floors 0..3 of each lane.
const LAYERS = [
    { type: 'bunTop', color: '#d68b3c', top: '#e8a75a' },
    { type: 'lettuce', color: '#4ea94b', top: '#6fd06b' },
    { type: 'patty', color: '#8a4b28', top: '#a35c33' },
    { type: 'bunBottom', color: '#c97f34', top: '#dd9848' },
];

// --- Actors ---
const CHEF_SPEED = 96;   // px/s
const CHEF_W = 16;
const CHEF_H = 24;
const ENEMY_W = 18;
const ENEMY_H = 20;
const SNAP = 6;          // how close to a floor/ladder counts as "on" it

// --- Enemies ---
const ENEMY_BASE = 46;
const ENEMY_STEP = 9;    // px/s added per level
const ENEMY_MAX = 5;
const RESPAWN_DELAY = 3; // seconds before a squashed enemy returns
const ENEMY_LOOK = 16;   // lookahead used when picking a direction at a node
const SPAWNS = [
    { x: FLOOR_X1, y: FLOOR_Y[0] },
    { x: FLOOR_X2, y: FLOOR_Y[0] },
    { x: FLOOR_X1, y: FLOOR_Y[2] },
    { x: FLOOR_X2, y: FLOOR_Y[2] },
    { x: 300, y: FLOOR_Y[0] },
];

// --- Pepper ---
const START_PEPPER = 5;
const MAX_PEPPER = 9;
const PEPPER_RANGE = 48;
const PEPPER_STUN = 3.5;

// --- Falling / scoring ---
const FALL_SPEED = 260;
const DROP_POINTS = 50;
const PLATE_POINTS = 100;
const SQUASH_POINTS = 100; // doubles for each extra enemy caught in one fall
const LEVEL_BONUS = 1000;
const START_LIVES = 3;
const RESPAWN_INVULN = 2; // seconds of grace after losing a life

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

// ---------------------------------------------------------------------------
// Static level geometry
// ---------------------------------------------------------------------------

function buildLadders() {
    const out = [];
    for (let gap = 0; gap < LADDER_GAPS.length; gap++) {
        for (const x of LADDER_GAPS[gap]) {
            out.push({ x, y1: FLOOR_Y[gap], y2: FLOOR_Y[gap + 1] });
        }
    }
    return out;
}

const LADDERS = buildLadders();

// Every x on a given floor where an enemy has a decision to make: the ends of
// the floor plus each ladder that touches it.
function buildNodes() {
    return FLOOR_Y.map((y) => {
        const xs = new Set([FLOOR_X1, FLOOR_X2]);
        for (const l of LADDERS) {
            if (Math.abs(l.y1 - y) < 0.001 || Math.abs(l.y2 - y) < 0.001) xs.add(l.x);
        }
        return Array.from(xs).sort((a, b) => a - b);
    });
}

const NODE_X = buildNodes();

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(y - FLOOR_Y[i]) <= SNAP) return i;
    }
    return -1;
}

// The ladder at (x, y) that can actually be travelled in direction `dy`.
function ladderAt(x, y, dy) {
    for (const l of LADDERS) {
        if (Math.abs(x - l.x) > SNAP) continue;
        if (y < l.y1 - SNAP || y > l.y2 + SNAP) continue;
        if (dy < 0 && y <= l.y1 + 0.001) continue;
        if (dy > 0 && y >= l.y2 - 0.001) continue;
        return l;
    }
    return null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, pepper;
const chef = { x: 300, y: PLATE_Y, dir: { dx: 0, dy: 0 }, facing: 1, invuln: 0, anim: 0 };
const enemies = [];
const ingredients = [];
const plates = LANE_X.map(() => ({ count: 0 }));
const puffs = [];   // pepper clouds (cosmetic + hit marker)
const sparks = [];  // squash confetti (cosmetic)

function enemySpeed() { return ENEMY_BASE + (level - 1) * ENEMY_STEP; }
function enemyCount() { return Math.min(ENEMY_MAX, 2 + level); }

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function makeIngredient(lane, floorIdx, layer) {
    return {
        lane,
        floorIdx,
        type: layer.type,
        color: layer.color,
        top: layer.top,
        x: LANE_X[lane],
        y: FLOOR_Y[floorIdx],
        pieces: Array.from({ length: PIECES }, () => ({ stepped: false })),
        falling: false,
        onPlate: false,
        targetIdx: -1,
        squashes: 0,
    };
}

function buildLevel() {
    ingredients.length = 0;
    for (let lane = 0; lane < LANE_X.length; lane++) {
        plates[lane].count = 0;
        for (let i = 0; i < LAYERS.length; i++) {
            ingredients.push(makeIngredient(lane, i, LAYERS[i]));
        }
    }
}

function spawnEnemy(x, y) {
    const e = { x, y, dir: { dx: 0, dy: 0 }, stun: 0, dead: false, respawn: 0, anim: 0 };
    chooseEnemyDir(e);
    enemies.push(e);
    return e;
}

function resetPositions() {
    chef.x = 300;
    chef.y = PLATE_Y;
    chef.dir = { dx: 0, dy: 0 };
    chef.facing = 1;
    chef.invuln = 0;
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const s = SPAWNS[i % SPAWNS.length];
        spawnEnemy(s.x, s.y);
    }
    puffs.length = 0;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChef(x, y) {
    chef.x = x;
    chef.y = y;
    chef.dir = { dx: 0, dy: 0 };
}

function moveChef(dx, dy) {
    chef.dir = { dx, dy };
    if (dx !== 0) chef.facing = dx;
}

// Horizontal travel needs a floor underfoot; vertical travel needs a ladder.
// Whichever axis is legal wins, and the actor snaps onto that rail so it always
// lines up with the level grid.
function moveActor(actor, dir, speed, h) {
    if (dir.dx !== 0) {
        const fi = floorIndexAt(actor.y);
        if (fi < 0) return false;
        actor.y = FLOOR_Y[fi];
        const before = actor.x;
        actor.x = clamp(actor.x + dir.dx * speed * h, FLOOR_X1, FLOOR_X2);
        return actor.x !== before;
    }
    if (dir.dy !== 0) {
        const l = ladderAt(actor.x, actor.y, dir.dy);
        if (!l) return false;
        actor.x = l.x;
        const before = actor.y;
        actor.y = clamp(actor.y + dir.dy * speed * h, l.y1, l.y2);
        return actor.y !== before;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

// Mark any slice the chef is currently standing on; a fully-walked ingredient
// falls.
function trampleIngredients() {
    for (const ing of ingredients) {
        if (ing.falling || ing.onPlate) continue;
        if (Math.abs(chef.y - ing.y) > 2) continue;
        if (chef.x < ing.x || chef.x > ing.x + ING_W) continue;
        const idx = Math.min(PIECES - 1, Math.floor((chef.x - ing.x) / PIECE_W));
        if (!ing.pieces[idx].stepped) {
            ing.pieces[idx].stepped = true;
            if (ing.pieces.every((p) => p.stepped)) dropIngredient(ing);
        }
    }
}

// Start an ingredient falling to the next floor down. Anything already resting
// on that floor in the same lane is knocked loose first, which is what produces
// the classic cascade all the way to the plate.
function dropIngredient(ing) {
    if (ing.falling || ing.onPlate) return;
    const next = ing.floorIdx + 1;
    if (next > PLATE_IDX) return;
    for (const other of ingredients) {
        if (other === ing || other.falling || other.onPlate) continue;
        if (other.lane === ing.lane && other.floorIdx === next) dropIngredient(other);
    }
    ing.falling = true;
    ing.targetIdx = next;
    ing.squashes = 0;
    score += DROP_POINTS;
}

function restY(ing) {
    if (ing.targetIdx === PLATE_IDX) return PLATE_Y - plates[ing.lane].count * SLICE_H;
    return FLOOR_Y[ing.targetIdx];
}

function landIngredient(ing) {
    if (ing.targetIdx === PLATE_IDX) {
        ing.y = PLATE_Y - plates[ing.lane].count * SLICE_H;
        plates[ing.lane].count += 1;
        ing.onPlate = true;
        ing.floorIdx = PLATE_IDX;
        score += PLATE_POINTS;
    } else {
        ing.floorIdx = ing.targetIdx;
        ing.y = FLOOR_Y[ing.floorIdx];
        for (const p of ing.pieces) p.stepped = false;
    }
    ing.falling = false;
    ing.targetIdx = -1;
}

function squashEnemy(e) {
    if (e.dead) return;
    e.dead = true;
    e.respawn = RESPAWN_DELAY;
    e.stun = 0;
    for (let i = 0; i < 8; i++) {
        sparks.push({
            x: e.x, y: e.y - ENEMY_H / 2,
            vx: (Math.random() - 0.5) * 160,
            vy: -Math.random() * 130,
            life: 0.5,
        });
    }
}

function updateFalling(h) {
    // Lowest first, so a lane that is cascading resolves bottom-up.
    const falling = ingredients.filter((i) => i.falling).sort((a, b) => b.y - a.y);
    for (const ing of falling) {
        ing.y += FALL_SPEED * h;

        // Anything under the slab gets flattened.
        for (const e of enemies) {
            if (e.dead) continue;
            if (e.x < ing.x - ENEMY_W / 2 || e.x > ing.x + ING_W + ENEMY_W / 2) continue;
            if (e.y < ing.y - SLICE_H || e.y - ENEMY_H > ing.y) continue;
            squashEnemy(e);
            ing.squashes += 1;
            score += SQUASH_POINTS * Math.pow(2, ing.squashes - 1);
        }

        const rest = restY(ing);
        if (ing.y >= rest) {
            ing.y = rest;
            landIngredient(ing);
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

// Greedy chase: at every junction pick the legal direction that closes the most
// distance to the chef, never doubling straight back unless it is the only way
// out. Deterministic, so the tests can rely on it.
function chooseEnemyDir(e) {
    const opts = [];
    if (floorIndexAt(e.y) >= 0) {
        if (e.x > FLOOR_X1) opts.push({ dx: -1, dy: 0 });
        if (e.x < FLOOR_X2) opts.push({ dx: 1, dy: 0 });
    }
    if (ladderAt(e.x, e.y, -1)) opts.push({ dx: 0, dy: -1 });
    if (ladderAt(e.x, e.y, 1)) opts.push({ dx: 0, dy: 1 });
    if (!opts.length) { e.dir = { dx: 0, dy: 0 }; return; }

    let pool = opts.filter((o) => !(o.dx === -e.dir.dx && o.dy === -e.dir.dy));
    if (!pool.length) pool = opts;

    let best = pool[0];
    let bestScore = Infinity;
    for (const o of pool) {
        const nx = e.x + o.dx * ENEMY_LOOK;
        const ny = e.y + o.dy * ENEMY_LOOK;
        // Vertical distance is weighted: getting onto the chef's floor matters
        // more than shaving a few pixels sideways.
        const s = Math.abs(chef.x - nx) + Math.abs(chef.y - ny) * 1.6;
        if (s < bestScore) { bestScore = s; best = o; }
    }
    e.dir = best;
}

// Returns the first value in `values` strictly crossed while moving from
// `from` to `to`, or null.
function crossed(values, from, to) {
    let hit = null;
    for (const v of values) {
        if (from < v && to >= v) { if (hit === null || v < hit) hit = v; }
        else if (from > v && to <= v) { if (hit === null || v > hit) hit = v; }
    }
    return hit;
}

function updateEnemies(h) {
    for (const e of enemies) {
        if (e.dead) {
            e.respawn -= h;
            if (e.respawn <= 0) {
                const s = SPAWNS[Math.floor(e.x / 200) % SPAWNS.length];
                e.x = s.x;
                e.y = s.y;
                e.dead = false;
                e.dir = { dx: 0, dy: 0 };
                chooseEnemyDir(e);
            }
            continue;
        }
        if (e.stun > 0) {
            e.stun -= h;
            continue;
        }

        const speed = enemySpeed();
        e.anim += speed * h;

        if (e.dir.dy !== 0) {
            const l = ladderAt(e.x, e.y, e.dir.dy);
            if (!l) { chooseEnemyDir(e); continue; }
            e.x = l.x;
            const from = e.y;
            e.y = clamp(e.y + e.dir.dy * speed * h, l.y1, l.y2);
            const hit = crossed(FLOOR_Y, from, e.y);
            if (hit !== null) { e.y = hit; chooseEnemyDir(e); }
        } else if (e.dir.dx !== 0) {
            const fi = floorIndexAt(e.y);
            if (fi < 0) { chooseEnemyDir(e); continue; }
            e.y = FLOOR_Y[fi];
            const from = e.x;
            e.x = clamp(e.x + e.dir.dx * speed * h, FLOOR_X1, FLOOR_X2);
            const hit = crossed(NODE_X[fi], from, e.x);
            if (hit !== null) { e.x = hit; chooseEnemyDir(e); }
        } else {
            chooseEnemyDir(e);
        }
    }
}

function checkCaught() {
    if (chef.invuln > 0) return;
    for (const e of enemies) {
        if (e.dead || e.stun > 0) continue;
        if (Math.abs(chef.x - e.x) < 13 && Math.abs(chef.y - e.y) < 18) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    resetPositions();
    chef.invuln = RESPAWN_INVULN;
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function usePepper() {
    if (state !== 'running' || pepper <= 0) return;
    pepper -= 1;
    const x1 = chef.facing > 0 ? chef.x - 6 : chef.x - PEPPER_RANGE;
    const x2 = chef.facing > 0 ? chef.x + PEPPER_RANGE : chef.x + 6;
    puffs.push({ x1, x2, y: chef.y, life: 0.45 });
    for (const e of enemies) {
        if (e.dead) continue;
        if (e.x < x1 || e.x > x2) continue;
        if (Math.abs(e.y - chef.y) > 22) continue;
        e.stun = PEPPER_STUN;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (chef.invuln > 0) chef.invuln -= h;

    if (moveActor(chef, chef.dir, CHEF_SPEED, h)) chef.anim += CHEF_SPEED * h;

    trampleIngredients();
    updateFalling(h);
    updateEnemies(h);
    checkCaught();

    if (state === 'running' && ingredients.length && ingredients.every((i) => i.onPlate)) {
        completeLevel();
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast
// falling ingredients never tunnel past a floor or an enemy.
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
    pepper = START_PEPPER;
    sparks.length = 0;
    buildLevel();
    resetPositions();
    hideOverlay();
    updateHud();
}

function completeLevel() {
    score += LEVEL_BONUS;
    level += 1;
    pepper = Math.min(MAX_PEPPER, pepper + 1);
    buildLevel();
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
// Cosmetic particles
// ---------------------------------------------------------------------------

function updateEffects(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 420 * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
        puffs[i].life -= dt;
        if (puffs[i].life <= 0) puffs.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawLevel() {
    // Ladders behind the floors so the rails read as passing through.
    for (const l of LADDERS) {
        ctx.strokeStyle = '#4b5f8a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.x - 8, l.y1);
        ctx.lineTo(l.x - 8, l.y2);
        ctx.moveTo(l.x + 8, l.y1);
        ctx.lineTo(l.x + 8, l.y2);
        ctx.stroke();
        ctx.strokeStyle = '#3a4a6d';
        for (let y = l.y1 + 10; y < l.y2; y += 12) {
            ctx.beginPath();
            ctx.moveTo(l.x - 8, y);
            ctx.lineTo(l.x + 8, y);
            ctx.stroke();
        }
    }

    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#5b6ea8';
        ctx.fillRect(FLOOR_X1 - 4, y, FLOOR_X2 - FLOOR_X1 + 8, FLOOR_H);
        ctx.fillStyle = '#8fa3dd';
        ctx.fillRect(FLOOR_X1 - 4, y, FLOOR_X2 - FLOOR_X1 + 8, 2);
    }

    // Plates.
    for (let lane = 0; lane < LANE_X.length; lane++) {
        const cx = LANE_X[lane] + ING_W / 2;
        ctx.fillStyle = '#cfd6e6';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 10, ING_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa5bd';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 8, ING_W / 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    for (let i = 0; i < PIECES; i++) {
        const px = ing.x + i * PIECE_W;
        // A stepped slice sags, which is the visual cue for progress.
        const sag = !ing.falling && !ing.onPlate && ing.pieces[i].stepped ? 4 : 0;
        const top = ing.y - SLICE_H + sag;
        ctx.fillStyle = ing.color;
        ctx.fillRect(px, top, PIECE_W, SLICE_H);
        ctx.fillStyle = ing.top;
        ctx.fillRect(px, top, PIECE_W, 3);
        ctx.strokeStyle = 'rgba(0,0,0,0.28)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, top + 0.5, PIECE_W - 1, SLICE_H - 1);
    }
    if (ing.type === 'lettuce') {
        ctx.fillStyle = '#7ee07a';
        for (let i = 0; i < 6; i++) {
            ctx.fillRect(ing.x + 6 + i * 16, ing.y - SLICE_H - 2, 10, 3);
        }
    }
}

function drawChef() {
    if (chef.invuln > 0 && Math.floor(chef.invuln * 10) % 2 === 0) return;
    const x = chef.x;
    const y = chef.y;
    // Legs.
    const swing = Math.sin(chef.anim / 7) * 4;
    ctx.strokeStyle = '#2b3350';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x - 4 + swing, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 4 - swing, y);
    ctx.stroke();
    // Body.
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 6, CHEF_W, CHEF_H - 14);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x - CHEF_W / 2, y - 12, CHEF_W, 4);
    // Head + hat.
    ctx.fillStyle = '#f0c49b';
    ctx.beginPath();
    ctx.arc(x, y - CHEF_H + 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - CHEF_H - 6, 12, 6);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x + chef.facing * 2 - 1, y - CHEF_H + 1, 2, 2);
}

const ENEMY_COLORS = ['#ef4444', '#facc15', '#22d3ee', '#c084fc', '#fb923c'];

function drawEnemies() {
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const bob = e.stun > 0 ? 0 : Math.sin(e.anim / 8) * 2;
        ctx.fillStyle = e.stun > 0 ? '#8ea0c4' : ENEMY_COLORS[i % ENEMY_COLORS.length];
        ctx.beginPath();
        ctx.roundRect
            ? ctx.roundRect(e.x - ENEMY_W / 2, e.y - ENEMY_H + bob, ENEMY_W, ENEMY_H, 6)
            : ctx.rect(e.x - ENEMY_W / 2, e.y - ENEMY_H + bob, ENEMY_W, ENEMY_H);
        ctx.fill();
        ctx.fillStyle = '#0d0a14';
        ctx.fillRect(e.x - 5, e.y - ENEMY_H + 6 + bob, 3, 3);
        ctx.fillRect(e.x + 2, e.y - ENEMY_H + 6 + bob, 3, 3);
        if (e.stun > 0) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(e.x - 4, e.y - ENEMY_H - 4 + bob, 2, 2);
            ctx.fillRect(e.x + 2, e.y - ENEMY_H - 6 + bob, 2, 2);
        }
    }
}

function drawEffects() {
    for (const p of puffs) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = '#e7d6a8';
        for (let i = 0; i < 10; i++) {
            const t = i / 9;
            ctx.fillRect(p.x1 + (p.x2 - p.x1) * t, p.y - 10 - Math.sin(t * Math.PI) * 8, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
    for (const s of sparks) {
        ctx.globalAlpha = Math.max(0, s.life * 2);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLevel();
    for (const ing of ingredients) drawIngredient(ing);
    drawEnemies();
    drawChef();
    drawEffects();
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
    if (state === 'running') step(dt);
    updateEffects(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const DIR_KEYS = {
    ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 }, A: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 }, D: { dx: 1, dy: 0 },
    ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 }, W: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 }, S: { dx: 0, dy: 1 },
};

// Most recently pressed direction wins, so holding left and tapping up climbs.
const held = [];

function refreshDir() {
    for (let i = held.length - 1; i >= 0; i--) {
        const d = DIR_KEYS[held[i]];
        if (d) { moveChef(d.dx, d.dy); return; }
    }
    moveChef(0, 0);
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') usePepper();
        e.preventDefault();
        return;
    }
    if (DIR_KEYS[e.key]) {
        if (!held.includes(e.key)) held.push(e.key);
        refreshDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const i = held.indexOf(e.key);
    if (i >= 0) {
        held.splice(i, 1);
        refreshDir();
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
pepper = START_PEPPER;
buildLevel();
resetPositions();
updateHud();
requestAnimationFrame(frame);
