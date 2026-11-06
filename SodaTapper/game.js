// Soda Tapper — one bartender, four lanes, and a bar full of thirsty patrons.
//
// The whole simulation runs on a fixed timestep through physicsStep(), and the
// interesting state (state, score, lives, patrons, mugs, bartender) is kept at
// the top level on purpose: the Playwright suite drives the game through exactly
// these names. See DESIGN.md for the rules and the constants behind them.

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const W = canvas.width;              // 720
const H = canvas.height;             // 480
const DT = 1 / 120;                  // fixed simulation timestep, seconds

const LANES = 4;
const LANE_TOP = 96;                 // centre line of lane 0
const LANE_GAP = 100;                // distance between lane centre lines
const BAR_H = 56;                    // drawn thickness of a lane's bar top

const TAP_X = 74;                    // the taps: where you stand, where empties land
const EXIT_X = 660;                  // the door: where patrons come in and go out

const MUG_SPEED = 215;               // px/s, full or empty
const MUG_R = 11;
const PATRON_R = 16;
const PATRON_PUSH = 130;             // px a single drink shoves a patron back
const PATRON_REACH = 26;             // how close to the taps before they grab you
const PATRON_GAP = 36;               // closest two patrons in a lane ever stand
const DOOR_CLEARANCE = 60;           // keep the doorway clear before a new spawn

const POUR_COOLDOWN = 0.3;           // seconds between pours
const MUGS_PER_LANE = 2;             // full mugs allowed in flight in one lane

const LIVES_START = 3;
const LEVEL_COUNT = 5;

const DRINK_POINTS = 50;             // a patron catches a mug
const SERVE_POINTS = 150;            // a patron leaves satisfied
const CATCH_POINTS = 25;             // an empty caught at the taps
const CLEAR_BONUS_PER_LIFE = 200;    // paid for every life left when a level ends

const SEED = 1337;
const BEST_KEY = 'sodatapper-best';

// --- state -----------------------------------------------------------------

let state = 'idle';                  // idle | running | paused | levelclear | gameover | won
let score = 0;
let level = 1;
let lives = LIVES_START;
let served = 0;
let streak = 0;
let best = loadBest();

let patrons = [];                    // { lane, x, speed, drinks }
let mugs = [];                       // { lane, x, dir }  dir 1 = full, -1 = empty
let splashes = [];                   // short-lived smash marks, cosmetic only
let foam = [];                       // pour sparkles, cosmetic only

let spawnsLeft = 0;                  // patrons the level still has to send
let spawnTimer = 0;                  // seconds until the next one walks in
let rngSeed = SEED;
let autoRun = true;                  // the animation loop only simulates while true

const bartender = { lane: 0, pourCooldown: 0, bob: 0 };

// --- helpers ---------------------------------------------------------------

function laneY(i) {
    return LANE_TOP + i * LANE_GAP;
}

function laneFromY(y) {
    let bestLane = 0;
    let bestDist = Infinity;
    for (let i = 0; i < LANES; i++) {
        const d = Math.abs(laneY(i) - y);
        if (d < bestDist) {
            bestDist = d;
            bestLane = i;
        }
    }
    return bestLane;
}

function seedRng(s) {
    rngSeed = s >>> 0;
}

// Small LCG so a run is reproducible: the level's lane order and speed jitter
// come from here, which lets the test suite replay a level exactly.
function rnd() {
    rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
    return rngSeed / 4294967296;
}

function loadBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
    } catch (e) {
        return 0;
    }
}

function saveBest() {
    if (score <= best) return;
    best = score;
    try {
        localStorage.setItem(BEST_KEY, String(best));
    } catch (e) {
        /* storage blocked — the score still shows for this session */
    }
}

// A level is a pure function of its number, so the same level always sends the
// same crowd at the same base speed.
function levelPlan(n) {
    const k = Math.max(1, n);
    return {
        patrons: 4 + 2 * k,
        speed: 26 + 6 * k,
        interval: Math.max(0.5, 2.6 - 0.3 * k),
    };
}

function fullMugsInLane(lane) {
    return mugs.filter((m) => m.lane === lane && m.dir === 1).length;
}

// --- run / level control ---------------------------------------------------

function loadLevel(n) {
    const plan = levelPlan(n);
    spawnsLeft = plan.patrons;
    spawnTimer = Math.min(1.2, plan.interval);
    patrons.length = 0;
    mugs.length = 0;
    splashes.length = 0;
    foam.length = 0;
    bartender.pourCooldown = 0;
}

