// Fishers of Men - a net-casting arcade game on the Sea of Galilee.
//
// "Follow me, and I will make you fishers of men." - Matthew 4:19
//
// The simulation is a fixed 1/60 s step state machine driven by requestAnimation-
// Frame. Everything lives in page globals on purpose: the Playwright suite freezes
// the loop (autoRun = false), builds the exact sea it wants to test and advances
// the world one simStep() at a time.

// ---------------------------------------------------------------------------
// World constants
// ---------------------------------------------------------------------------
var W = 640;                 // canvas width
var H = 520;                 // canvas height
var WATER_TOP = 80;          // the waterline: sky and boat sit above it
var SEA_FLOOR = 500;         // fish and the net stay above this
var TICK_MS = 1000 / 60;
var DT = 1 / 60;             // seconds per simulation step

var BOAT_SPEED = 220;        // px/s while rowing
var CAST_SPEED = 118;        // px/s while the net sinks
var STEER_SPEED = 160;       // px/s sideways while the net is in the water
var HAUL_BASE = 140;         // px/s haul speed with an empty net
var HAUL_PENALTY = 16;       // px/s lost per fish aboard the net
var HAUL_MIN = 48;           // px/s - however full the net, it still comes home
var TEAR_CD = 0.7;           // seconds of grace after a snag tears the net
var ESCAPE_GRACE = 1.5;      // seconds an escaped fish cannot be re-caught
var BONUS_PER_EXTRA = 10;    // points per fish beyond the first in one haul

var BEST_KEY = 'fishersofmen-best';

// Fish come in three sizes. The deeper the water, the bigger the shoal is worth.
var FISH_KINDS = {
    sardine: { points: 10, w: 26, h: 12, body: '#9fd8ee', fin: '#5fb0d0' },
    bream:   { points: 25, w: 36, h: 17, body: '#f5d27a', fin: '#c79a33' },
    tilapia: { points: 50, w: 48, h: 23, body: '#f09b6a', fin: '#c25f31' },
};

function FISH_POINTS(kind) {
    return FISH_KINDS[kind].points;
}

// Each lane is a band of water stocked with one kind of fish.
var LEVELS = [
    {
        name: 'Launch Out into the Deep',
        note: 'Lower the net, gather the shoal, haul it home.',
        quota: 8, seconds: 90, capacity: 4, snags: 1,
        lanes: [
            { kind: 'sardine', top: 110, bottom: 190, count: 5, speed: 54 },
            { kind: 'bream',   top: 230, bottom: 320, count: 3, speed: 46 },
            { kind: 'tilapia', top: 360, bottom: 460, count: 2, speed: 40 },
        ],
    },
    {
        name: 'Cast on the Right Side',
        note: 'Deeper water, bigger fish, more to carry.',
        quota: 12, seconds: 90, capacity: 5, snags: 2,
        lanes: [
            { kind: 'sardine', top: 105, bottom: 200, count: 6, speed: 64 },
            { kind: 'bream',   top: 225, bottom: 330, count: 4, speed: 54 },
            { kind: 'tilapia', top: 350, bottom: 465, count: 3, speed: 46 },
        ],
    },
    {
        name: 'Shoals of Galilee',
        note: 'The shoals are quick today - steer carefully.',
        quota: 16, seconds: 85, capacity: 6, snags: 3,
        lanes: [
            { kind: 'sardine', top: 100, bottom: 200, count: 7, speed: 76 },
            { kind: 'bream',   top: 220, bottom: 330, count: 5, speed: 64 },
            { kind: 'tilapia', top: 345, bottom: 470, count: 3, speed: 54 },
        ],
    },
    {
        name: 'Mending the Nets',
        note: 'Driftwood everywhere - a torn net loses its catch.',
        quota: 20, seconds: 85, capacity: 6, snags: 4,
        lanes: [
            { kind: 'sardine', top: 100, bottom: 205, count: 7, speed: 84 },
            { kind: 'bream',   top: 220, bottom: 335, count: 6, speed: 72 },
            { kind: 'tilapia', top: 345, bottom: 470, count: 4, speed: 60 },
        ],
    },
    {
        name: 'A Hundred and Fifty-Three',
        note: 'One last haul, and the net held and did not break.',
        quota: 24, seconds: 80, capacity: 7, snags: 5,
        lanes: [
            { kind: 'sardine', top: 100, bottom: 210, count: 8, speed: 92 },
            { kind: 'bream',   top: 225, bottom: 340, count: 6, speed: 80 },
            { kind: 'tilapia', top: 350, bottom: 475, count: 5, speed: 66 },
        ],
    },
];

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------
var canvas = document.getElementById('canvas');
var ctx = canvas.getContext('2d');

