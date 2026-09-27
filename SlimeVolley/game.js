// ---------------------------------------------------------------------------
// Slime Volley — a two-slime physics volleyball match on an HTML5 canvas.
//
// The player controls the left slime (a half-disc that walks and jumps); the
// computer controls the right one. A ball falls under gravity and bounces off
// the walls, the ceiling, the net and the domes of both slimes. Whoever lets
// the ball touch the sand on their own side concedes a point; first to
// WIN_SCORE points takes the match.
//
// Written as a single classic (non-module) script so state and logic are
// reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Tetris in this repo. All motion is expressed per-second and
// advanced through `step(dt)` in fixed sub-steps, so tests can simulate frames
// deterministically without depending on requestAnimationFrame timing.
// ---------------------------------------------------------------------------

// --- Court geometry ---
const CANVAS_W = 600;
const CANVAS_H = 400;
const GROUND_Y = 340;               // the sand line the slimes stand on
const NET_W = 8;
const NET_X = CANVAS_W / 2;         // net post centre
const NET_H = 90;
const NET_TOP = GROUND_Y - NET_H;

// --- Slimes ---
const SLIME_R = 32;                 // radius of the dome
const MOVE_SPEED = 300;             // px/s of walking
const JUMP_V = 740;                 // px/s of launch velocity
const SLIME_GRAVITY = 2200;         // px/s² pulling the slimes down
const AI_SPEED = 268;               // the rival walks a shade slower than you
const AI_REST_X = NET_X + (CANVAS_W - NET_X) / 2;

// --- Ball ---
const BALL_R = 11;
const GRAVITY = 1100;               // px/s² on the ball
const MIN_HIT_SPEED = 380;          // a hit never leaves the ball limp
const MAX_BALL_SPEED = 900;         // ...nor uncontrollably fast
const HIT_PUSH_X = 0.45;            // how much slime walking speed is imparted
const HIT_PUSH_Y = 0.35;            // ...and how much of an upward jump
const AIM_MIN_X = 0.32;             // a dead-on hit still carries over the net

// --- Match ---
const WIN_SCORE = 7;
const SERVE_DELAY = 0.7;            // seconds the ball hangs before a serve drops

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreP1El = document.getElementById('score-p1');
const scoreP2El = document.getElementById('score-p2');
const rallyEl = document.getElementById('rally');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, scoreP1, scoreP2, rally, bestRally, server, serveTimer;
const player = { x: NET_X / 2, y: GROUND_Y, vx: 0, vy: 0, dir: 0 };
const ai = { x: AI_REST_X, y: GROUND_Y, vx: 0, vy: 0 };
const ball = { x: NET_X / 2, y: 120, vx: 0, vy: 0 };
const sparks = [];

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Each slime is confined to its own half: the walls on the outside, the net
// post on the inside.
function clampPlayer(x) {
    return clamp(x, SLIME_R, NET_X - NET_W / 2 - SLIME_R);
}

function clampAi(x) {
    return clamp(x, NET_X + NET_W / 2 + SLIME_R, CANVAS_W - SLIME_R);
}

// ---------------------------------------------------------------------------
// Player controls
// ---------------------------------------------------------------------------

function movePlayer(dir) {
    player.dir = dir;
}

function jump() {
    if (state !== 'running') return;
    if (player.y >= GROUND_Y) player.vy = -JUMP_V;
}

// Place the ball and put it straight into play. Used by the tests to set up a
// situation, and by nothing else in the game itself.
function setBall(x, y, vx, vy) {
    ball.x = x;
    ball.y = y;
    ball.vx = vx || 0;
    ball.vy = vy || 0;
    serveTimer = 0;
}

// ---------------------------------------------------------------------------
// Serving & scoring
// ---------------------------------------------------------------------------

function serve(who) {
    server = who;
    ball.x = who === 'p1' ? NET_X / 2 : AI_REST_X;
    ball.y = 120;
    ball.vx = 0;
    ball.vy = 0;
    serveTimer = SERVE_DELAY;
}

