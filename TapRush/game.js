// Tap Rush — run a four-lane bar: pour mugs down the counters, shove the
// patrons back out of the door, and catch every empty they slide back.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, bartender, patrons, mugs, empties,
// wave) is kept at the top level on purpose: the Playwright suite drives the
// game through exactly these names. See DESIGN.md for the rules and the
// constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 640
const H = canvas.height;             // 480
const DT = 1 / 120;                  // fixed simulation timestep, seconds

// --- layout ----------------------------------------------------------------

const LANE_COUNT = 4;
const LANE_TOP = 56;                 // top of the first counter's band
const LANE_H = 96;                   // height of one counter band
const BAR_LEFT = 96;                 // serving end: mugs appear, empties land
const BAR_RIGHT = 604;               // door end: patrons enter and leave
const BARTENDER_X = 42;              // the bartender stands left of the bar
const CATCH_WINDOW = 26;             // grace past BAR_LEFT before an empty smashes
const CORNER_X = BAR_LEFT + 14;      // a patron this close has cornered you

// --- balance ---------------------------------------------------------------

const MUG_SPEED = 220;               // px/s, full mug sliding toward the door
const EMPTY_SPEED = 170;             // px/s, empty mug sliding back
const PATRON_SPEED = 30;             // px/s at wave 1
const LEAVE_SPEED = 115;            // px/s for a served patron heading out
const SPEED_PER_LEVEL = 0.08;        // patrons walk 8% faster each wave
const CATCH_DIST = 18;               // mug/patron contact distance
const KNOCKBACK = 70;                // px a patron is shoved back per mug
const DRINK_TIME = 0.8;              // seconds a patron spends on a mug
const POUR_COOLDOWN = 0.22;          // seconds between pours
const MOVE_REPEAT = 0.16;            // seconds between lane changes when held
const WAVE_PAUSE = 2.5;              // seconds of breather between waves
const START_LIVES = 3;

const MUG_POINTS = 25;               // a patron catches a mug
const LEAVE_POINTS = 75;             // a patron walks out
const EMPTY_POINTS = 25;             // an empty is caught
const WAVE_BONUS = 200;              // times the wave number

const BEST_KEY = 'taprush-best';

const COLORS = {
    bar: '#7a4c2b',
    barEdge: '#4a2a16',
    barShade: '#5c3620',
    floor: '#1d120c',
    beer: '#f0a92c',
    brass: '#f3b53f',
    foam: '#fdf3d7',
    glass: '#cfd8e3',
    patron: '#c05b4d',
    patronAlt: '#8d6fb0',
    apron: '#f3b53f',
    skin: '#e8b48c',
    lane: 'rgba(243, 181, 63, 0.14)',
};

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | wavecomplete | gameover
let score = 0;
let level = 1;
let lives = START_LIVES;
let served = 0;                      // patrons sent home this game
let best = loadBest();
let patrons = [];                    // { lane, x, thirst, phase, timer }
let mugs = [];                       // full mugs sliding right: { lane, x }
let empties = [];                    // empty mugs sliding left: { lane, x }
let splats = [];                     // short-lived smash marks, cosmetic only
let wave = { remaining: 0, timer: 0, interval: 2.2, thirst: 1 };
let spawnLog = [];                   // lanes used by this wave, in order
let lastLoss = '';                   // why the last life went, shown on the canvas
let breakTimer = 0;                  // countdown during 'wavecomplete'
let pourTimer = 0;                   // pour cooldown remaining
let moveTimer = 0;                   // lane-repeat countdown
let autoRun = true;                  // the animation loop only simulates while true
let rng = mulberry32(1);
const keys = Object.create(null);

const bartender = { lane: 0, x: BARTENDER_X, catches: 0 };

// --- helpers ---------------------------------------------------------------

function laneY(i) {
    return LANE_TOP + LANE_H / 2 + i * LANE_H;
}

function clampLane(i) {
    return Math.max(0, Math.min(LANE_COUNT - 1, i));
}

// Small deterministic PRNG so a given wave number always plays out the same.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
        /* storage is optional */
    }
}

