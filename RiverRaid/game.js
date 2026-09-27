/*
 * River Raid — a vertical scrolling river shooter.
 *
 * The world is one long river running "up" the screen. The jet sits at a fixed
 * screen row and the world scrolls past it, so every object lives at a world
 * position (worldY) and is drawn relative to how far the jet has flown
 * (distance). Everything the tests need is a plain global: the simulation is a
 * pure `step(dt)` over that state, and `draw()` never mutates anything.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var CANVAS_W = 480;
var CANVAS_H = 600;
var PLAYER_Y = CANVAS_H - 80;          // screen row the jet is pinned to

var ROW_H = 20;                        // world units covered by one terrain row
var MIN_RIVER_W = 130;
var MAX_RIVER_W = 300;
var BANK_MARGIN = 24;                  // land kept on each side of the canvas
var START_ROWS = 10;                   // straight, wide run-in before the river bends
var SECTION_ROWS = 45;                 // a bridge every this many rows
var VIEW_AHEAD = CANVAS_H + 240;       // how far ahead of the jet we generate

var MAX_FUEL = 100;
var FUEL_BURN = 6.5;                   // tank units per second
var REFUEL_RATE = 70;                  // tank units per second over a depot

var START_LIVES = 3;
var BASE_SPEED = 105;                  // world units per second at normal throttle
var SPEED_PER_SECTION = 9;
var THROTTLE_FAST = 1.65;
var THROTTLE_SLOW = 0.55;
var PLAYER_VX = 210;                   // sideways pixels per second
var MISSILE_SPEED = 430;
var INVULN_TIME = 1.6;
var CULL_BEHIND = 120;                 // world units behind the jet before culling

var POINTS = { heli: 60, ship: 30, jet: 100, fuel: 80, bridge: 500 };

var ENTITY_SIZES = {
    heli: { w: 30, h: 18 },
    ship: { w: 44, h: 16 },
    jet: { w: 30, h: 16 },
    fuel: { w: 22, h: 30 },
    bridge: { w: 240, h: 26 },
};

var BEST_KEY = 'riverraid-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
var state = 'idle';                    // idle | running | paused | over
var score = 0;
var best = 0;
var lives = START_LIVES;
var fuel = MAX_FUEL;
var section = 1;
var distance = 0;

var terrain = [];                      // [{ left, right, bridge }]
var entities = [];
var missiles = [];
var blasts = [];                       // purely decorative explosion rings

var player = {
    x: CANVAS_W / 2,
    w: 26,
    h: 30,
    vx: 0,                             // -1 / 0 / 1 steering input
    throttle: 0,                       // -1 / 0 / 1
    invuln: 0,
};

// terrain generator cursor
var nextRow = 0;
var genLeft = 0;
var genWidth = 0;
var targetLeft = 0;
var targetWidth = 0;
var holdRows = 0;

var canvas = document.getElementById('canvas');
var ctx = canvas ? canvas.getContext('2d') : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randRange(lo, hi) {
    return lo + Math.random() * (hi - lo);
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function moveToward(value, target, maxStep) {
    var delta = target - value;
    if (Math.abs(delta) <= maxStep) return target;
    return value + (delta > 0 ? maxStep : -maxStep);
}

function isBridgeRow(row) {
    return row > 0 && row % SECTION_ROWS === 0;
}

function sectionForRow(row) {
    return Math.floor(row / SECTION_ROWS) + 1;
}

function screenYFor(worldY) {
    return PLAYER_Y - (worldY - distance);
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
function resetTerrain() {
    terrain = [];
    nextRow = 0;
    genWidth = 240;
    genLeft = (CANVAS_W - genWidth) / 2;
    targetWidth = genWidth;
    targetLeft = genLeft;
    holdRows = START_ROWS;
}

function pickNewCourse() {
    targetWidth = randRange(MIN_RIVER_W, MAX_RIVER_W);
    targetLeft = randRange(BANK_MARGIN, CANVAS_W - BANK_MARGIN - targetWidth);
    holdRows = Math.round(randRange(6, 16));
}

function generateRow() {
    var row = nextRow;

    if (row >= START_ROWS) {
        if (holdRows <= 0) pickNewCourse();
        holdRows--;
        genWidth = moveToward(genWidth, targetWidth, 5);
        genLeft = moveToward(genLeft, targetLeft, 6);
    }

    genWidth = clamp(genWidth, MIN_RIVER_W, MAX_RIVER_W);
    genLeft = clamp(genLeft, BANK_MARGIN, CANVAS_W - BANK_MARGIN - genWidth);

    var left = genLeft;
    var right = genLeft + genWidth;
    terrain.push({ left: left, right: right, bridge: isBridgeRow(row) });
    nextRow++;

    // The idle attract screen still needs banks to draw, but the river should
    // be empty until a run starts (startGame regenerates the course anyway).
    if (state === 'idle') return;

    var centreY = (row + 0.5) * ROW_H;
    if (isBridgeRow(row)) {
        var bridge = spawnEntity('bridge', (left + right) / 2, centreY);
        bridge.w = right - left + 8;
    } else {
        maybeSpawnTraffic(row, left, right, centreY);
    }
}

function maybeSpawnTraffic(row, left, right, centreY) {
    // keep the run-in and the approach to each bridge clear
    if (row < START_ROWS + 4) return;
    for (var d = -2; d <= 2; d++) {
        if (isBridgeRow(row + d)) return;
    }

    var sec = sectionForRow(row);
    if (Math.random() > 0.10 + Math.min(0.10, sec * 0.012)) return;

    var roll = Math.random();
    var type;
    if (roll < 0.32) type = 'fuel';
    else if (roll < 0.60) type = 'heli';
    else if (roll < 0.85 || sec < 3) type = 'ship';
    else type = 'jet';

    var size = ENTITY_SIZES[type];
    var lo = left + size.w / 2 + 4;
    var hi = right - size.w / 2 - 4;
    if (hi <= lo) return;

    spawnEntity(type, randRange(lo, hi), centreY);
}

function ensureTerrain(uptoWorldY) {
    var guard = 0;
    while (nextRow * ROW_H < uptoWorldY && guard++ < 5000) generateRow();
}

/** River edges at a world position, interpolated between row centres. */
function riverBoundsAt(worldY) {
    ensureTerrain(worldY + ROW_H * 3);
    var f = worldY / ROW_H - 0.5;
    var i = Math.floor(f);
    var t = f - i;
    if (i < 0) { i = 0; t = 0; }
    var a = terrain[i] || terrain[terrain.length - 1];
    var b = terrain[i + 1] || a;
    return {
        left: a.left + (b.left - a.left) * t,
        right: a.right + (b.right - a.right) * t,
    };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
function spawnEntity(type, x, worldY) {
    var size = ENTITY_SIZES[type] || { w: 24, h: 20 };
    var entity = {
        type: type,
        x: x,
        worldY: worldY,
        w: size.w,
        h: size.h,
        vx: 0,
        dead: false,
    };

    if (type === 'heli') entity.vx = randRange(34, 62) * (Math.random() < 0.5 ? -1 : 1);
    else if (type === 'ship') entity.vx = randRange(18, 34) * (Math.random() < 0.5 ? -1 : 1);
    else if (type === 'jet') entity.vx = randRange(95, 135) * (Math.random() < 0.5 ? -1 : 1);

    entities.push(entity);
    return entity;
}

function updateEntities(dt) {
    for (var i = entities.length - 1; i >= 0; i--) {
        var e = entities[i];

        if (e.worldY < distance - CULL_BEHIND) {
            entities.splice(i, 1);
            continue;
        }

        if (e.vx === 0) continue;

        var b = riverBoundsAt(e.worldY);
        if (b.right - b.left <= e.w) {
            e.x = (b.left + b.right) / 2;
            continue;
        }

        e.x += e.vx * dt;
        if (e.x - e.w / 2 < b.left) {
            e.x = b.left + e.w / 2;
            e.vx = Math.abs(e.vx);
        } else if (e.x + e.w / 2 > b.right) {
            e.x = b.right - e.w / 2;
            e.vx = -Math.abs(e.vx);
        }
    }
}

// ---------------------------------------------------------------------------
// Player controls
// ---------------------------------------------------------------------------
function movePlayer(dir) {
    player.vx = dir < 0 ? -1 : dir > 0 ? 1 : 0;
}

function setThrottle(value) {
    player.throttle = value < 0 ? -1 : value > 0 ? 1 : 0;
}

function setPlayerX(x) {
    player.x = clamp(x, player.w / 2, CANVAS_W - player.w / 2);
}

function currentSpeed() {
    var base = BASE_SPEED + (section - 1) * SPEED_PER_SECTION;
    var mult = player.throttle > 0 ? THROTTLE_FAST : player.throttle < 0 ? THROTTLE_SLOW : 1;
    return base * mult;
}

function fire() {
    if (state !== 'running') return false;
    if (missiles.length > 0) return false;
    missiles.push({ x: player.x, worldY: distance + player.h / 2, w: 4, h: 14 });
    return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function overlapsPlayer(e) {
    return Math.abs(e.worldY - distance) < (e.h + player.h) / 2
        && Math.abs(e.x - player.x) < (e.w + player.w) / 2;
}

function hits(missile, e) {
    return Math.abs(missile.worldY - e.worldY) < (missile.h + e.h) / 2
        && Math.abs(missile.x - e.x) < (missile.w + e.w) / 2;
}

function addBlast(x, worldY, size) {
    blasts.push({ x: x, worldY: worldY, size: size, life: 0.45, max: 0.45 });
}

function destroy(e) {
    var index = entities.indexOf(e);
    if (index >= 0) entities.splice(index, 1);
    score += POINTS[e.type] || 0;
    addBlast(e.x, e.worldY, Math.max(e.w, e.h) * (e.type === 'bridge' ? 0.5 : 0.9));
    if (e.type === 'bridge') section++;
}

/** Decorative only, so it ages on the render clock rather than inside step(). */
function ageBlasts(dt) {
    for (var i = blasts.length - 1; i >= 0; i--) {
        blasts[i].life -= dt;
        if (blasts[i].life <= 0) blasts.splice(i, 1);
    }
}

function updateMissiles(dt) {
    for (var i = missiles.length - 1; i >= 0; i--) {
        var m = missiles[i];
        m.worldY += MISSILE_SPEED * dt;

        var hitSomething = false;
        for (var j = 0; j < entities.length; j++) {
            if (hits(m, entities[j])) {
                destroy(entities[j]);
                hitSomething = true;
                break;
            }
        }
        if (hitSomething) {
            missiles.splice(i, 1);
            continue;
        }

        if (m.worldY > distance + PLAYER_Y + 20) {
            missiles.splice(i, 1);
            continue;
        }

        var b = riverBoundsAt(m.worldY);
        if (m.x < b.left || m.x > b.right) missiles.splice(i, 1);
    }
}

function resolvePlayer(dt) {
    var refuelling = false;

    for (var i = entities.length - 1; i >= 0; i--) {
        var e = entities[i];
        if (!overlapsPlayer(e)) continue;

        if (e.type === 'fuel') {
            refuelling = true;
        } else if (player.invuln <= 0) {
            crash();
            return;
        }
    }

    if (player.invuln <= 0) {
        var b = riverBoundsAt(distance);
        if (player.x - player.w / 2 < b.left || player.x + player.w / 2 > b.right) {
            crash();
            return;
        }
    }

    // burn first, then top up, so sitting on a depot fills the tank exactly
    fuel -= FUEL_BURN * dt;
    if (refuelling) fuel = Math.min(MAX_FUEL, fuel + REFUEL_RATE * dt);
    if (fuel <= 0) {
        fuel = 0;
        crash();
    }
}

function crash() {
    missiles.length = 0;
    addBlast(player.x, distance, 34);
    lives--;

    if (lives <= 0) {
        lives = 0;
        updateHud();
        endGame();
        return;
    }

    fuel = MAX_FUEL;
    var b = riverBoundsAt(distance);
    player.x = (b.left + b.right) / 2;
    player.vx = 0;
    player.throttle = 0;
    player.invuln = INVULN_TIME;

    // clear the traffic right around the jet so the respawn is survivable
    for (var i = entities.length - 1; i >= 0; i--) {
        var e = entities[i];
        if (e.type !== 'bridge' && Math.abs(e.worldY - distance) < 160) entities.splice(i, 1);
    }

    syncKeys();   // keys still held should take effect again immediately
    updateHud();
}

function step(dt) {
    if (state !== 'running') return;
    if (dt > 0.05) dt = 0.05;

    distance += currentSpeed() * dt;
    setPlayerX(player.x + player.vx * PLAYER_VX * dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);

    ensureTerrain(distance + VIEW_AHEAD);
    updateEntities(dt);
    updateMissiles(dt);
    resolvePlayer(dt);
    updateHud();
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------
function loadBest() {
    try {
        best = parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0;
    } catch (err) {
        best = 0;
    }
}

function saveBest() {
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (err) {
        /* storage unavailable — best simply will not persist */
    }
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    fuel = MAX_FUEL;
    section = 1;
    distance = 0;
    entities = [];
    missiles = [];
    blasts = [];
    resetTerrain();

    player.vx = 0;
    player.throttle = 0;
    player.invuln = 0;

    // running before generating: traffic only spawns for a live run, so the very
    // first game must not be flown down an empty river
    state = 'running';
    ensureTerrain(VIEW_AHEAD);
    var b = riverBoundsAt(0);
    player.x = (b.left + b.right) / 2;

    hideOverlay();
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        saveBest();
    }
    updateHud();
    showOverlay('MISSION OVER', 'Score ' + score + '  ·  Section ' + section, 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
var elScore = document.getElementById('score');
var elSection = document.getElementById('section');
var elLives = document.getElementById('lives');
var elFuel = document.getElementById('fuel');
var elFuelBar = document.getElementById('fuel-bar');
var elBest = document.getElementById('best');
var elOverlay = document.getElementById('overlay');
var elOverlayTitle = document.getElementById('overlay-title');
var elOverlayScore = document.getElementById('overlay-score');
var elOverlaySub = document.getElementById('overlay-sub');
var elStart = document.getElementById('btn-start');

function updateHud() {
    var pct = Math.round((fuel / MAX_FUEL) * 100);
    if (elScore) elScore.textContent = String(score);
    if (elSection) elSection.textContent = String(section);
    if (elLives) elLives.textContent = String(lives);
    if (elFuel) elFuel.textContent = pct + '%';
    if (elBest) elBest.textContent = String(best);
    if (elFuelBar) {
        elFuelBar.style.width = pct + '%';
        elFuelBar.className = 'fuel-bar' + (pct <= 25 ? ' low' : '');
    }
}

function showOverlay(title, scoreLine, buttonText) {
    if (!elOverlay) return;
    elOverlayTitle.textContent = title;
    elOverlayScore.textContent = scoreLine;
    elOverlaySub.textContent = buttonText === 'Resume'
        ? 'Press P to resume'
        : 'Press Space or click to fly again';
    elStart.textContent = buttonText;
    elOverlay.classList.add('visible');
}

function hideOverlay() {
    if (elOverlay) elOverlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function draw() {
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // land
    ctx.fillStyle = '#123021';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // water: sample the banks down the screen
    var STEP = 6;
    ctx.beginPath();
    var first = true;
    for (var y = -STEP; y <= CANVAS_H + STEP; y += STEP) {
        var worldY = distance + (PLAYER_Y - y);
        var b = riverBoundsAt(Math.max(0, worldY));
        if (first) { ctx.moveTo(b.left, y); first = false; } else { ctx.lineTo(b.left, y); }
    }
    for (var y2 = CANVAS_H + STEP; y2 >= -STEP; y2 -= STEP) {
        var worldY2 = distance + (PLAYER_Y - y2);
        var b2 = riverBoundsAt(Math.max(0, worldY2));
        ctx.lineTo(b2.right, y2);
    }
    ctx.closePath();
    var water = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    water.addColorStop(0, '#123f6b');
    water.addColorStop(1, '#1b5c96');
    ctx.fillStyle = water;
    ctx.fill();
    ctx.strokeStyle = '#2f7d4a';
    ctx.lineWidth = 3;
    ctx.stroke();

    for (var i = 0; i < entities.length; i++) drawEntity(entities[i]);
    for (var j = 0; j < missiles.length; j++) drawMissile(missiles[j]);
    if (state !== 'idle') drawPlayer();
    for (var k = 0; k < blasts.length; k++) drawBlast(blasts[k]);
}

function drawBlast(b) {
    var t = 1 - b.life / b.max;
    var y = screenYFor(b.worldY);
    ctx.save();
    ctx.fillStyle = '#f97316';
    ctx.globalAlpha = 1 - t;
    ctx.beginPath();
    ctx.arc(b.x, y, b.size * (0.35 + 0.55 * t), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(b.x, y, b.size * 0.45 * (1 - t), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(b.x, y, b.size * (0.5 + 0.7 * t), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawEntity(e) {
    var y = screenYFor(e.worldY);
    if (y < -60 || y > CANVAS_H + 60) return;

    ctx.save();
    ctx.translate(e.x, y);

    if (e.type === 'bridge') {
        ctx.fillStyle = '#b07a3c';
        ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
        ctx.fillStyle = '#8a5c28';
        for (var x = -e.w / 2 + 6; x < e.w / 2; x += 16) ctx.fillRect(x, -e.h / 2, 4, e.h);
    } else if (e.type === 'fuel') {
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h);
        ctx.fillStyle = '#fde68a';
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('F', 0, 1);
    } else if (e.type === 'ship') {
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.moveTo(-e.w / 2, -e.h / 2);
        ctx.lineTo(e.w / 2, -e.h / 2);
        ctx.lineTo(e.w / 2 - 8, e.h / 2);
        ctx.lineTo(-e.w / 2 + 8, e.h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#64748b';
        ctx.fillRect(-6, -e.h / 2 - 6, 12, 6);
    } else if (e.type === 'heli') {
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(-e.w / 2 + 4, -e.h / 2 + 3, e.w - 8, e.h - 6);
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-e.w / 2, -e.h / 2);
        ctx.lineTo(e.w / 2, -e.h / 2);
        ctx.stroke();
    } else {
        // enemy jet
        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.moveTo(0, e.h / 2);
        ctx.lineTo(-e.w / 2, -e.h / 2);
        ctx.lineTo(e.w / 2, -e.h / 2);
        ctx.closePath();
        ctx.fill();
    }

    ctx.restore();
}

function drawMissile(m) {
    var y = screenYFor(m.worldY);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(m.x - m.w / 2, y - m.h / 2, m.w, m.h);
}

function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;

    ctx.save();
    ctx.translate(player.x, PLAYER_Y);
    ctx.rotate(player.vx * 0.14);      // bank into the turn
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(0, -player.h / 2);
    ctx.lineTo(player.w / 2, player.h / 2);
    ctx.lineTo(0, player.h / 2 - 6);
    ctx.lineTo(-player.w / 2, player.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(-3, -player.h / 2 + 4, 6, player.h - 8);
    ctx.restore();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
var keys = { left: false, right: false, up: false, down: false };

function syncKeys() {
    movePlayer((keys.right ? 1 : 0) - (keys.left ? 1 : 0));
    setThrottle((keys.up ? 1 : 0) - (keys.down ? 1 : 0));
}

document.addEventListener('keydown', function (event) {
    var code = event.code;

    if (code === 'ArrowLeft' || code === 'KeyA') { keys.left = true; syncKeys(); event.preventDefault(); }
    else if (code === 'ArrowRight' || code === 'KeyD') { keys.right = true; syncKeys(); event.preventDefault(); }
    else if (code === 'ArrowUp' || code === 'KeyW') { keys.up = true; syncKeys(); event.preventDefault(); }
    else if (code === 'ArrowDown' || code === 'KeyS') { keys.down = true; syncKeys(); event.preventDefault(); }
    else if (code === 'KeyP') { togglePause(); }
    else if (code === 'Space' || code === 'Enter') {
        event.preventDefault();
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        else fire();
    }
});

document.addEventListener('keyup', function (event) {
    var code = event.code;
    if (code === 'ArrowLeft' || code === 'KeyA') { keys.left = false; syncKeys(); }
    else if (code === 'ArrowRight' || code === 'KeyD') { keys.right = false; syncKeys(); }
    else if (code === 'ArrowUp' || code === 'KeyW') { keys.up = false; syncKeys(); }
    else if (code === 'ArrowDown' || code === 'KeyS') { keys.down = false; syncKeys(); }
});

if (elStart) {
    elStart.addEventListener('click', function () {
        if (state === 'paused') togglePause();
        else startGame();
    });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
var lastTime = 0;

function frame(now) {
    if (!lastTime) lastTime = now;
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    step(dt);
    ageBlasts(Math.min(dt, 0.05));
    draw();
    window.requestAnimationFrame(frame);
}

loadBest();
resetTerrain();
updateHud();
draw();
window.requestAnimationFrame(frame);
