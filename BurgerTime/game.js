// ---------------------------------------------------------------------------
// Burger Time — a single-screen platform arcade game on an HTML5 canvas.
//
// A chef runs across a lattice of floors and ladders, walking burger
// ingredients off their platforms so they drop onto the plates below. Four
// burgers have to be assembled while hot dogs, eggs and pickles hunt the chef;
// a finite supply of pepper stuns them, and an ingredient that starts falling
// squashes anything standing on it.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run, Snake and Tetris in this repo. All motion is expressed per-second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing. Nothing in the simulation calls Math.random.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 500;

// Platform lines (an actor's y is the floor line it stands on).
const FLOOR_YS = [80, 150, 220, 290, 360, 430];
// Ladder centre lines; every ladder connects every adjacent pair of floors.
const LADDER_XS = [20, 160, 300, 440, 580];
// Plate line — where the finished burgers pile up.
const PLATE_Y = 470;

// --- Burgers ---
const COLUMN_XS = [40, 180, 320, 460];   // left edge of each burger column
const ING_W = 100;
const ING_H = 10;
const SEGMENTS = 4;
const SEG_W = ING_W / SEGMENTS;
const ING_PER_COLUMN = 4;
const ING_ROWS = [0, 1, 2, 3];           // floor each piece starts on
const ING_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];

// --- Actors ---
const CHEF_W = 18;
const CHEF_H = 22;
const CHEF_SPEED = 110;                  // px/s
const CHEF_START_X = 300;
const ENEMY_W = 18;
const ENEMY_TYPES = ['hotdog', 'egg', 'pickle'];
const HIT_X = 14;                        // chef/enemy contact box
const HIT_Y = 14;
const SNAP = 3;                          // alignment tolerance for floors/ladders

// --- Rules ---
const FALL_SPEED = 180;                  // px/s for a dropping ingredient
const START_LIVES = 3;
const START_PEPPER = 5;
const PEPPER_RANGE = 50;
const PEPPER_CLOUD_TIME = 0.4;
const STUN_TIME = 4;
const SPAWN_INTERVAL = 4;                // seconds between enemy spawns
const SPAWN_POINTS = [
    { x: LADDER_XS[0], y: FLOOR_YS[0] },
    { x: LADDER_XS[4], y: FLOOR_YS[0] },
    { x: LADDER_XS[0], y: FLOOR_YS[2] },
    { x: LADDER_XS[4], y: FLOOR_YS[2] },
];

// --- Scoring ---
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;
const LEVEL_BONUS = 500;

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
let state, score, best, level, lives, pepper, spawnTimer, spawnIndex, enemySeq;
const chef = { x: CHEF_START_X, y: FLOOR_YS[FLOOR_YS.length - 1], dx: 0, dy: 0, face: 1, walk: 0 };
const ingredients = [];
const enemies = [];
const clouds = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function nearest(values, v) {
    let best = values[0];
    for (const candidate of values) {
        if (Math.abs(candidate - v) < Math.abs(best - v)) best = candidate;
    }
    return best;
}

function nearestFloorY(y) { return nearest(FLOOR_YS, y); }
function nearestLadderX(x) { return nearest(LADDER_XS, x); }

const TOP_FLOOR_Y = FLOOR_YS[0];
const BOTTOM_FLOOR_Y = FLOOR_YS[FLOOR_YS.length - 1];

// Shared movement rules: horizontal only while standing on a floor, vertical
// only while aligned with a ladder. Vertical intent wins when both are legal.
function moveActor(a, speed, dt) {
    const fy = nearestFloorY(a.y);
    const lx = nearestLadderX(a.x);
    const onFloor = Math.abs(a.y - fy) <= SNAP;
    const onLadder = Math.abs(a.x - lx) <= SNAP;

    if (a.dy !== 0 && onLadder) {
        a.x = lx;
        a.y = clamp(a.y + a.dy * speed * dt, TOP_FLOOR_Y, BOTTOM_FLOOR_Y);
    } else if (a.dx !== 0 && onFloor) {
        a.y = fy;
        a.x = clamp(a.x + a.dx * speed * dt, CHEF_W / 2, CANVAS_W - CHEF_W / 2);
    }
}

