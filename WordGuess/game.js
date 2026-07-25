// =====================================================================
// Word Guess
// A five-letter word-deduction game. Six tries, colored feedback per
// letter, and an on-screen keyboard that remembers what you've learned.
//
// Game logic is kept separate from rendering and exposed on `window`
// (startGame / evaluate / typeLetter / backspace / submitGuess /
// keyState + globals) so the Playwright tests drive the real rules
// deterministically.
// =====================================================================

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const WORD_LEN = 5;
const MAX_ROWS = 6;
const CANVAS_W = 400;
const CANVAS_H = 600;

const C_CORRECT = '#6aaa64';
const C_PRESENT = '#c9b458';
const C_ABSENT = '#3a3a3c';
const C_EMPTY_BORDER = '#3a3a3c';
const C_FILLED_BORDER = '#565758';
const C_KEY = '#818384';

// A compact list that serves as both the answer pool and the valid-guess
// dictionary. Easy to extend; every entry is a common five-letter word.
const WORDS = [
    'crane', 'react', 'moldy', 'raise', 'stare', 'trace', 'cater', 'about',
    'above', 'abuse', 'actor', 'acute', 'admit', 'adopt', 'adult', 'after',
    'again', 'agent', 'agree', 'ahead', 'alarm', 'album', 'alert', 'alike',
    'alive', 'allow', 'alone', 'along', 'alter', 'among', 'anger', 'angle',
    'angry', 'apart', 'apple', 'apply', 'arena', 'argue', 'arise', 'array',
    'aside', 'asset', 'audio', 'audit', 'avoid', 'award', 'aware', 'badly',
    'baker', 'bases', 'basic', 'beach', 'began', 'begin', 'being', 'below',
    'bench', 'billy', 'birth', 'black', 'blade', 'blame', 'blank', 'blast',
    'blind', 'block', 'blood', 'board', 'boost', 'booth', 'bound', 'brain',
    'brand', 'brave', 'bread', 'break', 'breed', 'brief', 'bring', 'broad',
    'broke', 'brown', 'build', 'built', 'buyer', 'cable', 'carry', 'catch',
    'cause', 'chain', 'chair', 'chaos', 'charm', 'chart', 'chase', 'cheap',
    'check', 'chest', 'chief', 'child', 'china', 'chose', 'civil', 'claim',
    'class', 'clean', 'clear', 'click', 'climb', 'clock', 'close', 'cloud',
    'coach', 'coast', 'could', 'count', 'court', 'cover', 'craft', 'crash',
    'crazy', 'cream', 'crime', 'cross', 'crowd', 'crown', 'curve', 'cycle',
    'daily', 'dance', 'dated', 'dealt', 'death', 'debut', 'delay', 'depth',
    'doing', 'doubt', 'dozen', 'draft', 'drama', 'drawn', 'dream', 'dress',
    'drill', 'drink', 'drive', 'drove', 'eager', 'early', 'earth', 'eight',
    'elite', 'empty', 'enemy', 'enjoy', 'enter', 'entry', 'equal', 'error',
    'event', 'every', 'exact', 'exist', 'extra', 'faith', 'false', 'fault',
    'fiber', 'field', 'fifth', 'fifty', 'fight', 'final', 'first', 'fixed',
    'flash', 'fleet', 'floor', 'fluid', 'focus', 'force', 'forth', 'forty',
    'forum', 'found', 'frame', 'frank', 'fraud', 'fresh', 'front', 'fruit',
    'fully', 'funny', 'giant', 'given', 'glass', 'globe', 'going', 'grace',
    'grade', 'grand', 'grant', 'grass', 'great', 'green', 'gross', 'group',
    'grown', 'guard', 'guess', 'guest', 'guide', 'happy', 'harsh', 'heart',
    'heavy', 'hence', 'horse', 'hotel', 'house', 'human', 'ideal', 'image',
    'index', 'inner', 'input', 'issue', 'joint', 'judge', 'known', 'label',
    'large', 'laser', 'later', 'laugh', 'layer', 'learn', 'lease', 'least',
    'leave', 'legal', 'level', 'light', 'limit', 'lives', 'local', 'logic',
    'loose', 'lower', 'lucky', 'lunch', 'lying', 'magic', 'major', 'maker',
    'march', 'match', 'maybe', 'mayor', 'meant', 'media', 'metal', 'might',
    'minor', 'minus', 'mixed', 'model', 'money', 'month', 'moral', 'motor',
    'mount', 'mouse', 'mouth', 'movie', 'music', 'needs', 'never', 'newly',
    'night', 'noise', 'north', 'noted', 'novel', 'nurse', 'ocean', 'offer',
    'often', 'order', 'other', 'ought', 'paint', 'panel', 'paper', 'party',
    'peace', 'phase', 'phone', 'photo', 'piece', 'pilot', 'pitch', 'place',
    'plain', 'plane', 'plant', 'plate', 'point', 'pound', 'power', 'press',
    'price', 'pride', 'prime', 'print', 'prior', 'prize', 'proof', 'proud',
    'prove', 'queen', 'quick', 'quiet', 'quite', 'radio', 'range', 'rapid',
    'ratio', 'reach', 'ready', 'realm', 'rebel', 'refer', 'relax', 'reply',
    'right', 'rigid', 'rival', 'river', 'robot', 'roger', 'roman', 'rough',
    'round', 'route', 'royal', 'rural', 'scale', 'scene', 'scope', 'score',
    'sense', 'serve', 'seven', 'shall', 'shape', 'share', 'sharp', 'sheet',
    'shelf', 'shell', 'shift', 'shine', 'shirt', 'shock', 'shoot', 'short',
    'shown', 'sight', 'since', 'sixth', 'sixty', 'sized', 'skill', 'sleep',
    'slide', 'small', 'smart', 'smile', 'smoke', 'solid', 'solve', 'sorry',
    'sound', 'south', 'space', 'spare', 'speak', 'speed', 'spend', 'spent',
    'split', 'spoke', 'sport', 'staff', 'stage', 'stake', 'stand', 'start',
    'state', 'steam', 'steel', 'steep', 'steer', 'stick', 'still', 'stock',
    'stone', 'stood', 'store', 'storm', 'story', 'strip', 'stuck', 'study',
    'stuff', 'style', 'sugar', 'suite', 'super', 'sweet', 'table', 'taken',
    'taste', 'taxes', 'teach', 'teeth', 'terry', 'texas', 'thank', 'theft',
    'their', 'theme', 'there', 'these', 'thick', 'thing', 'think', 'third',
    'those', 'three', 'threw', 'throw', 'tight', 'times', 'tired', 'title',
    'today', 'topic', 'total', 'touch', 'tough', 'tower', 'track', 'trade',
    'trail', 'train', 'treat', 'trend', 'trial', 'tribe', 'trick', 'tried',
    'tries', 'truck', 'truly', 'trust', 'truth', 'twice', 'under', 'undue',
    'union', 'unity', 'until', 'upper', 'upset', 'urban', 'usage', 'usual',
    'valid', 'value', 'video', 'virus', 'visit', 'vital', 'voice', 'waste',
    'watch', 'water', 'wheel', 'where', 'which', 'while', 'white', 'whole',
    'whose', 'woman', 'world', 'worry', 'worse', 'worst', 'worth', 'would',
    'wound', 'write', 'wrong', 'wrote', 'yield', 'young', 'youth',
];

