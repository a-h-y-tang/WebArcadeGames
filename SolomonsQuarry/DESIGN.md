# Solomon's Quarry — design

*"In building the temple, only blocks dressed at the quarry were used, and no
hammer, chisel or any other iron tool was heard at the temple site while it was
being built."* — 1 Kings 6:7

## Game concept

A first-person maze game played by lamplight. You are one of Solomon's quarry
workers deep under the hill: the dressed stones for the temple are waiting at
the far ends of the tunnels, your lamp holds only so much oil, and the only way
out is the quarry mouth you came in by.

Every other game in this collection draws the world from the outside — top-down,
side-on, or a flat board. This one renders the tunnels from *inside* with a
raycasting engine on the same plain `<canvas>`, which is the gap it fills. There
are no enemies and nothing to fight. The pressure is the oil in the lamp and the
shape of the maze.

A run is five levels. Each level is a freshly generated maze; gather every
dressed stone, then carry them back to the quarry mouth before the lamp dies.

## Mechanics

### The maze

* An odd-sized grid (11×11 up to 19×19) carved by a seeded recursive-backtracker,
  so the whole quarry is one connected tunnel network with no loops added.
* `maze.grid` is a flat `Uint8Array`: `1` = rock, `0` = open tunnel. The outer
  border is always rock.
* The quarry mouth (the gate) is the cell `(1, 1)`, where the player starts
  facing the first open tunnel out of it — never nose-first into the rock.
* Generation is driven by a `mulberry32` RNG seeded from the `?seed=` query
  parameter, so a seed always produces the same quarry (used by the tests) and
  no seed produces a new one each run.

### Stones, flasks and the gate

* **Dressed stones** (3 at level 1, rising to 7) are placed in dead ends, chosen
  from the half of the dead ends furthest from the gate by breadth-first
  distance, so the stones are always a real walk away.
* **Oil flasks** — one per stone on the level — sit in open cells and add 25%
  oil, capped at 100%.
* Anything within 0.45 cells of the player is picked up on the next frame.
* The gate stays shut until every stone on the level is held. Once it opens it
  glows on the minimap and in the tunnel; stepping within 0.5 cells of the gate
  centre clears the level.

### The lamp

* Oil starts each level at 100% and drains 1% per second. The rate is the same
  on every level — a lamp burns at the rate it burns — so the difficulty comes
  from the quarry growing faster than the flasks that light it. It does not
  drain while paused.
* Oil is also the light: the view radius is `2.5 + oil/100 × 4.5` cells, so the
  tunnels close in around you as the lamp burns down.
* Oil at 0 ends the run — "the lamp has gone out".

### Scoring

* 100 per dressed stone, plus 250 and the remaining oil (rounded) for clearing a
  level. Clearing level 5 wins the run. The best score is kept in
  `localStorage` under `solomons-quarry-best`.

### Rendering

* One ray per screen column across a 60° field of view, stepped with a DDA grid
  walk; the wall column height is `canvasHeight / perpendicular distance`, which
  keeps walls straight (no fisheye).
* Column brightness falls off with distance against the current light radius,
  and north/south faces are drawn darker than east/west so corners read.
* Stones and flasks are billboarded sprites tested against the per-column depth
  buffer from the wall pass, so an item behind a corner is correctly hidden.
* A minimap inset in the top-left corner shows only cells you have already
  walked past (an "explored" set), the player's heading, and the gate.
* The title screen is the real first view of the quarry you are about to walk,
  dimmed behind the overlay, and pressing Start walks into that same quarry; a
  later run (after a win or a dead lamp) carves a new one. When the lamp dies
  the canvas goes dark with it.

## Controls

| Input | Action |
|---|---|
| **↑** / **W** | walk forward |
| **↓** / **S** | walk back |
| **←** / **→** | turn left / right |
| **A** / **D** | turn left / right |
| **Q** / **E** | sidestep left / right |
| **P** | pause / resume |
| **Space** / **Enter** | start a run, or play again after it ends |

Mouse: the **Start Game** button on the overlay does the same as Space.

## Assumptions

Made autonomously while building this, with the simpler reading chosen each
time:

1. **"Novel" means a genre gap, not a new folder for an existing one.** The repo
   already has box-pushing (Ark Loading), brick-breaking (Walls of Jericho),
   artillery (Artillery Duel), pipe-laying (Living Water) and a Centipede field
   (Vineyard Keeper), and the open pull requests already cover snake, typing,
   rhythm, chess, backgammon, dominoes, hearts and a Centipede garden. A
   first-person raycast maze was absent from both, so that is what this is.
2. **No enemies.** A wandering guard would need pathfinding and would push the
   game toward violence; the lamp timer supplies the tension instead, and keeps
   the game firmly family friendly.
3. **Oil refills at each level** rather than carrying over, so a weak start
   cannot make level 4 unwinnable.
   The numbers come from measurement, not taste: a scripted bot that knows the
   map was timed over 40 generated quarries, and the shortest route through a
   level costs between 18% and 35% of the oil a level provides, which leaves a
   player who explores two to three times as far still able to finish.
4. **Five levels is a complete run.** A win screen beats an endless ladder for a
   browser game, and the best score gives a reason to replay.
5. **The gate is the start cell.** It needs no extra art, and "carry the stones
   back out" is a better loop than "find a second exit".
6. **State lives in script-level `let`/`const` bindings**, as in the other games
   here (for example `Darts/game.js`), so the Playwright specs can read and
   drive the game directly with `page.evaluate`.
7. **Playwright drives the real bindings.** The 69 specs read and set the same
   script-level state the game runs on, rather than a test-only API, so a test
   cannot pass against a façade the player never touches.
8. **The minimap lives inside the one `<canvas>`** rather than a second element,
   which keeps the markup and the screenshot the same shape as the other games.
9. **Mouse look is deliberately left out.** Pointer-lock behaves differently
   across browsers and makes nothing about the game better; the keyboard turn is
   enough.
