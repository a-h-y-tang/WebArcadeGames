// Tower Defense — a grid-based tower defense game on a canvas.
//
// The simulation lives entirely in step(dt); draw() only reads state. That split
// is what lets the Playwright specs drive whole waves deterministically without
// waiting on real time.

// ---------------------------------------------------------------------------
// Board constants
// ---------------------------------------------------------------------------

const CELL = 28;
const COLS = 20;
const ROWS = 15;

// The road, in grid coordinates. Consecutive waypoints always share a row or a
// column, and the first/last sit outside the board so creeps walk on and off.
const WAYPOINTS = [
    { col: -1, row: 2 },
    { col: 14, row: 2 },
    { col: 14, row: 5 },
    { col: 3, row: 5 },
    { col: 3, row: 8 },
    { col: 16, row: 8 },
    { col: 16, row: 11 },
    { col: 6, row: 11 },
    { col: 6, row: 13 },
    { col: 20, row: 13 },
];

const TOWER_TYPES = {
    gun: {
        name: 'Gun',
        cost: 20,
        range: 84,
        damage: 5,
        cooldown: 0.4,
        splash: 0,
        slow: 0,
        shot: 'bullet',
        shotSpeed: 340,
        color: '#4ade80',
        dark: '#1d6b45',
    },
    frost: {
        name: 'Frost',
        cost: 30,
        range: 70,
        damage: 1,
        cooldown: 0.9,
        splash: 0,
        slow: 0.5,
        shot: 'beam',
        shotSpeed: 0,
        color: '#5cc8ff',
        dark: '#1d5a80',
    },
    cannon: {
        name: 'Cannon',
        cost: 45,
        range: 95,
        damage: 14,
        cooldown: 1.4,
        splash: 40,
        slow: 0,
        shot: 'shell',
        shotSpeed: 210,
        color: '#f08a4b',
        dark: '#8a4620',
    },
};

const CREEP_TYPES = {
    grunt: { name: 'Grunt', hp: 18, speed: 60, reward: 4, leak: 1, points: 10, radius: 8, color: '#c94f4f' },
    runner: { name: 'Runner', hp: 10, speed: 105, reward: 4, leak: 1, points: 12, radius: 6, color: '#e0d24c' },
    tank: { name: 'Tank', hp: 70, speed: 38, reward: 9, leak: 2, points: 25, radius: 11, color: '#9b6fd6' },
    boss: { name: 'Boss', hp: 90, speed: 42, reward: 40, leak: 5, points: 100, radius: 14, color: '#ff5f8f' },
};

const WAVES = [
    [{ type: 'grunt', count: 6 }],
    [{ type: 'grunt', count: 9 }],
    [{ type: 'grunt', count: 8 }, { type: 'runner', count: 4 }],
    [{ type: 'grunt', count: 10 }, { type: 'runner', count: 6 }],
    [{ type: 'grunt', count: 8 }, { type: 'tank', count: 3 }],
    [{ type: 'runner', count: 12 }, { type: 'tank', count: 4 }],
    [{ type: 'grunt', count: 14 }, { type: 'runner', count: 6 }],
    [{ type: 'runner', count: 8 }, { type: 'tank', count: 6 }],
    [{ type: 'grunt', count: 16 }, { type: 'runner', count: 8 }, { type: 'tank', count: 4 }],
    [{ type: 'runner', count: 12 }, { type: 'tank', count: 8 }],
    [{ type: 'grunt', count: 20 }, { type: 'runner', count: 10 }, { type: 'tank', count: 6 }],
    [{ type: 'grunt', count: 10 }, { type: 'tank', count: 4 }, { type: 'boss', count: 1 }],
];

const START_GOLD = 100;
const START_LIVES = 20;
const SPAWN_GAP = 0.7;          // seconds between creeps within a wave
const SLOW_DURATION = 1.8;      // seconds a frost hit lasts
const MAX_LEVEL = 3;
const DAMAGE_PER_LEVEL = 1.5;
const RANGE_PER_LEVEL = 1.1;
const SELL_RATE = 0.6;
const HP_PER_WAVE = 1.32;       // creep HP multiplies by this each wave
const HIT_RADIUS = 6;           // how close a projectile gets before it lands