// ---------------------------------------------------------------------------
// Difficulty (pure functions of the level number)
// ---------------------------------------------------------------------------

function enemySpeedFor(lvl) { return 70 + (lvl - 1) * 10; }
function maxEnemiesFor(lvl) { return Math.min(5, 1 + lvl); }

// ---------------------------------------------------------------------------
// Level building
// ---------------------------------------------------------------------------

function buildLevel() {
    ingredients.length = 0;
    for (let col = 0; col < COLUMN_XS.length; col++) {
        for (let i = 0; i < ING_PER_COLUMN; i++) {
            const row = ING_ROWS[i];
            ingredients.push({
                col,
                row,
                type: ING_TYPES[i],
                x: COLUMN_XS[col],
                y: FLOOR_YS[row],
                segments: new Array(SEGMENTS).fill(false),
                state: 'idle',   // 'idle' | 'falling' | 'landed'
                riders: 0,
            });
        }
    }
}

function resetActors() {
    chef.x = CHEF_START_X;
    chef.y = BOTTOM_FLOOR_Y;
    chef.dx = 0;
    chef.dy = 0;
    chef.face = 1;
    enemies.length = 0;
    clouds.length = 0;
    spawnIndex = 0;
    spawnTimer = SPAWN_INTERVAL;
    const initial = Math.min(2, maxEnemiesFor(level));
    for (let i = 0; i < initial; i++) spawnNextEnemy();
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function spawnEnemyAt(x, y) {
    const enemy = {
        x,
        y,
        dx: 0,
        dy: 0,
        stun: 0,
        type: ENEMY_TYPES[enemySeq % ENEMY_TYPES.length],
        walk: 0,
    };
    enemySeq++;
    enemies.push(enemy);
    return enemy;
}

// Spawn points are walked in a fixed rotation, so runs are reproducible.
function spawnNextEnemy() {
    const point = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex++;
    return spawnEnemyAt(point.x, point.y);
}

// Greedy chase, re-evaluated only while standing on a floor: head for a ladder
// when the chef is on another floor, otherwise walk straight at him.
function enemyDecide(e) {
    const fy = nearestFloorY(e.y);
    if (Math.abs(e.y - fy) > SNAP) return;  // mid-climb: keep going
    e.y = fy;

    const wantUp = chef.y < e.y - SNAP;
    const wantDown = chef.y > e.y + SNAP;
    if (wantUp || wantDown) {
        const lx = nearestLadderX(e.x);
        if (Math.abs(e.x - lx) <= SNAP) {
            e.x = lx;
            e.dx = 0;
            e.dy = wantUp ? -1 : 1;
            return;
        }
        e.dy = 0;
        e.dx = e.x < lx ? 1 : -1;
        return;
    }

    e.dy = 0;
    e.dx = chef.x > e.x ? 1 : -1;
}

function updateEnemies(dt) {
    const speed = enemySpeedFor(level);
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        enemyDecide(e);
        moveActor(e, speed, dt);
        e.walk += speed * dt;
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnTimer = SPAWN_INTERVAL;
        if (enemies.length < maxEnemiesFor(level)) spawnNextEnemy();
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function columnLanded(col) {
    return ingredients.filter((i) => i.col === col && i.state === 'landed').length;
}

function levelComplete() {
    return ingredients.every((i) => i.state === 'landed');
}

function dropIngredient(ing) {
    if (!ing || ing.state !== 'idle') return false;
    ing.segments.fill(true);
    ing.state = 'falling';
    return true;
}

// The chef presses down any segment he is standing on.
function pressSegments() {
    for (const ing of ingredients) {
        if (ing.state !== 'idle') continue;
        if (Math.abs(chef.y - ing.y) > SNAP) continue;
        const index = Math.floor((chef.x - ing.x) / SEG_W);
        if (index < 0 || index >= SEGMENTS || ing.segments[index]) continue;
        ing.segments[index] = true;
        if (ing.segments.every(Boolean)) ing.state = 'falling';
    }
}

function squashEnemiesUnder(ing) {
    const cx = ing.x + ING_W / 2;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (Math.abs(e.x - cx) > ING_W / 2) continue;
        if (Math.abs(e.y - ing.y) > 12) continue;
        enemies.splice(i, 1);
        ing.riders++;
        score += SQUASH_POINTS;
    }
}

function updateIngredients(dt) {
    // Lowest pieces first, so a chain drop lands in bottom-up order.
    const falling = ingredients
        .filter((i) => i.state === 'falling')
        .sort((a, b) => b.y - a.y);

    for (const ing of falling) {
        const prevY = ing.y;
        ing.y += FALL_SPEED * dt;

        // Knock loose any resting piece this one falls through (chain drop).
        for (const other of ingredients) {
            if (other === ing || other.col !== ing.col || other.state !== 'idle') continue;
            if (prevY < other.y - 0.5 && ing.y >= other.y - 0.5) dropIngredient(other);
        }

        squashEnemiesUnder(ing);

        const target = PLATE_Y - columnLanded(ing.col) * ING_H;
        if (ing.y >= target) {
            ing.y = target;
            ing.state = 'landed';
            score += DROP_POINTS;
        }
    }

    if (falling.length && levelComplete()) nextLevel();
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function sprayPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper--;
    clouds.push({ x: chef.x + chef.face * (PEPPER_RANGE / 2), y: chef.y - CHEF_H / 2, life: PEPPER_CLOUD_TIME });
    for (const e of enemies) {
        const ahead = (e.x - chef.x) * chef.face;
        if (ahead > 0 && ahead <= PEPPER_RANGE && Math.abs(e.y - chef.y) <= HIT_Y) {
            e.stun = STUN_TIME;
        }
    }
    updateHud();
    return true;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefDir(dx, dy) {
    chef.dx = dx;
    chef.dy = dy;
    if (dx !== 0) chef.face = dx;
}

// Test/debug helper: empty the board and hold off the next spawn, so a long
// simulation can be run without enemy interference.
function clearEnemies() {
    enemies.length = 0;
    spawnTimer = Number.MAX_SAFE_INTEGER;
}

// Test/debug helper: drop the chef straight onto a spot.
function placeChef(x, y) {
    chef.x = x;
    chef.y = y;
    chef.dx = 0;
    chef.dy = 0;
}

function updateChef(dt) {
    const before = chef.x;
    moveActor(chef, CHEF_SPEED, dt);
    chef.walk += Math.abs(chef.x - before) + (chef.dy !== 0 ? CHEF_SPEED * dt : 0);
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < HIT_X && Math.abs(e.y - chef.y) < HIT_Y) {
            loseLife();
            return true;
        }
    }
    return false;
}

