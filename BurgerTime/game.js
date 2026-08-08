// ---------------------------------------------------------------------------
// BurgerTime — stomp every ingredient down its column and onto the plate while
// the kitchen creeps chase you.
//
// All motion is in pixels-per-millisecond, so update(dt) is a frame-rate
// independent stepper that tests can drive directly instead of waiting on
// requestAnimationFrame. Geometry lives in the pure helpers columnAt(),
// segIndexAt() and nearestLadder().
// ---------------------------------------------------------------------------

const WIDTH = 560;
const HEIGHT = 560;

// Floor walking surfaces, top (0) to bottom (4). The plate sits below them all,
// exactly one floor-height down so the last drop reads like every other one.
const FLOOR_Y = [76, 162, 248, 334, 420];
const PLATE_Y = 506;
const BOTTOM = FLOOR_Y.length - 1;

// Ladders span every floor and sit in the gaps between the burger columns.
const LADDER_X = [16, 144, 272, 400, 528];
const LADDER_SNAP = 8;
const LADDER_W = 24;

// Burger columns.
const COL_X = [80, 208, 336, 464];
const BURGER_W = 96;
const SEG_W = BURGER_W / 4;         // 24 — one stompable quarter
const ING_H = 11;
const SEG_PRESS = 5;                // how far a pressed quarter sags

const CHEF_HALF = 11;
const CHEF_H = 28;
const CHEF_SPEED = 0.145;           // px/ms
const CLIMB_SPEED = 0.115;          // px/ms
const FALL_SPEED = 0.34;            // px/ms

const MAX_ENEMIES = 5;
const RESPAWN_MS = 3200;
const ENEMY_H = 24;
const HIT_X = 16;
const HIT_Y = 22;

const PEPPER_START = 5;
const PEPPER_REACH = 34;            // how far ahead the cloud lands
const PEPPER_RADIUS = 30;
const PEPPER_LIFE = 550;
const PEPPER_STUN = 3000;

const SCORE_DROP = 50;
const SCORE_SQUASH = 500;
const LEVEL_BONUS = 1000;

const KINDS = ['bunTop', 'patty', 'bunBottom'];
const ENEMY_KINDS = ['dog', 'egg', 'pickle'];
const BEST_KEY = 'burgertime.best';

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const pepperEl = document.getElementById('pepper');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state;                          // 'idle' | 'running' | 'paused' | 'over'
let score, best, lives, level, pepper;
let chef, enemies, ingredients, peppers;
let lastTime, animId;
const keys = { left: false, right: false, up: false, down: false };

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- Difficulty ---
function enemySpeed(lvl) { return Math.min(0.112, 0.058 + (lvl - 1) * 0.013); }
function enemyCount(lvl) { return Math.min(MAX_ENEMIES, 2 + lvl); }

// --- Pure geometry helpers ---

// Which burger column contains x, or -1 if x is in a gap between columns.
function columnAt(x) {
    for (let c = 0; c < COL_X.length; c++) {
        if (Math.abs(x - COL_X[c]) <= BURGER_W / 2) return c;
    }
    return -1;
}

// Which quarter (0-3) of column `col` contains x, or -1 if x is outside it.
function segIndexAt(col, x) {
    const i = Math.floor((x - (COL_X[col] - BURGER_W / 2)) / SEG_W);
    return i >= 0 && i < 4 ? i : -1;
}

// The ladder centre nearest to x.
function nearestLadder(x) {
    let best = LADDER_X[0];
    for (const lx of LADDER_X) {
        if (Math.abs(lx - x) < Math.abs(best - x)) best = lx;
    }
    return best;
}

function onLadder(x) { return Math.abs(x - nearestLadder(x)) <= LADDER_SNAP; }

// --- Level construction ---
function buildLevel() {
    ingredients = [];
    for (let c = 0; c < COL_X.length; c++) {
        KINDS.forEach((kind, k) => {
            ingredients.push({
                col: c,
                kind,
                floor: k,                  // top bun highest, bottom bun lowest
                y: FLOOR_Y[k],
                segs: [false, false, false, false],
                falling: false,
                plated: false,
                stack: 0,
                targetFloor: k,
            });
        });
    }
}

function makeEnemy(x, floor, kind) {
    return {
        kind,
        x,
        floor,
        y: FLOOR_Y[floor],
        climbing: false,
        targetFloor: floor,
        alive: true,
        stun: 0,
        respawn: 0,
        dir: -1,
    };
}