// The ball touched the sand: the side it landed on concedes the point.
function scorePoint() {
    const winner = ball.x < NET_X ? 'p2' : 'p1';
    spawnSparks(ball.x, GROUND_Y);
    if (rally > bestRally) saveBest(rally);
    rally = 0;
    if (winner === 'p1') scoreP1 += 1; else scoreP2 += 1;
    serve(winner);
    if (scoreP1 >= WIN_SCORE || scoreP2 >= WIN_SCORE) endGame(winner);
}

function saveBest(value) {
    bestRally = value;
    try { localStorage.setItem('slime-volley-best', String(bestRally)); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

// Ball against the outer walls and the ceiling.
function collideBounds() {
    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    else if (ball.x > CANVAS_W - BALL_R) { ball.x = CANVAS_W - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }
}

// Ball against the net (a rectangle standing on the sand). A ball whose centre
// is level with the post is pushed out sideways; one coming down onto the rim
// is reflected off the nearest point of the post, so tape shots are possible.
function collideNet() {
    const left = NET_X - NET_W / 2;
    const right = NET_X + NET_W / 2;
    const cx = clamp(ball.x, left, right);
    const cy = clamp(ball.y, NET_TOP, GROUND_Y);
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    if (dx * dx + dy * dy >= BALL_R * BALL_R) return;

    if (ball.y >= NET_TOP) {
        // Side of the post.
        if (ball.x < NET_X) { ball.x = left - BALL_R; ball.vx = -Math.abs(ball.vx); }
        else { ball.x = right + BALL_R; ball.vx = Math.abs(ball.vx); }
        return;
    }

    // Top rim / corner: reflect about the contact normal.
    const dist = Math.hypot(dx, dy);
    const nx = dist > 1e-6 ? dx / dist : 0;
    const ny = dist > 1e-6 ? dy / dist : -1;
    ball.x = cx + nx * BALL_R;
    ball.y = cy + ny * BALL_R;
    const dot = ball.vx * nx + ball.vy * ny;
    if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
    }
}

// Ball against a slime's dome. Only the upper half of the disc is solid — a
// ball level with the sand can never be scooped from underneath. `aimDir` is
// the direction of the opponent's court (+1 for the left slime, -1 for the
// right one): a ball struck dead-centre is angled that way instead of going
// straight up, so a rally always makes progress across the net.
function collideSlime(slime, aimDir) {
    if (ball.y > slime.y) return false;
    const dx = ball.x - slime.x;
    const dy = ball.y - slime.y;
    const reach = SLIME_R + BALL_R;
    const dist = Math.hypot(dx, dy);
    if (dist >= reach) return false;

    const nx = dist > 1e-6 ? dx / dist : 0;
    const ny = dist > 1e-6 ? dy / dist : -1;

    // Lift the ball clear so it can never be left inside the dome.
    ball.x = slime.x + nx * (reach + 0.01);
    ball.y = slime.y + ny * (reach + 0.01);

    // The ball leaves along the contact normal — angled toward the far court
    // when the contact is nearly vertical — keeping its pace (within limits)
    // and picking up some of the slime's own motion.
    let ax = nx;
    let ay = ny;
    if (Math.abs(ax) < AIM_MIN_X) {
        ax = aimDir * AIM_MIN_X;
        ay = -Math.sqrt(1 - ax * ax);
    }
    const speed = clamp(Math.hypot(ball.vx, ball.vy), MIN_HIT_SPEED, MAX_BALL_SPEED);
    let vx = ax * speed + slime.vx * HIT_PUSH_X;
    let vy = ay * speed + Math.min(0, slime.vy) * HIT_PUSH_Y;
    const out = Math.hypot(vx, vy);
    if (out > MAX_BALL_SPEED) {
        vx = vx / out * MAX_BALL_SPEED;
        vy = vy / out * MAX_BALL_SPEED;
    }
    ball.vx = vx;
    ball.vy = vy;
    rally += 1;
    spawnSparks(ball.x, ball.y);
    return true;
}

// ---------------------------------------------------------------------------
// Opponent AI
// ---------------------------------------------------------------------------

// A deliberately simple rival: it shadows the ball (with a little lead) while
// the ball is on its half, drifts back to the middle of its court otherwise,
// and jumps at balls arriving above dome height.
function updateAi(h) {
    const incoming = ball.x > NET_X;
    const target = clampAi(incoming ? ball.x + ball.vx * 0.12 : AI_REST_X);
    const dx = target - ai.x;
    ai.vx = Math.abs(dx) > 4 ? Math.sign(dx) * AI_SPEED : 0;
    ai.x = clampAi(ai.x + ai.vx * h);

    const overhead = ball.y < GROUND_Y - SLIME_R - 20 && ball.y > 90;
    if (incoming && ai.y >= GROUND_Y && overhead && Math.abs(ball.x - ai.x) < 70) {
        ai.vy = -JUMP_V;
    }
}

// A slime under gravity, landing back on the sand.
function integrateSlime(slime, h) {
    slime.vy += SLIME_GRAVITY * h;
    slime.y += slime.vy * h;
    if (slime.y >= GROUND_Y) {
        slime.y = GROUND_Y;
        slime.vy = 0;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    // Player.
    player.vx = player.dir * MOVE_SPEED;
    player.x = clampPlayer(player.x + player.vx * h);
    integrateSlime(player, h);

    // Rival.
    updateAi(h);
    integrateSlime(ai, h);

    // The ball hangs still for a beat at the start of each point.
    if (serveTimer > 0) {
        serveTimer -= h;
        return;
    }

    // Ball.
    ball.vy += GRAVITY * h;
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;

    collideBounds();
    collideNet();
    if (!collideSlime(player, 1)) collideSlime(ai, -1);

    if (ball.y + BALL_R >= GROUND_Y) scorePoint();
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast balls
// can never tunnel through the net or a slime, and so the integration is
// resolution-independent.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        substep(h);
        remaining -= h;
        if (state !== 'running') break;
    }
    updateHud();
}

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    scoreP1 = 0;
    scoreP2 = 0;
    rally = 0;
    player.x = NET_X / 2;
    player.y = GROUND_Y;
    player.vx = 0;
    player.vy = 0;
    player.dir = 0;
    ai.x = AI_REST_X;
    ai.y = GROUND_Y;
    ai.vx = 0;
    ai.vy = 0;
    sparks.length = 0;
    serve('p1');
    hideOverlay();
    updateHud();
}

