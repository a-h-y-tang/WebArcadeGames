// ---------------------------------------------------------------------------
// Burger Time — a single-screen platform arcade game on an HTML5 canvas.
//
// A chef walks across burger ingredients strung along five girders so they drop,
// floor by floor, onto the plates at the bottom. Food enemies chase him; pepper
// freezes them and a falling ingredient squashes them flat.
//
// Written as one classic (non-module) script so every piece of state and every
// function is reachable from the Playwright tests as a plain global, mirroring
// Kaboom!, Dino Run and Snake in this repo. All motion is expressed per second
// and advanced through `step(dt)` in fixed sub-steps, so tests can simulate
// frames deterministically without depending on requestAnimationFrame timing.
// Nothing in the simulation reads the wall clock or Math.random.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 600;
const CANVAS_H = 520;
const FLOOR_Y = [86, 164, 242, 320, 398]; // girder tops, index 0 = highest
const PLATE_Y = 462;                      // resting y of the first plated ingredient
const GIRDER_H = 5;

// --- Burger columns ---
const COL_X = [54, 186, 318, 450];
const SEG_W = 24;
const SEGS = 4;
const ING_W = SEG_W * SEGS; // 96
const ING_H = 10;
const ING_TYPES = ['bun-top', 'lettuce', 'patty', 'bun-bottom'];
const ING_COLORS = {
    'bun-top': '#e2a24c',
    'lettuce': '#7fc55c',
    'patty': '#8b4a2b',
    'bun-bottom': '#d4913f',
};

// --- Ladders (x, and the two floors they connect) ---
const LADDER_W = 24;
const LADDER_LAYOUT = [
    [168, 432],      // floors 0 <-> 1
    [28, 300, 572],  // floors 1 <-> 2
    [168, 432],      // floors 2 <-> 3
    [28, 300, 572],  // floors 3 <-> 4
];
const LADDERS = LADDER_LAYOUT.flatMap((xs, gap) =>
    xs.map((x) => ({ x, top: gap, bottom: gap + 1 }))
);

// --- Actors ---
const CHEF_W = 18;
const CHEF_H = 26;
const CHEF_SPEED = 90;      // px/s, always faster than any enemy
const CHEF_START = { x: 300, floorIndex: 4 };
const INVULN_TIME = 1.5;    // grace period after losing a life

const ENEMY_W = 20;
const ENEMY_H = 22;
const ENEMY_BASE_SPEED = 48;
const ENEMY_SPEED_STEP = 5;
const ENEMY_MAX_SPEED = 78;
const ENEMY_TYPES = ['hotdog', 'egg', 'pickle'];
const ENEMY_COLORS = { hotdog: '#e2603c', egg: '#f2e7c9', pickle: '#5fae4e' };
const ENEMY_SPAWNS = [
    { x: 28, floorIndex: 4 },
    { x: 572, floorIndex: 4 },
    { x: 28, floorIndex: 3 },
    { x: 572, floorIndex: 3 },
    { x: 300, floorIndex: 2 },
];
const RESPAWN_TIME = 3;
const STUN_TIME = 3;

// --- Falling / scoring ---
const FALL_SPEED = 180;
const DROP_POINTS = 50;
const SQUASH_POINTS = 100;   // doubled for each extra enemy in the same drop
const LEVEL_BONUS = 1000;

// --- Pepper ---
const START_PEPPER = 5;
const PEPPER_REFILL = 2;
const PEPPER_LIFE = 0.45;
const PEPPER_REACH = 26;
const PEPPER_RX = 26;
const PEPPER_RY = 24;

const START_LIVES = 3;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const livesEl = document.getElementById('lives');
const pepperEl = document.getElementById('pepper');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, level, lives, pepper;
const chef = { x: CHEF_START.x, y: FLOOR_Y[CHEF_START.floorIndex], floorIndex: CHEF_START.floorIndex, ladder: null, inputX: 0, inputY: 0, facing: 1, invuln: 0, walked: 0 };
const ingredients = [];
const enemies = [];
const peppers = [];

// ---------------------------------------------------------------------------
// Level construction
// ---------------------------------------------------------------------------

