(function () {
    'use strict';

    // ---- Arena / tuning constants ------------------------------------------
    const W = 640;
    const H = 480;

    const PLAYER_W = 44;
    const PLAYER_H = 30;
    const PLAYER_STEP = 24;          // discrete step used by movePlayer()
    const PLAYER_SPEED = 300;        // px/s for held-key movement

    const BALL_RADII = [10, 18, 28, 40];
    const BOUNCE_V = [240, 300, 350, 400];
    const GRAVITY = 520;             // px/s^2
    const SPLIT_VX = 130;
    const SPLIT_VY = 260;

    const HARPOON_SPEED = 560;       // px/s upward
    const POP_SCORE = 50;
    const LEVEL_BONUS = 200;

    const MAX_DT = 40;               // clamp a single physics substep (ms)

    // ---- State --------------------------------------------------------------
    let player;         // { x }
    let balls;          // [{ tier, x, y, vx, vy }]
    let harpoon;        // { x, topY } | null
    let level, score, lives, state;
    let leftHeld = false, rightHeld = false;
    let winTimer = null;

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const el = {
        level: document.getElementById('level'),
        score: document.getElementById('score'),
        lives: document.getElementById('lives'),
        overlay: document.getElementById('overlay'),
        overlayTitle: document.getElementById('overlay-title'),
        overlaySub: document.getElementById('overlay-sub'),
        btnStart: document.getElementById('btn-start'),
        btnReset: document.getElementById('btn-reset'),
    };

    // ---- Level layouts ------------------------------------------------------
    function layout(n) {
        switch (n) {
            case 1:
                return [{ tier: 2, x: 200, y: 150, vx: 90, vy: 0 }];
            case 2:
                return [
                    { tier: 2, x: 160, y: 150, vx: 90, vy: 0 },
                    { tier: 2, x: 480, y: 150, vx: -90, vy: 0 },
                ];
            case 3:
                return [{ tier: 3, x: 320, y: 120, vx: 80, vy: 0 }];
            default:
                // Beyond the hand-made levels: two big balls, a touch faster.
                return [
                    { tier: 3, x: 150, y: 120, vx: 80 + n * 4, vy: 0 },
                    { tier: 3, x: 490, y: 120, vx: -(80 + n * 4), vy: 0 },
                ];
        }
    }

    function layBalls(n) {
        return layout(n).map(function (b) {
            return { tier: b.tier, x: b.x, y: b.y, vx: b.vx, vy: b.vy };
        });
    }

    // ---- Lifecycle ----------------------------------------------------------
    function loadLevel(n) {
        clearTimeout(winTimer);
        winTimer = null;
        level = n;
        balls = layBalls(n);
        harpoon = null;
        player = { x: W / 2 };
        if (state !== 'ready') state = 'playing';
        updateHud();
        draw();
    }

    function reset() {
        clearTimeout(winTimer);
        winTimer = null;
        score = 0;
        lives = 3;
        level = 1;
        state = 'ready';
        balls = layBalls(1);
        harpoon = null;
        player = { x: W / 2 };
        updateHud();
        showOverlay('Pang', 'Pop every bouncing ball with your harpoon · big balls split in two');
        draw();
    }

    function start() {
        if (state === 'gameover') reset();
        state = 'playing';
        hideOverlay();
        draw();
    }

    function togglePause() {
        if (state === 'playing') { state = 'paused'; showOverlay('Paused', 'Press P to resume'); }
        else if (state === 'paused') { state = 'playing'; hideOverlay(); }
    }

    function nextLevel() {
        loadLevel(level + 1);
    }

    function winLevel() {
        state = 'won';
        score += LEVEL_BONUS;
        updateHud();
        showOverlay('Level ' + level + ' Clear!', 'Bonus +' + LEVEL_BONUS + ' · next level…');
        winTimer = setTimeout(function () {
            if (state === 'won') { hideOverlay(); nextLevel(); }
        }, 1500);
    }

    function loseLife() {
        lives -= 1;
        if (lives <= 0) {
            lives = 0;
            state = 'gameover';
            harpoon = null;
            showOverlay('Game Over', 'Score: ' + score + ' · press Reset to play again');
        } else {
            // Re-lay the current level and clear the harpoon for a clean restart.
            balls = layBalls(level);
            harpoon = null;
            player = { x: W / 2 };
        }
        updateHud();
        draw();
    }

    // ---- Input actions ------------------------------------------------------
    function movePlayer(dir) {
        const half = PLAYER_W / 2;
        player.x += dir * PLAYER_STEP;
        if (player.x < half) player.x = half;
        if (player.x > W - half) player.x = W - half;
        draw();
        return player.x;
    }

    function fire() {
        if (state !== 'playing') return false;
        if (harpoon) return false;
        harpoon = { x: player.x, topY: H };
        draw();
        return true;
    }

    function spawnBall(tier, x, y, vx, vy) {
        balls.push({ tier: tier, x: x, y: y, vx: vx || 0, vy: vy || 0 });
        draw();
    }

    function clearBalls() {
        balls = [];
        draw();
    }

    // ---- Simulation ---------------------------------------------------------
    function popBall(index) {
        const b = balls[index];
        balls.splice(index, 1);
        score += POP_SCORE;
        if (b.tier > 0) {
            const t = b.tier - 1;
            balls.push({ tier: t, x: b.x, y: b.y, vx: -SPLIT_VX, vy: -SPLIT_VY });
            balls.push({ tier: t, x: b.x, y: b.y, vx: SPLIT_VX, vy: -SPLIT_VY });
        }
        harpoon = null;
        updateHud();
        // A level is cleared only by popping the final ball (never by an empty
        // list produced some other way, e.g. a test helper clearing balls).
        if (state === 'playing' && balls.length === 0) winLevel();
    }

    function ballHitsPlayer(b) {
        const r = BALL_RADII[b.tier];
        const left = player.x - PLAYER_W / 2;
        const right = player.x + PLAYER_W / 2;
        const top = H - PLAYER_H;
        const bottom = H;
        const cx = Math.max(left, Math.min(b.x, right));
        const cy = Math.max(top, Math.min(b.y, bottom));
        const dx = b.x - cx;
        const dy = b.y - cy;
        return dx * dx + dy * dy <= r * r;
    }

    function substep(f) {
        // Held-key player movement.
        if (leftHeld) movePlayerContinuous(-1, f);
        if (rightHeld) movePlayerContinuous(1, f);

        // Balls.
        for (const b of balls) {
            const r = BALL_RADII[b.tier];
            b.vy += GRAVITY * f;
            b.x += b.vx * f;
            b.y += b.vy * f;
            if (b.x - r < 0) { b.x = r; b.vx = Math.abs(b.vx); }
            if (b.x + r > W) { b.x = W - r; b.vx = -Math.abs(b.vx); }
            if (b.y - r < 0) { b.y = r; b.vy = Math.abs(b.vy); }
            if (b.y + r > H) { b.y = H - r; b.vy = -BOUNCE_V[b.tier]; }
        }

        // Harpoon.
        if (harpoon) {
            harpoon.topY -= HARPOON_SPEED * f;
            let hit = -1;
            for (let i = 0; i < balls.length; i++) {
                const b = balls[i];
                const r = BALL_RADII[b.tier];
                if (Math.abs(b.x - harpoon.x) <= r && harpoon.topY <= b.y + r) {
                    hit = i;
                    break;
                }
            }
            if (hit !== -1) {
                popBall(hit);
            } else if (harpoon.topY <= 0) {
                harpoon = null;
            }
        }

        // Player collision.
        for (const b of balls) {
            if (ballHitsPlayer(b)) {
                loseLife();
                return;
            }
        }
    }

    function movePlayerContinuous(dir, f) {
        const half = PLAYER_W / 2;
        player.x += dir * PLAYER_SPEED * f;
        if (player.x < half) player.x = half;
        if (player.x > W - half) player.x = W - half;
    }

    function step(dtMs) {
        if (state !== 'playing') return;
        let remaining = dtMs;
        while (remaining > 0 && state === 'playing') {
            const chunk = Math.min(remaining, MAX_DT);
            substep(chunk / 1000);
            remaining -= chunk;
        }
        draw();
    }

    // ---- Rendering ----------------------------------------------------------
    const TIER_FILL = ['#ffd166', '#ff9f45', '#ff5da2', '#c05cff'];

    function draw() {
        ctx.clearRect(0, 0, W, H);

        // Floor line.
        ctx.strokeStyle = '#2a3358';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, H - 1);
        ctx.lineTo(W, H - 1);
        ctx.stroke();

        // Harpoon.
        if (harpoon) {
            ctx.strokeStyle = '#8ef6ff';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(harpoon.x, H);
            ctx.lineTo(harpoon.x, harpoon.topY);
            ctx.stroke();
            ctx.fillStyle = '#e6feff';
            ctx.beginPath();
            ctx.moveTo(harpoon.x, harpoon.topY - 8);
            ctx.lineTo(harpoon.x - 5, harpoon.topY + 2);
            ctx.lineTo(harpoon.x + 5, harpoon.topY + 2);
            ctx.closePath();
            ctx.fill();
        }

        // Balls.
        for (const b of balls) {
            const r = BALL_RADII[b.tier];
            const grad = ctx.createRadialGradient(b.x - r / 3, b.y - r / 3, r / 4, b.x, b.y, r);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.25, TIER_FILL[b.tier]);
            grad.addColorStop(1, '#8a2d6b');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Player.
        if (state !== 'gameover') {
            const px = player.x;
            const top = H - PLAYER_H;
            ctx.fillStyle = '#5cd0ff';
            ctx.fillRect(px - PLAYER_W / 2, top, PLAYER_W, PLAYER_H);
            ctx.fillStyle = '#0d1020';
            ctx.fillRect(px - 4, top - 8, 8, 10); // little cannon nub
        }
    }

    // ---- HUD / overlay ------------------------------------------------------
    function updateHud() {
        el.level.textContent = String(level);
        el.score.textContent = String(score);
        el.lives.textContent = String(lives);
    }

    function showOverlay(title, sub) {
        el.overlayTitle.textContent = title;
        el.overlaySub.textContent = sub;
        el.overlay.classList.add('visible');
    }

    function hideOverlay() {
        el.overlay.classList.remove('visible');
    }

    // ---- Keyboard -----------------------------------------------------------
    function ensureStarted() {
        if (state === 'ready' || state === 'gameover') start();
    }

    document.addEventListener('keydown', function (ev) {
        const k = ev.key;
        if (k === 'r' || k === 'R') { reset(); ev.preventDefault(); return; }
        if (k === 'p' || k === 'P') { togglePause(); ev.preventDefault(); return; }

        if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
            ensureStarted(); leftHeld = true; movePlayer(-1); ev.preventDefault();
        } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
            ensureStarted(); rightHeld = true; movePlayer(1); ev.preventDefault();
        } else if (k === ' ' || k === 'Spacebar' || k === 'ArrowUp' || k === 'w' || k === 'W') {
            ensureStarted(); fire(); ev.preventDefault();
        }
    });

    document.addEventListener('keyup', function (ev) {
        const k = ev.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') leftHeld = false;
        if (k === 'ArrowRight' || k === 'd' || k === 'D') rightHeld = false;
    });

    el.btnStart.addEventListener('click', start);
    el.btnReset.addEventListener('click', reset);

    // ---- Real-time loop -----------------------------------------------------
    let lastT = null;
    function loop(t) {
        if (lastT == null) lastT = t;
        const dt = Math.min(50, t - lastT); // clamp big frame gaps
        lastT = t;
        if (state === 'playing') step(dt);
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // ---- Public / test API --------------------------------------------------
    window.start = start;
    window.reset = reset;
    window.loadLevel = loadLevel;
    window.movePlayer = movePlayer;
    window.fire = fire;
    window.step = step;
    window.spawnBall = spawnBall;
    window.clearBalls = clearBalls;
    window.getState = function () {
        return {
            playerX: player.x,
            lives: lives,
            score: score,
            level: level,
            state: state,
            ballCount: balls.length,
            harpoonActive: !!harpoon,
        };
    };
    window.getBalls = function () {
        return balls.map(function (b) {
            return { tier: b.tier, x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: BALL_RADII[b.tier] };
        });
    };
    window.getHarpoon = function () {
        return harpoon ? { x: harpoon.x, topY: harpoon.topY } : null;
    };

    // ---- Boot ---------------------------------------------------------------
    reset();
})();