function startGame() {
    score = 0;
    level = 1;
    lives = LIVES_START;
    served = 0;
    streak = 0;
    bartender.lane = 0;
    seedRng(SEED);
    loadLevel(1);
    state = 'running';
    autoRun = true;
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    loadLevel(level);
    state = 'running';
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', '', 'Press P or Space to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// Space, a click on the overlay button, or a click on an idle board.
function advance() {
    switch (state) {
        case 'idle':
        case 'gameover':
        case 'won':
            startGame();
            break;
        case 'levelclear':
            nextLevel();
            break;
        case 'paused':
            togglePause();
            break;
        case 'running':
            pour();
            break;
    }
}

function moveLane(delta) {
    if (state !== 'running') return false;
    const next = Math.min(LANES - 1, Math.max(0, bartender.lane + delta));
    if (next === bartender.lane) return false;
    bartender.lane = next;
    return true;
}

function pour() {
    if (state !== 'running') return false;
    if (bartender.pourCooldown > 0) return false;
    if (fullMugsInLane(bartender.lane) >= MUGS_PER_LANE) return false;
    mugs.push({ lane: bartender.lane, x: TAP_X + 14, dir: 1 });
    bartender.pourCooldown = POUR_COOLDOWN;
    for (let i = 0; i < 6; i++) {
        foam.push({
            x: TAP_X + 10,
            y: laneY(bartender.lane) - 6,
            vx: 30 + rnd() * 50,
            vy: -30 + rnd() * 60,
            life: 0.35,
        });
    }
    return true;
}

function loseLife() {
    lives = Math.max(0, lives - 1);
    if (lives === 0) {
        state = 'gameover';
        saveBest();
        showOverlay('GAME OVER', `Score ${score}`, 'Press Space to pull another shift');
    }
    updateHud();
}

// --- simulation ------------------------------------------------------------

function stepSpawns(dt) {
    if (spawnsLeft <= 0) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;

    const lane = Math.min(LANES - 1, Math.floor(rnd() * LANES));
    const crowded = patrons.some((p) => p.lane === lane && p.x > EXIT_X - DOOR_CLEARANCE);
    if (crowded) {
        spawnTimer = 0.2;             // hold the door, but do not spend a patron
        return;
    }

    const plan = levelPlan(level);
    patrons.push({
        lane,
        x: EXIT_X,
        speed: plan.speed * (0.9 + 0.2 * rnd()),
        drinks: 0,
    });
    spawnsLeft -= 1;
    spawnTimer = plan.interval;
}

function stepPatrons(dt) {
    const grabbed = [];

    for (let lane = 0; lane < LANES; lane++) {
        // Front of the queue (nearest the taps) first, so a patron is clamped
        // against the already-updated position of the one ahead of them.
        const queue = patrons.filter((p) => p.lane === lane).sort((a, b) => a.x - b.x);
        let aheadX = null;
        for (const p of queue) {
            p.x -= p.speed * dt;
            if (aheadX !== null) p.x = Math.max(p.x, aheadX + PATRON_GAP);
            if (p.x <= TAP_X + PATRON_REACH) {
                p.x = TAP_X + PATRON_REACH;
                grabbed.push(p);
            }
            aheadX = p.x;
        }
    }

    grabbed.forEach((p) => {
        const i = patrons.indexOf(p);
        if (i >= 0) patrons.splice(i, 1);
        splashes.push({ x: p.x, y: laneY(p.lane), life: 0.6, kind: 'grab' });
        streak = 0;
        loseLife();
    });
}

// A patron drinks the mug that reached them: points, a shove toward the door,
// and the empty comes straight back down the lane.
function serve(patron, mug, returned) {
    patron.drinks += 1;
    score += DRINK_POINTS;

    // The crowd behind absorbs whatever is left of the shove.
    const behind = patrons
        .filter((p) => p !== patron && p.lane === patron.lane && p.x > patron.x)
        .sort((a, b) => a.x - b.x)[0];
    let target = patron.x + PATRON_PUSH;
    if (behind) target = Math.min(target, behind.x - PATRON_GAP);
    patron.x = Math.max(patron.x, target);

    returned.push({ lane: mug.lane, x: mug.x, dir: -1 });
    foam.push({ x: mug.x, y: laneY(mug.lane) - 10, vx: 20, vy: -40, life: 0.3 });

    if (patron.x >= EXIT_X) {
        const i = patrons.indexOf(patron);
        if (i >= 0) patrons.splice(i, 1);
        served += 1;
        score += SERVE_POINTS;
    }
}

function stepMugs(dt) {
    const keep = [];
    const returned = [];

    for (const mug of mugs) {
        mug.x += mug.dir * MUG_SPEED * dt;

        if (mug.dir === 1) {
            const hit = patrons
                .filter((p) => p.lane === mug.lane && Math.abs(p.x - mug.x) <= MUG_R + PATRON_R)
                .sort((a, b) => a.x - b.x)[0];
            if (hit) {
                serve(hit, mug, returned);
                continue;
            }
            if (mug.x >= EXIT_X) {
                splashes.push({ x: EXIT_X, y: laneY(mug.lane), life: 0.6, kind: 'smash' });
                streak = 0;
                loseLife();
                continue;
            }
        } else if (mug.x <= TAP_X) {
            if (bartender.lane === mug.lane) {
                score += CATCH_POINTS;
                streak += 1;
            } else {
                splashes.push({ x: TAP_X, y: laneY(mug.lane), life: 0.6, kind: 'smash' });
                streak = 0;
                loseLife();
            }
            continue;
        }

        keep.push(mug);
    }

    mugs.length = 0;
    keep.concat(returned).forEach((m) => mugs.push(m));
}

function stepCosmetics(dt) {
    splashes = splashes.filter((s) => (s.life -= dt) > 0);
    foam = foam.filter((f) => {
        f.life -= dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 180 * dt;
        return f.life > 0;
    });
}

function checkLevelClear() {
    if (state !== 'running') return;
    if (spawnsLeft > 0 || patrons.length > 0 || mugs.length > 0) return;

    score += CLEAR_BONUS_PER_LIFE * lives;
    if (level >= LEVEL_COUNT) {
        state = 'won';
        saveBest();
        showOverlay('YOU WIN!', `Score ${score}`, 'Last call — press Space to run it again');
    } else {
        state = 'levelclear';
        showOverlay('LEVEL CLEAR', `Score ${score}`, 'Press Space for the next level');
    }
    updateHud();
}

// The only thing that advances the world. One call = one fixed timestep.
function physicsStep(dt) {
    stepCosmetics(dt);
    if (state !== 'running') return;

    bartender.pourCooldown = Math.max(0, bartender.pourCooldown - dt);
    bartender.bob += dt;

    stepSpawns(dt);
    stepPatrons(dt);
    stepMugs(dt);
    checkLevelClear();
}

// --- DOM -------------------------------------------------------------------

function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('lives').textContent = String(lives);
    document.getElementById('served').textContent = String(served);
    document.getElementById('best').textContent = String(Math.max(best, 0));
}