function patronSpeed() {
    return PATRON_SPEED * (1 + SPEED_PER_LEVEL * (level - 1));
}

// --- game flow -------------------------------------------------------------

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    bartender.lane = 0;
    bartender.catches = 0;
    splats = [];
    lastLoss = '';
    startWave();
    state = 'running';
    autoRun = true;
    hideOverlay();
    updateHud();
}

function startWave() {
    patrons = [];
    mugs = [];
    empties = [];
    spawnLog = [];
    pourTimer = 0;
    moveTimer = 0;
    rng = mulberry32(level * 9176 + 13);
    wave = {
        remaining: 4 + 2 * level,
        timer: 0.9,
        interval: Math.max(0.75, 2.2 - 0.15 * (level - 1)),
        thirst: Math.min(3, 1 + Math.floor((level - 1) / 2)),
    };
}

function completeWave() {
    score += WAVE_BONUS * level;
    state = 'wavecomplete';
    breakTimer = WAVE_PAUSE;
    showOverlay('WAVE ' + level + ' CLEARED', 'Score ' + score, 'Next round coming up…');
}

function endGame() {
    state = 'gameover';
    if (score > best) {
        best = score;
        saveBest();
    }
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space or click Start to play again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P to get back behind the bar');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function loseLife(reason, x, y) {
    lives -= 1;
    lastLoss = reason;
    splats.push({ x, y, life: 0.6, label: reason });
    if (lives <= 0) {
        lives = 0;
        endGame();
    }
}

// --- entities --------------------------------------------------------------

function spawnPatron(lane, thirst) {
    // Never stack two patrons on top of each other at the door.
    let x = BAR_RIGHT;
    for (const p of patrons) {
        if (p.lane === lane && p.x >= x - 30) x = Math.min(W - 8, p.x + 30);
    }
    patrons.push({
        lane,
        x,
        thirst: thirst || wave.thirst || 1,
        phase: 'advancing',
        timer: 0,
    });
    spawnLog.push(lane);
}

function pour() {
    if (state !== 'running' || pourTimer > 0) return false;
    mugs.push({ lane: bartender.lane, x: BAR_LEFT });
    pourTimer = POUR_COOLDOWN;
    return true;
}

function setLane(i) {
    bartender.lane = clampLane(i);
}

function moveLane(delta) {
    if (state !== 'running') return;
    setLane(bartender.lane + delta);
}

// --- simulation ------------------------------------------------------------

function physicsStep(dt) {
    if (state === 'wavecomplete') {
        breakTimer -= dt;
        if (breakTimer <= 0) {
            level += 1;
            startWave();
            state = 'running';
            hideOverlay();
        }
        updateHud();
        return;
    }
    if (state !== 'running') return;

    stepHeldKeys(dt);
    pourTimer = Math.max(0, pourTimer - dt);
    stepMugs(dt);
    stepPatrons(dt);
    stepEmpties(dt);
    stepSpawns(dt);
    stepSplats(dt);

    if (
        state === 'running' &&
        wave.remaining <= 0 &&
        patrons.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    ) {
        completeWave();
    }
    updateHud();
}

function stepHeldKeys(dt) {
    const down = keys['ArrowDown'] || keys['KeyS'] ? 1 : 0;
    const up = keys['ArrowUp'] || keys['KeyW'] ? 1 : 0;
    const dir = down - up;
    if (dir === 0) {
        moveTimer = 0;
        return;
    }
    moveTimer -= dt;
    if (moveTimer <= 0) {
        setLane(bartender.lane + dir);
        moveTimer = MOVE_REPEAT;
    }
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x += MUG_SPEED * dt;

        const target = patrons.find(
            (p) => p.lane === mug.lane && p.phase === 'advancing' && Math.abs(p.x - mug.x) < CATCH_DIST
        );
        if (target) {
            mugs.splice(i, 1);
            target.thirst -= 1;
            target.x = Math.min(BAR_RIGHT, target.x + KNOCKBACK);
            target.phase = 'drinking';
            target.timer = DRINK_TIME;
            score += MUG_POINTS;
            continue;
        }

        if (mug.x > BAR_RIGHT) {
            mugs.splice(i, 1);
            loseLife('MUG SMASHED!', BAR_RIGHT, laneY(mug.lane));
        }
    }
}

