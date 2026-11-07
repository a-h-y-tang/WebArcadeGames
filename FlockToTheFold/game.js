/* Flock to the Fold — a flock-rescue puzzle.
 *
 * The world is an integer cell grid and the whole simulation lives in
 * simStep(), which advances it exactly one tick. Nothing in the simulation
 * reads a clock or a float delta, so the render loop and the test suite can
 * both drive it and get the same answers. Everything is declared with `var` at
 * the top level on purpose: the Playwright suite pokes at these globals
 * directly to build a cave, drop in a critter and step the world by hand.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var CELL = 8;
var COLS = 80;
var ROWS = 60;

var EMPTY = 0;
var DIRT = 1;
var STEEL = 2;
var WATER = 3;
var BRICK = 4;

var TICKS_PER_SEC = 20;
var TICK_MS = 1000 / TICKS_PER_SEC;
var SPAWN_INTERVAL = 20; // ticks between critters leaving the hatch
var FALL_SPEED = 2; // cells per tick
var FLOAT_SPEED = 1; // cells per tick while floating
var SPLAT_DIST = 16; // a longer fall than this is fatal
var BUILDER_BRICKS = 12;
var BASH_HEIGHT = 4; // cells of swath a basher clears
var ABILITIES = ['blocker', 'digger', 'basher', 'builder', 'floater'];
var BEST_KEY = 'burrowbrigade-best';

// ---------------------------------------------------------------------------
// Levels
//
// Each level paints its cave from rectangles, bottom layer first.
// ---------------------------------------------------------------------------

var LEVELS = [
    {
        // A staircase of ledges from the hatch down to the exit. Every drop is
        // inside the splat limit, so this cave can be cleared without spending
        // a single ability — it is there to show how the crowd behaves.
        name: 'The Long Walk',
        total: 10,
        required: 8,
        seconds: 60,
        hatch: { x: 6, y: 10 },
        exit: { x: 66, y: 42, w: 2, h: 2 },
        inventory: { blocker: 2, digger: 2, basher: 2, builder: 2, floater: 2 },
        rects: [
            { x: 0, y: 0, w: 80, h: 4, cell: DIRT },
            { x: 16, y: 4, w: 3, h: 4, cell: DIRT },
            { x: 40, y: 4, w: 2, h: 6, cell: DIRT },
            { x: 62, y: 4, w: 3, h: 3, cell: DIRT },
            { x: 0, y: 18, w: 27, h: 4, cell: DIRT },
            { x: 20, y: 30, w: 33, h: 4, cell: DIRT },
            { x: 0, y: 44, w: 80, h: 12, cell: DIRT },
            { x: 58, y: 43, w: 5, h: 1, cell: DIRT },
            { x: 0, y: 56, w: 80, h: 4, cell: STEEL },
        ],
    },
    {
        name: 'Mind the Gap',
        total: 12,
        required: 6,
        seconds: 80,
        hatch: { x: 6, y: 12 },
        exit: { x: 70, y: 38, w: 2, h: 2 },
        inventory: { blocker: 3, digger: 1, basher: 2, builder: 3, floater: 2 },
        rects: [
            { x: 0, y: 26, w: 19, h: 4, cell: DIRT },
            { x: 0, y: 40, w: 24, h: 20, cell: DIRT },
            { x: 32, y: 40, w: 48, h: 20, cell: DIRT },
            { x: 24, y: 52, w: 8, h: 8, cell: WATER },
            { x: 0, y: 0, w: 80, h: 4, cell: DIRT },
            { x: 24, y: 58, w: 8, h: 2, cell: STEEL },
            { x: 0, y: 56, w: 24, h: 4, cell: STEEL },
            { x: 32, y: 56, w: 48, h: 4, cell: STEEL },
            { x: 40, y: 34, w: 2, h: 6, cell: DIRT },
            { x: 56, y: 38, w: 6, h: 2, cell: DIRT },
            { x: 32, y: 37, w: 2, h: 3, cell: DIRT },
        ],
    },
    {
        name: 'Down and Out',
        total: 12,
        required: 7,
        seconds: 100,
        hatch: { x: 10, y: 22 },
        exit: { x: 68, y: 42, w: 2, h: 2 },
        inventory: { blocker: 2, digger: 2, basher: 1, builder: 2, floater: 2 },
        rects: [
            { x: 0, y: 44, w: 80, h: 16, cell: DIRT },
            { x: 0, y: 30, w: 80, h: 4, cell: DIRT },
            { x: 26, y: 4, w: 3, h: 5, cell: DIRT },
            { x: 58, y: 4, w: 2, h: 7, cell: DIRT },
            { x: 20, y: 30, w: 22, h: 4, cell: STEEL },
            { x: 0, y: 0, w: 80, h: 4, cell: DIRT },
            { x: 30, y: 44, w: 12, h: 4, cell: WATER },
            { x: 0, y: 56, w: 80, h: 4, cell: STEEL },
            { x: 0, y: 24, w: 2, h: 6, cell: STEEL },
            { x: 78, y: 24, w: 2, h: 6, cell: STEEL },
        ],
    },
];

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

var terrain = new Uint8Array(COLS * ROWS);
var critters = [];
var state = 'idle'; // idle | running | paused | levelcomplete | won | lost
var level = 1;
var saved = 0;
var lost = 0;
var spawned = 0;
var spawnTimer = 0;
var ticksLeft = 0;
var totalCritters = 0;
var requiredCritters = 0;
var inventory = {};
var selectedAbility = 'blocker';
var hatch = { x: 0, y: 0 };
var exitRect = { x: 0, y: 0, w: 0, h: 0 };
var score = 0;
var best = 0;
var ticks = 0; // whole-run tick counter, used only for animation
var bannerUntil = 0; // draw the cave's name until this tick
var hoverCritter = null; // the critter under the pointer, for the aim ring
var autoRun = true; // the render loop drives simStep() when true
var autoResolve = true; // simStep() ends the level when true

// ---------------------------------------------------------------------------
// Terrain helpers
// ---------------------------------------------------------------------------

function clearTerrain() {
    terrain.fill(EMPTY);
}

function cellAt(cx, cy) {
    if (cx < 0 || cx >= COLS) return STEEL; // the walls of the world
    if (cy < 0 || cy >= ROWS) return EMPTY;
    return terrain[cy * COLS + cx];
}

function setCell(cx, cy, value) {
    if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return;
    terrain[cy * COLS + cx] = value;
}

function fillRect(x, y, w, h, value) {
    for (let cy = y; cy < y + h; cy++) {
        for (let cx = x; cx < x + w; cx++) setCell(cx, cy, value);
    }
}

function isSolid(cx, cy) {
    if (cx < 0 || cx >= COLS) return true; // turn around at the edges
    if (cy < 0 || cy >= ROWS) return false;
    const v = terrain[cy * COLS + cx];
    return v === DIRT || v === STEEL || v === BRICK;
}

function isDiggable(cx, cy) {
    const v = cellAt(cx, cy);
    return v === DIRT || v === BRICK;
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

function loadLevel(n) {
    const spec = LEVELS[Math.min(n, LEVELS.length) - 1];
    level = n;
    clearTerrain();
    spec.rects.forEach((r) => fillRect(r.x, r.y, r.w, r.h, r.cell));
    hatch = { x: spec.hatch.x, y: spec.hatch.y };
    exitRect = { x: spec.exit.x, y: spec.exit.y, w: spec.exit.w, h: spec.exit.h };
    totalCritters = spec.total;
    requiredCritters = spec.required;
    ticksLeft = spec.seconds * TICKS_PER_SEC;
    inventory = Object.assign({}, spec.inventory);
    critters.length = 0;
    saved = 0;
    lost = 0;
    spawned = 0;
    spawnTimer = 0;
    bannerUntil = ticks + 3 * TICKS_PER_SEC;
    hoverCritter = null;
    if (typeof document !== 'undefined') buildBackdrop(n);
}

// The cave walls behind the terrain. Deterministic speckle baked once per
// level into an offscreen canvas, so the empty air still reads as rock.
function buildBackdrop(seed) {
    backdrop = document.createElement('canvas');
    backdrop.width = COLS * CELL;
    backdrop.height = ROWS * CELL;
    const b = backdrop.getContext('2d');
    const grad = b.createLinearGradient(0, 0, 0, backdrop.height);
    grad.addColorStop(0, '#7fb2e0');
    grad.addColorStop(0.6, '#b9d6ee');
    grad.addColorStop(1, '#e3efd8');
    b.fillStyle = grad;
    b.fillRect(0, 0, backdrop.width, backdrop.height);

    let r = seed * 9301 + 49297;
    const rand = () => {
        r = (r * 9301 + 49297) % 233280;
        return r / 233280;
    };
    // soft rock blooms
    for (let i = 0; i < 26; i++) {
        const x = rand() * backdrop.width;
        const y = rand() * backdrop.height;
        const rad = 30 + rand() * 90;
        const g = b.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(90,110,170,0.10)');
        g.addColorStop(1, 'rgba(90,110,170,0)');
        b.fillStyle = g;
        b.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // mineral speckle
    for (let i = 0; i < 900; i++) {
        const x = Math.floor(rand() * backdrop.width);
        const y = Math.floor(rand() * backdrop.height);
        b.fillStyle = rand() > 0.8 ? 'rgba(150,180,255,0.10)' : 'rgba(255,255,255,0.045)';
        b.fillRect(x, y, 1, 1);
    }
}

function startGame() {
    score = 0;
    loadLevel(1);
    state = 'running';
    hideOverlay();
    draw();
}

function restartLevel() {
    loadLevel(level);
    state = 'running';
    hideOverlay();
    draw();
}

function nextLevel() {
    if (level >= LEVELS.length) {
        state = 'won';
        return;
    }
    loadLevel(level + 1);
    state = 'running';
    hideOverlay();
    draw();
}

function resolveLevel() {
    score += saved;
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private mode — the run simply isn't remembered */
        }
    }
    if (saved >= requiredCritters) {
        state = level >= LEVELS.length ? 'won' : 'levelcomplete';
    } else {
        state = 'lost';
    }
    showResultOverlay();
    draw();
}