function showOverlay(title, scoreText, sub) {
    document.getElementById('overlay-title').textContent = title;
    document.getElementById('overlay-score').textContent = scoreText;
    document.getElementById('overlay-sub').textContent = sub;
    document.getElementById('overlay').classList.add('visible');
}

function hideOverlay() {
    document.getElementById('overlay').classList.remove('visible');
}

// --- rendering -------------------------------------------------------------

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1d2435');
    sky.addColorStop(1, '#0d1118');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // back wall panelling
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    for (let x = 20; x < W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
    }

    // sign over the taps
    ctx.fillStyle = 'rgba(245, 158, 11, 0.16)';
    ctx.fillRect(14, 12, 132, 30);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.strokeRect(14, 12, 132, 30);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 16px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ON TAP', 80, 28);

    // level + streak plate on the right
    ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.fillRect(W - 186, 12, 170, 30);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '14px "Trebuchet MS", sans-serif';
    ctx.fillText(`LEVEL ${level}   STREAK ${streak}`, W - 101, 28);
}

function drawServiceAlley() {
    const alley = ctx.createLinearGradient(0, 0, 44, 0);
    alley.addColorStop(0, 'rgba(8, 11, 18, 0.95)');
    alley.addColorStop(1, 'rgba(23, 31, 48, 0.6)');
    ctx.fillStyle = alley;
    ctx.fillRect(0, 54, 48, H - 84);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.beginPath();
    ctx.moveTo(48, 54);
    ctx.lineTo(48, H - 30);
    ctx.stroke();
}