function spawnEnemies() {
    enemies = [];
    const n = enemyCount(level);
    for (let i = 0; i < n; i++) {
        enemies.push(makeEnemy(spawnX(i), 0, ENEMY_KINDS[i % ENEMY_KINDS.length]));
    }
}

function spawnX(i) { return LADDER_X[(i * 2 + 1) % LADDER_X.length]; }

function resetPositions() {
    chef = {
        x: WIDTH / 2,
        floor: BOTTOM,
        y: FLOOR_Y[BOTTOM],
        climbing: false,
        targetFloor: BOTTOM,
        dir: 1,
    };
    peppers = [];
    enemies.forEach((e, i) => {
        e.x = spawnX(i);
        e.floor = 0;
        e.y = FLOOR_Y[0];
        e.climbing = false;
        e.targetFloor = 0;
        e.alive = true;
        e.stun = 0;
        e.respawn = 0;
    });
}

// --- HUD & overlay ---
function updateHud() {
    scoreEl.textContent = score;
    levelEl.textContent = level;
    pepperEl.textContent = pepper;
    livesEl.textContent = Math.max(0, lives);
    bestEl.textContent = best;
}

function showOverlay(title, sub, scoreLine) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreLine || '';
    overlay.classList.add('visible');
}

function hideOverlay() { overlay.classList.remove('visible'); }

// --- Lifecycle ---
function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    pepper = PEPPER_START;
    buildLevel();
    spawnEnemies();
    resetPositions();
    state = 'running';
    hideOverlay();
    updateHud();
    lastTime = null;
}

function nextLevel() {
    score += LEVEL_BONUS;
    level += 1;
    pepper = PEPPER_START;
    buildLevel();
    spawnEnemies();
    resetPositions();
    updateHud();
}

function loseLife() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        gameOver();
    } else {
        resetPositions();
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* private mode */ }
    }
    updateHud();
    showOverlay('Kitchen Closed', 'Press Space to cook again', `Score ${score} · Best ${best}`);
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', 'Press P to get back to work');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        lastTime = null;
    }
}

// --- Ingredients ---
function restingAt(col, floor, except) {
    return ingredients.filter(i =>
        i !== except && i.col === col && i.floor === floor && !i.falling && !i.plated);
}

function plateCount(col) {
    return ingredients.filter(i => i.col === col && i.plated).length;
}

function dropIngredient(ing) {
    if (ing.falling || ing.plated) return;
    ing.falling = true;
    ing.targetFloor = ing.floor + 1;
    ing.segs = [false, false, false, false];
}

function landingY(ing) {
    if (ing.targetFloor > BOTTOM) return PLATE_Y - plateCount(ing.col) * ING_H;
    return FLOOR_Y[ing.targetFloor];
}

function landIngredient(ing) {
    ing.falling = false;
    score += SCORE_DROP;
    if (ing.targetFloor > BOTTOM) {
        ing.stack = plateCount(ing.col);
        ing.plated = true;
        ing.floor = BOTTOM + 1;
        ing.y = PLATE_Y - ing.stack * ING_H;
    } else {
        const pushed = restingAt(ing.col, ing.targetFloor, ing);
        ing.floor = ing.targetFloor;
        ing.y = FLOOR_Y[ing.floor];
        pushed.forEach(dropIngredient);
    }
    updateHud();
}

function allPlated() { return ingredients.every(i => i.plated); }

// The chef presses the quarter he is standing on.
function pressUnderChef() {
    if (chef.climbing) return;
    const col = columnAt(chef.x);
    if (col < 0) return;
    const ing = ingredients.find(i =>
        i.col === col && i.floor === chef.floor && !i.falling && !i.plated);
    if (!ing) return;
    const seg = segIndexAt(col, chef.x);
    if (seg < 0 || ing.segs[seg]) return;
    ing.segs[seg] = true;
    if (ing.segs.every(Boolean)) dropIngredient(ing);
}

function stepIngredients(dt) {
    for (const ing of ingredients) {
        if (!ing.falling) continue;
        ing.y += FALL_SPEED * dt;

        for (const e of enemies) {
            if (!e.alive) continue;
            const overlapX = Math.abs(e.x - COL_X[ing.col]) < BURGER_W / 2 + 6;
            const overlapY = Math.abs(e.y - ing.y) < ENEMY_H;
            if (overlapX && overlapY) {
                squash(e);
                ing.targetFloor = Math.min(ing.targetFloor + 1, BOTTOM + 1);
            }
        }

        const target = landingY(ing);
        if (ing.y >= target) {
            ing.y = target;
            landIngredient(ing);
        }
    }
}