// ---------------------------------------------------------------------------
// Critters
// ---------------------------------------------------------------------------

function spawnCritter(x, y, dir) {
    const c = {
        x: x,
        y: y,
        dir: dir === undefined ? 1 : dir,
        ability: 'walker',
        alive: true,
        saved: false,
        fallDist: 0,
        bricks: BUILDER_BRICKS,
        age: 0,
    };
    critters.push(c);
    return c;
}

function kill(c) {
    if (!c.alive) return;
    c.alive = false;
    c.deadTick = ticks;
    lost++;
}

function assignAbility(c, name) {
    if (!c || !c.alive || c.saved) return false;
    if (c.ability === 'blocker') return false; // blockers are permanent
    if (ABILITIES.indexOf(name) === -1) return false;
    if (!inventory[name] || inventory[name] <= 0) return false;
    inventory[name]--;
    c.ability = name;
    if (name === 'builder') c.bricks = BUILDER_BRICKS;
    return true;
}

function blockerAt(cx, cy) {
    for (const c of critters) {
        if (!c.alive || c.saved || c.ability !== 'blocker') continue;
        if (c.x === cx && (c.y === cy || c.y - 1 === cy)) return c;
    }
    return null;
}

function critterAt(cx, cy) {
    let hit = null;
    let bestDist = Infinity;
    for (const c of critters) {
        if (!c.alive || c.saved) continue;
        const dx = Math.abs(c.x - cx);
        if (dx > 1) continue;
        if (cy < c.y - 2 || cy > c.y + 1) continue;
        const d = dx + Math.abs(c.y - cy);
        if (d < bestDist) {
            bestDist = d;
            hit = c;
        }
    }
    return hit;
}

