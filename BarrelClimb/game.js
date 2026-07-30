// ---------------------------------------------------------------------------
// Barrel Climb — a ladder-and-girder climbing arcade game on an HTML5 canvas.
//
// A machine at the top of the scaffold spits out barrels that zig-zag down the
// girders. The player runs, jumps and climbs from the bottom floor to the prize
// on the top floor without being flattened. Written as a single classic
// (non-module) script so the game state and logic are reachable from the
// Playwright tests as plain globals, mirroring Kaboom!, Snake and Tetris in this
// repo. All motion is expressed per-second and advanced through `step(dt)`, so
// the tests can simulate frames deterministically without depending on
// requestAnimationFrame wall-clock timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 480;
const GIRDER_H = 12;           // drawn thickness of a girder (below its surface)

// Girders, bottom floor first. `y` is the surface the player and barrels stand
// on; the alternating left/right gaps are what make the barrels zig-zag down.
const platforms = [
    { x: 0, w: 600, y: 450 },
    { x: 60, w: 540, y: 360 },
    { x: 0, w: 540, y: 270 },
    { x: 60, w: 540, y: 180 },
    { x: 0, w: 540, y: 90 },
];
const TOP_FLOOR = platforms.length - 1;

// A ladder joins `platforms[floor]` (bottom) to `platforms[floor + 1]` (top).
const ladders = [
    { x: 520, floor: 0 },
    { x: 100, floor: 1 },
    { x: 480, floor: 2 },
    { x: 120, floor: 3 },
];
const LADDER_W = 26;
const LADDER_GRAB = 14;        // how close to a ladder's centre you must stand

// --- Player ---
const PLAYER_W = 18;
const PLAYER_H = 26;
const RUN_SPEED = 160;         // px/s
const CLIMB_SPEED = 96;        // px/s
const JUMP_V = -380;           // px/s, upward
const GRAVITY = 1400;          // px/s²
const PLAYER_START = { x: 40, floor: 0 };

// --- Barrels ---
const BARREL_R = 11;
const BARREL_BASE = 150, BARREL_STEP = 18;      // roll speed by level
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.22, SPAWN_MIN = 0.9; // seconds between drops
const LADDER_DESCENT = 110;    // px/s while a barrel climbs down a ladder
const LADDER_CHANCE = 0.4;     // odds a barrel takes a ladder it rolls over
const MACHINE_X = 40;          // where barrels appear on the top floor

// --- Scoring ---
const JUMP_POINTS = 100;       // for hurdling a barrel
const BONUS_START = 5000;      // banked when you reach the prize
const BONUS_RATE = 100;        // bonus lost per second
const START_LIVES = 3;

// --- The prize, sitting at the far end of the top floor ---
const GOAL = { x: 500, w: 44, h: 34 };

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const bonusEl = document.getElementById('bonus');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
// Declared with `var` so the tests can also reach them as `window.<name>`.
var state, score, best, level, lives, bonus, spawnTimer, seed;
const player = { x: PLAYER_START.x, y: platforms[0].y, vy: 0, dir: 0, climbDir: 0, onGround: true, climbing: false, ladder: null, face: 1, walk: 0 };
const barrels = [];

// ---------------------------------------------------------------------------
// Seeded RNG — keeps a run reproducible for the tests (and for replayable luck)
// ---------------------------------------------------------------------------

function setSeed(n) {
    seed = n >>> 0;
}

function rng() {
    // xorshift32
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
}

// ---------------------------------------------------------------------------
// Difficulty helpers (pure functions of `level`)
// ---------------------------------------------------------------------------

function barrelSpeed() { return BARREL_BASE + (level - 1) * BARREL_STEP; }
function spawnInterval() { return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * SPAWN_STEP); }

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function onPlatform(p, x) { return x >= p.x && x <= p.x + p.w; }