function endGame(winner) {
    if (state === 'over') return;
    state = 'over';
    if (rally > bestRally) saveBest(rally);
    const won = winner === 'p1';
    showOverlay(
        won ? 'You Win!' : 'You Lose!',
        scoreP1 + ' – ' + scoreP2,
        'Press Space to play again',
        'Play Again',
    );
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', scoreP1 + ' – ' + scoreP2, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreP1El.textContent = String(scoreP1);
    scoreP2El.textContent = String(scoreP2);
    rallyEl.textContent = String(rally);
    bestEl.textContent = String(bestRally);
}

function showOverlay(title, scoreText, sub, buttonText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = buttonText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Impact sparks (purely cosmetic)
// ---------------------------------------------------------------------------

function spawnSparks(x, y) {
    for (let i = 0; i < 7; i++) {
        sparks.push({
            x, y,
            vx: (Math.random() - 0.5) * 180,
            vy: (Math.random() - 0.5) * 180,
            life: 0.35,
        });
    }
}

function updateSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0) sparks.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSlime(slime, body, eyeSide) {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(slime.x, slime.y, SLIME_R, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // Glossy highlight across the top of the dome.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.ellipse(slime.x - eyeSide * 8, slime.y - SLIME_R * 0.55, 11, 5, -eyeSide * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Eye, looking toward the ball.
    const ex = slime.x + eyeSide * 12;
    const ey = slime.y - 16;
    ctx.fillStyle = '#f8fbff';
    ctx.beginPath();
    ctx.arc(ex, ey, 6, 0, Math.PI * 2);
    ctx.fill();
    const a = Math.atan2(ball.y - ey, ball.x - ex);
    ctx.fillStyle = '#0b1424';
    ctx.beginPath();
    ctx.arc(ex + Math.cos(a) * 2.4, ey + Math.sin(a) * 2.4, 2.8, 0, Math.PI * 2);
    ctx.fill();
}

// Fixed star field — laid out once so the night sky never flickers.
const STARS = [
    [38, 42], [92, 78], [140, 30], [214, 62], [268, 26], [352, 54],
    [408, 34], [462, 84], [516, 46], [568, 70], [176, 104], [330, 96],
];

function drawShadow(x, y, radius) {
    const height = clamp((GROUND_Y - y) / 140, 0, 1);
    ctx.fillStyle = 'rgba(90, 60, 5, ' + (0.28 - height * 0.16).toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(x, GROUND_Y + 5, radius * (1 - height * 0.35), 5, 0, 0, Math.PI * 2);
    ctx.fill();
}

function draw() {
    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#0a1a2e');
    sky.addColorStop(1, '#173352');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, GROUND_Y);

    ctx.fillStyle = 'rgba(226, 236, 250, 0.55)';
    for (const [sx, sy] of STARS) ctx.fillRect(sx, sy, 2, 2);

    // Moon.
    ctx.fillStyle = 'rgba(238, 245, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(72, 62, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a1a2e';
    ctx.beginPath();
    ctx.arc(64, 55, 16, 0, Math.PI * 2);
    ctx.fill();

    // Sand.
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, GROUND_Y, CANVAS_W, 3);
    ctx.fillStyle = 'rgba(120, 84, 12, 0.25)';
    ctx.fillRect(0, CANVAS_H - 14, CANVAS_W, 14);

    // Shadows on the sand.
    drawShadow(player.x, player.y, SLIME_R);
    drawShadow(ai.x, ai.y, SLIME_R);
    drawShadow(ball.x, ball.y, BALL_R * 1.3);

    // Net: a taped post with a woven mesh.
    const netLeft = NET_X - NET_W / 2;
    ctx.fillStyle = 'rgba(226, 236, 250, 0.18)';
    ctx.fillRect(netLeft, NET_TOP, NET_W, GROUND_Y - NET_TOP);
    ctx.strokeStyle = 'rgba(226, 236, 250, 0.5)';
    ctx.lineWidth = 1;
    for (let y = NET_TOP + 5; y < GROUND_Y; y += 7) {
        ctx.beginPath();
        ctx.moveTo(netLeft, y);
        ctx.lineTo(netLeft + NET_W, y);
        ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(NET_X, NET_TOP);
    ctx.lineTo(NET_X, GROUND_Y);
    ctx.stroke();
    ctx.fillStyle = '#e6edf7';
    ctx.fillRect(netLeft - 1, NET_TOP, NET_W + 2, 5);

    // Slimes.
    drawSlime(player, '#38e0a0', 1);
    drawSlime(ai, '#f472b6', -1);

    // Ball.
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 80, 10, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    // Sparks.
    for (const s of sparks) {
        ctx.globalAlpha = Math.max(0, s.life * 2.6);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // Serving hint.
    if (state === 'running' && serveTimer > 0) {
        ctx.fillStyle = 'rgba(230, 237, 247, 0.65)';
        ctx.font = '13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(server === 'p1' ? 'Your serve' : 'Rival serve', NET_X, 34);
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Main loop (real-time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    if (state === 'running') step(dt);
    updateSparks(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();

function refreshKeyDir() {
    const left = heldKeys.has('ArrowLeft') || heldKeys.has('a') || heldKeys.has('A');
    const right = heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D');
    movePlayer((right ? 1 : 0) - (left ? 1 : 0));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else jump();
        e.preventDefault();
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        jump();
        e.preventDefault();
        return;
    }
    if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(e.key)) {
        heldKeys.add(e.key);
        refreshKeyDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeyDir();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

bestRally = parseInt(localStorage.getItem('slime-volley-best') || '0', 10) || 0;
state = 'idle';
scoreP1 = 0;
scoreP2 = 0;
rally = 0;
server = 'p1';
serveTimer = 0;
updateHud();
requestAnimationFrame(frame);
