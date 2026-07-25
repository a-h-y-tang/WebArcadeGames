// ===========================================================================
// Artillery Duel — a turn-based projectile duel (Scorched-Earth / Gorillas).
//
// All mutable game state and the physics entry point `step(dtMs)` are declared
// at top level so they are reachable from Playwright's page.evaluate(), exactly
// as the Asteroids and Snake games do. `step(dtMs)` integrates the in-flight
// shell by an explicit number of milliseconds in small fixed sub-steps, so the
// physics is deterministic and never tunnels a fast shell through a tank.
// ===========================================================================

// --- Field constants --------------------------------------------------------
const WIDTH = 500;
const HEIGHT = 500;
const GROUND_Y = 440;            // y of the flat battlefield floor
const PLAYER_X = 60;             // player tank x (left)
const CPU_X = 440;               // cpu tank x (right)
const TANK_MUZZLE = 10;          // turret height above the ground for hit tests
const HIT_R = 16;                // shell-to-tank hit radius (px)

// --- Physics constants ------------------------------------------------------
const GRAVITY = 0.0009;          // downward accel (px / ms^2)
const SPEED_SCALE = 0.01;        // launch speed per unit of power (px / ms)
const WIND_MAX = 0.0003;         // |wind| horizontal accel (px / ms^2)
const SUB_STEP = 4;              // integration sub-step (ms)

// --- Aim limits -------------------------------------------------------------
const ANGLE_MIN = 15;
const ANGLE_MAX = 80;
const ANGLE_STEP = 2;
const POWER_MIN = 20;
const POWER_MAX = 100;
const POWER_STEP = 2;

const CPU_DELAY = 900;           // ms the CPU "thinks" before firing
const SCORE_KEY = 'artillery-best';

// --- Mutable state ----------------------------------------------------------
let state = 'idle';              // 'idle' | 'running' | 'paused' | 'over'
let score = 0;
let best = parseInt(localStorage.getItem(SCORE_KEY)) || 0;
let round = 1;
let turn = 'player';             // 'player' | 'cpu'
let angle = 45;                  // player's barrel elevation (degrees)
let power = 55;                  // player's firing power
let wind = 0;                    // horizontal accel this round (px / ms^2)
let aiEnabled = true;            // tests disable this to drive fireShell() by hand
let cpuTimer = 0;                // countdown to the CPU's automatic shot
let shell = null;                // { x, y, vx, vy, owner } or null

const player = { x: PLAYER_X, y: GROUND_Y, color: '#7dd3fc' };
const cpu = { x: CPU_X, y: GROUND_Y, color: '#f472b6' };

// --- DOM handles ------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const roundEl = document.getElementById('round');
const angleOut = document.getElementById('angle-out');
const powerOut = document.getElementById('power-out');
const windOut = document.getElementById('wind-out');
const turnOut = document.getElementById('turn-out');

// ===========================================================================
// Helpers
// ===========================================================================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function updateHud() {
    scoreEl.textContent = score;
    bestEl.textContent = best;
    roundEl.textContent = round;
    updateReadout();
}

function updateReadout() {
    angleOut.textContent = Math.round(angle) + '°';
    powerOut.textContent = Math.round(power);
    if (wind === 0) windOut.textContent = 'calm';
    else {
        const arrow = wind > 0 ? '→' : '←';
        const strength = Math.round(Math.abs(wind) / WIND_MAX * 9);
        windOut.textContent = arrow + ' ' + strength;
    }
    if (state === 'running') {
        turnOut.textContent = shell
            ? 'Shot in flight…'
            : (turn === 'player' ? 'Your shot' : 'Enemy is aiming…');
    } else {
        turnOut.textContent = '';
    }
}

function showOverlay(title, scoreText, subText, btnText) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText || '';
    overlaySub.textContent = subText;
    btnStart.textContent = btnText;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function randomWind() {
    return (Math.random() * 2 - 1) * WIND_MAX;
}

