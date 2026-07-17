// ---------------------------------------------------------------------------
// Artillery Duel — hot-seat two-player artillery game.
//
// The physics core (`computeTrajectory`) is a PURE function: given a launch
// point, angle, power, facing direction and wind, it deterministically returns
// the shell's path and where it stops. Everything the Playwright suite needs is
// exposed on `window`, so the game can be driven and asserted without pixels.
// ---------------------------------------------------------------------------

// --- Constants -------------------------------------------------------------
const W = 800;
const H = 500;
const GRAVITY = 0.4;      // downward accel per step
const POWER_SCALE = 0.32; // shell speed = power * POWER_SCALE
const DT_MAX_STEPS = 2000; // safety cap on a single shot's simulation

const ANGLE_MIN = 5;
const ANGLE_MAX = 88;
const POWER_MIN = 10;
const POWER_MAX = 100;

const TANK_W = 34;   // tank body width
const TANK_H = 14;   // tank body height (above the barrel pivot)
const BARREL_LEN = 22;
const CRATER_R = 26;

// --- DOM -------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const angleEl = document.getElementById('angle');
const powerEl = document.getElementById('power');
const windEl = document.getElementById('wind');
const turnEl = document.getElementById('turn');
const score0El = document.getElementById('score0');
const score1El = document.getElementById('score1');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State -----------------------------------------------------------------
let state = 'idle';       // 'idle' | 'aiming' | 'firing' | 'over'
let currentPlayer = 0;
let players = [];
let terrain = new Array(W).fill(H * 0.75);
let wind = 0;
let shell = null;         // { x, y } while a shell animates
let animId = null;

const COLORS = {
    sky:      '#0b1020',
    skyGlow:  '#131c3a',
    ground:   '#3b2f2a',
    groundLo: '#241c18',
    grass:    '#4ea36b',
    p0:       '#4aa3ff',
    p1:       '#ff5a5a',
    barrel:   '#e8eef7',
    shell:    '#ffe066',
    trail:    '#ffe06655',
};

// --- Deterministic RNG (mulberry32) ----------------------------------------
function makeRng(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// --- Terrain ---------------------------------------------------------------
// Rolling hills as a sum of sine waves with seed-derived phases/amplitudes.
function generateTerrain(seed) {
    const rng = makeRng(seed);
    const base = H * 0.66;
    const waves = [];
    for (let i = 0; i < 4; i++) {
        waves.push({
            amp: (10 + rng() * 34) / (i + 1),
            len: 90 + rng() * 260,
            phase: rng() * Math.PI * 2,
        });
    }
    const h = new Array(W);
    for (let x = 0; x < W; x++) {
        let y = base;
        for (const w of waves) {
            y += Math.sin((x / w.len) * Math.PI * 2 + w.phase) * w.amp;
        }
        h[x] = Math.max(H * 0.32, Math.min(H - 24, y));
    }
    return h;
}

// Stamp a flat platform of the tank's width centred on column cx.
function flattenPlatform(cx) {
    const half = Math.ceil(TANK_W / 2) + 3;
    const lo = Math.max(0, cx - half);
    const hi = Math.min(W - 1, cx + half);
    let level = terrain[cx];
    for (let x = lo; x <= hi; x++) level = Math.min(level, terrain[x]);
    for (let x = lo; x <= hi; x++) terrain[x] = level;
    return level;
}

function loadTerrain(heights) {
    terrain = heights.slice(0, W);
    while (terrain.length < W) terrain.push(H - 24);
    return terrain;
}

// --- Players ---------------------------------------------------------------
function placePlayers() {
    const x0 = 70;
    const x1 = W - 70;
    const y0 = flattenPlatform(x0);
    const y1 = flattenPlatform(x1);
    players = [
        { x: x0, y: y0, angle: 45, power: 55, score: players[0] ? players[0].score : 0, dir: 1 },
        { x: x1, y: y1, angle: 45, power: 55, score: players[1] ? players[1].score : 0, dir: -1 },
    ];
}

// Bounding box of tank i, in canvas coords.
function playerBox(i) {
    const p = players[i];
    return {
        left: p.x - TANK_W / 2,
        right: p.x + TANK_W / 2,
        top: p.y - TANK_H,
        bottom: p.y,
    };
}

// Muzzle position for player i given its current aim.
function muzzle(i) {
    const p = players[i];
    const a = p.angle * Math.PI / 180;
    const px = p.x + Math.cos(a) * BARREL_LEN * p.dir;
    const py = (p.y - TANK_H + 2) - Math.sin(a) * BARREL_LEN;
    return { x: px, y: py };
}

// --- Pure physics core -----------------------------------------------------
// Deterministically simulate a shell. Returns its path and terminal event.
function computeTrajectory({ x, y, angleDeg, power, dir, wind }) {
    const a = angleDeg * Math.PI / 180;
    const speed = power * POWER_SCALE;
    let vx = Math.cos(a) * speed * dir;
    let vy = -Math.sin(a) * speed;
    let px = x, py = y;
    const points = [{ x: px, y: py }];

    for (let step = 0; step < DT_MAX_STEPS; step++) {
        vx += wind;
        vy += GRAVITY;
        px += vx;
        py += vy;
        points.push({ x: px, y: py });

        // Out of bounds (left/right/bottom). Top is open — shells may fly high.
        if (px < 0 || px >= W || py >= H) {
            return { points, hit: { type: 'oob', x: px, y: py } };
        }

        // Tank hit — check both players' boxes.
        for (let i = 0; i < players.length; i++) {
            const b = playerBox(i);
            if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) {
                return { points, hit: { type: 'player', x: px, y: py, playerIndex: i } };
            }
        }

        // Terrain hit.
        const col = Math.round(px);
        if (col >= 0 && col < W && py >= terrain[col]) {
            return { points, hit: { type: 'terrain', x: px, y: py } };
        }
    }
    return { points, hit: { type: 'oob', x: px, y: py } };
}

