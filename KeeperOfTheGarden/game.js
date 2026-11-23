// Keeper of the Garden — a Centipede-style arcade game in the garden of Eden.
//
// "The LORD God took the man and put him in the garden of Eden to work it and
//  keep it." — Genesis 2:15
//
// The whole game lives in this one classic script so the Playwright tests can
// read the state directly. step(dt) is the only place the world changes, and it
// is kept separate from the animation loop so tests can advance time exactly.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// --- the garden ------------------------------------------------------------
const CELL = 20;
const COLS = 25;
const ROWS = 30;
const WIDTH = COLS * CELL;              // 500
const HEIGHT = ROWS * CELL;             // 600
const PLAYER_TOP_ROW = 23;              // the keeper's patch is the bottom 7 rows
const THISTLE_STAGES = 4;

// --- the keeper ------------------------------------------------------------
const PLAYER_SPEED = 180;               // px per second
const MAX_DROPS = 3;
const SPRAY_COOLDOWN = 110;             // ms between squirts
const DROP_SPEED = 430;                 // px per second, upward

// --- the creatures ---------------------------------------------------------
const SNAIL_SPEED = 115;
const SNAIL_INTERVAL = 9000;            // ms between snails
const BEE_SPEED = 230;
const BEE_DELAY = 1500;                 // ms before a bee may arrive
const MIN_PATCH_THISTLES = 5;           // below this, a bee comes to plant more

const SEGMENT_SCORE = 10;
const HEAD_SCORE = 100;
const SNAIL_SCORE = 300;
const BEE_SCORE = 200;
const WAVE_BONUS = 50;
const BEST_KEY = 'keeper-of-the-garden-best';
const MAX_SLICE = 16;                   // ms; physics is advanced in small slices

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'idle';                     // idle | running | paused | over
let score = 0;
let best = 0;
let lives = 3;
let level = 1;

let thistles = emptyField();            // thistles[row][col] = stages left
let caterpillars = [];                  // { cells: [{col,row,prevCol,prevRow}], dx, dy }
let drops = [];                         // { x, y }
let snail = null;
let bee = null;
let blooms = [];                        // little fading flowers, decoration only

let catProgress = 0;                    // ms accumulated toward the next grid step
let sprayCooldown = 0;
let snailTimer = SNAIL_INTERVAL;
let beeTimer = BEE_DELAY;
let animId = null;
let loopEnabled = true;                 // the tests freeze the loop and drive step() themselves
let lastFrame = 0;
let tick = 0;                           // frames drawn, used for gentle animation

const player = { x: WIDTH / 2, y: HEIGHT - 9, w: 18, h: 18 };
const keys = { left: false, right: false, up: false, down: false, spray: false };

// ---------------------------------------------------------------------------
// A small deterministic RNG so the tests can repeat a garden exactly
// ---------------------------------------------------------------------------
let rngState = 0x2f6e2b1;

function setSeed(n) {
    rngState = (n >>> 0) || 1;
}