// ===========================================================================
// Aiming (player)
// ===========================================================================
function aimAngle(dir) {
    angle = clamp(angle + dir * ANGLE_STEP, ANGLE_MIN, ANGLE_MAX);
    updateReadout();
}

function aimPower(dir) {
    power = clamp(power + dir * POWER_STEP, POWER_MIN, POWER_MAX);
    updateReadout();
}

// ===========================================================================
// Ballistics
// ===========================================================================
// Initial velocity for a shot. dir = +1 fires to the right (player),
// dir = -1 fires to the left (cpu). Angle 0 is horizontal, 90 straight up.
function launchVelocity(angleDeg, pow, dir) {
    const rad = angleDeg * Math.PI / 180;
    const v0 = pow * SPEED_SCALE;
    return { vx: dir * v0 * Math.cos(rad), vy: -v0 * Math.sin(rad) };
}

// The CPU solves the level-ground range for a 45° shot, then adds a small
// random error so it is beatable. Result is always clamped to legal limits.
function cpuAim() {
    const dist = Math.abs(cpu.x - player.x);
    // Level range R = v0^2 * sin(2θ) / g; at θ = 45°, sin(2θ) = 1 → v0 = √(R·g).
    const v0 = Math.sqrt(dist * GRAVITY);
    let pow = v0 / SPEED_SCALE + (Math.random() - 0.5) * 12;
    let ang = 45 + (Math.random() - 0.5) * 10;
    return {
        angle: clamp(ang, ANGLE_MIN, ANGLE_MAX),
        power: clamp(pow, POWER_MIN, POWER_MAX),
    };
}

function fireShell() {
    if (shell) return; // only one shell in the air at a time
    let ang, pow, dir, tank;
    if (turn === 'player') {
        ang = angle; pow = power; dir = 1; tank = player;
    } else {
        const a = cpuAim();
        ang = a.angle; pow = a.power; dir = -1; tank = cpu;
    }
    const v = launchVelocity(ang, pow, dir);
    shell = {
        x: tank.x,
        y: GROUND_Y - TANK_MUZZLE,
        vx: v.vx,
        vy: v.vy,
        owner: turn,
    };
    updateReadout();
}

// A shot has resolved. hit === true means the enemy tank was struck.
function resolveShot(hit) {
    const shooter = shell.owner;
    shell = null;
    if (hit) {
        if (shooter === 'player') winRound();
        else endGame();
        return;
    }
    // Miss — the other tank takes its turn.
    turn = shooter === 'player' ? 'cpu' : 'player';
    if (turn === 'cpu') cpuTimer = CPU_DELAY;
    updateReadout();
}

// ===========================================================================
// Physics — integrate the in-flight shell by dt milliseconds.
// ===========================================================================
function step(dt) {
    if (state !== 'running' || !shell) return;
    let remaining = dt;
    while (remaining > 0 && shell) {
        const h = Math.min(remaining, SUB_STEP);
        remaining -= h;
        shell.vx += wind * h;
        shell.vy += GRAVITY * h;
        shell.x += shell.vx * h;
        shell.y += shell.vy * h;

        const foe = shell.owner === 'player' ? cpu : player;
        if (Math.hypot(shell.x - foe.x, shell.y - (GROUND_Y - TANK_MUZZLE)) < HIT_R) {
            resolveShot(true);
        } else if (shell.y >= GROUND_Y) {
            resolveShot(false);
        } else if (shell.x < -30 || shell.x > WIDTH + 30) {
            resolveShot(false);
        }
    }
}

// ===========================================================================
// Game flow
// ===========================================================================
function winRound() {
    score++;
    if (score > best) {
        best = score;
        localStorage.setItem(SCORE_KEY, String(best));
    }
    round++;
    shell = null;
    turn = 'player';
    wind = randomWind();
    cpuTimer = 0;
    updateHud();
}