// ---------------------------------------------------------------------------
// Derived path geometry
// ---------------------------------------------------------------------------

const pathPoints = WAYPOINTS.map((w) => cellCenter(w.col, w.row));

const segments = pathPoints.slice(0, -1).map((p, i) => {
    const q = pathPoints[i + 1];
    return { x: p.x, y: p.y, dx: q.x - p.x, dy: q.y - p.y, length: Math.hypot(q.x - p.x, q.y - p.y) };
});

// Cumulative distance to the start of each segment, for "how far along" checks.
const segmentStart = segments.reduce(
    (acc, s) => [...acc, acc[acc.length - 1] + s.length],
    [0]
);

const roadCells = (() => {
    const set = new Set();
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
        const a = WAYPOINTS[i];
        const b = WAYPOINTS[i + 1];
        const stepCol = Math.sign(b.col - a.col);
        const stepRow = Math.sign(b.row - a.row);
        let { col, row } = a;
        set.add(`${col},${row}`);
        while (col !== b.col || row !== b.row) {
            col += stepCol;
            row += stepRow;
            set.add(`${col},${row}`);
        }
    }
    return set;
})();

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

let state = 'idle';   // idle | building | running | paused | over | won
let gold = START_GOLD;
let lives = START_LIVES;
let wave = 1;
let score = 0;
let best = 0;
let killed = 0;
let leaked = 0;
let selected = 'gun';

let towers = [];
let creeps = [];
let projectiles = [];
let beams = [];       // short-lived frost beams, purely visual
let spawnQueue = [];
let spawnTimer = 0;

let hover = null;     // { col, row } under the mouse, or null

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const btnWave = document.getElementById('btn-wave');
const statusLine = document.getElementById('status');
const towerButtons = [...document.querySelectorAll('.tower-btn')];

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

