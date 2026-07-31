// ---------------------------------------------------------------------------
// BurgerTime — a platform/puzzle arcade game on an HTML5 canvas.
//
// Chef Pepper runs around a lattice of floors and ladders, walking across
// burger ingredients to knock them down onto the plates below while dodging a
// hot dog, a pickle and a fried egg. A shake of pepper freezes the food for a
// few seconds; an ingredient dropped on a pursuer squashes it flat.
//
// Written as a single classic (non-module) script so the state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom!,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 520;

// Walkable floors, top to bottom. The last one carries the plates.
const FLOOR_Y = [70, 150, 230, 310, 390, 470];
const PLATE_LEVEL = FLOOR_Y.length - 1;
const FLOOR_X0 = 20;
const FLOOR_X1 = 580;
const FLOOR_TOL = 1.5;   // how close counts as "standing on" a floor
const FLOOR_SNAP = 7;    // how close you can step off a ladder onto a floor

// Ladders. `top`/`bottom` are floor indices; a ladder spans between them.
const LADDERS = [
    { x: 30, top: 0, bottom: 5 },
    { x: 210, top: 0, bottom: 5 },
    { x: 390, top: 0, bottom: 5 },
    { x: 570, top: 0, bottom: 5 },
    { x: 105, top: 2, bottom: 5 },
    { x: 495, top: 0, bottom: 3 },
];
const LADDER_SNAP = 10;  // how far off-column you can grab a ladder

// --- Burgers ---
const BURGER_X = [60, 240, 420];   // left edge of each burger column
const SEG_W = 30;                  // one of the four segments of an ingredient
const SEG_COUNT = 4;
const ING_W = SEG_W * SEG_COUNT;
const ING_H = 8;
const SEG_DIP = 4;                 // how far a stepped-on segment sags
const FALL_SPEED = 220;            // px/s
// Bottom of the stack first, so the bottom bun starts nearest the plates.
const ING_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];

// --- Chef ---
const CHEF_W = 18;
const CHEF_H = 26;
const CHEF_SPEED = 95;             // px/s
const CHEF_START_X = 300;
const CHEF_START_FLOOR = 4;

// --- Pepper ---
const START_PEPPER = 5;
const SPRAY_W = 32;
const SPRAY_H = 26;
const SPRAY_OFFSET = 24;
const SPRAY_LIFE = 0.35;           // seconds the cloud hangs in the air
const STUN_TIME = 3;               // seconds an enemy stays frozen

// --- Enemies ---
const ENEMY_W = 20;
const ENEMY_H = 24;
const ENEMY_BASE_SPEED = 52;
const ENEMY_SPEED_STEP = 6;
const ENEMY_TYPES = ['hotdog', 'pickle', 'egg'];
const RESPAWN_TIME = 6;            // seconds before a squashed enemy returns
const ENEMY_SPAWNS = [
    { x: 30, floor: 5 },
    { x: 570, floor: 5 },
    { x: 300, floor: 0 },
    { x: 210, floor: 0 },
    { x: 390, floor: 5 },
    { x: 105, floor: 0 },
];
const MAX_ENEMIES = 6;

// --- Scoring / lives ---
const START_LIVES = 3;
const POINTS_DROP = 50;
const POINTS_SQUASH = 500;
const LEVEL_BONUS = 1000;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const pepperEl = document.getElementById('pepper');
const levelEl = document.getElementById('level');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, lives, pepper, levelNumber;
const chef = { x: CHEF_START_X, y: FLOOR_Y[CHEF_START_FLOOR], dirX: 0, dirY: 0, facing: 1, walk: 0 };
const ingredients = [];
const enemies = [];
const sprays = [];
const plates = [0, 0, 0];
const particles = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Index of the floor a Y coordinate is standing on, or -1. */
function floorIndexAt(y) {
    for (let i = 0; i < FLOOR_Y.length; i++) {
        if (Math.abs(FLOOR_Y[i] - y) <= FLOOR_TOL) return i;
    }
    return -1;
}

