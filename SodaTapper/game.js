// ---------------------------------------------------------------------------
// Soda Tapper — a four-lane soda-fountain arcade game.
//
// The player is a soda jerk pinned at the tap end of four parallel bars.
// Thirsty patrons stream in from the far end of each bar; sliding a full mug
// down a bar shoves whoever it hits back toward the door. Push a patron off the
// far end and they leave happy — and slide their empty mug back, which has to
// be caught before it sails off the tap end and shatters.
//
// The whole game is plain globals and free functions on purpose: the Playwright
// specs drive `step(dt)` by hand and read the state directly, so nothing is
// hidden behind a module scope.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const WIDTH = 640;
const HEIGHT = 480;

const LANES = 4;
const BAR_TOP = 62;          // top of the first bar's strip
const LANE_H = 100;          // vertical space each bar occupies
const BAR_LEFT = 40;         // far (door) end of every bar
const BAR_RIGHT = 600;       // tap end of every bar
const TAP_X = 586;           // where a poured mug enters the bar
const GRAB_X = 570;          // a patron this far along grabs the soda jerk
const CATCH_X = 560;         // an empty mug can be caught from here on
const BREAK_X = 600;         // ...and shatters past here
const ENTRY_X = BAR_LEFT + 14;

const BARTENDER_X = 596;

const PATRON_W = 26;
const PATRON_H = 46;
const MUG_W = 18;
const MUG_H = 20;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const START_LIVES = 3;
const MUG_SPEED = 260;       // full mug sliding away from the tap
const EMPTY_SPEED = 200;     // empty mug sliding back toward the tap
const SLIDE_SPEED = 170;     // patron being shoved back by a mug
const SLIDE_DIST = 110;      // how far one mug shoves a patron
const DRINK_TIME = 0.7;      // pause after a patron finishes a soda
const PATRON_BASE_SPEED = 40;
const PATRON_LEVEL_SPEED = 9;
const SPAWN_BASE = 2.6;      // seconds between arrivals on level 1
const SPAWN_MIN = 0.9;
const FIRST_SPAWN = 1.2;
const RESPAWN_DELAY = 1.4;   // quiet beat after losing a life
const SCORE_SERVE = 100;
const SCORE_CATCH = 50;
const LEVEL_BONUS = 250;
const BEST_KEY = 'sodatapper-best';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const elScore = document.getElementById('score');
const elLevel = document.getElementById('level');
const elLives = document.getElementById('lives');
const elServed = document.getElementById('served');
const elBest = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

let state = 'idle';          // idle | running | paused | over
let score = 0;
let best = 0;
let lives = START_LIVES;
let level = 1;
let served = 0;              // patrons sent home this level
let levelTarget = 8;
let spawnEnabled = true;
let spawnTimer = FIRST_SPAWN;
let flash = 0;               // red screen pulse after losing a life
let banner = null;           // { text, time } shown mid-canvas on level up
let clock = 0;               // drives idle animation of the scenery

const bartender = { lane: 0, x: BARTENDER_X, y: 0, pour: 0, catchGlow: 0 };
const patrons = [];
const mugs = [];             // full mugs travelling left
const empties = [];          // empty mugs travelling right
const splashes = [];         // short-lived puddles / sparkles

function laneY(i) {
    return BAR_TOP + LANE_H * i + LANE_H / 2;
}

function patronSpeed() {
    return PATRON_BASE_SPEED + (level - 1) * PATRON_LEVEL_SPEED;
}

function spawnInterval() {
    return Math.max(SPAWN_MIN, SPAWN_BASE - (level - 1) * 0.22);
}

function targetForLevel(n) {
    return 6 + n * 2;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

function makePatron(lane) {
    return {
        lane,
        x: ENTRY_X,
        mode: 'walking',     // walking | sliding | drinking
        slideLeft: 0,
        drinkLeft: 0,
        drinks: 0,
        bob: Math.random() * Math.PI * 2,
    };
}

function laneBusy(lane) {
    return patrons.some((p) => p.lane === lane);
}

function spawnPatron(lane) {
    if (lane < 0 || lane >= LANES || laneBusy(lane)) return null;
    const p = makePatron(lane);
    patrons.push(p);
    return p;
}

function spawnEmpty(lane) {
    const mug = { lane, x: ENTRY_X, wobble: 0 };
    empties.push(mug);
    return mug;
}

function serve() {
    if (state !== 'running') return null;
    const mug = { lane: bartender.lane, x: TAP_X, foam: 1 };
    mugs.push(mug);
    bartender.pour = 0.18;
    return mug;
}

function addSplash(x, y, color) {
    splashes.push({ x, y, color, life: 0.5 });
}

// ---------------------------------------------------------------------------
// Score / HUD
// ---------------------------------------------------------------------------

function addScore(points) {
    score += points;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem(BEST_KEY, String(best));
        } catch (err) {
            /* private mode — best score simply isn't persisted */
        }
    }
    updateHud();
}