function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    resetActors();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    enemySeq = 0;
    buildLevel();
    resetActors();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level++;
    score += LEVEL_BONUS;
    pepper++;
    buildLevel();
    resetActors();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* private mode */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Score ${score} — Level ${level}`, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function showOverlay(title, scoreText, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;
    updateChef(dt);
    pressSegments();
    updateIngredients(dt);
    updateEnemies(dt);
    for (let i = clouds.length - 1; i >= 0; i--) {
        clouds[i].life -= dt;
        if (clouds[i].life <= 0) clouds.splice(i, 1);
    }
    if (state === 'running') checkChefHit();
    updateHud();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ING_COLORS = {
    'bun-top': '#e8a24a',
    'lettuce': '#63c04c',
    'patty': '#7a4327',
    'bun-bottom': '#d1893a',
};

const ENEMY_COLORS = {
    hotdog: '#e2574c',
    egg: '#f4f0e2',
    pickle: '#8fbf3f',
};

function drawLattice() {
    // ladders
    ctx.strokeStyle = '#5b6f8c';
    ctx.lineWidth = 2;
    for (const lx of LADDER_XS) {
        ctx.beginPath();
        ctx.moveTo(lx - 8, TOP_FLOOR_Y);
        ctx.lineTo(lx - 8, BOTTOM_FLOOR_Y);
        ctx.moveTo(lx + 8, TOP_FLOOR_Y);
        ctx.lineTo(lx + 8, BOTTOM_FLOOR_Y);
        ctx.stroke();
        for (let y = TOP_FLOOR_Y; y <= BOTTOM_FLOOR_Y; y += 10) {
            ctx.beginPath();
            ctx.moveTo(lx - 8, y);
            ctx.lineTo(lx + 8, y);
            ctx.stroke();
        }
    }

    // floors
    for (const fy of FLOOR_YS) {
        ctx.fillStyle = '#3f6ea5';
        ctx.fillRect(0, fy, CANVAS_W, 4);
        ctx.fillStyle = '#79a9dd';
        ctx.fillRect(0, fy, CANVAS_W, 2);
    }

    // plates
    for (const cx of COLUMN_XS) {
        ctx.fillStyle = '#cfd6dd';
        ctx.beginPath();
        ctx.ellipse(cx + ING_W / 2, PLATE_Y + 6, ING_W / 2 + 4, 7, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const color = ING_COLORS[ing.type];
    for (let i = 0; i < SEGMENTS; i++) {
        const x = ing.x + i * SEG_W;
        const dip = ing.state === 'idle' && ing.segments[i] ? 4 : 0;
        const y = ing.y - ING_H + dip;
        const w = SEG_W - 1;

        ctx.fillStyle = color;
        if (ing.type === 'bun-top') {
            // domed top bun
            ctx.beginPath();
            ctx.moveTo(x, y + ING_H);
            ctx.lineTo(x, y + 4);
            ctx.quadraticCurveTo(x + w / 2, y - 3, x + w, y + 4);
            ctx.lineTo(x + w, y + ING_H);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fff3d0';
            ctx.fillRect(x + 5, y + 3, 3, 2);
            ctx.fillRect(x + 14, y + 5, 3, 2);
        } else {
            ctx.fillRect(x, y, w, ING_H);
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillRect(x, y, w, 3);
            if (ing.type === 'lettuce') {
                ctx.fillStyle = '#4c9a38';
                for (let f = 0; f < 3; f++) {
                    ctx.beginPath();
                    ctx.arc(x + 4 + f * 8, y + ING_H, 4, 0, Math.PI);
                    ctx.fill();
                }
            }
            if (ing.type === 'patty') {
                ctx.fillStyle = '#5d3120';
                ctx.fillRect(x + 3, y + 4, 5, 2);
                ctx.fillRect(x + 13, y + 6, 5, 2);
            }
        }
    }
}

// A row of small burgers along the top strip showing how much of each burger
// has made it onto its plate.
function drawProgress() {
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    for (let col = 0; col < COLUMN_XS.length; col++) {
        const cx = COLUMN_XS[col] + ING_W / 2;
        const done = columnLanded(col);
        for (let i = 0; i < ING_PER_COLUMN; i++) {
            const y = 46 - i * 6;
            ctx.fillStyle = i < done ? ING_COLORS[ING_TYPES[ING_PER_COLUMN - 1 - i]] : '#2b2320';
            ctx.fillRect(cx - 14, y, 28, 5);
        }
        ctx.fillStyle = done === ING_PER_COLUMN ? '#ffd479' : '#6b5a50';
        ctx.fillText(done === ING_PER_COLUMN ? 'DONE' : `${done}/${ING_PER_COLUMN}`, cx, 66);
    }
    ctx.textAlign = 'left';
}

function drawChef() {
    const x = chex(chef.x);
    const y = chef.y;
    // legs
    const stride = Math.sin(chef.walk / 9) * 4;
    ctx.strokeStyle = '#2f3d59';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x - 4 + stride, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 4 - stride, y);
    ctx.stroke();
    // body
    ctx.fillStyle = '#f6f1e4';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H, CHEF_W, CHEF_H - 8);
    // apron shading
    ctx.fillStyle = '#d9d2c2';
    ctx.fillRect(x - CHEF_W / 2, y - 12, CHEF_W, 4);
    // head + hat
    ctx.fillStyle = '#f0c092';
    ctx.fillRect(x - 5, y - CHEF_H - 8, 10, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - CHEF_H - 15, 16, 7);
    // eye, facing the direction of travel
    ctx.fillStyle = '#2b2119';
    ctx.fillRect(x + (chef.face > 0 ? 1 : -3), y - CHEF_H - 5, 2, 2);
}

// Keep the chef's sprite fully inside the canvas at the extreme edges.
function chex(x) { return clamp(x, CHEF_W / 2, CANVAS_W - CHEF_W / 2); }

function drawEnemy(e) {
    const x = e.x;
    const y = e.y;
    const color = ENEMY_COLORS[e.type];
    const bob = e.stun > 0 ? 0 : Math.sin(e.walk / 8) * 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - ENEMY_W / 2, y - 20 + bob, ENEMY_W, 18, 7);
    ctx.fill();
    ctx.fillStyle = '#1c1614';
    ctx.fillRect(x - 5, y - 15 + bob, 3, 3);
    ctx.fillRect(x + 2, y - 15 + bob, 3, 3);
    if (e.stun > 0) {
        ctx.fillStyle = '#ffe066';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('*', x, y - 24);
        ctx.textAlign = 'left';
    }
}

function drawClouds() {
    for (const c of clouds) {
        const alpha = clamp(c.life / PEPPER_CLOUD_TIME, 0, 1);
        for (let i = 0; i < 6; i++) {
            const ox = (i - 2.5) * 8;
            ctx.fillStyle = `rgba(255, 236, 190, ${0.75 * alpha})`;
            ctx.beginPath();
            ctx.arc(c.x + ox, c.y + Math.sin(i * 1.7) * 7, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(120, 90, 60, ${0.5 * alpha})`;
            ctx.beginPath();
            ctx.arc(c.x + ox + 2, c.y + Math.cos(i * 2.1) * 6, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#0d0a09';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawProgress();
    drawLattice();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawChef();
    drawClouds();
}

