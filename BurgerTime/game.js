/* Burger Time — walk every burger ingredient down onto the plates while
 * dodging the food that walks. See DESIGN.md for the full write-up. */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
const CANVAS_W = 600;
const CANVAS_H = 560;

// Walkable floors, top to bottom. The last one carries the plates.
const FLOOR_YS = [110, 190, 270, 350, 430, 510];
const PLATE_FLOOR = FLOOR_YS.length - 1;

// Ladders sit in the gaps between burger columns plus one at each end.
const LADDER_XS = [60, 180, 300, 420, 540];
const LADDER_W = 20;

const COL_COUNT = 4;
const COL_W = 96;
const COL_X0 = 72;
const COL_GAP = 120;

const WALK_MIN = LADDER_XS[0];
const WALK_MAX = LADDER_XS[LADDER_XS.length - 1];

const INGREDIENT_TYPES = ['bunTop', 'lettuce', 'patty', 'cheese', 'bunBottom'];
const PIECES_PER_INGREDIENT = 4;
const PIECE_W = COL_W / PIECES_PER_INGREDIENT;
const ING_H = 10;
const PIECE_DROP = 5;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const CHEF_SPEED = 95;
const CHEF_W = 18;
const CHEF_H = 26;
const FALL_SPEED = 200;
const SNAP = 6;

const START_LIVES = 3;
const START_PEPPER = 5;
const PEPPER_REACH = 26;
const PEPPER_LIFE = 0.4;
const PEPPER_RADIUS = 22;
const STUN_TIME = 4;

const ENEMY_TYPES = ['dog', 'egg', 'pickle'];
const ENEMY_BASE_SPEED = 42;
const ENEMY_LEVEL_SPEED = 6;
const MAX_ENEMIES = 5;
const SPAWN_DELAY = 5;
const SPAWN_INTERVAL = 6;

const DROP_SCORE = 50;
const SQUASH_SCORE = 500;
const LEVEL_BONUS = 1000;

const BEST_KEY = 'burgertime-best';

