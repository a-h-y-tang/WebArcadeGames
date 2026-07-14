# Lunar Lander — Design

## Concept

A physics recreation of the 1979 Atari arcade classic. You pilot a small lunar
module falling under gravity toward the surface of the moon. Fire the main
thruster to slow your descent and rotate to control your heading, but watch the
fuel gauge. Set the craft down **gently, upright, and on the flat landing pad**
to score and advance to a harder level. Come in too fast, at too steep an angle,
or miss the pad, and the module is wrecked.

## Mechanics

- **Gravity.** A constant downward acceleration pulls the lander toward the
  surface every millisecond.
- **Thrust.** Holding the thruster accelerates the craft along the direction its
  nose points (straight up when upright), burning fuel. Thrust is stronger than
  gravity, so a steady burn can arrest a fall — but only while fuel remains.
- **Rotation.** The lander rotates left/right at a fixed rate. Because thrust
  follows the nose, tilting lets you cancel sideways drift — at the risk of not
  being upright when you touch down.
- **Fuel.** A finite reserve drains while thrusting. At empty the engine dies and
  only gravity acts; rotation is free but useless without thrust.
- **The pad.** One flat landing pad sits on the surface. A touchdown is a
  **success** only if the craft is over the pad, descending slower than the safe
  vertical and horizontal speed limits, and within a small angle of upright.
  Anything else is a **crash**.
- **Lives & levels.** You start with 3 landers. A crash costs one and re-drops a
  fresh lander to retry the same level; running out ends the game. A safe landing
  banks a score bonus (bigger for a softer touchdown with more fuel to spare) and
  advances to the next level, where the pad is narrower and gravity a little
  stronger.
- **Speed independence.** All motion is expressed in pixels-per-millisecond and
  advanced by a single pure `step(dt)` function, so the simulation is frame-rate
  independent and deterministically testable.

## Controls

| Input | Action |
|---|---|
| ↑ / W / Space | Fire main thruster |
| ← / → or A / D | Rotate left / right |
| P | Pause / resume |
| ↑ / Space / arrow | Start / restart |

## Code structure

- `index.html` — canvas, HUD (score / best / lives / level / fuel) and the
  start/pause/game-over overlay.
- `style.css` — dark, muted "moon" styling in keeping with the other games.
- `game.js` — all logic in plain (non-module) script scope so state and helpers
  are reachable from Playwright via `page.evaluate`. Key pieces:
  - `resetLander()` places a fresh module at the top with a full tank.
  - `placePad()` positions the flat landing pad for the current level.
  - `step(dt)` applies rotation, thrust, gravity, integration, screen clamping
    and touchdown resolution — the single deterministic core the tests drive.
  - `resolveTouchdown()` decides success vs. crash from position, speed and angle.
  - `loop()` is the `requestAnimationFrame` driver that reads the keyboard into
    the `lander.thrusting` / `rotInput` flags and calls `step()` each frame.

## Assumptions

Where the task was ambiguous, the simpler interpretation was chosen and recorded
here:

- **Flat surface with a single pad**, rather than the arcade's jagged mountain
  terrain and multiple bonus pads. This keeps collision to one clear rule and the
  landing logic trivially testable.
- **Thrust and rotation are read from state flags** (`lander.thrusting`,
  `rotInput`) that the input loop sets each frame, so `step(dt)` is a pure
  function of state and the tests can drive it directly.
- **A crash retries the same level** (rather than restarting from level 1);
  simpler and fairer for a physics game.
- **No wind or terrain hazards**, and the lander is **clamped** to the screen
  sides instead of wrapping or crashing on the walls.
- **Canvas is a fixed 600 × 500** and the game does not scale to the viewport,
  matching the fixed-size approach of the other games in this repo.
- **Best score** is stored in `localStorage` under `lunar-lander-best`.
