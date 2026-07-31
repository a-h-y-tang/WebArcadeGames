# Burger Time — Design

## Concept

Burger Time is a single-screen arcade game inspired by the 1982 Data East
classic. You play a chef trapped in a maze of platforms and ladders, tasked with
building three giant hamburgers. Walking across an ingredient stamps it down;
stamp all four segments of an ingredient and it drops to the platform below,
squashing anything in its path. Every ingredient must be walked down onto the
plates at the bottom of the screen.

Meanwhile, food enemies — a hot dog, a pickle and a fried egg — hunt you through
the maze. Touch one and you lose a life. Your only defence is a limited supply
of pepper: a puff of it freezes any enemy caught in the cloud long enough for you
to slip past.

## The playfield

The canvas is 640×512, laid out on a 32 px tile grid (20 columns × 16 rows).

| Element | Placement |
|---|---|
| Floors | Rows 2, 5, 8, 11, 14 → `FLOOR_Y = [64, 160, 256, 352, 448]` |
| Ladders | Columns 1, 7, 13, 19 → `LADDER_X = [48, 240, 432, 624]` |
| Burger stacks | Columns 2–5, 8–11, 14–17 → `STACK_X = [64, 256, 448]`, each 128 px wide |
| Plates | Bottom floor (`FLOOR_Y[4]`, floor index `PLATE_FLOOR = 4`) |

Every ladder runs the full height of the maze, from the top floor to the bottom
floor. Each burger stack holds four ingredients — top bun, lettuce, patty, bottom
bun — starting on floors 0–3 respectively, so 12 ingredients in total.

Entity positions are "feet" coordinates: `y` is the surface the entity stands on,
`x` is its horizontal centre.

## Mechanics

### Stamping ingredients

An ingredient is divided into `SEGMENTS = 4` segments, each 32 px wide. While the
chef stands on a floor, whichever segment of the *top* ingredient of the pile
there his `x` falls inside is stamped (`pressed[i] = true`) and visibly sinks.
When all four segments are stamped the whole pile drops together, scoring
`DROP_POINTS` per ingredient — so knocking a tall pile down is worth more than
nudging a single layer.

### Falling, pushing and piling

A falling ingredient descends at `FALL_SPEED` px/s toward the next floor down.
On arrival:

- **Plate floor** → the ingredient is plated (+`PLATE_POINTS`) and stops for good.
  Plated ingredients pile visibly on the plate and can never be stamped again.
- **Occupied by a resting pile, and this ingredient has not pushed yet** → that
  pile is knocked loose (stamps reset) and everything — pusher and pushed —
  continues one more floor together. The `hasPushed` flag then stops the chain:
  the group comes to rest wherever it lands next, however much is already there.
  One stamped crossing therefore moves a burger *two* floors at most, not all the
  way to the plate.
- **Empty floor** → the ingredient comes to rest there with its stamps cleared,
  ready to be walked across again. If the rest of its group is still falling past
  that floor it rides along instead of stopping in mid-air.

Because ingredients can never overtake each other, a pile's stacking order is
just the burger's own layer order (`layerRank`): the bottom bun always ends up on
the bottom and the top bun on top, on any floor and on the plate. Falling
ingredients are resolved lowest-layer-first each frame so a group that lands
together lands in the right order.

Any enemy standing under a falling ingredient (inside the stack's horizontal
span) is squashed for `SQUASH_POINTS`.

Plating all 12 ingredients completes the level: you score `LEVEL_BONUS × level`,
the burgers are rebuilt, the enemies are cleared and the pepper is restocked.
Enemies get faster and more numerous with each level.

### Enemies

Enemies chase the chef with a deterministic rule — no randomness anywhere in the
game:

1. If the enemy is between floors it keeps climbing until it reaches the floor it
   was heading for.
2. Otherwise, if the chef is on a different floor, the enemy walks to the nearest
   ladder and climbs one floor toward him.
3. Otherwise it walks straight at him along the floor.