var state = 'title';   // title | running | paused | cleared | gameover | won
var autoRun = true;    // tests switch this off and call simStep() themselves
var level = 1;
var score = 0;
var levelStartScore = 0;
var landed = 0;
var tears = 0;
var timeLeft = LEVELS[0].seconds;
var best = 0;
var swell = 0;         // animation clock for waves and fins

var boat = { x: (W - 110) / 2, y: 30, w: 110, h: 34 };
var net = { x: 0, y: WATER_TOP, w: 56, h: 44, mode: 'stowed', fish: [], tearCd: 0 };
var fish = [];
var snags = [];
var keys = {};

// Deterministic per-level sea layout: the same level always stocks the same fish.
var rngState = 1;

function srand(seed) {
    rngState = seed >>> 0;
}

function rand() {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    var t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------
function makeFish(kind, x, y, dir, speed) {
    var k = FISH_KINDS[kind];
    return { kind: kind, x: x, y: y, w: k.w, h: k.h, dir: dir, speed: speed, phase: 0, immune: 0 };
}

function makeSnag(x, y, dir, speed) {
    return { x: x, y: y, w: 46, h: 26, dir: dir, speed: speed, spin: 0 };
}

function makeCatch(kind) {
    return { kind: kind, points: FISH_POINTS(kind) };
}

function netCapacity() {
    return LEVELS[level - 1].capacity;
}

// A full net is heavy, but it always rises.
function haulSpeed() {
    return Math.max(HAUL_MIN, HAUL_BASE - HAUL_PENALTY * net.fish.length);
}

function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------
function stockSea() {
    var cfg = LEVELS[level - 1];
    fish = [];
    snags = [];

    cfg.lanes.forEach(function (lane, laneIndex) {
        for (var i = 0; i < lane.count; i++) {
            var k = FISH_KINDS[lane.kind];
            var dir = (laneIndex + i) % 2 === 0 ? 1 : -1;
            var x = Math.round(rand() * (W - k.w));
            var y = Math.round(lane.top + rand() * Math.max(1, lane.bottom - lane.top - k.h));
            var speed = Math.round(lane.speed * (0.75 + rand() * 0.5));
            var f = makeFish(lane.kind, x, clamp(y, WATER_TOP + 4, SEA_FLOOR - k.h), dir, speed);
            f.phase = Math.round(rand() * 100) / 100;
            fish.push(f);
        }
    });

    for (var s = 0; s < cfg.snags; s++) {
        var sx = Math.round(rand() * (W - 46));
        var sy = Math.round(WATER_TOP + 60 + rand() * (SEA_FLOOR - WATER_TOP - 150));
        var sdir = s % 2 === 0 ? -1 : 1;
        snags.push(makeSnag(sx, clamp(sy, WATER_TOP + 10, SEA_FLOOR - 26), sdir, 20 + Math.round(rand() * 22)));
    }
}

function loadLevel(n) {
    level = clamp(n, 1, LEVELS.length);
    var cfg = LEVELS[level - 1];
    levelStartScore = score;
    landed = 0;
    tears = 0;
    timeLeft = cfg.seconds;
    boat.x = (W - boat.w) / 2;
    net.mode = 'stowed';
    net.x = boat.x + boat.w / 2 - net.w / 2;
    net.y = WATER_TOP;
    net.fish = [];
    net.tearCd = 0;
    srand(0x5ea + level * 7919);
    stockSea();
    document.getElementById('level-name').textContent = cfg.name;
    document.getElementById('message').textContent = cfg.note;
    updateHud();
}

function startGame() {
    score = 0;
    hideOverlay();
    state = 'running';
    loadLevel(1);
}

function restartLevel() {
    score = levelStartScore;
    hideOverlay();
    state = 'running';
    loadLevel(level);
}

function nextLevel() {
    if (level >= LEVELS.length) {
        startGame();
        return;
    }
    hideOverlay();
    state = 'running';
    loadLevel(level + 1);
}

// ---------------------------------------------------------------------------
// The net
// ---------------------------------------------------------------------------
function castNet() {
    if (state !== 'running' || net.mode !== 'stowed') return;
    net.x = boat.x + boat.w / 2 - net.w / 2;
    net.y = WATER_TOP;
    net.fish = [];
    net.tearCd = 0;
    net.mode = 'down';
}

function haulNet() {
    if (net.mode !== 'down') return;
    net.mode = 'up';
}

// The catch only counts once the net is back over the gunwale.
function landCatch() {
    var n = net.fish.length;
    var points = 0;
    for (var i = 0; i < n; i++) points += net.fish[i].points;
    if (n > 1) points += BONUS_PER_EXTRA * (n - 1);
    score += points;
    landed += n;
    net.fish = [];
    net.mode = 'stowed';
    net.y = WATER_TOP;
    net.tearCd = 0;

    var cfg = LEVELS[level - 1];
    if (n > 0) {
        document.getElementById('message').textContent =
            n > 1 ? 'Hauled in ' + n + ' fish for ' + points + ' points!' : 'One fish aboard.';
    }
    if (landed >= cfg.quota) {
        saveBest();
        if (level >= LEVELS.length) {
            state = 'won';
            showOverlay('WELL DONE', 'Every net is full and the boats are heavy with fish. Final score ' + score + '.');
        } else {
            state = 'cleared';
            showOverlay('NET FULL', 'Level ' + level + ' complete - ' + landed + ' fish landed, score ' + score + '. Press Space to sail on.');
        }
    }
    updateHud();
}

// A snag tears a hole and one fish slips back into the sea.
function hitSnag() {
    net.tearCd = TEAR_CD;
    tears++;
    if (net.fish.length === 0) {
        document.getElementById('message').textContent = 'Driftwood! The empty net slips past.';
        return;
    }
    var lost = net.fish.pop();
    var k = FISH_KINDS[lost.kind];
    var away = net.x < W / 2 ? 1 : -1;
    var escaped = makeFish(
        lost.kind,
        clamp(net.x + net.w / 2 - k.w / 2, 0, W - k.w),
        clamp(net.y + net.h / 2 - k.h / 2, WATER_TOP + 2, SEA_FLOOR - k.h),
        away,
        92
    );
    escaped.immune = ESCAPE_GRACE;
    fish.push(escaped);
    document.getElementById('message').textContent = 'The net tore - a fish got away!';
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function simStep() {
    if (state !== 'running') return;

    swell += DT;

    // Clock
    timeLeft -= DT;
    if (timeLeft <= 0) {
        timeLeft = 0;
        state = 'gameover';
        saveBest();
        showOverlay("TIME'S UP", 'The light is gone from the water. ' + landed + ' of ' +
            LEVELS[level - 1].quota + ' fish landed, score ' + score + '.');
        updateHud();
        return;
    }

    var left = keys.ArrowLeft || keys.KeyA;
    var right = keys.ArrowRight || keys.KeyD;

    if (net.mode === 'stowed') {
        // Row the boat; the stowed net rides along with it.
        if (left) boat.x -= BOAT_SPEED * DT;
        if (right) boat.x += BOAT_SPEED * DT;
        boat.x = clamp(boat.x, 0, W - boat.w);
        net.x = boat.x + boat.w / 2 - net.w / 2;
        net.y = WATER_TOP;
    } else {
        // Steer the net itself while it is in the water.
        if (left) net.x -= STEER_SPEED * DT;
        if (right) net.x += STEER_SPEED * DT;
        net.x = clamp(net.x, 0, W - net.w);

        if (net.mode === 'down') {
            net.y += CAST_SPEED * DT;
            if (net.y + net.h >= SEA_FLOOR) {
                net.y = SEA_FLOOR - net.h;
                net.mode = 'up';
            }
        } else {
            net.y -= haulSpeed() * DT;
        }
    }

    if (net.tearCd > 0) net.tearCd = Math.max(0, net.tearCd - DT);

    moveFish();
    moveSnags();

    if (net.mode !== 'stowed') {
        catchFish();
        checkSnags();
        if (net.fish.length >= netCapacity() && net.mode === 'down') {
            net.mode = 'up';
            document.getElementById('message').textContent = 'The net is full - haul away!';
        }
        if (net.mode === 'up' && net.y <= WATER_TOP) {
            net.y = WATER_TOP;
            landCatch();
        }
    }

    updateHud();
}

function moveFish() {
    for (var i = 0; i < fish.length; i++) {
        var f = fish[i];
        f.x += f.dir * f.speed * DT;
        f.phase += DT;
        if (f.immune > 0) f.immune = Math.max(0, f.immune - DT);
        // Recycle at the far edge so the shoal never thins out.
        if (f.dir > 0 && f.x > W) f.x = -f.w;
        else if (f.dir < 0 && f.x + f.w < 0) f.x = W;
        f.y = clamp(f.y, WATER_TOP + 2, SEA_FLOOR - f.h);
    }
}

function moveSnags() {
    for (var i = 0; i < snags.length; i++) {
        var s = snags[i];
        s.x += s.dir * s.speed * DT;
        s.spin += DT * 0.4 * s.dir;
        if (s.dir > 0 && s.x > W) s.x = -s.w;
        else if (s.dir < 0 && s.x + s.w < 0) s.x = W;
        s.y = clamp(s.y, WATER_TOP + 2, SEA_FLOOR - s.h);
    }
}

function catchFish() {
    for (var i = fish.length - 1; i >= 0; i--) {
        if (net.fish.length >= netCapacity()) return;
        if (fish[i].immune > 0) continue;
        if (overlaps(net, fish[i])) {
            net.fish.push(makeCatch(fish[i].kind));
            fish.splice(i, 1);
        }
    }
}

function checkSnags() {
    if (net.tearCd > 0) return;
    for (var i = 0; i < snags.length; i++) {
        if (overlaps(net, snags[i])) {
            hitSnag();
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// HUD, overlay, best score
// ---------------------------------------------------------------------------
function formatTime(sec) {
    var s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function updateHud() {
    document.getElementById('level').textContent = String(level);
    document.getElementById('catch').textContent = landed + ' / ' + LEVELS[level - 1].quota;
    document.getElementById('score').textContent = String(score);
    document.getElementById('time').textContent = formatTime(timeLeft);
    document.getElementById('best').textContent = String(best);
}

function showOverlay(title, sub) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-sub').textContent = sub;
    document.getElementById('overlay').classList.remove('hidden');
}

function hideOverlay() {
    document.getElementById('overlay').classList.add('hidden');
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        window.localStorage.setItem(BEST_KEY, String(best));
    } catch (e) {
        /* storage blocked - the score simply is not remembered */
    }
    updateHud();
}

function loadBest() {
    try {
        var raw = window.localStorage.getItem(BEST_KEY);
        best = raw ? parseInt(raw, 10) || 0 : 0;
    } catch (e) {
        best = 0;
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw() {
    drawSky();
    drawWater();
    for (var i = 0; i < snags.length; i++) drawSnag(snags[i]);
    for (var j = 0; j < fish.length; j++) drawFish(fish[j]);
    if (net.mode !== 'stowed') drawRope();
    drawNet();
    drawBoat();
    if (state === 'paused') drawVeil('PAUSED');
    updateHud();
}

function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, WATER_TOP);
    g.addColorStop(0, '#ffd9a0');
    g.addColorStop(1, '#8fc8e0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, WATER_TOP);

    // Morning sun over the lake.
    ctx.fillStyle = 'rgba(255, 236, 170, 0.95)';
    ctx.beginPath();
    ctx.arc(W - 70, 26, 18, 0, Math.PI * 2);
    ctx.fill();

    // Far shore of Galilee.
    ctx.fillStyle = '#7a9a86';
    ctx.beginPath();
    ctx.moveTo(0, WATER_TOP);
    ctx.lineTo(0, WATER_TOP - 14);
    ctx.lineTo(70, WATER_TOP - 26);
    ctx.lineTo(150, WATER_TOP - 12);
    ctx.lineTo(240, WATER_TOP - 22);
    ctx.lineTo(330, WATER_TOP - 10);
    ctx.lineTo(430, WATER_TOP - 20);
    ctx.lineTo(540, WATER_TOP - 11);
    ctx.lineTo(W, WATER_TOP - 18);
    ctx.lineTo(W, WATER_TOP);
    ctx.closePath();
    ctx.fill();
}

function drawWater() {
    var g = ctx.createLinearGradient(0, WATER_TOP, 0, H);
    g.addColorStop(0, '#1b6f9c');
    g.addColorStop(0.55, '#0d4a6a');
    g.addColorStop(1, '#042a44');
    ctx.fillStyle = g;
    ctx.fillRect(0, WATER_TOP, W, H - WATER_TOP);

    // Waterline foam.
    ctx.strokeStyle = 'rgba(224, 246, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = 0; x <= W; x += 8) {
        var y = WATER_TOP + Math.sin(x * 0.045 + swell * 1.8) * 2.5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Sun shafts.
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < 4; i++) {
        var sx = 90 + i * 150 + Math.sin(swell * 0.5 + i) * 12;
        ctx.beginPath();
        ctx.moveTo(sx, WATER_TOP);
        ctx.lineTo(sx + 26, WATER_TOP);
        ctx.lineTo(sx + 70, SEA_FLOOR);
        ctx.lineTo(sx + 16, SEA_FLOOR);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    // Sea bed.
    ctx.fillStyle = '#1d3b2d';
    ctx.fillRect(0, SEA_FLOOR, W, H - SEA_FLOOR);
    ctx.fillStyle = '#2c5440';
    for (var r = 0; r < W; r += 40) {
        ctx.beginPath();
        ctx.ellipse(r + 20, SEA_FLOOR + 2, 22, 7, 0, Math.PI, Math.PI * 2);
        ctx.fill();
    }
}

function drawFish(f) {
    var k = FISH_KINDS[f.kind];
    var cx = f.x + f.w / 2;
    var cy = f.y + f.h / 2;
    var wag = Math.sin(f.phase * 7) * (f.h * 0.18);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(f.dir >= 0 ? 1 : -1, 1);

    ctx.fillStyle = k.fin;
    ctx.beginPath();
    ctx.moveTo(-f.w / 2, 0);
    ctx.lineTo(-f.w / 2 - f.h * 0.42, -f.h * 0.42 + wag);
    ctx.lineTo(-f.w / 2 - f.h * 0.42, f.h * 0.42 + wag);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = k.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, f.w / 2, f.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = k.fin;
    ctx.beginPath();
    ctx.moveTo(-f.w * 0.1, -f.h / 2);
    ctx.lineTo(f.w * 0.12, -f.h * 0.9);
    ctx.lineTo(f.w * 0.2, -f.h / 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#06202c';
    ctx.beginPath();
    ctx.arc(f.w * 0.26, -f.h * 0.1, Math.max(1.2, f.h * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawSnag(s) {
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    ctx.rotate(Math.sin(s.spin) * 0.25);
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(-s.w / 2, -s.h * 0.22, s.w, s.h * 0.44);
    ctx.fillStyle = '#4e3520';
    ctx.fillRect(-s.w / 2, -s.h * 0.22, s.w, s.h * 0.14);
    ctx.strokeStyle = '#3f6b45';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-s.w * 0.3, 0);
    ctx.lineTo(-s.w * 0.48, -s.h * 0.5);
    ctx.moveTo(s.w * 0.22, 0);
    ctx.lineTo(s.w * 0.44, s.h * 0.5);
    ctx.stroke();
    ctx.restore();
}

function drawRope() {
    ctx.strokeStyle = '#e8dcc0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(boat.x + boat.w / 2, boat.y + boat.h);
    ctx.lineTo(net.x + net.w / 2, net.y);
    ctx.stroke();
}

function drawNet() {
    var torn = net.tearCd > 0;
    ctx.save();
    ctx.strokeStyle = torn ? '#ffb4a2' : '#f2ead2';
    ctx.lineWidth = 1.6;

    // Hoop
    ctx.beginPath();
    ctx.moveTo(net.x, net.y);
    ctx.lineTo(net.x + net.w, net.y);
    ctx.stroke();

    // Mesh bag
    ctx.beginPath();
    for (var i = 0; i <= 4; i++) {
        var t = i / 4;
        ctx.moveTo(net.x + t * net.w, net.y);
        ctx.lineTo(net.x + net.w * (0.14 + t * 0.72), net.y + net.h);
    }
    for (var r = 1; r <= 3; r++) {
        var ry = net.y + (net.h * r) / 3;
        var inset = (net.w * 0.14 * r) / 3;
        ctx.moveTo(net.x + inset, ry);
        ctx.lineTo(net.x + net.w - inset, ry);
    }
    ctx.stroke();

    // The catch riding inside, packed in rows and tipped on its side.
    var cols = 3;
    for (var f = 0; f < net.fish.length; f++) {
        var kind = FISH_KINDS[net.fish[f].kind];
        var cx = net.x + net.w * (0.27 + (f % cols) * 0.23);
        var cy = net.y + net.h * (0.44 + Math.floor(f / cols) * 0.26);
        var rx = kind.w * 0.34;
        var ry = kind.h * 0.42;
        var tilt = f % 2 === 0 ? 0.35 : -0.3;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.fillStyle = kind.fin;
        ctx.beginPath();
        ctx.moveTo(-rx, 0);
        ctx.lineTo(-rx - ry * 0.9, -ry * 0.8);
        ctx.lineTo(-rx - ry * 0.9, ry * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = kind.body;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}

function drawBoat() {
    var bob = Math.sin(swell * 1.6) * 2;
    var x = boat.x;
    var y = boat.y + bob;

    // Hull
    ctx.fillStyle = '#8a5a2b';
    ctx.beginPath();
    ctx.moveTo(x, y + boat.h * 0.3);
    ctx.lineTo(x + boat.w, y + boat.h * 0.3);
    ctx.lineTo(x + boat.w * 0.82, y + boat.h);
    ctx.lineTo(x + boat.w * 0.18, y + boat.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b4320';
    ctx.fillRect(x + boat.w * 0.14, y + boat.h * 0.3, boat.w * 0.72, 4);

    // Mast and sail
    ctx.strokeStyle = '#5c3a1b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + boat.w * 0.5, y + boat.h * 0.3);
    ctx.lineTo(x + boat.w * 0.5, y - 20);
    ctx.stroke();
    ctx.fillStyle = '#f4f1e4';
    ctx.beginPath();
    ctx.moveTo(x + boat.w * 0.52, y - 18);
    ctx.lineTo(x + boat.w * 0.86, y + boat.h * 0.26);
    ctx.lineTo(x + boat.w * 0.52, y + boat.h * 0.26);
    ctx.closePath();
    ctx.fill();

    // Fisherman at the gunwale
    ctx.fillStyle = '#d8c48f';
    ctx.beginPath();
    ctx.arc(x + boat.w * 0.3, y + boat.h * 0.1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b6b8a';
    ctx.fillRect(x + boat.w * 0.26, y + boat.h * 0.18, 10, 12);
}

function drawVeil(text) {
    ctx.fillStyle = 'rgba(2, 19, 31, 0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd66b';
    ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function onSpace() {
    if (state === 'title' || state === 'gameover' || state === 'won') {
        startGame();
    } else if (state === 'cleared') {
        nextLevel();
    } else if (state === 'running') {
        if (net.mode === 'stowed') castNet();
        else if (net.mode === 'down') haulNet();
    }
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', 'Press P to pick up the nets again.');
    } else if (state === 'paused') {
        hideOverlay();
        state = 'running';
    }
}

document.addEventListener('keydown', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') {
        keys[e.code] = true;
        e.preventDefault();
        return;
    }
    if (e.code === 'Space') {
        e.preventDefault();
        onSpace();
    } else if (e.code === 'KeyP') {
        togglePause();
    } else if (e.code === 'KeyR') {
        if (state === 'running' || state === 'paused' || state === 'gameover') restartLevel();
    }
});

document.addEventListener('keyup', function (e) {
    keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', onSpace);
document.getElementById('btn-restart').addEventListener('click', function () {
    if (state === 'title') startGame();
    else restartLevel();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
var lastFrame = 0;
var accumulator = 0;

function frame(now) {
    if (!lastFrame) lastFrame = now;
    var elapsed = Math.min(now - lastFrame, 250);
    lastFrame = now;
    if (autoRun && state === 'running') {
        accumulator += elapsed;
        while (accumulator >= TICK_MS) {
            simStep();
            accumulator -= TICK_MS;
            if (state !== 'running') break;
        }
    } else {
        accumulator = 0;
        swell += elapsed / 1000;
    }
    draw();
    requestAnimationFrame(frame);
}

loadBest();
loadLevel(1);
showOverlay('FISHERS OF MEN', 'Press Space to put out from shore');
draw();
requestAnimationFrame(frame);
