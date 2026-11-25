// ---------------------------------------------------------------------------
// Faithful Scribe — a typing arcade game on an HTML5 canvas (Jeremiah 36:2).
//
// Scrolls drift down toward the scribe's desk, each carrying one word of
// Scripture. Type a word to copy the scroll; a scroll that lands un-copied
// snuffs out a candle. Written as a single classic (non-module) script so the
// game state and logic are reachable from the Playwright tests as plain
// globals, like the other games in this repo. All motion is expressed per
// second and advanced through `step(dt)`, so tests can simulate frames
// deterministically without depending on requestAnimationFrame wall-clock
// timing.
// ---------------------------------------------------------------------------

// --- World geometry ---
const CANVAS_W = 640;
const CANVAS_H = 420;
const BASELINE_Y = CANVAS_H - 70;   // top of the desk: a scroll touching it has landed
const SCROLL_H = 34;
const ROLL_H = 30;                  // the rolled end-caps of the parchment
const SCROLL_PAD = 18;              // parchment margin either side of the word
const MIN_SCROLL_W = 76;
const DANGER_BAND = 80;             // px above the desk where a scroll glows red
const EDGE_MARGIN = 8;
const WORD_FONT = '600 17px "Courier New", ui-monospace, monospace';

// --- Rules ---
const START_CANDLES = 3;
const MAX_CANDLES = 5;
const MAX_SCROLLS = 7;
const WORDS_PER_CHAPTER = 8;
const POINTS_PER_LETTER = 10;
const MAX_MULTIPLIER = 5;
const COMBO_PER_STEP = 5;           // words per streak step of the multiplier

// --- Difficulty curve (all pure functions of the chapter) ---
const FALL_BASE = 36, FALL_STEP = 7;          // px/s
const SPAWN_BASE = 2.4, SPAWN_STEP = 0.15, SPAWN_MIN = 0.9; // seconds between scrolls

// --- The words of the scroll: people, places and virtues of Scripture ---
const WORDS = [
    'faith', 'hope', 'love', 'grace', 'mercy', 'truth', 'light', 'peace', 'joy',
    'psalm', 'altar', 'manna', 'cedar', 'olive', 'lamb', 'dove', 'bread', 'water',
    'stone', 'crown', 'seed', 'vine', 'lamp', 'oil', 'ark', 'salt', 'gift', 'song',
    'rock', 'well', 'path', 'robe', 'harp', 'reed', 'myrrh', 'glory', 'honour',
    'prayer', 'temple', 'manger', 'scribe', 'scroll', 'quill', 'sandal', 'sabbath',
    'wisdom', 'kindness', 'patience', 'goodness', 'gentleness', 'blessing',
    'promise', 'covenant', 'worship', 'offering', 'incense', 'harvest', 'vineyard',
    'sparrow', 'mustard', 'parable', 'disciple', 'apostle', 'shepherd', 'pasture',
    'fountain', 'firmament', 'tabernacle', 'wilderness', 'commandment',
    'forgiveness', 'thanksgiving', 'faithfulness', 'lovingkindness',
    'righteousness', 'resurrection', 'inheritance', 'everlasting', 'cornerstone',
    'frankincense', 'hallelujah', 'righteous', 'redeemer', 'Emmanuel', 'Passover',
    'Jerusalem', 'Bethlehem', 'Nazareth', 'Galilee', 'Jericho', 'Bethany', 'Jordan',
    'Carmel', 'Hebron', 'Sinai', 'Judah', 'Zion', 'Shiloh', 'Gilead', 'Horeb',
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const chapterEl = document.getElementById('chapter');
const comboEl = document.getElementById('combo');
const candlesEl = document.getElementById('candles');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');
const typingInput = document.getElementById('typing-input');

// --- State ---
// state: 'idle' | 'running' | 'paused' | 'over'
let state, score, best, combo, candles, chapter, copied, spawnTimer;
let lockIndex = -1;          // index into `scrolls` of the scroll being copied
const scrolls = [];          // { word, typed, x, y, w, speed }
const particles = [];        // ink splashes and sparks, decoration only
let banner = null;           // { text, life } — a fading chapter announcement

// ---------------------------------------------------------------------------
// Seeded randomness (mulberry32), so a test can fix the seed and get the same
// scrolls on every run.
// ---------------------------------------------------------------------------

let seed = (Date.now() ^ 0x9e3779b9) >>> 0;

function setSeed(n) {
    seed = n >>> 0;
}

function rand() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function multiplier(c) {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(c / COMBO_PER_STEP));
}

function wordScore(word, c) {
    return word.length * POINTS_PER_LETTER * multiplier(c);
}

