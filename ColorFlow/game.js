(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Palette — maps a colour character to a display colour. Keys are the
    // letters used in level definitions; any letter not listed falls back to
    // a generated hue so custom levels still render.
    // ---------------------------------------------------------------------
    const PALETTE = {
        A: '#e6194b', B: '#4363d8', C: '#3cb44b', D: '#f58231',
        E: '#ffe119', F: '#911eb4', G: '#00c2c7', H: '#f032e6',
        R: '#e6194b', Y: '#ffe119', O: '#f58231', P: '#911eb4', M: '#f032e6',
    };

    function colorFor(ch) {
        if (PALETTE[ch]) return PALETTE[ch];
        // Deterministic fallback hue from the char code.
        const hue = (ch.charCodeAt(0) * 47) % 360;
        return `hsl(${hue}, 70%, 55%)`;
    }

    // ---------------------------------------------------------------------
    // Built-in levels. Each is authored from a full-board tiling, so a
    // 100%-coverage solution is guaranteed to exist. Every letter appears
    // exactly twice — the two endpoints of that colour's pipe.
    // ---------------------------------------------------------------------
    const LEVELS = [
        // 0 — 5x5, 3 colours (intro)
        [
            'A....',
            'A....',
            'B...B',
            'C....',
            'C....',
        ],
        // 1 — 5x5, 4 colours
        [
            'A...A',
            'B...B',
            'C..D.',
            '.....',
            '..C.D',
        ],
        // 2 — 6x6, 6 colours
        [
            'A....A',
            'CE...D',
            '.E....',
            '.F....',
            'CF...D',
            'B....B',
        ],
        // 3 — 7x7, 7 colours
        [
            'A.....A',
            'CE...ED',
            '.F.....',
            '.F.....',
            '.G.....',
            'CG....D',
            'B.....B',
        ],
    ];

    // ---------------------------------------------------------------------
    // Model state
    // ---------------------------------------------------------------------
    let rows = 0;
    let cols = 0;
    let endpointColor = [];   // [r][c] -> char | null  (which cells are dots)
    let cellColor = [];       // [r][c] -> char | null  (current occupant)
    let paths = {};           // char -> ordered array of [r, c]
    let colors = [];          // list of colour chars in the level
    let currentLevel = 0;

    let drawing = false;
    let activeColor = null;
    let activeComplete = false;

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function inBounds(r, c) {
        return r >= 0 && r < rows && c >= 0 && c < cols;
    }

    function isEndpoint(r, c) {
        return inBounds(r, c) && endpointColor[r][c] != null;
    }

    function getColorAt(r, c) {
        return inBounds(r, c) ? cellColor[r][c] : null;
    }

    function adjacent(a, b) {
        return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
    }

    function indexOfCell(path, r, c) {
        for (let i = 0; i < path.length; i++) {
            if (path[i][0] === r && path[i][1] === c) return i;
        }
        return -1;
    }

    // Drop cells [from..end] of a colour's path, clearing their colour unless
    // they are endpoints (endpoints keep their colour permanently).
    function truncatePath(color, from) {
        const p = paths[color];
        for (let k = from; k < p.length; k++) {
            const [r, c] = p[k];
            if (!isEndpoint(r, c)) cellColor[r][c] = null;
        }
        p.length = Math.max(0, from);
    }

    function isColorComplete(color) {
        const p = paths[color];
        if (!p || p.length < 2) return false;
        const a = p[0];
        const b = p[p.length - 1];
        return (
            isEndpoint(a[0], a[1]) && endpointColor[a[0]][a[1]] === color &&
            isEndpoint(b[0], b[1]) && endpointColor[b[0]][b[1]] === color &&
            !(a[0] === b[0] && a[1] === b[1])
        );
    }

    function connectedCount() {
        return colors.filter(isColorComplete).length;
    }

    function filledCount() {
        let n = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (cellColor[r][c] != null) n++;
            }
        }
        return n;
    }

    function flowPercent() {
        const total = rows * cols;
        return total === 0 ? 0 : Math.round((filledCount() / total) * 100);
    }

    function allFilled() {
        return filledCount() === rows * cols;
    }

    function isWon() {
        return colors.length > 0 && connectedCount() === colors.length && allFilled();
    }

    // ---------------------------------------------------------------------
    // Level loading
    // ---------------------------------------------------------------------
    function parseLevel(def) {
        rows = def.length;
        cols = def[0].length;
        endpointColor = [];
        cellColor = [];
        paths = {};
        const seen = {};
        for (let r = 0; r < rows; r++) {
            endpointColor.push(new Array(cols).fill(null));
            cellColor.push(new Array(cols).fill(null));
            for (let c = 0; c < cols; c++) {
                const ch = def[r][c];
                if (ch && ch !== '.') {
                    endpointColor[r][c] = ch;
                    cellColor[r][c] = ch;
                    seen[ch] = true;
                }
            }
        }
        colors = Object.keys(seen).sort();
        colors.forEach((col) => { paths[col] = []; });
        resetDrawState();
    }

    function resetDrawState() {
        drawing = false;
        activeColor = null;
        activeComplete = false;
    }

    function loadCustomLevel(def) {
        parseLevel(def);
        hideOverlay();
        afterChange();
    }

    function loadLevel(idx) {
        currentLevel = ((idx % LEVELS.length) + LEVELS.length) % LEVELS.length;
        parseLevel(LEVELS[currentLevel]);
        hideOverlay();
        setLevelLabel(currentLevel + 1);
        afterChange();
    }

    function resetLevel() {
        colors.forEach((col) => {
            const p = paths[col];
            for (let k = 0; k < p.length; k++) {
                const [r, c] = p[k];
                if (!isEndpoint(r, c)) cellColor[r][c] = null;
            }
            paths[col] = [];
        });
        resetDrawState();
        afterChange();
    }

    function nextLevel() {
        loadLevel(currentLevel + 1);
    }

    // ---------------------------------------------------------------------
    // Drawing API
    // ---------------------------------------------------------------------
    function startPath(r, c) {
        if (!inBounds(r, c)) return false;
        const ep = endpointColor[r][c];
        if (ep != null) {
            // Fresh pipe anchored at this endpoint.
            truncatePath(ep, 0);
            paths[ep] = [[r, c]];
            cellColor[r][c] = ep;
            activeColor = ep;
            activeComplete = false;
            drawing = true;
            return true;
        }
        const cc = cellColor[r][c];
        if (cc != null) {
            // Continue an existing pipe from this cell (truncate the rest).
            const idx = indexOfCell(paths[cc], r, c);
            if (idx !== -1) truncatePath(cc, idx + 1);
            activeColor = cc;
            activeComplete = isColorComplete(cc);
            drawing = true;
            return true;
        }
        return false;
    }

    function extendPath(r, c) {
        if (!drawing || activeColor == null || activeComplete) return false;
        if (!inBounds(r, c)) return false;
        const p = paths[activeColor];
        const head = p[p.length - 1];
        if (!adjacent(head, [r, c])) return false;

        // Backtrack: target already part of this pipe -> pull back to it.
        const idx = indexOfCell(p, r, c);
        if (idx !== -1) {
            truncatePath(activeColor, idx + 1);
            activeComplete = false;
            afterChange();
            return true;
        }

        const ep = endpointColor[r][c];
        if (ep != null) {
            if (ep !== activeColor) return false; // never overwrite another dot
            // Our matching endpoint -> complete.
            p.push([r, c]);
            cellColor[r][c] = activeColor;
            activeComplete = true;
            afterChange();
            return true;
        }

        // Empty cell, or a cell owned by another colour's pipe.
        const occ = cellColor[r][c];
        if (occ != null && occ !== activeColor) {
            const oi = indexOfCell(paths[occ], r, c);
            if (oi !== -1) truncatePath(occ, oi); // cut the other pipe here
        }
        p.push([r, c]);
        cellColor[r][c] = activeColor;
        activeComplete = false;
        afterChange();
        return true;
    }

    function endPath() {
        drawing = false;
        activeColor = null;
        activeComplete = false;
        afterChange();
    }

    // Convenience for tests / scripted play: draw a whole pipe at once.
    function drawPath(cells) {
        if (!cells || cells.length === 0) return false;
        if (!startPath(cells[0][0], cells[0][1])) return false;
        for (let i = 1; i < cells.length; i++) {
            if (!extendPath(cells[i][0], cells[i][1])) {
                endPath();
                return false;
            }
        }
        endPath();
        return true;
    }

    function getState() {
        const clonedPaths = {};
        colors.forEach((col) => {
            clonedPaths[col] = paths[col].map(([r, c]) => [r, c]);
        });
        const cells = cellColor.map((row) => row.slice());
        return {
            rows,
            cols,
            colorCount: colors.length,
            connectedCount: connectedCount(),
            flowPercent: flowPercent(),
            paths: clonedPaths,
            cells,
            level: currentLevel + 1,
            won: isWon(),
        };
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------
    const canvas = document.getElementById('canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    function geometry() {
        const pad = 14;
        const usable = Math.min(canvas.width, canvas.height) - pad * 2;
        const cell = Math.floor(usable / Math.max(rows, cols));
        const gridW = cell * cols;
        const gridH = cell * rows;
        const ox = Math.floor((canvas.width - gridW) / 2);
        const oy = Math.floor((canvas.height - gridH) / 2);
        return { cell, ox, oy };
    }

    function cellCenter(r, c, g) {
        return [g.ox + c * g.cell + g.cell / 2, g.oy + r * g.cell + g.cell / 2];
    }

    function render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (rows === 0) return;
        const g = geometry();

        // Grid cells
        ctx.strokeStyle = '#2b3242';
        ctx.lineWidth = 1;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                ctx.strokeRect(g.ox + c * g.cell, g.oy + r * g.cell, g.cell, g.cell);
            }
        }

        // Pipes
        const thickness = Math.max(6, Math.floor(g.cell * 0.34));
        colors.forEach((col) => {
            const p = paths[col];
            if (p.length < 2) return;
            ctx.strokeStyle = colorFor(col);
            ctx.lineWidth = thickness;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            for (let i = 0; i < p.length; i++) {
                const [x, y] = cellCenter(p[i][0], p[i][1], g);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        // Endpoints (dots)
        const radius = Math.max(7, Math.floor(g.cell * 0.28));
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const ch = endpointColor[r][c];
                if (ch == null) continue;
                const [x, y] = cellCenter(r, c, g);
                ctx.fillStyle = colorFor(ch);
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                ctx.fill();
                if (isColorComplete(ch)) {
                    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // HUD / overlay
    // ---------------------------------------------------------------------
    const elLevel = document.getElementById('level');
    const elPipes = document.getElementById('pipes');
    const elFlow = document.getElementById('flow');
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlaySub = document.getElementById('overlay-sub');

    function setLevelLabel(n) {
        if (elLevel) elLevel.textContent = String(n);
    }

    function updateHud() {
        if (elPipes) elPipes.textContent = `${connectedCount()} / ${colors.length}`;
        if (elFlow) elFlow.textContent = `${flowPercent()}%`;
    }

    function hideOverlay() {
        if (overlay) overlay.classList.remove('visible');
    }

    function showWinOverlay() {
        if (!overlay) return;
        const last = currentLevel === LEVELS.length - 1;
        overlayTitle.textContent = last ? 'You beat them all!' : 'Solved!';
        overlaySub.textContent = last
            ? 'Every level cleared. Press Reset to play again.'
            : 'Every pair connected and the board is full. Press Next for more.';
        overlay.classList.add('visible');
    }

    function afterChange() {
        updateHud();
        render();
        if (isWon()) showWinOverlay();
    }

    // ---------------------------------------------------------------------
    // Pointer input
    // ---------------------------------------------------------------------
    let lastCell = null;

    function eventCell(evt) {
        const rect = canvas.getBoundingClientRect();
        const g = geometry();
        const x = evt.clientX - rect.left;
        const y = evt.clientY - rect.top;
        const c = Math.floor((x - g.ox) / g.cell);
        const r = Math.floor((y - g.oy) / g.cell);
        if (!inBounds(r, c)) return null;
        return [r, c];
    }

    function onDown(evt) {
        if (overlay && overlay.classList.contains('visible')) return;
        const cell = eventCell(evt);
        if (!cell) return;
        if (startPath(cell[0], cell[1])) {
            lastCell = cell;
            evt.preventDefault();
        }
    }

    function onMove(evt) {
        if (!drawing) return;
        const cell = eventCell(evt);
        if (!cell) return;
        if (lastCell && cell[0] === lastCell[0] && cell[1] === lastCell[1]) return;
        if (extendPath(cell[0], cell[1])) {
            lastCell = cell;
        }
        evt.preventDefault();
    }

    function onUp(evt) {
        if (!drawing) return;
        endPath();
        lastCell = null;
        if (evt.cancelable) evt.preventDefault();
    }

    if (canvas) {
        canvas.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }

    // ---------------------------------------------------------------------
    // Buttons / keyboard
    // ---------------------------------------------------------------------
    const btnStart = document.getElementById('btn-start');
    const btnReset = document.getElementById('btn-reset');
    const btnNext = document.getElementById('btn-next');

    if (btnStart) btnStart.addEventListener('click', () => loadLevel(currentLevel));
    if (btnReset) btnReset.addEventListener('click', resetLevel);
    if (btnNext) btnNext.addEventListener('click', nextLevel);

    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'r') resetLevel();
        else if (k === 'n') nextLevel();
    });

    // ---------------------------------------------------------------------
    // Boot — load level 0 into the model (so the API works immediately) but
    // keep the intro overlay up until the player starts.
    // ---------------------------------------------------------------------
    parseLevel(LEVELS[0]);
    currentLevel = 0;
    setLevelLabel(1);
    updateHud();
    render();

    // ---------------------------------------------------------------------
    // Public API (used by the game view and by the Playwright tests)
    // ---------------------------------------------------------------------
    window.loadCustomLevel = loadCustomLevel;
    window.loadLevel = loadLevel;
    window.resetLevel = resetLevel;
    window.startPath = startPath;
    window.extendPath = extendPath;
    window.endPath = endPath;
    window.drawPath = drawPath;
    window.getState = getState;
    window.getColorAt = getColorAt;
    window.isEndpoint = isEndpoint;
    window.isColorComplete = isColorComplete;
    window.isWon = isWon;
    window.getLevelCount = () => LEVELS.length;
})();
