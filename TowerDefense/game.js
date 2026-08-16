// ---------------------------------------------------------------------------
// Tower Defense — build gun emplacements beside a fixed creep road and stop
// twelve waves of walkers before they march off the right-hand edge.
//
// The map is a 18x12 grid of 40px tiles. A single road is described by a list
// of axis-aligned waypoints; every tile the road passes through is blocked for
// building, everything else is open ground. Enemies walk waypoint to waypoint,
// towers acquire the enemy furthest along the road inside their range circle
// and lob homing projectiles at it.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Slime Volley,
// Kaboom and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate whole waves deterministically
// without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Map geometry ---
const TILE = 40;
const COLS = 18;
const ROWS = 12;
const CANVAS_W = COLS * TILE;   // 720
const CANVAS_H = ROWS * TILE;   // 480

// The road, in tile coordinates. The first waypoint sits off the left edge and
// the last off the right edge so creeps walk on and off screen. Every leg is
// axis aligned, which keeps the "which tiles are road" question trivial.
const WAYPOINTS = [
    { c: -1, r: 1 },
    { c: 3, r: 1 },
    { c: 3, r: 5 },
    { c: 8, r: 5 },
    { c: 8, r: 2 },
    { c: 12, r: 2 },
    { c: 12, r: 8 },
    { c: 5, r: 8 },
    { c: 5, r: 10 },
    { c: 15, r: 10 },
    { c: 15, r: 5 },
    { c: 18, r: 5 },
];

// Tile centre in pixels.
const tileX = (c) => c * TILE + TILE / 2;
const tileY = (r) => r * TILE + TILE / 2;

// The same road expressed in pixels — this is what enemies actually walk.
const PATH_PX = WAYPOINTS.map((p) => ({ x: tileX(p.c), y: tileY(p.r) }));

// Every in-grid tile the road passes through, as a set of "c,r" keys.
const PATH_TILES = (() => {
    const tiles = new Set();
    const add = (c, r) => {
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) tiles.add(c + ',' + r);
    };
    for (let i = 1; i < WAYPOINTS.length; i++) {
        const a = WAYPOINTS[i - 1];
        const b = WAYPOINTS[i];
        const stepC = Math.sign(b.c - a.c);
        const stepR = Math.sign(b.r - a.r);
        let c = a.c;
        let r = a.r;
        add(c, r);
        while (c !== b.c || r !== b.r) {
            c += stepC;
            r += stepR;
            add(c, r);
        }
    }
    return tiles;
})();

// --- Towers ---
const MAX_LEVEL = 3;
const SELL_RATE = 0.6;          // fraction of gold sunk into a tower you get back
const DAMAGE_PER_LEVEL = 0.3;   // +30% damage per level above 1
const RANGE_PER_LEVEL = 0.1;    // +10% range per level above 1

const TOWER_TYPES = {
    arrow: {
        name: 'Arrow',
        cost: 50,
        range: 110,
        damage: 8,
        rate: 2.0,              // shots per second
        projSpeed: 420,
        color: '#6fd0f2',
    },
    cannon: {
        name: 'Cannon',
        cost: 90,
        range: 100,
        damage: 26,
        rate: 0.7,
        projSpeed: 300,
        splash: 40,             // blast radius in px
        color: '#f2a05a',
    },
    frost: {
        name: 'Frost',
        cost: 70,
        range: 95,
        damage: 4,
        rate: 1.1,
        projSpeed: 340,
        slow: 0.45,             // slowed creeps walk at 45% speed
        slowTime: 1.6,
        color: '#9db8ff',
    },
};

const BUILD_KEYS = ['arrow', 'cannon', 'frost'];
const SLOW_FACTOR = TOWER_TYPES.frost.slow;