let lastTime = 0;
function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const DIR_KEYS = {
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
};

// Ordered so the most recently pressed key wins and releasing it falls back to
// whatever is still held.
const heldKeys = [];

function refreshDir() {
    for (let i = heldKeys.length - 1; i >= 0; i--) {
        const dir = DIR_KEYS[heldKeys[i]];
        if (dir) {
            setChefDir(dir[0], dir[1]);
            return;
        }
    }
    setChefDir(0, 0);
}

window.addEventListener('keydown', (e) => {
    if (DIR_KEYS[e.key]) {
        if (!heldKeys.includes(e.key)) heldKeys.push(e.key);
        refreshDir();
        e.preventDefault();
        return;
    }
    if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        if (state === 'running') sprayPepper();
        else if (state !== 'paused') startGame();
        return;
    }
    if (e.key === 'p' || e.key === 'P') {
        togglePause();
    }
});

window.addEventListener('keyup', (e) => {
    const index = heldKeys.indexOf(e.key);
    if (index >= 0) {
        heldKeys.splice(index, 1);
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

best = 0;
try { best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0; } catch (err) { /* private mode */ }
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
spawnIndex = 0;
spawnTimer = SPAWN_INTERVAL;
enemySeq = 0;
buildLevel();
updateHud();
requestAnimationFrame(frame);
