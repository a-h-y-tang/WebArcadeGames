// --- Constants ---
const W = 400;
const H = 600;
const VISIBLE = 8;            // trunk segments shown at once (index 0 = bottom)
const SEG_H = 60;             // height of a trunk segment, px
const TRUNK_W = 70;           // trunk width, px
const TRUNK_X = (W - TRUNK_W) / 2;
const GROUND_Y = H - 44;      // top of the ground strip
const BRANCH_W = 62;          // how far a branch reaches out from the trunk
const BRANCH_H = 22;

const CHOP_GAIN = 0.13;       // timer refilled per chop
const DRAIN_BASE = 0.30;      // timer drained per second at score 0
const DRAIN_PER_SCORE = 0.01; // extra drain per point
const DRAIN_MAX = 0.75;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let state;        // 'idle' | 'running' | 'over'
let trunk;        // array of { branch: 'left'|'right'|'none' }, index 0 = bottom
let player;       // { side: 'left'|'right' }
let score, best;
let timer;        // 0..1 remaining time
let chunks;       // flying log pieces (visual only)
let chopFlash;    // frames of axe-swing highlight remaining
let hitSide;      // which side got hit (for the game-over pose)
let lastTime, animId;

// A new segment's branch. Never forces a loss (only one side per segment).
function randomSegment(avoidBranch) {
    if (avoidBranch || Math.random() < 0.42) return { branch: 'none' };
    return { branch: Math.random() < 0.5 ? 'left' : 'right' };
}

function buildTrunk() {
    const t = [];
    for (let i = 0; i < VISIBLE; i++) {
        // Keep the bottom two segments clear so the first chop is always fair.
        t.push(randomSegment(i < 2));
    }
    return t;
}

function drainRate() {
    return Math.min(DRAIN_BASE + score * DRAIN_PER_SCORE, DRAIN_MAX);
}

