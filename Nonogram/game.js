(() => {
    'use strict';

    // ---------------------------------------------------------------------
    // Built-in puzzles. '#' = filled, anything else = empty. Each is a
    // rectangular block of equal-length rows.
    // ---------------------------------------------------------------------
    const PUZZLES = [
        {
            name: 'Heart',
            rows: [
                '.##....##.',
                '##########',
                '##########',
                '##########',
                '.########.',
                '..######..',
                '...####...',
                '....##....',
                '..........',
                '..........',
            ],
        },
        {
            name: 'Diamond',
            rows: [
                '....##....',
                '...####...',
                '..######..',
                '.########.',
                '##########',
                '##########',
                '.########.',
                '..######..',
                '...####...',
                '....##....',
            ],
        },
        {
            name: 'Invader',
            rows: [
                '..#....#..',
                '...#..#...',
                '..######..',
                '.##.##.##.',
                '##########',
                '#.######.#',
                '#.#....#.#',
                '...##.##..',
                '..........',
                '..........',
            ],
        },
    ];

    // ---------------------------------------------------------------------
    // Geometry
    // ---------------------------------------------------------------------
    const CELL = 32;
    const ORIGIN_X = 104;   // left gutter for row clues
    const ORIGIN_Y = 104;   // top gutter for column clues

    // ---------------------------------------------------------------------
    // Pure helper: run-length clue for a boolean line ([0] when empty).
    // ---------------------------------------------------------------------
    function lineClue(bools) {
        const runs = [];
        let count = 0;
        for (const b of bools) {
            if (b) {
                count++;
            } else if (count > 0) {
                runs.push(count);
                count = 0;
            }
        }
        if (count > 0) runs.push(count);
        return runs.length ? runs : [0];
    }

    function arraysEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    // ---------------------------------------------------------------------
    // Game object (state + logic). Exposed as window.game.
    // ---------------------------------------------------------------------
    const game = {
        CELL, ORIGIN_X, ORIGIN_Y,
        COLS: 0, ROWS: 0,
        grid: [], solution: [], rowClues: [], colClues: [],
        state: 'ready', puzzleIndex: 0,
        lineClue,
        toggleFill, toggleMark, setCell,
        isSolved, mistakes, reset,
        loadPuzzle, loadBuiltin, start,
    };

    function column(x) {
        const col = [];
        for (let y = 0; y < game.ROWS; y++) col.push(!!game.solution[y][x]);
        return col;
    }

    function loadPuzzle(rows) {
        game.ROWS = rows.length;
        game.COLS = rows[0].length;
        game.solution = rows.map((r) => r.split('').map((c) => c === '#'));
        game.rowClues = game.solution.map((row) => lineClue(row));
        game.colClues = [];
        for (let x = 0; x < game.COLS; x++) game.colClues.push(lineClue(column(x)));
        game.grid = Array.from({ length: game.ROWS },
            () => Array(game.COLS).fill(0));
        game.state = 'playing';
        cursor = { x: 0, y: 0 };
        resizeCanvas();
        syncHud();
        render();
    }

    function loadBuiltin(i) {
        game.puzzleIndex = ((i % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
        loadPuzzle(PUZZLES[game.puzzleIndex].rows);
    }

    function inBounds(x, y) {
        return x >= 0 && x < game.COLS && y >= 0 && y < game.ROWS;
    }

    function setCell(x, y, s) {
        if (!inBounds(x, y)) return false;
        game.grid[y][x] = s;
        afterChange();
        return true;
    }

    function toggleFill(x, y) {
        if (!inBounds(x, y)) return false;
        game.grid[y][x] = game.grid[y][x] === 1 ? 0 : 1;
        afterChange();
        return true;
    }

    function toggleMark(x, y) {
        if (!inBounds(x, y)) return false;
        game.grid[y][x] = game.grid[y][x] === 2 ? 0 : 2;
        afterChange();
        return true;
    }

    function afterChange() {
        syncHud();
        render();
        if (game.state === 'playing' && isSolved()) win();
    }

    function isSolved() {
        for (let y = 0; y < game.ROWS; y++) {
            const filled = game.grid[y].map((c) => c === 1);
            if (!arraysEqual(lineClue(filled), game.rowClues[y])) return false;
        }
        for (let x = 0; x < game.COLS; x++) {
            const filled = [];
            for (let y = 0; y < game.ROWS; y++) filled.push(game.grid[y][x] === 1);
            if (!arraysEqual(lineClue(filled), game.colClues[x])) return false;
        }
        return true;
    }

    function mistakes() {
        let n = 0;
        for (let y = 0; y < game.ROWS; y++) {
            for (let x = 0; x < game.COLS; x++) {
                if (game.grid[y][x] === 1 && !game.solution[y][x]) n++;
            }
        }
        return n;
    }

    function reset() {
        game.grid = Array.from({ length: game.ROWS },
            () => Array(game.COLS).fill(0));
        game.state = 'playing';
        hideOverlay();
        syncHud();
        render();
    }

    function win() {
        game.state = 'won';
        syncHud();
        render();
        showOverlay('Solved!', 'You revealed the <strong>' +
            PUZZLES[game.puzzleIndex].name + '</strong>! Press Next for another.');
    }

    function start() {
        if (game.state === 'won') reset();
        game.state = 'playing';
        hideOverlay();
        syncHud();
        render();
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    let cursor = { x: 0, y: 0 };

    function resizeCanvas() {
        canvas.width = ORIGIN_X + game.COLS * CELL;
        canvas.height = ORIGIN_Y + game.ROWS * CELL;
    }

    function render() {
        if (!game.grid.length) return;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        // Gutter backgrounds.
        ctx.fillStyle = '#221c3a';
        ctx.fillRect(0, 0, W, ORIGIN_Y);
        ctx.fillRect(0, 0, ORIGIN_X, H);

        // Clue text.
        ctx.fillStyle = '#d8ccf5';
        ctx.font = '14px "Segoe UI", sans-serif';
        // Row clues (right-aligned in the left gutter).
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'right';
        for (let y = 0; y < game.ROWS; y++) {
            const clue = game.rowClues[y];
            const cy = ORIGIN_Y + y * CELL + CELL / 2;
            const text = clue.join('  ');
            ctx.fillText(text, ORIGIN_X - 8, cy);
        }
        // Column clues (bottom-aligned in the top gutter, stacked vertically).
        ctx.textAlign = 'center';
        for (let x = 0; x < game.COLS; x++) {
            const clue = game.colClues[x];
            const cx = ORIGIN_X + x * CELL + CELL / 2;
            for (let i = 0; i < clue.length; i++) {
                const cy = ORIGIN_Y - 10 - (clue.length - 1 - i) * 16;
                ctx.fillText(String(clue[i]), cx, cy);
            }
        }

        // Cells.
        for (let y = 0; y < game.ROWS; y++) {
            for (let x = 0; x < game.COLS; x++) {
                const px = ORIGIN_X + x * CELL;
                const py = ORIGIN_Y + y * CELL;
                const s = game.grid[y][x];
                ctx.fillStyle = (x + y) % 2 === 0 ? '#241f3d' : '#201b36';
                ctx.fillRect(px, py, CELL, CELL);
                if (s === 1) {
                    ctx.fillStyle = '#c9a6ff';
                    ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
                } else if (s === 2) {
                    ctx.strokeStyle = '#8a7ba8';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(px + 9, py + 9);
                    ctx.lineTo(px + CELL - 9, py + CELL - 9);
                    ctx.moveTo(px + CELL - 9, py + 9);
                    ctx.lineTo(px + 9, py + CELL - 9);
                    ctx.stroke();
                }
            }
        }

        // Grid lines (heavier every 5 cells).
        for (let x = 0; x <= game.COLS; x++) {
            ctx.strokeStyle = x % 5 === 0 ? '#5a4d85' : '#332b52';
            ctx.lineWidth = x % 5 === 0 ? 2 : 1;
            const px = ORIGIN_X + x * CELL + 0.5;
            ctx.beginPath();
            ctx.moveTo(px, ORIGIN_Y);
            ctx.lineTo(px, ORIGIN_Y + game.ROWS * CELL);
            ctx.stroke();
        }
        for (let y = 0; y <= game.ROWS; y++) {
            ctx.strokeStyle = y % 5 === 0 ? '#5a4d85' : '#332b52';
            ctx.lineWidth = y % 5 === 0 ? 2 : 1;
            const py = ORIGIN_Y + y * CELL + 0.5;
            ctx.beginPath();
            ctx.moveTo(ORIGIN_X, py);
            ctx.lineTo(ORIGIN_X + game.COLS * CELL, py);
            ctx.stroke();
        }

        // Cursor.
        if (game.state === 'playing' && inBounds(cursor.x, cursor.y)) {
            ctx.strokeStyle = '#ffd76a';
            ctx.lineWidth = 3;
            ctx.strokeRect(ORIGIN_X + cursor.x * CELL + 1.5,
                ORIGIN_Y + cursor.y * CELL + 1.5, CELL - 3, CELL - 3);
        }
    }

    // ---------------------------------------------------------------------
    // HUD & overlay
    // ---------------------------------------------------------------------
    const $name = document.getElementById('puzzle-name');
    const $mistakes = document.getElementById('mistakes');
    const $status = document.getElementById('status');
    const $overlay = document.getElementById('overlay');
    const $overlayTitle = document.getElementById('overlay-title');
    const $overlaySub = document.getElementById('overlay-sub');

    function syncHud() {
        $name.textContent = PUZZLES[game.puzzleIndex]
            ? PUZZLES[game.puzzleIndex].name : '–';
        $mistakes.textContent = String(mistakes());
        const label = { ready: 'Ready', playing: 'Solving', won: 'Solved!' };
        $status.textContent = label[game.state] || game.state;
    }

    function showOverlay(title, sub) {
        $overlayTitle.textContent = title;
        $overlaySub.innerHTML = sub;
        $overlay.classList.add('visible');
    }

    function hideOverlay() {
        $overlay.classList.remove('visible');
    }

    // ---------------------------------------------------------------------
    // Input
    // ---------------------------------------------------------------------
    function cellAt(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left - ORIGIN_X) / CELL);
        const y = Math.floor((clientY - rect.top - ORIGIN_Y) / CELL);
        return { x, y };
    }

    canvas.addEventListener('click', (e) => {
        if (game.state === 'ready') start();
        if (game.state !== 'playing') return;
        const { x, y } = cellAt(e.clientX, e.clientY);
        if (inBounds(x, y)) { cursor = { x, y }; toggleFill(x, y); }
    });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (game.state === 'ready') start();
        if (game.state !== 'playing') return;
        const { x, y } = cellAt(e.clientX, e.clientY);
        if (inBounds(x, y)) { cursor = { x, y }; toggleMark(x, y); }
    });

    window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'r') { reset(); return; }
        if (k === 'n') { loadBuiltin(game.puzzleIndex + 1); hideOverlay(); game.state = 'playing'; syncHud(); render(); return; }
        if (game.state !== 'playing') return;

        if (k === 'arrowleft' || k === 'a') { cursor.x = Math.max(0, cursor.x - 1); render(); e.preventDefault(); }
        else if (k === 'arrowright' || k === 'd') { cursor.x = Math.min(game.COLS - 1, cursor.x + 1); render(); e.preventDefault(); }
        else if (k === 'arrowup' || k === 'w') { cursor.y = Math.max(0, cursor.y - 1); render(); e.preventDefault(); }
        else if (k === 'arrowdown' || k === 's') { cursor.y = Math.min(game.ROWS - 1, cursor.y + 1); render(); e.preventDefault(); }
        else if (k === 'f' || k === ' ') { toggleFill(cursor.x, cursor.y); e.preventDefault(); }
        else if (k === 'x') { toggleMark(cursor.x, cursor.y); e.preventDefault(); }
    });

    document.getElementById('btn-start').addEventListener('click', start);
    document.getElementById('btn-reset').addEventListener('click', reset);
    document.getElementById('btn-next').addEventListener('click', () => {
        loadBuiltin(game.puzzleIndex + 1);
        hideOverlay();
        game.state = 'playing';
        syncHud();
        render();
    });

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------
    window.game = game;
    window.PUZZLES = PUZZLES;
    loadBuiltin(0);
    game.state = 'ready';   // show the start overlay until the player begins
    syncHud();
    render();
})();