// --- Enemies ---
const ENEMY_TYPES = {
    grunt: { name: 'Grunt', hp: 26, speed: 55, reward: 6, leak: 1, radius: 11, color: '#e2685f' },
    runner: { name: 'Runner', hp: 15, speed: 105, reward: 5, leak: 1, radius: 9, color: '#f0d264' },
    tank: { name: 'Tank', hp: 95, speed: 38, reward: 16, leak: 2, radius: 14, color: '#8f6fd8' },
    boss: { name: 'Boss', hp: 700, speed: 30, reward: 70, leak: 5, radius: 18, color: '#d94fa0' },
};

const HP_GROWTH = 0.5;          // creep hp scales +50% of base per wave

// --- Waves ---
// Each group spawns `count` creeps `interval` seconds apart, starting `delay`
// seconds into the wave.
const WAVES = [
    { groups: [{ type: 'grunt', count: 6, interval: 0.9, delay: 0 }] },
    { groups: [{ type: 'grunt', count: 8, interval: 0.8, delay: 0 }] },
    {
        groups: [
            { type: 'grunt', count: 6, interval: 0.8, delay: 0 },
            { type: 'runner', count: 4, interval: 0.6, delay: 6 },
        ],
    },
    { groups: [{ type: 'runner', count: 10, interval: 0.5, delay: 0 }] },
    {
        groups: [
            { type: 'grunt', count: 6, interval: 0.7, delay: 0 },
            { type: 'tank', count: 3, interval: 2.0, delay: 5 },
        ],
    },
    { groups: [{ type: 'grunt', count: 14, interval: 0.45, delay: 0 }] },
    {
        groups: [
            { type: 'runner', count: 12, interval: 0.35, delay: 0 },
            { type: 'tank', count: 2, interval: 2.0, delay: 6 },
        ],
    },
    { groups: [{ type: 'tank', count: 6, interval: 1.3, delay: 0 }] },
    {
        groups: [
            { type: 'grunt', count: 10, interval: 0.5, delay: 0 },
            { type: 'runner', count: 8, interval: 0.4, delay: 4 },
        ],
    },
    {
        groups: [
            { type: 'grunt', count: 8, interval: 0.6, delay: 0 },
            { type: 'boss', count: 1, interval: 1, delay: 4 },
        ],
    },
    {
        groups: [
            { type: 'tank', count: 6, interval: 1.2, delay: 0 },
            { type: 'runner', count: 10, interval: 0.35, delay: 5 },
        ],
    },
    {
        groups: [
            { type: 'runner', count: 10, interval: 0.3, delay: 0 },
            { type: 'tank', count: 4, interval: 1.2, delay: 4 },
            { type: 'boss', count: 2, interval: 6, delay: 10 },
        ],
    },
];

// --- Match rules ---
const START_LIVES = 20;
const START_MONEY = 150;
const BEST_KEY = 'tower-defense-best';

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const livesEl = document.getElementById('lives');
const moneyEl = document.getElementById('money');
const waveEl = document.getElementById('wave');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const towerPanel = document.getElementById('tower-panel');
const towerInfo = document.getElementById('tower-info');
const btnUpgrade = document.getElementById('btn-upgrade');
const btnSell = document.getElementById('btn-sell');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over' | 'won'
let state = 'idle';
let lives = START_LIVES;
let money = START_MONEY;
let score = 0;
let wave = 0;
let bestWave = 0;
let waveActive = false;
let waveTimer = 0;
let selectedType = null;        // tower type queued for building
let selectedTower = null;       // an already-built tower being inspected
let hover = null;               // { c, r } under the mouse

let enemies = [];
let towers = [];
let projectiles = [];
let effects = [];               // short-lived hit sparks / gold pops

// ---------------------------------------------------------------------------
// Map helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

function inGrid(c, r) {
    return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

function towerAt(c, r) {
    return towers.find((t) => t.c === c && t.r === r) || null;
}

function isBuildable(c, r) {
    if (!inGrid(c, r)) return false;
    if (PATH_TILES.has(c + ',' + r)) return false;
    return towerAt(c, r) === null;
}

// The first open tile scanning column by column — a stable spot for tests and
// for the "where do I even start" hint.
function firstBuildableTile() {
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) if (isBuildable(c, r)) return { c, r };
    }
    return null;
}

