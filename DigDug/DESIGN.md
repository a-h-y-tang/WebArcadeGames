# Dig Dug — Design

## Concept

Dig Dug is a single-screen digging arcade game. You control a digger who
tunnels through solid earth. Underground monsters roam the dirt and hunt you
down; your job is to clear every one of them before they catch you. You have two
weapons: an **inflator harpoon** that pumps a monster full of air until it pops,
and **falling rocks** that you can drop on monsters by digging away the ground
beneath them. Clear the screen to advance to a deeper, busier level.

## The grid

The world is a `COLS × ROWS` grid of cells, each `CELL` pixels square, drawn on
the canvas. Every cell is either **soil** (solid, dark earth) or **dug** (an
open tunnel). The top row is open sky/surface. Movement, digging, monsters,
rocks and the harpoon are all expressed in whole grid cells, which keeps the
simulation fully deterministic and lets the Playwright tests drive it exactly.

## Mechanics

- **Digging & movement.** The digger moves one cell at a time in the four
  cardinal directions. Moving into a soil cell carves it into a tunnel (digs
  it). The digger cannot move off the grid or into a cell occupied by a rock.
- **Monsters.** Monsters hunt the digger. Each monster tick, a monster takes one
  step toward the digger along existing tunnels (shortest tunnel path). If it is
  sealed off from the digger by earth for too long, it briefly **ghosts** — it
  slips one cell straight through the soil toward the digger, the way the real
  game's monsters do when frustrated. A monster that reaches the digger's cell
  costs a life.
- **The harpoon.** Facing a monster, fire the harpoon (Space). It reaches up to
  `HARPOON_RANGE` cells through open tunnel and grabs the nearest monster in
  line. Each pump inflates that monster one step; at `INFLATE_MAX` it bursts and
  is destroyed. Stop pumping and the monster slowly deflates and breaks free. An
  inflating monster is frozen and cannot move.
- **Falling rocks.** Rocks sit embedded in the earth. Dig out the cell directly
  below a rock and, a moment later, it drops. A falling rock crushes any monster
  (or the digger) in the column as it falls, then shatters when it lands. Rocks
  are worth big points and can take out several monsters at once.
- **Clearing a level.** Remove every monster and the next, deeper level is
  generated with one more monster. Score and lives carry over.
- **Lives.** You start with `START_LIVES`. Being caught (or crushed) resets the
  digger to the surface and the monsters to their dens; losing the last life
  ends the game. The best score is saved in `localStorage`.

## Controls

| Action | Keys |
|---|---|
| Move / dig | **Arrow keys** or **W A S D** |
| Fire / pump the harpoon | **Space** |
| Start | **Space**, an arrow key, or the **Start** button |
| Pause / resume | **P** |

## Timing model

Motion is advanced by a `step(dt)` function in milliseconds, exactly like the
other games in this repo. The digger moves on a `PLAYER_STEP_MS` cadence while a
direction is held; monsters move on a slower `ENEMY_STEP_MS` cadence; rocks fall
on a `ROCK_FALL_MS` cadence. Because every actor is driven by accumulated `dt`,
the tests advance the world deterministically with fixed `dt` values instead of
racing real animation frames, and can also call the discrete helpers
(`movePlayer`, `pump`, `stepEnemies`, `stepRocks`) directly.

## State exposed for testing

State lives in module-level globals (`state`, `grid`, `player`, `enemies`,
`rocks`, `score`, `best`, `lives`, `level`) alongside pure-ish helpers
(`inBounds`, `isDug`, `hasRock`, `enemyAt`, `movePlayer`, `pump`, `stepEnemies`,
`stepRocks`, `step`, `startGame`, `endGame`, `pauseGame`, `resumeGame`) so the
Playwright suite can assert on the model directly through `page.evaluate`.

## Assumptions

- **Discrete grid movement.** The arcade original uses smooth pixel movement
  with grid-aligned turning. To keep the simulation simple, deterministic and
  fully testable — the simpler interpretation the spec asks for when something is
  ambiguous — every actor moves a whole cell at a time on a fixed cadence.
- **One monster type.** The original has Pookas and fire-breathing Fygars. This
  version ships a single monster type (the hunting Pooka) so the enemy logic
  stays focused; more types could be layered on later.
- **Monster pathing is shortest-tunnel-then-ghost.** Monsters take the shortest
  path through existing tunnels; only when no tunnel path exists do they ghost a
  single cell through soil. This keeps digging strategically meaningful while
  guaranteeing the monsters always eventually reach you.
- **Rocks shatter after falling.** A dropped rock is consumed once it lands (it
  does not become a permanent obstacle), matching the arcade behaviour.
- **A rock crushes whatever shares the cell it falls into,** monster or digger,
  with no partial-overlap subtlety, because everything is cell-aligned.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page markup, canvas, HUD |
| `style.css` | Styling and the start / pause / game-over overlay |
| `game.js` | Grid model, digging, monsters, rocks, harpoon, rendering, input |
| `DESIGN.md` | This document |
| `tests/digdug.spec.js` | Playwright test suite |