// --- Pepper ---
function throwPepper() {
    if (pepper <= 0) return;
    pepper -= 1;
    peppers.push({
        x: clamp(chef.x + chef.dir * PEPPER_REACH, 8, WIDTH - 8),
        y: chef.y,
        life: PEPPER_LIFE,
    });
    updateHud();
}

function stepPeppers(dt) {
    for (const p of peppers) {
        p.life -= dt;
        for (const e of enemies) {
            if (!e.alive) continue;
            if (Math.abs(e.x - p.x) < PEPPER_RADIUS && Math.abs(e.y - p.y) < HIT_Y) {
                e.stun = PEPPER_STUN;
            }
        }
    }
    peppers = peppers.filter(p => p.life > 0);
}

// --- Enemies ---
function squash(e) {
    if (!e.alive) return;
    e.alive = false;
    e.stun = 0;
    e.climbing = false;
    e.respawn = RESPAWN_MS;
    score += SCORE_SQUASH;
    updateHud();
}

function stepEnemy(e, dt) {
    if (!e.alive) {
        e.respawn -= dt;
        if (e.respawn <= 0) {
            e.alive = true;
            e.floor = 0;
            e.y = FLOOR_Y[0];
            e.x = nearestLadder(WIDTH - e.x);
            e.climbing = false;
        }
        return;
    }
    if (e.stun > 0) { e.stun -= dt; return; }

    const speed = enemySpeed(level);
    if (e.climbing) {
        const target = FLOOR_Y[e.targetFloor];
        const step = Math.sign(target - e.y) * speed * dt;
        e.y = Math.abs(target - e.y) <= Math.abs(step) ? target : e.y + step;
        if (e.y === target) {
            e.floor = e.targetFloor;
            e.climbing = false;
        }
        return;
    }

    if (e.floor !== chef.floor) {
        const lx = nearestLadder(e.x);
        if (Math.abs(e.x - lx) <= speed * dt) {
            e.x = lx;
            e.targetFloor = clamp(e.floor + (chef.floor > e.floor ? 1 : -1), 0, BOTTOM);
            e.climbing = e.targetFloor !== e.floor;
        } else {
            e.dir = Math.sign(lx - e.x);
            e.x += e.dir * speed * dt;
        }
    } else if (Math.abs(chef.x - e.x) > 0.5) {
        e.dir = Math.sign(chef.x - e.x);
        e.x = clamp(e.x + e.dir * speed * dt, CHEF_HALF, WIDTH - CHEF_HALF);
    }
}

function hitsChef(e) {
    return e.alive
        && Math.abs(e.x - chef.x) < HIT_X
        && Math.abs(e.y - chef.y) < HIT_Y;
}

// --- Chef ---
function stepChef(dt) {
    if (chef.climbing) {
        const from = FLOOR_Y[chef.floor];
        const to = FLOOR_Y[chef.targetFloor];
        const dir = (keys.up ? -1 : 0) + (keys.down ? 1 : 0);
        // Releasing the keys leaves the chef parked mid-ladder; only actual
        // movement can finish the climb or back it out to the floor below.
        if (dir !== 0) {
            chef.y = clamp(chef.y + dir * CLIMB_SPEED * dt,
                Math.min(from, to), Math.max(from, to));
            if (chef.y === to) {
                chef.floor = chef.targetFloor;
                chef.climbing = false;
            } else if (chef.y === from) {
                chef.climbing = false;
                chef.targetFloor = chef.floor;
            }
        }
        return;
    }

    if (keys.left !== keys.right) {
        chef.dir = keys.right ? 1 : -1;
        chef.x = clamp(chef.x + chef.dir * CHEF_SPEED * dt, CHEF_HALF, WIDTH - CHEF_HALF);
    }

    const climbDir = (keys.up ? -1 : 0) + (keys.down ? 1 : 0);
    if (climbDir !== 0 && onLadder(chef.x)) {
        const target = chef.floor + climbDir;
        if (target >= 0 && target <= BOTTOM) {
            chef.x = nearestLadder(chef.x);
            chef.targetFloor = target;
            chef.climbing = true;
            return;
        }
    }

    chef.y = FLOOR_Y[chef.floor];
    pressUnderChef();
}