// ---------------------------------------------------------------------
// State (exposed as globals for tests)
// ---------------------------------------------------------------------
let state = 'idle'; // 'idle' | 'playing' | 'won' | 'lost'
let answer = '';
let guesses = []; // [{ word, marks }]
let current = ''; // the row currently being typed
let row = 0;
let streak = 0;
let best = 0;
let letterStates = {}; // letter -> 'correct' | 'present' | 'absent'
let message = '';
let keyRects = []; // populated during draw for click hit-testing

// ---------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const streakEl = document.getElementById('streak');
const bestEl = document.getElementById('best');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const overlaySub = document.getElementById('overlay-sub');
const btnStart = document.getElementById('btn-start');

// ---------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------
function evaluate(guess, answerWord) {
    guess = guess.toLowerCase();
    answerWord = answerWord.toLowerCase();
    const n = guess.length;
    const marks = new Array(n).fill('absent');
    const counts = {};
    for (const ch of answerWord) counts[ch] = (counts[ch] || 0) + 1;

    // Pass 1: exact-position matches.
    for (let i = 0; i < n; i++) {
        if (guess[i] === answerWord[i]) {
            marks[i] = 'correct';
            counts[guess[i]]--;
        }
    }
    // Pass 2: present-but-misplaced, only while copies remain.
    for (let i = 0; i < n; i++) {
        if (marks[i] === 'correct') continue;
        const ch = guess[i];
        if (counts[ch] > 0) {
            marks[i] = 'present';
            counts[ch]--;
        }
    }
    return marks;
}