function rnd() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The thistle field
// ---------------------------------------------------------------------------
function emptyField() {
    return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Sow thistles everywhere except the two rows the caterpillars enter on and the
// bottom row the keeper walks along.
function sowField() {
    const field = emptyField();
    for (let row = 2; row <= ROWS - 2; row++) {
        for (let col = 0; col < COLS; col++) {
            if (rnd() < 0.07) field[row][col] = THISTLE_STAGES;
        }
    }
    return field;
}

function thistleAt(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return 0;
    return thistles[row][col];
}

function plantThistle(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    if (thistles[row][col] === 0) thistles[row][col] = THISTLE_STAGES;
}

function thistleCount() {
    let n = 0;
    for (let row = 0; row < ROWS; row++)
        for (let col = 0; col < COLS; col++) if (thistles[row][col] > 0) n++;
    return n;
}

function patchThistleCount() {
    let n = 0;
    for (let row = PLAYER_TOP_ROW; row < ROWS; row++)
        for (let col = 0; col < COLS; col++) if (thistles[row][col] > 0) n++;
    return n;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function cellCenter(col, row) {
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

// Segments are grid-stepped but drawn (and hit-tested) between the cell they
// left and the cell they are entering, so a chain looks like it is crawling.
function segmentCenter(seg) {
    const t = Math.min(1, catProgress / stepInterval());
    const col = seg.prevCol + (seg.col - seg.prevCol) * t;
    const row = seg.prevRow + (seg.row - seg.prevRow) * t;
    return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

function stepInterval() {
    return Math.max(45, 130 - (level - 1) * 12);
}

function segmentCount() {
    return caterpillars.reduce((n, c) => n + c.cells.length, 0);
}

function cell(col, row) {
    return { col, row, prevCol: col, prevRow: row };
}

function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) <= (aw + bw) / 2 && Math.abs(ay - by) <= (ah + bh) / 2;
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------
function spawnWave() {
    caterpillars = [];
    const len = Math.min(14, 9 + level);
    const cells = [];
    for (let i = 0; i < len; i++) cells.push(cell(-i, 0));
    caterpillars.push({ cells, dx: 1, dy: 1 });

    const lone = Math.min(4, level - 1);
    for (let i = 0; i < lone; i++) {
        const col = 2 + Math.floor(rnd() * (COLS - 4));
        caterpillars.push({ cells: [cell(col, 0)], dx: rnd() < 0.5 ? -1 : 1, dy: 1 });
    }
    catProgress = 0;
}

function advanceWave() {
    score += WAVE_BONUS * level;
    level++;
    spawnWave();
}

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function resetPlayer() {
    player.x = WIDTH / 2;
    player.y = HEIGHT - player.h / 2;
}

function startGame() {
    score = 0;
    lives = 3;
    level = 1;
    thistles = sowField();
    drops = [];
    snail = null;
    bee = null;
    blooms = [];
    snailTimer = SNAIL_INTERVAL;
    beeTimer = BEE_DELAY;
    sprayCooldown = 0;
    resetPlayer();
    spawnWave();
    state = 'running';
    hideOverlay();
    updateHud();
    startLoop();
}

function loseLife() {
    lives--;
    drops = [];
    snail = null;
    bee = null;
    snailTimer = SNAIL_INTERVAL;
    beeTimer = BEE_DELAY;
    sprayCooldown = 0;
    resetPlayer();
    updateHud();
    if (lives <= 0) {
        endGame();
        return;
    }
    spawnWave();
}

function endGame() {
    state = 'over';
    let stored = 0;
    try {
        stored = Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
        stored = 0;
    }
    best = Math.max(stored, best, score);
    if (score > stored) {
        try {
            localStorage.setItem(BEST_KEY, String(score));
        } catch (e) {
            /* private mode — the best score simply is not kept */
        }
    }
    updateHud();
    showOverlay('The garden is overrun', String(score), 'Press Space to tend it again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Resting in the shade', '', 'Press P to keep tending the garden');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        startLoop();
    }
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
function squirt() {
    if (drops.length >= MAX_DROPS || sprayCooldown > 0) return;
    drops.push({ x: player.x, y: player.y - player.h / 2 });
    sprayCooldown = SPRAY_COOLDOWN;
}

function hitThistle(col, row) {
    thistles[row][col]--;
    score += 1;
    if (thistles[row][col] === 0) {
        score += 5;
        blooms.push({ ...cellCenter(col, row), t: 0, hue: 'thistle' });
    }
}

// Remove one segment: the part in front keeps crawling, the part behind becomes
// a caterpillar of its own, and a thistle springs up where the segment was.
function shooSegment(cat, idx) {
    const seg = cat.cells[idx];
    score += idx === 0 ? HEAD_SCORE : SEGMENT_SCORE;
    plantThistle(seg.col, seg.row);
    blooms.push({ ...segmentCenter(seg), t: 0, hue: 'segment' });

    const front = cat.cells.slice(0, idx);
    const back = cat.cells.slice(idx + 1);
    const parts = [];
    if (front.length) parts.push({ cells: front, dx: cat.dx, dy: cat.dy });
    if (back.length) parts.push({ cells: back, dx: cat.dx, dy: cat.dy });

    const at = caterpillars.indexOf(cat);
    caterpillars.splice(at, 1, ...parts);
    if (caterpillars.length === 0) advanceWave();
}

// ---------------------------------------------------------------------------
// Physics — step(dt) advances the world by dt milliseconds
// ---------------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;
    let left = Math.max(0, dt);
    do {
        const slice = Math.min(MAX_SLICE, left);
        stepWorld(slice);
        left -= slice;
    } while (left > 0 && state === 'running');
    updateHud();
}

function stepWorld(dt) {
    const dts = dt / 1000;

    moveKeeper(dts);

    sprayCooldown = Math.max(0, sprayCooldown - dt);
    if (keys.spray) squirt();

    moveCaterpillars(dt);
    moveSnail(dt, dts);
    moveBee(dt, dts);
    moveDrops(dts);
    for (const b of blooms) b.t += dt;
    blooms = blooms.filter((b) => b.t < 400);

    checkKeeperHit();
}

function moveKeeper(dts) {
    let vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    let vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (vx && vy) {
        vx *= Math.SQRT1_2;
        vy *= Math.SQRT1_2;
    }
    player.x += vx * PLAYER_SPEED * dts;
    player.y += vy * PLAYER_SPEED * dts;
    player.x = Math.max(player.w / 2, Math.min(WIDTH - player.w / 2, player.x));
    player.y = Math.max(
        PLAYER_TOP_ROW * CELL + player.h / 2,
        Math.min(HEIGHT - player.h / 2, player.y)
    );
}

function moveCaterpillars(dt) {
    if (caterpillars.length === 0) return;
    catProgress += dt;
    const interval = stepInterval();
    while (catProgress >= interval) {
        catProgress -= interval;
        for (const cat of caterpillars) crawl(cat);
    }
}

// Only the head decides where to go; every other segment replays its path.
function crawl(cat) {
    const head = cat.cells[0];
    let nextCol = head.col + cat.dx;
    let nextRow = head.row;

    if (nextCol < 0 || nextCol >= COLS || thistleAt(nextCol, nextRow) > 0) {
        cat.dx = -cat.dx;
        if (head.row + cat.dy < 0 || head.row + cat.dy >= ROWS) cat.dy = -cat.dy;
        nextCol = head.col;
        nextRow = head.row + cat.dy;
    }

    let carryCol = head.col;
    let carryRow = head.row;
    head.prevCol = head.col;
    head.prevRow = head.row;
    head.col = nextCol;
    head.row = nextRow;

    for (let i = 1; i < cat.cells.length; i++) {
        const seg = cat.cells[i];
        seg.prevCol = seg.col;
        seg.prevRow = seg.row;
        const takeCol = carryCol;
        const takeRow = carryRow;
        carryCol = seg.col;
        carryRow = seg.row;
        seg.col = takeCol;
        seg.row = takeRow;
    }
}

function moveSnail(dt, dts) {
    if (!snail) {
        snailTimer -= dt;
        if (snailTimer <= 0) spawnSnail();
        return;
    }
    snail.x += snail.vx * dts;
    snail.y += snail.vy * dts;

    const top = PLAYER_TOP_ROW * CELL + snail.r;
    const bottom = HEIGHT - snail.r;
    if (snail.y < top) {
        snail.y = top;
        snail.vy = Math.abs(snail.vy);
    }
    if (snail.y > bottom) {
        snail.y = bottom;
        snail.vy = -Math.abs(snail.vy);
    }

    const col = Math.floor(snail.x / CELL);
    const row = Math.floor(snail.y / CELL);
    if (thistleAt(col, row) > 0) thistles[row][col] = 0;

    if (snail.x < -24 || snail.x > WIDTH + 24) {
        snail = null;
        snailTimer = SNAIL_INTERVAL;
    }
}

function spawnSnail() {
    const fromLeft = rnd() < 0.5;
    const top = PLAYER_TOP_ROW * CELL;
    snail = {
        x: fromLeft ? -12 : WIDTH + 12,
        y: top + 12 + rnd() * (HEIGHT - top - 24),
        vx: fromLeft ? SNAIL_SPEED : -SNAIL_SPEED,
        vy: (rnd() < 0.5 ? 1 : -1) * SNAIL_SPEED * 0.7,
        r: 9,
    };
    snailTimer = SNAIL_INTERVAL;
}

function moveBee(dt, dts) {
    if (!bee) {
        beeTimer -= dt;
        if (beeTimer <= 0 && patchThistleCount() < MIN_PATCH_THISTLES) spawnBee();
        return;
    }
    bee.y += bee.speed * dts;
    const row = Math.floor(bee.y / CELL);
    if (row !== bee.lastRow) {
        if (row >= 2 && row <= ROWS - 2 && row % 2 === 0) {
            plantThistle(Math.floor(bee.x / CELL), row);
        }
        bee.lastRow = row;
    }
    if (bee.y > HEIGHT + 12) {
        bee = null;
        beeTimer = BEE_DELAY;
    }
}

function spawnBee() {
    const col = Math.floor(rnd() * COLS);
    bee = { x: col * CELL + CELL / 2, y: -12, speed: BEE_SPEED, hits: 0, lastRow: -99, w: 16, h: 16 };
    beeTimer = BEE_DELAY;
}

function moveDrops(dts) {
    for (let i = drops.length - 1; i >= 0; i--) {
        const drop = drops[i];
        drop.y -= DROP_SPEED * dts;
        if (drop.y < 0) {
            drops.splice(i, 1);
            continue;
        }
        if (dropHitsSomething(drop)) drops.splice(i, 1);
    }
}

function dropHitsSomething(drop) {
    for (const cat of caterpillars) {
        for (let i = 0; i < cat.cells.length; i++) {
            const c = segmentCenter(cat.cells[i]);
            if (Math.abs(drop.x - c.x) <= CELL / 2 && Math.abs(drop.y - c.y) <= CELL / 2) {
                shooSegment(cat, i);
                return true;
            }
        }
    }

    if (snail) {
        const dx = drop.x - snail.x;
        const dy = drop.y - snail.y;
        if (dx * dx + dy * dy <= (snail.r + 3) * (snail.r + 3)) {
            score += SNAIL_SCORE;
            blooms.push({ x: snail.x, y: snail.y, t: 0, hue: 'snail' });
            snail = null;
            snailTimer = SNAIL_INTERVAL;
            return true;
        }
    }

    if (bee && overlaps(drop.x, drop.y, 4, 4, bee.x, bee.y, bee.w, bee.h)) {
        bee.hits++;
        if (bee.hits >= 2) {
            score += BEE_SCORE;
            blooms.push({ x: bee.x, y: bee.y, t: 0, hue: 'bee' });
            bee = null;
            beeTimer = BEE_DELAY;
        } else {
            bee.speed *= 1.8;
        }
        return true;
    }

    const col = Math.floor(drop.x / CELL);
    const row = Math.floor(drop.y / CELL);
    if (thistleAt(col, row) > 0) {
        hitThistle(col, row);
        return true;
    }
    return false;
}

function checkKeeperHit() {
    for (const cat of caterpillars) {
        for (const seg of cat.cells) {
            const c = segmentCenter(seg);
            if (overlaps(player.x, player.y, player.w, player.h, c.x, c.y, CELL * 0.8, CELL * 0.8)) {
                loseLife();
                return;
            }
        }
    }
    if (snail) {
        const dx = player.x - snail.x;
        const dy = player.y - snail.y;
        const reach = snail.r + player.w / 2;
        if (dx * dx + dy * dy <= reach * reach) {
            loseLife();
            return;
        }
    }
    if (bee && overlaps(player.x, player.y, player.w, player.h, bee.x, bee.y, bee.w, bee.h)) {
        loseLife();
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw() {
    tick++;
    drawGarden();
    drawThistles();
    drawCaterpillars();
    drawBlooms();
    if (snail) drawSnail();
    if (bee) drawBee();
    drawDrops();
    drawKeeper();
}

function drawGarden() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#0a1a12');
    sky.addColorStop(0.75, '#0c2017');
    sky.addColorStop(1, '#102a1c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // furrows
    ctx.strokeStyle = 'rgba(134, 239, 172, 0.045)';
    ctx.lineWidth = 1;
    for (let col = 1; col < COLS; col++) {
        ctx.beginPath();
        ctx.moveTo(col * CELL + 0.5, 0);
        ctx.lineTo(col * CELL + 0.5, HEIGHT);
        ctx.stroke();
    }

    // the keeper's patch
    const top = PLAYER_TOP_ROW * CELL;
    ctx.fillStyle = 'rgba(74, 222, 128, 0.05)';
    ctx.fillRect(0, top, WIDTH, HEIGHT - top);
    ctx.strokeStyle = 'rgba(134, 239, 172, 0.22)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(WIDTH, top + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawThistles() {
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const health = thistles[row][col];
            if (health <= 0) continue;
            const { x, y } = cellCenter(col, row);
            const size = 3 + health * 1.7;
            ctx.fillStyle = ['#1f3b2a', '#2f6b45', '#3f9159', '#4ade80'][health - 1];
            // a little bush of three leaves
            ctx.beginPath();
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size, y + size * 0.8);
            ctx.lineTo(x - size, y + size * 0.8);
            ctx.closePath();
            ctx.fill();
            if (health === THISTLE_STAGES) {
                ctx.fillStyle = '#c084fc';
                ctx.beginPath();
                ctx.arc(x, y - size - 1.5, 2.1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function drawCaterpillars() {
    for (const cat of caterpillars) {
        for (let i = cat.cells.length - 1; i >= 0; i--) {
            const { x, y } = segmentCenter(cat.cells[i]);
            if (x < -CELL || x > WIDTH + CELL) continue;
            const r = i === 0 ? CELL / 2 - 1 : CELL / 2 - 2.5;
            ctx.fillStyle = i === 0 ? '#fbbf24' : i % 2 ? '#86efac' : '#4ade80';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(7, 16, 9, 0.55)';
            ctx.lineWidth = 1;
            ctx.stroke();

            if (i === 0) {
                // eyes, looking the way it crawls
                ctx.fillStyle = '#07100a';
                const ex = cat.dx * 2.6;
                ctx.beginPath();
                ctx.arc(x + ex, y - 2.6, 1.6, 0, Math.PI * 2);
                ctx.arc(x + ex, y + 2.6, 1.6, 0, Math.PI * 2);
                ctx.fill();
                // antennae
                ctx.strokeStyle = '#fbbf24';
                ctx.beginPath();
                ctx.moveTo(x + ex, y - 4);
                ctx.lineTo(x + ex + cat.dx * 4, y - 8);
                ctx.moveTo(x + ex, y + 4);
                ctx.lineTo(x + ex + cat.dx * 4, y + 8);
                ctx.stroke();
            } else {
                // feet
                ctx.strokeStyle = 'rgba(31, 59, 42, 0.9)';
                ctx.beginPath();
                ctx.moveTo(x - r, y + r - 1);
                ctx.lineTo(x - r - 2, y + r + 2);
                ctx.moveTo(x + r, y + r - 1);
                ctx.lineTo(x + r + 2, y + r + 2);
                ctx.stroke();
            }
        }
    }
}

function drawKeeper() {
    const { x, y } = player;
    // robe
    ctx.fillStyle = '#93c5fd';
    ctx.beginPath();
    ctx.moveTo(x, y - 9);
    ctx.lineTo(x + 7, y + 9);
    ctx.lineTo(x - 7, y + 9);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(x, y - 10, 4, 0, Math.PI * 2);
    ctx.fill();
    // watering can
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x + 4, y - 4, 6, 6);
    ctx.beginPath();
    ctx.moveTo(x + 10, y - 4);
    ctx.lineTo(x + 13, y - 8);
    ctx.lineTo(x + 11, y - 8);
    ctx.lineTo(x + 8, y - 4);
    ctx.closePath();
    ctx.fill();
}

function drawDrops() {
    ctx.fillStyle = '#bae6fd';
    for (const drop of drops) {
        ctx.beginPath();
        ctx.ellipse(drop.x, drop.y, 2.6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(186, 230, 253, 0.35)';
        ctx.fillRect(drop.x - 1, drop.y, 2, 8);
        ctx.fillStyle = '#bae6fd';
    }
}

function drawSnail() {
    const { x, y } = snail;
    const face = snail.vx > 0 ? 1 : -1;
    ctx.fillStyle = '#a8a29e';
    ctx.beginPath();
    ctx.ellipse(x + face * 4, y + 4, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.arc(x, y, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.3) {
        const r = 1.2 + a * 0.52;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.strokeStyle = '#a8a29e';
    ctx.beginPath();
    ctx.moveTo(x + face * 10, y + 2);
    ctx.lineTo(x + face * 13, y - 3);
    ctx.stroke();
}

function drawBee() {
    const { x, y } = bee;
    const wing = Math.sin(tick * 0.9) * 3;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
    ctx.beginPath();
    ctx.ellipse(x - 6, y - 4 + wing, 5, 3, -0.5, 0, Math.PI * 2);
    ctx.ellipse(x + 6, y - 4 - wing, 5, 3, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.ellipse(x, y, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(x - 5, y - 2, 10, 1.8);
    ctx.fillRect(x - 4, y + 2, 8, 1.8);
}

function drawBlooms() {
    for (const b of blooms) {
        const t = b.t / 400;
        const r = 4 + t * 12;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = b.hue === 'thistle' ? '#c084fc' : b.hue === 'segment' ? '#fef08a' : '#bae6fd';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------
const el = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    lives: document.getElementById('lives'),
    level: document.getElementById('level'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
    start: document.getElementById('btn-start'),
};

function updateHud() {
    el.score.textContent = String(score);
    el.best.textContent = String(best);
    el.lives.textContent = String(Math.max(0, lives));
    el.level.textContent = String(level);
}

function showOverlay(title, scoreText, sub) {
    el.title.textContent = title;
    el.overlayScore.textContent = scoreText;
    el.sub.textContent = sub;
    el.overlay.classList.add('visible');
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const MOVE_KEYS = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    a: 'left',
    A: 'left',
    d: 'right',
    D: 'right',
    w: 'up',
    W: 'up',
    s: 'down',
    S: 'down',
};

window.addEventListener('keydown', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar' || key.startsWith('Arrow')) e.preventDefault();

    if (state === 'idle' || state === 'over') {
        if (key === ' ' || key === 'Spacebar' || key === 'Enter' || key.startsWith('Arrow')) {
            startGame();
            return;
        }
    }
    if (key === 'p' || key === 'P') {
        togglePause();
        return;
    }
    if (key === 'r' || key === 'R') {
        startGame();
        return;
    }
    if (key === ' ' || key === 'Spacebar') {
        keys.spray = true;
        return;
    }
    if (MOVE_KEYS[key]) keys[MOVE_KEYS[key]] = true;
});

window.addEventListener('keyup', (e) => {
    const key = e.key;
    if (key === ' ' || key === 'Spacebar') {
        keys.spray = false;
        return;
    }
    if (MOVE_KEYS[key]) keys[MOVE_KEYS[key]] = false;
});

window.addEventListener('blur', () => {
    keys.left = keys.right = keys.up = keys.down = keys.spray = false;
});

el.start.addEventListener('click', () => {
    if (state !== 'running') startGame();
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
function loop(now) {
    animId = null;
    const elapsed = Math.min(50, now - lastFrame || 16);
    lastFrame = now;
    if (state === 'running') step(elapsed);
    draw();
    if (state === 'running') startLoop();
}

function startLoop() {
    if (!loopEnabled) return;
    if (animId === null) {
        lastFrame = performance.now();
        animId = requestAnimationFrame(loop);
    }
}

// Test hooks: freezeLoop() hands time over to step(dt) so a test can advance the
// world by an exact number of milliseconds; resumeLoop() gives it back.
function freezeLoop() {
    loopEnabled = false;
    if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
    }
}

function resumeLoop() {
    loopEnabled = true;
    startLoop();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
try {
    best = Number(localStorage.getItem(BEST_KEY)) || 0;
} catch (e) {
    best = 0;
}
setSeed((Date.now() ^ 0x5f3a) >>> 0);
updateHud();
draw();