// Index of the girder the player is standing on, or -1 while airborne.
function floorAt(y) {
    for (let i = 0; i < platforms.length; i++) {
        if (platforms[i].y === y) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function setPlayerX(x) {
    player.x = clamp(x, PLAYER_W / 2, CANVAS_W - PLAYER_W / 2);
}

function placePlayerOnFloor(floor, x) {
    setPlayerX(x);
    player.y = platforms[floor].y;
    player.vy = 0;
    player.onGround = true;
    player.climbing = false;
    player.ladder = null;
}

function movePlayer(dir) {
    player.dir = dir;
    if (dir !== 0) player.face = dir;
}

function climb(dir) {
    player.climbDir = dir;
}

function jump() {
    if (state !== 'running') return;
    if (!player.onGround || player.climbing) return;
    player.vy = JUMP_V;
    player.onGround = false;
}

// The ladder the player can currently use, or null. A ladder is usable from the
// girder at either of its ends, and stays "current" while climbing it.
function isOnLadder() {
    if (player.climbing) return player.ladder;
    if (!player.onGround) return null;
    for (const l of ladders) {
        if (Math.abs(player.x - l.x) > LADDER_GRAB) continue;
        if (player.y === platforms[l.floor].y || player.y === platforms[l.floor + 1].y) return l;
    }
    return null;
}

// Ladder usable in a given vertical direction (+1 up, -1 down) from the ground.
function ladderFor(dir) {
    if (!player.onGround || dir === 0) return null;
    const floor = floorAt(player.y);
    if (floor < 0) return null;
    for (const l of ladders) {
        if (Math.abs(player.x - l.x) > LADDER_GRAB) continue;
        if (dir > 0 && l.floor === floor) return l;
        if (dir < 0 && l.floor + 1 === floor) return l;
    }
    return null;
}

function updatePlayer(dt) {
    // --- climbing ---
    if (!player.climbing) {
        const l = ladderFor(player.climbDir);
        if (l) {
            player.climbing = true;
            player.ladder = l;
            player.x = l.x;
            player.vy = 0;
            player.onGround = false;
        }
    }

    if (player.climbing) {
        const l = player.ladder;
        const topY = platforms[l.floor + 1].y;
        const bottomY = platforms[l.floor].y;
        player.y -= CLIMB_SPEED * player.climbDir * dt;
        if (player.climbDir !== 0) player.walk += dt * 6;
        if (player.climbDir > 0 && player.y <= topY) {
            player.y = topY;
            player.climbing = false;
            player.ladder = null;
            player.onGround = true;
        } else if (player.climbDir < 0 && player.y >= bottomY) {
            player.y = bottomY;
            player.climbing = false;
            player.ladder = null;
            player.onGround = true;
        } else {
            player.y = clamp(player.y, topY, bottomY);
        }
        return;
    }

    // --- running ---
    if (player.dir !== 0) {
        setPlayerX(player.x + player.dir * RUN_SPEED * dt);
        player.walk += dt * 10;
    }

    // --- gravity & landing (girders are one-way: you rise through them) ---
    const prevY = player.y;
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    player.onGround = false;
    if (player.vy >= 0) {
        for (const p of platforms) {
            if (prevY <= p.y && player.y >= p.y && onPlatform(p, player.x)) {
                player.y = p.y;
                player.vy = 0;
                player.onGround = true;
                break;
            }
        }
    }
    if (player.y > CANVAS_H + 60) loseLife();
}

// ---------------------------------------------------------------------------
// Barrels
// ---------------------------------------------------------------------------

function spawnBarrel(opts) {
    opts = opts || {};
    const floor = opts.floor != null ? opts.floor : TOP_FLOOR;
    const barrel = {
        x: opts.x != null ? opts.x : MACHINE_X,
        y: platforms[floor].y - BARREL_R,
        vy: 0,
        dir: opts.dir != null ? opts.dir : 1,
        floor,
        falling: false,
        onLadder: false,
        targetFloor: -1,
        jumped: false,
        wantsLadder: opts.wantsLadder != null ? opts.wantsLadder : null,
        spin: 0,
    };
    barrels.push(barrel);
    return barrel;
}

// A ladder the barrel would step onto going down, if it crosses one this frame.
function ladderCrossed(barrel, prevX) {
    for (const l of ladders) {
        if (l.floor !== barrel.floor - 1) continue;
        const crossed = (prevX - l.x) * (barrel.x - l.x) <= 0;
        if (crossed) return l;
    }
    return null;
}

function updateBarrels(dt) {
    for (let i = barrels.length - 1; i >= 0; i--) {
        const b = barrels[i];

        if (b.onLadder) {
            const targetY = platforms[b.targetFloor].y - BARREL_R;
            b.y += LADDER_DESCENT * dt;
            b.spin += dt * 4;
            if (b.y >= targetY) {
                b.y = targetY;
                b.floor = b.targetFloor;
                b.onLadder = false;
                b.targetFloor = -1;
            }
            continue;
        }

        if (b.falling) {
            const prevY = b.y;
            b.vy += GRAVITY * dt;
            b.y += b.vy * dt;
            b.spin += dt * 3;
            let landed = false;
            for (let f = 0; f < platforms.length; f++) {
                const p = platforms[f];
                const surface = p.y - BARREL_R;
                if (prevY <= surface && b.y >= surface && onPlatform(p, b.x)) {
                    b.y = surface;
                    b.vy = 0;
                    b.floor = f;
                    b.falling = false;
                    b.dir = -b.dir;      // bounce back the other way along the girder
                    landed = true;
                    break;
                }
            }
            if (!landed && b.y > CANVAS_H + BARREL_R * 4) barrels.splice(i, 1);
            continue;
        }

        // rolling along a girder
        const prevX = b.x;
        const speed = barrelSpeed();
        b.x += b.dir * speed * dt;
        b.spin += (b.dir * speed * dt) / BARREL_R;

        const l = ladderCrossed(b, prevX);
        if (l) {
            const take = b.wantsLadder != null ? b.wantsLadder : rng() < LADDER_CHANCE;
            if (take) {
                b.x = l.x;
                b.onLadder = true;
                b.targetFloor = l.floor;
                continue;
            }
        }

        const p = platforms[b.floor];
        if (!onPlatform(p, b.x)) {
            b.falling = true;
            b.vy = 0;
        }
    }
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

// Points for clearing a barrel: airborne, directly above one, on the way over.
function scoreHurdles() {
    if (player.onGround || player.climbing) return;
    for (const b of barrels) {
        if (b.jumped) continue;
        if (Math.abs(player.x - b.x) > 26) continue;
        const clearance = b.y - player.y;
        if (clearance > BARREL_R && clearance < 70) {
            b.jumped = true;
            score += JUMP_POINTS;
        }
    }
}

function hitsPlayer(b) {
    const x1 = player.x - PLAYER_W / 2, x2 = player.x + PLAYER_W / 2;
    const y1 = player.y - PLAYER_H, y2 = player.y;
    const cx = clamp(b.x, x1, x2), cy = clamp(b.y, y1, y2);
    const dx = b.x - cx, dy = b.y - cy;
    return dx * dx + dy * dy < BARREL_R * BARREL_R;
}

function checkCollisions() {
    for (const b of barrels) {
        if (hitsPlayer(b)) {
            loseLife();
            return true;
        }
    }
    return false;
}

function atGoal() {
    return player.onGround
        && !player.climbing
        && player.y === platforms[TOP_FLOOR].y
        && Math.abs(player.x - GOAL.x) <= GOAL.w / 2;
}

function resetStage() {
    barrels.length = 0;
    placePlayerOnFloor(PLAYER_START.floor, PLAYER_START.x);
    player.dir = 0;
    player.climbDir = 0;
    player.face = 1;
    spawnTimer = spawnInterval();
}

function loseLife() {
    lives -= 1;
    resetStage();
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    bonus = BONUS_START;
    updateHud();
}

function completeLevel() {
    score += Math.round(bonus);
    level += 1;
    bonus = BONUS_START;
    resetStage();
    updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    updatePlayer(dt);
    updateBarrels(dt);
    scoreHurdles();
    if (checkCollisions()) return;

    if (atGoal()) {
        completeLevel();
        return;
    }

    bonus = Math.max(0, bonus - BONUS_RATE * dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        spawnBarrel();
        spawnTimer = spawnInterval();
    }

    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    level = 1;
    lives = START_LIVES;
    bonus = BONUS_START;
    resetStage();
    overlay.classList.remove('visible');
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('barrel-climb-best', String(best)); } catch (e) { /* ignore */ }
    }
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} — Level ${level}`;
    overlaySub.textContent = 'Press Space or click Play Again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score}`;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else if (state === 'paused') {
        state = 'running';
        overlay.classList.remove('visible');
    }
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    bonusEl.textContent = String(Math.round(bonus));
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawGirders() {
    for (const p of platforms) {
        ctx.fillStyle = '#d1466a';
        ctx.fillRect(p.x, p.y, p.w, GIRDER_H);
        ctx.fillStyle = '#8f2c46';
        ctx.fillRect(p.x, p.y + GIRDER_H - 3, p.w, 3);
        ctx.fillStyle = '#f2a0b5';
        for (let x = p.x + 8; x < p.x + p.w - 4; x += 24) {
            ctx.fillRect(x, p.y + 4, 3, 3);
        }
    }
}

function drawLadders() {
    for (const l of ladders) {
        const top = platforms[l.floor + 1].y;
        const bottom = platforms[l.floor].y + GIRDER_H;
        ctx.strokeStyle = '#63d2ff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(l.x - LADDER_W / 2, top);
        ctx.lineTo(l.x - LADDER_W / 2, bottom);
        ctx.moveTo(l.x + LADDER_W / 2, top);
        ctx.lineTo(l.x + LADDER_W / 2, bottom);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let y = top + 8; y < bottom; y += 12) {
            ctx.beginPath();
            ctx.moveTo(l.x - LADDER_W / 2, y);
            ctx.lineTo(l.x + LADDER_W / 2, y);
            ctx.stroke();
        }
    }
}

