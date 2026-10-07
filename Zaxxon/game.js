// Zaxxon — fly an isometric fortress where altitude is both your aim and your
// armour. A bullet keeps the height it was fired at, so hitting a gun bolted to
// the deck means descending into the layer that can kill you.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, ship, objects, bullets, enemyShots) is kept
// at the top level on purpose: the Playwright suite drives the game through
// exactly these names. See DESIGN.md for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 480
const H = canvas.height;             // 640
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- world -----------------------------------------------------------------

const FIELD_W = 200;                 // width of the fortress deck, world units
const MAX_ALT = 90;                  // ceiling; alt 0 is skimming the deck
const VIEW_DEPTH = 520;              // how far ahead the world is drawn
const CULL_Z = -60;                  // objects behind this are forgotten
const DECK_Z0 = -70;                 // the deck is drawn from behind the ship

// --- projection ------------------------------------------------------------

const ORIGIN_X = 40;                 // screen x of the deck's left edge at z = 0
const NEAR_Y = 560;                  // screen y of the deck at z = 0
const SKEW_X = 0.4;                  // screen px right per unit of depth
const DEPTH_Y = 0.62;                // screen px up per unit of depth
const ALT_Y = 1.5;                   // screen px up per unit of altitude

// --- ship ------------------------------------------------------------------

const SHIP_HALF = 10;                // half span, used for clamping and walls
const SHIP_THICK = 6;                // half height, used for collisions
const SHIP_SPEED = 120;              // units/s across the deck
const ALT_SPEED = 55;                // units/s climbing or diving

// --- guns ------------------------------------------------------------------

const BULLET_SPEED = 420;            // units/s forward
const MAX_BULLETS = 3;
const FIRE_COOLDOWN = 0.18;          // seconds between shots
const BULLET_Z0 = 8;                 // depth a shot starts at
const HIT_Z = 16;                    // depth tolerance of a hit
const HIT_PAD = 4;                   // lateral / vertical tolerance of a hit

// --- enemies ---------------------------------------------------------------

const SHOT_SPEED = 220;              // units/s toward the ship
const TURRET_PERIOD = 1.6;           // seconds between turret shots
const TURRET_RANGE = 320;            // turrets hold fire beyond this depth
const BOSS_PERIOD = 1.1;
const BOSS_HP = 6;
const PLANE_SPEED = 70;              // units/s a fighter closes on top of scroll
const HIT_X = 12;                    // how close an enemy shot must be to tell
const HIT_ALT = 12;

// --- fuel and lives --------------------------------------------------------

const FUEL_MAX = 100;
const FUEL_RATE = 5.5;               // fuel/s burned in flight
const FUEL_PER_TANK = 30;            // fuel returned by a destroyed tank
const START_LIVES = 3;
const INVULN = 1.5;                  // seconds of grace after a crash

// --- levels ----------------------------------------------------------------

const LEVEL_COUNT = 4;
const SCROLL_BASE = 110;             // units/s on level 1
const SCROLL_STEP = 18;              // added per level
const LEVEL_BONUS = 1000;
const FUEL_BONUS = 10;               // per unit of fuel left when a level ends

const POINTS = { tank: 150, turret: 200, plane: 300, boss: 2000 };

const COLORS = {
    tank: ['#fbbf24', '#d97706', '#92400e'],
    turret: ['#cbd5e1', '#94a3b8', '#64748b'],
    plane: '#f472b6',
    boss: ['#a78bfa', '#7c3aed', '#4c1d95'],
    wall: ['#1e3a8a', '#1d4ed8'],
};

const BEST_KEY = 'zaxxon-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = START_LIVES;
let fuel = FUEL_MAX;
let best = loadBest();
let objects = [];                    // the fortress, ordered far to near
let bullets = [];                    // { x, alt, z }
let enemyShots = [];                 // { x, alt, z, vx, valt, vz }
let booms = [];                      // expanding rings, cosmetic only
let scrollSpeed = scrollSpeedFor(1);
let distance = 0;                    // world units travelled, drives the grid
let cooldown = 0;
let invuln = 0;
let shotsFired = 0;
let autoRun = true;                  // the animation loop only simulates while true
const keys = Object.create(null);

const ship = { x: FIELD_W / 2, alt: MAX_ALT / 2 };

// --- geometry --------------------------------------------------------------