function updateHud() {
    elScore.textContent = String(score);
    elLevel.textContent = String(level);
    elLives.textContent = String(Math.max(0, lives));
    elServed.textContent = `${Math.min(served, levelTarget)}/${levelTarget}`;
    elBest.textContent = String(best);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.textContent = scoreLine;
    overlaySub.textContent = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function clearBar() {
    patrons.length = 0;
    mugs.length = 0;
    empties.length = 0;
}

function startGame() {
    score = 0;
    lives = START_LIVES;
    level = 1;
    served = 0;
    levelTarget = targetForLevel(level);
    spawnEnabled = true;
    spawnTimer = FIRST_SPAWN;
    flash = 0;
    banner = null;
    splashes.length = 0;
    clearBar();
    bartender.lane = 0;
    bartender.x = BARTENDER_X;
    bartender.y = laneY(0);
    bartender.pour = 0;
    bartender.catchGlow = 0;
    state = 'running';
    hideOverlay();
    updateHud();
}

function nextLevel() {
    level += 1;
    served = 0;
    levelTarget = targetForLevel(level);
    spawnTimer = RESPAWN_DELAY;
    addScore(LEVEL_BONUS);
    banner = { text: `LEVEL ${level}`, time: 1.4 };
    updateHud();
}

function loseLife() {
    lives -= 1;
    flash = 0.6;
    clearBar();
    spawnTimer = RESPAWN_DELAY;
    updateHud();
    if (lives <= 0) {
        gameOver();
    }
}

function gameOver() {
    state = 'over';
    lives = 0;
    updateHud();
    showOverlay(
        'GAME OVER',
        `Score ${score}  •  Level ${level}  •  Best ${best}`,
        'Press Space to play again'
    );
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('PAUSED', `Score ${score}`, 'Press P to resume');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function stepSpawning(dt) {
    if (!spawnEnabled) return;
    // Never queue up more customers than the level still needs.
    if (served + patrons.length >= levelTarget) return;
    spawnTimer -= dt;
    if (spawnTimer > 0) return;
    spawnTimer = spawnInterval();
    const free = [];
    for (let i = 0; i < LANES; i++) if (!laneBusy(i)) free.push(i);
    if (free.length === 0) return;
    spawnPatron(free[Math.floor(Math.random() * free.length)]);
}

function stepPatrons(dt) {
    for (let i = patrons.length - 1; i >= 0; i--) {
        const p = patrons[i];
        p.bob += dt * 6;
        if (p.mode === 'walking') {
            p.x += patronSpeed() * dt;
            if (p.x >= GRAB_X) {
                addSplash(GRAB_X, laneY(p.lane), '#ff6b6b');
                loseLife();
                return;
            }
        } else if (p.mode === 'sliding') {
            const move = SLIDE_SPEED * dt;
            p.x -= move;
            p.slideLeft -= move;
            if (p.x <= BAR_LEFT) {
                // Sent home happy: score, and they shove their empty back.
                patrons.splice(i, 1);
                served += 1;
                addScore(SCORE_SERVE * level);
                addSplash(BAR_LEFT + 10, laneY(p.lane), '#4fd1c5');
                // A departing patron takes any sodas still sliding down their
                // bar with them. Without this the player is punished for mugs
                // that were already in flight when the last one did the job —
                // something they cannot un-pour.
                for (let m = mugs.length - 1; m >= 0; m--) {
                    if (mugs[m].lane === p.lane) {
                        addSplash(mugs[m].x, laneY(p.lane), '#4fd1c5');
                        mugs.splice(m, 1);
                    }
                }
                spawnEmpty(p.lane);
                updateHud();
                continue;
            }
            if (p.slideLeft <= 0) {
                p.mode = 'drinking';
                p.drinkLeft = DRINK_TIME;
            }
        } else {
            p.drinkLeft -= dt;
            if (p.drinkLeft <= 0) p.mode = 'walking';
        }
    }
}

function stepMugs(dt) {
    for (let i = mugs.length - 1; i >= 0; i--) {
        const mug = mugs[i];
        mug.x -= MUG_SPEED * dt;
        const hit = patrons.find(
            (p) =>
                p.lane === mug.lane &&
                mug.x - MUG_W / 2 <= p.x + PATRON_W / 2 &&
                mug.x + MUG_W / 2 >= p.x - PATRON_W / 2
        );
        if (hit) {
            mugs.splice(i, 1);
            hit.drinks += 1;
            hit.mode = 'sliding';
            hit.slideLeft = SLIDE_DIST;
            addSplash(hit.x, laneY(hit.lane) - 12, '#ffd166');
            continue;
        }
        if (mug.x <= BAR_LEFT) {
            addSplash(BAR_LEFT, laneY(mug.lane), '#ff6b6b');
            mugs.splice(i, 1);
            loseLife();
            return;
        }
    }
}

function stepEmpties(dt) {
    for (let i = empties.length - 1; i >= 0; i--) {
        const mug = empties[i];
        mug.x += EMPTY_SPEED * dt;
        mug.wobble += dt * 12;
        if (mug.x >= CATCH_X && bartender.lane === mug.lane) {
            empties.splice(i, 1);
            addScore(SCORE_CATCH);
            bartender.catchGlow = 0.4;
            addSplash(mug.x, laneY(mug.lane) - 10, '#4fd1c5');
            continue;
        }
        if (mug.x >= BREAK_X) {
            empties.splice(i, 1);
            addSplash(BREAK_X, laneY(mug.lane), '#ff6b6b');
            loseLife();
            return;
        }
    }
}

function stepEffects(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (bartender.pour > 0) bartender.pour = Math.max(0, bartender.pour - dt);
    if (bartender.catchGlow > 0) bartender.catchGlow = Math.max(0, bartender.catchGlow - dt);
    if (banner) {
        banner.time -= dt;
        if (banner.time <= 0) banner = null;
    }
    for (let i = splashes.length - 1; i >= 0; i--) {
        splashes[i].life -= dt;
        if (splashes[i].life <= 0) splashes.splice(i, 1);
    }
}

function step(dt) {
    clock += dt;
    if (state !== 'running') return;
    bartender.y = laneY(bartender.lane);
    stepSpawning(dt);
    stepPatrons(dt);
    if (state !== 'running') return;
    stepMugs(dt);
    if (state !== 'running') return;
    stepEmpties(dt);
    if (state !== 'running') return;
    stepEffects(dt);
    if (
        served >= levelTarget &&
        patrons.length === 0 &&
        mugs.length === 0 &&
        empties.length === 0
    ) {
        nextLevel();
    }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#241d42');
    sky.addColorStop(1, '#120e22');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Neon sign over the fountain.
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#4fd1c5';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('SODA FOUNTAIN', 24, 36);
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 209, 102, 0.5)';
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('OPEN LATE', WIDTH - 24, 34);
    ctx.textAlign = 'left';

    // Doorway the patrons come through, on the far side of the bars.
    ctx.fillStyle = '#171230';
    ctx.fillRect(0, BAR_TOP - 8, BAR_LEFT - 8, HEIGHT - BAR_TOP);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.10)';
    ctx.fillRect(3, BAR_TOP, BAR_LEFT - 14, HEIGHT - BAR_TOP - 12);
    ctx.save();
    ctx.translate(15, HEIGHT / 2 + 20);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255, 209, 102, 0.45)';
    ctx.font = 'bold 12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('◄ THIRSTY CUSTOMERS', 0, 4);
    ctx.restore();
    ctx.textAlign = 'left';
}

