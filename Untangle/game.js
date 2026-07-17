(function () {
    'use strict';

    var EPS = 1e-9;

    // -- Bundled levels -----------------------------------------------------
    // Each level is a { nodes: count, seed } config; the planar graph and its
    // scrambled starting layout are generated deterministically from the seed,
    // so a level is identical every time it loads (and reset is exact).
    var LEVELS = [
        { nodes: 6, seed: 1337 },
        { nodes: 8, seed: 4242 },
        { nodes: 10, seed: 2718 },
        { nodes: 12, seed: 31415 }
    ];

    // -- State --------------------------------------------------------------
    var canvas = document.getElementById('canvas');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var W = canvas ? canvas.width : 600;
    var H = canvas ? canvas.height : 600;
    var MARGIN = 60;
    var NODE_R = 11;         // drawn node radius
    var PICK_R = 18;         // pointer pick radius

    var nodes = [];          // [{x, y}]
    var edges = [];          // [[i, j], ...] with i < j
    var solution = [];       // [{x, y}] a known crossing-free layout
    var startPositions = []; // [{x, y}] the scrambled starting layout
    var levelIndex = 0;
    var moves = 0;
    var state = 'ready';     // 'ready' | 'running' | 'won'
    var dragIndex = -1;
    var dragMoved = false;

    // -- Deterministic RNG (mulberry32) -------------------------------------
    function makeRng(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // -- Geometry -----------------------------------------------------------
    function orient(a, b, c) {
        return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    }

    function onSegment(a, b, c) {
        // Assuming a, b, c are collinear, is c within the a–b bounding box?
        return c.x >= Math.min(a.x, b.x) - EPS && c.x <= Math.max(a.x, b.x) + EPS &&
            c.y >= Math.min(a.y, b.y) - EPS && c.y <= Math.max(a.y, b.y) + EPS;
    }

    function segmentsIntersect(p1, p2, p3, p4) {
        var d1 = orient(p3, p4, p1);
        var d2 = orient(p3, p4, p2);
        var d3 = orient(p1, p2, p3);
        var d4 = orient(p1, p2, p4);

        if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
            ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
            return true;
        }
        // Collinear / touching cases.
        if (Math.abs(d1) <= EPS && onSegment(p3, p4, p1)) return true;
        if (Math.abs(d2) <= EPS && onSegment(p3, p4, p2)) return true;
        if (Math.abs(d3) <= EPS && onSegment(p1, p2, p3)) return true;
        if (Math.abs(d4) <= EPS && onSegment(p1, p2, p4)) return true;
        return false;
    }

    // Count crossing edge pairs for a given set of positions. Edges that share
    // a node are adjacent and never counted.
    function countCrossingsFor(pos) {
        var count = 0;
        for (var i = 0; i < edges.length; i++) {
            for (var j = i + 1; j < edges.length; j++) {
                var a = edges[i][0], b = edges[i][1];
                var c = edges[j][0], d = edges[j][1];
                if (a === c || a === d || b === c || b === d) continue; // adjacent
                if (segmentsIntersect(pos[a], pos[b], pos[c], pos[d])) count++;
            }
        }
        return count;
    }

    function countCrossings() {
        return countCrossingsFor(nodes);
    }

    function solutionCrossings() {
        return countCrossingsFor(solution);
    }

    function isSolved() {
        return countCrossings() === 0;
    }

    // -- Level generation ---------------------------------------------------
    // Build a maximal planar graph by repeatedly inserting a node into a
    // triangular face and joining it to that face's three corners. Because each
    // inserted node lies strictly inside its face, the construction positions
    // are a straight-line layout with zero crossings — a guaranteed solution.
    function generatePlanar(n, rng) {
        var pos = [
            { x: W / 2, y: MARGIN },
            { x: MARGIN, y: H - MARGIN },
            { x: W - MARGIN, y: H - MARGIN }
        ];
        var eSet = {};
        var es = [];
        function addEdge(a, b) {
            var lo = Math.min(a, b), hi = Math.max(a, b);
            var key = lo + ',' + hi;
            if (!eSet[key]) { eSet[key] = true; es.push([lo, hi]); }
        }
        addEdge(0, 1); addEdge(1, 2); addEdge(0, 2);
        var faces = [[0, 1, 2]];

        while (pos.length < n) {
            var f = Math.floor(rng() * faces.length);
            var face = faces[f];
            var a = face[0], b = face[1], c = face[2];
            var k = pos.length;
            pos.push({
                x: (pos[a].x + pos[b].x + pos[c].x) / 3,
                y: (pos[a].y + pos[b].y + pos[c].y) / 3
            });
            addEdge(a, k); addEdge(b, k); addEdge(c, k);
            faces.splice(f, 1);
            faces.push([a, b, k], [b, c, k], [a, c, k]);
        }
        return { pos: pos, edges: es };
    }

    function scramble(n, rng) {
        var pos = [];
        for (var i = 0; i < n; i++) {
            pos.push({
                x: MARGIN + rng() * (W - 2 * MARGIN),
                y: MARGIN + rng() * (H - 2 * MARGIN)
            });
        }
        return pos;
    }

    function clonePos(arr) {
        return arr.map(function (p) { return { x: p.x, y: p.y }; });
    }

    function applyLevel(cfg) {
        var rng = makeRng(cfg.seed);
        var gen = generatePlanar(cfg.nodes, rng);
        solution = gen.pos;
        edges = gen.edges;

        // Scramble until the start is genuinely tangled (has crossings). A
        // random layout of a graph this dense is essentially never planar, but
        // guard anyway and stay deterministic by simply consuming more rng.
        var start = scramble(cfg.nodes, rng);
        nodes = start;
        var tries = 0;
        while (countCrossings() === 0 && tries < 200) {
            start = scramble(cfg.nodes, rng);
            nodes = start;
            tries++;
        }
        startPositions = clonePos(start);
        nodes = clonePos(start);

        moves = 0;
        window.nodes = nodes;
        window.edges = edges;
    }

    function loadLevel(i) {
        if (i < 0) i = 0;
        if (i >= LEVELS.length) i = LEVELS.length - 1;
        levelIndex = i;
        applyLevel(LEVELS[i]);
        if (state === 'won') state = 'running';
        render();
        updateHUD();
    }

    function loadCustomGraph(customNodes, customEdges) {
        nodes = clonePos(customNodes);
        edges = customEdges.map(function (e) {
            return [Math.min(e[0], e[1]), Math.max(e[0], e[1])];
        });
        solution = clonePos(customNodes);
        startPositions = clonePos(customNodes);
        moves = 0;
        if (state === 'ready') state = 'running';
        else state = 'running';
        window.nodes = nodes;
        window.edges = edges;
        hideOverlay();
        render();
        updateHUD();
    }

    function reset() {
        nodes = clonePos(startPositions);
        window.nodes = nodes;
        moves = 0;
        if (state === 'won') state = 'running';
        hideOverlay();
        render();
        updateHUD();
    }

    // -- Node interaction ---------------------------------------------------
    function pickNode(x, y) {
        var best = -1, bestD = PICK_R * PICK_R;
        for (var i = 0; i < nodes.length; i++) {
            var dx = nodes[i].x - x, dy = nodes[i].y - y;
            var d = dx * dx + dy * dy;
            if (d <= bestD) { bestD = d; best = i; }
        }
        return best;
    }

    function moveNode(i, x, y) {
        if (i < 0 || i >= nodes.length) return false;
        nodes[i].x = Math.max(0, Math.min(W, x));
        nodes[i].y = Math.max(0, Math.min(H, y));
        if (state === 'running' && isSolved()) winLevel();
        render();
        updateHUD();
        return true;
    }

    function winLevel() {
        state = 'won';
        recordBest();
        var last = levelIndex >= LEVELS.length - 1;
        showOverlay(
            'Untangled!',
            last
                ? 'Every line is clear — and that was the last level! Press Next to play again.'
                : 'No lines cross. Nicely solved — press Next for a tougher tangle.',
            last ? 'Play Again' : 'Next Level'
        );
        updateHUD();
    }

    // -- Best score (fewest moves) ------------------------------------------
    function bestKey() { return 'untangle.best.' + levelIndex; }

    function isBundled() {
        return startPositions.length === (LEVELS[levelIndex] ? LEVELS[levelIndex].nodes : -1);
    }

    function recordBest() {
        try {
            var prev = localStorage.getItem(bestKey());
            if (prev == null || moves < parseInt(prev, 10)) {
                localStorage.setItem(bestKey(), String(moves));
            }
        } catch (e) { /* ignore */ }
    }

    function bestForCurrent() {
        try {
            var v = localStorage.getItem(bestKey());
            return v == null ? null : parseInt(v, 10);
        } catch (e) { return null; }
    }

    // -- Rendering ----------------------------------------------------------
    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1d2029';
        ctx.fillRect(0, 0, W, H);

        // Which edges are involved in a crossing? Highlight them.
        var crossed = new Array(edges.length).fill(false);
        for (var i = 0; i < edges.length; i++) {
            for (var j = i + 1; j < edges.length; j++) {
                var a = edges[i][0], b = edges[i][1];
                var c = edges[j][0], d = edges[j][1];
                if (a === c || a === d || b === c || b === d) continue;
                if (segmentsIntersect(nodes[a], nodes[b], nodes[c], nodes[d])) {
                    crossed[i] = true; crossed[j] = true;
                }
            }
        }

        var solved = state === 'won' || countCrossings() === 0;

        // Edges.
        for (var e = 0; e < edges.length; e++) {
            var p = nodes[edges[e][0]], q = nodes[edges[e][1]];
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.lineWidth = crossed[e] ? 3 : 2;
            ctx.strokeStyle = crossed[e] ? '#ff6b6b' : (solved ? '#8affc1' : '#5c667e');
            ctx.stroke();
        }

        // Nodes.
        for (var n = 0; n < nodes.length; n++) {
            ctx.beginPath();
            ctx.arc(nodes[n].x, nodes[n].y, NODE_R, 0, Math.PI * 2);
            ctx.fillStyle = (n === dragIndex) ? '#ffffff' : (solved ? '#8affc1' : '#cfd6e6');
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#10251a';
            ctx.stroke();
        }
    }

    // -- HUD & overlay ------------------------------------------------------
    function updateHUD() {
        setText('level', String(levelIndex + 1));
        setText('crossings', String(countCrossings()));
        setText('moves', String(moves));
        var best = bestForCurrent();
        setText('best', best == null ? '–' : String(best));
    }

    function setText(id, txt) {
        var el = document.getElementById(id);
        if (el) el.textContent = txt;
    }

    var overlay = document.getElementById('overlay');
    var overlayTitle = document.getElementById('overlay-title');
    var overlaySub = document.getElementById('overlay-sub');
    var btnStart = document.getElementById('btn-start');

    function showOverlay(title, sub, buttonLabel) {
        if (overlayTitle) overlayTitle.textContent = title;
        if (overlaySub) overlaySub.textContent = sub;
        if (btnStart) btnStart.textContent = buttonLabel || 'Start Game';
        if (overlay) overlay.classList.add('visible');
    }

    function hideOverlay() {
        if (overlay) overlay.classList.remove('visible');
    }

    function overlayAdvance() {
        if (state === 'ready') {
            state = 'running';
            loadLevel(0);
            hideOverlay();
        } else if (state === 'won') {
            var last = levelIndex >= LEVELS.length - 1;
            hideOverlay();
            loadLevel(last ? 0 : levelIndex + 1);
            state = 'running';
        } else {
            hideOverlay();
        }
    }

    function nextLevel() {
        var last = levelIndex >= LEVELS.length - 1;
        loadLevel(last ? 0 : levelIndex + 1);
        state = 'running';
        hideOverlay();
    }

    // -- Pointer input ------------------------------------------------------
    function canvasPoint(evt) {
        var rect = canvas.getBoundingClientRect();
        var cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
        var cy = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
        // Map CSS pixels to canvas pixels in case the element is scaled.
        return { x: cx * (W / rect.width), y: cy * (H / rect.height) };
    }

    function onDown(evt) {
        if (state !== 'running') return;
        var pt = canvasPoint(evt);
        var i = pickNode(pt.x, pt.y);
        if (i >= 0) {
            dragIndex = i;
            dragMoved = false;
            evt.preventDefault();
            render();
        }
    }

    function onMove(evt) {
        if (dragIndex < 0) return;
        var pt = canvasPoint(evt);
        nodes[dragIndex].x = Math.max(0, Math.min(W, pt.x));
        nodes[dragIndex].y = Math.max(0, Math.min(H, pt.y));
        dragMoved = true;
        evt.preventDefault();
        render();
        updateHUD();
    }

    function onUp() {
        if (dragIndex < 0) return;
        if (dragMoved) {
            moves++;
            if (state === 'running' && isSolved()) winLevel();
        }
        dragIndex = -1;
        render();
        updateHUD();
    }

    // -- Keyboard -----------------------------------------------------------
    function onKey(e) {
        var k = e.key;
        if (state === 'ready') return;
        if (k === 'r' || k === 'R') { e.preventDefault(); reset(); }
        else if (k === 'n' || k === 'N') { e.preventDefault(); nextLevel(); }
    }

    // -- Wiring -------------------------------------------------------------
    if (btnStart) btnStart.addEventListener('click', overlayAdvance);
    var btnReset = document.getElementById('btn-reset');
    var btnNext = document.getElementById('btn-next');
    if (btnReset) btnReset.addEventListener('click', function () { reset(); });
    if (btnNext) btnNext.addEventListener('click', function () { nextLevel(); });
    if (canvas) {
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        canvas.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
    }
    document.addEventListener('keydown', onKey);

    // Initial paint: level 1 behind the start overlay.
    loadLevel(0);

    // -- Public API (for tests & UI) ---------------------------------------
    window.moveNode = moveNode;
    window.pickNode = pickNode;
    window.countCrossings = countCrossings;
    window.solutionCrossings = solutionCrossings;
    window.isSolved = isSolved;
    window.loadLevel = loadLevel;
    window.loadCustomGraph = loadCustomGraph;
    window.reset = reset;
    window.segmentsIntersect = segmentsIntersect;
    window.LEVELS = LEVELS;
    window.nodes = nodes;
    window.edges = edges;

    Object.defineProperty(window, 'state', { get: function () { return state; } });
    Object.defineProperty(window, 'level', { get: function () { return levelIndex; } });
    Object.defineProperty(window, 'moves', { get: function () { return moves; } });
})();
