// ---------------------------------------------------------------------------
// Tower Defense — build towers beside a winding road and stop ten waves of
// creeps from walking off the far edge of the map.
//
// Written as a single classic (non-module) script so the game state and helpers
// are reachable from the Playwright tests as plain globals, matching Kaboom!,
// Snake and Tetris in this repo. The whole simulation is deterministic (no RNG
// outside the decorative hit sparks) and is advanced only through `step(dt)`,
// which sub-steps at a fixed rate so results never depend on frame timing.
// ---------------------------------------------------------------------------

// --- Board geometry ---
const CELL = 32;
const GRID_COLS = 20;
const GRID_ROWS = 15;
const CANVAS_W = GRID_COLS * CELL;   // 640
const CANVAS_H = GRID_ROWS * CELL;   // 480

// The road, as axis-aligned waypoints in grid coordinates. The first and last
// sit off the map so creeps walk in from the left and out through the right.
const WAYPOINTS = [
    [-1, 2], [4, 2], [4, 6], [10, 6], [10, 2], [15, 2],
    [15, 10], [6, 10], [6, 13], [20, 13],
];

// --- Towers ---
const TOWER_TYPES = {
    arrow: { name: 'Arrow', cost: 20, range: 2.6, damage: 6, cooldown: 0.5, color: '#7dd3fc' },
    cannon: { name: 'Cannon', cost: 45, range: 2.2, damage: 14, cooldown: 1.6, splash: 1.0, color: '#fb923c' },
    frost: { name: 'Frost', cost: 35, range: 2.4, damage: 3, cooldown: 0.9, slow: true, color: '#a5b4fc' },
};
const MAX_LEVEL = 3;
const UPGRADE_DAMAGE_MULT = 1.6;   // per level above 1
const UPGRADE_RANGE_BONUS = 0.3;   // cells per level above 1
const PROJECTILE_SPEED = 420;      // px/s

// --- Creeps ---
const SLOW_FACTOR = 0.45;          // speed multiplier while frozen
const SLOW_DURATION = 1.5;         // seconds
const SPAWN_INTERVAL = 0.7;        // seconds between creeps in a wave
const BOSS_HP_MULT = 10;
const BOSS_SPEED_MULT = 0.6;
const BOSS_BOUNTY_MULT = 10;
const BOSS_LIVES_COST = 5;

// --- Economy / campaign ---
const START_GOLD = 100;
const START_LIVES = 20;
const MAX_WAVES = 10;
const LIFE_BONUS = 25;             // score per surviving life on a win

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const waveEl = document.getElementById('wave');
const goldEl = document.getElementById('gold');
const livesEl = document.getElementById('lives');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnWave = document.getElementById('btn-wave');
const towerButtons = Array.prototype.slice.call(document.querySelectorAll('.tower-btn'));

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over' | 'won'
let state, wave, gold, lives, score, best, waveActive, selectedType, spawnTimer;
const creeps = [];
const towers = [];
const projectiles = [];
const spawnQueue = [];
const sparks = [];
const hover = { col: -1, row: -1 };

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

function cellCenter(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

function cellKey(col, row) {
    return col + ',' + row;
}

// Waypoints → pixel polyline + the set of grid cells the road covers.
function buildPath() {
    const points = WAYPOINTS.map(([c, r]) => cellCenter(c, r));
    const segments = [];
    const cells = new Set();
    let total = 0;

    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        segments.push({ a, b, len, start: total });
        total += len;

        // Mark every cell between the two waypoints (the legs are axis-aligned).
        const [ac, ar] = WAYPOINTS[i];
        const [bc, br] = WAYPOINTS[i + 1];
        const dc = Math.sign(bc - ac), dr = Math.sign(br - ar);
        let c = ac, r = ar;
        cells.add(cellKey(c, r));
        while (c !== bc || r !== br) {
            c += dc; r += dr;
            cells.add(cellKey(c, r));
        }
    }
    return { points, segments, cells, length: total };
}

const PATH = buildPath();
const pathPoints = PATH.points;
const pathSegments = PATH.segments;
const pathCells = PATH.cells;
const pathLength = PATH.length;

// Position `d` pixels along the road.
function pointAt(d) {
    const dist = Math.max(0, Math.min(pathLength, d));
    for (const seg of pathSegments) {
        if (dist <= seg.start + seg.len || seg === pathSegments[pathSegments.length - 1]) {
            const t = seg.len === 0 ? 0 : (dist - seg.start) / seg.len;
            return { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t };
        }
    }
    return { x: pathPoints[0].x, y: pathPoints[0].y };
}

