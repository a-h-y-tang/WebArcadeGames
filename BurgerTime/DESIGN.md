# BurgerTime — Design

## Game concept

A single-screen, ladder-and-platform arcade game. You are a short-order chef
trapped inside a giant burger kitchen. Three burgers hang in pieces on a lattice
of floors and ladders. Walking the full width of an ingredient knocks it loose so
it falls to the floor below — or onto the next ingredient, which chains the whole
stack downward. Assemble all three burgers on the plates at the bottom to clear
the level, while four kinds of food-monster (hot dog, pickle, egg, sausage) hunt
you across the girders. You carry a shaker of pepper: a spray stuns anything in
front of you for a few seconds. Dropping an ingredient on a monster squashes it
for big points.

The game is a fresh implementation of the *BurgerTime* arcade formula — nothing
else in this repo uses the "trip a platform segment to make it fall" mechanic, so
it is a genuinely new shape of play alongside the existing maze, shooter and
puzzle titles.

## World geometry

Everything is derived from a tile grid so the layout is easy to reason about and
to assert on in tests.

| Constant | Value | Meaning |
|---|---|---|
| `TILE_W` | 28 px | one grid column |
| `COLS` | 20 | grid columns (canvas is `COLS * TILE_W` = 560 px wide) |
| `CANVAS_H` | 460 px | canvas height |
| `FLOOR_COUNT` | 5 | walkable floors, index 0 (top) … 4 (plate floor) |
| `FLOOR_Y` | 56, 138, 220, 302, 384 | y of each floor's walking line |
| `ING_TILES` | 4 | an ingredient spans 4 columns (112 px) |

Three burger stacks occupy columns 2–5, 8–11 and 14–17. The remaining columns
(0–1, 6–7, 12–13, 18–19) carry the ladders:

| Ladder column | Spans floors |
|---|---|
| 0 | 0 → 4 (full height, left edge) |
| 6 | 0 → 2 |
| 7 | 2 → 4 |
| 12 | 0 → 2 |
| 13 | 2 → 4 |
| 19 | 0 → 4 (full height, right edge) |

Because the middle ladders are half-height and offset, crossing the board
vertically forces you to walk along a floor between climbs — that is what makes
the monsters dangerous.

## Mechanics

### Chef movement

The chef is always in one of three modes:

- `floor` — pinned to a floor's y, free to move left/right, clamped to the canvas.
- `ladder` — pinned to a ladder's x, free to move up/down between the floors that
  ladder spans. Pressing up/down while standing on a floor within
  `SNAP` (8 px) of a ladder that continues in that direction snaps the chef onto
  it. Arriving exactly at a floor line releases the chef back to `floor` mode.
- `riding` — carried down by a falling ingredient (see below). No input is
  accepted and the chef cannot be caught.

Speed is `CHEF_SPEED` = 120 px/s, expressed per second and integrated in
`step(dt)` so tests can advance the simulation deterministically.

### Tripping ingredients

Each ingredient tracks `steps[4]`, one flag per tile of its width. While the chef
walks along the floor an ingredient rests on, the tile under the chef's centre is
flagged (and drawn pressed down). When all four flags are set the ingredient
falls.

### Falling and chaining

A falling ingredient descends at `FALL_SPEED` = 260 px/s toward the next floor.
On arrival:

- If that floor already holds a resting ingredient in the same stack, that
  ingredient is knocked loose too (its `steps` reset) and the falling ingredient
  keeps going to the floor after that. Each link raises the drop's chain
  multiplier, so a full four-piece cascade is worth far more than four separate
  drops.
- If that floor is the plate floor (4) the ingredient lands on the plate, stacking
  visually on whatever is already there.
- Otherwise it comes to rest on that floor.

Scoring for a drop is `DROP_POINTS` (50) × chain length.

### Riding

The chef is standing on the ingredient at the moment its fourth tile is pressed,
so the chef rides it down — through every link of a cascade — and is released on
the landing floor. Riding is a safe state; it is the game's escape hatch.

### Monsters

