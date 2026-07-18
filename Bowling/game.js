'use strict';

// ---------------------------------------------------------------------------
// Pin geometry (units of one pin-to-pin spacing "D"; head pin at origin).
// row 0 = head pin (nearest the bowler); larger row/y = deeper down the lane.
// ---------------------------------------------------------------------------
const G = Math.sqrt(3) / 2; // vertical spacing between rows for an equilateral rack

const PINS = [
    { id: 1, x: 0.0, row: 0 },
    { id: 2, x: -0.5, row: 1 }, { id: 3, x: 0.5, row: 1 },
    { id: 4, x: -1.0, row: 2 }, { id: 5, x: 0.0, row: 2 }, { id: 6, x: 1.0, row: 2 },
    { id: 7, x: -1.5, row: 3 }, { id: 8, x: -0.5, row: 3 }, { id: 9, x: 0.5, row: 3 }, { id: 10, x: 1.5, row: 3 },
].map((p) => ({ ...p, y: p.row * G }));

function pinById(id) {
    return PINS.find((p) => p.id === id);
}

// Tuning for the deterministic knock-down model.
const BALL_R = 0.62;      // lateral half-width of the ball's plough
const NEIGHBOR_R = 1.10;  // cascade reach (nearest neighbours are ~1.0 apart)
const AIM_RANGE = 1.9;    // aim in [-1,1] maps to lane x = aim * AIM_RANGE

// ---------------------------------------------------------------------------
// Pure pin physics: which standing pins fall for a ball travelling up the
// lane at lateral position ballX. Deterministic — no randomness, no clock.
// ---------------------------------------------------------------------------
function knockPins(ballX, standing) {
    const knocked = new Set();

    // 1. Direct hits: any standing pin within BALL_R laterally of the path.
    for (const p of PINS) {
        if (!standing.has(p.id)) continue;
        if (Math.abs(p.x - ballX) <= BALL_R) knocked.add(p.id);
    }

    // 2. Cascade: a fallen pin pushes a standing neighbour only when that
    //    neighbour is deeper down the lane, or further out in the same row —
    //    i.e. it is shoved away from the impact, never back toward the bowler.
    let changed = true;
    let guard = 0;
    while (changed && guard < 8) {
        changed = false;
        guard += 1;
        for (const fid of Array.from(knocked)) {
            const f = pinById(fid);
            for (const p of PINS) {
                if (!standing.has(p.id) || knocked.has(p.id)) continue;
                const dx = p.x - f.x;
                const dy = p.y - f.y;
                if (Math.hypot(dx, dy) > NEIGHBOR_R) continue;
                const deeper = p.y > f.y + 1e-6;
                const sameRowOutward = Math.abs(p.y - f.y) <= 1e-6
                    && Math.abs(p.x) > Math.abs(f.x) + 1e-6;
                if (deeper || sameRowOutward) {
                    knocked.add(p.id);
                    changed = true;
                }
            }
        }
    }
    return knocked;
}

// ---------------------------------------------------------------------------
// Pure scoring engine: cumulative score per frame from a flat list of rolls.
// A frame is `null` until its score (including any strike/spare bonus) is
// fully determined; once a frame is pending, later frames are pending too.
// ---------------------------------------------------------------------------
function frameScores(rs) {
    const frames = [];
    let i = 0;
    let total = 0;
    let pending = false;

    for (let f = 0; f < 10; f++) {
        if (pending || rs[i] === undefined) { frames.push(null); continue; }

        const first = rs[i];
        let frameScore;
        let scorable;

        if (first === 10) { // strike
            if (rs[i + 1] !== undefined && rs[i + 2] !== undefined) {
                frameScore = 10 + rs[i + 1] + rs[i + 2];
                scorable = true;
            } else {
                scorable = false;
            }
            i += 1;
        } else if (rs[i + 1] !== undefined && first + rs[i + 1] === 10) { // spare
            if (rs[i + 2] !== undefined) {
                frameScore = 10 + rs[i + 2];
                scorable = true;
            } else {
                scorable = false;
            }
            i += 2;
        } else { // open frame
            if (rs[i + 1] !== undefined) {
                frameScore = first + rs[i + 1];
                scorable = true;
            } else {
                scorable = false;
            }
            i += 2;
        }

        if (scorable) {
            total += frameScore;
            frames.push(total);
        } else {
            frames.push(null);
            pending = true;
        }
    }
    return frames;
}