function drawLane(lane) {
    const y = laneY(lane);
    const left = 48;
    const right = EXIT_X + 46;

    // shadow under the bar
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left, y + BAR_H / 2 - 2, right - left, 10);

    // the bar top
    const wood = ctx.createLinearGradient(0, y - BAR_H / 2, 0, y + BAR_H / 2);
    wood.addColorStop(0, '#9a5429');
    wood.addColorStop(0.42, '#7a401d');
    wood.addColorStop(1, '#4a2511');
    ctx.fillStyle = wood;
    ctx.fillRect(left, y - BAR_H / 2, right - left, BAR_H);

    // grain
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.14)';
    for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(left, y - BAR_H / 2 + i * 13);
        ctx.lineTo(right, y - BAR_H / 2 + i * 13);
        ctx.stroke();
    }

    // edges
    ctx.fillStyle = 'rgba(255, 226, 183, 0.22)';
    ctx.fillRect(left, y - BAR_H / 2, right - left, 3);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(left, y + BAR_H / 2 - 5, right - left, 5);

    // the catch line at the taps
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.28)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(TAP_X, y - BAR_H / 2 + 4);
    ctx.lineTo(TAP_X, y + BAR_H / 2 - 4);
    ctx.stroke();
    ctx.setLineDash([]);

    drawDoor(lane, y);
    drawTap(lane, y);
}

