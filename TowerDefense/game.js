// ---------------------------------------------------------------------------
// Tower Defense — creeps walk a fixed road, the player plants towers beside it.
//
// The player never controls a unit directly: they spend gold on towers, and the
// simulation resolves. Creeps are positioned by a single scalar `dist` — how far
// they have walked along the road polyline — so movement is exactly
// `dist += speed * dt`, "who is furthest along?" (the targeting rule) is a plain
// numeric comparison, and the whole game is deterministic: no randomness
// anywhere, wave contents are a pure function of the wave number.
//
// Written as a single classic (non-module) script so state and helpers are
// reachable from the Playwright tests as plain globals, mirroring Snake, Tetris,
// Kaboom! and BurgerTime in this repo. All motion is per-second and advanced
// through `step(dt)`, so the tests simulate frames deterministically without
// depending on requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- Grid ------------------------------------------------------------------
const TILE = 32;
const COLS = 20;
const ROWS = 15;
const CANVAS_W = COLS * TILE;  // 640
const CANVAS_H = ROWS * TILE;  // 480

// --- The road --------------------------------------------------------------
// Waypoints in tile coordinates; the road enters off-screen left and leaves
// off-screen right, so creeps walk in and out of view instead of popping.
const PATH_POINTS = [
    { col: -1, row: 2 },
    { col: 16, row: 2 },
    { col: 16, row: 7 },
    { col: 3, row: 7 },
    { col: 3, row: 12 },
    { col: 20, row: 12 },
];
const ROAD_W = 26;

// --- Economy ---------------------------------------------------------------
const START_GOLD = 150;
const START_LIVES = 20;
const WAVE_COUNT = 20;
const WAVE_BREAK = 8;          // seconds of countdown between waves
const WAVE_BONUS_BASE = 20;
const WAVE_BONUS_STEP = 5;
const SELL_REFUND = 0.6;
const MAX_LEVEL = 3;
const UPGRADE_COST_FACTOR = 0.8;
const UPGRADE_DAMAGE = 1.5;
const UPGRADE_RANGE = 1.12;
const BEST_KEY = 'towerDefenseBest';

// --- Towers ----------------------------------------------------------------
const TOWER_TYPES = {
    arrow: {
        name: 'Arrow', cost: 50, range: 96, damage: 8, rate: 1.4,
        shotSpeed: 320, splash: 0, slow: 0,
        body: '#8a6a44', head: '#d8b478', shot: '#ffe9a8',
    },
    frost: {
        name: 'Frost', cost: 75, range: 88, damage: 4, rate: 1.0,
        shotSpeed: 300, splash: 0, slow: 0.45,
        body: '#3d6f8c', head: '#8fe4ff', shot: '#d6f6ff',
    },
    cannon: {
        name: 'Cannon', cost: 100, range: 112, damage: 26, rate: 0.55,
        shotSpeed: 220, splash: 44, slow: 0,
        body: '#7d6a72', head: '#4a4048', shot: '#ffb45c',
    },
};
const SLOW_TIME = 1.5;         // seconds a frost hit lasts
const SPLASH_FALLOFF = 0.5;    // share of the damage neighbours take

// --- Creeps ----------------------------------------------------------------
const ENEMY_TYPES = {
    grunt: { name: 'Grunt', hp: 30, speed: 42, bounty: 8, leak: 1, r: 10, color: '#7fd36b', dark: '#3f7a34' },
    runner: { name: 'Runner', hp: 18, speed: 78, bounty: 6, leak: 1, r: 8, color: '#ffd95e', dark: '#a3831f' },
    tank: { name: 'Tank', hp: 120, speed: 26, bounty: 20, leak: 2, r: 12, color: '#9fb4c9', dark: '#4c6076' },
    boss: { name: 'Boss', hp: 450, speed: 30, bounty: 100, leak: 5, r: 15, color: '#d178ef', dark: '#6b2f80' },
};
const HP_SCALE_PER_WAVE = 0.25;
const SPAWN_GAP_BASE = 0.9;
const SPAWN_GAP_STEP = 0.02;
const SPAWN_GAP_MIN = 0.35;

