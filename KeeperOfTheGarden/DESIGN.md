# Keeper of the Garden — design notes

*"The LORD God took the man and put him in the garden of Eden to work it and
keep it."* — Genesis 2:15

## Game concept

A single-screen arcade game in the tradition of *Centipede*, re-themed as a
gardener keeping the garden of Eden. A long caterpillar crawls in at the top of
the garden and winds its way down toward you, turning whenever it meets the edge
of the garden or a thistle. You are the keeper, confined to the bottom of the
garden with a watering can: squirt water upward to shoo caterpillar segments
away one at a time. Every segment you catch in the middle of the chain splits
the caterpillar into two shorter ones, so a long caterpillar quickly becomes a
garden full of short, fast ones.

Thistles are the obstacle field. They turn the caterpillar and they stop your
water, but four squirts clear one away. A snail wanders through your patch
eating thistles, and when the thistles near you thin out a bee drops in and
plants fresh ones. Touching a caterpillar, the snail or the bee costs a life.

Nothing is destroyed in anger: segments that are watered are "shooed" and leave
a flower behind (a new thistle), which is exactly the *Centipede* mushroom rule
in wholesome dress.

## The playfield

| | |
|---|---|
| Canvas | 500 × 600 px |
| Grid | 25 columns × 30 rows of 20 px cells |
| Keeper's patch | the bottom 7 rows (rows 23–29) |
| Caterpillar range | the whole grid, rows 0–29 |

The caterpillar is **grid-stepped**: it occupies whole cells and moves one cell
at a time on a timer, which is what makes the turning rule and the splitting
rule exact. The keeper, the water drops, the snail and the bee all move in
**pixels per second**, so the controls stay smooth. Rendering interpolates each
caterpillar segment between the cell it left and the cell it is entering, so a
grid-stepped chain still looks like it is crawling.

## Mechanics

### The caterpillar

- A caterpillar is an ordered list of cells, head first. On each step the head
  picks its next cell and every other segment moves into the cell the segment
  ahead of it just left — a path-following chain, so the body traces exactly the
  route the head took.
- The head carries a horizontal direction `dx` (±1) and a vertical direction
  `dy` (±1). Normally it steps sideways by `dx`.
- When the cell ahead is outside the garden or holds a thistle, the head
  **reverses `dx` and drops one row** in direction `dy`. At the top or bottom row
  `dy` flips first, so a caterpillar that reaches the bottom climbs back up
  through the keeper's patch. Only sideways movement is ever blocked — a head
  dropping a row may land on a thistle and crawl on from there.
- A wave is one long caterpillar (10 segments, growing by one each level to a
  maximum of 14) entering at the top-left, plus one extra lone crawler per level
  beyond the first, up to four, entering at random columns.

### Watering and splitting

- `Space` squirts a drop upward from the watering can. At most 3 drops are in
  flight at once, with a short cooldown between squirts.
- A drop that reaches a segment removes it and **splits its caterpillar**: the
  part in front keeps crawling with the same directions, and the part behind
  becomes a new caterpillar with a new head and the same directions. Empty parts
  disappear.
- A head is worth 100, a body segment 10. A thistle is planted in the cell the
  segment vacated (if that cell was empty), so the field thickens as you play.
- Clearing every segment finishes the wave: the level goes up, a wave bonus of
  50 × level is scored, and a longer, faster wave enters.

### Thistles

- Each thistle has 4 stages of health. A drop takes one stage and stops; the
  thistle scores 1 per stage and 5 more when the last stage is cleared.
- The opening field is sown at random in rows 2–27 at roughly 7% density, so the
  very top row (where caterpillars enter) and the very bottom row (where the
  keeper walks) start clear.

### The snail and the bee

- **Snail** — enters the keeper's patch from the left or right about every nine
  seconds, moves diagonally and bounces off the top and bottom of the patch,
  eating any thistle it crosses, and leaves at the far side. Worth 300.
- **Bee** — when fewer than 5 thistles are left in the keeper's patch, a bee
  drops straight down from the top and plants a thistle every other row. The
  first drop of water only hurries it along; the second shoos it away. Worth 200.
- Touching the keeper costs a life, as does touching a caterpillar segment.

### Lives, waves and game over

- Three lives. Losing one clears the drops, the snail and the bee, puts the
  keeper back in the middle and **restarts the current wave** (the thistle field
  is kept — it is the record of the garden so far).
- At zero lives the game ends and the best score is kept in `localStorage`
  under `keeper-of-the-garden-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` or `A` `D` `W` `S` | move the keeper inside the bottom patch |
| `Space` (hold to repeat) | squirt water upward |
| `P` | pause / resume |
| `Space` / `Enter` / an arrow key / the button | start, and restart after a game over |

## Code layout

`index.html` is the page (HUD, canvas, overlay, controls hint and verse),
`style.css` the dark-garden styling shared in spirit with the other games here,
and `game.js` the whole game in one classic (non-module) script so that the
Playwright tests can read the state directly:

| Piece | What it holds |
|---|---|
| constants | `CELL`, `COLS`, `ROWS`, `PLAYER_TOP_ROW`, speeds, `MAX_DROPS`, `THISTLE_STAGES` |
| `thistles` | a `ROWS × COLS` array of stage counts, `thistleAt(col,row)` reads it safely |
| `caterpillars` | array of `{ cells: [{col,row,prevCol,prevRow}], dx, dy, progress }` |
| `player`, `drops`, `snail`, `bee` | the pixel-space entities |
| `step(dt)` | advances the whole world by `dt` ms — the only place physics happens |
| `loop()` | `requestAnimationFrame` driver: measures `dt`, calls `step`, then `draw` |
| `draw()` | all rendering; no state changes |
| `setSeed(n)` | seeds the small deterministic RNG the tests use |
| `freezeLoop()` / `resumeLoop()` | test hooks: hand the clock to `step(dt)` and back |

The caterpillar's grid step is `max(42, 120 - 11 × (level - 1))` ms, so the first
wave crawls at about 8 cells a second and the eighth wave at twice that.

`step(dt)` is deliberately separate from `loop()` so the tests can advance the
world by an exact number of milliseconds without waiting for animation frames.

## Assumptions

Decisions taken without asking, in each case the simpler reading:

1. **Only the head decides.** Followers never test for walls or thistles; they
   replay the head's path. This is what makes a split instantly correct — the
   segment behind the gap simply becomes a head and keeps the same directions.
2. **A caterpillar that reaches the bottom row climbs back up** rather than
   leaving the screen or spawning reinforcements at the sides, which is the
   classic behaviour minus the extra spawning rules.
3. **Losing a life restarts the wave, not the level.** The score, the level and
   the thistle field all survive; only the creatures reset.
4. **Thistles are never regrown automatically** at the start of a wave. The
   field only changes through play: watered segments plant them, drops clear
   them, snails eat them and bees plant them.
5. **One grid step for every caterpillar.** All caterpillars in a wave share the
   same step interval, so a split does not make the halves move at different
   speeds (the original sped up short chains; that is more code than it is fun).
6. **Hold-to-squirt is allowed** with a cooldown, rather than requiring one key
   press per drop, because it is kinder on a keyboard.
7. **A dropping head is never blocked.** Thistles stop sideways movement only,
   which is what keeps the turn-and-drop rule from ever deadlocking.
8. **The bee takes two drops.** The first adds speed, the second shoos it away,
   which keeps the flea's "it is worth chasing" feel without tracking health in
   a separate place.
