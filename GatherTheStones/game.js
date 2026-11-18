// Gather the Stones
// "And he fenced it, and gathered out the stones thereof, and planted it with
//  the choicest vine." - Isaiah 5:2
//
// A woven basket keeps a threshing stone in the air; every field stone it
// strikes is knocked loose and gathered in. Clear five fields and the vineyard
// is planted.
//
// The simulation is advanced through `step(dt)` in fixed sub-steps so that
// Playwright can simulate frames deterministically instead of depending on
// requestAnimationFrame timing. Tests set `autoAdvance = false` to freeze the
// frame loop and `giftChance` to pin the gift drop rate.

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const FRAME = 14;                                   // stone-and-earth border
const FIELD = {
    x: FRAME,
    y: FRAME,
    w: canvas.width - FRAME * 2,
    h: canvas.height - FRAME,                       // the bottom edge is open
};

const COLS = 12;
const GRID_ROWS = 9;
const CELL_W = FIELD.w / COLS;                      // 41
const CELL_H = 22;
const GRID_TOP = 128;

// ---------------------------------------------------------------------------
// Stones, fields and gifts
// ---------------------------------------------------------------------------

const STONES = {
    loose: { hp: 1, points: 10, fill: '#d9bd92', edge: '#ac8d62', chip: '#c3a376' },
    packed: { hp: 2, points: 20, fill: '#b0784a', edge: '#7e5330', chip: '#92603a' },
    boulder: { hp: 3, points: 30, fill: '#8d939b', edge: '#5c626b', chip: '#737a83' },
    bedrock: { hp: Infinity, points: 0, fill: '#4b4238', edge: '#2b251e', chip: '#3a332b' },
};

const LEVELS = [
    {
        name: 'Stony field',
        rows: [
            'llllllllllll',
            'llllllllllll',
            'l.llllllll.l',
            '....llll....',
        ],
    },
    {
        name: 'Terraced slope',
        rows: [
            '.pppppppppp.',
            'llllllllllll',
            '..pppppppp..',
            '...llllll...',
        ],
    },
    {
        name: 'Thorn hedge',
        rows: [
            '.pppppppppp.',
            'llll....llll',
            '.XppppppppX.',
            '...llllll...',
        ],
    },
    {
        name: 'Old wall',
        rows: [
            '...bbbbbb...',
            '.pppppppppp.',
            'llllllllllll',
            'X...llll...X',
        ],
    },
    {
        name: 'Vineyard gate',
        rows: [
            '....bbbb....',
            '..bbppppbb..',
            '.ppllllllpp.',
            'Xppll..llppX',
            '..bb....bb..',
        ],
    },
];

const GIFTS = {
    wide: { label: 'Wide basket', mark: 'W', colour: '#7ccf86', weight: 3, duration: 20 },
    slow: { label: 'Steady hand', mark: 'S', colour: '#63a9e6', weight: 3, duration: 15 },
    three: { label: 'Three stones', mark: '3', colour: '#e4b954', weight: 2, duration: 0 },
    catch: { label: 'Sticky pitch', mark: 'C', colour: '#c686de', weight: 2, duration: 20 },
    helper: { label: 'Extra helper', mark: '+', colour: '#e8705f', weight: 1, duration: 0 },
};

const GIFT_KINDS = Object.keys(GIFTS);
const TIMED_GIFTS = GIFT_KINDS.filter((k) => GIFTS[k].duration > 0);

const BASE_SPEED = 320;
const MAX_SPEED = 540;
const SLOW_FACTOR = 0.72;
const MIN_ANGLE = 0.3;              // ~17 degrees off vertical, so no stone can stall
const STALL_AFTER = 5;              // seconds without a hit before the basket varies its bounce
const MAX_LIVES = 5;
const GIFT_FALL = 125;
const GIFT_W = 28;
const GIFT_H = 18;
const BEST_KEY = 'gather-the-stones-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let state = 'title';        // title | ready | playing | paused | levelComplete | gameOver | won
let score = 0;
let best = 0;
let lives = 3;
let levelIndex = 0;
let gathered = 0;           // stones gathered this game, used to ramp the speed
let bricks = [];
let balls = [];
let powerups = [];
let effects = [];
let timers = { wide: 0, slow: 0, catch: 0 };
let giftChance = 0.22;
let autoAdvance = true;
let seed = 20250517;
let sinceHit = 0;           // seconds since a stone was last struck

