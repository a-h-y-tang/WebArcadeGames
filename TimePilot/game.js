// Time Pilot — a 360-degree free-flight shooter.
//
// The plane is always at the centre of the screen and always moving forward;
// steering turns the world, not the camera. The whole simulation runs on a
// fixed timestep through physicsStep(), and the interesting state (state,
// score, lives, wave, kills, player, enemies, bullets, enemyBullets, chutes)
// is kept at the top level on purpose: the Playwright suite drives the game
// through exactly these names. See DESIGN.md for the rules behind the numbers.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 640
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- plane -----------------------------------------------------------------

const PLAYER_SPEED = 150;            // px/s, constant — there is no throttle
const TURN_RATE = 2.6;               // radians/second
const PLAYER_R = 11;                 // collision radius
const NOSE = 14;                     // muzzle offset from the plane's centre
const INVULN_TIME = 2.5;             // seconds of grace after a hit
const START_LIVES = 3;

// --- guns ------------------------------------------------------------------

const BULLET_SPEED = 430;
const BULLET_LIFE = 1.1;             // deliberately shorter than the despawn ring
const BULLET_R = 3;
const MAX_BULLETS = 6;
const FIRE_COOLDOWN = 0.18;

const ENEMY_BULLET_SPEED = 190;      // slower than the player's, always
const ENEMY_BULLET_LIFE = 2.6;

// --- enemies ---------------------------------------------------------------

const ENEMY_R = 13;
const ENEMY_TURN = 1.8;              // radians/second — below the player's 2.6 on purpose
const ENEMY_RANGE = 320;             // will not shoot from further than this
const ENEMY_AIM = 0.5;               // radians of aim error it will shoot through
const ENEMY_SPAWN_GAP = 0.9;         // seconds between arrivals
const SPAWN_DIST = 420;              // enemies arrive this far out, off screen
const DESPAWN_DIST = 560;            // anything past here is forgotten

// --- parachutes ------------------------------------------------------------

const CHUTE_R = 14;
const CHUTE_DRIFT = 18;              // px/s downward
const CHUTE_GAP = 4;                 // seconds between drops
const CHUTE_ARC = Math.PI * 1.1;     // chutes drop in this wedge ahead of the plane
const CHUTE_DESPAWN = 800;           // chutes are chased, so they linger longer
const MAX_CHUTES = 3;
const RESCUE_POINTS = 1000;

// --- eras ------------------------------------------------------------------

const BANNER_TIME = 2;
const SPEED_STEP = 0.08;             // extra enemy speed per completed cycle
const BEST_KEY = 'timepilot-best';

const ERAS = [
    { year: 1910, name: 'BIPLANES',      speed: 95,  maxAlive: 3, quota: 8,  points: 100, fireGap: 2.6, tint: '#86efac' },
    { year: 1940, name: 'PROP FIGHTERS', speed: 112, maxAlive: 4, quota: 10, points: 200, fireGap: 2.2, tint: '#fde047' },
    { year: 1970, name: 'JETS',          speed: 130, maxAlive: 4, quota: 12, points: 300, fireGap: 1.8, tint: '#93c5fd' },
    { year: 1983, name: 'GUNSHIPS',      speed: 146, maxAlive: 5, quota: 14, points: 400, fireGap: 1.5, tint: '#fda4af' },
    { year: 2001, name: 'SAUCERS',       speed: 162, maxAlive: 5, quota: 16, points: 500, fireGap: 1.2, tint: '#d8b4fe' },
];

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | gameover
let score = 0;
let lives = START_LIVES;
let wave = 1;
let kills = 0;                       // kills in the current era
let rescued = 0;
let best = loadBest();

let player = { x: 0, y: 0, heading: -Math.PI / 2, invuln: 0 };
let enemies = [];
let bullets = [];
let enemyBullets = [];
let chutes = [];
let puffs = [];                      // short-lived explosion rings, cosmetic only

let cooldown = 0;                    // seconds until the gun is ready
let spawnTimer = 1;
let chuteTimer = 2.5;
let banner = { text: '', time: 0 };
let autoRun = true;                  // the animation loop only simulates while true

const keys = Object.create(null);

// --- randomness ------------------------------------------------------------
// A small LCG so a test can pin spawn bearings and fire gaps with seedRng().

