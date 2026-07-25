// ---------------------------------------------------------------------------
// Moon Patrol — drive a moon buggy across the lunar surface, jumping craters
// and rocks while blasting rocks ahead and UFOs above.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring the
// Dino Run and Snake games in this repo. All motion is expressed per-second
// and advanced through `step(dt)`, so the tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing. Integration runs in small fixed sub-steps so fast bullets and the
// scrolling world never tunnel through collisions.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 260;
const GROUND_Y = 210;          // top surface of the ground; the buggy's wheels rest here

// --- Buggy ---
const BUGGY_X = 90;            // fixed horizontal position (the world scrolls, not the buggy)
const BUGGY_W = 54;
const BUGGY_H = 30;

// --- Physics (units per second) ---
const GRAVITY = 2600;
const JUMP_V = -820;

// --- Scrolling ---
const BASE_SPEED = 260;
const MAX_SPEED = 460;
const SPEED_RAMP = 0.015;       // speed gained per pixel travelled

// --- Hazards ---
const ROCK_W = 26;
const ROCK_H = 26;
const CRATER_W = 62;
const UFO_W = 34;
const UFO_H = 16;

// --- Bullets ---
const BULLET_FWD_SPEED = 560;
const BULLET_UP_SPEED = 520;
const FWD_BULLET_Y = GROUND_Y - ROCK_H / 2;

// --- Rules ---
const START_LIVES = 3;
const INVULN_TIME = 1.4;        // seconds of grace after a crash
const ROCK_POINTS = 50;
const UFO_POINTS = 100;

// --- Auto spawner ---
const FIRST_SPAWN = 260;        // grace distance before the first hazard
const MIN_GAP = 220;
const RAND_GAP = 240;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, lives, distance, speed, bonus, nextSpawnDist;
let autoSpawn;                  // tests flip this off to isolate manual hazards
const buggy = { y: GROUND_Y, vy: 0, onGround: true, invuln: 0 };
const rocks = [];
const craters = [];
const ufos = [];
const bullets = [];
const stars = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

function buggyBox() {
    return { x: BUGGY_X, y: buggy.y - BUGGY_H, w: BUGGY_W, h: BUGGY_H };
}

