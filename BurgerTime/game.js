// ---------------------------------------------------------------------------
// BurgerTime — a platform-and-ladder arcade game on an HTML5 canvas.
//
// Chef Pepper runs along the girders of a burger tower. Walking the full width
// of an ingredient knocks it down one level; ingredients that land on other
// ingredients knock those loose too, so a well-timed run cascades a whole
// burger onto its plate. Hot dogs, eggs and pickles hunt the chef, and a
// limited supply of pepper stuns them.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run, Snake and Tetris in this repo. All motion is expressed per-second
// and advanced through `step(dt)`; setting `AUTO_STEP = false` detaches the
// requestAnimationFrame driver so tests can simulate frames deterministically.
// ---------------------------------------------------------------------------

// --- World geometry (tile grid) ---
const TILE = 28;
const COLS = 21;
const ROWS = 18;
const CANVAS_W = COLS * TILE;   // 588
const CANVAS_H = ROWS * TILE;   // 504

// Walkable girders, top to bottom, and the plate shelf underneath them.
const FLOOR_ROWS = [2, 5, 8, 11, 14];
const PLATE_ROW = 17;
const PLATE_Y = PLATE_ROW * TILE;

// Ladders live in the one-tile gaps between the burger columns.
const LADDER_COLS = [0, 5, 10, 15, 20];
const BURGER_COLS = [1, 6, 11, 16];
const PIECE_COLS = 4;                  // tiles spanned by one ingredient
const PIECE_H = 8;                     // drawn thickness of an ingredient

const INGREDIENTS = [
    { kind: 'bun-top', color: '#e2a049', shade: '#b97a2c' },
    { kind: 'lettuce', color: '#79c94a', shade: '#4d9127' },
    { kind: 'patty', color: '#8a4b28', shade: '#5d2f16' },
    { kind: 'bun-bottom', color: '#d59544', shade: '#a76a26' },
];

// --- Movement ---
const CHEF_SPEED = 85;                 // px/s
const ENEMY_SPEED = 46;                // px/s at level 1
const ENEMY_SPEED_STEP = 5;            // extra px/s per level
const ENEMY_SPEED_MAX = 78;
const FALL_SPEED = 150;                // px/s for a knocked-down ingredient
const SNAP = TILE * 0.8;               // how close you must be to grab a rail

// --- Rules ---
const START_LIVES = 3;
const START_PEPPERS = 5;
const PIECE_POINTS = 50;
const SQUASH_POINTS = 100;             // doubled for each extra enemy in one drop
const LEVEL_POINTS = 500;
const PEPPER_STUN = 3.5;               // seconds an enemy stays sneezing
const RESPAWN_TIME = 5;                // seconds before a squashed enemy returns
const DYING_TIME = 1.2;
const LEVEL_CLEAR_TIME = 2;
const MAX_ENEMIES = 5;

// Spawn nodes as [floorIndex, ladderIndex] pairs, used in order.
const SPAWNS = [[0, 0], [0, 4], [0, 2], [1, 0], [1, 4]];

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
// state: 'idle' | 'running' | 'paused' | 'dying' | 'levelclear' | 'over'
let state = 'idle';
let score = 0;
let best = 0;
let level = 1;
let lives = START_LIVES;
let peppers = START_PEPPERS;
let deathTimer = 0;
let clearTimer = 0;
let AUTO_STEP = true;

const chef = { x: 0, y: 0, dir: null, facing: 'right', walk: 0 };
let burgers = [];
let pieces = [];
let enemies = [];
let clouds = [];
let sparks = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function floorY(row) { return row * TILE; }
function ladderX(col) { return (col + 0.5) * TILE; }
function ladderTopY() { return floorY(FLOOR_ROWS[0]); }
function ladderBottomY() { return floorY(FLOOR_ROWS[FLOOR_ROWS.length - 1]); }