Monsters spawn on a timer from the two bottom corners and, from level 3 onward,
the two top corners as well. They use the same floor/ladder movement model as the
chef and re-decide direction whenever they reach a junction (a ladder column, a
floor line, or a wall): they take whichever legal move most reduces the distance
to the chef, with a small random chance of choosing otherwise so they do not
move in lockstep. Base speed is `ENEMY_SPEED` (52 px/s) plus 6 px/s per level,
capped below the chef's speed.

- Touching an active monster costs a life.
- A falling ingredient squashes any monster inside its column span, worth
  `SQUASH_POINTS` (500) × chain length.
- A stunned monster is harmless and stationary; the chef can walk straight past.

### Pepper

`Space` sprays a cloud one tile ahead of the chef for 0.35 s. Any monster inside
the cloud is stunned for `STUN_TIME` (4 s). You get `PEPPER_START` (5) shakes per
level and cannot spray with none left.

### Lives, levels, game over

Three lives. Losing one freezes play for `DEATH_PAUSE` (1.4 s), then respawns the
chef at the start position and clears the monsters — ingredient progress is kept.
Clearing every ingredient onto the plates pauses for `CLEAR_PAUSE` (1.8 s), then
starts the next level with fresh ingredients, a full pepper shaker and faster,
more frequent monsters. The best score is persisted in `localStorage` under
`burgertime-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | walk along a floor |
| `↑` `↓` / `W` `S` | climb a ladder |
| `Space` | spray pepper (starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| Start button | start, restart, or resume from pause |

## Code structure

A single classic (non-module) script, `game.js`, matching the rest of the repo so
that state and helpers are reachable from Playwright as plain globals:

- **Layout** — `FLOOR_Y`, `LADDERS`, `STACK_LEFT`, and the pure helpers
  `ladderAt(x)`, `ladderSpans(l, floor, dir)`, `stackOfX(x)`.
- **State** — `state` (`idle` | `running` | `paused` | `dying` | `levelclear` |
  `over`), `score`, `best`, `lives`, `level`, `peppers`, `chef`, `enemies`,
  `ingredients`, `plates`.
- **Simulation** — `step(dt)` advances the chef, ingredients, monsters, pepper
  clouds and timers. `requestAnimationFrame` only supplies `dt` and calls `draw()`,
  so no game logic depends on wall-clock timing.
- **Test seams** — `startGame()`, `togglePause()`, `spray()`, `placeChef(x, floor)`,
  `spawnEnemy(type, x, floor)`, `ingredientsOnPlates()`.

## Assumptions

These were resolved without being able to ask; the simpler reading was taken each
time.

1. **Branch name.** The task asked for a branch named after the game
   (`burger-time`), but this session's standing instructions pin all development
   to `claude/loving-euler-5sk4lm` and forbid pushing elsewhere. The pinned branch
   wins; no `burger-time` branch was created.
2. **Not a clone.** Sprites, exact layout, monster roster, timings and scoring are
   original; only the genre mechanics are borrowed. No original arcade assets are
   used — everything is drawn with canvas primitives, in keeping with the rest of
   the repo.
3. **Layout is fixed.** Every level uses the same girder/ladder layout; difficulty
   comes from monster speed, spawn rate and spawn points rather than new maps. That
   keeps levels testable and the code small.
4. **Three burgers of four pieces.** Twelve ingredients total (top bun, lettuce,
   patty, bottom bun per stack), one per floor per stack, which makes the initial
   layout and the cascade behaviour fall out naturally.
5. **Squashed, not buried.** In the original, monsters ride a falling ingredient
   down and are buried in the stack. Here a monster caught by a falling ingredient
   is simply squashed and removed after a short flatten animation.
6. **No bonus items or level-specific enemy mixes.** The classic pepper/ice-cream
   bonus pickups and per-level enemy rosters are omitted; the monster type is
   chosen round-robin from the four kinds.
7. **`Space` is overloaded.** It sprays pepper while playing and starts the game
   when idle or after a game over. `Enter` always starts, so nothing is
   unreachable.
8. **Riding is invulnerable.** Being carried by a falling ingredient makes the chef
   untouchable, which is the simplest consistent rule and matches how the original
   feels.
