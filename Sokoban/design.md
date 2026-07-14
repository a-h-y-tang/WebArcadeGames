# Sokoban — Design

> Note on file naming: the repo convention (and the root README) is a lowercase
> `design.md` per game, so this file uses that name. It doubles as the
> `DESIGN.md` the project brief asks for and covers every required section:
> concept, mechanics, controls, and assumptions.

## Game concept

Sokoban ("warehouse keeper") is a classic grid-based transport puzzle. The
player pushes crates around a warehouse and must get every crate onto a goal
square. Crates can only be **pushed**, never pulled, and only one at a time, so
a careless push into a corner or against a wall can render a level unsolvable —
that is the whole puzzle. The game ships with a set of hand-made levels of
increasing difficulty.

## Mechanics

The world is a rectangular grid. Every cell is one of:

| Symbol | Meaning                    |
|--------|----------------------------|
| `#`    | Wall (impassable)          |
| ` `    | Floor                      |
| `.`    | Goal square                |
| `$`    | Crate on floor             |
| `*`    | Crate on a goal square     |
| `@`    | Player on floor            |
| `+`    | Player on a goal square    |

Levels are authored as arrays of these ASCII rows. At load time the grid is
split into a **static layer** (walls and goals only) and a **dynamic layer**
(the player position and the set of crate positions), so goals underneath
crates and the player are never lost.

**Movement.** A move is a unit step in one of four directions:

- Target cell is a wall → the move is rejected, nothing changes.
- Target cell is empty floor/goal → the player steps into it (a *move*).
- Target cell holds a crate:
  - the cell **beyond** the crate is empty floor/goal → the crate slides one
    cell and the player follows (a *push*).
  - the cell beyond is a wall or another crate → the move is rejected.

**Win condition.** A level is solved the instant every goal square is covered by
a crate (equivalently: every crate sits on a goal). Solving the last level wins
the game.

**Counters.** The game tracks *moves* (every accepted step) and *pushes* (steps
that shifted a crate) for the current level, plus a per-level best (fewest
moves) persisted in `localStorage`.

**Undo.** Every accepted move pushes a snapshot (player position, crate
positions, counters) onto a history stack; `undo` pops it. Undo is unlimited
within a level.

**Reset.** Reloads the current level from its source, clearing history and
counters.

All game logic (`move`, `undo`, `reset`, `loadLevel`, solved-check) is pure with
respect to the DOM and is exposed on `window` so the Playwright suite can drive
the simulation deterministically without relying on rendered pixels.

## Controls

| Input                     | Action                     |
|---------------------------|----------------------------|
| Arrow keys / **W A S D**  | Move / push                |
| **U** or **Z**            | Undo last move             |
| **R**                     | Restart current level      |
| **N**                     | Skip to next level         |
| On-screen buttons         | Same as Undo / Reset / Next |

The start overlay is dismissed by pressing any movement key or the Start button.
A win overlay appears when a level is solved, with a button to continue.

## Assumptions

- **Simpler interpretation, per the brief.** Where the classic game has many
  variants, the simplest faithful rules are used: one crate pushed at a time,
  no pulling, four-directional movement, no time limit, no enemies.
- **Levels are bundled in `game.js`** as ASCII arrays rather than loaded from
  external files, so the game runs from `file://` with no server or build step,
  matching every other game in this repo.
- **Deterministic, no randomness.** There is nothing random in Sokoban, which
  makes the whole game exactly reproducible for tests.
- **Fixed logical grid, scaled rendering.** The canvas is a fixed pixel size;
  each level is drawn centered with a tile size chosen so the largest level
  fits. Small levels are simply centered.
- **Best score = fewest moves.** "Best" is stored per level index in
  `localStorage`; an empty store shows a dash.
- The stray top-level `GeoDash/` folder is unrelated to this game and is left
  untouched.