// The next girder below `row`, or the plate shelf once we run out of girders.
function nextFloorRowBelow(row) {
    for (const r of FLOOR_ROWS) if (r > row) return r;
    return PLATE_ROW;
}

// Snap onto a girder / ladder when close enough, otherwise refuse the move.
function snapFloorY(y) {
    for (const r of FLOOR_ROWS) {
        if (Math.abs(y - floorY(r)) <= SNAP) return floorY(r);
    }
    return null;
}

function snapLadderX(x) {
    for (const c of LADDER_COLS) {
        if (Math.abs(x - ladderX(c)) <= SNAP) return ladderX(c);
    }
    return null;
}

function nodeX(ci) { return ladderX(LADDER_COLS[ci]); }
function nodeY(ri) { return floorY(FLOOR_ROWS[ri]); }

// Ingredients of one burger, ordered top to bottom. Derived from `pieces` every
// frame so the column stays correct even if pieces are added or removed.
function columnOf(burgerIndex) {
    return pieces
        .filter((p) => p.burger === burgerIndex)
        .sort((a, b) => a.order - b.order);
}

function piecesRemaining() {
    return pieces.filter((p) => !p.stacked).length;
}

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function buildLevel() {
    burgers = BURGER_COLS.map((col, i) => ({ index: i, col, stack: [] }));
    pieces = [];
    for (const b of burgers) {
        INGREDIENTS.forEach((ing, order) => {
            pieces.push({
                burger: b.index,
                order,
                kind: ing.kind,
                color: ing.color,
                shade: ing.shade,
                col: b.col,
                row: FLOOR_ROWS[order],
                y: floorY(FLOOR_ROWS[order]),
                segs: [false, false, false, false],
                targetRow: FLOOR_ROWS[order],
                falling: false,
                carried: false,
                stacked: false,
                riders: [],
            });
        });
    }
}

function enemyCountForLevel(lvl) {
    return Math.min(1 + lvl, MAX_ENEMIES);
}

function enemySpeed() {
    return Math.min(ENEMY_SPEED_MAX, ENEMY_SPEED + (level - 1) * ENEMY_SPEED_STEP);
}

function buildEnemies() {
    const count = enemyCountForLevel(level);
    const kinds = ['hotdog', 'egg', 'pickle'];
    enemies = [];
    for (let i = 0; i < count; i++) {
        const [ri, ci] = SPAWNS[i % SPAWNS.length];
        const e = {
            kind: kinds[i % kinds.length],
            home: { ri, ci },
            ri, ci, pri: -1, pci: -1,
            x: nodeX(ci), y: nodeY(ri),
            tx: nodeX(ci), ty: nodeY(ri),
            dir: 'down',
            stun: 0,
            dead: false,
            respawn: 0,
            riding: null,
            wobble: Math.random() * Math.PI * 2,
        };
        chooseNextNode(e);
        enemies.push(e);
    }
}

// Put chef and enemies back on their spawn marks without replacing the objects,
// so anything holding a reference (including the tests) keeps working.
function resetActors() {
    chef.x = nodeX(2);
    chef.y = nodeY(FLOOR_ROWS.length - 1);
    chef.dir = null;
    chef.facing = 'right';
    chef.walk = 0;
    for (const p of pieces) p.riders = [];
    for (const e of enemies) {
        e.ri = e.home.ri;
        e.ci = e.home.ci;
        e.pri = -1;
        e.pci = -1;
        e.x = nodeX(e.ci);
        e.y = nodeY(e.ri);
        e.stun = 0;
        e.dead = false;
        e.respawn = 0;
        e.riding = null;
        chooseNextNode(e);
    }
    clouds = [];
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    score = 0;
    level = 1;
    lives = START_LIVES;
    peppers = START_PEPPERS;
    sparks = [];
    buildLevel();
    buildEnemies();
    resetActors();
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    peppers = START_PEPPERS;
    buildLevel();
    buildEnemies();
    resetActors();
    state = 'running';
    hideOverlay();
    updateHud();
}