function proj(x, alt, z) {
    return {
        sx: ORIGIN_X + x + z * SKEW_X,
        sy: NEAR_Y - z * DEPTH_Y - alt * ALT_Y,
    };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// Every obstacle goes through here, so a level plan only has to say what is
// interesting about an object and the defaults for its kind fill in the rest.
function makeObject(spec) {
    const o = {
        kind: spec.kind,
        x: spec.x === undefined ? FIELD_W / 2 : spec.x,
        alt: spec.alt === undefined ? 0 : spec.alt,
        z: spec.z,
    };
    switch (o.kind) {
        case 'tank':
            o.half = 14;
            o.low = 0;
            o.high = 30;
            o.depth = 12;
            break;
        case 'turret':
            o.half = 13;
            o.low = 0;
            o.high = 24;
            o.depth = 11;
            o.cool = TURRET_PERIOD * 0.6;
            break;
        case 'plane':
            o.half = 15;
            o.low = o.alt - 13;
            o.high = o.alt + 13;
            o.depth = 12;
            break;
        case 'boss':
            o.half = 45;
            o.low = 0;
            o.high = 70;
            o.depth = 18;
            o.hp = BOSS_HP;
            o.cool = BOSS_PERIOD * 0.5;
            break;
        case 'wall':
            o.half = FIELD_W;
            o.low = 0;
            o.high = MAX_ALT;
            o.depth = 6;
            o.openX = spec.openX ? spec.openX.slice() : [60, 140];
            o.openAlt = spec.openAlt ? spec.openAlt.slice() : [0, 50];
            break;
    }
    return o;
}

// --- level plans -----------------------------------------------------------

// Hand-authored fortresses. `gap` is the depth added since the previous entry,
// which keeps a plan readable and makes re-spacing a level a one-number edit.
// Nothing here is random, so a level is always the same fortress.
const LEVEL_PLANS = [
    [
        { gap: 380, kind: 'tank', x: 60 },
        { gap: 120, kind: 'tank', x: 140 },
        { gap: 200, kind: 'turret', x: 100 },
        { gap: 180, kind: 'tank', x: 40 },
        { gap: 220, kind: 'wall', openX: [55, 150], openAlt: [0, 52] },
        { gap: 190, kind: 'plane', x: 100, alt: 55 },
        { gap: 200, kind: 'turret', x: 50 },
        { gap: 70, kind: 'turret', x: 150 },
        { gap: 200, kind: 'tank', x: 100 },
        { gap: 240, kind: 'wall', openX: [30, 125], openAlt: [44, 90] },
        { gap: 200, kind: 'tank', x: 170 },
        { gap: 170, kind: 'plane', x: 60, alt: 25 },
        { gap: 320, kind: 'boss', x: 100 },
    ],
    [
        { gap: 360, kind: 'turret', x: 70 },
        { gap: 90, kind: 'tank', x: 130 },
        { gap: 190, kind: 'plane', x: 150, alt: 65 },
        { gap: 160, kind: 'wall', openX: [100, 180], openAlt: [0, 50] },
        { gap: 170, kind: 'tank', x: 150 },
        { gap: 60, kind: 'tank', x: 110 },
        { gap: 180, kind: 'turret', x: 40 },
        { gap: 60, kind: 'turret', x: 90 },
        { gap: 190, kind: 'wall', openX: [20, 100], openAlt: [40, 90] },
        { gap: 150, kind: 'plane', x: 60, alt: 70 },
        { gap: 140, kind: 'plane', x: 140, alt: 20 },
        { gap: 190, kind: 'tank', x: 30 },
        { gap: 90, kind: 'tank', x: 70 },
        { gap: 200, kind: 'wall', openX: [70, 150], openAlt: [0, 48] },
        { gap: 300, kind: 'boss', x: 110 },
    ],
    [
        { gap: 340, kind: 'tank', x: 100 },
        { gap: 150, kind: 'turret', x: 60 },
        { gap: 50, kind: 'turret', x: 140 },
        { gap: 170, kind: 'wall', openX: [15, 95], openAlt: [46, 90] },
        { gap: 150, kind: 'plane', x: 120, alt: 60 },
        { gap: 120, kind: 'tank', x: 170 },
        { gap: 70, kind: 'tank', x: 130 },
        { gap: 170, kind: 'wall', openX: [110, 190], openAlt: [0, 46] },
        { gap: 140, kind: 'turret', x: 160 },
        { gap: 60, kind: 'turret', x: 120 },
        { gap: 160, kind: 'plane', x: 40, alt: 35 },
        { gap: 130, kind: 'plane', x: 160, alt: 75 },
        { gap: 170, kind: 'wall', openX: [60, 145], openAlt: [38, 88] },
        { gap: 150, kind: 'tank', x: 90 },
        { gap: 80, kind: 'tank', x: 50 },
        { gap: 300, kind: 'boss', x: 90 },
    ],
    [
        { gap: 320, kind: 'turret', x: 100 },
        { gap: 120, kind: 'plane', x: 100, alt: 45 },
        { gap: 150, kind: 'wall', openX: [20, 90], openAlt: [0, 44] },
        { gap: 130, kind: 'tank', x: 40 },
        { gap: 60, kind: 'turret', x: 80 },
        { gap: 150, kind: 'wall', openX: [120, 195], openAlt: [42, 90] },
        { gap: 140, kind: 'plane', x: 170, alt: 70 },
        { gap: 120, kind: 'plane', x: 30, alt: 15 },
        { gap: 160, kind: 'tank', x: 180 },
        { gap: 70, kind: 'tank', x: 140 },
        { gap: 160, kind: 'wall', openX: [55, 130], openAlt: [0, 42] },
        { gap: 140, kind: 'turret', x: 30 },
        { gap: 60, kind: 'turret', x: 70 },
        { gap: 60, kind: 'turret', x: 110 },
        { gap: 170, kind: 'plane', x: 90, alt: 80 },
        { gap: 160, kind: 'wall', openX: [95, 175], openAlt: [36, 86] },
        { gap: 290, kind: 'boss', x: 100 },
    ],
];

// Near to far, boss last — loadLevel reverses it for drawing order.
function buildLevel(n) {
    const plan = LEVEL_PLANS[(n - 1) % LEVEL_PLANS.length];
    let z = 0;
    return plan.map((entry) => {
        z += entry.gap;
        return makeObject({ ...entry, z });
    });
}

function scrollSpeedFor(n) {
    return SCROLL_BASE + (n - 1) * SCROLL_STEP;
}

// --- game flow -------------------------------------------------------------

function loadLevel(n) {
    level = n;
    objects = buildLevel(n).reverse();
    bullets = [];
    enemyShots = [];
    booms = [];
    fuel = FUEL_MAX;
    ship.x = FIELD_W / 2;
    ship.alt = MAX_ALT / 2;
    scrollSpeed = scrollSpeedFor(n);
    distance = 0;
    cooldown = 0;
    invuln = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    shotsFired = 0;
    autoRun = true;
    loadLevel(1);
    state = 'running';
    hideOverlay();
    updateHud();
}

// Space, a click and the Start button all mean "do the obvious thing here".
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'levelclear':
            loadLevel(level + 1);
            state = 'running';
            hideOverlay();
            updateHud();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            fire();
            break;
    }
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