// A swing door at the end of every lane, with a sliver of street light behind it.
function drawDoor(lane, y) {
    const x = EXIT_X + 14;
    ctx.fillStyle = 'rgba(253, 224, 71, 0.10)';
    ctx.fillRect(x - 6, y - BAR_H / 2 - 10, 6, BAR_H + 20);

    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(x, y - BAR_H / 2 - 10, 32, BAR_H + 20);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.strokeRect(x, y - BAR_H / 2 - 10, 32, BAR_H + 20);

    // porthole window
    ctx.beginPath();
    ctx.arc(x + 16, y - 6, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.stroke();
}

// The tap hangs over the bar from a rail above the lane, and lights up when the
// bartender is standing in that lane.
function drawTap(lane, y) {
    const active = bartender.lane === lane;
    const top = y - BAR_H / 2 - 18;

    ctx.fillStyle = 'rgba(100, 116, 139, 0.9)';
    ctx.fillRect(TAP_X - 16, top, 26, 6);              // rail
    ctx.fillStyle = active ? '#fbbf24' : '#8d9bb0';
    ctx.fillRect(TAP_X - 5, top + 4, 7, 16);           // spout
    ctx.beginPath();
    ctx.arc(TAP_X - 12, top + 1, 5, 0, Math.PI * 2);   // handle
    ctx.fill();

    if (active) {
        ctx.beginPath();
        ctx.arc(TAP_X - 1, top + 22, 9, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
        ctx.fill();
    }
}

function drawBartender() {
    const y = laneY(bartender.lane);
    const bob = Math.sin(bartender.bob * 6) * 1.5;
    const x = 24;

    // shadow
    ctx.beginPath();
    ctx.ellipse(x, y + 26, 14, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();

    // legs
    ctx.fillStyle = '#334155';
    ctx.fillRect(x - 8, y + 12 + bob, 6, 12);
    ctx.fillRect(x + 2, y + 12 + bob, 6, 12);

    // body and apron
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(x - 10, y - 12 + bob, 20, 26);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(x - 10, y + 1 + bob, 20, 13);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.8)';
    ctx.fillRect(x - 3, y - 12 + bob, 6, 13);

    // head and cap
    ctx.beginPath();
    ctx.arc(x, y - 21 + bob, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f5d0a9';
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x - 11, y - 30 + bob, 22, 6);
    ctx.fillRect(x + 7, y - 25 + bob, 7, 3);

    // arm up at the tap handle
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 8, y - 6 + bob);
    ctx.lineTo(TAP_X - 14, y - BAR_H / 2 - 10 + bob);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';

    // ready light: green while the taps are free
    ctx.beginPath();
    ctx.arc(x, y + 32, 4, 0, Math.PI * 2);
    ctx.fillStyle = bartender.pourCooldown > 0 ? 'rgba(148, 163, 184, 0.5)' : '#34d399';
    ctx.fill();
}

function drawPatron(p) {
    const y = laneY(p.lane);
    const sway = Math.sin(p.x * 0.06) * 1.6;
    const shirt = ['#ef4444', '#a855f7', '#22d3ee', '#f472b6'][p.lane % 4];

    // shadow on the bar top
    ctx.beginPath();
    ctx.ellipse(p.x, y + 20, 13, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    // legs
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(p.x - 8, y + 10 + sway, 6, 10);
    ctx.fillRect(p.x + 2, y + 10 + sway, 6, 10);

    // body
    ctx.fillStyle = shirt;
    ctx.fillRect(p.x - 11, y - 10 + sway, 22, 22);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fillRect(p.x - 11, y + 6 + sway, 22, 6);

    // head, with a hat so they read at a glance
    ctx.beginPath();
    ctx.arc(p.x, y - 19 + sway, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f5d0a9';
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(p.x - 12, y - 26 + sway, 24, 4);
    ctx.fillRect(p.x - 8, y - 31 + sway, 16, 6);

    // eyes, looking down the bar at the taps
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(p.x - 5, y - 20 + sway, 2, 3);
    ctx.fillRect(p.x - 1, y - 20 + sway, 2, 3);

    // thirst pips: one per drink already taken
    for (let i = 0; i < Math.min(p.drinks, 4); i++) {
        ctx.beginPath();
        ctx.arc(p.x - 9 + i * 6, y + 24, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
    }
}

function drawMug(m) {
    const y = laneY(m.lane);
    const full = m.dir === 1;

    ctx.fillStyle = full ? '#fcd34d' : 'rgba(203, 213, 225, 0.55)';
    ctx.fillRect(m.x - MUG_R + 2, y - 10, MUG_R * 2 - 4, 20);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.8)';
    ctx.strokeRect(m.x - MUG_R + 2, y - 10, MUG_R * 2 - 4, 20);

    // handle
    ctx.beginPath();
    ctx.arc(m.x + MUG_R - 1, y, 5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    if (full) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(m.x - MUG_R + 2, y - 13, MUG_R * 2 - 4, 5);
    }
}

function drawSplashes() {
    splashes.forEach((s) => {
        const k = Math.max(0, s.life / 0.6);
        ctx.beginPath();
        ctx.arc(s.x, s.y + 8, 6 + (1 - k) * 16, 0, Math.PI * 2);
        ctx.strokeStyle =
            s.kind === 'grab' ? `rgba(248, 113, 113, ${k})` : `rgba(252, 211, 77, ${k})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
    });
}

function drawFoam() {
    foam.forEach((f) => {
        ctx.beginPath();
        ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(248, 250, 252, ${Math.max(0, f.life * 2)})`;
        ctx.fill();
    });
}

function drawLives() {
    for (let i = 0; i < Math.min(lives, 8); i++) {
        const x = 24 + i * 16;
        ctx.fillStyle = '#fcd34d';
        ctx.fillRect(x, H - 26, 9, 14);
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.7)';
        ctx.strokeRect(x, H - 26, 9, 14);
    }
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('MUGS IN HAND', 24, H - 34);
    ctx.textAlign = 'center';
}

function draw() {
    drawBackground();
    drawServiceAlley();
    for (let lane = 0; lane < LANES; lane++) drawLane(lane);
    patrons.forEach(drawPatron);
    mugs.forEach(drawMug);
    drawSplashes();
    drawFoam();
    drawBartender();
    drawLives();
}

// --- input -----------------------------------------------------------------

document.addEventListener('keydown', (e) => {
    switch (e.code) {
        case 'Space':
            e.preventDefault();
            advance();
            break;
        case 'ArrowUp':
        case 'KeyW':
            e.preventDefault();
            moveLane(-1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            e.preventDefault();
            moveLane(1);
            break;
        case 'KeyP':
            togglePause();
            break;
    }
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') {
        advance();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) * canvas.height) / rect.height;
    bartender.lane = laneFromY(y);
    pour();
});

document.getElementById('btn-start').addEventListener('click', () => advance());

// --- main loop -------------------------------------------------------------

let lastFrame = 0;
let carry = 0;

function frame(ts) {
    const dt = lastFrame ? Math.min(0.05, (ts - lastFrame) / 1000) : 0;
    lastFrame = ts;

    if (autoRun && state === 'running') {
        carry += dt;
        while (carry >= DT) {
            physicsStep(DT);
            carry -= DT;
        }
    } else {
        carry = 0;
    }

    updateHud();
    draw();
    requestAnimationFrame(frame);
}

updateHud();
draw();
requestAnimationFrame(frame);