function cellCenter(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

function inGrid(col, row) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function isRoad(col, row) {
    return roadCells.has(`${col},${row}`);
}

function towerAt(col, row) {
    return towers.find((t) => t.col === col && t.row === row) || null;
}

function isBuildable(col, row) {
    return inGrid(col, row) && !isRoad(col, row) && !towerAt(col, row);
}

function towerRange(tower) {
    return TOWER_TYPES[tower.type].range * Math.pow(RANGE_PER_LEVEL, tower.level - 1);
}

function towerDamage(tower) {
    return TOWER_TYPES[tower.type].damage * Math.pow(DAMAGE_PER_LEVEL, tower.level - 1);
}

function upgradeCost(tower) {
    return TOWER_TYPES[tower.type].cost * tower.level;
}

// How far along the whole road a creep is, in pixels.
function progress(creep) {
    return segmentStart[creep.seg] + creep.dist;
}

function creepSpeed(creep) {
    return creep.slowTimer > 0 ? creep.speed * creep.slowFactor : creep.speed;
}

function inTowerRange(tower, creep) {
    return Math.hypot(tower.x - creep.x, tower.y - creep.y) <= towerRange(tower);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function selectTower(type) {
    if (!TOWER_TYPES[type]) return false;
    selected = type;
    updateHud();
    return true;
}

function placeTower(col, row) {
    if (state !== 'building' && state !== 'running') return false;
    if (!isBuildable(col, row)) return false;
    const spec = TOWER_TYPES[selected];
    if (gold < spec.cost) return false;

    gold -= spec.cost;
    const { x, y } = cellCenter(col, row);
    towers.push({
        col,
        row,
        x,
        y,
        type: selected,
        level: 1,
        invested: spec.cost,
        cooldown: 0,
        angle: 0,
        flash: 0,
    });
    updateHud();
    return true;
}

function upgradeTower(col, row) {
    const tower = towerAt(col, row);
    if (!tower) return false;
    if (state !== 'building' && state !== 'running') return false;
    if (tower.level >= MAX_LEVEL) return false;
    const cost = upgradeCost(tower);
    if (gold < cost) return false;

    gold -= cost;
    tower.invested += cost;
    tower.level++;
    updateHud();
    return true;
}

function sellTower(col, row) {
    const tower = towerAt(col, row);
    if (!tower) return false;
    if (state !== 'building' && state !== 'running') return false;

    gold += Math.floor(tower.invested * SELL_RATE);
    towers.splice(towers.indexOf(tower), 1);
    updateHud();
    return true;
}

// The flat list of creep types for a wave, in spawn order.
function waveComposition(n) {
    const groups = WAVES[Math.min(n, WAVES.length) - 1] || [];
    return groups.flatMap((g) => Array(g.count).fill(g.type));
}

function callWave() {
    if (state !== 'building') return false;
    spawnQueue = waveComposition(wave);
    spawnTimer = 0;
    state = 'running';
    updateHud();
    return true;
}

function startGame() {
    state = 'building';
    gold = START_GOLD;
    lives = START_LIVES;
    wave = 1;
    score = 0;
    killed = 0;
    leaked = 0;
    towers = [];
    creeps = [];
    projectiles = [];
    beams = [];
    spawnQueue = [];
    spawnTimer = 0;
    hideOverlay();
    updateHud();
    return true;
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Wave ${wave} · Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Creeps
// ---------------------------------------------------------------------------

function spawnCreep(type) {
    const spec = CREEP_TYPES[type];
    const hp = Math.round(spec.hp * Math.pow(HP_PER_WAVE, wave - 1));
    const creep = {
        type,
        hp,
        maxHp: hp,
        speed: spec.speed,
        reward: spec.reward,
        leak: spec.leak,
        points: spec.points,
        radius: spec.radius,
        color: spec.color,
        seg: 0,
        dist: 0,
        x: 0,
        y: 0,
        slowTimer: 0,
        slowFactor: 1,
        hitFlash: 0,
    };
    updateCreepPosition(creep);
    return creep;
}

function updateCreepPosition(creep) {
    const seg = segments[Math.min(creep.seg, segments.length - 1)];
    const t = seg.length === 0 ? 0 : creep.dist / seg.length;
    creep.x = seg.x + seg.dx * t;
    creep.y = seg.y + seg.dy * t;
}

function applySlow(creep) {
    creep.slowTimer = SLOW_DURATION;
    creep.slowFactor = TOWER_TYPES.frost.slow;
}

function removeCreep(creep) {
    const i = creeps.indexOf(creep);
    if (i >= 0) creeps.splice(i, 1);
}

function damageCreep(creep, amount) {
    if (creep.hp <= 0) return;
    creep.hp -= amount;
    creep.hitFlash = 0.08;
    if (creep.hp <= 0) {
        gold += creep.reward;
        score += creep.points;
        killed++;
        removeCreep(creep);
        updateHud();
    }
}

function detonate(shot) {
    for (const creep of [...creeps]) {
        if (Math.hypot(creep.x - shot.x, creep.y - shot.y) <= shot.splash + creep.radius) {
            damageCreep(creep, shot.damage);
        }
    }
}

function leakCreep(creep) {
    removeCreep(creep);
    leaked++;
    lives = Math.max(0, lives - creep.leak);
    updateHud();
    if (lives === 0) gameOver();
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

// Standard "first" targeting: the creep furthest along the road wins.
function pickTarget(tower) {
    let first = null;
    for (const creep of creeps) {
        if (!inTowerRange(tower, creep)) continue;
        if (!first || progress(creep) > progress(first)) first = creep;
    }
    return first;
}

function fire(tower, target) {
    const spec = TOWER_TYPES[tower.type];
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.flash = 0.08;

    if (spec.shot === 'beam') {
        damageCreep(target, towerDamage(tower));
        applySlow(target);
        beams.push({ x1: tower.x, y1: tower.y, x2: target.x, y2: target.y, life: 0.12 });
        return;
    }

    projectiles.push({
        x: tower.x,
        y: tower.y,
        tx: target.x,
        ty: target.y,
        target,
        damage: towerDamage(tower),
        splash: spec.splash,
        speed: spec.shotSpeed,
        kind: spec.shot,
        color: spec.color,
    });
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function stepSpawns(dt) {
    spawnTimer -= dt;
    while (spawnQueue.length > 0 && spawnTimer <= 0) {
        creeps.push(spawnCreep(spawnQueue.shift()));
        spawnTimer += SPAWN_GAP;
        updateHud();
    }
    if (spawnQueue.length === 0) spawnTimer = Math.max(0, spawnTimer);
}

function stepCreeps(dt) {
    for (const creep of [...creeps]) {
        if (creep.slowTimer > 0) creep.slowTimer = Math.max(0, creep.slowTimer - dt);
        if (creep.hitFlash > 0) creep.hitFlash = Math.max(0, creep.hitFlash - dt);

        creep.dist += creepSpeed(creep) * dt;
        while (creep.dist > segments[creep.seg].length) {
            creep.dist -= segments[creep.seg].length;
            creep.seg++;
            if (creep.seg >= segments.length) {
                leakCreep(creep);
                break;
            }
        }
        if (creep.seg < segments.length) updateCreepPosition(creep);
        if (state !== 'running') return;
    }
}

function stepTowers(dt) {
    for (const tower of towers) {
        if (tower.flash > 0) tower.flash = Math.max(0, tower.flash - dt);
        tower.cooldown -= dt;
        if (tower.cooldown > 0) continue;

        const target = pickTarget(tower);
        if (!target) {
            tower.cooldown = 0;
            continue;
        }
        fire(tower, target);
        tower.cooldown = TOWER_TYPES[tower.type].cooldown;
    }
}

function stepProjectiles(dt) {
    for (const shot of [...projectiles]) {
        // Home on the target while it lives; otherwise carry on to where it was.
        if (shot.target && creeps.includes(shot.target)) {
            shot.tx = shot.target.x;
            shot.ty = shot.target.y;
        } else {
            shot.target = null;
        }

        const dx = shot.tx - shot.x;
        const dy = shot.ty - shot.y;
        const distance = Math.hypot(dx, dy);
        const travel = shot.speed * dt;

        if (distance <= travel + HIT_RADIUS) {
            shot.x = shot.tx;
            shot.y = shot.ty;
            if (shot.splash > 0) detonate(shot);
            else if (shot.target) damageCreep(shot.target, shot.damage);
            projectiles.splice(projectiles.indexOf(shot), 1);
            continue;
        }

        shot.x += (dx / distance) * travel;
        shot.y += (dy / distance) * travel;
    }
}

function stepBeams(dt) {
    for (const beam of [...beams]) {
        beam.life -= dt;
        if (beam.life <= 0) beams.splice(beams.indexOf(beam), 1);
    }
}

function checkWaveEnd() {
    if (state !== 'running') return;
    if (spawnQueue.length > 0 || creeps.length > 0) return;

    score += 25;
    if (wave >= WAVES.length) {
        winGame();
        return;
    }
    gold += 10 + 2 * wave;
    wave++;
    state = 'building';
    projectiles = [];
    updateHud();
}

function step(dt) {
    if (state !== 'running') return;
    stepSpawns(dt);
    stepCreeps(dt);
    if (state !== 'running') return;
    stepTowers(dt);
    stepProjectiles(dt);
    stepBeams(dt);
    checkWaveEnd();
}

// ---------------------------------------------------------------------------
// Run outcomes
// ---------------------------------------------------------------------------

function saveBest() {
    if (score > best) {
        best = score;
        try { localStorage.setItem('towerdefense-best', String(best)); } catch (e) { /* ignore */ }
    }
}

function gameOver() {
    state = 'over';
    saveBest();
    updateHud();
    showOverlay('BASE BREACHED', `Score ${score} · Wave ${wave}`, 'Press R or Space to try again', 'bad');
}

function winGame() {
    state = 'won';
    saveBest();
    updateHud();
    showOverlay('BASE DEFENDED', `Score ${score} · Lives ${lives}`, 'Press R or Space to play again', 'good');
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function statusText() {
    switch (state) {
        case 'idle':
            return 'Press Space to begin';
        case 'building':
            return `Wave ${wave} of ${WAVES.length} ready — build, then press Space`;
        case 'running':
            return `Wave ${wave} of ${WAVES.length} — ${creeps.length + spawnQueue.length} creeps left`;
        case 'paused':
            return 'Paused';
        case 'over':
            return `The base fell on wave ${wave}`;
        default:
            return `All ${WAVES.length} waves defended!`;
    }
}

function updateHud() {
    document.getElementById('wave').textContent = String(wave);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('gold').textContent = String(gold);
    document.getElementById('score').textContent = String(score);
    document.getElementById('best').textContent = String(best);
    statusLine.textContent = statusText();

    for (const button of towerButtons) {
        const type = button.dataset.type;
        button.classList.toggle('selected', type === selected);
        button.classList.toggle('broke', gold < TOWER_TYPES[type].cost);
    }
    btnWave.disabled = state !== 'building';
}

// `tone` colours the headline: a loss should not read the same as a win.
function showOverlay(title, scoreLine, sub, tone = 'neutral') {
    overlayTitle.textContent = title;
    overlayTitle.className = `tone-${tone}`;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    btnStart.textContent =
        state === 'paused' ? 'Resume' : state === 'over' || state === 'won' ? 'Play Again' : 'Start Game';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawBoard() {
    ctx.fillStyle = '#12251f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grass checker, so the grid reads without hard lines everywhere.
    for (let col = 0; col < COLS; col++) {
        for (let row = 0; row < ROWS; row++) {
            if (isRoad(col, row)) continue;
            ctx.fillStyle = (col + row) % 2 === 0 ? '#16302a' : '#142b25';
            ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
        }
    }

    // Road: one thick rounded stroke down the middle of the waypoints.
    ctx.lineWidth = CELL;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#3b332a';
    ctx.beginPath();
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (const p of pathPoints.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.setLineDash([7, 9]);
    ctx.strokeStyle = 'rgba(226, 208, 168, 0.28)';
    ctx.stroke();
    ctx.setLineDash([]);

    // Entrance and exit markers.
    const entry = pathPoints[0];
    const exit = pathPoints[pathPoints.length - 1];
    ctx.fillStyle = 'rgba(201, 79, 79, 0.85)';
    ctx.fillRect(0, entry.y - CELL / 2, 5, CELL);
    ctx.fillStyle = 'rgba(74, 222, 128, 0.85)';
    ctx.fillRect(canvas.width - 5, exit.y - CELL / 2, 5, CELL);
}

function drawHover() {
    if (!hover || (state !== 'building' && state !== 'running')) return;
    const existing = towerAt(hover.col, hover.row);
    const { x, y } = cellCenter(hover.col, hover.row);

    if (existing) {
        ctx.strokeStyle = 'rgba(230, 245, 239, 0.35)';
        ctx.beginPath();
        ctx.arc(x, y, towerRange(existing), 0, Math.PI * 2);
        ctx.stroke();
        return;
    }

    const spec = TOWER_TYPES[selected];
    const ok = isBuildable(hover.col, hover.row) && gold >= spec.cost;
    ctx.fillStyle = ok ? 'rgba(74, 222, 128, 0.18)' : 'rgba(239, 91, 76, 0.18)';
    ctx.fillRect(hover.col * CELL, hover.row * CELL, CELL, CELL);
    if (!ok) return;

    ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, spec.range, 0, Math.PI * 2);
    ctx.stroke();
}

function drawTowers() {
    for (const tower of towers) {
        const spec = TOWER_TYPES[tower.type];
        const base = CELL / 2 - 3;

        ctx.fillStyle = spec.dark;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, base, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = spec.color;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, base - 3, 0, Math.PI * 2);
        ctx.fill();

        // Barrel pointing at whatever it last shot.
        ctx.save();
        ctx.translate(tower.x, tower.y);
        ctx.rotate(tower.angle);
        ctx.fillStyle = tower.flash > 0 ? '#fff8e1' : spec.dark;
        ctx.fillRect(0, -2.5, base + 5, 5);
        ctx.restore();

        // Level pips.
        for (let i = 0; i < tower.level; i++) {
            ctx.fillStyle = '#f5c451';
            ctx.fillRect(tower.x - 5 + i * 5, tower.y + base - 1, 3, 3);
        }
    }
}

function drawCreeps() {
    for (const creep of creeps) {
        if (creep.x < -CELL) continue;

        ctx.fillStyle = creep.hitFlash > 0 ? '#ffffff' : creep.color;
        ctx.beginPath();
        ctx.arc(creep.x, creep.y, creep.radius, 0, Math.PI * 2);
        ctx.fill();

        if (creep.slowTimer > 0) {
            ctx.strokeStyle = '#5cc8ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(creep.x, creep.y, creep.radius + 2, 0, Math.PI * 2);
            ctx.stroke();
        }

        const width = creep.radius * 2;
        const ratio = Math.max(0, creep.hp / creep.maxHp);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(creep.x - width / 2, creep.y - creep.radius - 7, width, 3);
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#f5c451' : '#ef5b4c';
        ctx.fillRect(creep.x - width / 2, creep.y - creep.radius - 7, width * ratio, 3);
    }
}

function drawShots() {
    for (const beam of beams) {
        ctx.strokeStyle = `rgba(92, 200, 255, ${Math.max(0, beam.life / 0.12)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(beam.x1, beam.y1);
        ctx.lineTo(beam.x2, beam.y2);
        ctx.stroke();
    }

    for (const shot of projectiles) {
        ctx.fillStyle = shot.color;
        ctx.beginPath();
        ctx.arc(shot.x, shot.y, shot.kind === 'shell' ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

function draw() {
    drawBoard();
    drawHover();
    drawTowers();
    drawShots();
    drawCreeps();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        col: Math.floor(((event.clientX - rect.left) * scaleX) / CELL),
        row: Math.floor(((event.clientY - rect.top) * scaleY) / CELL),
    };
}

canvas.addEventListener('mousemove', (event) => {
    hover = cellFromEvent(event);
});

canvas.addEventListener('mouseleave', () => {
    hover = null;
});

canvas.addEventListener('click', (event) => {
    const { col, row } = cellFromEvent(event);
    if (towerAt(col, row)) upgradeTower(col, row);
    else placeTower(col, row);
});

canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const { col, row } = cellFromEvent(event);
    sellTower(col, row);
});

for (const button of towerButtons) {
    button.addEventListener('click', () => selectTower(button.dataset.type));
}

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

btnWave.addEventListener('click', () => callWave());

window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    if (key === '1' || key === '2' || key === '3') {
        selectTower(['gun', 'frost', 'cannon'][Number(key) - 1]);
        event.preventDefault();
        return;
    }
    if (key === 'p') {
        togglePause();
        event.preventDefault();
        return;
    }
    if (key === 'r') {
        if (state === 'idle' || state === 'over' || state === 'won') startGame();
        event.preventDefault();
        return;
    }
    if (key === ' ' || event.code === 'Space' || key === 'enter') {
        if (state === 'building') callWave();
        else if (state !== 'running' && state !== 'paused') startGame();
        event.preventDefault();
    }
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    best = parseInt(localStorage.getItem('towerdefense-best') || '0', 10) || 0;
} catch (e) {
    best = 0;
}

updateHud();
showOverlay('TOWER DEFENSE', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
