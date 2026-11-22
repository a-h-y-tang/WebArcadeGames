// =========================================================================
// Joyful Noise
//
// A falling-notes rhythm game on four instruments of praise — harp, lyre,
// timbrel and trumpet. The notes of a hymn fall down the four lanes; strike a
// lane as its note crosses the line and that instrument sounds the note, so a
// clean run plays the melody.
//
//     "Make a joyful noise unto the LORD, all ye lands." — Psalm 100:1
//
// One plain script, like the rest of the collection, so the melodies, the chart
// and the live state stay reachable from the Playwright suite as globals. Time
// runs through nowMs(), which the suite can pin with freezeClock() and move on
// with advanceClock(), so a press can be placed an exact number of
// milliseconds from a note without waiting in real time.
// =========================================================================

// ---------------------------------------------------------------- geometry
const LANE_COUNT = 4;
const LANE_W = 100;
const LANES_X = 30;             // left edge of the first lane
const SPAWN_Y = -24;            // where a note enters, just above the canvas
const STRIKE_Y = 500;           // the line the notes must be struck on
const PAD_H = 64;               // the instrument pads below the line

// ------------------------------------------------------------ timing rules
const LEAD_IN_MS = 2000;        // a count before the first note falls due
const OUTRO_MS = 1200;          // let the last note ring before the end screen
const PERFECT_MS = 50;
const GREAT_MS = 100;
const GOOD_MS = 160;            // the widest window; beyond it the note is lost

const POINTS = { perfect: 100, great: 60, good: 30, miss: 0 };
const WEIGHTS = { perfect: 1, great: 0.85, good: 0.6, miss: 0 };

const LANES = [
    { name: 'Harp', key: 'D', colour: '#6fb4e8', glow: '#bfe2ff' },
    { name: 'Lyre', key: 'F', colour: '#79c98b', glow: '#c8f2d3' },
    { name: 'Timbrel', key: 'J', colour: '#e8b85c', glow: '#ffe3a8' },
    { name: 'Trumpet', key: 'K', colour: '#e08a74', glow: '#ffcbbd' },
];

const SPEEDS = [
    { name: 'Gentle', approach: 2200 },
    { name: 'Steady', approach: 1600 },
    { name: 'Lively', approach: 1100 },
];