// --- Craters ---------------------------------------------------------------
function carveCrater(cx, cy, r) {
    const lo = Math.max(0, Math.floor(cx - r));
    const hi = Math.min(W - 1, Math.ceil(cx + r));
    for (let x = lo; x <= hi; x++) {
        const dx = x - cx;
        const inside = r * r - dx * dx;
        if (inside <= 0) continue;
        const depth = Math.sqrt(inside);
        const newSurface = cy + depth;
        if (newSurface > terrain[x]) terrain[x] = Math.min(H - 1, newSurface);
    }
}

// --- HUD -------------------------------------------------------------------
function updateHud() {
    const p = players[currentPlayer];
    if (angleEl) angleEl.textContent = Math.round(p.angle);
    if (powerEl) powerEl.textContent = Math.round(p.power);
    if (windEl) {
        const mag = Math.abs(wind);
        const arrow = wind === 0 ? '·' : (wind > 0 ? '→' : '←');
        windEl.textContent = `${arrow} ${(mag * 100).toFixed(0)}`;
    }
    if (turnEl) {
        turnEl.textContent = currentPlayer === 0 ? 'Blue' : 'Red';
        turnEl.className = currentPlayer === 0 ? 'p0' : 'p1';
    }
    if (score0El) score0El.textContent = players[0].score;
    if (score1El) score1El.textContent = players[1].score;
}

// --- Aim inputs ------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function adjustAngle(delta) {
    if (state !== 'aiming') return;
    const p = players[currentPlayer];
    p.angle = clamp(p.angle + delta, ANGLE_MIN, ANGLE_MAX);
    updateHud();
    draw();
}

function adjustPower(delta) {
    if (state !== 'aiming') return;
    const p = players[currentPlayer];
    p.power = clamp(p.power + delta, POWER_MIN, POWER_MAX);
    updateHud();
    draw();
}

function rollWind() {
    // Deterministic-ish: derived from scores + turn so a fresh game varies but
    // tests can override via setWind().
    const seed = (players[0].score * 131 + players[1].score * 17 + currentPlayer * 7 + 1);
    const rng = makeRng(seed * 2654435761);
    wind = (rng() - 0.5) * 0.12;
    wind = Math.round(wind * 1000) / 1000;
}

