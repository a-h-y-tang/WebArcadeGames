# Sky Climber — Design

## Concept

**Sky Climber** is a vertical, endless platform-jumper in the spirit of *Doodle
Jump*. You control a little hopper that bounces automatically off platforms.
Steer left and right to line up the next platform; the camera scrolls upward as
you climb, and your score is the height you reach. Miss every platform and fall
off the bottom of the screen and the run ends.

The whole game is one continuous climb — there are no levels, no enemies to
shoot, no timer. The tension comes entirely from reading the layout above you
and threading your bounces through it as the platforms get sparser.

## Mechanics

- **Auto-bounce.** The hopper is always affected by gravity. Whenever it is
  *falling* (moving downward) and its feet cross the top of a platform, it
  bounces: vertical velocity is set to a fixed upward `JUMP_SPEED`. You never
  press a jump button — every landing launches you again.
- **Steering.** Left / right input sets the hopper's horizontal velocity. Let go
  and it stops (there is no horizontal inertia — the simpler interpretation).
- **Screen wrap.** Leave the left edge and you reappear on the right, and vice
  versa, so the play-field is a horizontal cylinder.
- **Camera / scrolling.** The world is scrolled, not the player. When the hopper
  rises above a fixed `CAMERA_LINE`, the whole world (the hopper and every
  platform) is shifted *down* by the overshoot and that overshoot is added to
  the run's height. The hopper therefore never visually climbs above the camera
  line; the platforms stream downward past it instead.
- **Endless platforms.** Any platform that scrolls below the bottom edge is
  recycled: it is re-spawned above the current highest platform at a random
  horizontal position, a reachable vertical gap higher. Gaps are always clamped
  to be smaller than the hopper's maximum jump height, so the tower is always
  climbable.
- **Platform types.**
  - *Static* (most platforms) — a plain ledge.
  - *Moving* — slides horizontally and bounces off the side walls, so you have
    to time your landing.
- **Scoring.** Height is measured in metres (`scroll pixels / 10`, floored). The
  best height is persisted to `localStorage` under `sky-climber-best`.
- **Game over.** When the hopper's top edge falls past the bottom of the canvas
  it can no longer reach any platform, so the run ends and the game-over overlay
  appears.

## Controls

| Input | Action |
|---|---|
| ← / → arrows (or A / D) | Steer left / right |
| P | Pause / resume |
| ← / → / Space / Enter, or the button | Start or restart |

## Architecture

The code follows the same shape as the other games in this repo:

- `update(dt)` is a **pure, deterministic physics step** with no `state` gate,
  so Playwright tests can freeze the animation loop (`state = 'paused'`), set up
  an exact situation, call `update(dt)` directly, and assert on the result.
- All motion is time-based (pixels / second, pixels / second²) integrated
  against a delta-time `dt`, and the `dt` fed by the real loop is capped so a
  background tab can't teleport the hopper through a platform.
- Game state (`hopper`, `platforms`, `score`, `state`, `keys`, …) lives in
  module-scope `let`s that the tests read and write.
- Rendering (`draw`) is separate from simulation and never affects state.

## Assumptions

- **"Novel game" means one not already in the repo.** Sky Climber (vertical
  platform-jumper) is not among the existing 12 games, so it qualifies.
- **Simpler-interpretation choices** (per the task's guidance):
  - No horizontal inertia — releasing the steer keys stops the hopper
    immediately, which makes precise landings learnable.
  - Only two platform types (static + moving). Spring / breakable / one-shot
    platforms were considered but dropped to keep the mechanic legible and the
    test surface focused.
  - The hopper falls straight through platforms while rising; platforms only
    catch it on the way *down*. This is the standard Doodle-Jump feel and avoids
    the hopper getting stuck under a ledge.
- **Determinism for tests.** Platform *layout* uses `Math.random`, but every
  gameplay rule the tests assert on is exercised by driving `update(dt)` against
  hand-placed platforms, so no test depends on the random seed. The one test
  about the initial layout only checks the invariant that gaps are reachable,
  which holds for any seed because gaps are clamped.
- **Canvas size** is fixed at 480×640 (portrait), a good aspect ratio for a
  vertical climber, and is not responsive beyond CSS scaling.
