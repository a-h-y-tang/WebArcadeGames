// ---------------------------------------------------------------------------
// Marble Blaster - shoot marbles into a crawling chain and match three or more
// before the chain reaches the pit.
// ---------------------------------------------------------------------------

const CANVAS_W = 720;
const CANVAS_H = 480;

const MARBLE_R = 12;          // marble radius
const SPACING = 24;           // centre-to-centre distance of packed marbles
const BASE_SPEED = 26;        // chain crawl speed (px/s) on level 1
const SPEED_PER_LEVEL = 0.18; // fraction added per extra level
const FEED_MULTIPLIER = 4;    // marbles still queued push the chain along faster
const PULL_SPEED = 260;       // px/s a detached tail closes a gap at
const SHOT_SPEED = 620;       // px/s a fired marble travels
const RELOAD = 0.35;          // seconds between shots
const AIM_SPEED = 2.4;        // radians/s when swinging with the arrow keys
const DANGER_ZONE = 220;      // distance from the pit that counts as danger
const LEVEL_BONUS = 250;      // per-level bonus for clearing every marble

const COLORS = ['#ff4d5e', '#4dc3ff', '#5cd65c', '#ffd24d', '#c77dff', '#ff9d3d'];

// The track the marbles crawl along: a serpentine that ends in the pit.
const PATH = [
    { x: -40, y: 60 }, { x: 610, y: 60 },
    { x: 660, y: 80 }, { x: 680, y: 125 }, { x: 660, y: 170 },
    { x: 610, y: 190 }, { x: 110, y: 190 },
    { x: 60, y: 210 }, { x: 40, y: 255 }, { x: 60, y: 300 },
    { x: 110, y: 320 }, { x: 610, y: 320 },
    { x: 655, y: 340 }, { x: 670, y: 380 }, { x: 640, y: 415 },
    { x: 590, y: 435 }, { x: 370, y: 440 },
];

// Cumulative arc length at each path vertex, so a marble can be addressed by a
// single "distance travelled" number.
const PATH_LEN = (() => {
    const lens = [0];
    for (let i = 1; i < PATH.length; i++) {
        const dx = PATH[i].x - PATH[i - 1].x;
        const dy = PATH[i].y - PATH[i - 1].y;
        lens.push(lens[i - 1] + Math.hypot(dx, dy));
    }
    return lens;
})();

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const remainingEl = document.getElementById('remaining');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const BEST_KEY = 'marble-blaster-best';

let state = 'idle';           // 'idle' | 'running' | 'over'
let paused = false;
let score = 0;
let best = 0;
let level = 1;
let toSpawn = 0;              // marbles still waiting to enter the track
let lastCombo = 0;            // combo depth of the most recent resolution
let shotCooldown = 0;
let flashTimer = 0;
let flashText = '';
let pulse = 0;                // drives the danger throb

const chain = [];             // front-to-back: chain[0] is nearest the pit
const projectiles = [];
const pops = [];              // short-lived clear effects
const keys = {};

const shooter = { x: 360, y: 255 };
let aim = -Math.PI / 2;
let currentColor = COLORS[0];
let nextColor = COLORS[1];

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function pathLength() {
    return PATH_LEN[PATH_LEN.length - 1];
}

// Position on the track at a given distance from the entrance.
function pointAt(dist) {
    const total = pathLength();
    if (dist <= 0) return { x: PATH[0].x, y: PATH[0].y };
    if (dist >= total) {
        const end = PATH[PATH.length - 1];
        return { x: end.x, y: end.y };
    }
    let i = 1;
    while (i < PATH_LEN.length - 1 && PATH_LEN[i] < dist) i++;
    const segLen = PATH_LEN[i] - PATH_LEN[i - 1];
    const t = segLen === 0 ? 0 : (dist - PATH_LEN[i - 1]) / segLen;
    return {
        x: PATH[i - 1].x + (PATH[i].x - PATH[i - 1].x) * t,
        y: PATH[i - 1].y + (PATH[i].y - PATH[i - 1].y) * t,
    };
}

// ---------------------------------------------------------------------------
// Level shape
// ---------------------------------------------------------------------------

function marblesForLevel(l) {
    return 30 + (l - 1) * 6;
}

function colorsForLevel(l) {
    return Math.min(COLORS.length, 3 + Math.floor((l - 1) / 2));
}

function chainSpeed() {
    return BASE_SPEED * (1 + SPEED_PER_LEVEL * (level - 1));
}