function setWind(w) { wind = w; updateHud(); }

// --- Round / game flow -----------------------------------------------------
function newRound(win) {
    // `win` is the index of the player who just won a round (or null on start).
    if (win === 0 || win === 1) players[win].score += 1;
    currentPlayer = win === 0 ? 1 : 0; // loser (or player 0) shoots first
    rollWind();
    state = 'aiming';
    shell = null;
    updateHud();
    draw();
}

function startGame(seed) {
    terrain = generateTerrain(seed === undefined ? Math.floor(Math.random() * 1e9) : seed);
    placePlayers();
    players[0].score = 0;
    players[1].score = 0;
    currentPlayer = 0;
    rollWind();
    state = 'aiming';
    shell = null;
    if (overlay) overlay.classList.remove('visible');
    updateHud();
    draw();
}

function resetGame() { startGame(); }

// Fire the current player's shell. Animates the flight, then resolves.
function fireShot() {
    if (state !== 'aiming') return Promise.resolve(null);
    state = 'firing';
    const p = players[currentPlayer];
    const m = muzzle(currentPlayer);
    const traj = computeTrajectory({
        x: m.x, y: m.y, angleDeg: p.angle, power: p.power, dir: p.dir, wind,
    });

    return animateShell(traj.points).then(() => resolveShot(traj.hit));
}

function resolveShot(hit) {
    shell = null;
    if (hit.type === 'player' && hit.playerIndex !== currentPlayer) {
        const winner = currentPlayer;
        // Bank the win immediately so the HUD reflects it, then show the
        // round-over overlay. The next round begins on player input.
        players[winner].score += 1;
        state = 'over';
        if (overlay) {
            overlayTitle.textContent =
                (winner === 0 ? 'Blue' : 'Red') + ' scores a direct hit!';
            overlaySub.textContent = 'Press Space or N for the next round';
            btnStart.textContent = 'Next Round';
            overlay.classList.add('visible');
        }
        updateHud();
        pendingWinner = winner;
        return hit;
    }

    // Missed (terrain / self / oob): carve a crater and pass the turn.
    if (hit.type === 'terrain' || (hit.type === 'player' && hit.playerIndex === currentPlayer)) {
        carveCrater(hit.x, hit.y, CRATER_R);
    }
    currentPlayer = 1 - currentPlayer;
    rollWind();
    state = 'aiming';
    updateHud();
    draw();
    return hit;
}

let pendingWinner = null;

function nextRoundAfterWin() {
    // Called when the player dismisses the "direct hit" overlay.
    const loser = 1 - pendingWinner;
    pendingWinner = null;
    // Regenerate a fresh battlefield for the new round.
    terrain = generateTerrain(Math.floor(Math.random() * 1e9));
    placePlayers();
    currentPlayer = loser;
    rollWind();
    state = 'aiming';
    shell = null;
    if (overlay) overlay.classList.remove('visible');
    updateHud();
    draw();
}

// --- Shell animation -------------------------------------------------------
function animateShell(points) {
    return new Promise((resolve) => {
        let i = 0;
        const stepsPerFrame = 3;
        function frame() {
            i = Math.min(points.length - 1, i + stepsPerFrame);
            shell = points[i];
            draw();
            if (i >= points.length - 1) {
                resolve();
                return;
            }
            animId = requestAnimationFrame(frame);
        }
        animId = requestAnimationFrame(frame);
    });
}

// --- Rendering -------------------------------------------------------------
function draw() {
    if (!ctx) return;

    // Sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.sky);
    g.addColorStop(1, COLORS.skyGlow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Terrain (filled column band with a grass cap)
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x < W; x++) ctx.lineTo(x, terrain[x]);
    ctx.lineTo(W - 1, H);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, H * 0.4, 0, H);
    tg.addColorStop(0, COLORS.ground);
    tg.addColorStop(1, COLORS.groundLo);
    ctx.fillStyle = tg;
    ctx.fill();

    ctx.strokeStyle = COLORS.grass;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
        if (x === 0) ctx.moveTo(x, terrain[x]);
        else ctx.lineTo(x, terrain[x]);
    }
    ctx.stroke();

    // Tanks
    for (let i = 0; i < players.length; i++) drawTank(i);

    // Aim guide for the active player while aiming
    if (state === 'aiming' && players[currentPlayer]) drawAimGuide(currentPlayer);

    // Shell + trail
    if (shell) {
        ctx.fillStyle = COLORS.shell;
        ctx.shadowColor = COLORS.shell;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(shell.x, shell.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }
}