function stepPatrons(dt) {
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];

        if (p.phase === 'drinking') {
            p.timer -= dt;
            if (p.timer <= 0) {
                if (p.thirst <= 0) {
                    p.phase = 'leaving';
                    empties.push({ lane: p.lane, x: p.x });
                } else {
                    p.phase = 'advancing';
                }
            }
            continue;
        }

        if (p.phase === 'leaving') {
            p.x += LEAVE_SPEED * dt;
            if (p.x >= BAR_RIGHT) {
                patrons.splice(i, 1);
                served += 1;
                score += LEAVE_POINTS;
            }
            continue;
        }

        // advancing
        p.x -= patronSpeed() * dt;
        if (p.x <= CORNER_X) {
            patrons.splice(i, 1);
            loseLife('CORNERED!', CORNER_X, laneY(p.lane));
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const mug = empties[i];
        mug.x -= EMPTY_SPEED * dt;

        if (mug.x <= BAR_LEFT && mug.lane === bartender.lane) {
            empties.splice(i, 1);
            bartender.catches += 1;
            score += EMPTY_POINTS;
            continue;
        }

        if (mug.x <= BAR_LEFT - CATCH_WINDOW) {
            empties.splice(i, 1);
            loseLife('EMPTY DROPPED!', BAR_LEFT - CATCH_WINDOW, laneY(mug.lane));
        }
    }
}

function stepSpawns(dt) {
    if (wave.remaining <= 0) return;
    wave.timer -= dt;
    if (wave.timer > 0) return;
    wave.timer = wave.interval;
    wave.remaining -= 1;
    spawnPatron(Math.floor(rng() * LANE_COUNT));
}

function stepSplats(dt) {
    for (let i = splats.length - 1; i >= 0; i--) {
        splats[i].life -= dt;
        if (splats[i].life <= 0) splats.splice(i, 1);
    }
}

// --- HUD / overlay ---------------------------------------------------------

const el = {
    score: document.getElementById('score'),
    level: document.getElementById('level'),
    lives: document.getElementById('lives'),
    served: document.getElementById('served'),
    best: document.getElementById('best'),
    overlay: document.getElementById('overlay'),
    title: document.getElementById('overlay-title'),
    sub: document.getElementById('overlay-sub'),
    final: document.getElementById('overlay-score'),
};

function updateHud() {
    el.score.textContent = String(score);
    el.level.textContent = String(level);
    el.lives.textContent = String(lives);
    el.served.textContent = String(served);
    el.best.textContent = String(Math.max(best, score));
}