function startGame() {
    state = 'running';
    trunk = buildTrunk();
    player = { side: 'left' };
    score = 0;
    timer = 1;
    chunks = [];
    chopFlash = 0;
    hitSide = null;
    lastTime = null;

    scoreEl.textContent = score;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function chop(side) {
    if (state !== 'running') return;

    player.side = side;
    chopFlash = 6;

    // The segment one above the bottom is dropping to the player's level.
    const incoming = trunk[1];
    if (incoming && incoming.branch === side) {
        hitSide = side;
        endGame();
        return;
    }

    // Fling the chopped-off bottom segment away for effect.
    chunks.push({
        x: TRUNK_X, y: GROUND_Y - SEG_H,
        vx: side === 'left' ? 260 : -260,
        vy: -240, rot: 0,
        vr: side === 'left' ? 8 : -8,
    });

    trunk.shift();
    trunk.push(randomSegment(false));
    score++;
    scoreEl.textContent = score;
    timer = Math.min(1, timer + CHOP_GAIN);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('lumberjack-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press ← / → or Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

// --- Main loop ---
function loop(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05;

    if (state === 'running') {
        timer -= drainRate() * dt;
        if (timer <= 0) {
            timer = 0;
            endGame();
        }
        if (chopFlash > 0) chopFlash--;
    }
    stepChunks(dt);
    draw();

    if (state === 'running' || chunks.length) {
        animId = requestAnimationFrame(loop);
    }
}

function stepChunks(dt) {
    for (const c of chunks) {
        c.vy += 1400 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
    }
    chunks = chunks.filter(c => c.y < H + 120);
}

// --- Rendering ---
function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d1117');
    g.addColorStop(1, '#161b22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Ground strip.
    ctx.fillStyle = '#1e2a1e';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = '#2f4a2f';
    ctx.fillRect(0, GROUND_Y, W, 4);
}

function drawSegment(seg, i) {
    const y = GROUND_Y - (i + 1) * SEG_H;

    // Trunk block with bark shading.
    ctx.fillStyle = '#7a4a24';
    ctx.fillRect(TRUNK_X, y, TRUNK_W, SEG_H);
    ctx.fillStyle = '#633a1b';
    ctx.fillRect(TRUNK_X, y, 10, SEG_H);
    ctx.fillStyle = '#8f5a2c';
    ctx.fillRect(TRUNK_X + TRUNK_W - 12, y, 12, SEG_H);
    ctx.strokeStyle = '#4a2c14';
    ctx.lineWidth = 2;
    ctx.strokeRect(TRUNK_X + 1, y + 1, TRUNK_W - 2, SEG_H - 2);

    // Branch.
    if (seg.branch === 'left' || seg.branch === 'right') {
        const by = y + (SEG_H - BRANCH_H) / 2;
        const bx = seg.branch === 'left' ? TRUNK_X - BRANCH_W : TRUNK_X + TRUNK_W;
        ctx.fillStyle = '#63401f';
        ctx.fillRect(bx, by + BRANCH_H / 2 - 4, BRANCH_W, 8);
        // Leaves.
        ctx.fillStyle = '#3f7d3f';
        const leafX = seg.branch === 'left' ? bx : bx + BRANCH_W;
        ctx.beginPath();
        ctx.arc(leafX, by + BRANCH_H / 2, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4ea34e';
        ctx.beginPath();
        ctx.arc(leafX + (seg.branch === 'left' ? -8 : 8), by + BRANCH_H / 2 - 6, 12, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawLumberjack() {
    const onLeft = player.side === 'left';
    const cx = onLeft ? TRUNK_X - 42 : TRUNK_X + TRUNK_W + 42;
    const feetY = GROUND_Y;
    const dir = onLeft ? 1 : -1; // facing toward the trunk

    // Body.
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(cx - 12, feetY - 46, 24, 28);
    // Head.
    ctx.fillStyle = '#f0c39a';
    ctx.beginPath();
    ctx.arc(cx, feetY - 56, 11, 0, Math.PI * 2);
    ctx.fill();
    // Cap.
    ctx.fillStyle = '#2b6cb0';
    ctx.fillRect(cx - 12, feetY - 66, 24, 7);
    // Legs.
    ctx.fillStyle = '#3a3f4b';
    ctx.fillRect(cx - 11, feetY - 20, 9, 20);
    ctx.fillRect(cx + 2, feetY - 20, 9, 20);

    // Axe swinging toward the trunk (raised, or striking on chop flash).
    const striking = chopFlash > 0;
    ctx.save();
    ctx.translate(cx + dir * 10, feetY - 40);
    ctx.rotate(dir * (striking ? 0.15 : -0.9));
    ctx.strokeStyle = '#8a5a2b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 34, -6);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(dir * 30, -14);
    ctx.lineTo(dir * 46, -10);
    ctx.lineTo(dir * 44, 4);
    ctx.lineTo(dir * 28, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawChunks() {
    for (const c of chunks) {
        ctx.save();
        ctx.translate(c.x + TRUNK_W / 2, c.y + SEG_H / 2);
        ctx.rotate(c.rot);
        ctx.fillStyle = '#7a4a24';
        ctx.fillRect(-TRUNK_W / 2, -SEG_H / 2, TRUNK_W, SEG_H);
        ctx.strokeStyle = '#4a2c14';
        ctx.lineWidth = 2;
        ctx.strokeRect(-TRUNK_W / 2, -SEG_H / 2, TRUNK_W, SEG_H);
        ctx.restore();
    }
}

function drawTimerBar() {
    const pad = 40, barW = W - pad * 2, barH = 12, y = 18;
    ctx.fillStyle = '#21262d';
    ctx.beginPath();
    ctx.roundRect(pad, y, barW, barH, 6);
    ctx.fill();

    const frac = Math.max(0, Math.min(1, timer));
    // Green when full, shifting to red as it drains.
    const hue = 120 * frac;
    ctx.fillStyle = `hsl(${hue}, 70%, 48%)`;
    ctx.beginPath();
    ctx.roundRect(pad, y, Math.max(0, barW * frac), barH, 6);
    ctx.fill();
}

function draw() {
    drawBackground();
    for (let i = 0; i < trunk.length; i++) drawSegment(trunk[i], i);
    drawChunks();
    if (state !== 'idle') drawLumberjack();
    if (state === 'running') drawTimerBar();
}

// --- Input ---
function action(side) {
    if (state === 'running') {
        chop(side);
    } else {
        startGame();
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        action('left');
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        action('right');
    } else if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (state !== 'running') startGame();
    }
});

canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state !== 'running') {
        startGame();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    chop(x < rect.width / 2 ? 'left' : 'right');
});

btnStart.addEventListener('click', e => {
    e.stopPropagation();
    if (state !== 'running') startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('lumberjack-best') || '0', 10);
bestEl.textContent = best;
state = 'idle';
trunk = buildTrunk();
player = { side: 'left' };
score = 0;
timer = 1;
chunks = [];
chopFlash = 0;
draw();