function startGame() {
    state = 'running';
    score = 0;
    round = 1;
    turn = 'player';
    angle = 45;
    power = 55;
    wind = randomWind();
    shell = null;
    cpuTimer = 0;
    aiEnabled = true;
    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    shell = null;
    if (score > best) {
        best = score;
        localStorage.setItem(SCORE_KEY, String(best));
    }
    updateHud();
    const rounds = score === 1 ? '1 round won' : `${score} rounds won`;
    showOverlay('Game Over', rounds, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
        updateReadout();
    }
}

// ===========================================================================
// Rendering
// ===========================================================================
function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#0b1220');
    sky.addColorStop(1, '#131c2e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, GROUND_Y);
    // Ground.
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(WIDTH, GROUND_Y + 1);
    ctx.stroke();
}

function drawTank(tank, barrelAngle, dir, active) {
    const bx = tank.x;
    const by = GROUND_Y;
    // Barrel.
    const rad = barrelAngle * Math.PI / 180;
    ctx.strokeStyle = active ? '#fde68a' : '#6b7280';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx, by - 8);
    ctx.lineTo(bx + dir * Math.cos(rad) * 22, by - 8 - Math.sin(rad) * 22);
    ctx.stroke();
    // Body.
    ctx.fillStyle = tank.color;
    ctx.beginPath();
    ctx.moveTo(bx - 14, by);
    ctx.lineTo(bx + 14, by);
    ctx.lineTo(bx + 10, by - 8);
    ctx.lineTo(bx - 10, by - 8);
    ctx.closePath();
    ctx.fill();
    // Turret.
    ctx.beginPath();
    ctx.arc(bx, by - 8, 6, Math.PI, 0);
    ctx.fill();
}

function drawShell() {
    if (!shell) return;
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(shell.x, shell.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(254,240,138,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(shell.x - shell.vx * 12, shell.y - shell.vy * 12);
    ctx.lineTo(shell.x, shell.y);
    ctx.stroke();
}

function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawBackground();
    drawTank(player, angle, 1, state === 'running' && turn === 'player' && !shell);
    drawTank(cpu, 45, -1, state === 'running' && turn === 'cpu' && !shell);
    drawShell();
}

// ===========================================================================
// Input
// ===========================================================================
const START_KEYS = new Set([
    ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

window.addEventListener('keydown', (e) => {
    const k = e.key;

    if (state === 'idle' || state === 'over') {
        if (START_KEYS.has(k)) {
            e.preventDefault();
            startGame();
        }
        return;
    }

    if (k === 'p' || k === 'P') {
        e.preventDefault();
        togglePause();
        return;
    }

    if (state !== 'running') return;

    // Only the player, on their own turn with no shell in the air, may act.
    if (turn !== 'player' || shell) {
        if (k === ' ' || k.startsWith('Arrow')) e.preventDefault();
        return;
    }

    if (k === 'ArrowUp') { e.preventDefault(); aimAngle(+1); }
    else if (k === 'ArrowDown') { e.preventDefault(); aimAngle(-1); }
    else if (k === 'ArrowRight') { e.preventDefault(); aimPower(+1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); aimPower(-1); }
    else if (k === ' ') { e.preventDefault(); fireShell(); }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ===========================================================================
// Main loop
// ===========================================================================
let lastTime = null;
function loop(now) {
    if (lastTime === null) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 50) dt = 50; // clamp big gaps (e.g. tab switch) for stability

    if (state === 'running') {
        if (shell) {
            step(dt);
        } else if (turn === 'cpu' && aiEnabled) {
            cpuTimer -= dt;
            if (cpuTimer <= 0) fireShell();
        }
    }
    render();
    requestAnimationFrame(loop);
}

// ===========================================================================
// Boot — show the battlefield behind the title screen.
// ===========================================================================
updateHud();
render();
requestAnimationFrame(loop);