let rngState = 1;

function seedRng(n) {
    rngState = (n >>> 0) || 1;
}

function rnd() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
}

// --- helpers ---------------------------------------------------------------

function norm(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

function era() {
    return ERAS[(wave - 1) % ERAS.length];
}

function cycle() {
    return Math.floor((wave - 1) / ERAS.length);
}

function enemySpeed() {
    return era().speed * (1 + SPEED_STEP * cycle());
}

// How far an enemy's nose is from pointing at the player, in radians.
function aimError(e) {
    return Math.abs(norm(Math.atan2(player.y - e.y, player.x - e.x) - e.heading));
}

function distToPlayer(o) {
    return Math.hypot(o.x - player.x, o.y - player.y);
}

// The camera is welded to the plane, so world -> screen is a plain offset.
function screenX(x) {
    return x - player.x + W / 2;
}

function screenY(y) {
    return y - player.y + H / 2;
}

function loadBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (err) {
        return 0;
    }
}

function saveBest() {
    try {
        localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* private browsing — the score just will not persist */
    }
}

// --- lifecycle -------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    wave = 1;
    kills = 0;
    rescued = 0;
    player = { x: 0, y: 0, heading: -Math.PI / 2, invuln: INVULN_TIME };
    enemies = [];
    bullets = [];
    enemyBullets = [];
    chutes = [];
    puffs = [];
    cooldown = 0;
    spawnTimer = 1;
    chuteTimer = 2.5;
    announceEra();
    hideOverlay();
    updateHud();
}

function announceEra() {
    banner = { text: era().year + ' — ' + era().name, time: BANNER_TIME };
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Score ' + score, 'Press P to resume', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function gameOver() {
    state = 'gameover';
    if (score > best) {
        best = score;
        saveBest();
    }
    updateHud();
    const rescues = rescued === 1 ? '1 pilot rescued' : rescued + ' pilots rescued';
    showOverlay(
        'GAME OVER',
        'Score ' + score + '  •  Best ' + best,
        'Reached ' + era().year + '  •  ' + rescues + '. Press Space to fly again.',
        'Fly Again',
    );
}

function hitPlayer() {
    lives--;
    enemyBullets.length = 0;
    puffs.push({ x: player.x, y: player.y, age: 0, big: true });
    if (lives <= 0) {
        lives = 0;
        gameOver();
        return;
    }
    player.invuln = INVULN_TIME;
}

// --- shooting --------------------------------------------------------------

function fire() {
    if (state !== 'running') return false;
    if (cooldown > 0 || bullets.length >= MAX_BULLETS) return false;
    cooldown = FIRE_COOLDOWN;
    const c = Math.cos(player.heading);
    const s = Math.sin(player.heading);
    bullets.push({
        x: player.x + c * NOSE,
        y: player.y + s * NOSE,
        vx: c * BULLET_SPEED,
        vy: s * BULLET_SPEED,
        age: 0,
    });
    return true;
}

function fireEnemyBullet(e) {
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    // Clear of the hull, so a shot reads as a shot and not as a dot on a wing.
    enemyBullets.push({
        x: e.x + Math.cos(a) * (ENEMY_R + 5),
        y: e.y + Math.sin(a) * (ENEMY_R + 5),
        vx: Math.cos(a) * ENEMY_BULLET_SPEED,
        vy: Math.sin(a) * ENEMY_BULLET_SPEED,
        age: 0,
    });
}

// --- spawning --------------------------------------------------------------

function spawnEnemy(bearing) {
    const a = bearing === undefined ? rnd() * Math.PI * 2 : bearing;
    const e = {
        x: player.x + Math.cos(a) * SPAWN_DIST,
        y: player.y + Math.sin(a) * SPAWN_DIST,
        heading: norm(a + Math.PI),  // pointed inward, at the player
        cool: 0.5 + rnd() * era().fireGap,
    };
    enemies.push(e);
    return e;
}

// Pilots bail out into the arc ahead of the plane. Dropping them behind would
// be a rescue the player has to fly a full circle for, which in practice means
// the chute drifts out of range before anyone reaches it.
function spawnChute() {
    const a = player.heading + (rnd() - 0.5) * CHUTE_ARC;
    const r = 200 + rnd() * 120;
    const c = { x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r, age: 0 };
    chutes.push(c);
    return c;
}