function maxLen(ch) {
    return Math.min(20, 4 + 2 * ch);
}

function fallSpeed(ch) {
    return FALL_BASE + FALL_STEP * (ch - 1);
}

function spawnInterval(ch) {
    return Math.max(SPAWN_MIN, SPAWN_BASE - SPAWN_STEP * (ch - 1));
}

// Choose the next word: short enough for this chapter and, where possible,
// starting with a letter no scroll in the sky is already using, so the first
// keystroke is never ambiguous.
function pickWord() {
    const limit = maxLen(chapter);
    const pool = WORDS.filter((w) => w.length <= limit);
    const taken = new Set(scrolls.map((s) => s.word[0].toLowerCase()));
    const free = pool.filter((w) => !taken.has(w[0].toLowerCase()));
    const from = free.length ? free : pool;
    return from[Math.floor(rand() * from.length)];
}

function scrollWidth(word) {
    ctx.font = WORD_FONT;
    return Math.max(MIN_SCROLL_W, ctx.measureText(word).width + 2 * SCROLL_PAD);
}

// ---------------------------------------------------------------------------
// Scrolls
// ---------------------------------------------------------------------------

function spawnScroll(word) {
    const w = word || pickWord();
    const width = scrollWidth(w);
    const span = Math.max(0, CANVAS_W - width - 2 * EDGE_MARGIN);
    const s = {
        word: w,
        typed: 0,
        x: EDGE_MARGIN + rand() * span,
        y: -SCROLL_H,
        w: width,
        speed: fallSpeed(chapter),
    };
    scrolls.push(s);
    return s;
}

function removeScroll(i) {
    scrolls.splice(i, 1);
    if (lockIndex === i) lockIndex = -1;
    else if (lockIndex > i) lockIndex--;
}

// A scroll reached the desk: a candle goes out and the streak is broken.
function landScroll(i) {
    const s = scrolls[i];
    inkSplash(s.x + s.w / 2, BASELINE_Y, '#1f1a12', 16);
    removeScroll(i);
    combo = 0;
    candles = Math.max(0, candles - 1);
    updateHud();
    if (candles === 0) endDay();
}

function completeScroll(i) {
    const s = scrolls[i];
    score += wordScore(s.word, combo);
    combo++;
    copied++;
    inkSplash(s.x + s.w / 2, s.y + SCROLL_H / 2, '#fbbf24', 14);
    removeScroll(i);
    if (copied >= WORDS_PER_CHAPTER) nextChapter();
    updateHud();
}

function nextChapter() {
    chapter++;
    copied = 0;
    if (candles < MAX_CANDLES) candles++;
    banner = { text: `Chapter ${chapter}`, life: 1.8 };
}

// ---------------------------------------------------------------------------
// Simulation. Every motion in the game passes through here.
// ---------------------------------------------------------------------------

function step(dt) {
    if (state !== 'running') return;

    for (const s of scrolls) s.y += s.speed * dt;

    for (let i = scrolls.length - 1; i >= 0; i--) {
        if (scrolls[i].y + SCROLL_H >= BASELINE_Y) landScroll(i);
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
        if (scrolls.length < MAX_SCROLLS) spawnScroll();
        spawnTimer = spawnInterval(chapter);
    }
}