function inGrid(col, row) {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

function isOnPath(col, row) {
    return pathCells.has(cellKey(col, row));
}

function towerAt(col, row) {
    for (const t of towers) if (t.col === col && t.row === row) return t;
    return null;
}

function isBuildable(col, row) {
    return inGrid(col, row) && !isOnPath(col, row) && !towerAt(col, row);
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

function towerDamage(tower) {
    return TOWER_TYPES[tower.type].damage * Math.pow(UPGRADE_DAMAGE_MULT, tower.level - 1);
}

// Range in pixels, level included.
function towerRange(tower) {
    return (TOWER_TYPES[tower.type].range + UPGRADE_RANGE_BONUS * (tower.level - 1)) * CELL;
}

function placeTower(col, row, type) {
    const def = TOWER_TYPES[type];
    if (!def || !isBuildable(col, row) || gold < def.cost) return null;
    gold -= def.cost;
    const c = cellCenter(col, row);
    const tower = { col, row, x: c.x, y: c.y, type, level: 1, cooldown: 0, shots: 0, angle: 0 };
    towers.push(tower);
    updateHud();
    return tower;
}

function upgradeTower(col, row) {
    const tower = towerAt(col, row);
    if (!tower || tower.level >= MAX_LEVEL) return false;
    const cost = TOWER_TYPES[tower.type].cost;
    if (gold < cost) return false;
    gold -= cost;
    tower.level += 1;
    updateHud();
    return true;
}

function selectTower(type) {
    if (!TOWER_TYPES[type]) return;
    selectedType = type;
    updateHud();
}

// ---------------------------------------------------------------------------
// Creeps
// ---------------------------------------------------------------------------

function creepHp(w) { return Math.round(20 * Math.pow(1.41, w - 1)); }
function creepSpeed(w) { return 1.5 + 0.07 * (w - 1); }   // cells/s
function creepBounty(w) { return 2 + Math.ceil(w / 2); }
function creepCount(w) { return 4 + 2 * w; }

function syncCreep(creep) {
    const p = pointAt(creep.dist);
    creep.x = p.x;
    creep.y = p.y;
}

function spawnCreep(opts) {
    const o = opts || {};
    const boss = !!o.boss;
    const hp = o.hp != null ? o.hp : Math.round(creepHp(wave) * (boss ? BOSS_HP_MULT : 1));
    const creep = {
        dist: o.dist != null ? o.dist : 0,
        hp,
        maxHp: hp,
        speed: o.speed != null ? o.speed : creepSpeed(wave) * (boss ? BOSS_SPEED_MULT : 1),
        bounty: o.bounty != null ? o.bounty : creepBounty(wave) * (boss ? BOSS_BOUNTY_MULT : 1),
        boss,
        slowTimer: 0,
        dead: false,
        x: 0,
        y: 0,
    };
    syncCreep(creep);
    creeps.push(creep);
    return creep;
}

function removeCreep(creep) {
    creep.dead = true;
    const i = creeps.indexOf(creep);
    if (i >= 0) creeps.splice(i, 1);
}

function killCreep(creep) {
    removeCreep(creep);
    gold += creep.bounty;
    score += creep.bounty;
    spawnSparks(creep.x, creep.y, creep.boss ? 16 : 7);
    updateHud();
}

function damageCreep(creep, amount) {
    if (creep.dead) return;
    creep.hp -= amount;
    if (creep.hp <= 0) killCreep(creep);
}

function leakCreep(creep) {
    removeCreep(creep);
    lives = Math.max(0, lives - (creep.boss ? BOSS_LIVES_COST : 1));
    updateHud();
    if (lives === 0) endGame();
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

// Towers shoot whatever is furthest along the road — i.e. closest to leaking.
function pickTarget(tower) {
    const range = towerRange(tower);
    let best = null;
    for (const creep of creeps) {
        if (Math.hypot(creep.x - tower.x, creep.y - tower.y) > range) continue;
        if (!best || creep.dist > best.dist) best = creep;
    }
    return best;
}

function fire(tower, target) {
    const def = TOWER_TYPES[tower.type];
    tower.cooldown = def.cooldown;
    tower.shots += 1;
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    projectiles.push({
        x: tower.x,
        y: tower.y,
        target,
        damage: towerDamage(tower),
        splash: def.splash ? def.splash * CELL : 0,
        slow: !!def.slow,
        color: def.color,
    });
}

function impact(proj, x, y) {
    if (proj.splash > 0) {
        // Snapshot first: damaging a creep can remove it from `creeps`.
        const hit = creeps.filter((c) => Math.hypot(c.x - x, c.y - y) <= proj.splash);
        for (const creep of hit) damageCreep(creep, proj.damage);
        spawnSparks(x, y, 10);
    } else if (!proj.target.dead) {
        if (proj.slow) proj.target.slowTimer = SLOW_DURATION;
        damageCreep(proj.target, proj.damage);
        spawnSparks(x, y, 4);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    // Release queued creeps.
    if (waveActive && spawnQueue.length > 0) {
        spawnTimer -= h;
        if (spawnTimer <= 0) {
            spawnCreep(spawnQueue.shift());
            spawnTimer += SPAWN_INTERVAL;
        }
    }

    // Creeps walk; anything reaching the exit leaks.
    for (let i = creeps.length - 1; i >= 0; i--) {
        const creep = creeps[i];
        let factor = 1;
        if (creep.slowTimer > 0) {
            creep.slowTimer = Math.max(0, creep.slowTimer - h);
            factor = SLOW_FACTOR;
        }
        creep.dist += creep.speed * CELL * factor * h;
        syncCreep(creep);
        if (creep.dist >= pathLength) {
            leakCreep(creep);
            if (state !== 'running') return;
        }
    }

    // Towers acquire and fire.
    for (const tower of towers) {
        tower.cooldown = Math.max(0, tower.cooldown - h);
        if (tower.cooldown > 0) continue;
        const target = pickTarget(tower);
        if (target) fire(tower, target);
    }

    // Projectiles home in on their target.
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (p.target.dead) {
            // Shells still detonate where the target fell; arrows just vanish.
            if (p.splash > 0) impact(p, p.target.x, p.target.y);
            projectiles.splice(i, 1);
            continue;
        }
        const dx = p.target.x - p.x, dy = p.target.y - p.y;
        const gap = Math.hypot(dx, dy);
        const travel = PROJECTILE_SPEED * h;
        if (gap <= travel) {
            impact(p, p.target.x, p.target.y);
            projectiles.splice(i, 1);
        } else {
            p.x += (dx / gap) * travel;
            p.y += (dy / gap) * travel;
        }
    }

    // A wave ends when the queue is empty and the map is clear.
    if (waveActive && spawnQueue.length === 0 && creeps.length === 0) completeWave();
}

function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 120;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateSparks(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    wave = 1;
    gold = START_GOLD;
    lives = START_LIVES;
    score = 0;
    waveActive = false;
    spawnTimer = 0;
    creeps.length = 0;
    towers.length = 0;
    projectiles.length = 0;
    spawnQueue.length = 0;
    sparks.length = 0;
    hideOverlay();
    updateHud();
}

function startWave() {
    if (state !== 'running' || waveActive) return;
    waveActive = true;
    spawnTimer = 0;
    spawnQueue.length = 0;
    for (let i = 0; i < creepCount(wave); i++) spawnQueue.push({});
    if (wave % 5 === 0) spawnQueue.push({ boss: true });
    updateHud();
}

function waveBonus(w) { return 20 + 5 * w; }

function completeWave() {
    waveActive = false;
    const bonus = waveBonus(wave);
    gold += bonus;
    score += bonus;
    if (wave >= MAX_WAVES) winGame();
    else wave += 1;
    updateHud();
}

function winGame() {
    state = 'won';
    score += lives * LIFE_BONUS;
    saveBest();
    showOverlay('VICTORY', 'Score ' + score + ' · ' + lives + ' lives left',
        'Press Space to play again', 'Play Again');
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    saveBest();
    showOverlay('GAME OVER', 'Score ' + score + ' · Wave ' + wave + ' of ' + MAX_WAVES,
        'Press Space to play again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
    updateHud();
}

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem('tower-defense-best', String(best)); } catch (e) { /* ignore */ }
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    waveEl.textContent = wave + ' / ' + MAX_WAVES;
    goldEl.textContent = String(gold);
    livesEl.textContent = String(lives);
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    btnWave.disabled = !(state === 'running' && !waveActive);
    for (const btn of towerButtons) {
        const type = btn.dataset.type;
        btn.classList.toggle('selected', type === selectedType);
        btn.classList.toggle('unaffordable', gold < TOWER_TYPES[type].cost);
    }
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
// Hit sparks (decoration only — never read by game logic)
// ---------------------------------------------------------------------------

function spawnSparks(x, y, n) {
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random();
        const speed = 40 + Math.random() * 90;
        sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 0.35 });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawMap() {
    // Grass with a soft checker so the grid is readable.
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < GRID_COLS; c++) {
            ctx.fillStyle = (c + r) % 2 === 0 ? '#1b3a2c' : '#183429';
            ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
    }
    // Road.
    for (const key of pathCells) {
        const [c, r] = key.split(',').map(Number);
        if (!inGrid(c, r)) continue;
        ctx.fillStyle = '#4a4034';
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(c * CELL, r * CELL, CELL, 3);
    }
    // Exit marker.
    const end = pointAt(pathLength);
    ctx.fillStyle = 'rgba(248,113,113,0.35)';
    ctx.fillRect(CANVAS_W - 6, end.y - CELL / 2, 6, CELL);
}

function drawHover() {
    if (state !== 'running' || !inGrid(hover.col, hover.row)) return;
    const c = cellCenter(hover.col, hover.row);
    const existing = towerAt(hover.col, hover.row);
    const def = TOWER_TYPES[selectedType];

    if (existing) {
        ctx.strokeStyle = 'rgba(251,191,36,0.8)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, towerRange(existing), 0, Math.PI * 2);
        ctx.stroke();
        return;
    }

    const ok = isBuildable(hover.col, hover.row) && gold >= def.cost;
    ctx.fillStyle = ok ? 'rgba(125,211,252,0.18)' : 'rgba(248,113,113,0.18)';
    ctx.fillRect(hover.col * CELL, hover.row * CELL, CELL, CELL);
    if (ok) {
        ctx.strokeStyle = 'rgba(125,211,252,0.45)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, def.range * CELL, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawTower(t) {
    const def = TOWER_TYPES[t.type];
    const x = t.x, y = t.y;

    ctx.fillStyle = '#0d1a15';
    ctx.fillRect(x - 13, y - 13, 26, 26);
    ctx.fillStyle = def.color;

    if (t.type === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(x, y - 11);
        ctx.lineTo(x + 10, y + 9);
        ctx.lineTo(x - 10, y + 9);
        ctx.closePath();
        ctx.fill();
    } else if (t.type === 'cannon') {
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(t.angle) * 15, y + Math.sin(t.angle) * 15);
        ctx.stroke();
        ctx.lineWidth = 1;
    } else {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
            const px = x + Math.cos(a) * 11, py = y + Math.sin(a) * 11;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    // Level pips.
    for (let i = 0; i < t.level - 1; i++) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x - 12 + i * 6, y + 10, 4, 3);
    }
}