// A soft ellipse so figures sit on the bar instead of floating over it.
function drawShadow(x, y, w) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y, w, w * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
}

function drawBar(i) {
    const y = laneY(i);
    const top = y + 12;

    // Alcove behind each bar, so the four lanes read as separate counters.
    const alcove = ctx.createLinearGradient(0, top - LANE_H + 24, 0, top);
    alcove.addColorStop(0, 'rgba(255, 255, 255, 0.015)');
    alcove.addColorStop(1, 'rgba(79, 209, 197, 0.07)');
    ctx.fillStyle = alcove;
    ctx.fillRect(BAR_LEFT - 12, top - LANE_H + 26, BAR_RIGHT - BAR_LEFT + 30, LANE_H - 26);

    // Back wall trim line.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(BAR_LEFT - 12, top - LANE_H + 26, BAR_RIGHT - BAR_LEFT + 30, 2);

    // Bar top surface.
    const wood = ctx.createLinearGradient(0, top, 0, top + 20);
    wood.addColorStop(0, '#a56a3c');
    wood.addColorStop(1, '#5d3a20');
    ctx.fillStyle = wood;
    roundRect(BAR_LEFT - 12, top, BAR_RIGHT - BAR_LEFT + 30, 18, 6);
    ctx.fill();

    // Polished highlight along the rail.
    ctx.fillStyle = 'rgba(255, 236, 200, 0.22)';
    ctx.fillRect(BAR_LEFT - 8, top + 2, BAR_RIGHT - BAR_LEFT + 22, 3);

    // Shadow under the bar.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(BAR_LEFT - 12, top + 18, BAR_RIGHT - BAR_LEFT + 30, 6);

    // Lane number chip at the tap end.
    ctx.fillStyle = 'rgba(79, 209, 197, 0.18)';
    roundRect(BAR_RIGHT + 6, top - 14, 22, 16, 5);
    ctx.fill();
    ctx.fillStyle = '#9fe8e0';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), BAR_RIGHT + 17, top - 2);
    ctx.textAlign = 'left';
}