// ---------------------------------------------------------------------
// HUD / overlay
// ---------------------------------------------------------------------
function updateHud() {
    streakEl.textContent = String(streak);
    bestEl.textContent = String(best);
}

function showOverlay(title, sub, scoreText) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayScore.textContent = scoreText || '';
    overlay.classList.add('visible');
}

function hideOverlay() {
    overlay.classList.remove('visible');
}

function persist() {
    try {
        localStorage.setItem('wordguess-streak', String(streak));
        localStorage.setItem('wordguess-best', String(best));
    } catch (e) {
        /* ignore storage errors */
    }
}

// ---------------------------------------------------------------------
// Core actions
// ---------------------------------------------------------------------
function startGame(word) {
    answer = (word || WORDS[Math.floor(Math.random() * WORDS.length)]).toLowerCase();
    guesses = [];
    current = '';
    row = 0;
    letterStates = {};
    message = '';
    state = 'playing';
    hideOverlay();
    draw();
}

function typeLetter(ch) {
    if (state !== 'playing') return;
    if (!/^[a-z]$/i.test(ch)) return;
    if (current.length >= WORD_LEN) return;
    current += ch.toLowerCase();
    message = '';
    draw();
}

function backspace() {
    if (state !== 'playing') return;
    current = current.slice(0, -1);
    message = '';
    draw();
}

const RANK = { correct: 3, present: 2, absent: 1 };

function applyKeyStates(guess, marks) {
    for (let i = 0; i < guess.length; i++) {
        const ch = guess[i];
        const cur = letterStates[ch];
        if (!cur || RANK[marks[i]] > RANK[cur]) {
            letterStates[ch] = marks[i];
        }
    }
}

function keyState(letter) {
    return letterStates[letter.toLowerCase()] || '';
}

function submitGuess() {
    if (state !== 'playing') {
        return { ok: false, invalid: true, marks: null, won: false, lost: false };
    }
    if (current.length !== WORD_LEN) {
        message = 'Not enough letters';
        draw();
        return { ok: false, invalid: true, marks: null, won: false, lost: false };
    }
    if (!WORDS.includes(current)) {
        message = 'Not in word list';
        draw();
        return { ok: false, invalid: true, marks: null, won: false, lost: false };
    }

    const guess = current;
    const marks = evaluate(guess, answer);
    guesses.push({ word: guess, marks });
    applyKeyStates(guess, marks);
    current = '';
    row++;

    const won = guess === answer;
    if (won) {
        state = 'won';
        streak++;
        if (streak > best) best = streak;
        persist();
        updateHud();
        draw();
        showOverlay('You got it!',
            'Press Space to play again',
            'Solved in ' + row + ' / ' + MAX_ROWS + ' — streak ' + streak);
        return { ok: true, invalid: false, marks, won: true, lost: false };
    }

    if (row >= MAX_ROWS) {
        state = 'lost';
        streak = 0;
        persist();
        updateHud();
        draw();
        showOverlay('Out of guesses',
            'Press Space to play again',
            'The word was ' + answer.toUpperCase());
        return { ok: true, invalid: false, marks, won: false, lost: true };
    }

    draw();
    return { ok: true, invalid: false, marks, won: false, lost: false };
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const GRID_TILE = 56;
const GRID_GAP = 6;
const GRID_TOP = 18;

function tileColor(mark) {
    if (mark === 'correct') return C_CORRECT;
    if (mark === 'present') return C_PRESENT;
    if (mark === 'absent') return C_ABSENT;
    return null;
}

function drawGrid() {
    const gridW = WORD_LEN * GRID_TILE + (WORD_LEN - 1) * GRID_GAP;
    const startX = (CANVAS_W - gridW) / 2;

    for (let r = 0; r < MAX_ROWS; r++) {
        const y = GRID_TOP + r * (GRID_TILE + GRID_GAP);
        const submitted = guesses[r];
        const typing = r === row && state === 'playing';

        for (let c = 0; c < WORD_LEN; c++) {
            const x = startX + c * (GRID_TILE + GRID_GAP);
            let letter = '';
            let fill = null;
            let border = C_EMPTY_BORDER;

            if (submitted) {
                letter = submitted.word[c].toUpperCase();
                fill = tileColor(submitted.marks[c]);
                border = fill;
            } else if (typing && c < current.length) {
                letter = current[c].toUpperCase();
                border = C_FILLED_BORDER;
            }

            if (fill) {
                ctx.fillStyle = fill;
                ctx.fillRect(x, y, GRID_TILE, GRID_TILE);
            } else {
                ctx.strokeStyle = border;
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, GRID_TILE - 2, GRID_TILE - 2);
            }

            if (letter) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 30px "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(letter, x + GRID_TILE / 2, y + GRID_TILE / 2 + 1);
            }
        }
    }
}

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const KB_TOP = 430;
const KEY_H = 46;
const KEY_GAP = 5;

