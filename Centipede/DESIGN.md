# Centipede — Design

## Concept

A canvas remake of the 1981 Atari arcade classic **Centipede**. A segmented
centipede winds its way down the screen through a field of mushrooms. You
control a shooter confined to a band at the bottom of the screen and blast the
centipede apart before it reaches you. Shooting a middle segment splits the
centipede into two independent halves, so a long centipede quickly becomes a
swarm of shorter ones. Survive a wave and a new, longer, faster centipede
appears.

## The playfield

- The canvas is **500 × 600** pixels, divided into a **25 × 30** grid of
  `CELL = 20px` cells.
- The bottom **6 rows** (`PLAYER_TOP = 24` … `29`) are the **player zone** —
  the only rows the shooter may occupy.
- **Mushrooms** occupy grid cells in the upper rows. Each mushroom has
  **4 health**; every bullet hit chips one off, and it disappears on the 4th.

## Mechanics

### The centipede
- Spawns as a horizontal train of segments at the top row, moving right.
- Each tick every segment advances one cell in its own horizontal direction.
- When a segment's next cell is **a wall or a mushroom**, that segment **drops
  down one row and reverses** horizontal direction — the signature weaving
  descent.
- Because each segment steers independently, shooting out a middle segment
  naturally leaves two separate trains — the classic **split**.

### The shooter & bullets
- Moves one grid cell per key press in any of the four directions, clamped to
  the grid and to the player zone.
- Fires straight up. **One bullet is on screen at a time** (as in the Atari
  original); you can fire again the moment the previous bullet clears.
- A bullet advances several cells per tick, checking each cell it crosses:
  - **Mushroom** → chip 1 health (destroyed mushroom scores **1**); bullet dies.
  - **Centipede segment** → segment destroyed (scores **10**), a fresh mushroom
    grows in its place, bullet dies.

### Lives, waves & game over
- You start with **3 lives**. A centipede segment touching the shooter's cell
  costs a life; the centipede and shooter reset.
- At **0 lives** the game is over.
- Clear every segment and you advance a **level**: a new centipede spawns,
  longer and faster than the last, and a small bonus is awarded.

### Scoring
- Mushroom destroyed: **1**
- Centipede segment destroyed: **10**
- Wave-clear bonus: **100**
- The best score is persisted to `localStorage` under `centipede-best`.

## Controls

| Action | Keys |
|---|---|
| Move | Arrow keys / **WASD** |
| Fire | **Space** |
| Pause / resume | **P** |
| Start / restart | Any move key, Space, or the on-screen button |

## State machine

`idle → running → paused → over`, driven by a fixed-timestep loop layered on
`requestAnimationFrame` (drawing every frame, updating game logic on tick
boundaries). Mirrors the shared arcade shell used by the other games in this
repo: HUD, a start/pause/game-over overlay, and a persisted best score, so the
game is scriptable from Playwright the same way its siblings are.

## Assumptions

Where the task was ambiguous, the simpler interpretation was chosen and noted
here:

- **Segments move independently rather than as a strictly following train.**
  Starting side by side with the same direction, they move in lockstep and read
  as one connected centipede, but breaking apart on impact is emergent rather
  than a modelled follow-the-leader chain. This keeps the movement rule a single
  per-segment step and makes splitting fall out for free.
- **The shooter moves one cell per key press** (holding relies on the OS key
  repeat) rather than free pixel-level motion, keeping movement deterministic
  and grid-aligned for testing.
- **One bullet on screen at a time**, matching the Atari original and giving the
  bullet a single, testable lifecycle.
- **Losing a life resets the centipede and shooter** (rather than modelling the
  original's fast head-respawn behaviour), which is simpler and still fair.
- Mushrooms take **4 hits**; the initial field is scattered randomly, so tests
  that exercise mushroom mechanics set the grid explicitly rather than relying
  on the random layout.
- The file is named `DESIGN.md` (per the task brief); it plays the same role as
  the `design.md` in the sibling game folders.