function drawCreep(c) {
    const radius = c.boss ? 13 : 8;
    ctx.fillStyle = c.slowTimer > 0 ? '#67e8f9' : (c.boss ? '#f472b6' : '#facc15');
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0d1a15';
    ctx.stroke();

    // HP bar.
    const w = radius * 2.2;
    const frac = Math.max(0, c.hp / c.maxHp);
    ctx.fillStyle = '#0d1a15';
    ctx.fillRect(c.x - w / 2, c.y - radius - 7, w, 4);
    ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#fbbf24' : '#f87171';
    ctx.fillRect(c.x - w / 2, c.y - radius - 7, w * frac, 4);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawMap();
    drawHover();

    for (const t of towers) drawTower(t);
    for (const c of creeps) drawCreep(c);

    for (const p of projectiles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.splash > 0 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const s of sparks) {
        ctx.globalAlpha = Math.max(0, s.life / 0.35);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;

    // Build-phase banner.
    if (state === 'running' && !waveActive) {
        ctx.fillStyle = 'rgba(6,12,10,0.6)';
        ctx.fillRect(0, 0, CANVAS_W, 26);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Build phase — press Space to send wave ' + wave + ' of ' + MAX_WAVES,
            CANVAS_W / 2, 18);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    else updateSparks(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasCell(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const y = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === 'r' || e.key === 'R') {
        if (state !== 'idle') { startGame(); e.preventDefault(); }
        return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
        selectTower({ 1: 'arrow', 2: 'cannon', 3: 'frost' }[e.key]);
        e.preventDefault();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over' || state === 'won') startGame();
        else if (state === 'running' && !waveActive) startWave();
        e.preventDefault();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const cell = canvasCell(e);
    hover.col = cell.col;
    hover.row = cell.row;
});

canvas.addEventListener('mouseleave', () => {
    hover.col = -1;
    hover.row = -1;
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    const { col, row } = canvasCell(e);
    if (!inGrid(col, row)) return;
    if (towerAt(col, row)) upgradeTower(col, row);
    else placeTower(col, row, selectedType);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

btnWave.addEventListener('click', () => startWave());

for (const btn of towerButtons) {
    btn.addEventListener('click', () => selectTower(btn.dataset.type));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('tower-defense-best') || '0', 10) || 0;
state = 'idle';
wave = 1;
gold = START_GOLD;
lives = START_LIVES;
score = 0;
waveActive = false;
spawnTimer = 0;
selectedType = 'arrow';
updateHud();
requestAnimationFrame(frame);