const paddle = {
    x: canvas.width / 2,
    y: 548,
    w: 92,
    baseW: 92,
    wideW: 132,
    h: 14,
    speed: 460,
};

const keys = { left: false, right: false };

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const el = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    lives: document.getElementById('lives'),
    field: document.getElementById('field'),
    fieldName: document.getElementById('field-name'),
    stones: document.getElementById('stones'),
    gifts: document.getElementById('gifts'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    overlaySub: document.getElementById('overlay-sub'),
    btnStart: document.getElementById('btn-start'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function setSeed(n) {
    seed = n >>> 0;
}

function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

function brickRect(r, c) {
    return { x: FIELD.x + c * CELL_W, y: GRID_TOP + r * CELL_H, w: CELL_W, h: CELL_H };
}

function brickAt(r, c) {
    return bricks[r] ? bricks[r][c] || null : null;
}

function aliveBreakable() {
    let n = 0;
    for (const row of bricks) {
        for (const b of row) if (b && b.type !== 'bedrock') n++;
    }
    return n;
}

function ballSpeed() {
    const base = Math.min(MAX_SPEED, BASE_SPEED + 18 * levelIndex + 8 * Math.floor(gathered / 8));
    return timers.slow > 0 ? base * SLOW_FACTOR : base;
}

function clampPaddle() {
    paddle.x = clamp(paddle.x, FIELD.x + paddle.w / 2, FIELD.x + FIELD.w - paddle.w / 2);
}

function newBall() {
    return { x: paddle.x, y: paddle.y - 9, vx: 0, vy: 0, r: 7, held: true, hold: 0 };
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function buildBricks(level) {
    const grid = [];
    for (let r = 0; r < GRID_ROWS; r++) {
        const row = new Array(COLS).fill(null);
        const spec = level.rows[r];
        if (spec) {
            for (let c = 0; c < COLS; c++) {
                const type = { l: 'loose', p: 'packed', b: 'boulder', X: 'bedrock' }[spec[c]];
                if (type) row[c] = { type, hp: STONES[type].hp, maxHp: STONES[type].hp };
            }
        }
        grid.push(row);
    }
    return grid;
}

function startLevel(i) {
    levelIndex = clamp(i, 0, LEVELS.length - 1);
    bricks = buildBricks(LEVELS[levelIndex]);
    powerups = [];
    effects = [];
    timers = { wide: 0, slow: 0, catch: 0 };
    paddle.w = paddle.baseW;
    paddle.x = canvas.width / 2;
    balls = [newBall()];
    sinceHit = 0;
    state = 'ready';
    hideOverlay();
    updateHud();
}

function startGame() {
    score = 0;
    lives = 3;
    gathered = 0;
    startLevel(0);
}

function launch() {
    let launched = false;
    for (const b of balls) {
        if (!b.held) continue;
        const off = clamp(b.hold / (paddle.w / 2), -1, 1);
        const angle = Math.abs(off) > 0.2 ? off * 1.0 : (off < 0 ? -1 : 1) * 0.35;
        const sp = ballSpeed();
        b.vx = Math.sin(angle) * sp;
        b.vy = -Math.cos(angle) * sp;
        b.held = false;
        b.hold = 0;
        launched = true;
    }
    if (launched && state === 'ready') state = 'playing';
    return launched;
}

// ---------------------------------------------------------------------------
// Gifts
// ---------------------------------------------------------------------------

function randomGiftKind() {
    const total = GIFT_KINDS.reduce((s, k) => s + GIFTS[k].weight, 0);
    let roll = rand() * total;
    for (const k of GIFT_KINDS) {
        roll -= GIFTS[k].weight;
        if (roll <= 0) return k;
    }
    return GIFT_KINDS[0];
}

function spawnGift(kind, x, y) {
    powerups.push({ kind, x, y, w: GIFT_W, h: GIFT_H, vy: GIFT_FALL, spin: 0 });
    return powerups[powerups.length - 1];
}

function scaleBalls(factor) {
    for (const b of balls) {
        b.vx *= factor;
        b.vy *= factor;
    }
}

function splitBalls() {
    if (!balls.length) return;
    const src = balls[0];
    if (src.held) launch();
    const sp = Math.hypot(src.vx, src.vy) || ballSpeed();
    const base = Math.atan2(src.vy, src.vx);
    const extra = [];
    for (const d of [-0.45, 0.45]) {
        const a = base + d;
        extra.push({
            x: src.x,
            y: src.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            r: src.r,
            held: false,
            hold: 0,
        });
    }
    balls = [src, ...extra, ...balls.slice(1)];
}

function applyGift(kind) {
    const gift = GIFTS[kind];
    if (!gift) return;
    if (kind === 'wide') {
        timers.wide = gift.duration;
        paddle.w = paddle.wideW;
        clampPaddle();
    } else if (kind === 'slow') {
        if (timers.slow <= 0) scaleBalls(SLOW_FACTOR);
        timers.slow = gift.duration;
    } else if (kind === 'catch') {
        timers.catch = gift.duration;
    } else if (kind === 'three') {
        splitBalls();
    } else if (kind === 'helper') {
        lives = Math.min(MAX_LIVES, lives + 1);
    }
    updateHud();
}

function expireGift(kind) {
    if (kind === 'wide') {
        paddle.w = paddle.baseW;
        clampPaddle();
    } else if (kind === 'slow') {
        scaleBalls(1 / SLOW_FACTOR);
    } else if (kind === 'catch') {
        if (state === 'playing') launch();
    }
}

function tickTimers(dt) {
    for (const k of TIMED_GIFTS) {
        if (timers[k] > 0) {
            timers[k] -= dt;
            if (timers[k] <= 0) {
                timers[k] = 0;
                expireGift(k);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

function burst(x, y, colour, n) {
    for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2;
        const sp = 40 + rand() * 150;
        effects.push({
            x,
            y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 40,
            life: 0.35 + rand() * 0.4,
            age: 0,
            size: 1.5 + rand() * 2.5,
            colour,
        });
    }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function hitBrick(r, c, b) {
    sinceHit = 0;
    const brick = bricks[r][c];
    const stone = STONES[brick.type];
    const rect = brickRect(r, c);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (brick.type === 'bedrock') {
        burst(cx, cy, stone.chip, 4);
        return;
    }
    brick.hp -= 1;
    if (brick.hp > 0) {
        burst(b.x, b.y, stone.chip, 5);
        return;
    }
    bricks[r][c] = null;
    score += stone.points;
    gathered += 1;
    burst(cx, cy, stone.fill, 12);
    if (rand() < giftChance) spawnGift(randomGiftKind(), cx, cy);
    updateHud();
}

// Resolves the ball against at most one brick, on the axis of least penetration.
function collideBricks(b) {
    const c0 = Math.max(0, Math.floor((b.x - b.r - FIELD.x) / CELL_W));
    const c1 = Math.min(COLS - 1, Math.floor((b.x + b.r - FIELD.x) / CELL_W));
    const r0 = Math.max(0, Math.floor((b.y - b.r - GRID_TOP) / CELL_H));
    const r1 = Math.min(GRID_ROWS - 1, Math.floor((b.y + b.r - GRID_TOP) / CELL_H));
    let pick = null;
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (!bricks[r] || !bricks[r][c]) continue;
            const rect = brickRect(r, c);
            const dx = b.x - (rect.x + rect.w / 2);
            const dy = b.y - (rect.y + rect.h / 2);
            const ox = b.r + rect.w / 2 - Math.abs(dx);
            const oy = b.r + rect.h / 2 - Math.abs(dy);
            if (ox <= 0 || oy <= 0) continue;
            const depth = Math.min(ox, oy);
            if (!pick || depth > pick.depth) pick = { r, c, dx, dy, ox, oy, depth };
        }
    }
    if (!pick) return false;
    if (pick.ox < pick.oy) {
        const dir = pick.dx >= 0 ? 1 : -1;
        b.x += dir * pick.ox;
        b.vx = Math.abs(b.vx) * dir;
    } else {
        const dir = pick.dy >= 0 ? 1 : -1;
        b.y += dir * pick.oy;
        b.vy = Math.abs(b.vy) * dir;
    }
    hitBrick(pick.r, pick.c, b);
    return true;
}

function collidePaddle(b) {
    if (b.vy <= 0) return;
    const top = paddle.y;
    const bottom = paddle.y + paddle.h;
    if (b.y + b.r < top || b.y - b.r > bottom) return;
    if (Math.abs(b.x - paddle.x) > paddle.w / 2 + b.r) return;
    if (timers.catch > 0) {
        b.held = true;
        b.hold = clamp(b.x - paddle.x, -paddle.w / 2, paddle.w / 2);
        b.vx = 0;
        b.vy = 0;
        b.x = paddle.x + b.hold;
        b.y = paddle.y - b.r - 2;
        return;
    }
    const off = clamp((b.x - paddle.x) / (paddle.w / 2), -1, 1);
    const sp = Math.hypot(b.vx, b.vy);
    let angle = off * 1.08;
    // A stone bouncing straight up and down would ride a cleared column for ever,
    // so the basket always gives it some sideways travel.
    if (Math.abs(angle) < MIN_ANGLE) {
        const side = angle !== 0 ? Math.sign(angle) : rand() < 0.5 ? -1 : 1;
        angle = side * MIN_ANGLE;
    }
    // Perfect play plus a fixed bounce angle can lock the stone into a loop that
    // never reaches the last stone, so after a while the basket varies the angle.
    if (sinceHit > STALL_AFTER) {
        // The longer the stone goes without striking anything, the wider the
        // basket throws it, so a last lone stone is always found in the end.
        const spread = Math.min(1.8, 0.5 + 0.25 * (sinceHit - STALL_AFTER));
        angle = clamp(angle + (rand() - 0.5) * spread, -1.2, 1.2);
        if (Math.abs(angle) < MIN_ANGLE) angle = Math.sign(angle || 1) * MIN_ANGLE;
    }
    b.vx = Math.sin(angle) * sp;
    b.vy = -Math.cos(angle) * sp;
    b.y = top - b.r - 0.5;
}

function moveBall(b, dt) {
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const n = Math.max(1, Math.ceil(dist / (b.r * 0.8)));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        if (b.x - b.r < FIELD.x) {
            b.x = FIELD.x + b.r;
            b.vx = Math.abs(b.vx);
        }
        if (b.x + b.r > FIELD.x + FIELD.w) {
            b.x = FIELD.x + FIELD.w - b.r;
            b.vx = -Math.abs(b.vx);
        }
        if (b.y - b.r < FIELD.y) {
            b.y = FIELD.y + b.r;
            b.vy = Math.abs(b.vy);
        }
        collideBricks(b);
        collidePaddle(b);
        if (b.y - b.r > canvas.height) {
            b.dead = true;
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function loseLife() {
    lives -= 1;
    timers = { wide: 0, slow: 0, catch: 0 };
    paddle.w = paddle.baseW;
    clampPaddle();
    powerups = [];
    if (lives <= 0) {
        lives = 0;
        finish('gameOver');
        return;
    }
    balls = [newBall()];
    state = 'ready';
}

function finish(result) {
    state = result;
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* private browsing - the run simply is not recorded */
        }
    }
    updateHud();
    showOverlay();
}

function completeField() {
    score += 100 * (levelIndex + 1);
    gathered += 2;
    if (levelIndex >= LEVELS.length - 1) {
        finish('won');
    } else {
        state = 'levelComplete';
        updateHud();
        showOverlay();
    }
}

function step(dt) {
    if (state !== 'ready' && state !== 'playing') return;
    dt = Math.min(Math.max(dt, 0), 1 / 20);
    if (dt <= 0) return;

    // Basket
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir) paddle.x += dir * paddle.speed * dt;
    clampPaddle();

    tickTimers(dt);
    sinceHit += dt;

    // Stones
    for (const b of balls) {
        if (b.held) {
            b.x = paddle.x + b.hold;
            b.y = paddle.y - b.r - 2;
        } else {
            moveBall(b, dt);
        }
    }
    const kept = balls.filter((b) => !b.dead);
    const lost = kept.length !== balls.length;
    balls = kept;

    // Gifts
    for (const p of powerups) {
        p.y += p.vy * dt;
        p.spin += dt * 3;
        const caught =
            p.y + p.h / 2 >= paddle.y &&
            p.y - p.h / 2 <= paddle.y + paddle.h &&
            Math.abs(p.x - paddle.x) <= paddle.w / 2 + p.w / 2;
        if (caught) {
            p.gone = true;
            score += 25;
            burst(p.x, p.y, GIFTS[p.kind].colour, 10);
            applyGift(p.kind);
        } else if (p.y - p.h > canvas.height) {
            p.gone = true;
        }
    }
    powerups = powerups.filter((p) => !p.gone);

    // Particles
    for (const f of effects) {
        f.age += dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 420 * dt;
    }
    effects = effects.filter((f) => f.age < f.life);

    if (aliveBreakable() === 0) {
        completeField();
        return;
    }
    if (lost && balls.length === 0) {
        loseLife();
        return;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

let giftSig = '';

function updateGifts() {
    const active = TIMED_GIFTS.filter((k) => timers[k] > 0);
    const sig = active.join(',');
    if (sig !== giftSig) {
        giftSig = sig;
        el.gifts.innerHTML = active
            .map(
                (k) =>
                    `<div class="gift" data-kind="${k}" style="--gift:${GIFTS[k].colour}">` +
                    `<span>${GIFTS[k].label}</span><i></i></div>`
            )
            .join('');
    }
    for (const k of active) {
        const bar = el.gifts.querySelector(`.gift[data-kind="${k}"] i`);
        if (bar) bar.style.width = `${Math.round((100 * timers[k]) / GIFTS[k].duration)}%`;
    }
}

function updateHud() {
    el.score.textContent = String(score);
    el.best.textContent = String(best);
    el.lives.textContent = String(lives);
    el.field.textContent = String(levelIndex + 1);
    el.fieldName.textContent = LEVELS[levelIndex].name;
    el.stones.textContent = String(aliveBreakable());
    updateGifts();
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

function showOverlay() {
    const texts = {
        title: {
            title: 'GATHER THE STONES',
            sub: 'Press Space or click Start Work to clear the field',
            score: '',
            btn: 'Start Work',
        },
        paused: { title: 'PAUSED', sub: 'Press P to carry on', score: '', btn: 'Resume' },
        levelComplete: {
            title: 'FIELD CLEARED',
            sub: `Next field: ${LEVELS[Math.min(levelIndex + 1, LEVELS.length - 1)].name}`,
            score: `Score ${score}`,
            btn: 'Next field',
        },
        gameOver: {
            title: 'FIELD UNFINISHED',
            sub: 'The stones are still in the ground - try again',
            score: `Score ${score} · Best ${best}`,
            btn: 'Work again',
        },
        won: {
            title: 'THE VINEYARD IS PLANTED',
            sub: 'Every field is clear - "he gathered out the stones thereof"',
            score: `Score ${score} · Best ${best}`,
            btn: 'Work again',
        },
    };
    const t = texts[state];
    if (!t) {
        hideOverlay();
        return;
    }
    el.overlayTitle.textContent = t.title;
    el.overlaySub.textContent = t.sub;
    el.overlayScore.textContent = t.score;
    el.btnStart.textContent = t.btn;
    el.overlay.classList.add('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function act() {
    if (state === 'title' || state === 'gameOver' || state === 'won') startGame();
    else if (state === 'levelComplete') startLevel(levelIndex + 1);
    else if (state === 'paused') resume();
    else launch();
}

function togglePause() {
    if (state === 'playing' || state === 'ready') {
        state = 'paused';
        showOverlay();
    } else if (state === 'paused') {
        resume();
    }
}

function resume() {
    state = balls.length && balls.every((b) => b.held) ? 'ready' : 'playing';
    hideOverlay();
}

window.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
            keys.left = true;
            e.preventDefault();
            break;
        case 'ArrowRight':
        case 'KeyD':
            keys.right = true;
            e.preventDefault();
            break;
        case 'Space':
            act();
            e.preventDefault();
            break;
        case 'KeyP':
            togglePause();
            e.preventDefault();
            break;
        case 'KeyR':
            startGame();
            e.preventDefault();
            break;
        default:
            break;
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    paddle.x = x;
    clampPaddle();
});

canvas.addEventListener('click', () => act());
el.btnStart.addEventListener('click', () => act());

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// A seeded scatter of pebbles and wall stones, built once so the soil and the
// wall do not shimmer from frame to frame.
const SCENERY = (() => {
    let n = 987654321;
    const r = () => ((n = (n * 1103515245 + 12345) >>> 0) / 4294967296);
    const pebbles = [];
    for (let i = 0; i < 90; i++) {
        pebbles.push({
            x: FIELD.x + r() * FIELD.w,
            y: GRID_TOP + 120 + r() * (canvas.height - GRID_TOP - 150),
            w: 2 + r() * 4,
            h: 1.5 + r() * 2.5,
            a: 0.04 + r() * 0.07,
        });
    }
    const wall = [];
    for (let y = -6; y < canvas.height + 10; y += 15) {
        wall.push({ y, h: 11 + r() * 5, off: r() * 3, shade: 0.1 + r() * 0.28, side: 0 });
        wall.push({ y: y + 7, h: 11 + r() * 5, off: r() * 3, shade: 0.1 + r() * 0.28, side: 1 });
    }
    const top = [];
    for (let x = -6; x < canvas.width + 10; x += 17) {
        top.push({ x, w: 13 + r() * 5, shade: 0.1 + r() * 0.26 });
    }
    return { pebbles, wall, top };
})();

function drawBackground() {
    const soil = ctx.createLinearGradient(0, 0, 0, canvas.height);
    soil.addColorStop(0, '#34271a');
    soil.addColorStop(0.5, '#412f1e');
    soil.addColorStop(1, '#251a11');
    ctx.fillStyle = soil;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Furrows: the ground has been worked, but the stones are still in it.
    for (let y = GRID_TOP + 80; y < canvas.height - 10; y += 38) {
        const g = ctx.createLinearGradient(0, y - 8, 0, y + 8);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
        g.addColorStop(0.5, 'rgba(255, 221, 167, 0.05)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(FIELD.x, y);
        ctx.bezierCurveTo(
            FIELD.x + FIELD.w * 0.33, y - 7,
            FIELD.x + FIELD.w * 0.67, y + 7,
            FIELD.x + FIELD.w, y
        );
        ctx.lineTo(FIELD.x + FIELD.w, y + 7);
        ctx.bezierCurveTo(
            FIELD.x + FIELD.w * 0.67, y + 14,
            FIELD.x + FIELD.w * 0.33, y,
            FIELD.x, y + 7
        );
        ctx.closePath();
        ctx.fill();
    }

    // Pebbles left in the soil.
    for (const p of SCENERY.pebbles) {
        ctx.fillStyle = `rgba(243, 226, 198, ${p.a})`;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.w, p.h, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // The name of the field, set into the ground behind the stones.
    ctx.save();
    ctx.font = '600 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 223, 170, 0.08)';
    ctx.textAlign = 'center';
    ctx.fillText(LEVELS[levelIndex].name.toUpperCase(), canvas.width / 2, GRID_TOP - 30);
    ctx.restore();

    drawWall();
}

// The field wall: dry-stacked stones down each side and along the top.
function drawWall() {
    ctx.fillStyle = '#5d4631';
    ctx.fillRect(0, 0, canvas.width, FRAME);
    ctx.fillRect(0, 0, FRAME, canvas.height);
    ctx.fillRect(canvas.width - FRAME, 0, FRAME, canvas.height);

    for (const s of SCENERY.wall) {
        const x = s.side ? canvas.width - FRAME + 1 : 1;
        ctx.fillStyle = `rgba(255, 233, 199, ${s.shade * 0.3})`;
        roundRect(x + s.off * 0.4, s.y, FRAME - 2 - s.off * 0.4, s.h, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    for (const s of SCENERY.top) {
        ctx.fillStyle = `rgba(255, 233, 199, ${s.shade * 0.3})`;
        roundRect(s.x, 1, s.w, FRAME - 2, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    // the inside edge of the wall catches the light
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(FRAME, FRAME, FIELD.w, 2);
    ctx.fillRect(FRAME - 2, FRAME, 2, canvas.height - FRAME);
    ctx.fillRect(canvas.width - FRAME, FRAME, 2, canvas.height - FRAME);
}

function drawStones() {
    for (let r = 0; r < GRID_ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const brick = bricks[r] && bricks[r][c];
            if (!brick) continue;
            const stone = STONES[brick.type];
            const rect = brickRect(r, c);
            const x = rect.x + 2;
            const y = rect.y + 2;
            const w = rect.w - 4;
            const h = rect.h - 4;
            const wear = brick.maxHp > 1 ? 1 - (brick.maxHp - brick.hp) / brick.maxHp : 1;
            ctx.save();
            ctx.globalAlpha = 0.55 + 0.45 * wear;
            const g = ctx.createLinearGradient(x, y, x, y + h);
            g.addColorStop(0, stone.fill);
            g.addColorStop(1, stone.edge);
            ctx.fillStyle = g;
            roundRect(x, y, w, h, 5);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // speckles, so the stones look like stone rather than bricks
            ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.fillRect(x + 4, y + 3, w - 12, 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
            ctx.fillRect(x + 6, y + h - 5, w - 14, 2);
            if (brick.maxHp > 1 && brick.hp < brick.maxHp) {
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.beginPath();
                ctx.moveTo(x + w * 0.25, y + 2);
                ctx.lineTo(x + w * 0.45, y + h * 0.6);
                ctx.lineTo(x + w * 0.7, y + h - 2);
                ctx.stroke();
            }
            ctx.restore();
        }
    }
}

function drawBasket() {
    const x = paddle.x - paddle.w / 2;
    const y = paddle.y;
    const g = ctx.createLinearGradient(0, y, 0, y + paddle.h);
    g.addColorStop(0, '#d9a85f');
    g.addColorStop(1, '#8c6027');
    ctx.fillStyle = g;
    roundRect(x, y, paddle.w, paddle.h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // weave
    ctx.strokeStyle = 'rgba(70, 42, 12, 0.5)';
    for (let i = 8; i < paddle.w - 4; i += 10) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 2);
        ctx.lineTo(x + i - 4, y + paddle.h - 2);
        ctx.stroke();
    }
    if (timers.catch > 0) {
        ctx.strokeStyle = GIFTS.catch.colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x + paddle.w - 2, y - 2);
        ctx.stroke();
    }
}

function drawBalls() {
    for (const b of balls) {
        const g = ctx.createRadialGradient(b.x - 2, b.y - 3, 1, b.x, b.y, b.r + 1);
        g.addColorStop(0, '#fdf4e4');
        g.addColorStop(1, '#9b8f7c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function drawGifts() {
    for (const p of powerups) {
        const gift = GIFTS[p.kind];
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.sin(p.spin) * 0.15);
        ctx.fillStyle = gift.colour;
        roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#20170d';
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gift.mark, 0, 1);
        ctx.restore();
    }
}

function drawEffects() {
    for (const f of effects) {
        ctx.globalAlpha = Math.max(0, 1 - f.age / f.life);
        ctx.fillStyle = f.colour;
        ctx.fillRect(f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
    ctx.globalAlpha = 1;
}

function draw() {
    drawBackground();
    drawStones();
    drawGifts();
    drawBasket();
    drawBalls();
    drawEffects();
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 15) : 0;
    lastTs = ts;
    if (autoAdvance && dt > 0) step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

try {
    best = Number(window.localStorage.getItem(BEST_KEY)) || 0;
} catch (e) {
    best = 0;
}

bricks = buildBricks(LEVELS[0]);
balls = [newBall()];
state = 'title';
updateHud();
showOverlay();
requestAnimationFrame(frame);
