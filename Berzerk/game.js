// ---------------------------------------------------------------------------
// Berzerk — a maze shoot-'em-up on an HTML5 canvas.
//
// The player is dropped into a procedurally generated maze room patrolled by
// robots. Shoot them, dodge their fire, and walk out of one of the four exits
// to reach the next (larger, faster) room. Linger too long and Evil Otto — an
// indestructible bouncing smiley that ignores walls — comes looking for you.
//
// Written as a single classic (non-module) script so the game state and logic
// are reachable from the Playwright tests as plain globals, mirroring Kaboom,
// Dino Run and Snake in this repo. All motion is expressed per-second and
// advanced through `step(dt)`, so tests can simulate frames deterministically
// without depending on requestAnimationFrame wall-clock timing. Every random
// choice comes from a seeded PRNG keyed on the room number, so a given room
// always generates the same maze and the same robot behaviour.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CELL = 32;
const COLS = 20;
const ROWS = 15;
const CANVAS_W = COLS * CELL;   // 640
const CANVAS_H = ROWS * CELL;   // 480

// Border gaps that act as doorways to the neighbouring rooms.
const EXIT_ROWS = [6, 7, 8];    // left / right walls
const EXIT_COLS = [9, 10];      // top / bottom walls

// --- Entities ---
const PLAYER_HALF = 9;
const PLAYER_SPEED = 145;       // px/s
const ROBOT_HALF = 10;
const ROBOT_BASE_SPEED = 52;    // px/s in room 1
const ROBOT_SPEED_STEP = 4;     // px/s added per room
const ROBOT_MAX_SPEED = 110;
const BULLET_SPEED = 340;
const ROBOT_BULLET_SPEED = 210;
const BULLET_HALF = 2;

// --- Rules ---
const START_LIVES = 3;
const ROBOT_POINTS = 50;
const ROOM_BONUS = 100;         // awarded for leaving a room with no robots left
const BASE_ROBOTS = 2;          // robots = BASE_ROBOTS + room, capped
const MAX_ROBOTS = 8;
const MAX_ROBOT_BULLETS = 4;
const FIRE_MIN = 1.4, FIRE_MAX = 3.4;  // seconds between a robot's shots
const OTTO_DELAY = 20;          // seconds in a room before Otto shows up
const OTTO_CLEARED_DELAY = 5;   // ...or this soon once every robot is dead
const OTTO_SPEED = 70;          // Otto drifts in gently...
const OTTO_ACCEL = 22;          // ...and winds up the longer you make him chase
const OTTO_MAX_SPEED = 175;
const OTTO_HALF = 11;

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const roomEl = document.getElementById('room');
const livesEl = document.getElementById('lives');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, lives, room, roomTimer, entrySide, rng;
let walls = blankRoom();
let otto = null;
const player = { x: CANVAS_W / 2, y: CANVAS_H / 2, dx: 0, dy: 0, fx: 1, fy: 0 };
const robots = [];
const bullets = [];
const debris = [];

// ---------------------------------------------------------------------------
// Seeded RNG — every random choice is a pure function of the room number, which
// keeps play reproducible (and the tests reliable).
// ---------------------------------------------------------------------------

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Maze
// ---------------------------------------------------------------------------

function isExitCell(col, row) {
    if ((col === 0 || col === COLS - 1) && EXIT_ROWS.includes(row)) return true;
    if ((row === 0 || row === ROWS - 1) && EXIT_COLS.includes(col)) return true;
    return false;
}

// The ten border cells that lead to a neighbouring room.
function exitCells() {
    const cells = [];
    for (const row of EXIT_ROWS) cells.push([0, row], [COLS - 1, row]);
    for (const col of EXIT_COLS) cells.push([col, 0], [col, ROWS - 1]);
    return cells;
}

// An empty room: solid border, open interior, doorways punched in the border.
function blankRoom() {
    const grid = [];
    for (let r = 0; r < ROWS; r++) {
        const line = [];
        for (let c = 0; c < COLS; c++) {
            const border = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
            line.push(border && !isExitCell(c, r));
        }
        grid.push(line);
    }
    return grid;
}

// Walk the open cells from the room's centre and report which cells are
// reachable — used both to validate a candidate maze and to place robots.
function reachableFrom(grid, startCol, startRow) {
    const seen = new Set([startCol + ',' + startRow]);
    const queue = [[startCol, startRow]];
    while (queue.length) {
        const [c, r] = queue.shift();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
            const key = nc + ',' + nr;
            if (seen.has(key) || grid[nr][nc]) continue;
            seen.add(key);
            queue.push([nc, nr]);
        }
    }
    return seen;
}