function updateParticles(dt) {
    if (banner) {
        banner.life -= dt;
        if (banner.life <= 0) banner = null;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 220 * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function inkSplash(x, y, colour, n) {
    for (let i = 0; i < n; i++) {
        particles.push({
            x, y,
            vx: (rand() - 0.5) * 150,
            vy: -rand() * 110,
            life: 0.35 + rand() * 0.35,
            colour,
        });
    }
}

// ---------------------------------------------------------------------------
// Typing — the single entry point for a letter, however it was entered.
// Returns 'lock'    the keystroke started a fresh scroll,
//         'hit'     it copied the next letter of the locked scroll,
//         'word'    it finished the word,
//         'blot'    it was the wrong letter (the streak breaks),
//         'ignored' it meant nothing just now.
// ---------------------------------------------------------------------------

function typeChar(ch) {
    if (state !== 'running') return 'ignored';
    if (typeof ch !== 'string' || !/^[a-z]$/i.test(ch)) return 'ignored';
    const c = ch.toLowerCase();

    if (lockIndex < 0) {
        let pick = -1;
        for (let i = 0; i < scrolls.length; i++) {
            const s = scrolls[i];
            const need = s.word[s.typed];
            if (!need || need.toLowerCase() !== c) continue;
            if (pick < 0 || s.y > scrolls[pick].y) pick = i; // the lowest is the most urgent
        }
        if (pick < 0) return 'ignored';
        const fresh = scrolls[pick].typed === 0;
        lockIndex = pick;
        return advance(pick, fresh ? 'lock' : 'hit');
    }

    const s = scrolls[lockIndex];
    if (s.word[s.typed].toLowerCase() !== c) {
        combo = 0;
        inkSplash(s.x + s.w / 2, s.y + SCROLL_H, '#7f1d1d', 7);
        updateHud();
        return 'blot';
    }
    return advance(lockIndex, 'hit');
}

function advance(i, kind) {
    const s = scrolls[i];
    s.typed++;
    if (s.typed >= s.word.length) {
        completeScroll(i);
        return 'word';
    }
    return kind;
}

function releaseLock() {
    lockIndex = -1;
}

// ---------------------------------------------------------------------------
// Run control
// ---------------------------------------------------------------------------

function startGame() {
    state = 'running';
    score = 0;
    combo = 0;
    candles = START_CANDLES;
    chapter = 1;
    copied = 0;
    scrolls.length = 0;
    particles.length = 0;
    banner = null;
    lockIndex = -1;
    spawnScroll();
    spawnTimer = spawnInterval(chapter);
    hideOverlay();
    updateHud();
}

function togglePause() {
    if (state === 'running') {
        state = 'paused';
        showOverlay('Paused', '', 'Press <kbd>Esc</kbd> to carry on');
    } else if (state === 'paused') {
        state = 'running';
        hideOverlay();
    }
}

function endDay() {
    state = 'over';
    lockIndex = -1;
    if (score > best) {
        best = score;
        try {
            localStorage.setItem('faithful-scribe-best', String(best));
        } catch (e) {
            /* private browsing: the best score simply is not kept */
        }
    }
    updateHud();
    showOverlay(
        'The day is done',
        `${score} points &middot; chapter ${chapter}`,
        'Press <kbd>Space</kbd> for a new day'
    );
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    chapterEl.textContent = String(chapter);
    comboEl.textContent = String(combo);
    candlesEl.textContent = String(candles);
}

function showOverlay(title, scoreLine, sub) {
    overlayTitle.textContent = title;
    overlayScore.innerHTML = scoreLine;
    overlaySub.innerHTML = sub;
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Rendering. Reads state, never changes it.
// ---------------------------------------------------------------------------

function draw() {
    // The scriptorium: warm stone lit by candlelight.
    const wall = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    wall.addColorStop(0, '#2b1d0f');
    wall.addColorStop(1, '#140d06');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.strokeStyle = 'rgba(255, 226, 170, 0.045)';
    ctx.lineWidth = 1;
    for (let x = 40; x < CANVAS_W; x += 80) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, BASELINE_Y);
        ctx.stroke();
    }

    const glow = ctx.createRadialGradient(CANVAS_W / 2, BASELINE_Y, 10, CANVAS_W / 2, BASELINE_Y, 300);
    glow.addColorStop(0, 'rgba(251, 191, 36, 0.16)');
    glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    drawDesk();
    for (const s of scrolls) drawScroll(s);

    if (banner) {
        ctx.globalAlpha = Math.max(0, Math.min(1, banner.life));
        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 34px Georgia, "Times New Roman", serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(banner.text, CANVAS_W / 2, CANVAS_H / 2 - 40);
        ctx.globalAlpha = 1;
    }

    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        ctx.fillStyle = p.colour;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
}

function drawDesk() {
    // The desk top, with the line a scroll must not cross.
    ctx.fillStyle = '#5a3a1c';
    ctx.fillRect(0, BASELINE_Y, CANVAS_W, CANVAS_H - BASELINE_Y);
    ctx.fillStyle = '#7b5125';
    ctx.fillRect(0, BASELINE_Y, CANVAS_W, 6);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, BASELINE_Y + 0.5);
    ctx.lineTo(CANVAS_W, BASELINE_Y + 0.5);
    ctx.stroke();

    // The open codex the scribe is copying into.
    const bx = CANVAS_W / 2 - 70, by = BASELINE_Y + 18;
    ctx.fillStyle = '#efe0c0';
    ctx.fillRect(bx, by, 140, 36);
    ctx.fillStyle = '#d9c59c';
    ctx.fillRect(bx + 68, by, 4, 36);
    ctx.strokeStyle = '#b9a27a';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
        const ly = by + i * 9;
        ctx.beginPath();
        ctx.moveTo(bx + 8, ly);
        ctx.lineTo(bx + 62, ly);
        ctx.moveTo(bx + 78, ly);
        ctx.lineTo(bx + 132, ly);
        ctx.stroke();
    }

    // Inkwell and quill on the left of the desk.
    ctx.fillStyle = '#231a10';
    ctx.beginPath();
    ctx.ellipse(54, BASELINE_Y + 34, 18, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f0b06';
    ctx.beginPath();
    ctx.ellipse(54, BASELINE_Y + 30, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f4ead6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(54, BASELINE_Y + 28);
    ctx.lineTo(80, BASELINE_Y - 4);
    ctx.stroke();

    // One candle per remaining day's work, standing along the right.
    for (let i = 0; i < candles; i++) {
        const cx = CANVAS_W - 38 - i * 26;
        ctx.fillStyle = '#e8d8b0';
        ctx.fillRect(cx - 4, BASELINE_Y - 20, 8, 26);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.ellipse(cx, BASELINE_Y - 26, 4, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 247, 214, 0.9)';
        ctx.beginPath();
        ctx.ellipse(cx, BASELINE_Y - 26, 1.8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawScroll(s) {
    const locked = scrolls[lockIndex] === s;
    const y = s.y;
    // How near the desk this scroll is: 0 safely above, 1 about to land.
    const danger = Math.max(0, Math.min(1, (y + SCROLL_H - (BASELINE_Y - DANGER_BAND)) / DANGER_BAND));

    if (danger > 0) {
        ctx.globalAlpha = 0.35 * danger;
        ctx.fillStyle = '#f87171';
        roundRect(s.x - 4, y - 4, s.w + 8, SCROLL_H + 8, 9);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Parchment.
    ctx.fillStyle = '#f3e3c3';
    roundRect(s.x + 8, y, s.w - 16, SCROLL_H, 5);
    ctx.fill();

    // Rolled ends.
    ctx.fillStyle = '#cbb288';
    roundRect(s.x, y + 2, 12, ROLL_H, 6);
    ctx.fill();
    roundRect(s.x + s.w - 12, y + 2, 12, ROLL_H, 6);
    ctx.fill();

    if (locked) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        roundRect(s.x + 7, y - 1, s.w - 14, SCROLL_H + 2, 6);
        ctx.stroke();
    }

    // The word: copied letters in ink, the rest still faint.
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const done = s.word.slice(0, s.typed);
    const todo = s.word.slice(s.typed);
    const totalW = ctx.measureText(s.word).width;
    let tx = s.x + (s.w - totalW) / 2;
    const ty = y + SCROLL_H / 2 + 1;

    if (done) {
        const doneW = ctx.measureText(done).width;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.3)';
        ctx.fillRect(tx - 2, ty - 11, doneW + 4, 22);
        ctx.fillStyle = '#1f2937';
        ctx.fillText(done, tx, ty);
        tx += doneW;
    }
    ctx.fillStyle = '#9b8763';
    ctx.fillText(todo, tx, ty);
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

// ---------------------------------------------------------------------------
// Main loop (real time). Physics runs through the same `step()` the tests use.
// ---------------------------------------------------------------------------

let lastTime = null;

function frame(t) {
    if (lastTime === null) lastTime = t;
    let dt = (t - lastTime) / 1000;
    lastTime = t;
    if (dt > 0.05) dt = 0.05; // clamp after tab switches / long frames
    step(dt);
    updateParticles(dt);
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
        if (state === 'running' && lockIndex >= 0) releaseLock();
        else togglePause();
        e.preventDefault();
        return;
    }

    if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        if (state === 'idle' || state === 'over') startGame();
        else if (state === 'paused') togglePause();
        e.preventDefault();
        return;
    }

    if (e.key.length === 1 && /^[a-z]$/i.test(e.key)) {
        typeChar(e.key);
        e.preventDefault(); // keeps the letter out of the hidden mobile field
    }
});

// Phones and tablets: tapping the board focuses the hidden field, which raises
// the on-screen keyboard. Those keyboards do not always send usable keydown
// events, so the field's own input event feeds the same `typeChar`.
function focusTypingField() {
    try {
        typingInput.focus({ preventScroll: true });
    } catch (e) {
        typingInput.focus();
    }
}

canvas.addEventListener('pointerdown', (e) => {
    focusTypingField();
    e.preventDefault();
});

typingInput.addEventListener('input', () => {
    for (const ch of typingInput.value) typeChar(ch);
    typingInput.value = '';
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') togglePause();
    else startGame();
    focusTypingField();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

best = 0;
try {
    best = parseInt(localStorage.getItem('faithful-scribe-best') || '0', 10) || 0;
} catch (e) {
    /* private browsing: start from zero */
}
state = 'idle';
score = 0;
combo = 0;
candles = START_CANDLES;
chapter = 1;
copied = 0;
spawnTimer = SPAWN_BASE;
updateHud();
requestAnimationFrame(frame);