function buildIngredients() {
    ingredients.length = 0;
    for (let col = 0; col < COL_X.length; col++) {
        ING_TYPES.forEach((type, floorIndex) => {
            ingredients.push({
                col,
                type,
                floorIndex,
                x: COL_X[col],
                y: FLOOR_Y[floorIndex],
                segs: [false, false, false, false],
                falling: false,
                plated: false,
                squashes: 0,
            });
        });
    }
}

function enemyCount() {
    return Math.min(1 + level, ENEMY_SPAWNS.length);
}

function enemySpeed() {
    return Math.min(ENEMY_MAX_SPEED, ENEMY_BASE_SPEED + (level - 1) * ENEMY_SPEED_STEP);
}

function spawnEnemy(x, floorIndex, type) {
    const enemy = {
        type: type || ENEMY_TYPES[enemies.length % ENEMY_TYPES.length],
        x,
        y: FLOOR_Y[floorIndex],
        floorIndex,
        ladder: null,
        climbDir: 0,
        alive: true,
        stun: 0,
        respawn: 0,
        spawnX: x,
        spawnFloor: floorIndex,
    };
    enemies.push(enemy);
    return enemy;
}

function buildEnemies() {
    enemies.length = 0;
    for (let i = 0; i < enemyCount(); i++) {
        const spot = ENEMY_SPAWNS[i % ENEMY_SPAWNS.length];
        spawnEnemy(spot.x, spot.floorIndex, ENEMY_TYPES[i % ENEMY_TYPES.length]);
    }
}