function rockBox(r) {
    return { x: r.x, y: GROUND_Y - ROCK_H, w: ROCK_W, h: ROCK_H };
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

function spawnRock(opts) {
    opts = opts || {};
    const r = { x: opts.x != null ? opts.x : CANVAS_W };
    rocks.push(r);
    return r;
}

function spawnCrater(opts) {
    opts = opts || {};
    const c = { x: opts.x != null ? opts.x : CANVAS_W, w: opts.w != null ? opts.w : CRATER_W };
    craters.push(c);
    return c;
}

function spawnUfo(opts) {
    opts = opts || {};
    const u = {
        x: opts.x != null ? opts.x : CANVAS_W,
        y: opts.y != null ? opts.y : 50,
        vx: opts.vx != null ? opts.vx : -220,
        vy: opts.vy != null ? opts.vy : 40,
    };
    ufos.push(u);
    return u;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

function jump() {
    if (state !== 'running') return;
    if (buggy.onGround) {
        buggy.vy = JUMP_V;
        buggy.onGround = false;
    }
}

function fire() {
    if (state !== 'running') return;
    // Forward bullet, at rock height, clears rocks ahead.
    bullets.push({ dir: 'fwd', x: BUGGY_X + BUGGY_W, y: FWD_BULLET_Y, vx: BULLET_FWD_SPEED, vy: 0 });
    // Up bullet, from the buggy, knocks down UFOs.
    bullets.push({ dir: 'up', x: BUGGY_X + BUGGY_W - 8, y: buggy.y - BUGGY_H, vx: 0, vy: -BULLET_UP_SPEED });
}

// ---------------------------------------------------------------------------
// Crashing
// ---------------------------------------------------------------------------

function crash() {
    if (buggy.invuln > 0) return;
    lives--;
    // Clear the screen of immediate threats so the player can recover.
    rocks.length = 0;
    craters.length = 0;
    ufos.length = 0;
    // Bounce the buggy back to the ground.
    buggy.y = GROUND_Y;
    buggy.vy = 0;
    buggy.onGround = true;
    if (lives <= 0) {
        lives = 0;
        endGame();
    } else {
        buggy.invuln = INVULN_TIME;
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    if (buggy.invuln > 0) buggy.invuln = Math.max(0, buggy.invuln - h);

    // Buggy vertical physics.
    buggy.vy += GRAVITY * h;
    buggy.y += buggy.vy * h;
    if (buggy.y >= GROUND_Y) {
        buggy.y = GROUND_Y;
        buggy.vy = 0;
        buggy.onGround = true;
    }

    // Advance the world.
    distance += speed * h;
    speed = Math.min(MAX_SPEED, BASE_SPEED + distance * SPEED_RAMP);

    for (const r of rocks) r.x -= speed * h;
    for (const c of craters) c.x -= speed * h;
    for (const u of ufos) { u.x += u.vx * h; u.y += u.vy * h; }
    for (const b of bullets) { b.x += b.vx * h; b.y += b.vy * h; }

    // Bullets vs hazards.
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const bb = { x: b.x - 3, y: b.y - 3, w: 6, h: 6 };
        let hit = false;
        if (b.dir === 'fwd') {
            for (let j = rocks.length - 1; j >= 0; j--) {
                if (aabb(bb, rockBox(rocks[j]))) {
                    rocks.splice(j, 1);
                    bonus += ROCK_POINTS;
                    hit = true;
                    break;
                }
            }
        } else {
            for (let j = ufos.length - 1; j >= 0; j--) {
                const u = ufos[j];
                if (aabb(bb, { x: u.x, y: u.y, w: UFO_W, h: UFO_H })) {
                    ufos.splice(j, 1);
                    bonus += UFO_POINTS;
                    hit = true;
                    break;
                }
            }
        }
        if (hit || b.x > CANVAS_W + 20 || b.x < -20 || b.y < -20 || b.y > CANVAS_H + 20) {
            bullets.splice(i, 1);
        }
    }

    // Cull off-screen hazards.
    for (let i = rocks.length - 1; i >= 0; i--) if (rocks[i].x + ROCK_W < 0) rocks.splice(i, 1);
    for (let i = craters.length - 1; i >= 0; i--) if (craters[i].x + craters[i].w < 0) craters.splice(i, 1);
    for (let i = ufos.length - 1; i >= 0; i--) {
        const u = ufos[i];
        if (u.x + UFO_W < 0 || u.y > CANVAS_H + 40) ufos.splice(i, 1);
    }

    // Collisions with the buggy.
    if (buggy.invuln <= 0 && state === 'running') {
        const box = buggyBox();
        // Craters: a crash only if we are on the ground over the pit.
        if (buggy.onGround) {
            for (const c of craters) {
                if (box.x < c.x + c.w && box.x + box.w > c.x) { crash(); break; }
            }
        }
        if (state === 'running' && buggy.invuln <= 0) {
            for (const r of rocks) {
                if (aabb(box, rockBox(r))) { crash(); break; }
            }
        }
        if (state === 'running' && buggy.invuln <= 0) {
            for (const u of ufos) {
                if (aabb(box, { x: u.x, y: u.y, w: UFO_W, h: UFO_H })) { crash(); break; }
            }
        }
    }

    // Auto spawner.
    if (autoSpawn && distance >= nextSpawnDist) {
        autoSpawnHazard();
        nextSpawnDist = distance + MIN_GAP + pseudoRand() * RAND_GAP;
    }

    score = Math.floor(distance / 10) + bonus;
}

// A tiny deterministic-enough source of variety for the live spawner. (The
// tests never rely on it; they drive spawning explicitly.)
let seed = 20250718;
function pseudoRand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

function autoSpawnHazard() {
    const roll = pseudoRand();
    if (roll < 0.45) {
        spawnRock({ x: CANVAS_W + 10 });
    } else if (roll < 0.75) {
        spawnCrater({ x: CANVAS_W + 10 });
    } else {
        spawnUfo({ x: CANVAS_W + 10, y: 40 + pseudoRand() * 40, vx: -(speed + 60), vy: 55 });
    }
}

// Advance the simulation by `dt` seconds in small fixed sub-steps.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 480;
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
// Game flow
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    bonus = 0;
    lives = START_LIVES;
    distance = 0;
    speed = BASE_SPEED;
    autoSpawn = true;
    nextSpawnDist = FIRST_SPAWN;
    rocks.length = 0;
    craters.length = 0;
    ufos.length = 0;
    bullets.length = 0;
    buggy.y = GROUND_Y;
    buggy.vy = 0;
    buggy.onGround = true;
    buggy.invuln = 0;
    if (stars.length === 0) seedStars();
    hideOverlay();
    updateHud();
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('moonpatrol-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score, 'Press Enter to patrol again', 'Play Again');
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    bestEl.textContent = String(best);
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
// Rendering
// ---------------------------------------------------------------------------

function seedStars() {
    stars.length = 0;
    for (let i = 0; i < 40; i++) {
        stars.push({ x: pseudoRand() * CANVAS_W, y: pseudoRand() * (GROUND_Y - 40), r: pseudoRand() < 0.2 ? 2 : 1 });
    }
}

function draw() {
    // Sky.
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars.
    ctx.fillStyle = '#cbd5e1';
    for (const s of stars) ctx.fillRect(s.x, s.y, s.r, s.r);

    // Distant mountains (parallax).
    ctx.fillStyle = '#1b1030';
    const off = (distance * 0.2) % 120;
    ctx.beginPath();
    ctx.moveTo(-off, GROUND_Y);
    for (let x = -off; x < CANVAS_W + 120; x += 120) {
        ctx.lineTo(x + 60, GROUND_Y - 46);
        ctx.lineTo(x + 120, GROUND_Y);
    }
    ctx.lineTo(CANVAS_W, GROUND_Y);
    ctx.fill();

    // Ground.
    ctx.fillStyle = '#2a2038';
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);

    // Craters (holes cut out of the ground surface).
    ctx.fillStyle = '#05060f';
    for (const c of craters) {
        ctx.fillRect(c.x, GROUND_Y, c.w, CANVAS_H - GROUND_Y);
        ctx.beginPath();
        ctx.ellipse(c.x + c.w / 2, GROUND_Y + 3, c.w / 2, 7, 0, 0, Math.PI);
        ctx.fill();
    }

    // Rocks.
    ctx.fillStyle = '#8b8090';
    for (const r of rocks) {
        const b = rockBox(r);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + b.h);
        ctx.lineTo(b.x + b.w * 0.25, b.y + b.h * 0.3);
        ctx.lineTo(b.x + b.w * 0.6, b.y);
        ctx.lineTo(b.x + b.w, b.y + b.h * 0.5);
        ctx.lineTo(b.x + b.w, b.y + b.h);
        ctx.closePath();
        ctx.fill();
    }

    // UFOs.
    for (const u of ufos) {
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.ellipse(u.x + UFO_W / 2, u.y + UFO_H / 2, UFO_W / 2, UFO_H / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fda4af';
        ctx.beginPath();
        ctx.ellipse(u.x + UFO_W / 2, u.y + UFO_H * 0.35, UFO_W / 4, UFO_H / 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Bullets.
    for (const b of bullets) {
        ctx.fillStyle = b.dir === 'up' ? '#38bdf8' : '#fbbf24';
        ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }

    // Buggy.
    const box = buggyBox();
    const blink = buggy.invuln > 0 && Math.floor(buggy.invuln * 12) % 2 === 0;
    if (!blink) {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(box.x + 6, box.y, box.w - 12, box.h - 12);        // cabin
        ctx.fillRect(box.x, box.y + box.h - 16, box.w, 8);             // chassis
        ctx.fillStyle = '#0f172a';
        // wheels
        ctx.beginPath(); ctx.arc(box.x + 12, box.y + box.h - 4, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(box.x + box.w - 12, box.y + box.h - 4, 6, 0, Math.PI * 2); ctx.fill();
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
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const JUMP_KEYS = new Set([' ', 'Spacebar', 'ArrowUp', 'w', 'W']);
const FIRE_KEYS = new Set(['f', 'F', 'ArrowDown', 's', 'S']);
const START_KEYS = new Set(['Enter']);

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (START_KEYS.has(e.key)) {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }
    if (JUMP_KEYS.has(e.key)) {
        if (state === 'idle' || state === 'over') startGame();
        else jump();
        e.preventDefault();
        return;
    }
    if (FIRE_KEYS.has(e.key)) {
        if (state === 'running') fire();
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('moonpatrol-best') || '0', 10) || 0;
state = 'idle';
score = 0;
bonus = 0;
lives = START_LIVES;
distance = 0;
speed = BASE_SPEED;
autoSpawn = true;
nextSpawnDist = FIRST_SPAWN;
seedStars();
updateHud();
requestAnimationFrame(frame);
