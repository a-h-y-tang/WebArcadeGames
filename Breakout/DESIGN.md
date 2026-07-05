# Breakout — Design

## Concept

Breakout is a classic arcade game. A ball bounces around a walled play
field; the player slides a paddle along the bottom to keep the ball in
play and to steer it into a wall of coloured bricks at the top. Every
brick the ball hits is destroyed and awards points. Clear every brick and
you advance to the next (faster) level. Miss the ball with the paddle and
you lose a life — run out of lives and the game is over.

## Mechanics

- **Ball** — moves continuously across the field. Its position advances by
  its velocity every physics step (velocity is expressed in pixels per
  millisecond so motion is frame-rate independent). It reflects off the
  left, right and top walls, off the paddle, and off bricks.
- **Paddle** — a horizontal bar near the bottom of the field. It only moves
  horizontally and is clamped to stay fully on screen.
- **Paddle steering** — where the ball strikes the paddle changes the
  horizontal component of the bounce: hit the left edge and the ball is
  deflected left, hit the right edge and it goes right, hit the centre and
  it goes nearly straight up. This gives the player control over aim.
- **Bricks** — arranged in a grid of rows and columns near the top. Each
  brick is destroyed by a single hit. Higher rows are worth more points.
  When the ball overlaps a live brick, the brick dies, the score
  increases, and the ball reflects.
- **Lives** — the player starts with 3. If the ball falls below the paddle
  the player loses a life and the ball is re-served on the paddle. When the
  last life is lost the game ends.
- **Levels** — clearing every brick rebuilds the wall and increases the
  ball speed, so play gets progressively harder. Levels are endless; the
  only terminal state is running out of lives.
- **Score / best** — the current score is shown in the HUD and the best
  score is persisted to `localStorage` under the key `breakout-best`.

## Controls

- **← / →** or **A / D** — move the paddle left / right
- **Mouse move** over the canvas — the paddle follows the cursor
- **Space / ← / → / A / D / Start button** — start (or restart) the game
- **P** — pause / resume

## State machine

`idle → running ⇄ paused → over → running …`

- `idle` — initial screen, overlay visible, ball resting on the paddle.
- `running` — ball in motion, input active.
- `paused` — physics frozen, overlay shows "Paused".
- `over` — all lives lost, overlay shows "Game Over" and the final score.

## Testable surface

To make the game deterministic and easy to drive from Playwright, the
following are exposed as globals and can be inspected or manipulated from
tests, mirroring the convention established by the Snake game:

- State: `state`, `score`, `best`, `lives`, `level`
- Objects: `paddle`, `ball`, `bricks`
- Constants: `WIDTH`, `HEIGHT`, `PADDLE_W`, `PADDLE_H`, `BALL_R`,
  `BRICK_ROWS`, `BRICK_COLS`
- Functions: `startGame()`, `endGame()`, `step(dtMs)`, `movePaddleTo(x)`,
  `loseLife()`

`step(dtMs)` advances the physics by an explicit number of milliseconds
without relying on `requestAnimationFrame` timing, so collision and motion
tests are fully deterministic.

## Assumptions

- **Canvas size 500×500.** Kept identical to the Snake game for visual
  consistency across the arcade. A square field works fine for Breakout.
- **Deterministic serve.** When a level starts or a life is lost, the ball
  is served in a fixed direction (upward and slightly to the right) rather
  than a random one. This keeps tests stable and avoids an unlucky serve
  straight down the side.
- **Single-hit bricks.** Every brick dies in one hit (no multi-hit or
  armoured bricks) — the simpler interpretation. Point value varies by row
  only.
- **Endless levels.** There is no final "You Win" screen; clearing the
  wall simply starts a faster level. The only game-ending condition is
  losing all lives. This keeps the state machine minimal.
- **No power-ups.** Classic ball-and-paddle only, for a focused first
  version.
- **Paddle-only bottom.** The bottom wall is a "death" line (lose a life),
  not a reflecting wall — this is what makes the paddle matter.
