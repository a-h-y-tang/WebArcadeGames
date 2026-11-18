// Dry Land
// "And God said, Let the waters under the heaven be gathered together unto one
//  place, and let the dry land appear: and it was so." - Genesis 1:9
//
// A Nurikabe-style logic puzzle. Every number is a piece of dry land of that
// many squares; the rest of the board is sea. The sea must be gathered into one
// piece and may never fill a whole square of four, and two pieces of land may
// never touch.
//
// Puzzles are generated in the page: a random solution is grown, checked for a
// single answer by `countSolutions`, and then checked by `logicSolve` - the
// deductions a person would actually make - so no puzzle ever needs a guess.
// `logicSolve` also supplies the hints, each with the rule it used.

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const UNKNOWN = 0;
const SEA = 1;
const LAND = 2;

const SIZES = [
    // `merge` is how much extra land is taken out of the sea after the first
    // pass, as a fraction of the board: more makes larger islands, but harder
    // puzzles to pin down, so the big board takes less of it.
    { name: 'Small', n: 7, maxIsland: 5, merge: 0.12 },
    { name: 'Medium', n: 9, maxIsland: 5, merge: 0.12 },
    { name: 'Large', n: 11, maxIsland: 5, merge: 0.05 },
];

const MARGIN = 18;
const BEST_KEY = (i) => `dry-land-best-${i}`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let sizeIndex = 0;
let rows = SIZES[0].n;
let cols = SIZES[0].n;
let cell = 60;
let originX = MARGIN;
let originY = MARGIN;

let clues = [];
let solution = new Uint8Array(0);
let solutionSteps = [];
let grid = new Uint8Array(0);
let state = 'playing';          // playing | won
let elapsed = 0;                // seconds on the clock
let hintsUsed = 0;
let best = 0;
let wrongCells = [];
let wrongUntil = 0;
let history = [];
let stroke = null;
let paintValue = null;
let painting = false;
let seed = 1;

const cursor = { r: 0, c: 0, visible: false };

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