function inExit(c) {
    return (
        c.x >= exitRect.x &&
        c.x < exitRect.x + exitRect.w &&
        c.y >= exitRect.y &&
        c.y < exitRect.y + exitRect.h
    );
}

function checkHazards(c) {
    if (!c.alive || c.saved) return;
    if (cellAt(c.x, c.y) === WATER || cellAt(c.x, c.y - 1) === WATER) kill(c);
}

function checkExit(c) {
    if (!c.alive || c.saved) return;
    if (inExit(c)) {
        c.saved = true;
        saved++;
    }
}

// One tick of one critter.
function stepCritter(c) {
    if (!c.alive || c.saved) return;
    c.age++;

    // --- falling -----------------------------------------------------------
    if (!isSolid(c.x, c.y + 1)) {
        const speed = c.ability === 'floater' ? FLOAT_SPEED : FALL_SPEED;
        for (let i = 0; i < speed; i++) {
            if (isSolid(c.x, c.y + 1)) break;
            c.y++;
            c.fallDist++;
            if (c.y >= ROWS) {
                kill(c);
                return;
            }
            checkHazards(c);
            if (!c.alive) return;
        }
        if (isSolid(c.x, c.y + 1)) {
            if (c.fallDist > SPLAT_DIST && c.ability !== 'floater') {
                kill(c);
                return;
            }
            // A digger or basher that drops into open air has finished the job
            // it was given; it goes back to walking rather than boring on
            // through whatever it lands on.
            if (c.ability === 'digger' || c.ability === 'basher') c.ability = 'walker';
            c.fallDist = 0;
        }
        checkExit(c);
        return;
    }

    c.fallDist = 0;

    // A blocker only stops walking — gravity still has its say, so one
    // assigned in mid-air drops to the ground before it takes root.
    if (c.ability === 'blocker') return; // scenery with a heartbeat

    // --- working -----------------------------------------------------------
    if (c.ability === 'digger') {
        dig(c);
    } else if (c.ability === 'basher') {
        bash(c);
    } else if (c.ability === 'builder') {
        build(c);
    } else {
        walk(c);
    }

    checkHazards(c);
    checkExit(c);
}