// --- Mutable state ---------------------------------------------------------
let state = 'menu';            // menu | playing | paused | gameover | victory
let gold = START_GOLD;
let lives = START_LIVES;
let wave = 0;
let score = 0;
let best = 0;

let towers = [];
let enemies = [];
let projectiles = [];
let effects = [];

let waveActive = false;
let waveCountdown = WAVE_BREAK;
let spawnQueue = [];
let spawnTimer = 0;

let selectedType = 'arrow';
let selectedTower = null;
let hoverCol = -1;
let hoverRow = -1;

// --- Path construction -----------------------------------------------------
const pathNodes = PATH_POINTS.map((p) => ({ x: p.col * TILE + TILE / 2, y: p.row * TILE + TILE / 2 }));
const pathSegments = [];
let pathLength = 0;
for (let i = 0; i < pathNodes.length - 1; i++) {
    const a = pathNodes[i];
    const b = pathNodes[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    pathSegments.push({ a, b, len, start: pathLength, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
    pathLength += len;
}

// Rasterise the polyline into the set of tiles it covers; those tiles are road
// and cannot be built on.
const roadTiles = new Set();
for (let d = 0; d <= pathLength; d += 2) {
    const p = pathPointAt(d);
    roadTiles.add(`${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}`);
}

function pathPointAt(dist) {
    const d = Math.max(0, Math.min(pathLength, dist));
    for (const seg of pathSegments) {
        if (d <= seg.start + seg.len) {
            const t = d - seg.start;
            return { x: seg.a.x + seg.dx * t, y: seg.a.y + seg.dy * t };
        }
    }
    const last = pathNodes[pathNodes.length - 1];
    return { x: last.x, y: last.y };
}

function pathAngleAt(dist) {
    const d = Math.max(0, Math.min(pathLength, dist));
    for (const seg of pathSegments) {
        if (d <= seg.start + seg.len) return Math.atan2(seg.dy, seg.dx);
    }
    return 0;
}

function inGrid(col, row) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function isRoad(col, row) {
    return roadTiles.has(`${col},${row}`);
}

function towerAt(col, row) {
    return towers.find((t) => t.col === col && t.row === row) || null;
}

function isBuildable(col, row) {
    return inGrid(col, row) && !isRoad(col, row) && !towerAt(col, row);
}

// --- Waves -----------------------------------------------------------------
// Wave n brings 6 + 2n creeps: grunts, with runners mixed in from wave 3 and
// tanks from wave 5, plus a boss on every fifth wave.
function waveComposition(n) {
    const count = 6 + 2 * n;
    const list = [];
    for (let i = 0; i < count; i++) {
        if (n >= 5 && i % 4 === 3) list.push('tank');
        else if (n >= 3 && i % 2 === 1) list.push('runner');
        else list.push('grunt');
    }
    if (n % 5 === 0) list.push('boss');
    return list;
}

function hpScale() {
    return 1 + HP_SCALE_PER_WAVE * (Math.max(1, wave) - 1);
}

function spawnGap() {
    return Math.max(SPAWN_GAP_MIN, SPAWN_GAP_BASE - wave * SPAWN_GAP_STEP);
}

function startWave() {
    wave++;
    spawnQueue = waveComposition(wave);
    spawnTimer = 0;
    waveActive = true;
    waveCountdown = 0;
}

function endWave() {
    waveActive = false;
    const bonus = WAVE_BONUS_BASE + WAVE_BONUS_STEP * wave;
    gold += bonus;
    score += bonus;
    if (wave >= WAVE_COUNT) {
        win();
        return;
    }
    waveCountdown = WAVE_BREAK;
}

// --- Lifecycle -------------------------------------------------------------
function startGame() {
    state = 'playing';
    gold = START_GOLD;
    lives = START_LIVES;
    wave = 0;
    score = 0;
    towers = [];
    enemies = [];
    projectiles = [];
    effects = [];
    spawnQueue = [];
    spawnTimer = 0;
    waveActive = false;
    waveCountdown = WAVE_BREAK;
    selectedTower = null;
    hideOverlay();
    updateHud();
}

function gameOver() {
    state = 'gameover';
    saveBest();
    showOverlay('GAME OVER', `Wave ${wave} · Score ${score}`, 'Press Space to defend again');
}

function win() {
    state = 'victory';
    saveBest();
    showOverlay('VICTORY', `All ${WAVE_COUNT} waves held · Score ${score}`, 'Press Space to play again');
}

function saveBest() {
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* storage unavailable (private mode / file://) — keep the in-memory best */
        }
    }
    updateHud();
}

function loadBest() {
    try {
        best = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        best = 0;
    }
}

// --- Player actions --------------------------------------------------------
function placeTower(col, row, type) {
    const spec = TOWER_TYPES[type];
    if (!spec || !isBuildable(col, row) || gold < spec.cost) return false;
    gold -= spec.cost;
    towers.push({
        col, row,
        x: col * TILE + TILE / 2,
        y: row * TILE + TILE / 2,
        type,
        level: 1,
        damage: spec.damage,
        range: spec.range,
        rate: spec.rate,
        cooldown: 0,
        invested: spec.cost,
        shots: 0,
        angle: 0,
        recoil: 0,
    });
    updateHud();
    return true;
}

function upgradeCost(tower) {
    return Math.round(TOWER_TYPES[tower.type].cost * UPGRADE_COST_FACTOR * tower.level);
}

function sellValue(tower) {
    return Math.floor(tower.invested * SELL_REFUND);
}

function upgradeTower(tower) {
    if (!tower || tower.level >= MAX_LEVEL) return false;
    const cost = upgradeCost(tower);
    if (gold < cost) return false;
    gold -= cost;
    tower.invested += cost;
    tower.level++;
    tower.damage *= UPGRADE_DAMAGE;
    tower.range *= UPGRADE_RANGE;
    updateHud();
    return true;
}

function sellTower(tower) {
    const i = towers.indexOf(tower);
    if (i === -1) return false;
    gold += sellValue(tower);
    towers.splice(i, 1);
    if (selectedTower === tower) selectedTower = null;
    updateHud();
    return true;
}

// --- Creeps ----------------------------------------------------------------
function spawnEnemy(type, dist = 0) {
    const spec = ENEMY_TYPES[type] || ENEMY_TYPES.grunt;
    const hp = Math.round(spec.hp * hpScale());
    const p = pathPointAt(dist);
    const enemy = {
        type,
        x: p.x,
        y: p.y,
        dist: Math.max(0, dist),
        hp,
        maxHp: hp,
        speed: spec.speed,
        bounty: spec.bounty,
        leak: spec.leak,
        r: spec.r,
        slowTimer: 0,
        hitFlash: 0,
        wobble: 0,
    };
    enemies.push(enemy);
    return enemy;
}

function currentSpeed(enemy) {
    return enemy.slowTimer > 0 ? enemy.speed * (1 - TOWER_TYPES.frost.slow) : enemy.speed;
}

function damageEnemy(enemy, amount) {
    if (enemy.hp <= 0) return;
    enemy.hp -= amount;
    enemy.hitFlash = 0.12;
    if (enemy.hp <= 0) {
        enemy.hp = 0;
        gold += enemy.bounty;
        score += enemy.bounty;
        effects.push({ kind: 'text', x: enemy.x, y: enemy.y, life: 0.7, max: 0.7, text: `+${enemy.bounty}` });
        effects.push({ kind: 'pop', x: enemy.x, y: enemy.y, life: 0.3, max: 0.3, r: enemy.r });
    }
}

// --- Simulation ------------------------------------------------------------
function step(dt) {
    if (state !== 'playing') return;

    stepSpawning(dt);
    stepEnemies(dt);
    stepTowers(dt);
    stepProjectiles(dt);
    stepEffects(dt);

    if (waveActive && spawnQueue.length === 0 && enemies.length === 0) endWave();
    else if (!waveActive && state === 'playing') {
        waveCountdown -= dt;
        if (waveCountdown <= 0) startWave();
    }
}

function stepSpawning(dt) {
    if (!waveActive || spawnQueue.length === 0) return;
    spawnTimer -= dt;
    while (spawnTimer <= 0 && spawnQueue.length > 0) {
        spawnEnemy(spawnQueue.shift());
        spawnTimer += spawnGap();
    }
}

function stepEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.slowTimer > 0) e.slowTimer = Math.max(0, e.slowTimer - dt);
        if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);

        if (e.hp <= 0) {
            enemies.splice(i, 1);
            continue;
        }

        e.dist += currentSpeed(e) * dt;
        e.wobble += dt * 8;
        const p = pathPointAt(e.dist);
        e.x = p.x;
        e.y = p.y;

        if (e.dist >= pathLength) {
            enemies.splice(i, 1);
            lives -= e.leak;
            effects.push({ kind: 'leak', x: CANVAS_W - 20, y: p.y, life: 0.6, max: 0.6 });
            if (lives <= 0) {
                lives = 0;
                gameOver();
                return;
            }
        }
    }
}