// Walk `d` pixels along the road and report where you end up.
function pointAtDistance(d) {
    let remaining = d;
    for (let i = 1; i < PATH_PX.length; i++) {
        const a = PATH_PX[i - 1];
        const b = PATH_PX[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (remaining <= len) {
            const t = len === 0 ? 0 : remaining / len;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        }
        remaining -= len;
    }
    return { ...PATH_PX[PATH_PX.length - 1] };
}

// Open tile closest to the road a short way in from the entrance — where a
// first tower naturally goes (and where the tests plant one).
function buildableNearPathStart() {
    const aim = pointAtDistance(250);
    let best = null;
    let bestD = Infinity;
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            if (!isBuildable(c, r)) continue;
            const d = dist2(tileX(c), tileY(r), aim.x, aim.y);
            if (d < bestD) {
                bestD = d;
                best = { c, r };
            }
        }
    }
    return best;
}

// Open tile as far from the entrance as possible — nothing shoots from here
// for a long while.
function farBuildableTile() {
    const start = PATH_PX[0];
    let best = null;
    let bestD = -1;
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            if (!isBuildable(c, r)) continue;
            const d = dist2(tileX(c), tileY(r), start.x, start.y);
            if (d > bestD) {
                bestD = d;
                best = { c, r };
            }
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

function towerDamage(t) {
    return TOWER_TYPES[t.type].damage * (1 + DAMAGE_PER_LEVEL * (t.level - 1));
}

function towerRange(t) {
    return TOWER_TYPES[t.type].range * (1 + RANGE_PER_LEVEL * (t.level - 1));
}

function upgradeCost(t) {
    return Math.floor(TOWER_TYPES[t.type].cost * 0.8 * t.level);
}

function sellValue(t) {
    return Math.floor(t.invested * SELL_RATE);
}

function placeTower(type, c, r) {
    const spec = TOWER_TYPES[type];
    if (!spec) return false;
    if (state === 'over' || state === 'won') return false;
    if (!isBuildable(c, r)) return false;
    if (money < spec.cost) return false;

    money -= spec.cost;
    towers.push({
        type,
        c,
        r,
        x: tileX(c),
        y: tileY(r),
        level: 1,
        cooldown: 0,
        invested: spec.cost,
        kills: 0,
        angle: 0,
        flash: 0,
    });
    updateHud();
    return true;
}

function selectTowerType(type) {
    selectedType = TOWER_TYPES[type] ? type : null;
    if (selectedType) selectedTower = null;
    refreshShop();
}

function selectTowerAt(c, r) {
    selectedTower = towerAt(c, r);
    if (selectedTower) selectedType = null;
    refreshShop();
    return selectedTower;
}

function upgradeSelected() {
    const t = selectedTower;
    if (!t || t.level >= MAX_LEVEL) return false;
    const cost = upgradeCost(t);
    if (money < cost) return false;
    money -= cost;
    t.invested += cost;
    t.level += 1;
    updateHud();
    refreshShop();
    return true;
}

function sellSelected() {
    const t = selectedTower;
    if (!t) return false;
    const idx = towers.indexOf(t);
    if (idx === -1) return false;
    towers.splice(idx, 1);
    money += sellValue(t);
    selectedTower = null;
    updateHud();
    refreshShop();
    return true;
}

// Targeting: the enemy inside the range circle that has walked furthest, so
// towers concentrate on whatever is about to leak.
function acquireTarget(t) {
    const range = towerRange(t);
    const r2 = range * range;
    let best = null;
    for (const e of enemies) {
        if (!e.alive) continue;
        if (dist2(e.x, e.y, t.x, t.y) > r2) continue;
        if (!best || e.dist > best.dist) best = e;
    }
    return best;
}

function fire(t, target) {
    const spec = TOWER_TYPES[t.type];
    projectiles.push({
        x: t.x,
        y: t.y,
        tx: target.x,
        ty: target.y,
        target,
        speed: spec.projSpeed,
        damage: towerDamage(t),
        splash: spec.splash || 0,
        slow: spec.slow || 0,
        slowTime: spec.slowTime || 0,
        color: spec.color,
        life: 3,
        source: t,
    });
    t.cooldown = 1 / spec.rate;
    t.flash = 0.08;
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
}

function updateTowers(dt) {
    for (const t of towers) {
        if (t.flash > 0) t.flash -= dt;
        t.cooldown -= dt;
        if (t.cooldown > 0) continue;
        const target = acquireTarget(t);
        if (target) fire(t, target);
        else t.cooldown = 0;
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function enemyHp(type, forWave) {
    return Math.round(ENEMY_TYPES[type].hp * (1 + (forWave - 1) * HP_GROWTH));
}

function spawnEnemy(type, forWave) {
    const spec = ENEMY_TYPES[type];
    const e = {
        type,
        x: PATH_PX[0].x,
        y: PATH_PX[0].y,
        wp: 1,
        dist: 0,
        hp: enemyHp(type, forWave),
        maxHp: enemyHp(type, forWave),
        speed: spec.speed,
        reward: spec.reward,
        leak: spec.leak,
        radius: spec.radius,
        color: spec.color,
        slowT: 0,
        alive: true,
        wobble: enemies.length * 0.7,
    };
    enemies.push(e);
    return e;
}

function damageEnemy(e, amount) {
    if (!e.alive) return;
    e.hp -= amount;
    if (e.hp <= 0) {
        e.alive = false;
        money += e.reward;
        score += e.reward;
        effects.push({ x: e.x, y: e.y, t: 0, life: 0.6, text: '+' + e.reward, kind: 'gold' });
    }
}

function explodeAt(x, y, damage, radius) {
    const r2 = radius * radius;
    for (const e of enemies) {
        if (!e.alive) continue;
        if (dist2(e.x, e.y, x, y) <= r2) damageEnemy(e, damage);
    }
    effects.push({ x, y, t: 0, life: 0.3, kind: 'blast', radius });
}

function leak(e) {
    e.alive = false;
    lives = Math.max(0, lives - e.leak);
    effects.push({ x: CANVAS_W - 20, y: e.y, t: 0, life: 0.6, text: '-' + e.leak, kind: 'leak' });
    if (lives <= 0) gameOver();
}

// Walk an enemy `travel` pixels along the road, hopping waypoints as it goes.
function advance(e, travel) {
    let remaining = travel;
    while (remaining > 0 && e.wp < PATH_PX.length) {
        const t = PATH_PX[e.wp];
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        const d = Math.hypot(dx, dy);
        if (d <= remaining) {
            e.x = t.x;
            e.y = t.y;
            e.dist += d;
            remaining -= d;
            e.wp += 1;
        } else {
            e.x += (dx / d) * remaining;
            e.y += (dy / d) * remaining;
            e.dist += remaining;
            remaining = 0;
        }
    }
    if (e.wp >= PATH_PX.length) leak(e);
}

function updateEnemies(dt) {
    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.slowT > 0) e.slowT -= dt;
        const speed = e.speed * (e.slowT > 0 ? SLOW_FACTOR : 1);
        advance(e, speed * dt);
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (!enemies[i].alive) enemies.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

function hitWith(p) {
    if (p.splash) {
        explodeAt(p.tx, p.ty, p.damage, p.splash);
    } else if (p.target && p.target.alive) {
        damageEnemy(p.target, p.damage);
        if (p.slow) p.target.slowT = Math.max(p.target.slowT, p.slowTime);
        effects.push({ x: p.tx, y: p.ty, t: 0, life: 0.2, kind: 'spark', color: p.color });
    }
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.life -= dt;
        if (p.target && p.target.alive) {
            p.tx = p.target.x;
            p.ty = p.target.y;
        }
        const dx = p.tx - p.x;
        const dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const move = p.speed * dt;
        if (d <= move) {
            p.x = p.tx;
            p.y = p.ty;
            hitWith(p);
            projectiles.splice(i, 1);
        } else {
            p.x += (dx / d) * move;
            p.y += (dy / d) * move;
            if (p.life <= 0) projectiles.splice(i, 1);
        }
    }
}

function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].t += dt;
        if (effects[i].t >= effects[i].life) effects.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

let spawnQueue = [];

function beginWave() {
    spawnQueue = [];
    waveTimer = 0;
    for (const g of WAVES[wave - 1].groups) {
        for (let i = 0; i < g.count; i++) {
            spawnQueue.push({ type: g.type, at: g.delay + i * g.interval });
        }
    }
    spawnQueue.sort((a, b) => a.at - b.at);
    waveActive = true;
    updateHud();
}

function startNextWave() {
    if (state !== 'running' || waveActive) return false;
    if (wave >= WAVES.length) return false;
    wave += 1;
    beginWave();
    return true;
}

function updateSpawns(dt) {
    if (!waveActive) return;
    waveTimer += dt;
    while (spawnQueue.length && spawnQueue[0].at <= waveTimer) {
        const next = spawnQueue.shift();
        spawnEnemy(next.type, wave);
    }
}

function checkWaveComplete() {
    if (!waveActive) return;
    if (spawnQueue.length || enemies.length) return;
    waveActive = false;
    const bonus = 12 + wave * 3;
    money += bonus;
    score += bonus;
    effects.push({ x: CANVAS_W / 2, y: 60, t: 0, life: 1.2, text: 'WAVE CLEAR +' + bonus, kind: 'gold' });
    if (wave >= WAVES.length) winGame();
    else showBetweenWaves();
}

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------

function recordBest() {
    if (wave > bestWave) {
        bestWave = wave;
        try {
            localStorage.setItem(BEST_KEY, String(bestWave));
        } catch (err) {
            /* storage unavailable (private mode / file://) — best is session only */
        }
    }
}

function startGame() {
    state = 'running';
    lives = START_LIVES;
    money = START_MONEY;
    score = 0;
    wave = 1;
    enemies = [];
    towers = [];
    projectiles = [];
    effects = [];
    selectedType = null;
    selectedTower = null;
    beginWave();
    hideOverlay();
    refreshShop();
    updateHud();
}

function gameOver() {
    state = 'over';
    recordBest();
    showOverlay('GAME OVER', 'The keep fell on wave ' + wave + ' · Score ' + score,
        'Press Space or click Start to try again');
    updateHud();
}

function winGame() {
    state = 'won';
    recordBest();
    showOverlay('VICTORY', 'All ' + WAVES.length + ' waves held · Score ' + score,
        'Press Space or click Start to play again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
    } else if (state === 'paused') {
        state = 'running';
    }
}

function step(dt, force) {
    if (!force && state !== 'running') return;
    updateSpawns(dt);
    updateEnemies(dt);
    if (state === 'over' && !force) {
        updateHud();
        return;
    }
    updateTowers(dt);
    updateProjectiles(dt);
    updateEffects(dt);
    checkWaveComplete();
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD / overlay / shop chrome
// ---------------------------------------------------------------------------

function updateHud() {
    livesEl.textContent = String(lives);
    moneyEl.textContent = String(money);
    waveEl.textContent = wave + '/' + WAVES.length;
    scoreEl.textContent = String(score);
    bestEl.textContent = String(bestWave);
}

function showOverlay(title, sub, hint) {
    overlayTitle.textContent = title;
    overlayScore.textContent = sub;
    overlaySub.textContent = hint;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function showBetweenWaves() {
    // Between waves the board stays live (projectiles finish, towers can be
    // built and sold); the prompt lives on the canvas rather than the overlay.
}

function refreshShop() {
    for (const type of BUILD_KEYS) {
        const btn = document.getElementById('build-' + type);
        btn.classList.toggle('selected', selectedType === type);
    }
    if (selectedTower) {
        const t = selectedTower;
        const spec = TOWER_TYPES[t.type];
        const upgrade = t.level < MAX_LEVEL ? 'Upgrade (' + upgradeCost(t) + 'g)' : 'Max level';
        towerInfo.textContent =
            spec.name + ' Lv' + t.level +
            ' · dmg ' + Math.round(towerDamage(t)) +
            ' · rng ' + Math.round(towerRange(t));
        btnUpgrade.textContent = upgrade;
        btnUpgrade.disabled = t.level >= MAX_LEVEL;
        btnSell.textContent = 'Sell (+' + sellValue(t) + 'g)';
        towerPanel.classList.add('visible');
    } else {
        towerPanel.classList.remove('visible');
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawMap() {
    ctx.fillStyle = '#132018';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Open ground: a subtle checker so the grid reads without harsh lines.
    for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
            if (PATH_TILES.has(c + ',' + r)) continue;
            ctx.fillStyle = (c + r) % 2 === 0 ? '#17281d' : '#152419';
            ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        }
    }

    // The road, drawn as a fat stroke down the waypoints.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3a3327';
    ctx.lineWidth = TILE - 2;
    ctx.beginPath();
    ctx.moveTo(PATH_PX[0].x, PATH_PX[0].y);
    for (let i = 1; i < PATH_PX.length; i++) ctx.lineTo(PATH_PX[i].x, PATH_PX[i].y);
    ctx.stroke();
    ctx.strokeStyle = '#4a4133';
    ctx.lineWidth = TILE - 12;
    ctx.stroke();

    // Entrance and exit markers.
    ctx.fillStyle = 'rgba(226, 104, 95, 0.75)';
    ctx.fillRect(0, PATH_PX[0].y - TILE / 2 + 2, 5, TILE - 4);
    ctx.fillStyle = 'rgba(143, 214, 168, 0.75)';
    const exitY = PATH_PX[PATH_PX.length - 1].y;
    ctx.fillRect(CANVAS_W - 5, exitY - TILE / 2 + 2, 5, TILE - 4);
}

function drawBuildHint() {
    if (!hover) return;
    const { c, r } = hover;
    if (!inGrid(c, r)) return;
    if (selectedType) {
        const ok = isBuildable(c, r) && money >= TOWER_TYPES[selectedType].cost;
        ctx.fillStyle = ok ? 'rgba(143, 214, 168, 0.22)' : 'rgba(226, 104, 95, 0.22)';
        ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        if (ok) {
            ctx.strokeStyle = 'rgba(143, 214, 168, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(tileX(c), tileY(r), TOWER_TYPES[selectedType].range, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

function drawTower(t) {
    const spec = TOWER_TYPES[t.type];
    const x = t.x;
    const y = t.y;

    // Base plate, with a drop shadow so towers sit above the ground.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(x - 14, y - 11, 29, 28);
    ctx.fillStyle = '#26332c';
    ctx.fillRect(x - 15, y - 15, 30, 30);
    ctx.fillStyle = '#31413a';
    ctx.fillRect(x - 13, y - 13, 26, 26);

    // Turret dome in the tower's colour.
    ctx.fillStyle = spec.color;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(x, y, 10, Math.PI * 0.15, Math.PI * 0.85);
    ctx.fill();

    // Barrel pointing at whatever it last shot.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t.angle);
    ctx.fillStyle = t.flash > 0 ? '#fff2c4' : '#dfe7f2';
    ctx.fillRect(2, -3, 18, 6);
    ctx.restore();

    // Level pips along the bottom edge of the plate.
    for (let i = 0; i < MAX_LEVEL; i++) {
        ctx.fillStyle = i < t.level ? '#ffd479' : 'rgba(255, 255, 255, 0.15)';
        ctx.fillRect(x - 9 + i * 7, y + 10, 5, 3);
    }

    if (selectedTower === t) {
        ctx.strokeStyle = 'rgba(143, 214, 168, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 17, y - 17, 34, 34);
        ctx.strokeStyle = 'rgba(143, 214, 168, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, towerRange(t), 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawEnemy(e) {
    const frac = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();

    if (e.slowT > 0) {
        ctx.strokeStyle = 'rgba(157, 184, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius + 3, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, e.radius * 2, 4);
    ctx.fillStyle = frac > 0.5 ? '#7fd48f' : frac > 0.25 ? '#f0d264' : '#e2685f';
    ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, e.radius * 2 * frac, 4);
}

function drawEffects() {
    for (const fx of effects) {
        const k = fx.t / fx.life;
        if (fx.kind === 'blast') {
            ctx.strokeStyle = 'rgba(242, 160, 90, ' + (1 - k).toFixed(3) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, fx.radius * (0.4 + 0.6 * k), 0, Math.PI * 2);
            ctx.stroke();
        } else if (fx.kind === 'spark') {
            ctx.fillStyle = fx.color || '#fff';
            ctx.globalAlpha = 1 - k;
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, 4 * (1 - k) + 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = fx.kind === 'leak' ? 'rgba(226, 104, 95, ' : 'rgba(255, 212, 121, ';
            ctx.fillStyle += (1 - k).toFixed(3) + ')';
            ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(fx.text, fx.x, fx.y - 14 - k * 14);
            ctx.textAlign = 'left';
        }
    }
}

function drawBanner() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
    if (state === 'paused') {
        ctx.fillStyle = 'rgba(8, 12, 18, 0.6)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#e6edf7';
        ctx.font = 'bold 30px "Segoe UI", system-ui, sans-serif';
        ctx.fillText('PAUSED', CANVAS_W / 2, CANVAS_H / 2);
    } else if (state === 'running' && !waveActive) {
        ctx.fillStyle = 'rgba(143, 214, 168, 0.9)';
        ctx.fillText(
            wave >= WAVES.length ? 'Final wave held' : 'Press Space to send wave ' + (wave + 1),
            CANVAS_W / 2,
            CANVAS_H - 16,
        );
    }
    ctx.textAlign = 'left';
}

function draw() {
    drawMap();
    drawBuildHint();
    for (const t of towers) drawTower(t);
    for (const e of enemies) drawEnemy(e);
    for (const p of projectiles) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.splash ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
    }
    drawEffects();
    drawBanner();
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05;   // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (evt.clientX - rect.left) * (canvas.width / rect.width),
        y: (evt.clientY - rect.top) * (canvas.height / rect.height),
    };
}

function handleClick(x, y) {
    const c = Math.floor(x / TILE);
    const r = Math.floor(y / TILE);
    if (!inGrid(c, r)) return;
    const existing = towerAt(c, r);
    if (existing) {
        selectTowerAt(c, r);
        return;
    }
    if (selectedType && isBuildable(c, r)) {
        placeTower(selectedType, c, r);
        refreshShop();
        return;
    }
    selectedTower = null;
    refreshShop();
}

canvas.addEventListener('click', (evt) => {
    const p = canvasPoint(evt);
    handleClick(p.x, p.y);
});

canvas.addEventListener('mousemove', (evt) => {
    const p = canvasPoint(evt);
    hover = { c: Math.floor(p.x / TILE), r: Math.floor(p.y / TILE) };
});

canvas.addEventListener('mouseleave', () => {
    hover = null;
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') {
            togglePause();
            e.preventDefault();
        }
        return;
    }
    if (e.key === 'Escape') {
        selectedType = null;
        selectedTower = null;
        refreshShop();
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over' || state === 'won') startGame();
        else if (state === 'running') startNextWave();
        e.preventDefault();
        return;
    }
    if (e.key >= '1' && e.key <= String(BUILD_KEYS.length)) {
        selectTowerType(BUILD_KEYS[Number(e.key) - 1]);
        e.preventDefault();
    }
});

for (const type of BUILD_KEYS) {
    document.getElementById('build-' + type).addEventListener('click', () => {
        selectTowerType(selectedType === type ? null : type);
    });
}

btnUpgrade.addEventListener('click', () => upgradeSelected());
btnSell.addEventListener('click', () => sellSelected());
btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else if (state === 'running') startNextWave();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

try {
    bestWave = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
} catch (err) {
    bestWave = 0;
}
updateHud();
refreshShop();
requestAnimationFrame(frame);