function dig(c) {
    if (!isDiggable(c.x, c.y + 1)) {
        c.ability = 'walker'; // steel floor: nothing to be done
        return;
    }
    for (let dx = -1; dx <= 1; dx++) {
        if (isDiggable(c.x + dx, c.y + 1)) setCell(c.x + dx, c.y + 1, EMPTY);
    }
    c.y++;
}

function bash(c) {
    const t = c.x + c.dir;
    let diggable = false;
    let steel = false;
    for (let dy = 0; dy < BASH_HEIGHT; dy++) {
        const v = cellAt(t, c.y - dy);
        if (v === STEEL) steel = true;
        else if (v === DIRT || v === BRICK) diggable = true;
    }
    if (steel || !diggable) {
        c.ability = 'walker';
        return;
    }
    for (let dy = 0; dy < BASH_HEIGHT; dy++) {
        if (isDiggable(t, c.y - dy)) setCell(t, c.y - dy, EMPTY);
    }
    c.x = t;
}

function build(c) {
    if (c.bricks <= 0) {
        c.ability = 'walker';
        return;
    }
    const t = c.x + c.dir;
    const ny = c.y - 1;
    if (isSolid(t, ny) || isSolid(t, ny - 1)) {
        c.dir = -c.dir; // no headroom for another step
        c.ability = 'walker';
        return;
    }
    setCell(t, c.y, BRICK);
    c.x = t;
    c.y = ny;
    c.bricks--;
}