// ----------------------------------------------------------------- hymns
// A melody is a list of steps: p is a note name (null for a rest) and b is a
// length in beats. Public-domain tunes, transcribed into the melody format.
const SONGS = [
    {
        name: 'Amazing Grace',
        credit: 'New Britain, 1835 — "Amazing grace, how sweet the sound"',
        bpm: 96,
        melody: [
            { p: 'D4', b: 1 },
            { p: 'G4', b: 2 }, { p: 'B4', b: 1 },
            { p: 'G4', b: 1.5 }, { p: 'B4', b: 0.5 }, { p: 'A4', b: 1 },
            { p: 'G4', b: 3 },
            { p: 'D4', b: 1 },
            { p: 'G4', b: 2 }, { p: 'B4', b: 1 },
            { p: 'G4', b: 1.5 }, { p: 'B4', b: 0.5 }, { p: 'A4', b: 1 },
            { p: 'D5', b: 3 },
            { p: 'D5', b: 1 },
            { p: 'D5', b: 2 }, { p: 'B4', b: 1 },
            { p: 'D5', b: 1.5 }, { p: 'B4', b: 0.5 }, { p: 'A4', b: 1 },
            { p: 'G4', b: 3 },
            { p: 'D4', b: 1 },
            { p: 'G4', b: 2 }, { p: 'B4', b: 1 },
            { p: 'G4', b: 1.5 }, { p: 'E4', b: 0.5 }, { p: 'D4', b: 1 },
            { p: 'G4', b: 3 },
        ],
    },
    {
        name: 'Joyful, Joyful',
        credit: 'Hymn to Joy, Beethoven — "Joyful, joyful, we adore Thee"',
        bpm: 112,
        melody: [
            { p: 'E4', b: 1 }, { p: 'E4', b: 1 }, { p: 'F4', b: 1 }, { p: 'G4', b: 1 },
            { p: 'G4', b: 1 }, { p: 'F4', b: 1 }, { p: 'E4', b: 1 }, { p: 'D4', b: 1 },
            { p: 'C4', b: 1 }, { p: 'C4', b: 1 }, { p: 'D4', b: 1 }, { p: 'E4', b: 1 },
            { p: 'E4', b: 1.5 }, { p: 'D4', b: 0.5 }, { p: 'D4', b: 2 },
            { p: 'E4', b: 1 }, { p: 'E4', b: 1 }, { p: 'F4', b: 1 }, { p: 'G4', b: 1 },
            { p: 'G4', b: 1 }, { p: 'F4', b: 1 }, { p: 'E4', b: 1 }, { p: 'D4', b: 1 },
            { p: 'C4', b: 1 }, { p: 'C4', b: 1 }, { p: 'D4', b: 1 }, { p: 'E4', b: 1 },
            { p: 'D4', b: 1.5 }, { p: 'C4', b: 0.5 }, { p: 'C4', b: 2 },
        ],
    },
    {
        name: 'Holy, Holy, Holy',
        credit: 'Nicaea, 1861 — "Holy, holy, holy, Lord God Almighty"',
        bpm: 100,
        melody: [
            { p: 'D4', b: 1 }, { p: 'D4', b: 1 }, { p: 'F#4', b: 1 }, { p: 'F#4', b: 1 },
            { p: 'A4', b: 1 }, { p: 'A4', b: 1 }, { p: 'F#4', b: 2 },
            { p: 'E4', b: 1 }, { p: 'E4', b: 1 }, { p: 'G4', b: 1 }, { p: 'G4', b: 1 },
            { p: 'F#4', b: 1 }, { p: 'F#4', b: 1 }, { p: 'D4', b: 2 },
            { p: 'D4', b: 1 }, { p: 'D4', b: 1 }, { p: 'A4', b: 1 }, { p: 'A4', b: 1 },
            { p: 'B4', b: 1 }, { p: 'B4', b: 1 }, { p: 'A4', b: 2 },
            { p: 'G4', b: 1 }, { p: 'G4', b: 1 }, { p: 'F#4', b: 1 }, { p: 'E4', b: 1 },
            { p: 'D4', b: 4 },
        ],
    },
];

// The bands are set against whole runs: every note caught cleanly is the top
// grade, every note caught a little late still earns "Well played", and only a
// hymn with notes left unstruck falls to the bottom.
const GRADES = [
    { at: 0.95, title: 'A joyful noise!', sub: 'Every note in its place — the whole hymn rang true.' },
    { at: 0.80, title: 'Well played', sub: 'A clear, steady hymn, near enough every note caught.' },
    { at: 0.55, title: 'Keep praising', sub: 'The tune came through. Try it once more for the rest.' },
    { at: 0, title: 'Give it another voice', sub: 'Listen for the beat and strike right on the line.' },
];

// ------------------------------------------------------------------- state
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let songIndex = 0;
let speedIndex = 1;
let chart = [];
let state = newState();
let startClock = 0;       // the clock reading of the hymn's lead-in start
let pausedTotal = 0;      // time spent paused, taken off the song clock
let pauseStart = 0;
let lastJudgement = null; // { text, lane, at } for the flash at the line
let padFlash = [0, 0, 0, 0];
let held = [false, false, false, false];

function newState() {
    return {
        score: 0,
        combo: 0,
        bestCombo: 0,
        counts: { perfect: 0, great: 0, good: 0, miss: 0 },
        phase: 'ready',       // ready | playing | paused | finished
    };
}

// ------------------------------------------------------------- the clock
// Unfrozen this is just performance.now(). The suite pins it so that presses
// land an exact distance from a note.
let clockOverride = null;

function nowMs() {
    return clockOverride === null ? performance.now() : clockOverride;
}

function freezeClock(ms) {
    clockOverride = ms;
}

function thawClock() {
    clockOverride = null;
}

function advanceClock(delta) {
    if (clockOverride === null) clockOverride = performance.now();
    clockOverride += delta;
    tick();
}

function advanceClockTo(ms) {
    clockOverride = ms;
    tick();
}

// Milliseconds since the hymn's first beat; negative during the lead-in count.
function songTimeMs() {
    const clock = state.phase === 'paused' ? pauseStart : nowMs();
    return clock - startClock - pausedTotal - LEAD_IN_MS;
}

function approachMs() {
    return SPEEDS[speedIndex].approach;
}