// --- The stepper ---
function update(dt) {
    if (state !== 'running') return;

    stepChef(dt);
    stepIngredients(dt);
    stepPeppers(dt);

    for (const e of enemies) stepEnemy(e, dt);
    for (const e of enemies) {
        if (hitsChef(e)) { loseLife(); break; }
    }

    if (state === 'running' && allPlated()) nextLevel();
}

// --- Rendering ---
function drawKitchen() {
    ctx.fillStyle = '#140f10';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // back wall tiles
    ctx.strokeStyle = 'rgba(255, 255, 255, .035)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= HEIGHT; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
    }

    // ladders
    for (const lx of LADDER_X) {
        ctx.strokeStyle = '#6f7f96';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(lx - LADDER_W / 2, FLOOR_Y[0]);
        ctx.lineTo(lx - LADDER_W / 2, FLOOR_Y[BOTTOM]);
        ctx.moveTo(lx + LADDER_W / 2, FLOOR_Y[0]);
        ctx.lineTo(lx + LADDER_W / 2, FLOOR_Y[BOTTOM]);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#53637a';
        for (let y = FLOOR_Y[0]; y <= FLOOR_Y[BOTTOM]; y += 12) {
            ctx.beginPath();
            ctx.moveTo(lx - LADDER_W / 2, y);
            ctx.lineTo(lx + LADDER_W / 2, y);
            ctx.stroke();
        }
    }

    // floors
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#c9d3e0';
        ctx.fillRect(0, y, WIDTH, 4);
        ctx.fillStyle = 'rgba(0, 0, 0, .35)';
        ctx.fillRect(0, y + 4, WIDTH, 3);
    }

    // serving counter under the plates
    ctx.fillStyle = '#2a1d1a';
    ctx.fillRect(0, PLATE_Y + 12, WIDTH, HEIGHT - PLATE_Y - 12);
    ctx.fillStyle = '#3d2a24';
    ctx.fillRect(0, PLATE_Y + 12, WIDTH, 5);

    // plates
    for (const cx of COL_X) {
        ctx.fillStyle = 'rgba(0, 0, 0, .35)';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 12, BURGER_W / 2 + 10, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8edf3';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 7, BURGER_W / 2 + 8, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#b9c4d1';
        ctx.beginPath();
        ctx.ellipse(cx, PLATE_Y + 3, BURGER_W / 2 + 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // extractor hood across the empty band above the top floor
    ctx.fillStyle = '#2b2226';
    ctx.fillRect(0, 0, WIDTH, 30);
    ctx.fillStyle = '#3a2f34';
    ctx.fillRect(0, 30, WIDTH, 6);
    ctx.fillStyle = 'rgba(255, 207, 107, .18)';
    for (let x = 24; x < WIDTH; x += 96) ctx.fillRect(x, 12, 48, 10);
}

const ING_COLORS = {
    bunTop: ['#e0a45c', '#c07f38'],
    patty: ['#8b4a29', '#5f3018'],
    bunBottom: ['#d29552', '#a86e30'],
};

function drawIngredient(ing) {
    const left = COL_X[ing.col] - BURGER_W / 2;
    const [top, side] = ING_COLORS[ing.kind];
    for (let s = 0; s < 4; s++) {
        const sag = ing.segs[s] ? SEG_PRESS : 0;
        const x = left + s * SEG_W;
        const y = ing.y - ING_H + sag;

        ctx.fillStyle = side;                                  // crust / underside
        ctx.fillRect(x, y + ING_H - 4, SEG_W, 4);
        ctx.fillStyle = top;
        ctx.fillRect(x, y, SEG_W, ING_H - 3);

        if (ing.kind === 'bunTop') {                           // sesame dome
            ctx.fillStyle = 'rgba(255, 232, 190, .55)';
            ctx.fillRect(x, y, SEG_W, 3);
            ctx.fillStyle = '#fff6e1';
            ctx.fillRect(x + 6, y + 3, 4, 2);
            ctx.fillRect(x + 15, y + 5, 4, 2);
        } else if (ing.kind === 'patty') {                     // griddle ridges
            ctx.fillStyle = 'rgba(0, 0, 0, .3)';
            ctx.fillRect(x + 3, y + 3, SEG_W - 6, 2);
            ctx.fillStyle = '#4bb04b';                         // lettuce frill
            ctx.fillRect(x, y + ING_H - 6, SEG_W, 3);
            ctx.fillStyle = '#63cc63';
            ctx.fillRect(x + 4, y + ING_H - 7, 6, 2);
        } else {                                               // bottom bun
            ctx.fillStyle = 'rgba(255, 255, 255, .12)';
            ctx.fillRect(x, y, SEG_W, 2);
        }

        ctx.fillStyle = 'rgba(0, 0, 0, .2)';                   // segment seam
        ctx.fillRect(x + SEG_W - 1, y, 1, ING_H);
    }

    if (ing.falling) {                                         // motion streaks
        ctx.fillStyle = 'rgba(255, 255, 255, .13)';
        ctx.fillRect(left + 6, ing.y - ING_H - 10, 3, 8);
        ctx.fillRect(left + BURGER_W - 12, ing.y - ING_H - 14, 3, 11);
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    ctx.fillStyle = '#2c4c8c';                       // trousers
    ctx.fillRect(x - CHEF_HALF, y - 12, CHEF_HALF * 2, 12);
    ctx.fillStyle = '#f4f0e6';                       // jacket
    ctx.fillRect(x - CHEF_HALF, y - CHEF_H + 6, CHEF_HALF * 2, CHEF_H - 18);
    ctx.fillStyle = '#e8b98d';                       // face
    ctx.fillRect(x - 7, y - CHEF_H + 1, 14, 7);
    ctx.fillStyle = '#ffffff';                       // hat
    ctx.fillRect(x - 9, y - CHEF_H - 6, 18, 7);
    ctx.fillStyle = '#1a1a1a';                       // eye
    ctx.fillRect(x + (chef.dir > 0 ? 2 : -5), y - CHEF_H + 3, 3, 3);
}

const ENEMY_COLORS = { dog: '#d24b3a', egg: '#f2d98a', pickle: '#5aa445' };

function drawEnemy(e) {
    if (!e.alive) return;
    ctx.fillStyle = e.stun > 0 ? '#9aa7b5' : ENEMY_COLORS[e.kind];
    ctx.fillRect(e.x - 11, e.y - ENEMY_H, 22, ENEMY_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(e.x - 7, e.y - ENEMY_H + 5, 5, 5);
    ctx.fillRect(e.x + 2, e.y - ENEMY_H + 5, 5, 5);
    ctx.fillStyle = '#1a1a1a';
    const look = e.dir > 0 ? 2 : 0;
    ctx.fillRect(e.x - 6 + look, e.y - ENEMY_H + 6, 2, 3);
    ctx.fillRect(e.x + 3 + look, e.y - ENEMY_H + 6, 2, 3);
    if (e.stun > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, .8)';
        ctx.fillRect(e.x - 3, e.y - ENEMY_H - 7, 6, 4);
    }
}

function drawPeppers() {
    for (const p of peppers) {
        const alpha = clamp(p.life / PEPPER_LIFE, 0, 1);
        ctx.fillStyle = `rgba(230, 230, 235, ${0.15 + alpha * 0.35})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y - 12, PEPPER_RADIUS * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(60, 45, 40, ${alpha})`;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + p.life / 120;
            ctx.fillRect(p.x + Math.cos(a) * 14 - 1, p.y - 12 + Math.sin(a) * 10 - 1, 3, 3);
        }
    }
}

function draw() {
    drawKitchen();
    for (const ing of ingredients) drawIngredient(ing);
    drawPeppers();
    for (const e of enemies) drawEnemy(e);
    drawChef();
}

// --- Main loop ---
function loop(ts) {
    if (lastTime == null) lastTime = ts;
    const dt = Math.min(50, ts - lastTime);
    lastTime = ts;
    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// --- Input ---
const KEY_MAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
};

document.addEventListener('keydown', (ev) => {
    if (KEY_MAP[ev.key]) {
        keys[KEY_MAP[ev.key]] = true;
        ev.preventDefault();
        return;
    }
    if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        if (state === 'running') throwPepper();
        else if (state !== 'paused') startGame();
        return;
    }
    if (ev.key === 'p' || ev.key === 'P') {
        ev.preventDefault();
        togglePause();
    }
});

document.addEventListener('keyup', (ev) => {
    if (KEY_MAP[ev.key]) {
        keys[KEY_MAP[ev.key]] = false;
        ev.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// --- Boot ---
function init() {
    best = 0;
    try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { best = 0; }
    score = 0;
    lives = 3;
    level = 1;
    pepper = PEPPER_START;
    state = 'idle';
    buildLevel();
    spawnEnemies();
    resetPositions();
    updateHud();
    draw();
    animId = requestAnimationFrame(loop);
}

init();