They spawn one at a time from the top-floor ladders on a `SPAWN_INTERVAL` timer,
up to `maxEnemies()` at once. Touching a non-stunned enemy costs a life: the chef
returns to his start position, the maze is cleared of enemies and the pepper is
restocked. Out of lives ends the game.

### Pepper

`sprayPepper()` puts a short-lived cloud in front of the chef, consuming one
pepper. Enemies overlapping the cloud are stunned for `STUN_TIME` seconds — they
stop dead, are harmless to touch, and can be walked over or squashed at leisure.

### Scoring

| Event | Points |
|---|---|
| Ingredient dropped | 50 |
| Ingredient plated | 100 |
| Enemy squashed | 500 |
| Level completed | 1000 × level |

The best score is persisted in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| ← / → / A / D | Walk left / right |
| ↑ / ↓ / W / S | Climb up / down (when on a ladder) |
| Space | Spray pepper (start / restart when not playing) |
| P | Pause / resume |
| Start button | Start, restart, or resume from pause |

## Code structure

`game.js` is a single classic (non-module) script, matching Kaboom, Dino Run,
Snake and the rest of the repo, so its state and functions are reachable from the
Playwright tests as plain globals.

- **Pure geometry helpers** — `floorIndexAt(y)`, `nearestFloorIndex(y)`,
  `nearestLadderX(x)`, `stackIndexAt(x)`, plus `pileAt(stack, floor)` which
  returns the ingredients resting on one floor of one stack, bottom layer first.
  `plateAll()` is a test/debug shortcut that drops every ingredient straight onto
  its plate.
- **`step(dt)`** advances the whole simulation: chef, ingredients, enemies,
  pepper clouds, spawn timer, collisions. All speeds are per second.
- **`draw()`** renders; it never mutates simulation state.
- **`frame(t)`** is the requestAnimationFrame driver. It calls `step()` only when
  `state === 'running'` *and* the `autoLoop` flag is true. Tests set
  `autoLoop = false` after starting so the real-time loop cannot interfere with
  hand-driven `step(dt)` calls — every timing assertion is then exact.
- **Input** is funnelled through the `input` object (`left/right/up/down`), which
  keyboard handlers set and tests can drive directly.

Because there is no randomness — fixed layout, fixed spawn order, deterministic
chase AI — any sequence of `step(dt)` calls is perfectly reproducible.

## Assumptions

Where the brief was open-ended the simpler option was taken, and recorded here:

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but the session's harness pins development to
  `claude/loving-euler-c7kaoz` and forbids pushing elsewhere. The harness branch
  wins; the game name lives in the folder, commit and PR title instead.
- **Ladders everywhere.** All four ladders run the full height of the maze rather
  than the original's irregular, partially-connected layout. This keeps
  navigation (and the enemy AI) simple and predictable.
- **One-tile stamps.** Stamping is decided purely by the chef's centre `x`, so
  each pass across an ingredient stamps one segment at a time.
- **The chef doesn't ride ingredients.** In the arcade original the chef can fall
  with an ingredient (and be crushed by one). Here falling ingredients pass
  through the chef harmlessly — only enemies are squashed.
- **No stack-height bonus.** Squashing several enemies with one drop scores
  `SQUASH_POINTS` each, with no escalating multiplier.
- **Piles are physics-free.** Ingredients stacked on one floor are drawn on top
  of each other and the chef is drawn standing on top of the pile, but his
  collision height and the enemies' stay at floor level. It reads correctly and
  keeps every position exactly on the floor grid.
- **Chains stop after one push**, as described above. Letting them run would mean
  a single crossing could plate an entire burger, which makes a level three
  crossings long; capping the chain gives the level about a dozen.
- **Instant transitions.** Losing a life and completing a level both take effect
  immediately (no death animation or interstitial screen), which keeps the state
  machine to `idle / running / paused / over`.
- **Pepper restock.** Pepper is restocked to `PEPPER_START` on each new life and
  each new level, rather than being earned through bonus items.
- **Three enemy types** cycle in a fixed order (hot dog → pickle → egg) and
  behave identically; the type only affects how the enemy is drawn.