// Interior walls are 3-cell segments anchored on a 3x3 lattice, so there is
// always a clear corridor between neighbouring anchors. A candidate layout is
// kept only when every doorway is still reachable from the centre; otherwise
// the next seed is tried.
function generateWalls(roomNumber) {
    const centreCol = Math.floor(COLS / 2);
    const centreRow = Math.floor(ROWS / 2);
    for (let attempt = 0; attempt < 40; attempt++) {
        const rand = mulberry32((Math.imul(roomNumber, 2654435761) + attempt * 7919) >>> 0);
        const grid = blankRoom();
        const density = Math.min(0.6, 0.34 + roomNumber * 0.02);
        for (let c = 3; c <= COLS - 5; c += 3) {
            for (let r = 3; r <= ROWS - 4; r += 3) {
                if (rand() >= density) continue;
                const vertical = rand() < 0.5;
                for (let i = 0; i < 3; i++) {
                    const wc = vertical ? c : c + i;
                    const wr = vertical ? r + i : r;
                    if (wc === centreCol && wr === centreRow) continue; // keep the spawn clear
                    grid[wr][wc] = true;
                }
            }
        }
        const reachable = reachableFrom(grid, centreCol, centreRow);
        if (exitCells().every(([c, r]) => reachable.has(c + ',' + r))) return grid;
    }
    return blankRoom();
}

function isWall(col, row) {
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false; // outside = doorway
    return walls[row][col];
}

function solidAt(x, y) {
    return isWall(Math.floor(x / CELL), Math.floor(y / CELL));
}

// Entity boxes are always smaller than a cell, so the four corners are enough.
function boxHitsWall(x, y, half) {
    return solidAt(x - half, y - half) || solidAt(x + half, y - half) ||
        solidAt(x - half, y + half) || solidAt(x + half, y + half);
}

// Move one axis at a time and snap out of any wall we would have entered.
// Returns true when the entity actually moved.
function moveAxis(e, dx, dy, half) {
    if (dx) {
        const nx = e.x + dx;
        if (!boxHitsWall(nx, e.y, half)) { e.x = nx; return true; }
        const snapped = dx > 0
            ? Math.floor((nx + half) / CELL) * CELL - half - 0.01
            : (Math.floor((nx - half) / CELL) + 1) * CELL + half + 0.01;
        if (!boxHitsWall(snapped, e.y, half)) e.x = snapped;
        return false;
    }
    if (dy) {
        const ny = e.y + dy;
        if (!boxHitsWall(e.x, ny, half)) { e.y = ny; return true; }
        const snapped = dy > 0
            ? Math.floor((ny + half) / CELL) * CELL - half - 0.01
            : (Math.floor((ny - half) / CELL) + 1) * CELL + half + 0.01;
        if (!boxHitsWall(e.x, snapped, half)) e.y = snapped;
        return false;
    }
    return false;
}

