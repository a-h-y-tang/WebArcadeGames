# Galaga — Design

## Concept

A single-file HTML5 canvas homage to Namco's 1981 shooter. A formation of alien
bugs hovers near the top of the screen, gently swaying side to side. Unlike the
rigid marching grid of Space Invaders, Galaga's aliens **peel off and dive** —
individual bugs break formation to swoop down at the player's fighter in curving
attack runs, firing as they come, before looping back to their slot. The player
flies a fighter along the bottom, firing up to two shots at a time, and must
clear the whole swarm to advance to a faster, more aggressive wave.

## What makes it Galaga (not Space Invaders)

| Space Invaders                         | Galaga (this game)                       |
|----------------------------------------|-------------------------------------------|
| Whole grid marches and drops in lockstep | Formation only **sways**; it never descends |
| You lose if the grid reaches your row   | You lose only from being hit               |
| Enemies fire straight down from formation | Enemies **dive** in curved runs and can ram you |
| One laser on screen                     | **Two** lasers on screen                   |
| Static points per alien                 | **Diving aliens are worth double**         |

## Field & objects

A fixed **500×500** canvas so it renders identically across machines and in
headless test browsers.

| Object        | Size (px) | Notes                                             |
|---------------|-----------|---------------------------------------------------|
| Fighter       | 36 × 20   | Sits near the bottom (`PLAYER_Y = HEIGHT - 36`).    |
| Fighter shot  | 4 × 12    | Travels up. Up to **two** on screen at once.       |
| Alien         | 28 × 22   | 4 rows × 8 columns = 32 aliens per wave.            |
| Enemy bomb    | 4 × 12    | Dropped by aliens, travels down.                   |

## Mechanics

- **Frame-rate independence.** All motion is expressed in *pixels per
  millisecond* and integrated by a single `step(dt)` function, exactly like the
  other games in this repo. The render loop only ever calls `step(elapsed)` and
  `draw()`, so the simulation is deterministic and fully testable without a real
  clock.
- **Formation sway.** Every alien has a fixed *home* slot. While in formation an
  alien sits at `homeX + formationX`, where `formationX` oscillates within
  `±SWAY_RANGE`. The formation never drops toward the player.
- **Dive attacks.** `startDive(alien)` breaks an alien out of formation. It then
  integrates its own velocity each step: a steady downward `vy` plus a horizontal
  `vx` that wobbles within `±DIVE_AMP` of where the dive began, producing a
  curving swoop. When a diving alien falls past the bottom of the screen it loops
  back to its formation slot. On a timer, the game auto-launches dives; the more
  advanced the wave, the more attackers.
- **Fighter fire.** Space fires a shot. Up to **two** fighter shots may be in
  flight at once (`MAX_PLAYER_BULLETS = 2`).
- **Collisions.** A fighter shot overlapping any live alien destroys it and
  scores points — top rows are worth more, and a **diving** alien scores double.
  A diving alien that rams the fighter, or an enemy bomb that hits it, costs a
  life and clears all bombs. Losing the last life ends the game.
- **Waves.** Destroying every alien advances the level: a fresh, faster, more
  aggressive swarm spawns and the fighter re-centers.

## Controls

| Input                     | Action                            |
|---------------------------|-----------------------------------|
| ← / → or A / D            | Move the fighter left / right     |
| Space                     | Start the game / fire             |
| P                         | Pause / resume                    |
| Start button              | Start / resume / play again       |

Space does double duty: it starts the game from the idle/over screen, and once
the game is running it fires the fighter's guns.

## State model

A single `state` variable drives everything: `idle` → `running` ⇄ `paused`,
and `running` → `over`. An overlay element mirrors the state (start prompt,
"Paused", or "Game Over"). The best score persists to `localStorage` under the
key `galaga-best`.

## Assumptions

Where the original arcade game left room for interpretation, the simpler choice
was taken and recorded here:

1. **No fly-in entrance.** In the arcade, each wave enters by flying in along
   looping paths before settling into formation. This version spawns the swarm
   already in formation and expresses Galaga's identity through the *dive*
   attacks instead — the entrance choreography adds a lot of path code for little
   test value.
2. **No captured-fighter / dual-ship mechanic.** Galaga's signature tractor-beam
   capture (and the twin-fighter reward for rescuing it) is omitted to keep the
   state model simple. The two-shots-at-once rule is kept as a nod to the
   dual-fighter firepower.
3. **A diving alien that reaches the bottom loops back to formation** rather than
   leaving the screen permanently — this keeps every wave winnable and the alien
   count stable until you shoot them.
4. **Enemy fire and dive launches use `Math.random` only** to choose *which*
   alien acts and *when*, and are driven from the render loop — never from
   `step(dt)`. Tests seed bombs and dives directly and never depend on
   randomness.
5. **Fixed 500×500 field**, matching Breakout/Tetris/2048 for a consistent home
   page and reliable headless rendering.
6. Preferred model for development work on this game: **claude-opus-4-8**.