function completeLevel() {
    score += LEVEL_POINTS;
    state = 'levelclear';
    clearTimer = LEVEL_CLEAR_TIME;
    showOverlay('LEVEL CLEAR!', `Level ${level} served — score ${score}`, 'Get ready…');
    updateHud();
}

function killChef() {
    lives -= 1;
    updateHud();
    if (lives <= 0) {
        lives = 0;
        gameOver();
    } else {
        state = 'dying';
        deathTimer = DYING_TIME;
    }
}

function gameOver() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (err) { /* ignore */ }
    }
    updateHud();
    showOverlay('GAME OVER', `Final score ${score} · level ${level}`, 'Press Space or click Start to cook again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefDir(dir) {
    chef.dir = dir || null;
    if (dir) chef.facing = dir;
}

function moveChef(dt) {
    const d = chef.dir;
    if (!d) return;
    const dist = CHEF_SPEED * dt;
    if (d === 'left' || d === 'right') {
        const fy = snapFloorY(chef.y);
        if (fy === null) return;
        chef.y = fy;
        const nx = chef.x + (d === 'left' ? -dist : dist);
        chef.x = Math.max(TILE / 2, Math.min(CANVAS_W - TILE / 2, nx));
    } else {
        const lx = snapLadderX(chef.x);
        if (lx === null) return;
        chef.x = lx;
        const ny = chef.y + (d === 'up' ? -dist : dist);
        chef.y = Math.max(ladderTopY(), Math.min(ladderBottomY(), ny));
    }
    chef.walk += dist;
}