// Classic "first" targeting: shoot whatever is furthest along the road.
function findTarget(tower) {
    let pick = null;
    for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (Math.hypot(e.x - tower.x, e.y - tower.y) > tower.range) continue;
        if (!pick || e.dist > pick.dist) pick = e;
    }
    return pick;
}

function stepTowers(dt) {
    for (const t of towers) {
        if (t.cooldown > 0) t.cooldown = Math.max(0, t.cooldown - dt);
        if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt);
        const target = findTarget(t);
        if (!target) continue;
        t.angle = Math.atan2(target.y - t.y, target.x - t.x);
        if (t.cooldown > 0) continue;
        fire(t, target);
    }
}

function fire(tower, target) {
    const spec = TOWER_TYPES[tower.type];
    tower.cooldown = 1 / tower.rate;
    tower.shots++;
    tower.recoil = 0.12;
    projectiles.push({
        x: tower.x,
        y: tower.y,
        target,
        speed: spec.shotSpeed,
        damage: tower.damage,
        splash: spec.splash,
        slow: spec.slow,
        type: tower.type,
        color: spec.shot,
        angle: tower.angle,
    });
}

function stepProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const targetGone = !p.target || p.target.hp <= 0 || !enemies.includes(p.target);

        if (targetGone) {
            // A shell still explodes where its target was; arrows and frost
            // bolts simply fizzle out.
            if (p.splash > 0) explode(p);
            projectiles.splice(i, 1);
            continue;
        }

        const dx = p.target.x - p.x;
        const dy = p.target.y - p.y;
        const d = Math.hypot(dx, dy);
        const move = p.speed * dt;
        p.angle = Math.atan2(dy, dx);

        if (d <= move + p.target.r) {
            p.x = p.target.x;
            p.y = p.target.y;
            impact(p);
            projectiles.splice(i, 1);
            continue;
        }
        p.x += (dx / d) * move;
        p.y += (dy / d) * move;
    }
}

