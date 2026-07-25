// --- Dimensions & tuning ---
const W = 400;              // canvas width
const H = 600;              // canvas height
const NUM_LANES = 4;
const ROAD_MARGIN = 40;     // grass shoulder width on each side
const LANE_W = (W - 2 * ROAD_MARGIN) / NUM_LANES;
const CAR_W = 44;
const CAR_H = 72;
const START_LANE = 1;

const BASE_SPEED = 3.2;     // road speed in px per 60 fps frame
const MAX_SPEED = 8;
const SPEED_RAMP = 0.0009;  // speed added per pixel travelled
const SPAWN_DIST = 210;     // travel between traffic spawns (px)
const STRIPE_PERIOD = 60;   // dash + gap length for lane markings

const STEP_MS = 1000 / 60;  // fixed physics timestep (~16.67 ms)

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- Colors ---
const CLR = {
    grass:   '#14532d',
    road:    '#3a3f47',
    edge:    '#f4f4f5',
    dash:    '#f5c518',
    player:  '#f59e0b',
    playerE: '#b45309',
    enemy:   '#ef4444',
    enemyE:  '#991b1b',
    glass:   '#0b1020',
    tyre:    '#111318',
};

// --- State (module-level globals so the Playwright suite can inspect them) ---
let player, cars, state, score, best, speed, carsDodged;
let traveled, spawnAcc, stripeOffset, lastSpawnLane;
let animId = null, lastTs = null, accumulator = 0;

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];

// Left x-coordinate of a car sitting in the given lane.
function laneX(lane) {
    return ROAD_MARGIN + lane * LANE_W + (LANE_W - CAR_W) / 2;
}

function resetState(runState) {
    player = { lane: START_LANE, x: laneX(START_LANE), y: H - CAR_H - 24 };
    cars = [];
    traveled = 0;
    score = 0;
    speed = BASE_SPEED;
    carsDodged = 0;
    spawnAcc = 0;
    stripeOffset = 0;
    lastSpawnLane = -1;
    state = runState;
    lastTs = null;
    accumulator = 0;
    scoreEl.textContent = '0';
}

function seedIdle() {
    resetState('idle');
    draw();
}