function showOverlay(title, finalLine, sub) {
    el.title.textContent = title;
    el.final.textContent = finalLine || '';
    el.sub.textContent = sub || '';
    el.overlay.classList.add('visible');
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

// --- drawing ---------------------------------------------------------------

const COUNTER_TOP = 14;              // counter surface, relative to the lane centre
const SLAB_H = 16;                   // thickness of the counter surface
const PATRON_TINTS = ['#c05b4d', '#8d6fb0', '#4f8f8a', '#c08a3e', '#9a5f7a'];

function draw() {
    drawRoom();
    for (let i = 0; i < LANE_COUNT; i++) drawLane(i);
    for (const s of splats) drawSplat(s);
    for (let i = 0; i < LANE_COUNT; i++) {
        for (const p of patrons) if (p.lane === i) drawPatron(p);
        for (const m of mugs) if (m.lane === i) drawMug(m.x, laneY(i), true);
        for (const m of empties) if (m.lane === i) drawMug(m.x, laneY(i), false);
        drawCounterFront(i);
    }
    drawTapStation();
    drawBartender();
}

function drawRoom() {
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, '#42291a');
    wall.addColorStop(0.55, '#301c12');
    wall.addColorStop(1, COLORS.floor);
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    // warm pools of light over each counter
    for (let i = 0; i < LANE_COUNT; i++) {
        const y = laneY(i);
        const glow = ctx.createRadialGradient(W / 2, y - 26, 10, W / 2, y - 26, 300);
        glow.addColorStop(0, 'rgba(243, 181, 63, 0.10)');
        glow.addColorStop(1, 'rgba(243, 181, 63, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, y - LANE_H / 2, W, LANE_H);
    }

    // panelled back wall behind the taps
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, BAR_LEFT - 26, H);
    ctx.strokeStyle = 'rgba(243, 181, 63, 0.10)';
    ctx.lineWidth = 2;
    for (let y = 20; y < H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(BAR_LEFT - 32, y);
        ctx.stroke();
    }

    // the door the patrons come through
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.fillRect(BAR_RIGHT + 20, 0, W - BAR_RIGHT - 20, H);
    ctx.strokeStyle = 'rgba(243, 181, 63, 0.16)';
    ctx.beginPath();
    ctx.moveTo(BAR_RIGHT + 20, 0);
    ctx.lineTo(BAR_RIGHT + 20, H);
    ctx.stroke();

    // hanging sign
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    roundRect(W / 2 - 96, 8, 192, 34, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(243, 181, 63, 0.45)';
    ctx.lineWidth = 2;
    roundRect(W / 2 - 96, 8, 192, 34, 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(243, 181, 63, 0.9)';
    ctx.font = 'bold 17px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAP RUSH TAVERN', W / 2, 26);
}

// Everything behind the mugs: the lane tint and the counter surface.
function drawLane(i) {
    const y = laneY(i);
    const left = BAR_LEFT - 34;
    const right = BAR_RIGHT + 30;

    if (i === bartender.lane) {
        ctx.fillStyle = COLORS.lane;
        roundRect(4, y - LANE_H / 2 + 6, W - 8, LANE_H - 12, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(243, 181, 63, 0.45)';
        ctx.lineWidth = 2;
        roundRect(4, y - LANE_H / 2 + 6, W - 8, LANE_H - 12, 10);
        ctx.stroke();
    }

    // counter surface
    const slab = ctx.createLinearGradient(0, y + COUNTER_TOP, 0, y + COUNTER_TOP + SLAB_H);
    slab.addColorStop(0, '#8b5730');
    slab.addColorStop(0.45, COLORS.bar);
    slab.addColorStop(1, COLORS.barShade);
    ctx.fillStyle = slab;
    ctx.fillRect(left, y + COUNTER_TOP, right - left, SLAB_H);

    // wood grain
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 1;
    for (let x = left + 10; x < right; x += 38) {
        ctx.beginPath();
        ctx.moveTo(x, y + COUNTER_TOP + 3);
        ctx.lineTo(x + 14, y + COUNTER_TOP + SLAB_H - 3);
        ctx.stroke();
    }

    // brass rail catching the light along the near edge
    ctx.fillStyle = 'rgba(243, 181, 63, 0.32)';
    ctx.fillRect(left, y + COUNTER_TOP, right - left, 2);
}

// The front face of the counter, drawn after the mugs so they sit *on* the bar.
function drawCounterFront(i) {
    const y = laneY(i);
    const left = BAR_LEFT - 34;
    const right = BAR_RIGHT + 30;
    const top = y + COUNTER_TOP + SLAB_H;

    ctx.fillStyle = COLORS.barEdge;
    ctx.fillRect(left, top, right - left, 10);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left, top + 10, right - left, 6);
}

function drawPatron(p) {
    const x = p.x;
    const y = laneY(p.lane);
    const feet = y + COUNTER_TOP + 2;     // standing just behind the counter
    const bodyH = 34;
    const bodyTop = feet - bodyH;
    const bob = p.phase === 'advancing' ? Math.abs(Math.sin(x / 11)) * 2 : 0;
    const tint = PATRON_TINTS[(p.lane * 2 + Math.round(p.x / 97)) % PATRON_TINTS.length];

    ctx.save();
    ctx.translate(0, -bob);

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x, feet + 2, 14, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.fillStyle = '#2f2018';
    ctx.fillRect(x - 8, feet - 9, 6, 9);
    ctx.fillRect(x + 2, feet - 9, 6, 9);

    // coat
    ctx.fillStyle = p.phase === 'leaving' ? '#6f9a74' : tint;
    roundRect(x - 13, bodyTop, 26, bodyH - 6, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(x - 13, bodyTop + bodyH - 16, 26, 3);

    // arms
    ctx.strokeStyle = p.phase === 'leaving' ? '#5d8763' : tint;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 12, bodyTop + 10);
    ctx.lineTo(x - 18, bodyTop + 20);
    ctx.moveTo(x + 12, bodyTop + 10);
    ctx.lineTo(x + 18, bodyTop + 20);
    ctx.stroke();

    // head
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath();
    ctx.arc(x, bodyTop - 8, 10, 0, Math.PI * 2);
    ctx.fill();

    // eyes, looking the way the patron is heading
    const gaze = p.phase === 'leaving' ? 3 : -3;
    ctx.fillStyle = '#2f2018';
    ctx.fillRect(x + gaze - 4, bodyTop - 11, 2, 3);
    ctx.fillRect(x + gaze + 1, bodyTop - 11, 2, 3);

    // flat cap
    ctx.fillStyle = '#39271f';
    roundRect(x - 11, bodyTop - 21, 22, 8, 3);
    ctx.fill();
    ctx.fillRect(x - 13 + (p.phase === 'leaving' ? 8 : 0), bodyTop - 15, 18, 3);

    // how many mugs this patron still wants
    for (let i = 0; i < p.thirst; i++) {
        const px = x - (p.thirst - 1) * 5 + i * 10;
        ctx.fillStyle = COLORS.beer;
        roundRect(px - 3, bodyTop - 34, 6, 8, 2);
        ctx.fill();
        ctx.fillStyle = COLORS.foam;
        ctx.fillRect(px - 3, bodyTop - 34, 6, 2);
    }

    ctx.restore();

    if (p.phase === 'drinking') drawMug(x + 17, y, true, 0.8);
}

function drawTapStation() {
    const x = BAR_LEFT - 14;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x - 7, 0, 16, H);

    for (let i = 0; i < LANE_COUNT; i++) {
        const y = laneY(i) + COUNTER_TOP;
        const lit = i === bartender.lane;
        ctx.fillStyle = lit ? COLORS.brass : '#8a6a3a';
        ctx.fillRect(x - 2, y - 30, 5, 26);
        ctx.beginPath();
        ctx.arc(x, y - 32, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(x - 6, y - 6, 13, 6);

        if (lit && pourTimer > POUR_COOLDOWN * 0.4) {
            ctx.fillStyle = COLORS.beer;
            ctx.fillRect(x - 1, y - 6, 3, 8);
        }
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const x = bartender.x;
    const feet = y + COUNTER_TOP + 14;
    const bodyTop = feet - 42;

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, feet + 2, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // trousers and shoes
    ctx.fillStyle = '#33231b';
    ctx.fillRect(x - 9, feet - 14, 7, 12);
    ctx.fillRect(x + 2, feet - 14, 7, 12);
    ctx.fillStyle = '#1d140f';
    ctx.fillRect(x - 11, feet - 3, 9, 3);
    ctx.fillRect(x + 2, feet - 3, 9, 3);

    // rolled-up sleeves
    ctx.strokeStyle = '#efe0c6';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 9, bodyTop + 8);
    ctx.lineTo(x - 15, bodyTop + 17);
    ctx.stroke();

    // shirt
    ctx.fillStyle = '#efe0c6';
    roundRect(x - 11, bodyTop, 22, 26, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1.5;
    roundRect(x - 11, bodyTop, 22, 26, 6);
    ctx.stroke();

    // apron with straps
    ctx.strokeStyle = COLORS.apron;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 5, bodyTop + 2);
    ctx.lineTo(x - 7, bodyTop + 14);
    ctx.moveTo(x + 5, bodyTop + 2);
    ctx.lineTo(x + 7, bodyTop + 14);
    ctx.stroke();
    ctx.fillStyle = COLORS.apron;
    roundRect(x - 9, bodyTop + 13, 18, 19, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.fillRect(x - 9, bodyTop + 21, 18, 2);

    // bow tie
    ctx.fillStyle = '#9b3b2f';
    ctx.beginPath();
    ctx.moveTo(x - 6, bodyTop - 1);
    ctx.lineTo(x, bodyTop + 3);
    ctx.lineTo(x - 6, bodyTop + 6);
    ctx.closePath();
    ctx.moveTo(x + 6, bodyTop - 1);
    ctx.lineTo(x, bodyTop + 3);
    ctx.lineTo(x + 6, bodyTop + 6);
    ctx.closePath();
    ctx.fill();

    // head, moustache, hair
    ctx.fillStyle = COLORS.skin;
    ctx.beginPath();
    ctx.arc(x, bodyTop - 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f2018';
    ctx.fillRect(x - 5, bodyTop - 14, 2, 3);
    ctx.fillRect(x + 3, bodyTop - 14, 2, 3);
    ctx.fillRect(x - 6, bodyTop - 8, 12, 3);
    ctx.beginPath();
    ctx.arc(x, bodyTop - 12, 10, Math.PI, Math.PI * 2);
    ctx.fill();

    // serving arm, lifted while a pour is still running
    ctx.strokeStyle = COLORS.skin;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x + 9, bodyTop + 9);
    ctx.lineTo(x + 26, bodyTop + (pourTimer > 0 ? 1 : 9));
    ctx.stroke();
}

function drawMug(x, y, full, scale) {
    const s = scale || 1;
    const w = 14 * s;
    const h = 17 * s;
    const bottom = y + COUNTER_TOP + 1;
    const top = bottom - h;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(x, bottom + 1, w * 0.6, 2.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // handle behind the body
    ctx.strokeStyle = full ? '#b9781a' : 'rgba(197, 208, 222, 0.9)';
    ctx.lineWidth = 2.5 * s;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 2 * s, top + h * 0.55, 4.5 * s, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    ctx.fillStyle = full ? COLORS.beer : 'rgba(207, 216, 227, 0.7)';
    roundRect(x - w / 2, top, w, h, 2.5 * s);
    ctx.fill();

    if (full) {
        ctx.fillStyle = COLORS.foam;
        roundRect(x - w / 2 - 1, top - 4 * s, w + 2, 6 * s, 2 * s);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.fillRect(x - w / 2 + 2 * s, top + 4 * s, 2 * s, h - 7 * s);
    } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1.5 * s;
        roundRect(x - w / 2, top, w, h, 2.5 * s);
        ctx.stroke();
    }
}

function drawSplat(s) {
    const alpha = Math.max(0, s.life / 0.6);
    ctx.fillStyle = 'rgba(253, 243, 215, ' + alpha.toFixed(2) + ')';
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const r = 10 + (i % 3) * 4;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * r, s.y + 14 + Math.sin(a) * r * 0.5, 3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = 'rgba(243, 181, 63, ' + (alpha * 0.8).toFixed(2) + ')';
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.label || 'SMASH!', Math.max(62, Math.min(W - 62, s.x)), s.y - 10);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// --- loop ------------------------------------------------------------------

let lastFrame = 0;
let accumulator = 0;

function frame(now) {
    if (!lastFrame) lastFrame = now;
    const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;

    if (autoRun) {
        accumulator += elapsed;
        while (accumulator >= DT) {
            physicsStep(DT);
            accumulator -= DT;
        }
    } else {
        accumulator = 0;
    }

    draw();
    requestAnimationFrame(frame);
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    const code = e.code;

    if (code === 'Space' || code === 'Enter') {
        e.preventDefault();
        if (state === 'idle' || state === 'gameover') startGame();
        else if (state === 'running') pour();
        return;
    }

    if (code === 'KeyP') {
        e.preventDefault();
        togglePause();
        return;
    }

    if (code === 'ArrowUp' || code === 'KeyW' || code === 'ArrowDown' || code === 'KeyS') {
        e.preventDefault();
        keys[code] = true;
        if (!e.repeat) {
            moveLane(code === 'ArrowUp' || code === 'KeyW' ? -1 : 1);
            moveTimer = MOVE_REPEAT * 2;
        }
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

document.getElementById('btn-start').addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// --- boot ------------------------------------------------------------------

updateHud();
draw();
requestAnimationFrame(frame);