function impact(p) {
    damageEnemy(p.target, p.damage);
    if (p.slow > 0) p.target.slowTimer = SLOW_TIME;
    if (p.splash > 0) explode(p);
}

function explode(p) {
    effects.push({ kind: 'blast', x: p.x, y: p.y, life: 0.25, max: 0.25, r: p.splash });
    for (const e of enemies) {
        if (e === p.target || e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > p.splash) continue;
        damageEnemy(e, p.damage * SPLASH_FALLOFF);
    }
}

function stepEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].life -= dt;
        if (effects[i].life <= 0) effects.splice(i, 1);
    }
}

// --- Rendering -------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function draw() {
    drawGround();
    drawRoad();
    drawHover();
    for (const t of towers) drawTower(t);
    for (const e of enemies) drawEnemy(e);
    for (const p of projectiles) drawProjectile(p);
    drawEffects();
    drawBanner();
}

function drawGround() {
    ctx.fillStyle = '#1b3327';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (isRoad(c, r)) continue;
            const tint = (c * 7 + r * 13) % 3;
            ctx.fillStyle = ['#1e3a2c', '#1b3427', '#20402f'][tint];
            ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
            if ((c + r) % 5 === 0) {
                ctx.fillStyle = 'rgba(120, 200, 150, 0.07)';
                ctx.fillRect(c * TILE + 8, r * TILE + 10, 4, 8);
                ctx.fillRect(c * TILE + 18, r * TILE + 18, 3, 6);
            }
        }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) {
        ctx.beginPath();
        ctx.moveTo(c * TILE + 0.5, 0);
        ctx.lineTo(c * TILE + 0.5, CANVAS_H);
        ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * TILE + 0.5);
        ctx.lineTo(CANVAS_W, r * TILE + 0.5);
        ctx.stroke();
    }
}