const el = {
    sizeLabel: document.getElementById('size-label'),
    sea: document.getElementById('sea'),
    time: document.getElementById('time'),
    bestTime: document.getElementById('best'),
    hints: document.getElementById('hints'),
    status: document.getElementById('status'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayScore: document.getElementById('overlay-score'),
    overlaySub: document.getElementById('overlay-sub'),
    btnNew: document.getElementById('btn-new'),
    btnReset: document.getElementById('btn-reset'),
    btnHint: document.getElementById('btn-hint'),
    btnCheck: document.getElementById('btn-check'),
    btnUndo: document.getElementById('btn-undo'),
    btnAgain: document.getElementById('btn-again'),
    sizeButtons: [...document.querySelectorAll('.size-btn')],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
}

function idx(r, c) {
    return r * cols + c;
}

function inside(r, c) {
    return r >= 0 && r < rows && c >= 0 && c < cols;
}

function neighbours(r, c) {
    const out = [];
    if (r > 0) out.push([r - 1, c]);
    if (r < rows - 1) out.push([r + 1, c]);
    if (c > 0) out.push([r, c - 1]);
    if (c < cols - 1) out.push([r, c + 1]);
    return out;
}

function clueAt(r, c) {
    return clues.find((cl) => cl.r === r && cl.c === c) || null;
}

function cellRect(r, c) {
    return { x: originX + c * cell, y: originY + r * cell, w: cell, h: cell };
}

function cellAt(x, y) {
    const c = Math.floor((x - originX) / cell);
    const r = Math.floor((y - originY) / cell);
    return inside(r, c) ? { r, c } : null;
}

function formatTime(secs) {
    const s = Math.max(0, Math.floor(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function layout() {
    cell = Math.floor((canvas.width - MARGIN * 2) / cols);
    originX = Math.round((canvas.width - cell * cols) / 2);
    originY = Math.round((canvas.height - cell * rows) / 2);
}

// ---------------------------------------------------------------------------
// Generating a solution
//
// Start with nothing but sea and keep breaking up the square pools: every time
// four sea squares form a block, one of them becomes dry land, joining a
// neighbouring island or starting a new one. The sea is kept in one piece at
// every step, so what comes out is always a legal answer.
// ---------------------------------------------------------------------------

function seaIsWhole(land, r0, c0) {
    let start = null;
    for (let r = 0; r < r0 && !start; r++)
        for (let c = 0; c < c0; c++) if (!land.has(r * 100 + c)) start = [r, c];
    if (!start) return false;
    const seen = new Set([start[0] * 100 + start[1]]);
    const stack = [start];
    while (stack.length) {
        const [r, c] = stack.pop();
        for (const [nr, nc] of neighbours(r, c)) {
            const k = nr * 100 + nc;
            if (land.has(k) || seen.has(k)) continue;
            seen.add(k);
            stack.push([nr, nc]);
        }
    }
    return seen.size === r0 * c0 - land.size;
}

function generateSolution(maxIsland, mergeFraction) {
    const land = new Set();
    const owner = new Map();
    const islands = [];

    const pools = () => {
        const out = [];
        for (let r = 0; r + 1 < rows; r++)
            for (let c = 0; c + 1 < cols; c++) {
                const cells = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
                if (cells.every(([rr, cc]) => !land.has(rr * 100 + cc))) out.push(cells);
            }
        return out;
    };

    let guard = 0;
    for (;;) {
        if (guard++ > rows * cols * 4) return null;
        const blocks = pools();
        if (!blocks.length) break;
        const block = blocks[Math.floor(rand() * blocks.length)];
        const options = [];
        for (const [r, c] of block) {
            const owners = new Set();
            for (const [nr, nc] of neighbours(r, c)) {
                const o = owner.get(nr * 100 + nc);
                if (o !== undefined) owners.add(o);
            }
            if (owners.size > 1) continue;                      // would join two islands
            const join = owners.size === 1 ? [...owners][0] : -1;
            if (join >= 0 && islands[join].length >= maxIsland) continue;
            options.push([r, c, join]);
        }
        if (!options.length) return null;
        for (let i = options.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
        }
        let placed = false;
        for (const [r, c, join] of options) {
            const k = r * 100 + c;
            land.add(k);
            const island = join >= 0 ? join : islands.push([]) - 1;
            owner.set(k, island);
            islands[island].push([r, c]);
            if (seaIsWhole(land, rows, cols)) {
                placed = true;
                break;
            }
            land.delete(k);
            owner.delete(k);
            islands[island].pop();
            if (join < 0) islands.pop();
        }
        if (!placed) return null;
    }
    if (islands.length < 3) return null;

    // The pools above leave a scatter of single squares. Taking a few more
    // squares out of the sea - growing a piece of land, or joining two that sit
    // one square apart - gives the map larger and more varied islands. The sea
    // only ever shrinks, so no square of four can appear; it just has to stay in
    // one piece.
    const tries = Math.round(rows * cols * mergeFraction);
    for (let t = 0; t < tries; t++) {
        const r = Math.floor(rand() * rows);
        const c = Math.floor(rand() * cols);
        const k = r * 100 + c;
        if (land.has(k)) continue;
        const touching = new Set();
        for (const [nr, nc] of neighbours(r, c)) {
            const o = owner.get(nr * 100 + nc);
            if (o !== undefined) touching.add(o);
        }
        if (touching.size < 1 || touching.size > 2) continue;
        const parts = [...touching];
        const merged = 1 + parts.reduce((n, i) => n + islands[i].length, 0);
        if (merged > maxIsland) continue;
        land.add(k);
        if (!seaIsWhole(land, rows, cols)) {
            land.delete(k);
            continue;
        }
        const keep = parts[0];
        owner.set(k, keep);
        islands[keep].push([r, c]);
        for (const other of parts.slice(1)) {
            for (const [ar, ac] of islands[other]) {
                owner.set(ar * 100 + ac, keep);
                islands[keep].push([ar, ac]);
            }
            islands[other] = [];
        }
    }
    const grown = islands.filter((cells) => cells.length);
    if (grown.length < 3) return null;
    return grown;
}

// ---------------------------------------------------------------------------
// Counting answers
//
// Every island is one of the shapes of its own size that can hold its number,
// so the puzzle is a question of fitting those shapes together without touching.
// ---------------------------------------------------------------------------

function polyominoes(sr, sc, n, allowed, cap = 4000) {
    const results = [];
    const start = sr * 100 + sc;
    const cells = [start];
    const rec = (frontier, forbidden) => {
        if (cells.length === n) {
            results.push(cells.slice());
            return;
        }
        if (results.length >= cap) return;
        for (let i = 0; i < frontier.length; i++) {
            const k = frontier[i];
            const r = Math.floor(k / 100);
            const c = k % 100;
            const nextForbidden = new Set(forbidden);
            for (let j = 0; j < i; j++) nextForbidden.add(frontier[j]);
            const nextFrontier = frontier.slice(i + 1);
            for (const [nr, nc] of neighbours(r, c)) {
                const nk = nr * 100 + nc;
                if (!allowed(nr, nc)) continue;
                if (cells.includes(nk) || nextFrontier.includes(nk) || nextForbidden.has(nk)) continue;
                nextFrontier.push(nk);
            }
            cells.push(k);
            rec(nextFrontier, nextForbidden);
            cells.pop();
            if (results.length >= cap) return;
        }
    };
    const first = [];
    for (const [nr, nc] of neighbours(sr, sc)) if (allowed(nr, nc)) first.push(nr * 100 + nc);
    rec(first, new Set([start]));
    return results;
}

function islandShapes(list) {
    const clueKeys = new Set(list.map((cl) => cl.r * 100 + cl.c));
    return list.map((cl) => {
        const self = cl.r * 100 + cl.c;
        const allowed = (r, c) => {
            const k = r * 100 + c;
            if (clueKeys.has(k) && k !== self) return false;
            for (const [nr, nc] of neighbours(r, c)) {
                const nk = nr * 100 + nc;
                if (clueKeys.has(nk) && nk !== self) return false;   // islands may not touch
            }
            return true;
        };
        return polyominoes(cl.r, cl.c, cl.n, allowed);
    });
}

function countSolutions(list, limit = 2, nodeCap = 250000) {
    const shapes = islandShapes(list);
    if (shapes.some((s) => s.length === 0)) return { solutions: 0, capped: false };
    const order = list.map((_, i) => i).sort((a, b) => shapes[a].length - shapes[b].length);
    const occupied = new Int16Array(rows * cols);
    const blocked = new Int16Array(rows * cols);
    const reachable = order.map((i) => {
        const set = new Set();
        for (const shape of shapes[i]) for (const k of shape) set.add(k);
        return set;
    });
    // suffix[d] = every square the islands from depth d onwards could still cover
    const suffix = new Array(order.length + 1);
    suffix[order.length] = new Set();
    for (let d = order.length - 1; d >= 0; d--) {
        const set = new Set(suffix[d + 1]);
        for (const k of reachable[d]) set.add(k);
        suffix[d] = set;
    }

    let solutions = 0;
    let nodes = 0;
    let capped = false;

    const place = (shape, delta) => {
        for (const k of shape) {
            const r = Math.floor(k / 100);
            const c = k % 100;
            occupied[idx(r, c)] += delta;
            for (const [nr, nc] of neighbours(r, c)) blocked[idx(nr, nc)] += delta;
        }
    };
    const fits = (shape) => {
        for (const k of shape) {
            const r = Math.floor(k / 100);
            const c = k % 100;
            if (occupied[idx(r, c)] || blocked[idx(r, c)]) return false;
        }
        return true;
    };
    const poolForced = (depth) => {
        const possible = suffix[depth];
        for (let r = 0; r + 1 < rows; r++)
            for (let c = 0; c + 1 < cols; c++) {
                let pool = true;
                for (const [rr, cc] of [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]]) {
                    if (occupied[idx(rr, cc)] || possible.has(rr * 100 + cc)) {
                        pool = false;
                        break;
                    }
                }
                if (pool) return true;
            }
        return false;
    };
    const legal = () => {
        const land = new Set();
        for (let r = 0; r < rows; r++)
            for (let c = 0; c < cols; c++) if (occupied[idx(r, c)]) land.add(r * 100 + c);
        for (let r = 0; r + 1 < rows; r++)
            for (let c = 0; c + 1 < cols; c++) {
                if (
                    !land.has(r * 100 + c) &&
                    !land.has(r * 100 + c + 1) &&
                    !land.has((r + 1) * 100 + c) &&
                    !land.has((r + 1) * 100 + c + 1)
                )
                    return false;
            }
        return seaIsWhole(land, rows, cols);
    };

    const rec = (depth) => {
        if (solutions >= limit || capped) return;
        if (++nodes > nodeCap) {
            capped = true;
            return;
        }
        if (depth === order.length) {
            if (legal()) solutions++;
            return;
        }
        if (poolForced(depth)) return;
        for (const shape of shapes[order[depth]]) {
            if (!fits(shape)) continue;
            place(shape, 1);
            rec(depth + 1);
            place(shape, -1);
            if (solutions >= limit || capped) return;
        }
    };
    rec(0);
    return { solutions, capped, nodes };
}

// ---------------------------------------------------------------------------
// Solving the way a person would
//
// Each rule below is one a player can see on the board, and every hint quotes
// the rule it came from.
// ---------------------------------------------------------------------------

function logicSolve(list, limitSteps = Infinity) {
    const g = new Uint8Array(rows * cols);
    const clueKeys = new Set(list.map((cl) => cl.r * 100 + cl.c));
    for (const cl of list) g[idx(cl.r, cl.c)] = LAND;
    const steps = [];

    const set = (r, c, v, why) => {
        if (g[idx(r, c)] !== UNKNOWN) return false;
        g[idx(r, c)] = v;
        steps.push({ r, c, v, why });
        return true;
    };
    const component = (r0, c0, match) => {
        const seen = new Set([idx(r0, c0)]);
        const stack = [[r0, c0]];
        const out = [];
        while (stack.length) {
            const [r, c] = stack.pop();
            out.push([r, c]);
            for (const [nr, nc] of neighbours(r, c)) {
                if (!match(nr, nc) || seen.has(idx(nr, nc))) continue;
                seen.add(idx(nr, nc));
                stack.push([nr, nc]);
            }
        }
        return out;
    };
    const isLand = (r, c) => g[idx(r, c)] === LAND;
    const totalSea = rows * cols - list.reduce((s, cl) => s + cl.n, 0);

    let changed = true;
    while (changed && steps.length < limitSteps) {
        changed = false;

        // A square that would join two numbers, or make an island too big, is sea.
        const biggest = list.reduce((m, cl) => Math.max(m, cl.n), 0);
        for (let r = 0; r < rows && !changed; r++)
            for (let c = 0; c < cols; c++) {
                if (g[idx(r, c)] !== UNKNOWN) continue;
                const seen = new Map();
                for (const [nr, nc] of neighbours(r, c)) {
                    if (!isLand(nr, nc)) continue;
                    const comp = component(nr, nc, isLand);
                    const key = comp.map(([a, b]) => idx(a, b)).sort((x, y) => x - y).join(',');
                    if (!seen.has(key)) seen.set(key, comp);
                }
                const parts = [...seen.values()];
                const numbered = parts.filter((comp) => comp.some(([a, b]) => clueKeys.has(a * 100 + b)));
                const joined = 1 + parts.reduce((n, comp) => n + comp.length, 0);
                let why = null;
                if (numbered.length > 1) why = 'two pieces of land may not touch';
                else if (numbered.length === 1) {
                    const cl = list.find((x) => numbered[0].some(([a, b]) => a === x.r && b === x.c));
                    if (cl && joined > cl.n) why = `the land of ${cl.n} would grow too large`;
                } else if (parts.length && joined > biggest) why = 'that land would be larger than any number';
                if (why && set(r, c, SEA, why)) {
                    changed = true;
                    break;
                }
            }
        if (changed) continue;

        // An island that already has its number is finished - the sea goes round it.
        for (const cl of list) {
            const comp = component(cl.r, cl.c, isLand);
            if (comp.length !== cl.n) continue;
            for (const [r, c] of comp)
                for (const [nr, nc] of neighbours(r, c))
                    if (set(nr, nc, SEA, `the land of ${cl.n} is complete, so the sea runs round it`))
                        changed = true;
            if (changed) break;
        }
        if (changed) continue;

        // An unfinished island with only one way to grow must grow that way.
        for (const cl of list) {
            const comp = component(cl.r, cl.c, isLand);
            if (comp.length >= cl.n) continue;
            const outs = new Set();
            for (const [r, c] of comp)
                for (const [nr, nc] of neighbours(r, c)) if (g[idx(nr, nc)] === UNKNOWN) outs.add(idx(nr, nc));
            if (outs.size === 1) {
                const k = [...outs][0];
                if (set(Math.floor(k / cols), k % cols, LAND, `the land of ${cl.n} has only one way to grow`)) {
                    changed = true;
                    break;
                }
            }
        }
        if (changed) continue;

        // A square no island can reach has to be sea.
        const reach = new Uint8Array(rows * cols);
        for (const cl of list) {
            const own = component(cl.r, cl.c, isLand);
            const ownKeys = new Set(own.map(([r, c]) => idx(r, c)));
            // Land that already carries a different number blocks the way; land with
            // no number yet might still belong to this island, so it does not.
            const touchesOther = (r, c) =>
                neighbours(r, c).some(([nr, nc]) => {
                    if (!isLand(nr, nc) || ownKeys.has(idx(nr, nc))) return false;
                    return component(nr, nc, isLand).some(([a, b]) => clueKeys.has(a * 100 + b));
                });
            const budget = cl.n - own.length;
            const dist = new Map();
            const queue = [];
            for (const [r, c] of own) {
                dist.set(idx(r, c), 0);
                queue.push([r, c]);
                reach[idx(r, c)] = 1;
            }
            for (let qi = 0; qi < queue.length; qi++) {
                const [r, c] = queue[qi];
                const d = dist.get(idx(r, c));
                if (d >= budget) continue;
                for (const [nr, nc] of neighbours(r, c)) {
                    if (dist.has(idx(nr, nc))) continue;
                    if (g[idx(nr, nc)] === SEA) continue;
                    const k = nr * 100 + nc;
                    if (clueKeys.has(k) && !(nr === cl.r && nc === cl.c)) continue;
                    if (g[idx(nr, nc)] === UNKNOWN && touchesOther(nr, nc)) continue;
                    dist.set(idx(nr, nc), d + 1);
                    reach[idx(nr, nc)] = 1;
                    queue.push([nr, nc]);
                }
            }
        }
        for (let r = 0; r < rows && !changed; r++)
            for (let c = 0; c < cols; c++)
                if (g[idx(r, c)] === UNKNOWN && !reach[idx(r, c)] && set(r, c, SEA, 'no piece of land can reach this square')) {
                    changed = true;
                    break;
                }
        if (changed) continue;

        // Three corners of a square under water: the fourth must be dry.
        for (let r = 0; r + 1 < rows && !changed; r++)
            for (let c = 0; c + 1 < cols; c++) {
                const cells = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
                const seas = cells.filter(([a, b]) => g[idx(a, b)] === SEA).length;
                const unknowns = cells.filter(([a, b]) => g[idx(a, b)] === UNKNOWN);
                if (seas === 3 && unknowns.length === 1 &&
                    set(unknowns[0][0], unknowns[0][1], LAND, 'the sea may not fill a whole square of four')) {
                    changed = true;
                    break;
                }
            }
        if (changed) continue;

        // A stretch of sea with one way out must take it, or it would be cut off.
        const done = new Set();
        for (let r = 0; r < rows && !changed; r++)
            for (let c = 0; c < cols; c++) {
                if (g[idx(r, c)] !== SEA || done.has(idx(r, c))) continue;
                const comp = component(r, c, (a, b) => g[idx(a, b)] === SEA);
                for (const [a, b] of comp) done.add(idx(a, b));
                if (comp.length === totalSea) continue;
                const outs = new Set();
                for (const [a, b] of comp)
                    for (const [na, nb] of neighbours(a, b)) if (g[idx(na, nb)] === UNKNOWN) outs.add(idx(na, nb));
                if (outs.size === 1) {
                    const k = [...outs][0];
                    if (set(Math.floor(k / cols), k % cols, SEA, 'the sea must stay in one piece')) {
                        changed = true;
                        break;
                    }
                }
            }
        if (changed) continue;

        // Dry land with no number yet has to reach one.
        for (let r = 0; r < rows && !changed; r++)
            for (let c = 0; c < cols; c++) {
                if (!isLand(r, c)) continue;
                const comp = component(r, c, isLand);
                if (comp.some(([a, b]) => clueKeys.has(a * 100 + b))) continue;
                const outs = new Set();
                for (const [a, b] of comp)
                    for (const [na, nb] of neighbours(a, b)) if (g[idx(na, nb)] === UNKNOWN) outs.add(idx(na, nb));
                if (outs.size === 1) {
                    const k = [...outs][0];
                    if (set(Math.floor(k / cols), k % cols, LAND, 'this land still has to reach its own number')) {
                        changed = true;
                        break;
                    }
                }
            }
    }

    return { grid: g, steps, solved: g.every((v) => v !== UNKNOWN) };
}

// ---------------------------------------------------------------------------
// Building a puzzle
// ---------------------------------------------------------------------------

function cluesFor(islands) {
    return islands
        .map((cells) => {
            const pick = cells[Math.floor(rand() * cells.length)];
            return { r: pick[0], c: pick[1], n: cells.length };
        })
        .sort((a, b) => a.r - b.r || a.c - b.c);
}

function solutionFrom(islands) {
    const sol = new Uint8Array(rows * cols).fill(SEA);
    for (const cells of islands) for (const [r, c] of cells) sol[idx(r, c)] = LAND;
    return sol;
}

function newPuzzle(size = sizeIndex, startSeed = null) {
    sizeIndex = Math.max(0, Math.min(SIZES.length - 1, size));
    rows = cols = SIZES[sizeIndex].n;
    layout();
    seed = (startSeed === null ? Math.floor(Math.random() * 0xffffffff) : startSeed) >>> 0 || 1;

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const started = now();
    let spare = null;        // unique, but needs more than the plain rules
    let last = null;         // anything legal at all, in case nothing better turns up

    for (let attempt = 0; attempt < 4000; attempt++) {
        const islands = generateSolution(SIZES[sizeIndex].maxIsland, SIZES[sizeIndex].merge);
        if (!islands) continue;
        const list = cluesFor(islands);
        last = { list, sol: solutionFrom(islands), steps: [] };
        const counted = countSolutions(list, 2);
        if (counted.capped || counted.solutions !== 1) continue;
        const logic = logicSolve(list);
        if (logic.solved) {
            acceptPuzzle(list, solutionFrom(islands), logic.steps);
            return;
        }
        if (!spare) spare = { list, sol: solutionFrom(islands), steps: logic.steps };
        if (now() - started > 3000) break;
    }
    const take = spare || last;
    if (take) {
        acceptPuzzle(take.list, take.sol, take.steps);
        return;
    }
    // Still nothing: fall back to the smallest board, which always builds.
    acceptPuzzle([{ r: 0, c: 0, n: 1 }], solutionFrom([[[0, 0]]]), []);
}

function acceptPuzzle(list, sol, steps) {
    clues = list;
    solution = sol;
    solutionSteps = steps;
    grid = new Uint8Array(rows * cols);
    history = [];
    stroke = null;
    wrongCells = [];
    state = 'playing';
    elapsed = 0;
    hintsUsed = 0;
    cursor.r = 0;
    cursor.c = 0;
    best = loadBest();
    hideOverlay();
    setStatus('Shade the sea; leave the numbered land dry.');
    updateHud();
}

function setSize(i) {
    newPuzzle(i, null);
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

function seaMarked() {
    let n = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] === SEA) n++;
    return n;
}

function seaTotal() {
    let n = 0;
    for (let i = 0; i < solution.length; i++) if (solution[i] === SEA) n++;
    return n;
}

function isSolved() {
    for (let i = 0; i < solution.length; i++) {
        if (solution[i] === SEA && grid[i] !== SEA) return false;
        if (solution[i] === LAND && grid[i] === SEA) return false;
    }
    return true;
}

function beginStroke() {
    stroke = [];
}

function endStroke() {
    if (stroke && stroke.length) history.push(stroke);
    stroke = null;
}

function mark(r, c, value) {
    if (!inside(r, c) || state !== 'playing') return false;
    if (clueAt(r, c)) return false;
    const i = idx(r, c);
    if (grid[i] === value) return false;
    const entry = { i, from: grid[i], to: value };
    grid[i] = value;
    if (stroke) stroke.push(entry);
    else history.push([entry]);
    wrongCells = [];
    if (isSolved()) finish();
    updateHud();
    return true;
}

function cycle(r, c, dir = 1) {
    if (!inside(r, c) || clueAt(r, c)) return;
    const order = dir >= 0 ? [UNKNOWN, SEA, LAND] : [UNKNOWN, LAND, SEA];
    const at = order.indexOf(grid[idx(r, c)]);
    mark(r, c, order[(at + 1) % 3]);
}

function undo() {
    const last = history.pop();
    if (!last) return;
    for (let i = last.length - 1; i >= 0; i--) grid[last[i].i] = last[i].from;
    wrongCells = [];
    setStatus('Taken back.');
    updateHud();
}

function reset() {
    grid = new Uint8Array(rows * cols);
    history = [];
    wrongCells = [];
    state = 'playing';
    hideOverlay();
    setStatus('Board cleared - the puzzle is the same.');
    updateHud();
}

function hint() {
    if (state !== 'playing') return null;
    let found = null;
    for (const step of solutionSteps) {
        const i = idx(step.r, step.c);
        if (clueAt(step.r, step.c)) continue;
        if (grid[i] === solution[i]) continue;
        found = { r: step.r, c: step.c, v: solution[i], why: step.why };
        break;
    }
    if (!found) {
        for (let r = 0; r < rows && !found; r++)
            for (let c = 0; c < cols; c++) {
                const i = idx(r, c);
                if (clueAt(r, c) || grid[i] === solution[i]) continue;
                found = { r, c, v: solution[i], why: 'this square belongs to the answer' };
                break;
            }
    }
    if (!found) {
        setStatus('Every square already agrees with the answer.');
        return null;
    }
    hintsUsed += 1;
    grid[idx(found.r, found.c)] = found.v;
    history.push([{ i: idx(found.r, found.c), from: UNKNOWN, to: found.v }]);
    wrongCells = [];
    const what = found.v === SEA ? 'Sea' : 'Dry land';
    setStatus(`${what} at row ${found.r + 1}, column ${found.c + 1}: ${found.why}.`);
    if (isSolved()) finish();
    updateHud();
    return found;
}

function check() {
    const bad = [];
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const i = idx(r, c);
            if (grid[i] === UNKNOWN) continue;
            if (grid[i] !== solution[i]) bad.push({ r, c });
        }
    wrongCells = bad;
    wrongUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 4000;
    if (!bad.length) setStatus('Every mark is right so far.');
    else setStatus(`${bad.length} mark${bad.length === 1 ? '' : 's'} cannot be right - they are ringed in red.`);
    updateHud();
    return bad;
}

function loadBest() {
    try {
        return Number(window.localStorage.getItem(BEST_KEY(sizeIndex))) || 0;
    } catch (e) {
        return 0;
    }
}

function finish() {
    state = 'won';
    const taken = Math.floor(elapsed);
    if (!best || taken < best) {
        best = taken;
        try {
            window.localStorage.setItem(BEST_KEY(sizeIndex), String(taken));
        } catch (e) {
            /* private browsing - the time simply is not kept */
        }
    }
    setStatus('The waters are gathered and the dry land appears.');
    showOverlay(taken);
    updateHud();
}

// ---------------------------------------------------------------------------
// HUD and overlay
// ---------------------------------------------------------------------------

function setStatus(text) {
    el.status.textContent = text;
}

function updateHud() {
    el.sizeLabel.textContent = `${SIZES[sizeIndex].name} · ${rows}x${cols}`;
    el.sea.textContent = `${seaMarked()} / ${seaTotal()}`;
    el.time.textContent = formatTime(elapsed);
    el.bestTime.textContent = best ? formatTime(best) : '--';
    el.hints.textContent = String(hintsUsed);
    el.sizeButtons.forEach((b, i) => b.classList.toggle('active', i === sizeIndex));
}

function hideOverlay() {
    el.overlay.classList.remove('visible');
}

function showOverlay(taken) {
    el.overlayTitle.textContent = 'THE DRY LAND APPEARS';
    el.overlayScore.textContent = `Time ${formatTime(taken)} · Hints ${hintsUsed}`;
    el.overlaySub.textContent =
        best === taken ? 'A new best time for this size.' : `Best for this size: ${formatTime(best)}`;
    el.overlay.classList.add('visible');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function pointerCell(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return cellAt(x, y);
}

canvas.addEventListener('mousedown', (e) => {
    const at = pointerCell(e);
    if (!at || state !== 'playing') return;
    if (clueAt(at.r, at.c)) return;
    cursor.r = at.r;
    cursor.c = at.c;
    cursor.visible = true;
    const order = e.button === 2 ? [UNKNOWN, LAND, SEA] : [UNKNOWN, SEA, LAND];
    const next = order[(order.indexOf(grid[idx(at.r, at.c)]) + 1) % 3];
    paintValue = next;
    painting = true;
    beginStroke();
    mark(at.r, at.c, next);
    e.preventDefault();
});

canvas.addEventListener('mousemove', (e) => {
    if (!painting) return;
    const at = pointerCell(e);
    if (!at) return;
    cursor.r = at.r;
    cursor.c = at.c;
    mark(at.r, at.c, paintValue);
});

const stopPainting = () => {
    if (!painting) return;
    painting = false;
    paintValue = null;
    endStroke();
};

window.addEventListener('mouseup', stopPainting);
canvas.addEventListener('mouseleave', stopPainting);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t) return;
    const at = pointerCell(t);
    if (!at || state !== 'playing') return;
    cursor.r = at.r;
    cursor.c = at.c;
    cursor.visible = true;
    if (clueAt(at.r, at.c)) return;
    const order = [UNKNOWN, SEA, LAND];
    paintValue = order[(order.indexOf(grid[idx(at.r, at.c)]) + 1) % 3];
    painting = true;
    beginStroke();
    mark(at.r, at.c, paintValue);
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (!painting) return;
    const t = e.touches[0];
    if (!t) return;
    const at = pointerCell(t);
    if (!at) return;
    cursor.r = at.r;
    cursor.c = at.c;
    mark(at.r, at.c, paintValue);
    e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', stopPainting);

window.addEventListener('keydown', (e) => {
    const move = (dr, dc) => {
        cursor.r = Math.max(0, Math.min(rows - 1, cursor.r + dr));
        cursor.c = Math.max(0, Math.min(cols - 1, cursor.c + dc));
        cursor.visible = true;
    };
    switch (e.code) {
        case 'ArrowUp': move(-1, 0); break;
        case 'ArrowDown': move(1, 0); break;
        case 'ArrowLeft': move(0, -1); break;
        case 'ArrowRight': move(0, 1); break;
        case 'Space':
        case 'Enter':
            cycle(cursor.r, cursor.c, 1);
            break;
        case 'KeyL':
            mark(cursor.r, cursor.c, LAND);
            break;
        case 'KeyS':
            mark(cursor.r, cursor.c, SEA);
            break;
        case 'Backspace':
        case 'Delete':
            mark(cursor.r, cursor.c, UNKNOWN);
            break;
        case 'KeyH': hint(); break;
        case 'KeyC': check(); break;
        case 'KeyU': undo(); break;
        case 'KeyN': newPuzzle(sizeIndex, null); break;
        case 'KeyR': reset(); break;
        default:
            return;
    }
    e.preventDefault();
});

el.btnNew.addEventListener('click', () => newPuzzle(sizeIndex, null));
el.btnReset.addEventListener('click', () => reset());
el.btnHint.addEventListener('click', () => hint());
el.btnCheck.addEventListener('click', () => check());
el.btnUndo.addEventListener('click', () => undo());
if (el.btnAgain) el.btnAgain.addEventListener('click', () => newPuzzle(sizeIndex, null));
el.sizeButtons.forEach((b, i) => b.addEventListener('click', () => setSize(i)));

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

function drawSea(x, y, w, h, r, c) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#2d6ea8');
    g.addColorStop(1, '#1d4f80');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // a couple of ripples, placed from the cell's own coordinates so they hold still
    ctx.strokeStyle = 'rgba(214, 236, 255, 0.25)';
    ctx.lineWidth = Math.max(1, cell * 0.035);
    const off = ((r * 7 + c * 5) % 3) * (cell * 0.08);
    for (let i = 1; i <= 2; i++) {
        const yy = y + h * (0.3 * i) + off;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.18, yy);
        ctx.quadraticCurveTo(x + w * 0.35, yy - h * 0.07, x + w * 0.5, yy);
        ctx.quadraticCurveTo(x + w * 0.65, yy + h * 0.07, x + w * 0.82, yy);
        ctx.stroke();
    }
}