function maybeAdvanceWave() {
    if (kills < era().quota) return;
    wave++;
    kills = 0;
    enemyBullets.length = 0;         // a free breath as the clock jumps
    announceEra();
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state !== 'running') return;

    cooldown = Math.max(0, cooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    banner.time = Math.max(0, banner.time - dt);

    // The plane: steer, then fly forward at a constant speed.
    let turn = 0;
    if (keys.ArrowLeft || keys.KeyA) turn -= 1;
    if (keys.ArrowRight || keys.KeyD) turn += 1;
    player.heading = norm(player.heading + turn * TURN_RATE * dt);
    player.x += Math.cos(player.heading) * PLAYER_SPEED * dt;
    player.y += Math.sin(player.heading) * PLAYER_SPEED * dt;

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.age += dt;
        if (b.age > BULLET_LIFE || distToPlayer(b) > DESPAWN_DIST) bullets.splice(i, 1);
    }

    const espeed = enemySpeed();
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        // Weak homing: turn toward the player a little, then commit to the new
        // heading. The overshoot this produces is the dogfight.
        const want = norm(Math.atan2(player.y - e.y, player.x - e.x) - e.heading);
        const limit = ENEMY_TURN * dt;
        e.heading = norm(e.heading + Math.max(-limit, Math.min(limit, want)));
        e.x += Math.cos(e.heading) * espeed * dt;
        e.y += Math.sin(e.heading) * espeed * dt;
        e.cool -= dt;

        const d = distToPlayer(e);
        if (d > DESPAWN_DIST) {
            enemies.splice(i, 1);
            continue;
        }
        if (e.cool <= 0 && d < ENEMY_RANGE && aimError(e) < ENEMY_AIM) {
            fireEnemyBullet(e);
            e.cool = era().fireGap * (0.7 + rnd() * 0.6);
        }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.age += dt;
        if (b.age > ENEMY_BULLET_LIFE || distToPlayer(b) > DESPAWN_DIST) enemyBullets.splice(i, 1);
    }

    for (let i = chutes.length - 1; i >= 0; i--) {
        const c = chutes[i];
        c.y += CHUTE_DRIFT * dt;
        c.age += dt;
        if (distToPlayer(c) > CHUTE_DESPAWN) chutes.splice(i, 1);
    }

    for (let i = puffs.length - 1; i >= 0; i--) {
        puffs[i].age += dt;
        if (puffs[i].age > 0.45) puffs.splice(i, 1);
    }

    resolveCollisions();
    runSpawners(dt);
    updateHud();
}

function resolveCollisions() {
    // Player fire vs enemies.
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (Math.hypot(b.x - e.x, b.y - e.y) < ENEMY_R + BULLET_R) {
                bullets.splice(i, 1);
                enemies.splice(j, 1);
                score += era().points;
                kills++;
                puffs.push({ x: e.x, y: e.y, age: 0, big: false });
                maybeAdvanceWave();
                break;
            }
        }
    }

    // Rescues. Harmless by design: the risk is the detour, not the contact.
    for (let i = chutes.length - 1; i >= 0; i--) {
        const c = chutes[i];
        if (distToPlayer(c) < CHUTE_R + PLAYER_R) {
            chutes.splice(i, 1);
            score += RESCUE_POINTS;
            rescued++;
            puffs.push({ x: c.x, y: c.y, age: 0, big: false });
        }
    }

    if (player.invuln > 0) return;

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (distToPlayer(b) < PLAYER_R + BULLET_R) {
            enemyBullets.splice(i, 1);
            hitPlayer();
            return;
        }
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (distToPlayer(e) < PLAYER_R + ENEMY_R) {
            enemies.splice(j, 1);
            hitPlayer();
            return;
        }
    }
}

function runSpawners(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        if (enemies.length < era().maxAlive) {
            spawnEnemy();
            spawnTimer = ENEMY_SPAWN_GAP;
        } else {
            spawnTimer = 0.3;        // at the cap — look again shortly
        }
    }

    chuteTimer -= dt;
    if (chuteTimer <= 0) {
        if (chutes.length < MAX_CHUTES) {
            spawnChute();
            chuteTimer = CHUTE_GAP;
        } else {
            chuteTimer = 1;
        }
    }
}