// Put the chef back at his starting girder and every enemy back on its spawn.
function resetActors() {
    chef.x = CHEF_START.x;
    chef.floorIndex = CHEF_START.floorIndex;
    chef.y = FLOOR_Y[chef.floorIndex];
    chef.ladder = null;
    chef.inputX = 0;
    chef.inputY = 0;
    chef.facing = 1;
    for (const e of enemies) {
        e.x = e.spawnX;
        e.floorIndex = e.spawnFloor;
        e.y = FLOOR_Y[e.spawnFloor];
        e.ladder = null;
        e.climbDir = 0;
        e.alive = true;
        e.stun = 0;
        e.respawn = 0;
    }
    peppers.length = 0;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// The ladder reachable from `floorIndex` at position `x`, heading -1 up / +1 down.
function ladderAt(x, floorIndex, dir) {
    for (const l of LADDERS) {
        if (dir < 0 ? l.bottom !== floorIndex : l.top !== floorIndex) continue;
        if (Math.abs(l.x - x) <= LADDER_W / 2) return l;
    }
    return null;
}

function nearestLadder(x, floorIndex, dir) {
    let best = null;
    for (const l of LADDERS) {
        if (dir < 0 ? l.bottom !== floorIndex : l.top !== floorIndex) continue;
        if (!best || Math.abs(l.x - x) < Math.abs(best.x - x)) best = l;
    }
    return best;
}

function platedCount(col) {
    return ingredients.filter((i) => i.col === col && i.plated).length;
}

function plateRestY(col) {
    return PLATE_Y - platedCount(col) * ING_H;
}

function allPlated() {
    return ingredients.length > 0 && ingredients.every((i) => i.plated);
}

// The floor an actor counts as being on, ladders included.
function actorFloor(a) {
    if (!a.ladder) return a.floorIndex;
    const topY = FLOOR_Y[a.ladder.top];
    const botY = FLOOR_Y[a.ladder.bottom];
    return a.y - topY < botY - a.y ? a.ladder.top : a.ladder.bottom;
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

function setChefPos(x, floorIndex) {
    chef.x = x;
    chef.floorIndex = floorIndex;
    chef.y = FLOOR_Y[floorIndex];
    chef.ladder = null;
}

function moveChef(dx, dy) {
    chef.inputX = dx;
    chef.inputY = dy;
}

function updateChef(h) {
    if (chef.invuln > 0) chef.invuln = Math.max(0, chef.invuln - h);

    if (chef.ladder) {
        if (chef.inputY !== 0) {
            chef.y += chef.inputY * CHEF_SPEED * h;
            const topY = FLOOR_Y[chef.ladder.top];
            const botY = FLOOR_Y[chef.ladder.bottom];
            if (chef.y <= topY) {
                chef.y = topY;
                chef.floorIndex = chef.ladder.top;
                chef.ladder = null;
            } else if (chef.y >= botY) {
                chef.y = botY;
                chef.floorIndex = chef.ladder.bottom;
                chef.ladder = null;
            }
            chef.walked += CHEF_SPEED * h;
        }
        return;
    }

    // Stepping onto a ladder takes priority over walking.
    if (chef.inputY !== 0) {
        const l = ladderAt(chef.x, chef.floorIndex, chef.inputY);
        if (l) {
            chef.ladder = l;
            chef.x = l.x;
            return;
        }
    }

    if (chef.inputX !== 0) {
        chef.facing = chef.inputX;
        chef.x = Math.max(CHEF_W / 2, Math.min(CANVAS_W - CHEF_W / 2, chef.x + chef.inputX * CHEF_SPEED * h));
        chef.walked += CHEF_SPEED * h;
    }
    markSegments();
}

// Whichever ingredient slice the chef is standing on sags; a fully trodden
// ingredient breaks loose.
function markSegments() {
    for (const ing of ingredients) {
        if (ing.plated || ing.falling || ing.floorIndex !== chef.floorIndex) continue;
        const j = Math.floor((chef.x - ing.x) / SEG_W);
        if (j < 0 || j >= SEGS || ing.segs[j]) continue;
        ing.segs[j] = true;
        if (ing.segs.every(Boolean)) startFall(ing);
    }
}

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

function startFall(ing) {
    if (ing.falling || ing.plated) return;
    ing.falling = true;
    ing.squashes = 0;
    ing.segs = [true, true, true, true];
    score += DROP_POINTS;
}

function squash(enemy, ing) {
    enemy.alive = false;
    enemy.ladder = null;
    enemy.stun = 0;
    enemy.respawn = RESPAWN_TIME;
    ing.squashes += 1;
    score += SQUASH_POINTS * Math.pow(2, ing.squashes - 1);
}

function updateIngredient(ing, h) {
    if (!ing.falling) return;
    ing.y += FALL_SPEED * h;

    for (const e of enemies) {
        if (!e.alive) continue;
        if (e.x > ing.x - 6 && e.x < ing.x + ING_W + 6 && Math.abs(e.y - ing.y) <= 14) squash(e, ing);
    }

    const next = ing.floorIndex + 1;
    const onPlate = next >= FLOOR_Y.length;
    const targetY = onPlate ? plateRestY(ing.col) : FLOOR_Y[next];
    if (ing.y < targetY) return;

    if (onPlate) {
        ing.y = plateRestY(ing.col);
        ing.floorIndex = FLOOR_Y.length;
        ing.falling = false;
        ing.plated = true;
        return;
    }

    const resting = ingredients.find(
        (o) => o !== ing && !o.falling && !o.plated && o.col === ing.col && o.floorIndex === next
    );
    ing.floorIndex = next;
    if (resting) {
        // Knock it loose and bounce on past it — both now head for the floor
        // below, where either of them may knock something else loose in turn.
        startFall(resting);
        return;
    }

    ing.y = FLOOR_Y[next];
    ing.falling = false;
    ing.segs = [false, false, false, false];
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

function updateEnemy(e, h) {
    if (!e.alive) {
        e.respawn -= h;
        if (e.respawn <= 0) {
            e.alive = true;
            e.respawn = 0;
            e.x = e.spawnX;
            e.floorIndex = e.spawnFloor;
            e.y = FLOOR_Y[e.spawnFloor];
            e.ladder = null;
        }
        return;
    }
    if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - h);
        return;
    }

    const speed = enemySpeed();

    if (e.ladder) {
        e.y += e.climbDir * speed * h;
        const topY = FLOOR_Y[e.ladder.top];
        const botY = FLOOR_Y[e.ladder.bottom];
        if (e.y <= topY) {
            e.y = topY;
            e.floorIndex = e.ladder.top;
            e.ladder = null;
        } else if (e.y >= botY) {
            e.y = botY;
            e.floorIndex = e.ladder.bottom;
            e.ladder = null;
        }
        return;
    }

    const target = actorFloor(chef);
    if (target === e.floorIndex) {
        walkToward(e, chef.x, speed * h);
        return;
    }

    const dir = target < e.floorIndex ? -1 : 1;
    const ladder = nearestLadder(e.x, e.floorIndex, dir);
    if (!ladder) {
        walkToward(e, chef.x, speed * h);
        return;
    }
    if (Math.abs(e.x - ladder.x) <= speed * h) {
        e.x = ladder.x;
        e.ladder = ladder;
        e.climbDir = dir;
        return;
    }
    walkToward(e, ladder.x, speed * h);
}

function walkToward(e, x, dist) {
    const gap = x - e.x;
    if (Math.abs(gap) <= dist) e.x = x;
    else e.x += Math.sign(gap) * dist;
}

// ---------------------------------------------------------------------------
// Pepper
// ---------------------------------------------------------------------------

function throwPepper() {
    if (state !== 'running' || pepper <= 0) return;
    pepper -= 1;
    peppers.push({ x: chef.x + chef.facing * PEPPER_REACH, y: chef.y, life: PEPPER_LIFE });
}

function updatePeppers(h) {
    for (let i = peppers.length - 1; i >= 0; i--) {
        const p = peppers[i];
        p.life -= h;
        for (const e of enemies) {
            if (!e.alive) continue;
            if (Math.abs(e.x - p.x) <= PEPPER_RX && Math.abs(e.y - p.y) <= PEPPER_RY) e.stun = STUN_TIME;
        }
        if (p.life <= 0) peppers.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function substep(h) {
    updateChef(h);
    for (const ing of ingredients) updateIngredient(ing, h);
    for (const e of enemies) updateEnemy(e, h);
    updatePeppers(h);

    if (chef.invuln <= 0) {
        for (const e of enemies) {
            if (!e.alive || e.stun > 0) continue;
            if (Math.abs(e.x - chef.x) < 14 && Math.abs(e.y - chef.y) < 18) {
                loseLife();
                return;
            }
        }
    }

    if (allPlated()) nextLevel();
}

// Advance the world by `dt` seconds in small fixed sub-steps so fast-moving
// ingredients and enemies never tunnel through each other.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
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
    level = 1;
    lives = START_LIVES;
    pepper = START_PEPPER;
    buildIngredients();
    buildEnemies();
    resetActors();
    chef.invuln = 0;
    hideOverlay();
    updateHud();
}

function nextLevel() {
    score += LEVEL_BONUS;
    level += 1;
    pepper += PEPPER_REFILL;
    buildIngredients();
    buildEnemies();
    resetActors();
    chef.invuln = INVULN_TIME;
}

function loseLife() {
    lives -= 1;
    peppers.length = 0;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    resetActors();
    chef.invuln = INVULN_TIME;
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('burgertime-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Level ' + level, 'Press Space to play again', 'Play Again');
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
    levelEl.textContent = String(level);
    livesEl.textContent = String(lives);
    pepperEl.textContent = String(pepper);
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
// Rendering — reads state only, never writes it.
// ---------------------------------------------------------------------------

let animTime = 0;

function drawGirders() {
    for (const y of FLOOR_Y) {
        ctx.fillStyle = '#4b3a63';
        ctx.fillRect(0, y, CANVAS_W, GIRDER_H);
        ctx.fillStyle = '#2c2140';
        ctx.fillRect(0, y + GIRDER_H, CANVAS_W, 2);
    }
}

function drawLadders() {
    for (const l of LADDERS) {
        const topY = FLOOR_Y[l.top];
        const botY = FLOOR_Y[l.bottom] + GIRDER_H;
        const left = l.x - LADDER_W / 2;
        const right = l.x + LADDER_W / 2;
        ctx.strokeStyle = '#6d5a86';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, topY);
        ctx.lineTo(left, botY);
        ctx.moveTo(right, topY);
        ctx.lineTo(right, botY);
        ctx.stroke();
        ctx.strokeStyle = '#54426d';
        ctx.beginPath();
        for (let y = topY + 8; y < botY - 4; y += 11) {
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
        }
        ctx.stroke();
    }
}

function drawPlates() {
    for (const x of COL_X) {
        ctx.fillStyle = '#3a2c4d';
        ctx.beginPath();
        ctx.ellipse(x + ING_W / 2, PLATE_Y + 7, ING_W / 2 + 8, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4d3c66';
        ctx.beginPath();
        ctx.ellipse(x + ING_W / 2, PLATE_Y + 4, ING_W / 2 + 2, 5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawIngredient(ing) {
    const color = ING_COLORS[ing.type];
    for (let j = 0; j < SEGS; j++) {
        const sx = ing.x + j * SEG_W;
        const sag = !ing.falling && !ing.plated && ing.segs[j] ? 4 : 0;
        const top = ing.y - ING_H + sag;

        if (ing.type === 'bun-top') {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(sx, ing.y + sag);
            ctx.lineTo(sx, top + 4);
            ctx.quadraticCurveTo(sx + SEG_W / 2, top - 4, sx + SEG_W, top + 4);
            ctx.lineTo(sx + SEG_W, ing.y + sag);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#fff2d8';
            ctx.fillRect(sx + 6, top + 2, 3, 2);
            ctx.fillRect(sx + 15, top + 5, 3, 2);
        } else if (ing.type === 'lettuce') {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(sx, top + 2);
            ctx.lineTo(sx + SEG_W, top + 2);
            ctx.lineTo(sx + SEG_W, ing.y + sag - 3);
            ctx.quadraticCurveTo(sx + SEG_W * 0.75, ing.y + sag + 3, sx + SEG_W / 2, ing.y + sag - 2);
            ctx.quadraticCurveTo(sx + SEG_W * 0.25, ing.y + sag + 3, sx, ing.y + sag - 3);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.fillStyle = color;
            ctx.fillRect(sx, top + 1, SEG_W, ING_H - 1);
            if (ing.type === 'patty') {
                ctx.fillStyle = '#6b3620';
                ctx.fillRect(sx + 3, top + 4, 5, 2);
                ctx.fillRect(sx + 14, top + 6, 4, 2);
            }
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, top + 0.5, SEG_W - 1, ING_H - 1);
    }
}

function drawChef() {
    const bob = chef.ladder ? 0 : Math.sin(chef.walked / 9) * 1.5;
    const x = chef.x;
    const y = chef.y + bob;
    if (chef.invuln > 0 && Math.floor(animTime * 12) % 2 === 0) return;

    // legs
    const stride = Math.sin(chef.walked / 7) * 4;
    ctx.strokeStyle = '#2b3550';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 3, y - 8);
    ctx.lineTo(x - 3 + stride, y);
    ctx.moveTo(x + 3, y - 8);
    ctx.lineTo(x + 3 - stride, y);
    ctx.stroke();

    // body & apron
    ctx.fillStyle = '#f2f4fb';
    ctx.fillRect(x - CHEF_W / 2, y - CHEF_H + 6, CHEF_W, CHEF_H - 14);
    ctx.fillStyle = '#dbe0ef';
    ctx.fillRect(x - CHEF_W / 2 + 3, y - CHEF_H + 12, CHEF_W - 6, 6);

    // head & hat
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(x, y - CHEF_H + 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 6, y - CHEF_H - 6, 12, 6);
    ctx.beginPath();
    ctx.arc(x - 3, y - CHEF_H - 6, 4, 0, Math.PI * 2);
    ctx.arc(x + 3, y - CHEF_H - 6, 4, 0, Math.PI * 2);
    ctx.fill();

    // eye, facing the direction of travel
    ctx.fillStyle = '#2b3550';
    ctx.fillRect(x + (chef.facing > 0 ? 1 : -3), y - CHEF_H + 1, 2, 2);
}

function drawEnemy(e) {
    if (!e.alive) return;
    const x = e.x;
    const y = e.y;
    const wobble = e.stun > 0 ? 0 : Math.sin(animTime * 8 + x / 20) * 1.5;
    const stunned = e.stun > 0;
    const top = y - ENEMY_H + wobble;
    ctx.fillStyle = stunned ? '#8e8aa0' : ENEMY_COLORS[e.type];
    ctx.beginPath();
    ctx.roundRect(x - ENEMY_W / 2, top, ENEMY_W, ENEMY_H - 2, e.type === 'egg' ? 9 : 7);
    ctx.fill();

    if (!stunned) {
        if (e.type === 'hotdog') {
            // bun halves top and bottom, with a mustard zigzag down the sausage
            ctx.fillStyle = '#e8b976';
            ctx.fillRect(x - ENEMY_W / 2, top + 3, ENEMY_W, 3);
            ctx.fillRect(x - ENEMY_W / 2, y - 8, ENEMY_W, 3);
            ctx.strokeStyle = '#ffd84d';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const yy = top + 7 + i * 2.6;
                ctx.lineTo(x - 5 + (i % 2) * 10, yy);
            }
            ctx.stroke();
        } else if (e.type === 'egg') {
            ctx.fillStyle = '#f6c445';
            ctx.beginPath();
            ctx.arc(x, y - 8, 4.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = '#4a8c3c';
            ctx.beginPath();
            ctx.arc(x - 5, top + 6, 2, 0, Math.PI * 2);
            ctx.arc(x + 4, top + 11, 2.2, 0, Math.PI * 2);
            ctx.arc(x - 2, y - 7, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // feet
    ctx.fillStyle = '#2b2138';
    ctx.fillRect(x - 7, y - 3, 5, 3);
    ctx.fillRect(x + 2, y - 3, 5, 3);

    // eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - 4, y - ENEMY_H + 8 + wobble, 3.2, 0, Math.PI * 2);
    ctx.arc(x + 4, y - ENEMY_H + 8 + wobble, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1424';
    const look = e.stun > 0 ? 0 : Math.sign(chef.x - x);
    ctx.beginPath();
    ctx.arc(x - 4 + look, y - ENEMY_H + 8 + wobble, 1.5, 0, Math.PI * 2);
    ctx.arc(x + 4 + look, y - ENEMY_H + 8 + wobble, 1.5, 0, Math.PI * 2);
    ctx.fill();

    if (e.stun > 0) {
        ctx.strokeStyle = '#f7b955';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y - ENEMY_H - 4, 5, animTime * 6, animTime * 6 + Math.PI * 1.4);
        ctx.stroke();
    }
}

function drawPeppers() {
    for (const p of peppers) {
        const a = Math.max(0, p.life / PEPPER_LIFE);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8e2f2';
        for (let i = 0; i < 8; i++) {
            const ang = (i / 8) * Math.PI * 2 + animTime * 3;
            const r = 6 + (1 - a) * 14;
            ctx.fillRect(p.x + Math.cos(ang) * r - 1.5, p.y - 12 + Math.sin(ang) * r * 0.7 - 1.5, 3, 3);
        }
        ctx.globalAlpha = 1;
    }
}

function draw() {
    ctx.fillStyle = '#120b1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawLadders();
    drawGirders();
    drawPlates();
    for (const ing of ingredients) drawIngredient(ing);
    for (const e of enemies) drawEnemy(e);
    drawPeppers();
    drawChef();
}

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;
function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    animTime += dt;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const heldKeys = new Set();
const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];
const UP_KEYS = ['ArrowUp', 'w', 'W'];
const DOWN_KEYS = ['ArrowDown', 's', 'S'];
const MOVE_KEYS = [...LEFT_KEYS, ...RIGHT_KEYS, ...UP_KEYS, ...DOWN_KEYS];

function refreshInput() {
    const has = (keys) => keys.some((k) => heldKeys.has(k));
    moveChef(
        (has(RIGHT_KEYS) ? 1 : 0) - (has(LEFT_KEYS) ? 1 : 0),
        (has(DOWN_KEYS) ? 1 : 0) - (has(UP_KEYS) ? 1 : 0)
    );
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') throwPepper();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS.includes(e.key)) {
        heldKeys.add(e.key);
        refreshInput();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshInput();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('burgertime-best') || '0', 10) || 0;
state = 'idle';
score = 0;
level = 1;
lives = START_LIVES;
pepper = START_PEPPER;
buildIngredients();
buildEnemies();
resetActors();
updateHud();
requestAnimationFrame(frame);