function walk(c) {
    const t = c.x + c.dir;
    if (blockerAt(t, c.y) || blockerAt(t, c.y - 1)) {
        c.dir = -c.dir;
        return;
    }
    if (!isSolid(t, c.y) && !isSolid(t, c.y - 1)) {
        c.x = t; // clear ahead
        return;
    }
    if (isSolid(t, c.y) && !isSolid(t, c.y - 1) && !isSolid(t, c.y - 2)) {
        c.x = t; // one-cell ledge
        c.y -= 1;
        return;
    }
    if (
        isSolid(t, c.y) &&
        isSolid(t, c.y - 1) &&
        !isSolid(t, c.y - 2) &&
        !isSolid(t, c.y - 3)
    ) {
        c.x = t; // two-cell ledge
        c.y -= 2;
        return;
    }
    c.dir = -c.dir;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function simStep() {
    ticks++;

    for (let i = 0; i < critters.length; i++) stepCritter(critters[i]);

    // The hatch opens at the end of the tick, so a new critter is visible
    // standing in the hatch for one tick before it starts walking.
    if (spawned < totalCritters) {
        if (spawnTimer <= 0) {
            spawnCritter(hatch.x, hatch.y, 1);
            spawned++;
            spawnTimer = SPAWN_INTERVAL;
        }
        spawnTimer--;
    }

    if (state === 'running' && ticksLeft > 0) ticksLeft--;

    if (autoResolve && state === 'running') {
        const active = critters.some((c) => c.alive && !c.saved);
        if (ticksLeft <= 0 || (spawned >= totalCritters && !active)) resolveLevel();
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');
var backdrop = null;

var elOverlay = document.getElementById('overlay');
var elTitle = document.getElementById('overlay-title');
var elScore = document.getElementById('overlay-score');
var elSub = document.getElementById('overlay-sub');

var DIRT_TOP = '#5f9e3c';
var DIRT_BODY = '#6b431f';
var STEEL_BODY = '#737e96';
var BRICK_BODY = '#c2703a';

var ABILITY_COLOR = {
    walker: '#f8f6ee',
    floater: '#9ad8ff',
    digger: '#ffd166',
    basher: '#ff9f68',
    builder: '#d7a7ff',
    blocker: '#ff6b81',
};

function drawTerrain() {
    for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
            const v = terrain[cy * COLS + cx];
            if (v === EMPTY) continue;
            const px = cx * CELL;
            const py = cy * CELL;
            if (v === DIRT) {
                ctx.fillStyle = isSolid(cx, cy - 1) ? DIRT_BODY : DIRT_TOP;
                ctx.fillRect(px, py, CELL, CELL);
                if ((cx * 7 + cy * 13) % 11 === 0) {
                    ctx.fillStyle = 'rgba(0,0,0,0.18)';
                    ctx.fillRect(px + 2, py + 3, 3, 2);
                }
            } else if (v === STEEL) {
                ctx.fillStyle = STEEL_BODY;
                ctx.fillRect(px, py, CELL, CELL);
                ctx.fillStyle = 'rgba(255,255,255,0.18)';
                ctx.fillRect(px + 1, py + 1, 2, 2);
            } else if (v === BRICK) {
                ctx.fillStyle = BRICK_BODY;
                ctx.fillRect(px, py, CELL, CELL);
                ctx.fillStyle = 'rgba(0,0,0,0.22)';
                ctx.fillRect(px, py + CELL - 1, CELL, 1);
            } else if (v === WATER) {
                const wob = Math.sin((ticks * 0.12 + cx * 0.6)) * 1.2;
                ctx.fillStyle = 'rgba(60,140,235,0.75)';
                ctx.fillRect(px, py + (isSolid(cx, cy - 1) ? 0 : wob), CELL, CELL);
                ctx.fillStyle = 'rgba(180,225,255,0.25)';
                ctx.fillRect(px, py + 1 + wob, CELL, 1);
            }
        }
    }
}

function drawExit() {
    const px = exitRect.x * CELL;
    const py = exitRect.y * CELL;
    const w = exitRect.w * CELL;
    const h = exitRect.h * CELL;
    if (w <= 0 || h <= 0) return;
    const glow = 0.5 + 0.5 * Math.sin(ticks * 0.15);
    const g = ctx.createRadialGradient(px + w / 2, py + h / 2, 2, px + w / 2, py + h / 2, 26);
    g.addColorStop(0, `rgba(120,255,180,${0.45 + 0.25 * glow})`);
    g.addColorStop(1, 'rgba(120,255,180,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - 26, py - 26, w + 52, h + 52);
    // The sheepfold: a wooden pen with a warm glow.
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(px - 2, py - 6, w + 4, h + 6);
    ctx.strokeStyle = '#e9c98a';
    ctx.lineWidth = 2;
    ctx.strokeRect(px - 1, py - 5, w + 2, h + 4);
    ctx.fillStyle = `rgba(160,255,200,${0.5 + 0.4 * glow})`;
    ctx.fillRect(px, py - 2, w, 2);
}

function drawHatch() {
    const px = hatch.x * CELL;
    const py = hatch.y * CELL;
    // chains up to the ceiling
    ctx.strokeStyle = 'rgba(160,175,215,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px - 6, py - 12);
    ctx.moveTo(px + 14, 0);
    ctx.lineTo(px + 14, py - 12);
    ctx.stroke();
    // the hopper itself
    ctx.fillStyle = '#7a5532';
    ctx.fillRect(px - 11, py - 14, 30, 10);
    ctx.fillStyle = '#9b7046';
    ctx.fillRect(px - 11, py - 14, 30, 3);
    ctx.fillStyle = '#10162a';
    ctx.fillRect(px - 5, py - 6, 18, 4);
    const open = spawned < totalCritters && state === 'running';
    ctx.fillStyle = open ? '#ffd98a' : '#6b7596';
    ctx.fillRect(px - 5, py - 5, 18, 2);
}

function drawCritter(c) {
    const px = c.x * CELL;
    const py = (c.y - 1) * CELL;
    if (!c.alive) {
        const age = ticks - (c.deadTick || 0);
        if (age > 40) return;
        ctx.fillStyle = `rgba(255,90,110,${0.45 * (1 - age / 40)})`;
        ctx.fillRect(px, py + CELL, CELL, CELL - 2);
        return;
    }
    if (c.saved) return;

    if (c === hoverCritter && state === 'running') {
        ctx.strokeStyle = 'rgba(255,217,138,0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 2.5, py - 0.5, CELL + 5, CELL * 2 + 3);
    }

    // A woolly sheep, tinted by its job: fleece body, dark face and legs.
    ctx.fillStyle = ABILITY_COLOR[c.ability] || ABILITY_COLOR.walker;
    ctx.fillRect(px + 1, py + 4, CELL - 2, CELL * 2 - 8);
    ctx.fillRect(px, py + 6, CELL, CELL * 2 - 12);
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(px + 1, py + CELL * 2 - 4, 1, 3);
    ctx.fillRect(px + CELL - 2, py + CELL * 2 - 4, 1, 3);

    // face, facing the way it walks
    const fx = c.dir > 0 ? px + CELL - 3 : px;
    ctx.fillRect(fx, py + 2, 3, 4);
    const ex = fx + 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex, py + 3, 1, 1);

    if (c.ability === 'blocker') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 1.5, CELL - 1, CELL * 2 - 2);
    } else if (c.ability === 'floater') {
        ctx.fillStyle = '#9ad8ff';
        ctx.fillRect(px - 2, py - 1, CELL + 4, 2);
    } else if (c.ability === 'builder') {
        ctx.fillStyle = BRICK_BODY;
        ctx.fillRect(c.dir > 0 ? px + CELL - 1 : px - 2, py + CELL, 3, 2);
    }
}

