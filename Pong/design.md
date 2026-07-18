# Pong — Design Document

> This is the design document requested for the game (the task refers to it as
> `DESIGN.md`). It is named `design.md` to match the repository convention — the
> root `README.md` states *"Each game should include a design.md"*, and the
> existing games use that lowercase name. See **Assumptions**.

## Game Concept

**Pong**, the 1972 game that started the arcade industry — and the one classic
still missing from this collection. You control the left paddle; the computer
controls the right. A ball rallies back and forth; whoever gets it past the
other's paddle scores. First to **7** points wins.

The existing arcade already has plenty of shooters and fallers (Snake, 2048,
Tetris, Breakout, Asteroids, Flappy Bird, Space Invaders, Frogger, Minesweeper).
Pong is the foundational two-paddle rally game and a genuinely distinct addition:
a competitive game against an AI opponent rather than a solo survival run.

## Mechanics

- **The rally.** The ball travels in a straight line, bouncing off the top and
  bottom walls. Each paddle hit reflects it horizontally and **speeds it up
  slightly** (capped), so rallies get tenser the longer they last.
- **English (spin).** Where the ball strikes a paddle changes its vertical
  angle: hit near the top edge and it deflects upward, near the bottom and it
  deflects downward, dead-centre and it flattens out. This is the skill lever —
  you aim with paddle position, not just block.
- **Scoring & serving.** A ball that passes the left edge scores for the CPU; one
  that passes the right edge scores for you. After a point the ball re-serves
  from the centre toward the side that just conceded. Serve direction and angle
  are **deterministic** (derived from the running score parity), never random —
  a prerequisite for reliable tests.
- **The AI.** The right paddle chases the ball's vertical position at a capped
  speed while the ball approaches it, and eases back toward centre otherwise. The
  speed cap is below the ball's, so a well-placed shot beats it — the opponent is
  competent but fair.
- **Best rally.** Beyond the match score, the game tracks the **longest rally**
  (most consecutive paddle hits in a single point) and persists it to
  `localStorage` as a personal best.
- **Winning.** Reaching 7 points ends the match with a "You Win!" or "Game Over"
  overlay.

## Controls

| Input | Action |
|---|---|
| ↑ / ↓ arrows (or W / S) | Move your paddle up / down |
| Mouse over the board | Move your paddle to the cursor |
| P | Pause / resume |
| Any move key, or the button | Start / restart |

## Architecture

A single static HTML page — `index.html`, `style.css`, `game.js` — with no build
step or dependencies. Open `index.html` directly in a browser.

### Coordinate & physics model

Positions are in **pixels** and motion is **time-based** (pixels per second),
integrated by a delta time `dt` (seconds) from `requestAnimationFrame`
timestamps, clamped to 50 ms to survive tab switches. The board is **700×500**.

### `update(dt)` — a pure, deterministic step

All simulation lives in **`update(dt)`**: paddle motion, ball integration, wall
and paddle bounces, scoring, serving and win detection. It performs no `state`
check, so a test can freeze the loop, set up an exact ball/paddle configuration,
call `update(dt)` with a fixed step, and assert on the outcome — no reliance on
wall-clock timing or randomness. The `requestAnimationFrame` loop simply calls
`update(dt)` while `state === 'running'` and then draws.

### State machine

`state` is `idle → running → paused → running` and `running → over → running`,
mirroring the other games. The overlay is shown for every non-`running` state.

### Collision detection

The ball is a circle; each paddle is an axis-aligned rectangle. A hit is the
standard circle-vs-rectangle overlap, gated on the ball moving *toward* that
paddle (so it can't re-trigger while leaving). On a hit the ball is pushed just
clear of the paddle, its horizontal velocity is reversed, and its vertical
velocity is set from the contact offset.

### Rendering

Each frame clears to a dark board, draws the classic dashed centre net, both
paddles, the ball, and the two large score digits. It is deliberately minimal
and high-contrast — Pong's whole aesthetic.

### Persistence

The longest rally is stored in `localStorage` under `pong-best`, read on load and
written only when beaten.

## Assumptions

- **Design-doc filename.** The task says "DESIGN.md"; the repo convention (and the
  root README's explicit requirement) is `design.md`. I used `design.md` for
  consistency with the existing games. It fulfils the requested sections
  (concept, mechanics, controls, assumptions).
- **"Best" tracks longest rally, not a point total.** Pong has no cumulative
  score to persist across matches, so the natural persisted metric is the longest
  rally achieved — a meaningful personal best that is also cleanly testable.
- **Single-player vs. CPU.** Rather than hot-seat two-player, the right paddle is
  an AI, so the game is playable solo like the rest of the arcade. The AI speed
  cap is intentionally below the ball's top speed so it is beatable.
- **Deterministic serve.** Serve direction/angle come from score parity, not
  RNG, so every behaviour is reproducible in tests.
- **First to 7.** A standard short Pong match length; exposed as the `WIN_SCORE`
  constant.
- **Board size 700×500.** Chosen to give the rally room while staying comparable
  to the other games' canvases; exposed as `WIDTH`/`HEIGHT`.