/** Nearest floor within `tol` pixels, or -1. */
function nearestFloorIndex(y, tol) {
    let best = -1;
    let bestD = tol;
    for (let i = 0; i < FLOOR_Y.length; i++) {
        const d = Math.abs(FLOOR_Y[i] - y);
        if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Can this ladder be ridden from `y` in direction `dir` (-1 up, +1 down)? */
function ladderAllows(l, y, dir) {
    const top = FLOOR_Y[l.top];
    const bottom = FLOOR_Y[l.bottom];
    if (y < top - FLOOR_TOL || y > bottom + FLOOR_TOL) return false;
    if (dir < 0) return y > top + 0.001;
    if (dir > 0) return y < bottom - 0.001;
    return true;
}

/** The ladder reachable from (x, y) heading in `dir`, or null. */
function ladderAt(x, y, dir) {
    let found = null;
    let bestD = LADDER_SNAP;
    for (const l of LADDERS) {
        const d = Math.abs(l.x - x);
        if (d > bestD) continue;
        if (!ladderAllows(l, y, dir)) continue;
        bestD = d;
        found = l;
    }
    return found;
}

function walkBounds(halfWidth) {
    return [FLOOR_X0 + halfWidth, FLOOR_X1 - halfWidth];
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function restY(level) {
    return FLOOR_Y[level] - ING_H;
}

function plateTopY(burger) {
    return FLOOR_Y[PLATE_LEVEL] - ING_H * (plates[burger] + 1);
}

function makeSegments() {
    const segs = [];
    for (let i = 0; i < SEG_COUNT; i++) segs.push({ stepped: false, dip: 0 });
    return segs;
}

function resetSegments(ing) {
    for (const s of ing.segments) { s.stepped = false; s.dip = 0; }
}

/** Rebuild the burgers and clear the board decorations. */
function buildBurgers() {
    ingredients.length = 0;
    for (let b = 0; b < BURGER_X.length; b++) {
        plates[b] = 0;
        for (let level = 0; level < ING_TYPES.length; level++) {
            ingredients.push({
                burger: b,
                type: ING_TYPES[level],
                x: BURGER_X[b],
                level,
                y: restY(level),
                target: level,
                segments: makeSegments(),
                falling: false,
                plated: false,
            });
        }
    }
    sprays.length = 0;
    particles.length = 0;
}

function buildLevel() {
    buildBurgers();
    enemies.length = 0;
    const count = Math.min(2 + levelNumber, MAX_ENEMIES);
    for (let i = 0; i < count; i++) {
        const spot = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length];
        spawnEnemy(ENEMY_TYPES[i % ENEMY_TYPES.length], spot.x, FLOOR_Y[spot.floor]);
    }
    resetPositions();
}

function resetPositions() {
    chef.x = CHEF_START_X;
    chef.y = FLOOR_Y[CHEF_START_FLOOR];
    chef.dirX = 0;
    chef.dirY = 0;
    chef.facing = 1;
    sprays.length = 0;
    for (let i = 0; i < enemies.length; i++) {
        const spot = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length];
        const e = enemies[i];
        e.x = spot.x;
        e.y = FLOOR_Y[spot.floor];
        e.dirX = 0;
        e.dirY = 0;
        e.stun = 0;
        e.alive = true;
        e.respawn = 0;
    }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefDir(dx, dy) {
    chef.dirX = Math.sign(dx) || 0;
    chef.dirY = Math.sign(dy) || 0;
    if (chef.dirX !== 0) chef.facing = chef.dirX;
}

function moveChef(dt) {
    const dist = CHEF_SPEED * dt;

    if (chef.dirY !== 0) {
        const l = ladderAt(chef.x, chef.y, chef.dirY);
        if (l) {
            chef.x = l.x;
            chef.y = clamp(chef.y + chef.dirY * dist, FLOOR_Y[l.top], FLOOR_Y[l.bottom]);
            chef.walk += dist;
            return;
        }
    }

    if (chef.dirX !== 0) {
        let fi = floorIndexAt(chef.y);
        if (fi < 0) {
            // Stepping off a ladder onto a floor you are nearly level with.
            const near = nearestFloorIndex(chef.y, FLOOR_SNAP);
            if (near >= 0) { chef.y = FLOOR_Y[near]; fi = near; }
        }
        if (fi >= 0) {
            const [lo, hi] = walkBounds(CHEF_W / 2);
            chef.x = clamp(chef.x + chef.dirX * dist, lo, hi);
            chef.walk += dist;
        }
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** Knock an ingredient down one floor. Returns true if it started falling. */
function dropIngredient(ing) {
    if (!ing || ing.falling || ing.plated) return false;
    for (const s of ing.segments) { s.stepped = true; s.dip = SEG_DIP; }
    ing.falling = true;
    ing.target = ing.level + 1;
    return true;
}

function stepOnIngredients() {
    const fi = floorIndexAt(chef.y);
    if (fi < 0) return;
    for (const ing of [...ingredients]) {
        if (ing.falling || ing.plated || ing.level !== fi) continue;
        let changed = false;
        for (let i = 0; i < SEG_COUNT; i++) {
            const seg = ing.segments[i];
            if (seg.stepped) continue;
            const x0 = ing.x + i * SEG_W;
            if (chef.x >= x0 && chef.x <= x0 + SEG_W) {
                seg.stepped = true;
                seg.dip = SEG_DIP;
                changed = true;
            }
        }
        if (changed && ing.segments.every((s) => s.stepped)) {
            ing.falling = true;
            ing.target = ing.level + 1;
        }
    }
}

function squashCheck(ing) {
    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.x + ENEMY_W / 2 < ing.x || e.x - ENEMY_W / 2 > ing.x + ING_W) continue;
        if (e.y < ing.y || e.y - ENEMY_H > ing.y + ING_H) continue;
        e.alive = false;
        e.respawn = RESPAWN_TIME;
        e.stun = 0;
        score += POINTS_SQUASH;
        burst(e.x, e.y - ENEMY_H / 2, '#fbbf24');
    }
}

function landIngredient(ing) {
    score += POINTS_DROP;
    ing.falling = false;
    ing.level = ing.target;
    resetSegments(ing);

    if (ing.level === PLATE_LEVEL) {
        ing.plated = true;
        plates[ing.burger]++;
        burst(ing.x + ING_W / 2, ing.y, '#f97316');
        checkLevelComplete();
        return;
    }

    const occupant = ingredients.find(
        (o) => o !== ing && o.burger === ing.burger && !o.plated && !o.falling && o.level === ing.level
    );
    if (occupant) {
        occupant.falling = true;
        occupant.target = occupant.level + 1;
        resetSegments(occupant);
    }
}

function updateIngredients(dt) {
    for (const ing of [...ingredients]) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;
        squashCheck(ing);
        const landY = ing.target === PLATE_LEVEL ? plateTopY(ing.burger) : restY(ing.target);
        if (ing.y >= landY) {
            ing.y = landY;
            landIngredient(ing);
        }
    }
    for (const ing of ingredients) {
        for (const s of ing.segments) {
            if (!s.stepped && s.dip > 0) s.dip = Math.max(0, s.dip - 20 * dt);
        }
    }
}

function allPlated() {
    return ingredients.length > 0 && ingredients.every((i) => i.plated);
}

function checkLevelComplete() {
    if (!allPlated()) return;
    score += LEVEL_BONUS;
    levelNumber++;
    pepper = Math.min(START_PEPPER, pepper + 1);
    buildLevel();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper--;
    sprays.push({
        x: clamp(chef.x + chef.facing * SPRAY_OFFSET, 0, CANVAS_W),
        y: chef.y - CHEF_H / 2,
        life: SPRAY_LIFE,
    });
    updateHud();
    return true;
}

function updateSprays(dt) {
    for (let i = sprays.length - 1; i >= 0; i--) {
        const s = sprays[i];
        s.life -= dt;
        for (const e of enemies) {
            if (!e.alive) continue;
            if (Math.abs(e.x - s.x) > (ENEMY_W + SPRAY_W) / 2) continue;
            if (Math.abs((e.y - ENEMY_H / 2) - s.y) > (ENEMY_H + SPRAY_H) / 2) continue;
            e.stun = STUN_TIME;
            e.dirX = 0;
            e.dirY = 0;
        }
        if (s.life <= 0) sprays.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemy(type, x, y) {
    const e = {
        type,
        x,
        y,
        dirX: 0,
        dirY: 0,
        stun: 0,
        alive: true,
        respawn: 0,
        wobble: enemies.length * 0.7,
    };
    enemies.push(e);
    return e;
}

function enemySpeed() {
    return ENEMY_BASE_SPEED + (levelNumber - 1) * ENEMY_SPEED_STEP;
}

/** Greedy chase: climb toward the chef when possible, otherwise walk to the
 *  ladder that best shortens the trip. Fully deterministic — no RNG. */
function enemyDecide(e) {
    const dy = chef.y - e.y;
    if (Math.abs(dy) > FLOOR_TOL) {
        const dir = Math.sign(dy);
        const here = ladderAt(e.x, e.y, dir);
        if (here) {
            e.x = here.x;
            e.dirX = 0;
            e.dirY = dir;
            return;
        }
        const usable = LADDERS.filter((l) => ladderAllows(l, e.y, dir));
        if (usable.length) {
            let bestLadder = usable[0];
            let bestCost = Infinity;
            for (const l of usable) {
                const cost = Math.abs(l.x - e.x) + Math.abs(l.x - chef.x);
                if (cost < bestCost) { bestCost = cost; bestLadder = l; }
            }
            e.dirY = 0;
            e.dirX = Math.sign(bestLadder.x - e.x) || 1;
            return;
        }
    }
    e.dirY = 0;
    e.dirX = Math.sign(chef.x - e.x) || 0;
}

function moveEnemy(e, dt) {
    const dist = enemySpeed() * dt;

    if (e.dirY !== 0) {
        const l = ladderAt(e.x, e.y, e.dirY);
        if (!l) { e.dirY = 0; return; }
        const prevY = e.y;
        e.x = l.x;
        e.y = clamp(e.y + e.dirY * dist, FLOOR_Y[l.top], FLOOR_Y[l.bottom]);
        // Stop at any floor crossed so the chase can be re-evaluated there.
        for (const fy of FLOOR_Y) {
            if ((prevY < fy - FLOOR_TOL && e.y >= fy) || (prevY > fy + FLOOR_TOL && e.y <= fy)) {
                e.y = fy;
                e.dirY = 0;
                break;
            }
        }
        return;
    }

    if (e.dirX !== 0 && floorIndexAt(e.y) >= 0) {
        const [lo, hi] = walkBounds(ENEMY_W / 2);
        e.x = clamp(e.x + e.dirX * dist, lo, hi);
    }
}

function updateEnemies(dt) {
    for (const e of enemies) {
        if (!e.alive) {
            e.respawn -= dt;
            if (e.respawn <= 0) {
                const spot = ENEMY_SPAWNS[enemies.indexOf(e) % ENEMY_SPAWNS.length];
                e.x = spot.x;
                e.y = FLOOR_Y[spot.floor];
                e.alive = true;
                e.dirX = 0;
                e.dirY = 0;
            }
            continue;
        }
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        if (floorIndexAt(e.y) >= 0) enemyDecide(e);
        moveEnemy(e, dt);
    }
}

function enemyTouchingChef() {
    for (const e of enemies) {
        if (!e.alive || e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) >= (CHEF_W + ENEMY_W) / 2) continue;
        if (Math.abs(e.y - chef.y) >= 20) continue;
        return e;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Lives / game flow
// ---------------------------------------------------------------------------

function loseLife() {
    lives--;
    burst(chef.x, chef.y - CHEF_H / 2, '#f87171');
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    resetPositions();
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* ignore */ }
    }
    showOverlay('GAME OVER', `Score ${score} · Best ${best}`, 'Press Space or click Start to play again');
    updateHud();
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    pepper = START_PEPPER;
    levelNumber = 1;
    buildLevel();
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Particles (pure decoration)
// ---------------------------------------------------------------------------

function burst(x, y, color) {
    for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10;
        particles.push({ x, y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70 - 30, life: 0.5, color });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 320 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    moveChef(dt);
    stepOnIngredients();
    updateIngredients(dt);
    updateSprays(dt);
    updateEnemies(dt);
    if (state === 'running' && enemyTouchingChef()) loseLife();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    levelEl.textContent = String(levelNumber);
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
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    'bun-top': ['#d9903f', '#b9712a'],
    lettuce: ['#6cc24a', '#4a9a30'],
    patty: ['#8b5a2b', '#6b421c'],
    'bun-bottom': ['#c9822f', '#a0631f'],
};

const ENEMY_COLORS = {
    hotdog: '#f97362',
    pickle: '#7bd66a',
    egg: '#f4e3a1',
};

function drawFloors() {
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#3b4a6b';
        ctx.fillRect(FLOOR_X0, y, FLOOR_X1 - FLOOR_X0, 4);
        ctx.fillStyle = '#54679a';
        ctx.fillRect(FLOOR_X0, y, FLOOR_X1 - FLOOR_X0, 1.5);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const top = FLOOR_Y[l.top];
        const bottom = FLOOR_Y[l.bottom];
        ctx.strokeStyle = '#8fa3d4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(l.x - 9, top);
        ctx.lineTo(l.x - 9, bottom);
        ctx.moveTo(l.x + 9, top);
        ctx.lineTo(l.x + 9, bottom);
        ctx.stroke();
        ctx.strokeStyle = '#6b7fb3';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let y = top + 8; y < bottom; y += 10) {
            ctx.moveTo(l.x - 9, y);
            ctx.lineTo(l.x + 9, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    ctx.fillStyle = '#cbd5e1';
    for (const bx of BURGER_X) {
        const cx = bx + ING_W / 2;
        const y = FLOOR_Y[PLATE_LEVEL] + 3;
        ctx.beginPath();
        ctx.ellipse(cx, y, ING_W / 2 + 8, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(cx - ING_W / 2 - 8, y, ING_W + 16, 3);
        ctx.fillStyle = '#cbd5e1';
    }
}

function drawIngredient(ing) {
    const [light, dark] = ING_COLORS[ing.type] || ING_COLORS.patty;
    for (let i = 0; i < SEG_COUNT; i++) {
        const seg = ing.segments[i];
        const x = ing.x + i * SEG_W;
        const y = ing.y + (ing.falling || ing.plated ? 0 : seg.dip);
        ctx.fillStyle = dark;
        ctx.fillRect(x, y + ING_H - 3, SEG_W, 3);
        ctx.fillStyle = light;
        ctx.fillRect(x, y, SEG_W, ING_H - 3);
        if (ing.type === 'bun-top') {
            ctx.fillStyle = '#fde68a';
            for (let s = 0; s < 3; s++) ctx.fillRect(x + 5 + s * 8, y + 2, 3, 1.5);
        } else if (ing.type === 'lettuce') {
            ctx.fillStyle = '#a7e58c';
            ctx.fillRect(x, y, SEG_W, 2);
        }
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const bob = Math.sin(chef.walk / 7) * 1.5;
    // legs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(x - 6, y - 8, 4, 8 + bob);
    ctx.fillRect(x + 2, y - 8, 4, 8 - bob);
    // body
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x - CHEF_W / 2, y - 20, CHEF_W, 13);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - CHEF_W / 2, y - 12, CHEF_W, 3);
    // head + hat
    ctx.fillStyle = '#fcd9b0';
    ctx.fillRect(x - 6, y - 27, 12, 8);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -4), y - 25, 3, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 33, 16, 6);
    ctx.fillRect(x - 6, y - 36, 12, 4);
}

function drawEnemy(e) {
    const color = ENEMY_COLORS[e.type] || '#f87171';
    const x = e.x;
    const y = e.y;
    if (!e.alive) {
        ctx.fillStyle = 'rgba(148,163,184,0.35)';
        ctx.fillRect(x - ENEMY_W / 2, y - 4, ENEMY_W, 4);
        return;
    }
    const frozen = e.stun > 0;
    const body = frozen ? '#93c5fd' : color;
    const step = Math.floor(x / 8) % 2 === 0 ? 1 : -1;

    // legs (they shuffle as the sprite moves)
    ctx.fillStyle = frozen ? '#60a5fa' : '#e2e8f0';
    ctx.fillRect(x - 7, y - 6, 4, 6 - step);
    ctx.fillRect(x + 3, y - 6, 4, 6 + step);

    ctx.fillStyle = body;
    if (e.type === 'egg') {
        ctx.beginPath();
        ctx.ellipse(x, y - 13, ENEMY_W / 2 + 2, ENEMY_H / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = frozen ? '#bfdbfe' : '#f6a623';
        ctx.beginPath();
        ctx.arc(x, y - 13, 4.5, 0, Math.PI * 2);
        ctx.fill();
    } else if (e.type === 'hotdog') {
        // bun
        ctx.fillStyle = frozen ? '#93c5fd' : '#d9a05b';
        ctx.fillRect(x - ENEMY_W / 2, y - 18, ENEMY_W, 12);
        // sausage
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(x, y - 14, ENEMY_W / 2 - 1, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // mustard
        ctx.fillStyle = frozen ? '#dbeafe' : '#facc15';
        for (let i = 0; i < 3; i++) ctx.fillRect(x - 7 + i * 6, y - 16, 3, 1.5);
    } else {
        // pickle: bumpy green body
        ctx.beginPath();
        ctx.ellipse(x, y - 13, ENEMY_W / 2, ENEMY_H / 2 - 1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = frozen ? '#bfdbfe' : '#4faa3c';
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(x - 5 + i * 5, y - 17 + (i % 2) * 6, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // eyes
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(x - 5, y - 17, 3, 3);
    ctx.fillRect(x + 2, y - 17, 3, 3);

    if (frozen) {
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(x - 1.5, y - ENEMY_H - 8, 3, 3);
        ctx.fillRect(x - 6, y - ENEMY_H - 4, 3, 3);
        ctx.fillRect(x + 4, y - ENEMY_H - 6, 3, 3);
    }
}

function drawSprays() {
    for (const s of sprays) {
        const a = Math.max(0, s.life / SPRAY_LIFE);
        ctx.fillStyle = `rgba(226,232,240,${0.25 + a * 0.5})`;
        for (let i = 0; i < 7; i++) {
            const ang = (Math.PI * 2 * i) / 7;
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(ang) * 9, s.y + Math.sin(ang) * 7, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function drawParticles() {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // faint checkerboard kitchen tiling
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let y = 0; y < CANVAS_H; y += 40) {
        for (let x = ((y / 40) % 2) * 40; x < CANVAS_W; x += 80) {
            ctx.fillRect(x, y, 40, 40);
        }
    }

    drawLadders();
    drawFloors();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawSprays();
    drawChef();
    drawParticles();

    if (state === 'paused') {
        ctx.fillStyle = 'rgba(11,16,32,0.55)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
}

// ---------------------------------------------------------------------------
// Main loop. Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateParticles(dt);
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

function refreshKeyDir() {
    const left = LEFT_KEYS.some((k) => heldKeys.has(k));
    const right = RIGHT_KEYS.some((k) => heldKeys.has(k));
    const up = UP_KEYS.some((k) => heldKeys.has(k));
    const down = DOWN_KEYS.some((k) => heldKeys.has(k));
    setChefDir((right ? 1 : 0) - (left ? 1 : 0), (down ? 1 : 0) - (up ? 1 : 0));
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
    if (e.key === 'x' || e.key === 'X') {
        sprayPepper();
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
lives = START_LIVES;
pepper = START_PEPPER;
levelNumber = 1;
buildBurgers();   // burgers only — the idle screen has no enemies on it yet
updateHud();
requestAnimationFrame(frame);