function crash() {
    lives -= 1;
    boom(ship.x, ship.alt, 0);
    bullets = [];
    enemyShots = [];
    fuel = FUEL_MAX;
    ship.x = FIELD_W / 2;
    ship.alt = MAX_ALT / 2;
    cooldown = 0;
    if (lives <= 0) {
        lives = 0;
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Final score ${score}`, 'Press Space to try again');
    } else {
        invuln = INVULN;
    }
    updateHud();
}

function finishLevel() {
    score += LEVEL_BONUS + Math.floor(fuel) * FUEL_BONUS;
    if (level >= LEVEL_COUNT) {
        state = 'won';
        saveBest();
        showOverlay('YOU WIN!', `Final score ${score}`, 'Press Space to fly it again');
    } else {
        state = 'levelclear';
        showOverlay('LEVEL CLEAR', `Score ${score}`, `Press Space for sector ${level + 1}`);
    }
    updateHud();
}

// --- shooting --------------------------------------------------------------

function fire() {
    if (state !== 'running') return;
    if (cooldown > 0 || bullets.length >= MAX_BULLETS) return;
    bullets.push({ x: ship.x, alt: ship.alt, z: BULLET_Z0 });
    cooldown = FIRE_COOLDOWN;
    shotsFired++;
}

function boom(x, alt, z) {
    booms.push({ x, alt, z, t: 0 });
}

function damage(o) {
    boom(o.x, (o.low + o.high) / 2, o.z);
    if (o.kind === 'boss') {
        o.hp -= 1;
        if (o.hp > 0) return;
        score += POINTS.boss;
    } else {
        score += POINTS[o.kind] || 0;
        if (o.kind === 'tank') fuel = Math.min(FUEL_MAX, fuel + FUEL_PER_TANK);
    }
    const i = objects.indexOf(o);
    if (i >= 0) objects.splice(i, 1);
}

// A bullet only bites when its own altitude falls inside the target's band —
// that clause is the whole game.
function moveBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.z += BULLET_SPEED * dt;
        if (b.z > VIEW_DEPTH) {
            bullets.splice(i, 1);
            continue;
        }
        const hit = objects.find(
            (o) =>
                o.kind !== 'wall' &&
                Math.abs(o.z - b.z) <= HIT_Z &&
                Math.abs(o.x - b.x) <= o.half + HIT_PAD &&
                b.alt >= o.low - HIT_PAD &&
                b.alt <= o.high + HIT_PAD
        );
        if (hit) {
            bullets.splice(i, 1);
            damage(hit);
        }
    }
}

// --- enemy fire ------------------------------------------------------------

// Aimed at where the ship is right now, with no lead: keep moving and it misses.
function aimedShot(o) {
    const alt0 = Math.min(MAX_ALT, (o.low + o.high) / 2 + 4);
    const flight = Math.max(0.05, o.z / SHOT_SPEED);
    return {
        x: o.x,
        alt: alt0,
        z: o.z,
        vz: -SHOT_SPEED,
        vx: (ship.x - o.x) / flight,
        valt: (ship.alt - alt0) / flight,
    };
}

function fireEnemies(dt) {
    objects.forEach((o) => {
        if (o.kind !== 'turret' && o.kind !== 'boss') return;
        if (o.z <= 0 || o.z > TURRET_RANGE) return;
        o.cool -= dt;
        if (o.cool > 0) return;
        o.cool = o.kind === 'boss' ? BOSS_PERIOD : TURRET_PERIOD;
        enemyShots.push(aimedShot(o));
    });
}

// Returns false when the ship was hit, so the caller can stop the tick.
function moveEnemyShots(dt) {
    for (let i = enemyShots.length - 1; i >= 0; i--) {
        const s = enemyShots[i];
        s.z += s.vz * dt;
        s.x += s.vx * dt;
        s.alt += s.valt * dt;
        if (s.z > 0) continue;
        const hit =
            invuln <= 0 &&
            Math.abs(s.x - ship.x) <= HIT_X &&
            Math.abs(s.alt - ship.alt) <= HIT_ALT;
        enemyShots.splice(i, 1);
        if (hit) {
            crash();
            return false;
        }
    }
    return true;
}

// --- ship collisions -------------------------------------------------------

// A wall is only survivable through its opening, and the ship has to fit
// through whole. An opening flush with the deck or the ceiling has no lip, so
// the ship's span is clamped to the playable volume before it is compared.
function throughOpening(o) {
    const lo = Math.max(0, ship.x - SHIP_HALF);
    const hi = Math.min(FIELD_W, ship.x + SHIP_HALF);
    const bottom = Math.max(0, ship.alt - SHIP_HALF);
    const top = Math.min(MAX_ALT, ship.alt + SHIP_HALF);
    return (
        lo >= o.openX[0] && hi <= o.openX[1] && bottom >= o.openAlt[0] && top <= o.openAlt[1]
    );
}

// Returns false when the ship crashed, so the caller can stop the tick.
function shipCollisions() {
    if (invuln > 0) return true;
    for (const o of objects) {
        if (Math.abs(o.z) > HIT_Z) continue;
        if (o.kind === 'wall') {
            if (throughOpening(o)) continue;
            crash();
            return false;
        }
        if (Math.abs(ship.x - o.x) > o.half + SHIP_HALF) continue;
        if (ship.alt - SHIP_THICK > o.high || ship.alt + SHIP_THICK < o.low) continue;
        crash();
        return false;
    }
    return true;
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    // the fortress slides past; fighters close in on top of it
    const dz = scrollSpeed * dt;
    distance += dz;
    objects.forEach((o) => {
        o.z -= dz;
        if (o.kind === 'plane') o.z -= PLANE_SPEED * dt;
    });

    const lateral = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    const vertical = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
    ship.x = clamp(ship.x + lateral * SHIP_SPEED * dt, SHIP_HALF, FIELD_W - SHIP_HALF);
    ship.alt = clamp(ship.alt + vertical * ALT_SPEED * dt, 0, MAX_ALT);

    cooldown = Math.max(0, cooldown - dt);
    if (keys.Space) fire();

    fuel = Math.max(0, fuel - FUEL_RATE * dt);
    if (fuel <= 0) {
        crash();
        return;
    }

    moveBullets(dt);
    fireEnemies(dt);
    if (!moveEnemyShots(dt)) return;
    if (!shipCollisions()) return;

    objects = objects.filter((o) => o.z > CULL_Z);

    invuln = Math.max(0, invuln - dt);
    for (let i = booms.length - 1; i >= 0; i--) {
        booms[i].t += dt;
        booms[i].z -= dz;
        if (booms[i].t > 0.55) booms.splice(i, 1);
    }

    if (objects.length === 0) finishLevel();
    updateHud();
}

// --- HUD and overlay -------------------------------------------------------

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage unavailable (private mode, file restrictions) — keep playing */
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent !== String(value)) el.textContent = String(value);
}

function updateHud() {
    setText('score', score);
    setText('level', level);
    setText('lives', lives);
    setText('fuel', Math.ceil(fuel));
    setText('best', best);
}

function showOverlay(title, scoreLine, sub) {
    setText('overlay-title', title);
    setText('overlay-score', scoreLine || '');
    setText('overlay-sub', sub || '');
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

const LADDER_X = W - 24;
const LADDER_TOP = 120;
const LADDER_H = 300;

// Screen y of the ship's mark on the altitude ladder.
function altMarkerY() {
    return LADDER_TOP + (1 - ship.alt / MAX_ALT) * LADDER_H;
}

// A fixed star field — generated once from a seeded sequence so it never
// shimmers between frames.
const STARS = (() => {
    const out = [];
    let seed = 20251006;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    };
    for (let i = 0; i < 110; i++) {
        out.push({ x: rand() * W, y: rand() * H, r: 0.5 + rand() * 1.1, a: 0.25 + rand() * 0.5 });
    }
    return out;
})();

function quad(a, b, c, d, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.lineTo(c.sx, c.sy);
    ctx.lineTo(d.sx, d.sy);
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// A world-space box: top face, near face, right face, in three shades.
function box(x, z, half, low, high, depth, shades) {
    const [top, near, side] = shades;
    const nz = z - depth;
    const fz = z + depth;

    quad(
        proj(x - half, high, fz),
        proj(x + half, high, fz),
        proj(x + half, high, nz),
        proj(x - half, high, nz),
        top,
        'rgba(0, 0, 0, 0.35)'
    );
    quad(
        proj(x - half, high, nz),
        proj(x + half, high, nz),
        proj(x + half, low, nz),
        proj(x - half, low, nz),
        near,
        'rgba(0, 0, 0, 0.35)'
    );
    quad(
        proj(x + half, high, nz),
        proj(x + half, high, fz),
        proj(x + half, low, fz),
        proj(x + half, low, nz),
        side,
        'rgba(0, 0, 0, 0.35)'
    );
}

function shadow(x, z, rx, rz) {
    const p = proj(x, 0, z);
    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.scale(1, 0.45);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(rx, rz), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2, 6, 18, 0.45)';
    ctx.fill();
    ctx.restore();
}

function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0a1430');
    sky.addColorStop(0.55, '#060a1a');
    sky.addColorStop(1, '#04070f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    STARS.forEach((s) => {
        ctx.globalAlpha = s.a;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = '#dbeafe';
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

const HULL = 26;                     // screen px of fortress below the deck

// The slab the deck sits on: the near end cap and the long left flank. Without
// it the fortress reads as a sticker lying on the starfield.
function drawHull() {
    const nl = proj(0, 0, DECK_Z0);
    const nr = proj(FIELD_W, 0, DECK_Z0);
    const fl = proj(0, 0, VIEW_DEPTH);
    const drop = (p) => ({ sx: p.sx, sy: p.sy + HULL });

    quad(fl, nl, drop(nl), drop(fl), '#0b1326', 'rgba(56, 189, 248, 0.25)');
    quad(nl, nr, drop(nr), drop(nl), '#16233f', 'rgba(56, 189, 248, 0.35)');

    // rib detail along the flank, so the slab has a scale to read against
    const spacing = 60;
    const phase = distance % spacing;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1;
    for (let z = DECK_Z0 - phase; z <= VIEW_DEPTH; z += spacing) {
        const a = proj(0, 0, z);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(a.sx, a.sy + HULL);
        ctx.stroke();
    }
}

function drawDeck() {
    const nl = proj(0, 0, DECK_Z0);
    const nr = proj(FIELD_W, 0, DECK_Z0);
    const fr = proj(FIELD_W, 0, VIEW_DEPTH);
    const fl = proj(0, 0, VIEW_DEPTH);

    const deck = ctx.createLinearGradient(fl.sx, fl.sy, nr.sx, nr.sy);
    deck.addColorStop(0, '#13203c');
    deck.addColorStop(1, '#1c2c4e');
    quad(nl, nr, fr, fl, deck, null);

    // lanes running away from the ship
    ctx.strokeStyle = 'rgba(148, 197, 255, 0.10)';
    ctx.lineWidth = 1;
    for (let x = 25; x < FIELD_W; x += 25) {
        const a = proj(x, 0, DECK_Z0);
        const b = proj(x, 0, VIEW_DEPTH);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
    }

    // cross ribs, offset by distance travelled so the deck visibly moves
    const spacing = 60;
    const phase = distance % spacing;
    for (let z = DECK_Z0 - phase; z <= VIEW_DEPTH; z += spacing) {
        const a = proj(0, 0, z);
        const b = proj(FIELD_W, 0, z);
        ctx.globalAlpha = 0.9 - (z / VIEW_DEPTH) * 0.7;
        ctx.strokeStyle = 'rgba(125, 211, 252, 0.16)';
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // the fortress rim, which is what sells the isometric angle
    [0, FIELD_W].forEach((x) => {
        const a = proj(x, 0, DECK_Z0);
        const b = proj(x, 0, VIEW_DEPTH);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
    });
}

function drawWall(o) {
    // At a fixed depth the projection is axis aligned, so a slab is a rectangle.
    const slab = (x0, x1, a0, a1) => {
        if (x1 <= x0 || a1 <= a0) return;
        const tl = proj(x0, a1, o.z);
        const br = proj(x1, a0, o.z);
        const grad = ctx.createLinearGradient(0, tl.sy, 0, br.sy);
        grad.addColorStop(0, COLORS.wall[1]);
        grad.addColorStop(1, COLORS.wall[0]);
        ctx.fillStyle = grad;
        ctx.fillRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(tl.sx, tl.sy, br.sx - tl.sx, br.sy - tl.sy);
    };

    slab(0, o.openX[0], 0, MAX_ALT);
    slab(o.openX[1], FIELD_W, 0, MAX_ALT);
    slab(o.openX[0], o.openX[1], o.openAlt[1], MAX_ALT);
    slab(o.openX[0], o.openX[1], 0, o.openAlt[0]);

    // energy scan lines across the slabs
    const top = proj(0, MAX_ALT, o.z);
    const bottom = proj(0, 0, o.z);
    ctx.strokeStyle = 'rgba(147, 197, 253, 0.18)';
    ctx.lineWidth = 1;
    for (let y = top.sy; y < bottom.sy; y += 7) {
        const inGap = y > proj(0, o.openAlt[1], o.z).sy && y < proj(0, o.openAlt[0], o.z).sy;
        const l = proj(0, 0, o.z).sx;
        const r = proj(FIELD_W, 0, o.z).sx;
        ctx.beginPath();
        if (inGap) {
            ctx.moveTo(l, y);
            ctx.lineTo(proj(o.openX[0], 0, o.z).sx, y);
            ctx.moveTo(proj(o.openX[1], 0, o.z).sx, y);
            ctx.lineTo(r, y);
        } else {
            ctx.moveTo(l, y);
            ctx.lineTo(r, y);
        }
        ctx.stroke();
    }

    // the gap, outlined so it reads as the way through
    const gl = proj(o.openX[0], o.openAlt[1], o.z);
    const gr = proj(o.openX[1], o.openAlt[0], o.z);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(gl.sx, gl.sy, gr.sx - gl.sx, gr.sy - gl.sy);
}

function drawPlane(o) {
    shadow(o.x, o.z, 11, 11);
    const p = proj(o.x, o.alt, o.z);
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy + 9);
    ctx.lineTo(p.sx - 13, p.sy - 4);
    ctx.lineTo(p.sx, p.sy - 1);
    ctx.lineTo(p.sx + 13, p.sy - 4);
    ctx.closePath();
    ctx.fillStyle = COLORS.plane;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.sx, p.sy + 2, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
}

function drawTurretBarrel(o) {
    const base = proj(o.x, o.high, o.z);
    const tip = proj(o.x, o.high + 10, o.z - 34);

    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(tip.sx, tip.sy);
    ctx.stroke();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(base.sx, base.sy);
    ctx.lineTo(tip.sx, tip.sy);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(base.sx, base.sy - 2, 7, Math.PI, Math.PI * 2);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(base.sx - 2, base.sy - 4, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.8)';
    ctx.fill();
}

function drawBoss(o) {
    shadow(o.x, o.z, o.half, o.half);
    box(o.x, o.z, o.half, o.low, o.high, o.depth, COLORS.boss);

    // head and eyes
    box(o.x, o.z, 16, o.high, o.high + 16, 10, ['#c4b5fd', '#8b5cf6', '#6d28d9']);
    [-7, 7].forEach((dx) => {
        const p = proj(o.x + dx, o.high + 9, o.z - 10);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = '#fca5a5';
        ctx.fill();
    });

    // damage read-out above the robot
    const bar = proj(o.x - 30, o.high + 28, o.z);
    const full = proj(o.x + 30, o.high + 28, o.z);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(bar.sx, bar.sy - 4, full.sx - bar.sx, 6);
    ctx.fillStyle = '#f87171';
    ctx.fillRect(bar.sx, bar.sy - 4, ((full.sx - bar.sx) * o.hp) / BOSS_HP, 6);
}

function drawObject(o) {
    switch (o.kind) {
        case 'wall':
            drawWall(o);
            break;
        case 'plane':
            drawPlane(o);
            break;
        case 'boss':
            drawBoss(o);
            break;
        case 'tank':
            shadow(o.x, o.z, o.half, o.depth);
            box(o.x, o.z, o.half, o.low, o.high, o.depth, COLORS.tank);
            box(o.x, o.z, o.half * 0.6, o.high, o.high + 5, o.depth * 0.6, [
                '#fde68a',
                '#f59e0b',
                '#b45309',
            ]);
            break;
        case 'turret':
            shadow(o.x, o.z, o.half, o.depth);
            box(o.x, o.z, o.half, o.low, o.high, o.depth, COLORS.turret);
            drawTurretBarrel(o);
            break;
    }
}

function drawShip() {
    if (state === 'idle') return;
    if (invuln > 0 && Math.floor(invuln * 12) % 2 === 0) return;

    shadow(ship.x, 0, 12, 10);

    // the tether between ship and shadow is what makes altitude readable
    const foot = proj(ship.x, 0, 0);
    const p = proj(ship.x, ship.alt, 0);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(foot.sx, foot.sy);
    ctx.lineTo(p.sx, p.sy);
    ctx.stroke();
    ctx.setLineDash([]);

    // engine flare
    ctx.beginPath();
    ctx.moveTo(p.sx - 4, p.sy + 7);
    ctx.lineTo(p.sx + 4, p.sy + 7);
    ctx.lineTo(p.sx, p.sy + 15 + (Math.floor(distance / 6) % 3) * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
    ctx.fill();

    // hull: a chevron pointing away from the viewer
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy - 11);
    ctx.lineTo(p.sx + 14, p.sy + 7);
    ctx.lineTo(p.sx, p.sy + 2);
    ctx.lineTo(p.sx - 14, p.sy + 7);
    ctx.closePath();
    ctx.fillStyle = '#e0f2fe';
    ctx.fill();
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(p.sx, p.sy - 3, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#0369a1';
    ctx.fill();
}

function drawShots() {
    bullets.forEach((b) => {
        const a = proj(b.x, b.alt, b.z);
        const c = proj(b.x, b.alt, b.z + 14);
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(c.sx, c.sy);
        ctx.stroke();
    });

    enemyShots.forEach((s) => {
        const p = proj(s.x, s.alt, s.z);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#fb7185';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(251, 113, 133, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    });
}

function drawBooms() {
    booms.forEach((b) => {
        const k = b.t / 0.55;
        const p = proj(b.x, b.alt, b.z);
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 6 + k * 26, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3 + k * 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(248, 113, 113, 0.5)';
        ctx.fill();
        ctx.globalAlpha = 1;
    });
}

// The deck has to stop somewhere, and a hard edge hanging in the starfield
// looks like a bug. Haze over the far band hides the seam and doubles as the
// fade-in for objects arriving from the distance.
function drawHaze() {
    const edge = proj(0, 0, VIEW_DEPTH).sy;
    const top = edge - 34;
    const bottom = edge + 56;
    const haze = ctx.createLinearGradient(0, top, 0, bottom);
    haze.addColorStop(0, 'rgba(6, 11, 26, 0)');
    haze.addColorStop(0.38, 'rgba(6, 11, 26, 0.94)');
    haze.addColorStop(0.5, 'rgba(6, 11, 26, 0.82)');
    haze.addColorStop(1, 'rgba(6, 11, 26, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, top, W, bottom - top);
}

function drawLadder() {
    ctx.fillStyle = 'rgba(8, 14, 30, 0.72)';
    ctx.fillRect(LADDER_X - 7, LADDER_TOP - 18, 16, LADDER_H + 34);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(LADDER_X - 7, LADDER_TOP - 18, 16, LADDER_H + 34);

    for (let i = 0; i <= 6; i++) {
        const y = LADDER_TOP + (i / 6) * LADDER_H;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.beginPath();
        ctx.moveTo(LADDER_X - 4, y);
        ctx.lineTo(LADDER_X + 5, y);
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ALT', LADDER_X + 1, LADDER_TOP - 23);

    if (state === 'idle') return;
    const y = altMarkerY();
    ctx.beginPath();
    ctx.moveTo(LADDER_X - 10, y);
    ctx.lineTo(LADDER_X - 2, y - 4);
    ctx.lineTo(LADDER_X - 2, y + 4);
    ctx.closePath();
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    ctx.moveTo(LADDER_X - 4, y);
    ctx.lineTo(LADDER_X + 5, y);
    ctx.stroke();
}

function drawFuelGauge() {
    const x = 14;
    const y = H - 110;
    const h = 90;
    ctx.fillStyle = 'rgba(8, 14, 30, 0.72)';
    ctx.fillRect(x - 4, y - 16, 18, h + 24);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 4, y - 16, 18, h + 24);

    const k = fuel / FUEL_MAX;
    ctx.fillStyle = k < 0.25 ? '#f87171' : '#34d399';
    ctx.fillRect(x, y + h * (1 - k), 10, h * k);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.strokeRect(x, y, 10, h);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = '8px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FUEL', x + 5, y - 21);
}

function drawLives() {
    for (let i = 0; i < Math.min(lives, 6); i++) {
        const cx = W - 108 + i * 16;
        const cy = H - 18;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx + 6, cy + 4);
        ctx.lineTo(cx, cy + 1);
        ctx.lineTo(cx - 6, cy + 4);
        ctx.closePath();
        ctx.fillStyle = 'rgba(224, 242, 254, 0.8)';
        ctx.fill();
    }
}

function draw() {
    drawSky();
    drawHull();
    drawDeck();

    // far to near, so nearer objects paint over the ones behind them
    objects.forEach((o) => {
        if (o.z > VIEW_DEPTH || o.z < CULL_Z) return;
        drawObject(o);
    });

    drawShots();
    drawShip();
    drawBooms();
    drawHaze();
    drawLadder();
    drawFuelGauge();
    drawLives();
}

// --- input -----------------------------------------------------------------

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];

document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (MOVE_KEYS.includes(e.code)) {
        e.preventDefault();
        return;
    }
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

canvas.addEventListener('click', () => advance());
document.getElementById('btn-start').addEventListener('click', () => advance());

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && state === 'running') {
        carry += dt;
        while (carry >= DT) {
            physicsStep(DT);
            carry -= DT;
        }
    } else {
        carry = 0;
    }

    draw();
    requestAnimationFrame(frame);
}

updateHud();
draw();
requestAnimationFrame(frame);