function totalScore() {
    const f = frameScores(rolls);
    for (let i = f.length - 1; i >= 0; i--) {
        if (f[i] !== null) return f[i];
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Game state & frame/ball flow
// ---------------------------------------------------------------------------
let rolls = [];
let tenth = [];          // rolls thrown in the 10th frame
let frame = 1;           // 1..10
let ballInFrame = 1;     // 1 or 2 (frames 1-9)
let over = false;
let rackFresh = true;    // does the pending ball face a full rack?
let standing = new Set();
let state = 'idle';      // idle | aiming | over

function allPinIds() {
    return new Set(PINS.map((p) => p.id));
}

function standingPins() {
    return Array.from(standing).sort((a, b) => a - b);
}

function newGame() {
    rolls = [];
    tenth = [];
    frame = 1;
    ballInFrame = 1;
    over = false;
    rackFresh = true;
    standing = allPinIds();
    state = 'idle';
    render();
    updateScorecard();
    return true;
}

// Record one ball of `count` pins and advance the frame/ball state machine.
function roll(count) {
    if (over) return false;
    rolls.push(count);

    if (frame < 10) {
        if (ballInFrame === 1) {
            if (count === 10) { // strike
                frame += 1;
                ballInFrame = 1;
                rackFresh = true;
            } else {
                ballInFrame = 2;
                rackFresh = false;
            }
        } else { // second ball of the frame
            frame += 1;
            ballInFrame = 1;
            rackFresh = true;
        }
    } else { // 10th frame — up to three balls
        tenth.push(count);
        const n = tenth.length;
        const b1 = tenth[0];
        const b2 = tenth[1];
        if (n === 1) {
            rackFresh = (count === 10);
        } else if (n === 2) {
            if (b1 === 10) {
                rackFresh = (b2 === 10);           // strike then strike -> fresh rack for 3rd
            } else if (b1 + b2 === 10) {
                rackFresh = true;                   // spare -> 3rd ball on a fresh rack
            } else {
                over = true;                        // open 10th -> done
            }
        } else { // n === 3
            over = true;
        }
    }

    // When the next ball faces a full rack, refill the visual rack so the
    // aim view shows ten standing pins between frames.
    if (rackFresh) standing = allPinIds();

    updateScorecard();
    return true;
}

// UI / physics entry point: knock pins from the current rack, feed the count
// into the same flow logic.
function bowl(aim) {
    if (over) return false;
    if (rackFresh) standing = allPinIds();
    const ballX = aim * AIM_RANGE;
    const knocked = knockPins(ballX, standing);
    for (const id of knocked) standing.delete(id);
    const count = knocked.size;

    startBallAnimation(ballX, knocked);
    roll(count);
    if (over) {
        state = 'over';
        showOverlay(true);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Browser glue (guarded so the pure logic stays head-less testable)
// ---------------------------------------------------------------------------
const hasDOM = typeof document !== 'undefined';

let canvas = null;
let ctx = null;
let elTotal = null;
let elFrameNo = null;
let elScorecard = null;
let elOverlay = null;
let elOverlayTitle = null;
let elOverlayScore = null;

let aim = 0;             // current aim in [-1, 1]
let animating = false;
let anim = null;

// Canvas layout
const CW = 420;
const CH = 560;
const CX = CW / 2;
const PIN_PX = 30;       // px per D unit horizontally
const ROW_PX = 40;       // px per row vertically
const HEAD_Y = 150;      // canvas y of the head pin
const BALL_START_Y = 500;
const BALL_R_PX = 12;

function pinCanvasPos(p) {
    return { x: CX + p.x * PIN_PX, y: HEAD_Y - p.row * ROW_PX };
}
function ballCanvasX(ballX) {
    return CX + ballX * PIN_PX;
}

function startBallAnimation(ballX, knocked) {
    if (!hasDOM) return;
    animating = true;
    anim = { ballX, knocked, y: BALL_START_Y, done: false };
}

function updateScorecard() {
    if (!hasDOM) return;
    if (elTotal) elTotal.textContent = String(totalScore());
    if (elFrameNo) elFrameNo.textContent = over ? '—' : String(Math.min(frame, 10));
    if (!elScorecard) return;

    const scores = frameScores(rolls);
    // Split rolls into per-frame ball displays.
    const cells = [];
    let i = 0;
    for (let f = 0; f < 10; f++) {
        const balls = [];
        if (f < 9) {
            if (rolls[i] === 10) { balls.push('X'); i += 1; }
            else if (rolls[i] !== undefined) {
                const a = rolls[i];
                const b = rolls[i + 1];
                balls.push(a === 0 ? '-' : String(a));
                if (b !== undefined) balls.push((a + b === 10) ? '/' : (b === 0 ? '-' : String(b)));
                i += 2;
            }
        } else {
            // 10th frame: up to three balls
            for (let k = 0; k < 3 && rolls[i] !== undefined; k++) {
                const v = rolls[i];
                const prev = balls[balls.length - 1];
                if (v === 10) balls.push('X');
                else if (k > 0 && prev !== 'X' && prev !== undefined
                    && (rolls[i - 1] + v === 10) && rolls[i - 1] !== 10) balls.push('/');
                else balls.push(v === 0 ? '-' : String(v));
                i += 1;
            }
        }
        cells.push({ balls, score: scores[f] });
    }

    let html = '<table><tr>';
    for (let f = 0; f < 10; f++) html += `<th>${f + 1}</th>`;
    html += '</tr><tr class="balls">';
    for (const c of cells) html += `<td>${c.balls.join(' ') || '&nbsp;'}</td>`;
    html += '</tr><tr class="cum">';
    for (const c of cells) html += `<td>${c.score === null || c.score === undefined ? '&nbsp;' : c.score}</td>`;
    html += '</tr></table>';
    elScorecard.innerHTML = html;
}

function showOverlay(isOver) {
    if (!elOverlay) return;
    elOverlay.classList.add('visible');
    if (isOver) {
        elOverlayTitle.textContent = totalScore() === 300 ? 'PERFECT! 🎳' : 'Game Over';
        elOverlayScore.textContent = `Final score: ${totalScore()}`;
    }
}

function hideOverlay() {
    if (elOverlay) elOverlay.classList.remove('visible');
}

function startGame() {
    newGame();
    state = 'aiming';
    hideOverlay();
    updateScorecard();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, CW, CH);

    // Lane
    const laneLeft = CX - 3.0 * PIN_PX;
    const laneRight = CX + 3.0 * PIN_PX;
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(0, 0, CW, CH);
    // gutters
    ctx.fillStyle = '#1b2233';
    ctx.fillRect(laneLeft - 22, 0, 22, CH);
    ctx.fillRect(laneRight, 0, 22, CH);
    // lane surface
    const grad = ctx.createLinearGradient(0, 0, 0, CH);
    grad.addColorStop(0, '#c98a3c');
    grad.addColorStop(1, '#e8b160');
    ctx.fillStyle = grad;
    ctx.fillRect(laneLeft, 0, laneRight - laneLeft, CH);
    // lane boards
    ctx.strokeStyle = 'rgba(120,70,20,0.35)';
    ctx.lineWidth = 1;
    for (let b = 1; b < 7; b++) {
        const x = laneLeft + (b / 7) * (laneRight - laneLeft);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CH);
        ctx.stroke();
    }
    // foul line
    ctx.strokeStyle = '#7a3b12';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(laneLeft, BALL_START_Y + 24);
    ctx.lineTo(laneRight, BALL_START_Y + 24);
    ctx.stroke();

    // Pins
    for (const p of PINS) {
        const pos = pinCanvasPos(p);
        const up = standing.has(p.id);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = up ? '#fdfdfd' : 'rgba(120,120,120,0.28)';
        ctx.fill();
        if (up) {
            ctx.strokeStyle = '#e2453a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 9, Math.PI * 0.15, Math.PI * 0.85);
            ctx.stroke();
        }
    }

    // Aim guide + ball (only while aiming)
    if (state === 'aiming' && !animating) {
        const bx = ballCanvasX(aim * AIM_RANGE);
        ctx.setLineDash([6, 8]);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx, BALL_START_Y);
        ctx.lineTo(bx, HEAD_Y);
        ctx.stroke();
        ctx.setLineDash([]);
        drawBall(bx, BALL_START_Y);
    }

    // Rolling ball
    if (animating && anim) {
        drawBall(ballCanvasX(anim.ballX), anim.y);
    }
}

function drawBall(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, BALL_R_PX, 0, Math.PI * 2);
    ctx.fillStyle = '#2b7cff';
    ctx.fill();
    ctx.strokeStyle = '#0e3f9e';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function loop() {
    if (animating && anim) {
        anim.y -= 22;
        if (anim.y <= HEAD_Y - 3 * ROW_PX - 10) {
            animating = false;
            anim = null;
            if (state === 'over') showOverlay(true);
        }
    }
    render();
    requestAnimationFrame(loop);
}

if (hasDOM) {
    document.addEventListener('DOMContentLoaded', () => {
        canvas = document.getElementById('canvas');
        ctx = canvas.getContext('2d');
        elTotal = document.getElementById('total');
        elFrameNo = document.getElementById('frame-no');
        elScorecard = document.getElementById('scorecard');
        elOverlay = document.getElementById('overlay');
        elOverlayTitle = document.getElementById('overlay-title');
        elOverlayScore = document.getElementById('overlay-score');

        newGame();

        const startBtn = document.getElementById('btn-start');
        if (startBtn) startBtn.addEventListener('click', startGame);

        canvas.addEventListener('mousemove', (evt) => {
            if (state !== 'aiming' || animating) return;
            const rect = canvas.getBoundingClientRect();
            const x = (evt.clientX - rect.left) * (canvas.width / rect.width);
            aim = Math.max(-1, Math.min(1, (x - CX) / (AIM_RANGE * PIN_PX)));
        });

        canvas.addEventListener('click', () => {
            if (state === 'idle' || state === 'over') { startGame(); return; }
            if (state === 'aiming' && !animating) bowl(aim);
        });

        document.addEventListener('keydown', (evt) => {
            if (evt.key === 'ArrowLeft' || evt.key === 'a' || evt.key === 'A') {
                aim = Math.max(-1, aim - 0.06);
            } else if (evt.key === 'ArrowRight' || evt.key === 'd' || evt.key === 'D') {
                aim = Math.min(1, aim + 0.06);
            } else if (evt.code === 'Space') {
                evt.preventDefault();
                if (state === 'idle' || state === 'over') startGame();
                else if (state === 'aiming' && !animating) bowl(aim);
            } else if (evt.key === 'r' || evt.key === 'R') {
                startGame();
            }
        });

        requestAnimationFrame(loop);
    });
}