// --- HUD and overlay -------------------------------------------------------

const els = {
    score: document.getElementById('score'),
    year: document.getElementById('year'),
    wave: document.getElementById('wave'),
    lives: document.getElementById('lives'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    sub: document.getElementById('overlay-sub'),
    start: document.getElementById('btn-start'),
};

function updateHud() {
    els.score.textContent = String(score);
    els.year.textContent = String(era().year);
    els.wave.textContent = String(wave);
    els.lives.textContent = String(lives);
    els.best.textContent = String(best);
}

function showOverlay(title, scoreLine, sub, button) {
    els.title.textContent = title;
    els.overlayScore.textContent = scoreLine;
    els.sub.textContent = sub;
    els.start.textContent = button;
    els.overlay.classList.add('visible');
}

function hideOverlay() {
    els.overlay.classList.remove('visible');
}

// --- scenery ---------------------------------------------------------------
// Stars and clouds live in a repeating world tile wider than the canvas, so a
// single wrap per axis is enough to cover the screen with no seams. They move
// at different parallax factors, which is the only cue for how fast the plane
// is really going.

const TILE = 800;

function buildScenery(count, seed, make) {
    const keep = rngState;
    seedRng(seed);
    const out = [];
    for (let i = 0; i < count; i++) out.push(make());
    rngState = keep;
    return out;
}

const stars = buildScenery(240, 20010101, () => ({
    x: rnd() * TILE,
    y: rnd() * TILE,
    r: rnd() < 0.25 ? 2 : 1,
}));

// Each cloud is three overlapping lobes so the silhouette is not a disc.
const clouds = buildScenery(22, 19101940, () => ({
    x: rnd() * TILE,
    y: rnd() * TILE,
    r: 30 + rnd() * 34,
    lobes: [
        { dx: 0, dy: 0, k: 1 },
        { dx: -0.7 + rnd() * 0.3, dy: 0.15 + rnd() * 0.2, k: 0.72 },
        { dx: 0.6 + rnd() * 0.3, dy: -0.1 + rnd() * 0.25, k: 0.66 },
    ],
}));

function wrapCoord(v) {
    let r = ((v % TILE) + TILE) % TILE;
    if (r > TILE / 2) r -= TILE;
    return r;
}

function drawScenery() {
    ctx.fillStyle = '#cfe3ff';
    for (const s of stars) {
        const sx = W / 2 + wrapCoord(s.x - player.x * 0.3);
        const sy = H / 2 + wrapCoord(s.y - player.y * 0.3);
        ctx.globalAlpha = s.r === 2 ? 0.85 : 0.5;
        ctx.fillRect(sx - s.r / 2, sy - s.r / 2, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    for (const c of clouds) {
        const sx = W / 2 + wrapCoord(c.x - player.x * 0.8);
        const sy = H / 2 + wrapCoord(c.y - player.y * 0.8);
        if (!onScreen(sx, sy, c.r * 2.2)) continue;
        for (const lobe of c.lobes) {
            const lx = sx + lobe.dx * c.r;
            const ly = sy + lobe.dy * c.r;
            const lr = c.r * lobe.k;
            const g = ctx.createRadialGradient(lx, ly, lr * 0.15, lx, ly, lr);
            g.addColorStop(0, 'rgba(173, 201, 240, 0.16)');
            g.addColorStop(1, 'rgba(173, 201, 240, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(lx, ly, lr, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// --- drawing ---------------------------------------------------------------

function onScreen(sx, sy, pad) {
    return sx > -pad && sx < W + pad && sy > -pad && sy < H + pad;
}

// All craft are drawn nose-along +x and rotated into their heading.

function fuselagePath(s) {
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(s * 0.34, -s * 0.21);
    ctx.lineTo(-s * 0.86, -s * 0.17);
    ctx.lineTo(-s, 0);
    ctx.lineTo(-s * 0.86, s * 0.17);
    ctx.lineTo(s * 0.34, s * 0.21);
    ctx.closePath();
}

// A wing pair: a wide chord at the root tapering to a narrow tip, swept back by
// `sweep`. Tapering the other way is what makes a top-down plane read as an X.
function wingPath(s, span, sweep, at) {
    ctx.beginPath();
    ctx.moveTo(at + s * 0.3, 0);
    ctx.lineTo(at + s * 0.12 - sweep, -span);
    ctx.lineTo(at - s * 0.16 - sweep, -span);
    ctx.lineTo(at - s * 0.32, 0);
    ctx.lineTo(at - s * 0.16 - sweep, span);
    ctx.lineTo(at + s * 0.12 - sweep, span);
    ctx.closePath();
}

function drawAircraft(s, fill, stroke, kind) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;

    // tailplane
    wingPath(s * 0.45, s * 0.42, s * 0.05, -s * 0.62);
    ctx.fill();
    ctx.stroke();

    // mainplane — straight for props, swept for jets
    wingPath(s, s * 0.92, kind === 'jet' ? s * 0.45 : s * 0.1, 0);
    ctx.fill();
    ctx.stroke();

    if (kind === 'biplane') {
        // the second wing, offset forward, reads as a stacked pair
        ctx.globalAlpha = 0.75;
        wingPath(s * 0.85, s * 0.84, -s * 0.1, s * 0.16);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    fuselagePath(s);
    ctx.fill();
    ctx.stroke();

    // cockpit
    ctx.fillStyle = 'rgba(8, 18, 34, 0.75)';
    ctx.beginPath();
    ctx.ellipse(s * 0.08, 0, s * 0.2, s * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawHelicopter(s, fill, stroke, spin) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;

    // tail boom and fin
    ctx.fillRect(-s * 1.25, -s * 0.09, s * 0.9, s * 0.18);
    ctx.beginPath();
    ctx.moveTo(-s * 1.3, 0);
    ctx.lineTo(-s * 1.05, -s * 0.45);
    ctx.lineTo(-s * 0.9, 0);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(s * 0.05, 0, s * 0.72, s * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(8, 18, 34, 0.75)';
    ctx.beginPath();
    ctx.ellipse(s * 0.42, 0, s * 0.26, s * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();

    // rotor disc
    ctx.save();
    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.lineTo(s, 0);
        ctx.stroke();
        ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
}

function drawSaucer(s, fill, stroke, spin) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.05, s * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(236, 254, 255, 0.92)';
    ctx.beginPath();
    ctx.arc(0, -s * 0.08, s * 0.46, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = '#fde68a';
    for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.78, Math.sin(a) * s * 0.34, s * 0.11, 0, Math.PI * 2);
        ctx.fill();
    }
}

const ERA_KIND = ['biplane', 'prop', 'jet', 'helicopter', 'saucer'];

function drawCraft(sx, sy, heading, size, fill, stroke, kind, spin) {
    ctx.save();
    ctx.translate(sx, sy);
    // Saucers hover level whatever direction they are travelling; banking one
    // just looks like a tipped-over plate.
    ctx.rotate(kind === 'saucer' ? 0 : heading);
    if (kind === 'helicopter') drawHelicopter(size, fill, stroke, spin);
    else if (kind === 'saucer') drawSaucer(size, fill, stroke, spin);
    else drawAircraft(size, fill, stroke, kind);
    ctx.restore();
}

function drawChute(sx, sy, age) {
    const sway = Math.sin(age * 1.8) * 3;
    ctx.save();
    ctx.translate(sx + sway, sy);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(0, -4, 13, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-11, -3);
    ctx.lineTo(0, 9);
    ctx.lineTo(11, -3);
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(0, 12, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

// A chevron on the screen edge for anything worth turning toward.
function drawEdgeMarker(worldX, worldY, color) {
    const a = Math.atan2(worldY - player.y, worldX - player.x);
    const rx = W / 2 - 16;
    const ry = H / 2 - 16;
    const scale = Math.min(
        rx / Math.max(Math.abs(Math.cos(a)) * rx, 1e-6),
        ry / Math.max(Math.abs(Math.sin(a)) * ry, 1e-6),
    );
    ctx.save();
    ctx.translate(W / 2 + Math.cos(a) * rx * scale, H / 2 + Math.sin(a) * ry * scale);
    ctx.rotate(a);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function draw() {
    const spin = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d1626');
    sky.addColorStop(1, '#05080f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawScenery();

    const e0 = era();
    const kind = ERA_KIND[(wave - 1) % ERAS.length];

    for (const c of chutes) {
        const sx = screenX(c.x);
        const sy = screenY(c.y);
        if (onScreen(sx, sy, 40)) drawChute(sx, sy, c.age);
        else drawEdgeMarker(c.x, c.y, 'rgba(248, 250, 252, 0.7)');
    }

    for (const e of enemies) {
        const sx = screenX(e.x);
        const sy = screenY(e.y);
        if (onScreen(sx, sy, 48)) drawCraft(sx, sy, e.heading, 17, e0.tint, '#0b1222', kind, spin * 9);
        else drawEdgeMarker(e.x, e.y, 'rgba(248, 113, 113, 0.6)');
    }

    ctx.fillStyle = '#fca5a5';
    for (const b of enemyBullets) {
        ctx.beginPath();
        ctx.arc(screenX(b.x), screenY(b.y), 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.strokeStyle = '#67e8f9';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const b of bullets) {
        const sx = screenX(b.x);
        const sy = screenY(b.y);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - b.vx * 0.022, sy - b.vy * 0.022);
        ctx.stroke();
    }

    for (const p of puffs) {
        const t = p.age / 0.45;
        ctx.strokeStyle = 'rgba(251, 191, 36, ' + (1 - t).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screenX(p.x), screenY(p.y), (p.big ? 34 : 20) * t + 4, 0, Math.PI * 2);
        ctx.stroke();
    }

    // The plane, forever at the centre. While invulnerable it pulses inside a
    // shield ring rather than blinking out: a plane that is missing on half the
    // frames is a plane you cannot aim.
    if (state !== 'gameover') {
        ctx.save();
        if (player.invuln > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(player.invuln * 14);
            ctx.globalAlpha = 0.5 + 0.5 * pulse;
            ctx.strokeStyle = 'rgba(103, 232, 249, ' + (0.2 + 0.3 * pulse).toFixed(3) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(W / 2, H / 2, 26, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.shadowColor = 'rgba(56, 189, 248, 0.55)';
        ctx.shadowBlur = 12;
        drawCraft(W / 2, H / 2, player.heading, 19, '#38bdf8', '#e0f2fe', 'prop', spin);
        ctx.restore();
    }

    drawProgress();
    drawBanner();
}

function drawProgress() {
    const e = era();
    const pad = 16;
    const barW = 150;
    const barH = 8;
    const x = pad;
    const y = H - pad - barH;

    ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.fillRect(x, y, barW, barH);
    ctx.fillStyle = e.tint;
    ctx.fillRect(x, y, (barW * Math.min(kills, e.quota)) / e.quota, barH);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(e.year + '  ' + e.name + '   ' + Math.min(kills, e.quota) + '/' + e.quota, x, y - 7);

    if (rescued > 0) {
        ctx.textAlign = 'right';
        ctx.fillText('Pilots rescued  ' + rescued, W - pad, y + barH);
    }
}

function drawBanner() {
    if (banner.time <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, banner.time / 0.6);
    ctx.fillStyle = era().tint;
    ctx.font = 'bold 42px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, H * 0.3);
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText('Shoot down ' + era().quota + ' to reach the next era', W / 2, H * 0.3 + 34);
    ctx.restore();
}

// --- input -----------------------------------------------------------------

const HELD = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

window.addEventListener('keydown', (ev) => {
    if (HELD.includes(ev.code)) ev.preventDefault();
    keys[ev.code] = true;

    if (ev.code === 'Space') {
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'running') fire();
    }
    if (ev.code === 'KeyP') togglePause();
});

window.addEventListener('keyup', (ev) => {
    keys[ev.code] = false;
});

canvas.addEventListener('mousedown', () => {
    if (state === 'running') fire();
    else if (state === 'idle' || state === 'gameover') startGame();
});

els.start.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// --- loop ------------------------------------------------------------------

let lastTs = 0;
let acc = 0;

function frame(ts) {
    requestAnimationFrame(frame);
    if (!lastTs) lastTs = ts;
    let elapsed = (ts - lastTs) / 1000;
    lastTs = ts;
    if (elapsed > 0.25) elapsed = 0.25;   // a backgrounded tab must not fast-forward

    if (autoRun) {
        acc += elapsed;
        while (acc >= DT) {
            physicsStep(DT);
            acc -= DT;
        }
    }
    draw();
}

seedRng((Date.now() % 100000) + 1);
updateHud();
requestAnimationFrame(frame);