function drawRoad() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pathNodes[0].x, pathNodes[0].y);
    for (let i = 1; i < pathNodes.length; i++) ctx.lineTo(pathNodes[i].x, pathNodes[i].y);
    ctx.strokeStyle = '#3c3428';
    ctx.lineWidth = ROAD_W + 6;
    ctx.stroke();
    ctx.strokeStyle = '#6b5a41';
    ctx.lineWidth = ROAD_W;
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([8, 14]);
    ctx.strokeStyle = 'rgba(255, 236, 190, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Goal marker at the exit.
    const end = pathNodes[pathNodes.length - 1];
    ctx.fillStyle = 'rgba(239, 91, 76, 0.85)';
    ctx.fillRect(CANVAS_W - 8, end.y - ROAD_W / 2, 8, ROAD_W);
}

function drawHover() {
    if (state !== 'playing' || !inGrid(hoverCol, hoverRow)) return;
    const spec = TOWER_TYPES[selectedType];
    const existing = towerAt(hoverCol, hoverRow);
    if (existing) return;
    const ok = isBuildable(hoverCol, hoverRow) && gold >= spec.cost;
    const x = hoverCol * TILE;
    const y = hoverRow * TILE;
    ctx.fillStyle = ok ? 'rgba(255, 204, 77, 0.22)' : 'rgba(239, 91, 76, 0.25)';
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = ok ? 'rgba(255, 204, 77, 0.8)' : 'rgba(239, 91, 76, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
    if (ok) drawRange(x + TILE / 2, y + TILE / 2, spec.range, 'rgba(255, 204, 77, 0.45)');
}

function drawRange(x, y, range, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, range, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.fill();
    ctx.restore();
}

