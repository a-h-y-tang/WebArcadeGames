// ---------------------------------------------------------------------------
// Air Hockey — a low-friction puck on a portrait rink, you (bottom mallet)
// versus an AI (top mallet). Knock the puck through the far goal to score.
//
// All motion is time-based (pixels per second) and integrated with a delta
// time `dt` (seconds). `update(dt)` is a pure physics step with no `state`
// gate, so tests can drive the simulation deterministically frame by frame.
// ---------------------------------------------------------------------------

const WIDTH = 460;
const HEIGHT = 700;

// Tunables
const PUCK_R = 16;
const MALLET_R = 30;
const GOAL_WIDTH = 180;             // width of each goal mouth, centred
const MALLET_SPEED = 520;           // player mallet, px / second (keyboard)
const AI_SPEED = 300;               // CPU mallet, px / second (below full → beatable)
const FRICTION = 0.45;              // per-second velocity decay (gentle: near-frictionless)
const SERVE_SPEED = 300;            // px / second, vertical serve component
const SERVE_SIDE_SPEED = 120;       // px / second, horizontal serve component
const MAX_PUCK_SPEED = 820;         // px / second cap
const MALLET_TRANSFER = 0.55;       // share of mallet velocity imparted to the puck
const WIN_SCORE = 7;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scorePlayerEl = document.getElementById('score-player');
const scoreCpuEl = document.getElementById('score-cpu');
const winsEl = document.getElementById('wins');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
let player, cpu, puck, playerScore, cpuScore, wins, state, keys, lastTime, animId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

const GOAL_X1 = (WIDTH - GOAL_WIDTH) / 2;
const GOAL_X2 = (WIDTH + GOAL_WIDTH) / 2;

// Confine a mallet to the walls and to its own half of the table (it may reach
// the centre line but not cross it). `bottom` = the player's (bottom) half.
function clampMallet(m, bottom) {
    m.x = clamp(m.x, m.r, WIDTH - m.r);
    if (bottom) m.y = clamp(m.y, HEIGHT / 2, HEIGHT - m.r);
    else m.y = clamp(m.y, m.r, HEIGHT / 2);
}

function capPuckSpeed() {
    const s = Math.hypot(puck.vx, puck.vy);
    if (s > MAX_PUCK_SPEED) {
        const k = MAX_PUCK_SPEED / s;
        puck.vx *= k;
        puck.vy *= k;
    }
}

function servePuck(towardTop) {
    puck.x = WIDTH / 2;
    puck.y = HEIGHT / 2;
    const vSign = towardTop ? -1 : 1;
    const hSign = (playerScore + cpuScore) % 2 === 0 ? 1 : -1;
    puck.vx = hSign * SERVE_SIDE_SPEED;
    puck.vy = vSign * SERVE_SPEED;
}

