# Pang (Buster Bros) — Design

## Game concept

Pang is a fixed-screen action arcade game. Big rubber balls bounce around the
arena under gravity. You control a character at the bottom who fires a vertical
harpoon straight up. When the harpoon hits a ball, the ball **pops** — and a
large ball splits into two smaller balls that fly apart. Keep popping until the
smallest balls burst into nothing. Clear every ball to finish the level. A ball
touching you costs a life.

This implementation renders everything on a single 640×480 HTML5 `<canvas>`.

## Mechanics

- **Balls** — each ball has a *tier* `0..3` (0 = smallest, 3 = biggest) which
  fixes its radius and its floor-bounce height. Balls move with constant
  horizontal velocity and gravity-accelerated vertical velocity.
  - **Walls** — hitting the left/right wall reflects horizontal velocity.
  - **Floor** — hitting the floor sets an upward velocity fixed per tier, so a
    ball of a given size always bounces to the same height (classic Pang feel).
  - **Ceiling** — hitting the top reflects vertical velocity downward.
- **Harpoon** — pressing fire launches a harpoon from the player that grows
  upward from the floor. Only **one** harpoon may be airborne at a time. It
  disappears when it reaches the top of the screen or when it pops a ball.
- **Popping & splitting** — a harpoon hitting a ball removes it and scores
  points. If the ball's tier is `> 0`, it spawns **two** balls of the next
  lower tier at the same spot, launched up-and-apart (one left, one right). A
  tier-0 ball simply vanishes.
- **Player** — moves left/right, clamped to the arena walls. Colliding with any
  ball costs a life and respawns the current level's balls at their start
  positions. Running out of lives ends the game.
- **Lives** — start with 3.
- **Scoring** — +50 for every ball popped (each split child scores when later
  popped), plus a +200 bonus for clearing a level.
- **Levels** — clearing all balls loads the next level, which introduces more
  and/or bigger balls. Score carries over.

## Controls

- **← / →** or **A / D** — move left / right.
- **Space** or **↑** or **W** — fire the harpoon.
- **P** — pause / resume.
- The on-canvas overlay button (or any movement/fire key) starts the game;
  after a game over it restarts.

## Architecture & testability

All simulation is expressed as a **pure, deterministic** fixed-timestep
`step(dtMs)` with no reliance on the wall clock or randomness — split direction,
bounce velocities, and level layouts are all fixed. Rendering is separated from
simulation. The real-time loop drives `step()` through a fixed-timestep
accumulator over `requestAnimationFrame`, and held movement keys are applied in
the same loop.

State and helpers are exposed on `window` so Playwright can build exact
scenarios and assert outcomes:

- `window.start()` — begin play, hide the overlay.
- `window.reset()` — full reset to level 1 (lives 3, score 0).
- `window.loadLevel(n)` — load level `n` fresh (balls reset, score/lives kept).
- `window.movePlayer(dir)` — move the player one fixed step (`dir` = -1 / +1),
  clamped to the walls. Returns the new player x.
- `window.fire()` — launch a harpoon if none is airborne and play is active.
  Returns `true` if a harpoon was launched.
- `window.step(dtMs)` — advance the simulation by `dtMs` milliseconds.
- `window.spawnBall(tier, x, y, vx, vy)` — add a ball (deterministic tests).
- `window.clearBalls()` — remove all balls (deterministic tests).
- `window.getState()` — snapshot:
  `{ playerX, lives, score, level, state, ballCount, harpoonActive }`
  where `state ∈ {'ready','playing','won','gameover','paused'}`.
- `window.getBalls()` — array of `{ tier, x, y, vx, vy, r }` copies.
- `window.getHarpoon()` — `{ x, topY }` or `null`.

## Assumptions

- **One harpoon at a time.** The original arcade game has weapon upgrades
  (double wire, grappling hook). For simplicity only the single-shot harpoon is
  implemented. Noted here per the "pick the simpler interpretation" guidance.
- **No hazards or ladders.** The arena is a plain rectangle — no platforms,
  ladders, falling blocks, or level scenery that appear in some Pang stages.
- **Fixed level layouts.** Levels are hand-defined and deterministic (no random
  ball placement), which keeps runs reproducible and tests exact.
- **Respawn on hit.** Losing a life re-lays the current level's balls at their
  start positions rather than continuing from mid-air chaos, so a life loss is
  a clean restart of the stage.
- **Four ball tiers.** Radii `[10, 18, 28, 40]` for tiers `0..3`; bigger balls
  bounce higher.