// --------------------------------------------------------- pitch and chart
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'F#4' -> MIDI number. Returns NaN for anything that is not a note name.
function pitchToMidi(pitch) {
    const match = /^([A-G])(#|b)?(-?\d)$/.exec(String(pitch));
    if (!match) return NaN;
    const [, letter, accidental, octave] = match;
    const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
    return (Number(octave) + 1) * 12 + SEMITONES[letter] + shift;
}

function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

// The melody's range is split into four buckets, lowest quarter on the harp and
// highest on the trumpet, so the tune's shape shows as movement across lanes.
function laneForPitch(pitch, pitches) {
    const sorted = [...new Set(pitches.map(pitchToMidi))].sort((a, b) => a - b);
    const index = sorted.indexOf(pitchToMidi(pitch));
    if (index < 0) return 0;
    return Math.min(LANE_COUNT - 1, Math.floor((index * LANE_COUNT) / sorted.length));
}

// A melody plus a tempo becomes a list of notes { time, lane, pitch, dur }.
function buildChart(song) {
    const beatMs = 60000 / song.bpm;
    const pitches = song.melody.filter((s) => s.p).map((s) => s.p);
    const notes = [];
    let beat = 0;
    for (const step of song.melody) {
        if (step.p) {
            notes.push({
                time: beat * beatMs,
                dur: step.b * beatMs,
                pitch: step.p,
                lane: laneForPitch(step.p, pitches),
                judgement: null,
                hitAt: 0,
            });
        }
        beat += step.b;
    }
    notes.sort((a, b) => a.time - b.time);
    return notes;
}

// The hymn's last note falls due here; OUTRO_MS after it the end screen comes.
function lastNoteMs() {
    return chart.length ? chart[chart.length - 1].time : 0;
}

// ----------------------------------------------------------------- scoring
function judgementFor(delta) {
    const gap = Math.abs(delta);
    if (gap <= PERFECT_MS) return 'perfect';
    if (gap <= GREAT_MS) return 'great';
    if (gap <= GOOD_MS) return 'good';
    return null;
}

// Weighted over the notes judged so far, so the figure means the same thing
// mid-hymn as it does at the end — where every note has been judged and the
// denominator is the whole chart.
function accuracy() {
    const entries = Object.entries(state.counts);
    const judged = entries.reduce((sum, [, n]) => sum + n, 0);
    if (!judged) return 1;                 // nothing played yet reads as clean
    const scored = entries.reduce((sum, [name, n]) => sum + WEIGHTS[name] * n, 0);
    return scored / judged;
}

function gradeFor(acc) {
    return GRADES.find((g) => acc >= g.at) || GRADES[GRADES.length - 1];
}

function record(note, judgement) {
    note.judgement = judgement;
    note.hitAt = songTimeMs();
    state.counts[judgement] += 1;
    state.score += POINTS[judgement];
    if (judgement === 'miss') {
        state.combo = 0;
    } else {
        state.combo += 1;
        state.bestCombo = Math.max(state.bestCombo, state.combo);
        padFlash[note.lane] = nowMs();
        playNote(note.pitch, judgement);
    }
    lastJudgement = { text: judgement, lane: note.lane, at: nowMs() };
    updateHud();
}

// The first unstruck note in the lane that is inside the widest window. Taking
// them in order matters where two notes fall close together: a press a little
// late belongs to the note it was aimed at, not the one behind it — which would
// leave the first standing to be missed.
function judgeFor(lane, time) {
    for (const note of chart) {
        if (note.lane !== lane || note.judgement) continue;
        if (Math.abs(note.time - time) <= GOOD_MS) return note;
    }
    return null;
}

function pressLane(lane) {
    if (state.phase !== 'playing') return false;
    padFlash[lane] = nowMs();
    held[lane] = true;
    const time = songTimeMs();
    const note = judgeFor(lane, time);
    if (!note) return false;                // an empty lane costs nothing
    record(note, judgementFor(note.time - time));
    return true;
}

function releaseLane(lane) {
    held[lane] = false;
}

// -------------------------------------------------------------- the hymn
function startSong(index) {
    if (index !== undefined) songIndex = index;
    chart = buildChart(SONGS[songIndex]);
    state = newState();
    state.phase = 'playing';
    startClock = nowMs();
    pausedTotal = 0;
    lastJudgement = null;
    padFlash = [0, 0, 0, 0];
    held = [false, false, false, false];
    setStatus('Strike each note as it crosses the line.');
    updateHud();
    showOverlay(false);
    draw();
}

function selectSong(index) {
    songIndex = Math.max(0, Math.min(SONGS.length - 1, index));
    chart = buildChart(SONGS[songIndex]);
    state = newState();
    document.querySelectorAll('.song-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === songIndex);
    });
    document.getElementById('song-name').textContent = SONGS[songIndex].name;
    document.getElementById('overlay-title').textContent = SONGS[songIndex].name;
    document.getElementById('overlay-sub').textContent = SONGS[songIndex].credit;
    setStatus('Press Play, or Space, to begin the hymn.');
    updateHud();
    showOverlay(true);
    draw();
}