// While marbles are still queued they stream out under pressure, so the whole
// chain runs fast; once the queue is empty it settles into its slow crawl.
function frontSpeed() {
    return chainSpeed() * (toSpawn > 0 ? FEED_MULTIPLIER : 1);
}

function activeColors() {
    return COLORS.slice(0, colorsForLevel(level));
}

// Marbles entering the track are drawn freely from the level's palette.
function randomColor() {
    const active = activeColors();
    return active[Math.floor(Math.random() * active.length)];
}

// The launcher instead prefers colours that are actually on the track, so a
// shot is never dead weight - and the last few marbles stay clearable.
function pickColor() {
    const active = activeColors();
    const onTrack = [...new Set(chain.map((m) => m.color))].filter((c) => active.includes(c));
    const pool = onTrack.length ? onTrack : active;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

function addMarble(colorIndex, dist) {
    chain.push({ color: COLORS[colorIndex % COLORS.length], dist });
    return chain[chain.length - 1];
}

// Front marble crawls forward; everything behind packs up against it.
function advanceChain(dt) {
    if (!chain.length) return;
    chain[0].dist += frontSpeed() * dt;
    for (let i = 1; i < chain.length; i++) {
        const target = chain[i - 1].dist - SPACING;
        chain[i].dist = chain[i].dist > target
            ? target
            : Math.min(target, chain[i].dist + PULL_SPEED * dt);
    }
}

// Feed at most one new marble per frame, and only once the tail has cleared
// the entrance - that keeps the stream packed without ever overlapping.
function feedChain() {
    if (toSpawn <= 0) return;
    const tail = chain[chain.length - 1];
    if (tail && tail.dist < SPACING) return;
    const dist = tail ? tail.dist - SPACING : 0;
    chain.push({ color: randomColor(), dist });
    toSpawn--;
}

function inDanger() {
    return chain.length > 0 && chain[0].dist > pathLength() - DANGER_ZONE;
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function setAim(angle) {
    aim = angle;
}

function aimAt(x, y) {
    aim = Math.atan2(y - shooter.y, x - shooter.x);
}

// Launch a marble toward a point, ignoring the reload timer (used by tests and
// by fire() once the launcher is ready).
function launchAt(x, y, color) {
    aimAt(x, y);
    return launch(color);
}

function launch(color) {
    const p = {
        x: shooter.x,
        y: shooter.y,
        vx: Math.cos(aim) * SHOT_SPEED,
        vy: Math.sin(aim) * SHOT_SPEED,
        color,
    };
    projectiles.push(p);
    return p;
}

function fire() {
    if (state !== 'running' || paused || shotCooldown > 0) return null;
    const p = launch(currentColor);
    shotCooldown = RELOAD;
    currentColor = nextColor;
    nextColor = pickColor();
    return p;
}

function swapMarble() {
    const tmp = currentColor;
    currentColor = nextColor;
    nextColor = tmp;
}

// Walk each shot forward in small steps so a fast marble cannot tunnel through
// the chain, and resolve the first marble it touches.
function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const travel = Math.hypot(p.vx, p.vy) * dt;
        const steps = Math.max(1, Math.ceil(travel / (MARBLE_R / 2)));
        let hit = -1;
        for (let s = 0; s < steps && hit < 0; s++) {
            p.x += (p.vx * dt) / steps;
            p.y += (p.vy * dt) / steps;
            hit = hitIndex(p);
        }
        if (hit >= 0) {
            projectiles.splice(i, 1);
            insertMarble(insertionIndex(hit, p), p.color);
        } else if (p.x < -40 || p.x > CANVAS_W + 40 || p.y < -40 || p.y > CANVAS_H + 40) {
            projectiles.splice(i, 1);
        }
    }
}