function drawTapStation() {
    ctx.fillStyle = '#1d1836';
    ctx.fillRect(BAR_RIGHT + 32, BAR_TOP - 10, WIDTH - BAR_RIGHT - 32, HEIGHT - BAR_TOP + 10);
    ctx.fillStyle = 'rgba(79, 209, 197, 0.12)';
    ctx.fillRect(BAR_RIGHT + 32, BAR_TOP - 10, 3, HEIGHT - BAR_TOP + 10);
}

function drawMug(x, y, full, grounded = true) {
    const w = MUG_W;
    const h = MUG_H;
    if (grounded) drawShadow(x, y + 1, 10);
    ctx.fillStyle = full ? '#3b2a1c' : '#2a2542';
    roundRect(x - w / 2, y - h, w, h, 3);
    ctx.fill();

    if (full) {
        ctx.fillStyle = '#c8722f';
        ctx.fillRect(x - w / 2 + 2, y - h + 6, w - 4, h - 8);
        ctx.fillStyle = '#fff4e0';
        ctx.fillRect(x - w / 2 + 2, y - h + 2, w - 4, 5);
    } else {
        ctx.strokeStyle = 'rgba(200, 220, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - w / 2 + 2, y - h + 3, w - 4, h - 6);
    }

    // Handle.
    ctx.strokeStyle = full ? '#8a5a33' : '#5a5480';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + w / 2 + 1, y - h / 2 - 1, 4.5, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
}

function drawPatron(p) {
    const y = laneY(p.lane);
    const feet = y + 14;
    const bob = p.mode === 'walking' ? Math.sin(p.bob) * 1.5 : 0;
    const top = feet - PATRON_H + bob;
    const palette = ['#ef8354', '#8bd3dd', '#e4b363', '#c490d1'];
    const color = palette[p.lane % palette.length];

    drawShadow(p.x, feet + 1, 14);

    // Legs.
    ctx.fillStyle = '#2c2740';
    ctx.fillRect(p.x - 8, feet - 14, 6, 14);
    ctx.fillRect(p.x + 2, feet - 14, 6, 14);

    // Body.
    ctx.fillStyle = color;
    roundRect(p.x - PATRON_W / 2, top + 14, PATRON_W, PATRON_H - 28, 5);
    ctx.fill();

    // Head.
    ctx.fillStyle = '#f6d7b0';
    ctx.beginPath();
    ctx.arc(p.x, top + 8, 9, 0, Math.PI * 2);
    ctx.fill();

    // Hat brim — every good patron wears one.
    ctx.fillStyle = '#3a3357';
    ctx.fillRect(p.x - 11, top + 1, 22, 3);
    ctx.fillRect(p.x - 7, top - 5, 14, 6);

    // Mood: sliding patrons hold a drink, walking ones reach forward.
    if (p.mode === 'sliding' || p.mode === 'drinking') {
        drawMug(p.x + 12, top + 26, true, false);
    } else {
        ctx.fillStyle = color;
        ctx.fillRect(p.x + PATRON_W / 2 - 2, top + 18, 10, 5);
    }

    if (p.drinks > 0) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('•'.repeat(Math.min(p.drinks, 4)), p.x, top - 10);
        ctx.textAlign = 'left';
    }
}

