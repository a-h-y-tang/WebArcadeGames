# Cloud Jumper — Design Document

## Concept

Cloud Jumper is a vertical, endless "doodle-jump"-style platformer. The player
character bounces automatically off a ladder of floating platforms. You never
press a jump button — gravity and the platforms do that for you. Your only job
is to steer left and right so you keep landing on the next platform above. The
higher you climb, the higher your score. Miss every platform and fall off the
bottom of the screen and the run ends.

> **Note on file naming:** the automated task brief asked for a `DESIGN.md`,
> while the repository convention (and every sibling game) uses a lowercase
> `design.md` referenced from the root `README.md`. This file follows the
> repository convention; it contains all the requested sections, including
> the **Assumptions** section below.

## Architecture

A single, dependency-free HTML page: `index.html`, `style.css`, and `game.js`.
Open `index.html` directly in any modern browser — no build step, no server.

- `index.html` — canvas, HUD, and the start/pause/game-over overlay.
- `style.css` — layout and the night-sky theme.
- `game.js` — all game logic: state, physics, rendering, and input.

## Coordinate System

The canvas is **400 × 600** (portrait). Everything is measured in canvas
pixels with the origin at the top-left, so `y` grows downward.

- The player is an axis-aligned box `{x, y, vx, vy}` sized `PLAYER_W × PLAYER_H`
  (34 × 34), where `(x, y)` is its top-left corner.
- Each platform is `{x, y}` sized `PLAT_W × PLAT_H` (68 × 14).

## State Machine

`state` gates what the loop and input handler do:

```
idle ──► running ──► paused ──► running
                └──► over ──► running
```

- **idle** — start overlay visible, no loop running (but the world is seeded
  so the first frame draws something real).
- **running** — the `requestAnimationFrame` loop is active.
- **paused** — loop stopped, overlay shown, world frozen.
- **over** — end overlay with the final score.

## Fixed-Timestep Game Loop

Physics must be deterministic regardless of frame rate, so the loop uses a
fixed-timestep accumulator rather than integrating against a variable frame
delta:

```js
function loop(timestamp) {
    acc += timestamp - lastTime;
    lastTime = timestamp;
    while (acc >= STEP_MS && iterations < 5) {   // STEP_MS = 16 (~60 Hz)
        step();                                  // advance exactly one tick
        acc -= STEP_MS;
    }
    draw();                                       // render once per frame
}
```

The `iterations < 5` clamp prevents a "spiral of death" if the tab was
backgrounded and a large `acc` builds up.

`step()` deliberately contains **no `state` guard**. That keeps a single tick
of physics pure and callable in isolation, which is exactly what the Playwright
suite does to drive gravity, bouncing, wrapping, scrolling, and game-over
deterministically. Only the *loop* checks `state`.

## Physics (one `step()`)

Executed in order each tick:

1. **Steer + wrap.** `vx` is `-MOVE_SPEED`, `+MOVE_SPEED`, or `0` from the held
   keys; `x += vx`. If the box leaves one side it reappears on the other
   (classic screen wrap).
2. **Gravity.** `vy += GRAVITY`; `y += vy`.
3. **Bounce.** Only while **falling** (`vy > 0`) and only when the feet
   *cross* a platform's top surface this tick — the previous foot position was
   at or above the platform top and the new one is at or below it, with
   horizontal overlap. On a hit, snap the feet onto the platform and set
   `vy = JUMP_V` (a fixed upward impulse). The crossing test means a rising
   player passes straight through platforms, so you can only ever land on them
   from above.
4. **Scroll + score.** When the player climbs above `SCROLL_THRESHOLD` (y = 250),
   the world scrolls down by exactly enough to pin the player at the threshold:
   every platform's `y` increases by the same delta, and the delta is banked
   into a running total. Score is `floor(totalClimbed / PX_PER_POINT)`.
5. **Death.** If `y > H`, the player has fallen off the bottom → `endGame()`.

Tuned constants: `GRAVITY = 0.35`, `JUMP_V = -11.5`, `MOVE_SPEED = 4.5`,
`SCROLL_THRESHOLD = 250`, `PLAT_GAP = 78`, `PX_PER_POINT = 10`.

## Endless Platforms

The world starts with a platform directly under the player (so the opening
bounce is guaranteed) and a stack of randomly-placed platforms spaced
`PLAT_GAP` apart, filling the screen upward. Whenever a platform scrolls below
the bottom edge it is *recycled*: moved back up to `PLAT_GAP` above the current
highest platform with a fresh random `x`. The platform count is therefore
constant and the ladder never runs out.

## Controls

| Input | Action |
|---|---|
| ← / → or A / D | Steer left / right (held) |
| Space or ← / → | Start or restart |
| P | Pause / resume |

## Rendering

Each frame: a vertical night-sky gradient, a few soft parallax "clouds" whose
vertical position is driven by how far you've climbed, the platforms (rounded
rects with a lighter top edge), and the player (a rounded amber box with two
eyes that glance in the direction of travel).

`ctx.roundRect` (standard in modern browsers) keeps the draw calls terse.

## Persistence

The all-time best score is stored in `localStorage` under `cloud-jumper-best`,
read on load and written only when beaten.

## Assumptions

- **File naming:** `design.md` (lowercase) is used to match the repository
  convention and the root `README.md`'s stated rule, rather than the `DESIGN.md`
  spelling in the task brief. Same content, consistent with siblings.
- **Scoring unit:** score is climbed distance in units of 10 px (a compact,
  readable number) rather than raw pixels or a per-platform tally.
- **No downward-scroll / no bottom kill-line above the view:** the camera only
  ever follows the player *up*. Falling is punished solely by leaving the
  bottom of the visible canvas, which keeps the rules simple and matches the
  simplest reading of the genre.
- **Steering is instantaneous** (no horizontal acceleration or momentum),
  which makes precise platform-to-platform control feel tight and keeps the
  physics easy to reason about and test.
- **Single fixed platform width** and a uniform vertical gap, with only the
  horizontal position randomized. This guarantees every gap is always
  reachable given `JUMP_V`, so runs never become impossible by bad luck.