function drawLandMark(x, y, w, h) {
    ctx.fillStyle = '#4f8a3f';
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.max(2.5, cell * 0.11);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40, 70, 30, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function draw() {
    // the board sits on parchment
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#f2e4c9');
    bg.addColorStop(1, '#e4d2ae');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const boardW = cols * cell;
    const boardH = rows * cell;

    // the water that has not been marked yet is simply sand
    ctx.fillStyle = '#f7ecd6';
    ctx.fillRect(originX, originY, boardW, boardH);

    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
            const rect = cellRect(r, c);
            const v = grid[idx(r, c)];
            if (v === SEA) drawSea(rect.x, rect.y, rect.w, rect.h, r, c);
            else if (v === LAND) {
                ctx.fillStyle = '#efe0bd';
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
                drawLandMark(rect.x, rect.y, rect.w, rect.h);
            }
        }

    // grid lines
    ctx.strokeStyle = 'rgba(90, 70, 40, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 0; r <= rows; r++) {
        const y = originY + r * cell + 0.5;
        ctx.moveTo(originX, y);
        ctx.lineTo(originX + boardW, y);
    }
    for (let c = 0; c <= cols; c++) {
        const x = originX + c * cell + 0.5;
        ctx.moveTo(x, originY);
        ctx.lineTo(x, originY + boardH);
    }
    ctx.stroke();

    // clue stones
    for (const cl of clues) {
        const rect = cellRect(cl.r, cl.c);
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = cell * 0.37;
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.2, cx, cy, r);
        g.addColorStop(0, '#fffaf0');
        g.addColorStop(1, '#d8c49a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6b5433';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#2e2415';
        ctx.font = `700 ${Math.round(cell * 0.46)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(cl.n), cx, cy + 1);
    }

    // mistakes found by Check
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (wrongCells.length && now < wrongUntil) {
        ctx.strokeStyle = '#d2322d';
        ctx.lineWidth = 3;
        for (const w of wrongCells) {
            const rect = cellRect(w.r, w.c);
            roundRect(rect.x + 3, rect.y + 3, rect.w - 6, rect.h - 6, 5);
            ctx.stroke();
        }
    } else if (wrongCells.length && now >= wrongUntil) {
        wrongCells = [];
    }

    // the board edge, and the keyboard cursor
    ctx.strokeStyle = '#6b5433';
    ctx.lineWidth = 3;
    ctx.strokeRect(originX - 1.5, originY - 1.5, boardW + 3, boardH + 3);

    if (cursor.visible) {
        const rect = cellRect(cursor.r, cursor.c);
        ctx.strokeStyle = '#c2691f';
        ctx.lineWidth = 3;
        roundRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, 4);
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------

let lastTs = 0;

function frame(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.25) : 0;
    lastTs = ts;
    if (state === 'playing') {
        const before = Math.floor(elapsed);
        elapsed += dt;
        if (Math.floor(elapsed) !== before) updateHud();
    }
    draw();
    requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

newPuzzle(0, null);
requestAnimationFrame(frame);