// Standing on an ingredient tile presses that segment down; press all four and
// the ingredient drops.
function updatePress() {
    const fy = snapFloorY(chef.y);
    if (fy === null || Math.abs(fy - chef.y) > 0.001) return;
    const col = Math.floor(chef.x / TILE);
    for (const p of pieces) {
        if (p.falling || p.stacked) continue;
        if (floorY(p.row) !== fy) continue;
        const seg = col - p.col;
        if (seg < 0 || seg >= PIECE_COLS) continue;
        if (!p.segs[seg]) {
            p.segs[seg] = true;
            if (p.segs.every(Boolean)) dropPiece(p);
        }
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function dropPiece(p) {
    if (!p || p.falling || p.stacked) return false;
    p.segs = [false, false, false, false];
    p.falling = true;
    p.carried = false;
    p.targetRow = nextFloorRowBelow(p.row);
    p.riders = enemies.filter((e) => !e.dead && !e.riding &&
        Math.abs(e.y - floorY(p.row)) < 1 &&
        e.x > p.col * TILE && e.x < (p.col + PIECE_COLS) * TILE);
    for (const e of p.riders) e.riding = p;
    score += PIECE_POINTS;
    updateHud();
    return true;
}

function restOnStack(p) {
    p.falling = false;
    p.carried = false;
    p.stacked = true;
    p.row = PLATE_ROW;
    burgers[p.burger].stack.push(p);
    squashRiders(p);
}

function squashRiders(p) {
    if (!p.riders.length) return;
    p.riders.forEach((e, i) => {
        score += SQUASH_POINTS * Math.pow(2, i);
        spawnSparks(e.x, e.y);
        killEnemy(e);
    });
    p.riders = [];
    updateHud();
}

function updatePieces(dt) {
    for (const b of burgers) {
        const column = columnOf(b.index);
        // Bottom-most first, so a piece always sees the settled position of the
        // ingredient it is landing on.
        for (let i = column.length - 1; i >= 0; i--) {
            const p = column[i];
            if (!p.falling) continue;
            const below = column[i + 1];
            const belowLimit = below ? below.y - PIECE_H : Infinity;
            const floorLimit = p.targetRow === PLATE_ROW ? PLATE_Y : floorY(p.targetRow);
            // A carried piece is riding the one underneath it, so the girder it
            // was originally aimed at no longer applies.
            const limit = p.carried && below ? belowLimit : Math.min(floorLimit, belowLimit);

            p.y += FALL_SPEED * dt;
            if (p.y >= limit) {
                p.y = limit;
                if (below && limit === belowLimit) {
                    if (below.stacked) {
                        restOnStack(p);
                    } else if (below.falling) {
                        p.carried = true;          // tag along for the ride
                    } else if (p.carried) {
                        p.falling = false;         // the ride is over: settle on top
                        p.carried = false;
                        p.row = below.row;
                        squashRiders(p);
                    } else {
                        dropPiece(below);          // knock the ingredient below loose
                        p.carried = true;
                    }
                } else {
                    p.row = p.targetRow;
                    if (p.row === PLATE_ROW) {
                        restOnStack(p);
                    } else {
                        p.falling = false;
                        p.carried = false;
                        squashRiders(p);
                    }
                }
            }
            for (const e of p.riders) { e.x = Math.min(Math.max(e.x, p.col * TILE + 6), (p.col + PIECE_COLS) * TILE - 6); e.y = p.y; }
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies — they travel the coarse graph of ladder/girder intersections.
// ---------------------------------------------------------------------------

function chooseNextNode(e) {
    const opts = [];
    if (e.ci > 0) opts.push({ ri: e.ri, ci: e.ci - 1 });
    if (e.ci < LADDER_COLS.length - 1) opts.push({ ri: e.ri, ci: e.ci + 1 });
    if (e.ri > 0) opts.push({ ri: e.ri - 1, ci: e.ci });
    if (e.ri < FLOOR_ROWS.length - 1) opts.push({ ri: e.ri + 1, ci: e.ci });

    let choices = opts.filter((o) => !(o.ri === e.pri && o.ci === e.pci));
    if (!choices.length) choices = opts;

    let pick;
    if (Math.random() < 0.25) {
        pick = choices[Math.floor(Math.random() * choices.length)];
    } else {
        let bestDist = Infinity;
        pick = choices[0];
        for (const o of choices) {
            const d = Math.abs(nodeX(o.ci) - chef.x) + Math.abs(nodeY(o.ri) - chef.y);
            if (d < bestDist) { bestDist = d; pick = o; }
        }
    }

    e.pri = e.ri;
    e.pci = e.ci;
    e.ri = pick.ri;
    e.ci = pick.ci;
    e.tx = nodeX(e.ci);
    e.ty = nodeY(e.ri);
    if (e.tx !== e.x) e.dir = e.tx > e.x ? 'right' : 'left';
    else if (e.ty !== e.y) e.dir = e.ty > e.y ? 'down' : 'up';
}

function killEnemy(e) {
    e.dead = true;
    e.respawn = RESPAWN_TIME;
    e.stun = 0;
    if (e.riding) {
        const idx = e.riding.riders.indexOf(e);
        if (idx >= 0) e.riding.riders.splice(idx, 1);
        e.riding = null;
    }
}

function reviveEnemy(e) {
    e.dead = false;
    e.respawn = 0;
    e.stun = 0;
    e.riding = null;
    e.ri = e.home.ri;
    e.ci = e.home.ci;
    e.pri = -1;
    e.pci = -1;
    e.x = nodeX(e.ci);
    e.y = nodeY(e.ri);
    chooseNextNode(e);
}

function updateEnemies(dt) {
    const speed = enemySpeed();
    for (const e of enemies) {
        e.wobble += dt * 6;
        if (e.dead) {
            e.respawn -= dt;
            if (e.respawn <= 0) reviveEnemy(e);
            continue;
        }
        if (e.riding) continue;            // carried down by an ingredient
        if (e.stun > 0) { e.stun -= dt; continue; }

        let budget = speed * dt;
        let guard = 0;
        while (budget > 0 && guard++ < 8) {
            const dx = e.tx - e.x;
            const dy = e.ty - e.y;
            const remaining = Math.abs(dx) + Math.abs(dy);
            if (remaining <= budget) {
                e.x = e.tx;
                e.y = e.ty;
                budget -= remaining;
                chooseNextNode(e);
            } else {
                if (dx !== 0) e.x += Math.sign(dx) * budget;
                else e.y += Math.sign(dy) * budget;
                budget = 0;
            }
        }
    }
}

function checkCollisions() {
    for (const e of enemies) {
        if (e.dead || e.riding || e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < TILE * 0.45 && Math.abs(e.y - chef.y) < TILE * 0.6) {
            killChef();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function pepperArea() {
    const reach = TILE * 1.9;
    const span = TILE * 0.7;
    if (chef.facing === 'left') return { x0: chef.x - reach, x1: chef.x, y0: chef.y - span, y1: chef.y + span };
    if (chef.facing === 'right') return { x0: chef.x, x1: chef.x + reach, y0: chef.y - span, y1: chef.y + span };
    if (chef.facing === 'up') return { x0: chef.x - span, x1: chef.x + span, y0: chef.y - reach, y1: chef.y };
    return { x0: chef.x - span, x1: chef.x + span, y0: chef.y, y1: chef.y + reach };
}

function sprayPepper() {
    if (state !== 'running' || peppers <= 0) return false;
    peppers -= 1;
    const area = pepperArea();
    for (const e of enemies) {
        if (e.dead || e.riding) continue;
        if (e.x >= area.x0 && e.x <= area.x1 && e.y >= area.y0 && e.y <= area.y1) {
            e.stun = PEPPER_STUN;
        }
    }
    clouds.push({ ...area, life: 0.45 });
    updateHud();
    return true;
}

function spawnSparks(x, y) {
    for (let i = 0; i < 12; i++) {
        sparks.push({
            x, y,
            vx: (Math.random() - 0.5) * 130,
            vy: -Math.random() * 130,
            life: 0.6,
        });
    }
}

function updateEffects(dt) {
    for (const c of clouds) c.life -= dt;
    clouds = clouds.filter((c) => c.life > 0);
    for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += 320 * dt;
        s.life -= dt;
    }
    sparks = sparks.filter((s) => s.life > 0);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (!(dt > 0)) return;
    if (state === 'dying') {
        deathTimer -= dt;
        updatePieces(dt);
        updateEffects(dt);
        if (deathTimer <= 0) {
            resetActors();
            state = 'running';
        }
        return;
    }
    if (state === 'levelclear') {
        clearTimer -= dt;
        updateEffects(dt);
        if (clearTimer <= 0) nextLevel();
        return;
    }
    if (state !== 'running') return;

    moveChef(dt);
    updatePress();
    updatePieces(dt);
    updateEnemies(dt);
    updateEffects(dt);
    checkCollisions();

    if (state === 'running' && piecesRemaining() === 0) completeLevel();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draw() {
    ctx.fillStyle = '#10131c';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawStars();
    drawLadders();
    drawFloors();
    drawPlates();
    drawPieces();
    drawEnemies();
    drawChef();
    drawClouds();
    drawSparks();
}

function drawStars() {
    ctx.fillStyle = 'rgba(255, 235, 200, 0.10)';
    for (let i = 0; i < 60; i++) {
        const x = (i * 97) % CANVAS_W;
        const y = (i * 53) % CANVAS_H;
        ctx.fillRect(x, y, 2, 2);
    }
}

function drawFloors() {
    for (const r of FLOOR_ROWS) {
        const y = floorY(r);
        ctx.fillStyle = '#3f77c9';
        ctx.fillRect(0, y, CANVAS_W, 4);
        ctx.fillStyle = '#2a53924d';
        ctx.fillRect(0, y + 4, CANVAS_W, 2);
        ctx.fillStyle = '#5a9ae8';
        for (let x = 0; x < CANVAS_W; x += TILE) ctx.fillRect(x, y, 2, 4);
    }
}

function drawLadders() {
    const top = ladderTopY();
    const bottom = ladderBottomY();
    for (const c of LADDER_COLS) {
        const cx = ladderX(c);
        ctx.fillStyle = '#c9a24a';
        ctx.fillRect(cx - 9, top, 3, bottom - top);
        ctx.fillRect(cx + 6, top, 3, bottom - top);
        ctx.fillStyle = '#e0bd68';
        for (let y = top + 6; y < bottom; y += 9) ctx.fillRect(cx - 9, y, 18, 2);
    }
}

function drawPlates() {
    for (const b of burgers) {
        const x = b.col * TILE;
        const w = PIECE_COLS * TILE;
        ctx.fillStyle = '#d8dde6';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, PLATE_Y + 6, w / 2 - 2, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa3b2';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, PLATE_Y + 9, w / 2 - 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawPieces() {
    for (const p of pieces) {
        const segW = TILE;
        for (let i = 0; i < PIECE_COLS; i++) {
            const x = (p.col + i) * TILE;
            const sag = p.segs[i] ? 4 : 0;
            const y = p.y - PIECE_H + sag;
            ctx.fillStyle = p.color;
            ctx.fillRect(x, y, segW, PIECE_H);
            ctx.fillStyle = p.shade;
            ctx.fillRect(x, y + PIECE_H - 2, segW, 2);
            if (p.kind === 'bun-top') {
                ctx.fillStyle = '#fff0cf';
                ctx.fillRect(x + 6, y + 2, 3, 2);
                ctx.fillRect(x + 17, y + 3, 3, 2);
            } else if (p.kind === 'lettuce') {
                ctx.fillStyle = '#a5e074';
                ctx.fillRect(x + 2, y, 6, 3);
                ctx.fillRect(x + 15, y + 1, 7, 3);
            } else if (p.kind === 'patty') {
                ctx.fillStyle = '#a9603a';
                ctx.fillRect(x + 4, y + 2, 5, 2);
                ctx.fillRect(x + 16, y + 3, 6, 2);
            }
        }
    }
}

function drawChef() {
    if (state === 'idle') return;
    const x = chef.x;
    const y = chef.y;
    const bob = state === 'running' && chef.dir ? Math.sin(chef.walk / 7) * 1.5 : 0;
    const flash = state === 'dying' && Math.floor(deathTimer * 10) % 2 === 0;
    if (flash) return;

    // legs
    ctx.fillStyle = '#2f3a4d';
    ctx.fillRect(x - 6, y - 7, 4, 7);
    ctx.fillRect(x + 2, y - 7 + bob, 4, 7);
    // body
    ctx.fillStyle = '#f2f4f8';
    ctx.fillRect(x - 8, y - 19, 16, 12);
    ctx.fillStyle = '#e04b4b';
    ctx.fillRect(x - 8, y - 12, 16, 3);
    // head
    ctx.fillStyle = '#f0c08a';
    ctx.fillRect(x - 6, y - 26, 12, 8);
    // hat
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 8, y - 32, 16, 6);
    ctx.fillRect(x - 6, y - 35, 12, 4);
    // eyes
    ctx.fillStyle = '#20242e';
    if (chef.facing === 'left') {
        ctx.fillRect(x - 5, y - 24, 2, 3);
    } else if (chef.facing === 'right') {
        ctx.fillRect(x + 3, y - 24, 2, 3);
    } else {
        ctx.fillRect(x - 4, y - 24, 2, 3);
        ctx.fillRect(x + 2, y - 24, 2, 3);
    }
}

const ENEMY_SKIN = {
    hotdog: { body: '#e2703a', trim: '#ffd9a0' },
    egg: { body: '#f5f0e2', trim: '#ffcf3d' },
    pickle: { body: '#5aa544', trim: '#c4e88a' },
};

function drawEnemies() {
    for (const e of enemies) {
        if (e.dead) continue;
        const skin = ENEMY_SKIN[e.kind] || ENEMY_SKIN.hotdog;
        const x = e.x;
        const y = e.y;
        const stunned = e.stun > 0;
        const hop = stunned ? 0 : Math.sin(e.wobble) * 1.5;

        ctx.fillStyle = stunned ? '#8d93a3' : skin.body;
        ctx.fillRect(x - 8, y - 18 + hop, 16, 18);
        ctx.fillStyle = stunned ? '#aab0bd' : skin.trim;
        ctx.fillRect(x - 8, y - 12 + hop, 16, 4);
        // feet
        ctx.fillStyle = '#2a2f3c';
        ctx.fillRect(x - 7, y - 2, 5, 2);
        ctx.fillRect(x + 2, y - 2, 5, 2);
        // eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 6, y - 15 + hop, 5, 5);
        ctx.fillRect(x + 1, y - 15 + hop, 5, 5);
        ctx.fillStyle = '#101319';
        const look = e.dir === 'left' ? -1 : e.dir === 'right' ? 1 : 0;
        ctx.fillRect(x - 5 + look, y - 14 + hop, 2, 3);
        ctx.fillRect(x + 2 + look, y - 14 + hop, 2, 3);

        if (stunned) {
            ctx.fillStyle = 'rgba(255, 240, 180, 0.85)';
            for (let i = 0; i < 3; i++) {
                const a = e.wobble + i * 2.1;
                ctx.fillRect(x + Math.cos(a) * 12, y - 22 + Math.sin(a) * 5, 3, 3);
            }
        }
    }
}

function drawClouds() {
    for (const c of clouds) {
        const alpha = Math.max(0, c.life / 0.45);
        ctx.fillStyle = `rgba(255, 226, 150, ${alpha * 0.85})`;
        for (let i = 0; i < 14; i++) {
            const px = c.x0 + Math.random() * (c.x1 - c.x0);
            const py = c.y0 + Math.random() * (c.y1 - c.y0);
            ctx.fillRect(px, py, 3, 3);
        }
    }
}

function drawSparks() {
    for (const s of sparks) {
        ctx.fillStyle = `rgba(255, 200, 90, ${Math.max(0, s.life / 0.6)})`;
        ctx.fillRect(s.x, s.y, 3, 3);
    }
}

// ---------------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    peppersEl.textContent = String(peppers);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub1, sub2) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub1 || '';
    overlaySub.textContent = sub2 || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const KEY_DIRS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', A: 'left', d: 'right', D: 'right',
    w: 'up', W: 'up', s: 'down', S: 'down',
};

const heldKeys = [];

function refreshChefDir() {
    for (let i = heldKeys.length - 1; i >= 0; i--) {
        const dir = KEY_DIRS[heldKeys[i]];
        if (dir) { setChefDir(dir); return; }
    }
    setChefDir(null);
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
    if (KEY_DIRS[e.key]) {
        if (!heldKeys.includes(e.key)) heldKeys.push(e.key);
        refreshChefDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    const i = heldKeys.indexOf(e.key);
    if (i >= 0) {
        heldKeys.splice(i, 1);
        refreshChefDir();
    }
});

window.addEventListener('blur', () => {
    heldKeys.length = 0;
    setChefDir(null);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'idle' || state === 'over') startGame();
});

// ---------------------------------------------------------------------------
// Main loop / init
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(t) {
    const dt = lastTime ? Math.min(0.05, (t - lastTime) / 1000) : 0;
    lastTime = t;
    if (AUTO_STEP) step(dt);
    draw();
    requestAnimationFrame(frame);
}

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
buildLevel();
resetActors();
updateHud();
requestAnimationFrame(frame);