function resetMallets() {
    player.x = WIDTH / 2; player.y = HEIGHT - 90;
    cpu.x = WIDTH / 2; cpu.y = 90;
    player.vx = player.vy = cpu.vx = cpu.vy = 0;
    player.px = player.x; player.py = player.y;
    cpu.px = cpu.x; cpu.py = cpu.y;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
function startGame() {
    playerScore = 0;
    cpuScore = 0;
    keys = { up: false, down: false, left: false, right: false };
    resetMallets();
    servePuck((playerScore + cpuScore) % 2 === 0); // deterministic first serve

    scorePlayerEl.textContent = '0';
    scoreCpuEl.textContent = '0';
    overlay.classList.remove('visible');
    state = 'running';
    lastTime = null;
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame(winner) {
    state = 'over';
    if (winner === 'player') {
        wins++;
        winsEl.textContent = wins;
        localStorage.setItem('airhockey-wins', wins);
    }
    overlayTitle.textContent = winner === 'player' ? 'You Win!' : 'Game Over';
    overlayScore.textContent = `${playerScore} – ${cpuScore}`;
    overlaySub.textContent = winner === 'player'
        ? 'You beat the CPU — press an arrow to play again'
        : 'The CPU won — press an arrow to try again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

function handleGoal(scorer) {
    if (scorer === 'player') playerScore++;
    else cpuScore++;
    scorePlayerEl.textContent = playerScore;
    scoreCpuEl.textContent = cpuScore;

    if (playerScore >= WIN_SCORE) return endGame('player');
    if (cpuScore >= WIN_SCORE) return endGame('cpu');

    resetMallets();
    // Serve toward the side that conceded (they get first crack at the puck).
    servePuck(scorer === 'cpu' ? false : true);
}

// ---------------------------------------------------------------------------
// Physics — one deterministic step. No `state` gating on purpose.
// ---------------------------------------------------------------------------
function collideMallet(m) {
    const dx = puck.x - m.x;
    const dy = puck.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minDist = puck.r + m.r;
    if (dist >= minDist || dist === 0) return;

    const nx = dx / dist;
    const ny = dy / dist;

    // Push the puck clear of the mallet.
    puck.x = m.x + nx * minDist;
    puck.y = m.y + ny * minDist;

    // Reflect the puck's velocity about the contact normal (only if closing).
    const vrel = (puck.vx - m.vx) * nx + (puck.vy - m.vy) * ny;
    if (vrel < 0) {
        puck.vx -= 2 * vrel * nx;
        puck.vy -= 2 * vrel * ny;
    }
    // Impart a share of the mallet's own motion — a swipe sends it flying.
    puck.vx += m.vx * MALLET_TRANSFER;
    puck.vy += m.vy * MALLET_TRANSFER;
    capPuckSpeed();
}

function moveCpu(dt) {
    // Chase the puck while it's in the CPU's half, else drift back to home.
    let tx, ty;
    if (puck.y < HEIGHT / 2) {
        tx = puck.x;
        ty = Math.min(puck.y, HEIGHT / 2 - cpu.r);
    } else {
        tx = WIDTH / 2;
        ty = 90;
    }
    const dx = tx - cpu.x;
    const dy = ty - cpu.y;
    const d = Math.hypot(dx, dy);
    const step = AI_SPEED * dt;
    if (d > step) {
        cpu.x += (dx / d) * step;
        cpu.y += (dy / d) * step;
    } else {
        cpu.x = tx;
        cpu.y = ty;
    }
    clampMallet(cpu, false);
}

function update(dt) {
    // Player mallet (held keys; the mouse sets position directly elsewhere).
    player.x += ((keys.right ? 1 : 0) - (keys.left ? 1 : 0)) * MALLET_SPEED * dt;
    player.y += ((keys.down ? 1 : 0) - (keys.up ? 1 : 0)) * MALLET_SPEED * dt;
    clampMallet(player, true);

    // CPU mallet.
    moveCpu(dt);

    // Derive mallet velocities from how far each moved this frame.
    if (dt > 0) {
        player.vx = (player.x - player.px) / dt;
        player.vy = (player.y - player.py) / dt;
        cpu.vx = (cpu.x - cpu.px) / dt;
        cpu.vy = (cpu.y - cpu.py) / dt;
    }

    // Puck: friction, cap, integrate.
    const decay = Math.max(0, 1 - FRICTION * dt);
    puck.vx *= decay;
    puck.vy *= decay;
    capPuckSpeed();
    puck.x += puck.vx * dt;
    puck.y += puck.vy * dt;

    // Side walls (always reflect).
    if (puck.x - puck.r < 0) {
        puck.x = puck.r;
        puck.vx = Math.abs(puck.vx);
    } else if (puck.x + puck.r > WIDTH) {
        puck.x = WIDTH - puck.r;
        puck.vx = -Math.abs(puck.vx);
    }

    // Top / bottom walls — reflect except across the goal mouth.
    const inGoalX = puck.x > GOAL_X1 && puck.x < GOAL_X2;
    if (!inGoalX) {
        if (puck.y - puck.r < 0) {
            puck.y = puck.r;
            puck.vy = Math.abs(puck.vy);
        } else if (puck.y + puck.r > HEIGHT) {
            puck.y = HEIGHT - puck.r;
            puck.vy = -Math.abs(puck.vy);
        }
    }

    // Mallet collisions.
    collideMallet(player);
    collideMallet(cpu);

    // Goals — the puck fully clears an end.
    if (puck.y + puck.r < 0) handleGoal('player');
    else if (puck.y - puck.r > HEIGHT) handleGoal('cpu');

    // Remember mallet positions for next frame's velocity.
    player.px = player.x; player.py = player.y;
    cpu.px = cpu.x; cpu.py = cpu.y;
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
function loop(timestamp) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)

    update(dt);
    draw();
    animId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    // Table
    ctx.fillStyle = '#0a1626';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Centre line + circle
    ctx.strokeStyle = '#1e3050';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2);
    ctx.lineTo(WIDTH, HEIGHT / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2, 70, 0, Math.PI * 2);
    ctx.stroke();

    // Goal mouths
    ctx.strokeStyle = '#f07083';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(GOAL_X1, 3); ctx.lineTo(GOAL_X2, 3);
    ctx.moveTo(GOAL_X1, HEIGHT - 3); ctx.lineTo(GOAL_X2, HEIGHT - 3);
    ctx.stroke();

    // Mallets
    drawMallet(cpu, '#7dd3fc');
    drawMallet(player, '#f07083');

    // Puck
    ctx.fillStyle = '#e6edf3';
    ctx.shadowColor = '#e6edf3';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawMallet(m, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05070d';
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 0.32, 0, Math.PI * 2);
    ctx.fill();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const HELD = {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
};

function isStartKey(k) {
    return k in HELD || k === ' ' || k === 'Spacebar' || k === 'Enter';
}

document.addEventListener('keydown', e => {
    const k = e.key;

    // Pause toggle
    if (k === 'p' || k === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from an overlay
    if (state !== 'running') {
        if (isStartKey(k)) {
            startGame();
            // fall through so a movement key also registers as held
        } else {
            return;
        }
    }

    if (k in HELD) {
        keys[HELD[k]] = true;
        e.preventDefault();
    }
});

document.addEventListener('keyup', e => {
    const k = e.key;
    if (k in HELD) keys[HELD[k]] = false;
});

canvas.addEventListener('mousemove', e => {
    if (state !== 'running') return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    player.x = (e.clientX - rect.left) * scaleX;
    player.y = (e.clientY - rect.top) * scaleY;
    clampMallet(player, true);
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init — a still, centred table behind the start overlay.
// ---------------------------------------------------------------------------
wins = parseInt(localStorage.getItem('airhockey-wins') || '0', 10);
winsEl.textContent = wins;
playerScore = 0;
cpuScore = 0;
keys = { up: false, down: false, left: false, right: false };
player = { x: WIDTH / 2, y: HEIGHT - 90, vx: 0, vy: 0, px: WIDTH / 2, py: HEIGHT - 90, r: MALLET_R };
cpu = { x: WIDTH / 2, y: 90, vx: 0, vy: 0, px: WIDTH / 2, py: 90, r: MALLET_R };
puck = { x: WIDTH / 2, y: HEIGHT / 2, vx: 0, vy: 0, r: PUCK_R };
state = 'idle';
draw();