function startGame() {
    resetState('running');
    overlay.classList.remove('visible');
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('roadrush-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} m`;
    overlaySub.textContent = 'Press Space to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press P to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    lastTs = null;
    accumulator = 0;
    overlay.classList.remove('visible');
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function spawnCar() {
    let lane;
    do {
        lane = Math.floor(Math.random() * NUM_LANES);
    } while (NUM_LANES > 1 && lane === lastSpawnLane); // never block the same lane twice → always a gap
    lastSpawnLane = lane;
    cars.push({ lane, x: laneX(lane), y: -CAR_H });
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// --- Physics: one deterministic, frame-rate-normalized step ---
function step(dt) {
    const f = dt / STEP_MS; // 1.0 == a single 60 fps frame

    // Speed ramps with distance travelled, then integrate distance/score.
    speed = Math.min(MAX_SPEED, BASE_SPEED + traveled * SPEED_RAMP);
    traveled += speed * f;
    score = Math.floor(traveled);
    scoreEl.textContent = score;

    // Traffic streams downward; cars off the bottom are dodged.
    for (let i = cars.length - 1; i >= 0; i--) {
        cars[i].y += speed * f;
        if (cars[i].y > H) {
            cars.splice(i, 1);
            carsDodged++;
        }
    }

    // Spawn on a distance cadence.
    spawnAcc += speed * f;
    if (spawnAcc >= SPAWN_DIST) {
        spawnAcc -= SPAWN_DIST;
        spawnCar();
    }

    // Scroll the dashed lane markings.
    stripeOffset = (stripeOffset + speed * f) % STRIPE_PERIOD;

    // Collision ends the run.
    for (const c of cars) {
        if (rectsOverlap(player.x, player.y, CAR_W, CAR_H, c.x, c.y, CAR_W, CAR_H)) {
            endGame();
            return;
        }
    }
}

function moveLeft() {
    player.lane = Math.max(0, player.lane - 1);
    player.x = laneX(player.lane);
}

function moveRight() {
    player.lane = Math.min(NUM_LANES - 1, player.lane + 1);
    player.x = laneX(player.lane);
}

// --- Game loop: fixed-timestep accumulator over requestAnimationFrame ---
function loop(ts) {
    if (state !== 'running') return;

    if (lastTs === null) lastTs = ts;
    let elapsed = ts - lastTs;
    lastTs = ts;
    if (elapsed > 100) elapsed = 100; // clamp after tab switches / long stalls

    accumulator += elapsed;
    while (accumulator >= STEP_MS) {
        step(STEP_MS);
        accumulator -= STEP_MS;
        if (state !== 'running') break; // step() may have ended the game
    }

    draw();
    if (state === 'running') {
        animId = requestAnimationFrame(loop);
    }
}

// --- Rendering ---
function draw() {
    // Grass shoulders
    ctx.fillStyle = CLR.grass;
    ctx.fillRect(0, 0, W, H);

    // Road surface
    const roadX = ROAD_MARGIN;
    const roadW = W - 2 * ROAD_MARGIN;
    ctx.fillStyle = CLR.road;
    ctx.fillRect(roadX, 0, roadW, H);

    // Solid edge lines
    ctx.fillStyle = CLR.edge;
    ctx.fillRect(roadX, 0, 4, H);
    ctx.fillRect(roadX + roadW - 4, 0, 4, H);

    // Dashed lane dividers (scrolling)
    ctx.fillStyle = CLR.dash;
    for (let lane = 1; lane < NUM_LANES; lane++) {
        const x = roadX + lane * LANE_W - 2;
        for (let y = -STRIPE_PERIOD + stripeOffset; y < H; y += STRIPE_PERIOD) {
            ctx.fillRect(x, y, 4, STRIPE_PERIOD / 2);
        }
    }

    // Traffic
    for (const c of cars) drawCar(c.x, c.y, CLR.enemy, CLR.enemyE);

    // Player
    if (player) drawCar(player.x, player.y, CLR.player, CLR.playerE);
}

function drawCar(x, y, body, shade) {
    // Body
    ctx.fillStyle = shade;
    roundRect(x, y + 4, CAR_W, CAR_H, 10);
    ctx.fillStyle = body;
    roundRect(x, y, CAR_W, CAR_H - 3, 10);

    // Windshields
    ctx.fillStyle = CLR.glass;
    roundRect(x + 7, y + 10, CAR_W - 14, 14, 4);
    roundRect(x + 7, y + CAR_H - 28, CAR_W - 14, 14, 4);

    // Wheels
    ctx.fillStyle = CLR.tyre;
    ctx.fillRect(x - 3, y + 12, 5, 16);
    ctx.fillRect(x + CAR_W - 2, y + 12, 5, 16);
    ctx.fillRect(x - 3, y + CAR_H - 30, 5, 16);
    ctx.fillRect(x + CAR_W - 2, y + CAR_H - 30, 5, 16);
}

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
}

// --- Input ---
document.addEventListener('keydown', e => {
    const key = e.key;
    const isSpace = key === ' ' || e.code === 'Space';
    const isLeft = LEFT_KEYS.includes(key);
    const isRight = RIGHT_KEYS.includes(key);

    // Pause / resume
    if (key === 'p' || key === 'P') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    // Start / restart from idle or game-over
    if ((state === 'idle' || state === 'over') && (isSpace || isLeft || isRight)) {
        startGame();
    }

    // Steering (only while actually driving)
    if (state === 'running') {
        if (isLeft) {
            moveLeft();
            e.preventDefault();
        } else if (isRight) {
            moveRight();
            e.preventDefault();
        } else if (isSpace) {
            e.preventDefault();
        }
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('roadrush-best') || '0', 10);
bestEl.textContent = best;
seedIdle();