function hitIndex(p) {
    let best = -1;
    let bestDist = MARBLE_R * 2;
    for (let i = 0; i < chain.length; i++) {
        const c = pointAt(chain[i].dist);
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

// Does the shot land in front of the marble it hit, or behind it?
function insertionIndex(i, p) {
    const front = pointAt(chain[i].dist + SPACING / 2);
    const back = pointAt(chain[i].dist - SPACING / 2);
    const dFront = Math.hypot(p.x - front.x, p.y - front.y);
    const dBack = Math.hypot(p.x - back.x, p.y - back.y);
    return dFront <= dBack ? i : i + 1;
}

// ---------------------------------------------------------------------------
// Insertion & matching
// ---------------------------------------------------------------------------

function insertMarble(index, color) {
    let k = Math.max(0, Math.min(index, chain.length));
    if (!chain.length) {
        chain.push({ color, dist: 0 });
        return 0;
    }
    // Inserting at the very front would shove the lead marble toward the pit;
    // when there is no room left for that, tuck the marble in behind instead.
    if (k === 0 && chain[0].dist + SPACING >= pathLength()) k = 1;

    let dist;
    if (k === 0) {
        dist = chain[0].dist + SPACING;
    } else {
        dist = chain[k - 1].dist - SPACING;
        for (let j = k; j < chain.length; j++) chain[j].dist -= SPACING;
    }
    chain.splice(k, 0, { color, dist });
    resolveMatches(k);
    return k;
}

// Extent of the same-coloured run containing index.
function runAt(index) {
    if (index < 0 || index >= chain.length) return { start: index, len: 0 };
    const color = chain[index].color;
    let start = index;
    let end = index;
    while (start > 0 && chain[start - 1].color === color) start--;
    while (end < chain.length - 1 && chain[end + 1].color === color) end++;
    return { start, len: end - start + 1 };
}

// Clear the run at index, then keep clearing while the seam left behind lines
// up another match - that is the chain reaction, and it pays a rising combo.
function resolveMatches(index) {
    let combo = 0;
    let idx = index;
    while (true) {
        const run = runAt(idx);
        if (run.len < 3) break;
        combo++;
        for (let i = run.start; i < run.start + run.len; i++) {
            const p = pointAt(chain[i].dist);
            pops.push({ x: p.x, y: p.y, color: chain[i].color, life: 0.45 });
        }
        chain.splice(run.start, run.len);
        score += run.len * 10 * combo;
        if (combo > 1) flash(`COMBO x${combo}`);
        if (run.start === 0 || run.start >= chain.length) break;
        if (chain[run.start - 1].color !== chain[run.start].color) break;
        idx = run.start;
    }
    lastCombo = combo;
    if (combo) updateHud();
    return combo;
}

function flash(text) {
    flashText = text;
    flashTimer = 1.1;
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startLevel() {
    chain.length = 0;
    projectiles.length = 0;
    toSpawn = marblesForLevel(level);
    currentColor = pickColor();
    nextColor = pickColor();
    shotCooldown = 0;
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS * level;
    level++;
    flash(`LEVEL ${level}`);
    startLevel();
}

function startGame() {
    state = 'running';
    paused = false;
    score = 0;
    level = 1;
    lastCombo = 0;
    pops.length = 0;
    flashTimer = 0;
    startLevel();
    overlay.classList.remove('visible');
}

function endGame() {
    state = 'over';
    paused = false;
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* storage unavailable - keep the score in memory only */
        }
    }
    updateHud();
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Score ${score} - Level ${level}`;
    overlaySub.textContent = 'Press Space or click Play Again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function togglePause() {
    if (state !== 'running') return;
    paused = !paused;
    if (paused) {
        overlayTitle.textContent = 'PAUSED';
        overlayScore.textContent = `Score ${score}`;
        overlaySub.textContent = 'Press P to resume';
        btnStart.textContent = 'Resume';
        overlay.classList.add('visible');
    } else {
        overlay.classList.remove('visible');
    }
}

function updateHud() {
    scoreEl.textContent = String(score);
    levelEl.textContent = String(level);
    remainingEl.textContent = String(toSpawn + chain.length);
    bestEl.textContent = String(best);
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------

function step(dt) {
    pulse += dt;
    for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life -= dt;
        if (pops[i].life <= 0) pops.splice(i, 1);
    }
    if (flashTimer > 0) flashTimer = Math.max(0, flashTimer - dt);
    if (state !== 'running' || paused) return;

    shotCooldown = Math.max(0, shotCooldown - dt);
    if (keys['ArrowLeft']) aim -= AIM_SPEED * dt;
    if (keys['ArrowRight']) aim += AIM_SPEED * dt;

    advanceChain(dt);
    feedChain();
    updateProjectiles(dt);
    updateHud();

    if (chain.length && chain[0].dist >= pathLength()) {
        endGame();
        return;
    }
    if (toSpawn <= 0 && chain.length === 0) nextLevel();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawTrack() {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i++) ctx.lineTo(PATH[i].x, PATH[i].y);
    ctx.strokeStyle = '#1b2515';
    ctx.lineWidth = 32;
    ctx.stroke();
    ctx.strokeStyle = '#0a0f07';
    ctx.lineWidth = 24;
    ctx.stroke();
    ctx.setLineDash([4, 14]);
    ctx.strokeStyle = 'rgba(160, 200, 130, 0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
}

function drawPit() {
    const pit = PATH[PATH.length - 1];
    const danger = inDanger();
    const throb = danger ? 3 + Math.sin(pulse * 10) * 2 : 0;
    const g = ctx.createRadialGradient(pit.x, pit.y, 2, pit.x, pit.y, 26 + throb);
    g.addColorStop(0, '#000');
    g.addColorStop(0.7, danger ? '#5b1111' : '#1a1207');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pit.x, pit.y, 26 + throb, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = danger ? '#f87171' : '#3a4a2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pit.x, pit.y, 16, 0, Math.PI * 2);
    ctx.stroke();
}

function drawMarble(x, y, color, r) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, color);
    g.addColorStop(1, '#000000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();
}

function drawChain() {
    for (let i = chain.length - 1; i >= 0; i--) {
        const p = pointAt(chain[i].dist);
        drawMarble(p.x, p.y, chain[i].color, MARBLE_R);
    }
}

function drawShooter() {
    const bx = shooter.x;
    const by = shooter.y;
    // aiming guide
    ctx.setLineDash([3, 9]);
    ctx.strokeStyle = 'rgba(255, 210, 77, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.cos(aim) * 110, by + Math.sin(aim) * 110);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(aim);
    ctx.fillStyle = '#3c4a2e';
    ctx.fillRect(0, -9, 30, 18);
    ctx.fillStyle = '#586b43';
    ctx.fillRect(22, -11, 8, 22);
    ctx.restore();

    ctx.fillStyle = '#2b3620';
    ctx.beginPath();
    ctx.arc(bx, by, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6b8250';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawMarble(bx, by, currentColor, 13);
    drawMarble(bx - 30, by + 30, nextColor, 8);
    ctx.fillStyle = 'rgba(232, 240, 226, 0.5)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NEXT', bx - 30, by + 50);
}

function drawProjectiles() {
    for (const p of projectiles) drawMarble(p.x, p.y, p.color, MARBLE_R);
}

function drawPops() {
    for (const pop of pops) {
        const t = 1 - pop.life / 0.45;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = pop.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pop.x, pop.y, MARBLE_R + t * 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
}

function drawFlash() {
    if (flashTimer <= 0 || !flashText) return;
    ctx.globalAlpha = Math.min(1, flashTimer);
    ctx.fillStyle = '#ffd24d';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(flashText, CANVAS_W / 2, 120);
    ctx.globalAlpha = 1;
}

function drawIdleHint() {
    if (state !== 'idle') return;
    ctx.fillStyle = 'rgba(232, 240, 226, 0.35)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Match 3 or more before the chain reaches the pit', CANVAS_W / 2, CANVAS_H - 24);
}

function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    bg.addColorStop(0, '#16210f');
    bg.addColorStop(1, '#0a1006');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawTrack();
    drawPit();
    drawChain();
    drawPops();
    drawProjectiles();
    drawShooter();
    drawFlash();
    drawIdleHint();

    if (inDanger() && state === 'running') {
        ctx.strokeStyle = `rgba(248, 113, 113, ${0.25 + Math.abs(Math.sin(pulse * 6)) * 0.35})`;
        ctx.lineWidth = 6;
        ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);
    }
}

// ---------------------------------------------------------------------------
// Loop & input
// ---------------------------------------------------------------------------

let lastTime = 0;

function loop(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    window.requestAnimationFrame(loop);
}

window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (e.code === 'Space') {
        e.preventDefault();
        if (state === 'running' && !paused) fire();
        else if (!paused) startGame();
    } else if (e.code === 'KeyP') {
        togglePause();
    } else if (e.code === 'KeyS') {
        if (state === 'running' && !paused) swapMarble();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    aimAt(x, y);
});

canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (state === 'running' && !paused) fire();
});

btnStart.addEventListener('click', () => {
    if (paused) togglePause();
    else startGame();
});

(function init() {
    const stored = (() => {
        try {
            return window.localStorage.getItem(BEST_KEY);
        } catch (e) {
            return null;
        }
    })();
    best = stored ? parseInt(stored, 10) || 0 : 0;
    updateHud();
    window.requestAnimationFrame(loop);
})();