function drawMachine() {
    const y = platforms[TOP_FLOOR].y;
    ctx.fillStyle = '#7b5cff';
    ctx.fillRect(MACHINE_X - 24, y - 46, 48, 46);
    ctx.fillStyle = '#2a1b4d';
    ctx.fillRect(MACHINE_X - 14, y - 34, 28, 18);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(MACHINE_X - 6, y - 12, 12, 12);
    ctx.fillStyle = '#c9b8ff';
    ctx.fillRect(MACHINE_X - 24, y - 52, 48, 6);
}

function drawGoal() {
    const y = platforms[TOP_FLOOR].y;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(GOAL.x - 14, y - GOAL.h);
    ctx.lineTo(GOAL.x + 14, y - GOAL.h);
    ctx.lineTo(GOAL.x + 8, y - 12);
    ctx.lineTo(GOAL.x - 8, y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(GOAL.x - 12, y - 10, 24, 6);
    ctx.fillRect(GOAL.x - 4, y - 12, 8, 4);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
    ctx.beginPath();
    ctx.arc(GOAL.x, y - 20, 26, 0, Math.PI * 2);
    ctx.fill();
}

function drawBarrel(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.fillStyle = '#e08b3a';
    ctx.beginPath();
    ctx.arc(0, 0, BARREL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#8a4a12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-BARREL_R + 2, -4); ctx.lineTo(BARREL_R - 2, -4);
    ctx.moveTo(-BARREL_R + 2, 4); ctx.lineTo(BARREL_R - 2, 4);
    ctx.stroke();
    ctx.restore();
}

function drawPlayer() {
    const x = player.x, y = player.y;
    const bob = player.onGround && player.dir !== 0 ? Math.sin(player.walk) * 1.5 : 0;
    // legs
    ctx.fillStyle = '#2b6cff';
    const stride = player.climbing || player.dir !== 0 ? Math.sin(player.walk) * 4 : 0;
    ctx.fillRect(x - 7 + stride, y - 10, 5, 10);
    ctx.fillRect(x + 2 - stride, y - 10, 5, 10);
    // body
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x - PLAYER_W / 2, y - 20 + bob, PLAYER_W, 11);
    // head
    ctx.fillStyle = '#ffd9b3';
    ctx.fillRect(x - 6, y - 27 + bob, 12, 8);
    // cap
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x - 7, y - 29 + bob, 14, 3);
    ctx.fillRect(x - 7 + (player.face > 0 ? 7 : -3), y - 27 + bob, 6, 2);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // backdrop
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#160f26');
    grad.addColorStop(1, '#0b0714');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawGirders();
    drawGoal();
    drawMachine();
    for (const b of barrels) drawBarrel(b);
    drawPlayer();

    if (state === 'idle') {
        ctx.fillStyle = 'rgba(244, 236, 223, 0.5)';
        ctx.font = '13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Climb to the prize — hurdle the barrels', CANVAS_W / 2, CANVAS_H - 16);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Frame loop
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
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function refreshKeys() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    const up = heldKeys.has('ArrowUp') || heldKeys.has('w') || heldKeys.has('W');
    const down = heldKeys.has('ArrowDown') || heldKeys.has('s') || heldKeys.has('S');
    movePlayer((right ? 1 : 0) - (left ? 1 : 0));
    climb((up ? 1 : 0) - (down ? 1 : 0));
}

const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'a', 'A', 'd', 'D', 'w', 'W', 's', 'S'];

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') jump();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeys();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeys();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('barrel-climb-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
bonus = BONUS_START;
spawnTimer = SPAWN_BASE;
setSeed(20260730);
placePlayerOnFloor(PLAYER_START.floor, PLAYER_START.x);
updateHud();
requestAnimationFrame(frame);