function updateHud() {
    document.getElementById('level').textContent = String(level);
    document.getElementById('saved').textContent = String(saved);
    document.getElementById('required').textContent = String(requiredCritters);
    document.getElementById('out').textContent = String(spawned);
    document.getElementById('time').textContent = String(Math.ceil(ticksLeft / TICKS_PER_SEC));
    document.getElementById('best').textContent = String(best);
    ABILITIES.forEach((name) => {
        const count = inventory[name] || 0;
        document.getElementById('count-' + name).textContent = String(count);
        const btn = document.getElementById('btn-' + name);
        btn.classList.toggle('empty', count === 0);
        btn.classList.toggle('selected', selectedAbility === name);
    });
}

function draw() {
    ctx.fillStyle = '#b9d6ee';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (backdrop) ctx.drawImage(backdrop, 0, 0);

    drawTerrain();
    drawExit();
    drawHatch();
    for (const c of critters) drawCritter(c);
    drawBanner();
    updateHud();
}

function drawBanner() {
    if (ticks >= bannerUntil || state === 'idle') return;
    const spec = LEVELS[Math.min(level, LEVELS.length) - 1];
    const fade = Math.min(1, (bannerUntil - ticks) / 12);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(8,12,24,0.75)';
    ctx.fillRect(0, 150, canvas.width, 64);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd98a';
    ctx.font = 'bold 22px "Segoe UI", sans-serif';
    ctx.fillText(`HILLSIDE ${level} — ${spec.name.toUpperCase()}`, canvas.width / 2, 182);
    ctx.fillStyle = '#c3cdf0';
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillText(
        `Bring ${requiredCritters} of ${spec.total} sheep home to the fold`,
        canvas.width / 2,
        202
    );
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function hideOverlay() {
    elOverlay.classList.remove('visible');
}

function showOverlay(title, scoreLine, sub) {
    elTitle.textContent = title;
    elScore.textContent = scoreLine;
    elSub.textContent = sub;
    elOverlay.classList.add('visible');
}

function showResultOverlay() {
    const tally = `Saved ${saved} of ${totalCritters} — needed ${requiredCritters}. Run total: ${score}.`;
    if (state === 'won') {
        showOverlay('ALL RESCUED! THE FLOCK IS HOME', tally, 'Press Space to lead the flock again');
    } else if (state === 'levelcomplete') {
        showOverlay('LEVEL CLEAR', tally, 'Press Space for the next hillside');
    } else {
        showOverlay('THE FLOCK IS SCATTERED', tally, 'Press Space to start over, or R to retry this hillside');
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function selectAbility(name) {
    if (ABILITIES.indexOf(name) === -1) return;
    selectedAbility = name;
    updateHud();
}

function onSpace() {
    if (state === 'idle' || state === 'won' || state === 'lost') startGame();
    else if (state === 'levelcomplete') nextLevel();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back to work');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

document.addEventListener('keydown', (e) => {
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 }[e.code];
    if (digit !== undefined) {
        selectAbility(ABILITIES[digit]);
        return;
    }
    if (e.code === 'Space') {
        e.preventDefault();
        onSpace();
    } else if (e.code === 'KeyP') {
        togglePause();
    } else if (e.code === 'KeyR') {
        if (state === 'running' || state === 'paused') restartLevel();
    }
});

document.getElementById('btn-start').addEventListener('click', onSpace);

document.querySelectorAll('.ability').forEach((btn) => {
    btn.addEventListener('click', () => selectAbility(btn.dataset.ability));
});

function cellFromEvent(e) {
    const r = canvas.getBoundingClientRect();
    return {
        x: Math.floor(((e.clientX - r.left) * (canvas.width / r.width)) / CELL),
        y: Math.floor(((e.clientY - r.top) * (canvas.height / r.height)) / CELL),
    };
}

canvas.addEventListener('mousemove', (e) => {
    const p = cellFromEvent(e);
    hoverCritter = critterAt(p.x, p.y);
    canvas.style.cursor = hoverCritter ? 'pointer' : 'crosshair';
});

canvas.addEventListener('mouseleave', () => {
    hoverCritter = null;
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    const p = cellFromEvent(e);
    const c = critterAt(p.x, p.y);
    if (c) assignAbility(c, selectedAbility);
    draw();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function loadBest() {
    try {
        const raw = window.localStorage.getItem(BEST_KEY);
        best = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (e) {
        best = 0;
    }
}

var lastFrame = 0;
var accumulator = 0;

function frame(now) {
    if (!lastFrame) lastFrame = now;
    const dt = Math.min(now - lastFrame, 250);
    lastFrame = now;
    if (autoRun && state === 'running') {
        accumulator += dt;
        while (accumulator >= TICK_MS) {
            simStep();
            accumulator -= TICK_MS;
            if (state !== 'running') break;
        }
    } else {
        accumulator = 0;
        ticks++;
    }
    draw();
    requestAnimationFrame(frame);
}

loadBest();
loadLevel(1);
showOverlay('FLOCK TO THE FOLD', '', 'Press Space or click Start to play');
draw();
requestAnimationFrame(frame);