function setSpeed(index) {
    speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, index));
    document.querySelectorAll('.speed-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === speedIndex);
    });
    draw();
}

function togglePause() {
    if (state.phase === 'playing') {
        pauseStart = nowMs();
        state.phase = 'paused';
        document.getElementById('overlay-title').textContent = 'Paused';
        document.getElementById('overlay-sub').textContent = 'Press P to take up the hymn again.';
        document.getElementById('btn-play').textContent = 'Resume';
        showOverlay(true);
    } else if (state.phase === 'paused') {
        pausedTotal += nowMs() - pauseStart;
        state.phase = 'playing';
        showOverlay(false);
    }
    draw();
}

function finish() {
    state.phase = 'finished';
    const acc = accuracy();
    const grade = gradeFor(acc);
    document.getElementById('overlay-title').textContent = grade.title;
    document.getElementById('overlay-sub').textContent =
        `${grade.sub} Score ${state.score}, ${Math.round(acc * 100)}% of ${SONGS[songIndex].name}, ` +
        `longest combo ${state.bestCombo}.`;
    document.getElementById('btn-play').textContent = 'Play again';
    setStatus(`${grade.title} — ${state.score} points.`);
    showOverlay(true);
    updateHud();
}

// A note left unstruck is lost once the clock passes its widest window.
function sweepMisses(time) {
    for (const note of chart) {
        if (!note.judgement && note.time + GOOD_MS < time) record(note, 'miss');
    }
}

function tick() {
    if (state.phase === 'playing') {
        const time = songTimeMs();
        sweepMisses(time);
        if (time > lastNoteMs() + OUTRO_MS) finish();
    }
    draw();
}

function frame() {
    tick();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- the view
function laneX(lane) {
    return LANES_X + lane * LANE_W;
}

function laneFromX(x) {
    const lane = Math.floor((x - LANES_X) / LANE_W);
    return lane >= 0 && lane < LANE_COUNT ? lane : -1;
}

function padCentre(lane) {
    return { x: laneX(lane) + LANE_W / 2, y: STRIKE_Y + PAD_H / 2 };
}

// Where a note sits right now: on the strike line exactly when it falls due.
function noteY(note) {
    const remaining = note.time - songTimeMs();
    const travel = STRIKE_Y - SPAWN_Y;
    return STRIKE_Y - (remaining / approachMs()) * travel;
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

function draw() {
    const w = canvas.width;
    const h = canvas.height;

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#141b3a');
    sky.addColorStop(0.6, '#1d2650');
    sky.addColorStop(1, '#2a1f42');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // The lanes, lit a little brighter where a hand is resting.
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const x = laneX(lane);
        const lit = held[lane] || nowMs() - padFlash[lane] < 140;
        ctx.fillStyle = lit ? 'rgba(255,255,255,0.10)' : lane % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
        ctx.fillRect(x, 0, LANE_W, STRIKE_Y + PAD_H);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, STRIKE_Y + PAD_H);
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(laneX(LANE_COUNT) + 0.5, 0);
    ctx.lineTo(laneX(LANE_COUNT) + 0.5, STRIKE_Y + PAD_H);
    ctx.stroke();

    drawBeatLines();
    drawBackdropText();  // the count and the combo sit behind the falling notes
    drawNotes();
    drawStrikeLine();
    drawPads();
    drawFlashText();     // the judgement flash reads over everything
}

// Faint lines on every beat, brighter on the first beat of each bar, falling at
// the same rate as the notes. They fill the space between a hymn's longer notes
// and give the eye a pulse to play against.
function drawBeatLines() {
    if (!chart.length) return;
    const song = SONGS[songIndex];
    const beatMs = 60000 / song.bpm;
    const time = songTimeMs();
    const first = Math.floor((time - 200) / beatMs);
    const last = Math.ceil((time + approachMs()) / beatMs);
    const left = laneX(0);
    const width = LANE_W * LANE_COUNT;
    ctx.save();
    for (let beat = Math.max(0, first); beat <= last; beat++) {
        const y = noteY({ time: beat * beatMs });
        if (y < 0 || y > STRIKE_Y) continue;
        const bar = beat % 4 === 0;
        ctx.strokeStyle = bar ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
        ctx.lineWidth = bar ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y) + 0.5);
        ctx.lineTo(left + width, Math.round(y) + 0.5);
        ctx.stroke();
    }
    ctx.restore();
}