function drawBartender() {
    const y = bartender.y || laneY(bartender.lane);
    const feet = y + 14;
    const top = feet - 50;

    if (bartender.catchGlow > 0) {
        ctx.fillStyle = `rgba(79, 209, 197, ${0.35 * (bartender.catchGlow / 0.4)})`;
        ctx.beginPath();
        ctx.arc(bartender.x, feet - 24, 32, 0, Math.PI * 2);
        ctx.fill();
    }

    drawShadow(bartender.x, feet + 1, 15);

    // Soda tap tower on the counter beside the jerk.
    ctx.fillStyle = '#cfd6e6';
    ctx.fillRect(bartender.x - 26, feet - 34, 6, 24);
    ctx.fillRect(bartender.x - 30, feet - 36, 14, 5);
    if (bartender.pour > 0) {
        ctx.fillStyle = '#ffb457';
        ctx.fillRect(bartender.x - 25, feet - 12, 4, 10);
    }

    // Legs, apron, head.
    ctx.fillStyle = '#2c2740';
    ctx.fillRect(bartender.x - 8, feet - 14, 6, 14);
    ctx.fillRect(bartender.x + 2, feet - 14, 6, 14);

    ctx.fillStyle = '#f4f7ff';
    roundRect(bartender.x - 13, top + 14, 26, 24, 5);
    ctx.fill();
    ctx.fillStyle = '#4fd1c5';
    ctx.fillRect(bartender.x - 13, top + 30, 26, 8);

    ctx.fillStyle = '#f6d7b0';
    ctx.beginPath();
    ctx.arc(bartender.x, top + 8, 9, 0, Math.PI * 2);
    ctx.fill();

    // Paper hat.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bartender.x - 10, top - 3, 20, 5);
    ctx.fillRect(bartender.x - 7, top - 8, 14, 6);

    // Serving arm reaching down the bar.
    ctx.fillStyle = '#f4f7ff';
    ctx.fillRect(bartender.x - 22, top + 18, 10, 5);
}

function drawSplashes() {
    for (const s of splashes) {
        const a = Math.max(0, s.life / 0.5);
        ctx.fillStyle = s.color;
        ctx.globalAlpha = a;
        for (let i = 0; i < 4; i++) {
            const angle = (i / 4) * Math.PI * 2 + s.life * 6;
            const r = (1 - a) * 16 + 4;
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(angle) * r, s.y + Math.sin(angle) * r * 0.6, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function drawBanner() {
    if (!banner) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, banner.time / 0.5);
    ctx.fillStyle = 'rgba(12, 10, 22, 0.75)';
    roundRect(WIDTH / 2 - 90, HEIGHT / 2 - 28, 180, 56, 12);
    ctx.fill();
    ctx.fillStyle = '#4fd1c5';
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(banner.text, WIDTH / 2, HEIGHT / 2 + 9);
    ctx.textAlign = 'left';
    ctx.restore();
}

function draw() {
    drawBackground();
    for (let i = 0; i < LANES; i++) drawBar(i);
    drawTapStation();

    for (const p of patrons) drawPatron(p);
    for (const mug of mugs) drawMug(mug.x, laneY(mug.lane) + 12, true);
    for (const mug of empties) {
        drawMug(mug.x, laneY(mug.lane) + 12 + Math.sin(mug.wobble) * 1.5, false);
    }

    drawBartender();
    drawSplashes();
    drawBanner();

    if (flash > 0) {
        ctx.fillStyle = `rgba(255, 80, 80, ${0.35 * (flash / 0.6)})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }

    if (state === 'idle') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '13px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
            'Keep the sodas coming — and catch the empties',
            WIDTH / 2,
            HEIGHT - 18 + Math.sin(clock * 2) * 2
        );
        ctx.textAlign = 'left';
    }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function moveLane(delta) {
    if (state !== 'running') return;
    const next = bartender.lane + delta;
    if (next < 0 || next >= LANES) return;
    bartender.lane = next;
    bartender.y = laneY(next);
}

window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key;

    if (key === 'p' || key === 'P') {
        if (state === 'running' || state === 'paused') togglePause();
        e.preventDefault();
        return;
    }

    if (key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }

    if (key === ' ' || e.code === 'Space') {
        if (state === 'running') serve();
        else if (state === 'idle' || state === 'over') startGame();
        e.preventDefault();
        return;
    }

    if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        moveLane(-1);
        e.preventDefault();
        return;
    }

    if (key === 'ArrowDown' || key === 's' || key === 'S') {
        moveLane(1);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
});

canvas.addEventListener('click', (e) => {
    if (state !== 'running') return;
    // Clicking a bar both moves the jerk there and pours a soda — handy on
    // touch screens where there is no keyboard.
    const rect = canvas.getBoundingClientRect();
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    const lane = Math.max(0, Math.min(LANES - 1, Math.floor((y - BAR_TOP) / LANE_H)));
    bartender.lane = lane;
    bartender.y = laneY(lane);
    serve();
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let lastTime = 0;

function frame(now) {
    const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
levelTarget = targetForLevel(level);
bartender.y = laneY(0);
updateHud();
showOverlay('SODA TAPPER', '', 'Press Space or click Start to play');
requestAnimationFrame(frame);