function drawTank(i) {
    const p = players[i];
    const b = playerBox(i);
    ctx.fillStyle = i === 0 ? COLORS.p0 : COLORS.p1;
    // Body
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(b.left, b.top, TANK_W, TANK_H, 4);
        ctx.fill();
    } else {
        ctx.fillRect(b.left, b.top, TANK_W, TANK_H);
    }
    // Turret dome
    ctx.beginPath();
    ctx.arc(p.x, b.top, 8, Math.PI, 0);
    ctx.fill();
    // Barrel
    const a = p.angle * Math.PI / 180;
    const bx = p.x;
    const by = b.top - 2;
    ctx.strokeStyle = COLORS.barrel;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(a) * BARREL_LEN * p.dir, by - Math.sin(a) * BARREL_LEN);
    ctx.stroke();
}

function drawAimGuide(i) {
    const p = players[i];
    const m = muzzle(i);
    const traj = computeTrajectory({
        x: m.x, y: m.y, angleDeg: p.angle, power: p.power, dir: p.dir, wind,
    });
    ctx.fillStyle = COLORS.trail;
    for (let k = 0; k < traj.points.length; k += 6) {
        const pt = traj.points[k];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

// --- Input -----------------------------------------------------------------
function handleFireKey() {
    if (state === 'aiming') {
        fireShot();
    } else if (state === 'over') {
        nextRoundAfterWin();
    }
}

document.addEventListener('keydown', (e) => {
    const k = e.key;

    if (state === 'idle') {
        if (k === ' ' || k === 'Enter' || k === 'n' || k === 'N') { startGame(); e.preventDefault(); }
        return;
    }

    switch (k) {
        case 'ArrowLeft': case 'a': case 'A': adjustAngle(-1); e.preventDefault(); break;
        case 'ArrowRight': case 'd': case 'D': adjustAngle(1); e.preventDefault(); break;
        case 'ArrowUp': case 'w': case 'W': adjustPower(1); e.preventDefault(); break;
        case 'ArrowDown': case 's': case 'S': adjustPower(-1); e.preventDefault(); break;
        case ' ': case 'Enter': handleFireKey(); e.preventDefault(); break;
        case 'n': case 'N':
            if (state === 'over') nextRoundAfterWin(); else startGame();
            e.preventDefault();
            break;
        default: break;
    }
});

if (btnStart) {
    btnStart.addEventListener('click', () => {
        if (state === 'idle') startGame();
        else if (state === 'over') nextRoundAfterWin();
        else startGame();
    });
}

// --- Init ------------------------------------------------------------------
// Seed a deterministic idle battlefield so the first paint is meaningful.
terrain = generateTerrain(12345);
placePlayers();
rollWind();
state = 'idle';
updateHud();
draw();

// --- Expose API for tests --------------------------------------------------
// Top-level `function` declarations (computeTrajectory, fireShot, …) are
// already global. The mutable `let` state vars are reachable by bare name
// inside page.evaluate, but we also install LIVE getters on `window` (via
// defineProperty, so they are not snapshotted) for convenient `window.state`
// style access. Constants are attached as plain values.
if (typeof window !== 'undefined') {
    Object.assign(window, { W, H, GRAVITY, POWER_SCALE, ANGLE_MIN, ANGLE_MAX, POWER_MIN, POWER_MAX });
    const live = {
        state: () => state,
        currentPlayer: () => currentPlayer,
        players: () => players,
        terrain: () => terrain,
        wind: () => wind,
        shell: () => shell,
    };
    for (const [name, getter] of Object.entries(live)) {
        Object.defineProperty(window, name, { get: getter, configurable: true });
    }
}