function drawNotes() {
    if (!chart.length) return;
    const travelTop = SPAWN_Y - 40;
    for (const note of chart) {
        if (note.judgement && note.judgement !== 'miss') continue;
        const y = noteY(note);
        if (y < travelTop || y > STRIKE_Y + 30) continue;
        const lane = LANES[note.lane];
        const x = laneX(note.lane) + 14;
        const width = LANE_W - 28;
        const height = 20;
        ctx.save();
        if (note.judgement === 'miss') {
            ctx.globalAlpha = 0.25;
        }
        ctx.fillStyle = lane.colour;
        roundRect(x, y - height / 2, width, height, 7);
        ctx.fill();
        ctx.strokeStyle = lane.glow;
        ctx.lineWidth = 2;
        ctx.stroke();
        // A soft bar across the middle, so the note reads as a struck string.
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x + 6, y - 2, width - 12, 3);
        ctx.restore();
    }
}

function drawStrikeLine() {
    const left = laneX(0);
    const right = laneX(LANE_COUNT);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,245,200,0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left, STRIKE_Y);
    ctx.lineTo(right, STRIKE_Y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,200,0.25)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(left, STRIKE_Y);
    ctx.lineTo(right, STRIKE_Y);
    ctx.stroke();
    ctx.restore();
}

function drawPads() {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const info = LANES[lane];
        const x = laneX(lane) + 8;
        const width = LANE_W - 16;
        const lit = held[lane] || nowMs() - padFlash[lane] < 140;
        ctx.save();
        ctx.fillStyle = lit ? info.glow : 'rgba(255,255,255,0.09)';
        roundRect(x, STRIKE_Y + 10, width, PAD_H - 18, 10);
        ctx.fill();
        ctx.strokeStyle = info.colour;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = lit ? '#1b2142' : info.colour;
        ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(info.key, x + width / 2, STRIKE_Y + 28);
        ctx.fillStyle = lit ? '#1b2142' : 'rgba(255,255,255,0.7)';
        ctx.font = '11px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(info.name, x + width / 2, STRIKE_Y + 44);
        ctx.restore();
    }
}

// Behind the notes: the lead-in count and the combo watermark.
function drawBackdropText() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // The lead-in count, so the first note is never a surprise.
    if (state.phase === 'playing' || state.phase === 'paused') {
        const time = songTimeMs();
        if (time < 0) {
            const beats = Math.ceil(-time / (LEAD_IN_MS / 4));
            ctx.fillStyle = 'rgba(255,245,200,0.9)';
            ctx.font = 'bold 64px "Segoe UI", system-ui, sans-serif';
            ctx.fillText(String(Math.min(4, beats)), canvas.width / 2, 200);
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = '15px "Segoe UI", system-ui, sans-serif';
            ctx.fillText('Ready…', canvas.width / 2, 250);
        }
        if (state.combo >= 3) {
            ctx.fillStyle = 'rgba(255,255,255,0.13)';
            ctx.font = 'bold 86px "Segoe UI", system-ui, sans-serif';
            ctx.fillText(`${state.combo}`, canvas.width / 2, 300);
            ctx.font = '15px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.fillText('in a row', canvas.width / 2, 348);
        }
    }

    ctx.restore();
}

