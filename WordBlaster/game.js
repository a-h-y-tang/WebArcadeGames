// Word Blaster — a typing arcade game.
// Words fall from the top; type them to blast them before they cross the
// danger line. Miss three and it's game over.

// --- Constants ---
const WIDTH = 700;
const HEIGHT = 560;
const DANGER_Y = HEIGHT - 60;      // words past this line cost a life
const START_LIVES = 3;
const SCORE_PER_LETTER = 10;
const WORDS_PER_LEVEL = 8;         // words destroyed before difficulty steps up

const WORD_LIST = [
    'cat', 'dog', 'sun', 'moon', 'star', 'tree', 'fish', 'bird', 'rock', 'wind',
    'code', 'game', 'jump', 'fire', 'wave', 'leaf', 'gold', 'iron', 'ring', 'sky',
    'ghost', 'laser', 'pixel', 'robot', 'space', 'blaze', 'storm', 'crash', 'quest',
    'meteor', 'planet', 'rocket', 'shield', 'dragon', 'castle', 'wizard', 'knight',
    'galaxy', 'nebula', 'thunder', 'crystal', 'phoenix', 'gravity', 'machine',
    'keyboard', 'asteroid', 'velocity', 'infinity', 'starlight',
];

// --- DOM ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const livesEl = document.getElementById('lives');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

const WORD_FONT = 'bold 26px "Consolas", "Menlo", monospace';

// --- State ---
let words, activeWord, score, best, lives, level, wordsDestroyed, state;
let spawnTimer, lastTime, animId;

// --- Difficulty helpers ---
function fallSpeed() {
    // pixels per second — climbs with level
    return 42 + level * 11;
}

function spawnInterval() {
    // milliseconds between spawns — shrinks with level
    return Math.max(850, 2000 - level * 130);
}

function randomWordText() {
    return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

// --- Spawning ---
function spawnWord(text, x) {
    ctx.font = WORD_FONT;
    const w = ctx.measureText(text).width;
    if (x === undefined) {
        const maxX = Math.max(10, WIDTH - w - 10);
        x = 10 + Math.random() * (maxX - 10);
    }
    const word = { text, typed: 0, x, y: -24, speed: fallSpeed(), width: w };
    words.push(word);
    return word;
}

function spawnRandomWord() {
    spawnWord(randomWordText());
}

// --- Simulation step (dt in milliseconds) ---
function update(dtMs) {
    const dy = dtMs / 1000;
    for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        w.y += w.speed * dy;
        if (w.y > DANGER_Y) {
            // Missed — lose a life and remove the word.
            words.splice(i, 1);
            if (activeWord === w) activeWord = null;
            loseLife();
            if (state !== 'running') return;
        }
    }
}

function loseLife() {
    lives--;
    livesEl.textContent = lives;
    if (lives <= 0) {
        lives = 0;
        livesEl.textContent = lives;
        endGame();
    }
}

// --- Typing ---
function advance(w) {
    w.typed++;
    if (w.typed >= w.text.length) destroyWord(w);
}

function destroyWord(w) {
    score += w.text.length * SCORE_PER_LETTER;
    scoreEl.textContent = score;
    const i = words.indexOf(w);
    if (i >= 0) words.splice(i, 1);
    if (activeWord === w) activeWord = null;

    wordsDestroyed++;
    if (wordsDestroyed % WORDS_PER_LEVEL === 0) level++;
}

function typeKey(ch) {
    if (state !== 'running') return;
    ch = ch.toLowerCase();
    if (!/^[a-z]$/.test(ch)) return;

    if (activeWord) {
        // Only the active word receives input; wrong keys are ignored.
        if (activeWord.text[activeWord.typed] === ch) advance(activeWord);
        return;
    }

    // No active target: lock onto the first-letter match nearest the bottom.
    let target = null;
    for (const w of words) {
        if (w.typed === 0 && w.text[0] === ch) {
            if (target === null || w.y > target.y) target = w;
        }
    }
    if (target) {
        activeWord = target;
        advance(target);
    }
}

// --- Game lifecycle ---
function startGame() {
    words = [];
    activeWord = null;
    score = 0;
    lives = START_LIVES;
    level = 0;
    wordsDestroyed = 0;
    state = 'running';
    spawnTimer = 0;
    lastTime = null;

    scoreEl.textContent = score;
    livesEl.textContent = lives;
    overlay.classList.remove('visible');

    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
}

function endGame() {
    state = 'over';
    cancelAnimationFrame(animId);
    if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('wordblaster-best', best);
    }
    overlayTitle.textContent = 'Game Over';
    overlayScore.textContent = `${score} pts`;
    overlaySub.textContent = 'Press any letter to play again';
    btnStart.textContent = 'Play Again';
    overlay.classList.add('visible');
}

function pauseGame() {
    state = 'paused';
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'Paused';
    overlayScore.textContent = '';
    overlaySub.textContent = 'Press Esc to resume';
    btnStart.textContent = 'Resume';
    overlay.classList.add('visible');
}

function resumeGame() {
    state = 'running';
    lastTime = null;
    overlay.classList.remove('visible');
    animId = requestAnimationFrame(loop);
}

// --- Main loop (timestamp-driven) ---
function loop(ts) {
    if (state !== 'running') return;
    if (lastTime == null) lastTime = ts;
    const dt = ts - lastTime;
    lastTime = ts;

    spawnTimer += dt;
    if (spawnTimer >= spawnInterval()) {
        spawnTimer = 0;
        spawnRandomWord();
    }

    update(dt);
    draw();

    if (state === 'running') animId = requestAnimationFrame(loop);
}

// --- Rendering ---
function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#0b0f16';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Danger line
    ctx.save();
    ctx.strokeStyle = '#f8717155';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y);
    ctx.lineTo(WIDTH, DANGER_Y);
    ctx.stroke();
    ctx.restore();

    // Words
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'middle';
    for (const w of words) {
        const isActive = w === activeWord;

        if (isActive) {
            ctx.save();
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 14;
        }

        let cx = w.x;
        for (let i = 0; i < w.text.length; i++) {
            const ch = w.text[i];
            if (i < w.typed) {
                ctx.fillStyle = '#4ade80';       // already typed
            } else if (isActive && i === w.typed) {
                ctx.fillStyle = '#fef08a';       // next letter to hit
            } else {
                ctx.fillStyle = '#e6edf3';       // untyped
            }
            ctx.fillText(ch, cx, w.y);
            cx += ctx.measureText(ch).width;
        }

        if (isActive) ctx.restore();
    }
}

// --- Input ---
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (state === 'running') pauseGame();
        else if (state === 'paused') resumeGame();
        return;
    }

    const isLetter = e.key.length === 1 && /^[a-zA-Z]$/.test(e.key);

    if (state === 'idle' || state === 'over') {
        if (isLetter) startGame();
        return;
    }

    if (state === 'running' && isLetter) {
        typeKey(e.key);
        e.preventDefault();
    }
});

btnStart.addEventListener('click', () => {
    if (state === 'paused') resumeGame();
    else startGame();
});

// --- Init ---
best = parseInt(localStorage.getItem('wordblaster-best') || '0', 10);
bestEl.textContent = best;
words = [];
activeWord = null;
score = 0;
lives = START_LIVES;
level = 0;
wordsDestroyed = 0;
state = 'idle';
draw();