function keyFill(letter) {
    const st = letterStates[letter];
    if (st === 'correct') return C_CORRECT;
    if (st === 'present') return C_PRESENT;
    if (st === 'absent') return C_ABSENT;
    return C_KEY;
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

function drawKeyboard() {
    keyRects = [];
    const keyW = 34;

    KEY_ROWS.forEach((rowStr, ri) => {
        const keys = rowStr.split('');
        // The bottom row is bracketed by Enter and Backspace wide keys.
        const wideW = ri === 2 ? 50 : 0;
        const rowWidth = keys.length * keyW + (keys.length - 1) * KEY_GAP + (ri === 2 ? 2 * (wideW + KEY_GAP) : 0);
        let x = (CANVAS_W - rowWidth) / 2;
        const y = KB_TOP + ri * (KEY_H + KEY_GAP);

        if (ri === 2) {
            drawSpecialKey(x, y, wideW, 'enter', '↵');
            keyRects.push({ x, y, w: wideW, h: KEY_H, key: 'enter' });
            x += wideW + KEY_GAP;
        }

        keys.forEach(k => {
            ctx.fillStyle = keyFill(k);
            roundRect(x, y, keyW, KEY_H, 6);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(k.toUpperCase(), x + keyW / 2, y + KEY_H / 2 + 1);
            keyRects.push({ x, y, w: keyW, h: KEY_H, key: k });
            x += keyW + KEY_GAP;
        });

        if (ri === 2) {
            drawSpecialKey(x, y, wideW, 'back', '⌫');
            keyRects.push({ x, y, w: wideW, h: KEY_H, key: 'back' });
        }
    });
}

function drawSpecialKey(x, y, w, key, glyph) {
    ctx.fillStyle = C_KEY;
    roundRect(x, y, w, KEY_H, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x + w / 2, y + KEY_H / 2 + 1);
}

function drawMessage() {
    if (!message) return;
    ctx.fillStyle = 'rgba(230, 237, 243, 0.95)';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, CANVAS_W / 2, 412);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    drawGrid();
    drawMessage();
    drawKeyboard();
}

// ---------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------
function handleKey(key) {
    if (key === 'enter') submitGuess();
    else if (key === 'back') backspace();
    else typeLetter(key);
}

document.addEventListener('keydown', e => {
    const k = e.key;

    if (state === 'idle' || state === 'won' || state === 'lost') {
        if (k === ' ' || k === 'Enter') {
            startGame();
            e.preventDefault();
        }
        return;
    }

    if (k === 'Enter') {
        submitGuess();
        e.preventDefault();
    } else if (k === 'Backspace') {
        backspace();
        e.preventDefault();
    } else if (/^[a-zA-Z]$/.test(k)) {
        typeLetter(k);
    }
});

canvas.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const py = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    for (const kr of keyRects) {
        if (px >= kr.x && px <= kr.x + kr.w && py >= kr.y && py <= kr.y + kr.h) {
            handleKey(kr.key);
            break;
        }
    }
});

btnStart.addEventListener('click', () => startGame());

// ---------------------------------------------------------------------
// Init (idle screen)
// ---------------------------------------------------------------------
streak = parseInt(localStorage.getItem('wordguess-streak') || '0', 10);
best = parseInt(localStorage.getItem('wordguess-best') || '0', 10);
state = 'idle';
answer = '';
guesses = [];
current = '';
row = 0;
updateHud();
draw();
showOverlay('Word Guess', 'Press Space to start', '');