// Over the notes: the judgement flash and the hymn's name.
function drawFlashText() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // The last judgement, fading just above the line.
    if (lastJudgement) {
        const age = nowMs() - lastJudgement.at;
        if (age < 620) {
            const labels = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Missed' };
            const colours = { perfect: '#fff3b0', great: '#b9f0c4', good: '#cfe3ff', miss: '#f0a79b' };
            ctx.globalAlpha = Math.max(0, 1 - age / 620);
            ctx.fillStyle = colours[lastJudgement.text];
            ctx.font = 'bold 22px "Segoe UI", system-ui, sans-serif';
            ctx.fillText(labels[lastJudgement.text], padCentre(lastJudgement.lane).x, STRIKE_Y - 56 - age / 24);
            ctx.globalAlpha = 1;
        }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SONGS[songIndex].name, canvas.width / 2, canvas.height - 24);
    ctx.restore();
}

// ------------------------------------------------------------------ chrome
function updateHud() {
    document.getElementById('score').textContent = String(state.score);
    document.getElementById('combo').textContent = String(state.combo);
    document.getElementById('accuracy').textContent = `${Math.round(accuracy() * 100)}%`;
}

function setStatus(text) {
    document.getElementById('status').textContent = text;
}

function showOverlay(visible) {
    document.getElementById('overlay').classList.toggle('hidden', !visible);
}

// -------------------------------------------------------------------- sound
// A triangle voice per hit, pitched at that note of the melody, so a clean run
// plays the hymn. Everything is guarded: where audio is unavailable (a headless
// test run) the game plays on in silence.
let audioCtx = null;

function ensureAudio() {
    if (audioCtx) return audioCtx;
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        audioCtx = new Ctor();
    } catch (err) {
        audioCtx = null;
    }
    return audioCtx;
}

function playNote(pitch, judgement) {
    const ac = ensureAudio();
    if (!ac) return;
    try {
        if (ac.state === 'suspended') ac.resume();
        const midi = pitchToMidi(pitch);
        if (!(midi > 0)) return;
        const now = ac.currentTime;
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = judgement === 'perfect' ? 'triangle' : 'sine';
        osc.frequency.value = midiToFreq(midi);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(judgement === 'good' ? 0.12 : 0.2, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
        osc.connect(gain).connect(ac.destination);
        osc.start(now);
        osc.stop(now + 0.6);
    } catch (err) {
        /* silence is fine */
    }
}

// ------------------------------------------------------------------- input
const KEY_LANES = {
    d: 0, f: 1, j: 2, k: 3,
    arrowleft: 0, arrowdown: 1, arrowup: 2, arrowright: 3,
};

function playOrReplay() {
    ensureAudio();
    if (state.phase === 'paused') {
        togglePause();
        return;
    }
    document.getElementById('btn-play').textContent = 'Play';
    startSong();
}

document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const key = event.key.toLowerCase();

    if (key in KEY_LANES) {
        event.preventDefault();
        ensureAudio();
        pressLane(KEY_LANES[key]);
        draw();
        return;
    }

    if (key === ' ' || key === 'enter' || key === 'spacebar') {
        event.preventDefault();
        if (state.phase !== 'playing') playOrReplay();
        return;
    }

    if (key === 'p' || key === 'escape') {
        event.preventDefault();
        togglePause();
        return;
    }

    if (key === 'r') {
        ensureAudio();
        startSong();
        return;
    }

    if (key >= '1' && key <= String(SONGS.length)) {
        selectSong(Number(key) - 1);
    }
});

document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key in KEY_LANES) releaseLane(KEY_LANES[key]);
});

function canvasLane(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    return laneFromX(x);
}

canvas.addEventListener('pointerdown', (event) => {
    ensureAudio();
    const lane = canvasLane(event);
    if (lane < 0) return;
    if (state.phase === 'ready' || state.phase === 'finished') {
        playOrReplay();
        return;
    }
    pressLane(lane);
    draw();
});

canvas.addEventListener('pointerup', (event) => {
    const lane = canvasLane(event);
    if (lane >= 0) releaseLane(lane);
});

document.getElementById('btn-play').addEventListener('click', playOrReplay);
document.querySelectorAll('.song-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectSong(Number(btn.dataset.song)));
});
document.querySelectorAll('.speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => setSpeed(Number(btn.dataset.speed)));
});

// ------------------------------------------------------------------- start
selectSong(0);
setSpeed(1);
requestAnimationFrame(frame);