const COLORS = {
    bunTop: '#d98e3f',
    lettuce: '#5cb85c',
    patty: '#7a4326',
    cheese: '#f7c948',
    bunBottom: '#c47f35',
    dog: '#e2574c',
    egg: '#f2f0e6',
    pickle: '#79a83c',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'idle'; // idle | running | paused | over
let score = 0;
let lives = START_LIVES;
let level = 1;
let pepper = START_PEPPER;
let best = 0;

let ingredients = [];
let enemies = [];
let peppers = [];

let chef = {
    x: LADDER_XS[2],
    y: FLOOR_YS[PLATE_FLOOR],
    floor: PLATE_FLOOR,
    dir: 1,
    climbing: false,
    walkPhase: 0,
};

let input = { dx: 0, dy: 0 };
let spawnTimer = SPAWN_DELAY;
let banner = '';
let bannerTimer = 0;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

function columnX(col) {
    return COL_X0 + col * COL_GAP;
}

function pieceCenterX(col, piece) {
    return columnX(col) + piece * PIECE_W + PIECE_W / 2;
}

/** Index of the floor whose line is within `tol` of `y`, else -1. */
function floorNear(y, tol) {
    for (let i = 0; i < FLOOR_YS.length; i++) {
        if (Math.abs(y - FLOOR_YS[i]) <= tol) return i;
    }
    return -1;
}

/** Index of the closest floor, whatever the distance. */
function floorIndexOf(y) {
    let bestIdx = 0;
    for (let i = 1; i < FLOOR_YS.length; i++) {
        if (Math.abs(y - FLOOR_YS[i]) < Math.abs(y - FLOOR_YS[bestIdx])) bestIdx = i;
    }
    return bestIdx;
}

function nearestLadder(x) {
    let bestX = LADDER_XS[0];
    for (const lx of LADDER_XS) {
        if (Math.abs(lx - x) < Math.abs(bestX - x)) bestX = lx;
    }
    return bestX;
}

function platedCount(col) {
    let n = 0;
    for (const ing of ingredients) {
        if (ing.col === col && ing.state === 'plated') n++;
    }
    return n;
}

function allPlated() {
    return ingredients.length > 0 && ingredients.every((i) => i.state === 'plated');
}

function enemySpeed() {
    return ENEMY_BASE_SPEED + (level - 1) * ENEMY_LEVEL_SPEED;
}

// ---------------------------------------------------------------------------
// Level setup
// ---------------------------------------------------------------------------
function makePieces() {
    return Array.from({ length: PIECES_PER_INGREDIENT }, () => ({ stepped: false }));
}

function buildLevel() {
    ingredients = [];
    for (let col = 0; col < COL_COUNT; col++) {
        INGREDIENT_TYPES.forEach((type, index) => {
            ingredients.push({
                col,
                type,
                index,
                floor: index, // bun top highest, bun bottom just above the plate
                y: FLOOR_YS[index], // bottom edge of the ingredient
                state: 'rest', // rest | fall | plated
                pieces: makePieces(),
                squashed: 0,
            });
        });
    }
}

function resetPositions() {
    chef.x = LADDER_XS[2];
    chef.y = FLOOR_YS[PLATE_FLOOR];
    chef.floor = PLATE_FLOOR;
    chef.dir = 1;
    chef.climbing = false;
    chef.walkPhase = 0;
    input.dx = 0;
    input.dy = 0;
    enemies.length = 0;
    peppers.length = 0;
    spawnTimer = SPAWN_DELAY;
}

function startGame() {
    state = 'running';
    score = 0;
    lives = START_LIVES;
    level = 1;
    pepper = START_PEPPER;
    banner = '';
    bannerTimer = 0;
    buildLevel();
    resetPositions();
    hideOverlay();
    updateHud();
    draw();
}

function completeLevel() {
    score += LEVEL_BONUS + level * 100;
    level++;
    pepper = START_PEPPER;
    buildLevel();
    resetPositions();
    banner = 'LEVEL ' + level;
    bannerTimer = 1.8;
    updateHud();
}

function endGame() {
    state = 'over';
    if (score > best) {
        best = score;
        try {
            window.localStorage.setItem(BEST_KEY, String(best));
        } catch (e) {
            /* storage unavailable — keep the in-memory best */
        }
    }
    updateHud();
    showOverlay('GAME OVER', 'Score ' + score + ' · Best ' + best, 'Press Space to play again', 'Play Again');
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
    } else if (state === 'paused') {
        state = 'running';
    }
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------
function setChefTo(floor, x) {
    chef.x = x;
    chef.y = FLOOR_YS[floor];
    chef.floor = floor;
    chef.dir = 1;
    chef.climbing = false;
    input.dx = 0;
    input.dy = 0;
}

function setInput(dx, dy) {
    input.dx = dx;
    input.dy = dy;
}

function updateChef(dt) {
    const dist = CHEF_SPEED * dt;

    if (input.dy !== 0) {
        const lx = nearestLadder(chef.x);
        if (Math.abs(chef.x - lx) <= LADDER_W / 2) {
            const ny = clamp(chef.y + input.dy * dist, FLOOR_YS[0], FLOOR_YS[PLATE_FLOOR]);
            if (ny !== chef.y) {
                chef.x = lx;
                chef.y = ny;
                chef.climbing = true;
                chef.walkPhase += dist;
            }
        }
    }

    if (input.dx !== 0) {
        const f = floorNear(chef.y, SNAP);
        if (f >= 0) {
            chef.y = FLOOR_YS[f];
            chef.climbing = false;
            chef.x = clamp(chef.x + input.dx * dist, WALK_MIN, WALK_MAX);
            chef.dir = input.dx > 0 ? 1 : -1;
            chef.walkPhase += dist;
        }
    }

    if (input.dy === 0) {
        const f = floorNear(chef.y, SNAP);
        if (f >= 0) {
            chef.y = FLOOR_YS[f];
            chef.climbing = false;
        }
    }

    chef.floor = floorNear(chef.y, 0.001);
    stepOnIngredients();
}

/** Mark the ingredient pieces the chef is standing on; a fully walked one falls. */
function stepOnIngredients() {
    if (chef.floor < 0) return;
    for (const ing of ingredients) {
        if (ing.state !== 'rest' || ing.floor !== chef.floor) continue;
        const left = columnX(ing.col);
        let changed = false;
        for (let j = 0; j < ing.pieces.length; j++) {
            const p = ing.pieces[j];
            if (p.stepped) continue;
            const px = left + j * PIECE_W;
            if (chef.x >= px && chef.x <= px + PIECE_W) {
                p.stepped = true;
                changed = true;
            }
        }
        if (changed && ing.pieces.every((p) => p.stepped)) dropIngredient(ing);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------
function dropIngredient(ing) {
    if (!ing || ing.state !== 'rest') return false;
    ing.pieces.forEach((p) => {
        p.stepped = true;
    });
    ing.state = 'fall';
    ing.squashed = 0;
    score += DROP_SCORE;
    updateHud();
    return true;
}

function squashCheck(ing) {
    const left = columnX(ing.col);
    const right = left + COL_W;
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (e.x > left - 8 && e.x < right + 8 && Math.abs(e.y - ing.y) < 18) {
            enemies.splice(i, 1);
            ing.squashed++;
            score += SQUASH_SCORE * ing.squashed;
            banner = '+' + SQUASH_SCORE * ing.squashed;
            bannerTimer = 0.9;
            updateHud();
        }
    }
}

function landingY(ing, nextFloor) {
    if (nextFloor >= PLATE_FLOOR) {
        return FLOOR_YS[PLATE_FLOOR] - platedCount(ing.col) * ING_H;
    }
    return FLOOR_YS[nextFloor];
}

function updateIngredients(dt) {
    for (const ing of ingredients) {
        if (ing.state !== 'fall') continue;
        ing.y += FALL_SPEED * dt;
        squashCheck(ing);

        const next = ing.floor + 1;
        const targetY = landingY(ing, next);
        if (ing.y < targetY) continue;

        ing.y = targetY;
        ing.floor = Math.min(next, PLATE_FLOOR);

        if (ing.floor >= PLATE_FLOOR) {
            ing.state = 'plated';
            ing.pieces.forEach((p) => {
                p.stepped = true;
            });
            continue;
        }

        // Landing on a resting ingredient knocks it loose and both keep going.
        const below = ingredients.find(
            (o) => o !== ing && o.col === ing.col && o.state === 'rest' && o.floor === ing.floor
        );
        if (below) {
            dropIngredient(below);
        } else {
            ing.state = 'rest';
            ing.pieces.forEach((p) => {
                p.stepped = false;
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
function spawnEnemy(type, floor, x) {
    const e = {
        type,
        x,
        y: FLOOR_YS[floor],
        floor,
        speed: enemySpeed(),
        stun: 0,
        dir: 1,
        wobble: 0,
    };
    enemies.push(e);
    return e;
}

function spawnTick(dt) {
    spawnTimer -= dt;
    const cap = Math.min(MAX_ENEMIES, 2 + level);
    if (spawnTimer > 0 || enemies.length >= cap) return;
    spawnTimer = SPAWN_INTERVAL;
    const type = ENEMY_TYPES[Math.floor(Math.random() * ENEMY_TYPES.length)];
    const floor = Math.random() < 0.5 ? 0 : PLATE_FLOOR - 1;
    const x = Math.random() < 0.5 ? WALK_MIN : WALK_MAX;
    spawnEnemy(type, floor, x);
}

function updateEnemies(dt) {
    const chefFloor = chef.floor >= 0 ? chef.floor : floorIndexOf(chef.y);
    for (const e of enemies) {
        if (e.stun > 0) {
            e.stun = Math.max(0, e.stun - dt);
            continue;
        }
        const d = e.speed * dt;
        e.wobble += dt;

        if (e.floor === chefFloor && Math.abs(e.y - chef.y) < 1) {
            const dx = chef.x - e.x;
            if (Math.abs(dx) > d) {
                e.x += Math.sign(dx) * d;
                e.dir = Math.sign(dx);
            } else {
                e.x = chef.x;
            }
        } else {
            const lx = nearestLadder(e.x);
            if (Math.abs(e.x - lx) > d) {
                e.x += Math.sign(lx - e.x) * d;
                e.dir = Math.sign(lx - e.x);
            } else {
                e.x = lx;
                const dy = chef.y - e.y;
                if (Math.abs(dy) > d) {
                    e.y += Math.sign(dy) * d;
                } else {
                    e.y = chef.y;
                }
            }
        }

        e.x = clamp(e.x, WALK_MIN, WALK_MAX);
        const f = floorNear(e.y, 0.6);
        if (f >= 0) e.floor = f;
    }
}

function checkChefHit() {
    for (const e of enemies) {
        if (e.stun > 0) continue;
        if (Math.abs(e.x - chef.x) < 14 && Math.abs(e.y - chef.y) < 22) {
            loseLife();
            return;
        }
    }
}

function loseLife() {
    lives--;
    updateHud();
    if (lives <= 0) {
        endGame();
    } else {
        resetPositions();
        banner = 'OUCH!';
        bannerTimer = 1.2;
    }
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------
function throwPepper() {
    if (state !== 'running' || pepper <= 0) return false;
    pepper--;
    peppers.push({
        x: clamp(chef.x + chef.dir * PEPPER_REACH, 0, CANVAS_W),
        y: chef.y - CHEF_H / 2,
        life: PEPPER_LIFE,
    });
    updateHud();
    return true;
}

function updatePeppers(dt) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= dt;
        for (const e of enemies) {
            if (Math.abs(e.x - p.x) < PEPPER_RADIUS && Math.abs(e.y - CHEF_H / 2 - p.y) < 24) {
                e.stun = STUN_TIME;
            }
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Main step
// ---------------------------------------------------------------------------
function step(dt) {
    if (state !== 'running') return;
    if (bannerTimer > 0) bannerTimer = Math.max(0, bannerTimer - dt);
    updateChef(dt);
    updateIngredients(dt);
    updateEnemies(dt);
    updatePeppers(dt);
    checkChefHit();
    if (state !== 'running') return; // a life was just lost
    spawnTick(dt);
    if (allPlated()) completeLevel();
}

// ---------------------------------------------------------------------------
// HUD & overlay
// ---------------------------------------------------------------------------
function updateHud() {
    document.getElementById('score').textContent = String(score);
    document.getElementById('level').textContent = String(level);
    document.getElementById('lives').textContent = String(Math.max(0, lives));
    document.getElementById('pepper').textContent = String(pepper);
    document.getElementById('best').textContent = String(best);
}

function showOverlay(title, scoreText, sub, button) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreText;
    overlaySub.textContent = sub;
    btnStart.textContent = button;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawFloors() {
    for (let i = 0; i < FLOOR_YS.length; i++) {
        const y = FLOOR_YS[i];
        ctx.fillStyle = '#3d3355';
        ctx.fillRect(WALK_MIN - 16, y, WALK_MAX - WALK_MIN + 32, 5);
        ctx.fillStyle = '#5a4b7d';
        ctx.fillRect(WALK_MIN - 16, y, WALK_MAX - WALK_MIN + 32, 2);
    }
}

function drawLadders() {
    ctx.strokeStyle = '#6f5f93';
    ctx.lineWidth = 2;
    for (const lx of LADDER_XS) {
        for (let f = 0; f < PLATE_FLOOR; f++) {
            const top = FLOOR_YS[f];
            const bottom = FLOOR_YS[f + 1];
            ctx.beginPath();
            ctx.moveTo(lx - LADDER_W / 2, top);
            ctx.lineTo(lx - LADDER_W / 2, bottom);
            ctx.moveTo(lx + LADDER_W / 2, top);
            ctx.lineTo(lx + LADDER_W / 2, bottom);
            ctx.stroke();
            for (let y = top + 10; y < bottom; y += 12) {
                ctx.beginPath();
                ctx.moveTo(lx - LADDER_W / 2, y);
                ctx.lineTo(lx + LADDER_W / 2, y);
                ctx.stroke();
            }
        }
    }
}

function drawPlates() {
    const y = FLOOR_YS[PLATE_FLOOR] + 6;
    for (let c = 0; c < COL_COUNT; c++) {
        const cx = columnX(c) + COL_W / 2;
        ctx.fillStyle = '#cfd8e3';
        ctx.beginPath();
        ctx.ellipse(cx, y, COL_W / 2 + 6, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa7b8';
        ctx.beginPath();
        ctx.ellipse(cx, y + 3, COL_W / 2 + 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const left = columnX(ing.col);
    const base = COLORS[ing.type];
    for (let j = 0; j < ing.pieces.length; j++) {
        const p = ing.pieces[j];
        const x = left + j * PIECE_W;
        const y = ing.y - ING_H + (p.stepped && ing.state === 'rest' ? PIECE_DROP : 0);

        ctx.fillStyle = base;
        if (ing.type === 'bunTop') {
            ctx.beginPath();
            ctx.moveTo(x, y + ING_H);
            ctx.lineTo(x, y + 5);
            ctx.quadraticCurveTo(x + PIECE_W / 2, y - 5, x + PIECE_W, y + 5);
            ctx.lineTo(x + PIECE_W, y + ING_H);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#f7e6c8';
            ctx.fillRect(x + 5, y + 2, 3, 2);
            ctx.fillRect(x + 15, y + 4, 3, 2);
        } else if (ing.type === 'lettuce') {
            ctx.fillRect(x, y + 2, PIECE_W, ING_H - 2);
            ctx.fillStyle = '#8fd48f';
            for (let k = 0; k < 3; k++) {
                ctx.beginPath();
                ctx.arc(x + 4 + k * 8, y + 3, 4, Math.PI, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillRect(x, y + 1, PIECE_W, ING_H - 1);
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fillRect(x, y + 1, PIECE_W, 2);
        }

        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 1.5, PIECE_W - 1, ING_H - 2);
    }
}

function drawChef() {
    const x = chef.x;
    const y = chef.y;
    const swing = Math.sin(chef.walkPhase / 7) * 4;

    // legs
    ctx.strokeStyle = '#2b3a67';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 9);
    ctx.lineTo(x - 3 - swing, y);
    ctx.moveTo(x + 3, y - 9);
    ctx.lineTo(x + 3 + swing, y);
    ctx.stroke();

    // body
    ctx.fillStyle = '#f4ecdf';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 8, CHEF_W, CHEF_H - 17);

    // arms
    ctx.strokeStyle = '#f4ecdf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - CHEF_W / 2, y - CHEF_H + 12);
    ctx.lineTo(x - CHEF_W / 2 - 4, y - CHEF_H + 16 + swing / 2);
    ctx.moveTo(x + CHEF_W / 2, y - CHEF_H + 12);
    ctx.lineTo(x + CHEF_W / 2 + 4, y - CHEF_H + 16 - swing / 2);
    ctx.stroke();

    // head + hat
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x, y - CHEF_H + 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 7, y - CHEF_H - 4, 14, 6);
    ctx.beginPath();
    ctx.arc(x - 3, y - CHEF_H - 5, 4, 0, Math.PI * 2);
    ctx.arc(x + 3, y - CHEF_H - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    // eye, facing the walk direction
    ctx.fillStyle = '#2b2233';
    ctx.fillRect(x + chef.dir * 2 - 1, y - CHEF_H + 3, 2, 2);
}

function drawEnemy(e) {
    const bob = e.stun > 0 ? 0 : Math.sin(e.wobble * 8) * 1.5;
    const y = e.y - 8 + bob;
    ctx.fillStyle = COLORS[e.type] || '#e2574c';

    if (e.type === 'egg') {
        ctx.beginPath();
        ctx.ellipse(e.x, y, 9, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f7c948';
        ctx.beginPath();
        ctx.arc(e.x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    } else if (e.type === 'pickle') {
        ctx.beginPath();
        ctx.ellipse(e.x, y, 8, 12, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a5c96a';
        ctx.fillRect(e.x - 4, y - 6, 2, 10);
    } else {
        ctx.beginPath();
        ctx.roundRect
            ? ctx.roundRect(e.x - 11, y - 6, 22, 13, 6)
            : ctx.rect(e.x - 11, y - 6, 22, 13);
        ctx.fill();
        ctx.fillStyle = '#f6d365';
        ctx.fillRect(e.x - 8, y - 2, 16, 3);
    }

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(e.x - 3, y - 4, 2.5, 0, Math.PI * 2);
    ctx.arc(e.x + 3, y - 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1424';
    ctx.beginPath();
    ctx.arc(e.x - 3 + (e.dir || 1) * 0.8, y - 4, 1.2, 0, Math.PI * 2);
    ctx.arc(e.x + 3 + (e.dir || 1) * 0.8, y - 4, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // legs
    ctx.strokeStyle = '#2b2233';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - 4, y + 7);
    ctx.lineTo(e.x - 4, e.y);
    ctx.moveTo(e.x + 4, y + 7);
    ctx.lineTo(e.x + 4, e.y);
    ctx.stroke();

    if (e.stun > 0) {
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 11px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('*', e.x - 8, y - 12);
        ctx.fillText('*', e.x + 8, y - 14);
    }
}

function drawPepperCloud(p) {
    const alpha = clamp(p.life / PEPPER_LIFE, 0, 1);
    ctx.fillStyle = 'rgba(255, 233, 180, ' + (0.35 + alpha * 0.4) + ')';
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + p.life * 6;
        const r = 6 + (1 - alpha) * 12;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBanner() {
    if (bannerTimer <= 0 || !banner) return;
    ctx.globalAlpha = clamp(bannerTimer, 0, 1);
    ctx.fillStyle = '#ffb703';
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner, CANVAS_W / 2, 70);
    ctx.globalAlpha = 1;
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // backdrop
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#1a1330');
    grad.addColorStop(1, '#0d0a18');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawFloors();
    drawPlates();

    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    for (const p of peppers) drawPepperCloud(p);
    if (state !== 'idle') drawChef();

    drawBanner();

    if (state === 'paused') {
        ctx.fillStyle = 'rgba(10, 7, 16, 0.7)';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#ffb703';
        ctx.font = 'bold 30px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', CANVAS_W / 2, CANVAS_H / 2);
        ctx.fillStyle = '#9b8ba8';
        ctx.font = '14px "Segoe UI", sans-serif';
        ctx.fillText('Press P to resume', CANVAS_W / 2, CANVAS_H / 2 + 26);
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const held = new Set();

function refreshInput() {
    let dx = 0;
    let dy = 0;
    if (held.has('ArrowLeft') || held.has('KeyA')) dx -= 1;
    if (held.has('ArrowRight') || held.has('KeyD')) dx += 1;
    if (held.has('ArrowUp') || held.has('KeyW')) dy -= 1;
    if (held.has('ArrowDown') || held.has('KeyS')) dy += 1;
    setInput(dx, dy);
}

window.addEventListener('keydown', (ev) => {
    const code = ev.code;
    if (code === 'Space') {
        ev.preventDefault();
        if (state === 'running') throwPepper();
        else if (state !== 'paused') startGame();
        return;
    }
    if (code === 'KeyP') {
        togglePause();
        return;
    }
    if (code === 'KeyR') {
        startGame();
        return;
    }
    if (
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'ArrowUp' ||
        code === 'ArrowDown'
    ) {
        ev.preventDefault();
    }
    held.add(code);
    refreshInput();
});

window.addEventListener('keyup', (ev) => {
    held.delete(ev.code);
    refreshInput();
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function loadBest() {
    let stored = null;
    try {
        stored = window.localStorage.getItem(BEST_KEY);
    } catch (e) {
        stored = null;
    }
    const n = parseInt(stored, 10);
    best = Number.isFinite(n) ? n : 0;
}

let lastTs = 0;
function frame(ts) {
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

loadBest();
updateHud();
draw();
requestAnimationFrame(frame);