function overlaps(a, aHalf, b, bHalf) {
    return Math.abs(a.x - b.x) <= aHalf + bHalf && Math.abs(a.y - b.y) <= aHalf + bHalf;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function robotCountFor(roomNumber) {
    return Math.min(MAX_ROBOTS, BASE_ROBOTS + roomNumber);
}

function robotSpeedFor(roomNumber) {
    return Math.min(ROBOT_MAX_SPEED, ROBOT_BASE_SPEED + (roomNumber - 1) * ROBOT_SPEED_STEP);
}

// `side` names the exit the player just walked through, so they re-enter the
// new room from the opposite wall.
function placePlayer(side) {
    const midRow = EXIT_ROWS[Math.floor(EXIT_ROWS.length / 2)];
    const midCol = EXIT_COLS[0] + 0.5;
    if (side === 'right') { player.x = CELL * 1.5; player.y = (midRow + 0.5) * CELL; }
    else if (side === 'left') { player.x = CANVAS_W - CELL * 1.5; player.y = (midRow + 0.5) * CELL; }
    else if (side === 'bottom') { player.x = midCol * CELL; player.y = CELL * 1.5; }
    else if (side === 'top') { player.x = midCol * CELL; player.y = CANVAS_H - CELL * 1.5; }
    else { player.x = CANVAS_W / 2; player.y = CANVAS_H / 2; }
    player.dx = 0;
    player.dy = 0;
}

function spawnRobot(x, y) {
    const r = {
        x, y,
        speed: robotSpeedFor(room) * (0.85 + rng() * 0.3),
        fireTimer: FIRE_MIN + rng() * (FIRE_MAX - FIRE_MIN),
        wobble: rng() * Math.PI * 2,
    };
    robots.push(r);
    return r;
}

function spawnRobots(count) {
    const playerCol = Math.floor(player.x / CELL);
    const playerRow = Math.floor(player.y / CELL);
    const reachable = reachableFrom(walls, playerCol, playerRow);
    const spots = [];
    for (let r = 1; r < ROWS - 1; r++) {
        for (let c = 1; c < COLS - 1; c++) {
            if (walls[r][c] || !reachable.has(c + ',' + r)) continue;
            if (Math.max(Math.abs(c - playerCol), Math.abs(r - playerRow)) < 5) continue;
            spots.push([c, r]);
        }
    }
    // Seeded Fisher-Yates so the picks are reproducible for a given room.
    for (let i = spots.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    for (let i = 0; i < Math.min(count, spots.length); i++) {
        spawnRobot((spots[i][0] + 0.5) * CELL, (spots[i][1] + 0.5) * CELL);
    }
}

function enterRoom(n, side) {
    room = n;
    entrySide = side || null;
    rng = mulberry32((Math.imul(n, 22695477) + 1013904223) >>> 0);
    walls = generateWalls(n);
    robots.length = 0;
    bullets.length = 0;
    otto = null;
    // Debris deliberately survives the transition so the death explosion that
    // triggered a respawn is still visible for a moment.
    roomTimer = 0;
    placePlayer(entrySide);
    spawnRobots(robotCountFor(n));
    updateHud();
}

// Leaving through a doorway: clearing every robot first pays a bonus.
function exitRoom(side) {
    if (robots.length === 0) score += ROOM_BONUS;
    enterRoom(room + 1, side);
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function setDir(dx, dy) {
    player.dx = dx;
    player.dy = dy;
    if (dx || dy) {
        const len = Math.hypot(dx, dy);
        player.fx = dx / len;
        player.fy = dy / len;
    }
}

// One player bullet may be in flight at a time, as in the arcade original.
function fire() {
    if (state !== 'running') return null;
    if (bullets.some((b) => b.owner === 'player')) return null;
    const b = {
        x: player.x + player.fx * (PLAYER_HALF + 3),
        y: player.y + player.fy * (PLAYER_HALF + 3),
        vx: player.fx * BULLET_SPEED,
        vy: player.fy * BULLET_SPEED,
        owner: 'player',
    };
    bullets.push(b);
    return b;
}

function killPlayer() {
    if (state !== 'running') return;
    spawnDebris(player.x, player.y, '#4ade80');
    lives -= 1;
    if (lives <= 0) {
        lives = 0;
        endGame();
        return;
    }
    enterRoom(room, entrySide); // same room, freshly stocked
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function movePlayer(h) {
    if (player.dx || player.dy) {
        const len = Math.hypot(player.dx, player.dy);
        const vx = (player.dx / len) * PLAYER_SPEED * h;
        const vy = (player.dy / len) * PLAYER_SPEED * h;
        moveAxis(player, vx, 0, PLAYER_HALF);
        moveAxis(player, 0, vy, PLAYER_HALF);
    }
    // Stepping past a border means walking through a doorway.
    if (player.x + PLAYER_HALF >= CANVAS_W) { exitRoom('right'); return false; }
    if (player.x - PLAYER_HALF <= 0) { exitRoom('left'); return false; }
    if (player.y + PLAYER_HALF >= CANVAS_H) { exitRoom('bottom'); return false; }
    if (player.y - PLAYER_HALF <= 0) { exitRoom('top'); return false; }
    return true;
}

function robotFire(r) {
    if (bullets.filter((b) => b.owner === 'robot').length >= MAX_ROBOT_BULLETS) return;
    const dx = player.x - r.x;
    const dy = player.y - r.y;
    // Snap the aim to one of the eight arcade directions.
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const sx = Math.sign(dx), sy = Math.sign(dy);
    let ux, uy;
    if (ax > ay * 2) { ux = sx; uy = 0; }
    else if (ay > ax * 2) { ux = 0; uy = sy; }
    else { ux = sx / Math.SQRT2; uy = sy / Math.SQRT2; }
    if (!ux && !uy) ux = 1;
    bullets.push({
        x: r.x + ux * (ROBOT_HALF + 3),
        y: r.y + uy * (ROBOT_HALF + 3),
        vx: ux * ROBOT_BULLET_SPEED,
        vy: uy * ROBOT_BULLET_SPEED,
        owner: 'robot',
    });
}

function moveRobots(h) {
    for (const r of robots) {
        const dx = player.x - r.x;
        const dy = player.y - r.y;
        const stepX = Math.sign(dx) * r.speed * h;
        const stepY = Math.sign(dy) * r.speed * h;
        // Chase along the dominant axis; fall back to the other when blocked.
        if (Math.abs(dx) >= Math.abs(dy)) {
            if (!moveAxis(r, stepX, 0, ROBOT_HALF)) moveAxis(r, 0, stepY, ROBOT_HALF);
        } else {
            if (!moveAxis(r, 0, stepY, ROBOT_HALF)) moveAxis(r, stepX, 0, ROBOT_HALF);
        }
        r.fireTimer -= h;
        if (r.fireTimer <= 0) {
            robotFire(r);
            r.fireTimer = FIRE_MIN + rng() * (FIRE_MAX - FIRE_MIN);
        }
    }
}

// Returns false when the room changed (or the game ended) mid-update, so the
// caller stops touching arrays that have just been rebuilt.
function moveBullets(h) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx * h;
        b.y += b.vy * h;

        if (b.x < 0 || b.y < 0 || b.x > CANVAS_W || b.y > CANVAS_H || solidAt(b.x, b.y)) {
            bullets.splice(i, 1);
            continue;
        }

        let consumed = false;
        for (let j = robots.length - 1; j >= 0; j--) {
            if (!overlaps(b, BULLET_HALF, robots[j], ROBOT_HALF)) continue;
            spawnDebris(robots[j].x, robots[j].y, '#f87171');
            robots.splice(j, 1);
            // Robots caught in their own crossfire are destroyed but score nothing.
            if (b.owner === 'player') score += ROBOT_POINTS;
            consumed = true;
            break;
        }
        if (consumed) { bullets.splice(i, 1); continue; }

        if (b.owner === 'robot' && overlaps(b, BULLET_HALF, player, PLAYER_HALF)) {
            bullets.splice(i, 1);
            killPlayer();
            return false;
        }
    }
    return true;
}

function spawnOtto() {
    otto = { x: CELL * 1.5, y: CELL * 1.5, bob: 0, speed: OTTO_SPEED };
    return otto;
}

function moveOtto(h) {
    roomTimer += h;
    if (!otto) {
        const delay = robots.length === 0 ? OTTO_CLEARED_DELAY : OTTO_DELAY;
        if (roomTimer >= delay) spawnOtto();
        return true;
    }
    // Otto floats straight at the player, straight through the maze. He starts
    // slower than the player — outrunnable — and winds up until he is not.
    otto.speed = Math.min(OTTO_MAX_SPEED, otto.speed + OTTO_ACCEL * h);
    const dx = player.x - otto.x;
    const dy = player.y - otto.y;
    const len = Math.hypot(dx, dy) || 1;
    otto.x += (dx / len) * otto.speed * h;
    otto.y += (dy / len) * otto.speed * h;
    otto.bob += h * 6;
    if (overlaps(otto, OTTO_HALF, player, PLAYER_HALF)) {
        killPlayer();
        return false;
    }
    return true;
}

function substep(h) {
    if (!movePlayer(h)) return false;
    moveRobots(h);
    for (const r of robots) {
        if (overlaps(r, ROBOT_HALF, player, PLAYER_HALF)) { killPlayer(); return false; }
    }
    if (!moveBullets(h)) return false;
    if (!moveOtto(h)) return false;
    return true;
}

// Advance the simulation by `dt` seconds in small fixed sub-steps so fast
// bullets never tunnel through walls or robots.
function step(dt) {
    if (state !== 'running') return;
    const SUB = 1 / 240;
    let remaining = dt;
    while (remaining > 1e-6) {
        const h = Math.min(SUB, remaining);
        remaining -= h;
        if (!substep(h)) break;
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
    lives = START_LIVES;
    hideOverlay();
    enterRoom(1, null);
}

function endGame() {
    if (state === 'over') return;
    state = 'over';
    if (score > best) {
        best = score;
        try { localStorage.setItem('berzerk-best', String(best)); } catch (e) { /* ignore */ }
    }
    showOverlay('Game Over', 'Score ' + score + ' · Room ' + room, 'Press Space to play again', 'Play Again');
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
    roomEl.textContent = String(room);
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
// Debris (purely cosmetic)
// ---------------------------------------------------------------------------

function spawnDebris(x, y, color) {
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        debris.push({
            x, y, color,
            vx: Math.cos(a) * (60 + (i % 3) * 40),
            vy: Math.sin(a) * (60 + (i % 3) * 40),
            life: 0.45,
        });
    }
}

function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
        const p = debris[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) debris.splice(i, 1);
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawWalls() {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (!walls[r][c]) continue;
            const x = c * CELL, y = r * CELL;
            ctx.fillStyle = '#1d4ed8';
            ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
            ctx.fillStyle = '#3b82f6';
            ctx.fillRect(x + 2, y + 2, CELL - 4, 4);
        }
    }
    // Doorway markers.
    ctx.fillStyle = 'rgba(34, 211, 238, 0.35)';
    for (const [c, r] of exitCells()) {
        const x = c * CELL, y = r * CELL;
        if (c === 0) ctx.fillRect(x, y + 4, 3, CELL - 8);
        else if (c === COLS - 1) ctx.fillRect(x + CELL - 3, y + 4, 3, CELL - 8);
        else if (r === 0) ctx.fillRect(x + 4, y, CELL - 8, 3);
        else ctx.fillRect(x + 4, y + CELL - 3, CELL - 8, 3);
    }
}

function drawPlayer() {
    const { x, y } = player;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(x - 3, y - 10, 6, 7);            // head
    ctx.fillRect(x - 4, y - 3, 8, 8);             // torso
    ctx.fillRect(x - 8, y - 2, 4, 3);             // arms
    ctx.fillRect(x + 4, y - 2, 4, 3);
    ctx.fillRect(x - 6, y + 5, 4, 5);             // legs
    ctx.fillRect(x + 2, y + 5, 4, 5);
    // A muzzle nub showing which way a shot will go.
    ctx.fillStyle = '#bbf7d0';
    ctx.fillRect(x + player.fx * 9 - 2, y + player.fy * 9 - 2, 4, 4);
}

function drawRobot(r) {
    ctx.fillStyle = '#f87171';
    ctx.fillRect(r.x - 7, r.y - 9, 14, 7);        // head
    ctx.fillRect(r.x - 5, r.y - 1, 10, 8);        // body
    ctx.fillRect(r.x - 9, r.y - 1, 4, 3);         // arms
    ctx.fillRect(r.x + 5, r.y - 1, 4, 3);
    ctx.fillRect(r.x - 5, r.y + 7, 3, 3);         // feet
    ctx.fillRect(r.x + 2, r.y + 7, 3, 3);
    ctx.fillStyle = '#fde68a';                    // eyes
    ctx.fillRect(r.x - 4, r.y - 7, 3, 3);
    ctx.fillRect(r.x + 1, r.y - 7, 3, 3);
}

function drawOtto() {
    const bob = Math.sin(otto.bob) * 4;
    const x = otto.x, y = otto.y + bob;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(x, y, OTTO_HALF, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.fillRect(x - 5, y - 4, 3, 3);
    ctx.fillRect(x + 2, y - 4, 3, 3);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y + 1, 6, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
}

function draw() {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawWalls();

    for (const b of bullets) {
        ctx.fillStyle = b.owner === 'player' ? '#bbf7d0' : '#fca5a5';
        ctx.fillRect(b.x - 2, b.y - 2, 5, 5);
    }

    for (const r of robots) drawRobot(r);
    if (otto) drawOtto();
    if (state !== 'idle') drawPlayer();

    for (const p of debris) {
        ctx.globalAlpha = Math.max(0, p.life * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // A gentle warning that Otto is on his way.
    if (state === 'running' && !otto) {
        const delay = robots.length === 0 ? OTTO_CLEARED_DELAY : OTTO_DELAY;
        if (roomTimer > delay - 5) {
            ctx.fillStyle = 'rgba(250, 204, 21, ' + (0.35 + 0.35 * Math.sin(roomTimer * 8)) + ')';
            ctx.font = 'bold 16px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('INTRUDER ALERT', CANVAS_W / 2, 26);
            ctx.textAlign = 'left';
        }
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
    updateDebris(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const MOVE_KEYS = {
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
};
const heldKeys = new Set();

function refreshKeyDir() {
    let dx = 0, dy = 0;
    for (const key of heldKeys) {
        const [kx, ky] = MOVE_KEYS[key];
        dx += kx;
        dy += ky;
    }
    setDir(Math.sign(dx), Math.sign(dy));
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') {
        if (state === 'running' || state === 'paused') { togglePause(); e.preventDefault(); }
        return;
    }
    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'running') fire();
        e.preventDefault();
        return;
    }
    if (MOVE_KEYS[e.key]) {
        heldKeys.add(e.key);
        refreshKeyDir();
        e.preventDefault();
    }
});

window.addEventListener('keyup', (e) => {
    if (heldKeys.has(e.key)) {
        heldKeys.delete(e.key);
        refreshKeyDir();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem('berzerk-best') || '0', 10) || 0;
state = 'idle';
score = 0;
lives = START_LIVES;
room = 1;
roomTimer = 0;
entrySide = null;
rng = mulberry32(1);
updateHud();
requestAnimationFrame(frame);