function drawTower(t) {
    const spec = TOWER_TYPES[t.type];
    if (t === selectedTower) drawRange(t.x, t.y, t.range, 'rgba(143, 228, 255, 0.6)');

    // Plinth
    ctx.fillStyle = '#243d31';
    roundRect(t.x - 13, t.y - 13, 26, 26, 6);
    ctx.fill();
    ctx.fillStyle = spec.body;
    roundRect(t.x - 10, t.y - 10, 20, 20, 5);
    ctx.fill();

    const kick = t.recoil > 0 ? 3 * (t.recoil / 0.12) : 0;
    ctx.save();
    ctx.translate(t.x - Math.cos(t.angle) * kick, t.y - Math.sin(t.angle) * kick);
    ctx.rotate(t.angle);
    ctx.fillStyle = spec.head;
    if (t.type === 'cannon') {
        roundRect(-4, -5, 18, 10, 3);
        ctx.fill();
        ctx.fillStyle = '#2b2429';
        ctx.fillRect(11, -4, 3, 8);
        ctx.fillStyle = spec.body;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.beginPath();
        ctx.arc(-2, -2, 3.5, 0, Math.PI * 2);
        ctx.fill();
    } else if (t.type === 'frost') {
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(0, -7);
        ctx.lineTo(-5, 0);
        ctx.lineTo(0, 7);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillRect(-2, -3, 14, 6);
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Level pips
    for (let i = 0; i < t.level; i++) {
        ctx.fillStyle = '#ffcc4d';
        ctx.fillRect(t.x - 9 + i * 7, t.y + 10, 5, 3);
    }
}

function drawEnemy(e) {
    const spec = ENEMY_TYPES[e.type];
    const bob = Math.sin(e.wobble) * 1.2;
    ctx.save();
    ctx.translate(e.x, e.y + bob);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, e.r * 0.75, e.r * 0.9, e.r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : spec.color;
    if (e.type === 'tank') {
        roundRect(-e.r, -e.r, e.r * 2, e.r * 2, 4);
        ctx.fill();
        ctx.fillStyle = spec.dark;
        ctx.fillRect(-e.r + 3, -3, e.r * 2 - 6, 6);
    } else if (e.type === 'runner') {
        ctx.beginPath();
        ctx.moveTo(e.r, 0);
        ctx.lineTo(-e.r, -e.r * 0.8);
        ctx.lineTo(-e.r * 0.4, 0);
        ctx.lineTo(-e.r, e.r * 0.8);
        ctx.closePath();
        ctx.fill();
    } else if (e.type === 'boss') {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const rr = i % 2 === 0 ? e.r : e.r * 0.72;
            ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = spec.dark;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.beginPath();
        ctx.arc(0, 0, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = spec.dark;
        ctx.beginPath();
        ctx.arc(e.r * 0.35, -e.r * 0.2, e.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
    }

    if (e.slowTimer > 0) {
        ctx.fillStyle = 'rgba(143, 228, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 2, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    // Health bar — only once a creep has actually been hurt, so a wave of
    // untouched creeps does not bury the map in green pips.
    const frac = Math.max(0, e.hp / e.maxHp);
    if (frac >= 1) return;
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w, 4);
    ctx.fillStyle = frac > 0.5 ? '#7fd36b' : frac > 0.25 ? '#ffd95e' : '#ef5b4c';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w * frac, 4);
}

function drawProjectile(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.color;
    if (p.type === 'cannon') {
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
    } else if (p.type === 'frost') {
        ctx.fillRect(-4, -2, 8, 4);
    } else {
        ctx.fillRect(-6, -1.5, 12, 3);
    }
    ctx.restore();
}

function drawEffects() {
    for (const fx of effects) {
        const t = fx.life / fx.max;
        if (fx.kind === 'blast') {
            ctx.strokeStyle = `rgba(255, 180, 92, ${t})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, fx.r * (1.15 - t * 0.5), 0, Math.PI * 2);
            ctx.stroke();
        } else if (fx.kind === 'pop') {
            ctx.strokeStyle = `rgba(255, 255, 255, ${t * 0.8})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, fx.r * (2 - t), 0, Math.PI * 2);
            ctx.stroke();
        } else if (fx.kind === 'text') {
            ctx.fillStyle = `rgba(255, 204, 77, ${t})`;
            ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(fx.text, fx.x, fx.y - 14 - (1 - t) * 14);
        } else if (fx.kind === 'leak') {
            ctx.fillStyle = `rgba(239, 91, 76, ${t * 0.8})`;
            ctx.fillRect(CANVAS_W - 10, fx.y - ROAD_W / 2, 10, ROAD_W);
        }
    }
}

function drawBanner() {
    ctx.textAlign = 'center';
    if (state === 'paused') {
        ctx.fillStyle = 'rgba(6, 12, 10, 0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#ffcc4d';
        ctx.font = 'bold 28px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('PAUSED', CANVAS_W / 2, CANVAS_H / 2);
        return;
    }
    if (state !== 'playing') return;
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    if (!waveActive) {
        ctx.fillStyle = 'rgba(230, 245, 236, 0.85)';
        ctx.fillText(
            `Wave ${wave + 1} in ${Math.ceil(waveCountdown)}s — press Space to call it early`,
            CANVAS_W / 2, CANVAS_H - 14
        );
    } else {
        ctx.fillStyle = 'rgba(230, 245, 236, 0.6)';
        const left = enemies.length + spawnQueue.length;
        ctx.fillText(`Wave ${wave} — ${left} creep${left === 1 ? '' : 's'} left`, CANVAS_W / 2, CANVAS_H - 14);
    }
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// --- DOM / HUD -------------------------------------------------------------
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnUpgrade = document.getElementById('btn-upgrade');
const btnSell = document.getElementById('btn-sell');
const shopButtons = Array.from(document.querySelectorAll('.shop-btn[data-type]'));

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function updateHud() {
    document.getElementById('gold').textContent = String(gold);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('wave').textContent = `${wave}/${WAVE_COUNT}`;
    document.getElementById('score').textContent = String(score);
    document.getElementById('best').textContent = String(best);

    for (const btn of shopButtons) {
        btn.classList.toggle('selected', btn.dataset.type === selectedType);
        btn.disabled = gold < TOWER_TYPES[btn.dataset.type].cost;
    }

    const t = selectedTower;
    const canUpgrade = !!t && t.level < MAX_LEVEL && gold >= upgradeCost(t);
    btnUpgrade.disabled = !canUpgrade;
    document.getElementById('upgrade-cost').textContent =
        t ? (t.level >= MAX_LEVEL ? 'MAX' : `${upgradeCost(t)}g`) : '—';
    btnSell.disabled = !t;
    document.getElementById('sell-value').textContent = t ? `+${sellValue(t)}g` : '—';
}

// --- Input -----------------------------------------------------------------
function tileFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

canvas.addEventListener('mousemove', (ev) => {
    const { col, row } = tileFromEvent(ev);
    hoverCol = col;
    hoverRow = row;
});

canvas.addEventListener('mouseleave', () => {
    hoverCol = -1;
    hoverRow = -1;
});

canvas.addEventListener('click', (ev) => {
    if (state !== 'playing') return;
    const { col, row } = tileFromEvent(ev);
    if (!inGrid(col, row)) return;
    const existing = towerAt(col, row);
    if (existing) {
        selectedTower = existing === selectedTower ? null : existing;
        updateHud();
        return;
    }
    selectedTower = null;
    placeTower(col, row, selectedType);
    updateHud();
});

for (const btn of shopButtons) {
    btn.addEventListener('click', () => {
        selectedType = btn.dataset.type;
        updateHud();
    });
}

btnUpgrade.addEventListener('click', () => upgradeTower(selectedTower));
btnSell.addEventListener('click', () => sellTower(selectedTower));
document.getElementById('btn-start').addEventListener('click', () => startGame());

window.addEventListener('keydown', (ev) => {
    const key = ev.key;
    if (key === ' ' || key === 'Spacebar') {
        ev.preventDefault();
        if (state === 'playing') {
            if (!waveActive) startWave();
        } else if (state !== 'paused') {
            startGame();
        }
        return;
    }
    if (key === '1' || key === '2' || key === '3') {
        selectedType = ['arrow', 'frost', 'cannon'][Number(key) - 1];
        updateHud();
        return;
    }
    if (key === 'p' || key === 'P') {
        if (state === 'playing') state = 'paused';
        else if (state === 'paused') state = 'playing';
        return;
    }
    if (key === 'u' || key === 'U') {
        upgradeTower(selectedTower);
        return;
    }
    if (key === 's' || key === 'S') {
        sellTower(selectedTower);
        return;
    }
    if (key === 'Escape') {
        selectedTower = null;
        updateHud();
    }
});

// --- Main loop -------------------------------------------------------------
let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
    lastTime = now;
    step(dt);
    draw();
    updateHud();
    requestAnimationFrame(frame);
}

loadBest();
updateHud();
draw();
requestAnimationFrame(frame);
