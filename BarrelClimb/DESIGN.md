# Barrel Climb — Design

## Concept

Barrel Climb is a single-screen climbing arcade game. A **barrel machine** bolted
to the top-left of a five-storey scaffold spits out barrels that zig-zag their
way down the girders. The player starts on the bottom floor and has to run, jump
and climb their way up to the **prize** at the far end of the top floor without
being flattened.

Every barrel you hurdle is worth points, and a **bonus** timer drains while you
climb — reach the prize quickly and you bank what's left of it. Each level you
clear sends barrels out faster and more often, so the same scaffold gets harder
every time you climb it.

## Mechanics

### The stage

- The board is a 600×480 canvas holding **five girders** (`platforms`) at
  `y = 450, 360, 270, 180, 90`. The bottom girder spans the full width; the four
  above it are 540px wide with the gap alternating left/right. Those alternating
  gaps are the whole reason barrels zig-zag.
- **Four ladders** (`ladders`) join consecutive girders at
  `x = 520, 100, 480, 120`, so the player's route up the scaffold zig-zags too.
  Each ladder records the floor *below* it; `platforms[floor]` and
  `platforms[floor + 1]` are the girders it joins.
- The barrel machine sits at `x = 40` on the top floor, the prize at `x = 500`.

### The player

- **Running** moves at `RUN_SPEED` (160 px/s) and is clamped to the canvas.
- **Gravity** (`GRAVITY`, 1400 px/s²) applies whenever the player isn't on a
  ladder. Girders are *one-way*: the player rises through them and lands on top
  of one only while falling, which keeps jumping simple and predictable.
- **Jumping** applies `JUMP_V` (-380 px/s), giving a ~52px hop — enough to clear
  a barrel, deliberately less than the 90px floor spacing, so you can never jump
  your way up a storey.
- **Climbing** starts when the player holds up/down while standing within
  `LADDER_GRAB` (14px) of a ladder that runs in that direction. While climbing,
  gravity is off and `x` is snapped to the ladder's centre; the player pops out
  onto the girder above or below on reaching its end. Releasing the key mid-climb
  leaves the player hanging still on the ladder.
- Walking off the open end of a girder makes the player fall to whatever girder
  is below — a shortcut down, not a death.

### The barrels

Each barrel is in exactly one of three states:

| State | Behaviour |
|---|---|
| rolling | Travels along its girder at `barrelSpeed()`, spinning as it goes |
| falling | Free-falls under gravity until it lands on a girder whose span contains its `x` |
| on a ladder | Descends a ladder at `LADDER_DESCENT` (110 px/s) with `x` pinned to the ladder |

- A rolling barrel that passes the open end of its girder starts **falling**. On
  landing it **reverses direction**, which is what produces the zig-zag descent.
- A rolling barrel that crosses a ladder leading down from its floor takes it
  with probability `LADDER_CHANCE` (0.4). Barrels that drop a floor early are the
  main source of surprise — a girder is never guaranteed clear just because you
  watched the barrels above it.
- Barrels that fall past the bottom girder leave the board and are removed.
- The machine drops a fresh barrel every `spawnInterval()` seconds.

### Difficulty scaling (pure functions of `level`)

| Quantity | Formula |
|---|---|
| `barrelSpeed()` | `150 + (level - 1) * 18` px/s |
| `spawnInterval()` | `max(0.9, 2.4 - (level - 1) * 0.22)` s |

Because these depend only on `level`, and the only other source of variation is
a seeded xorshift RNG (`setSeed`/`rng`), an entire run is reproducible — which is
what makes the Playwright tests reliable.

### Scoring, lives and levels

- Hurdling a barrel (airborne, directly above it, within 26px horizontally) scores
  `JUMP_POINTS` (100). Each barrel can only be hurdled once.
- The `bonus` starts at `BONUS_START` (5000) and drains at `BONUS_RATE`
  (100/second), clamped at 0. Reaching the prize banks whatever is left, bumps
  `level`, refills the bonus and resets the stage.
- Touching a barrel costs a life, clears the board and returns the player to the
  start of the same level with a fresh bonus. The game ends when the third life
  goes. The best score is persisted in `localStorage` under `barrel-climb-best`.

## Controls

| Key | Action |
|---|---|
| ← / → (or A / D) | Run left / right |
| ↑ / ↓ (or W / S) | Climb a ladder up / down |
| Space | Jump — or start / restart when the overlay is up |
| P | Pause / resume |

## Code layout

`game.js` is a single classic (non-module) script, matching the rest of the repo
so the tests can reach state as plain globals:

- **Constants & stage data** — geometry, speeds, `platforms`, `ladders`, `GOAL`.
- **`setSeed` / `rng`** — seeded xorshift32 for barrel ladder choices.
- **Player** — `setPlayerX`, `placePlayerOnFloor`, `movePlayer`, `climb`, `jump`,
  `isOnLadder`, `updatePlayer`.
- **Barrels** — `spawnBarrel`, `ladderCrossed`, `updateBarrels`.
- **Interactions** — `scoreHurdles`, `hitsPlayer`, `checkCollisions`, `atGoal`,
  `loseLife`, `completeLevel`.
- **`step(dt)`** — advances one frame of simulation. Everything is expressed per
  second, so the tests can call `step(0.016)` in a loop instead of waiting on
  `requestAnimationFrame`.
- **Game flow** — `startGame`, `endGame`, `togglePause`, `updateHud`.
- **Rendering** — `draw` and its helpers; purely a function of state, never a
  place where game logic hides.
- **Input** — keyboard handlers that only translate keys into `movePlayer`,
  `climb`, `jump`, `togglePause`.

The `step(dt)` order matters: player → barrels → hurdle scoring → collisions →
goal → bonus drain → barrel spawn. Collisions resolve before the goal check so a
barrel to the face never becomes a level win, and the goal is checked before the
bonus drains so the banked bonus is exactly what the HUD showed.

## Testing

`tests/barrelclimb.spec.js` holds 63 Playwright tests written before the
implementation, covering the idle screen, starting, running, jumping, ladders,
barrel rolling/falling/laddering, collisions, hurdle scoring, the goal, the bonus
timer, best-score persistence, and pause/restart. Tests drive the simulation
through `step(dt)` and assert on state rather than pixels.

## Assumptions

These were decisions the brief left open; the simpler option was taken each time
and noted here.

1. **Branch naming.** The task asked for a branch named after the game
   (`barrel-climb`), while the session's standing instructions pin development to
   `claude/loving-euler-t8hk1h`. Work was done on `barrel-climb` locally and
   pushed to the designated branch, which satisfies the pinned-branch rule.
2. **Original artwork, not a licensed clone.** The game is inspired by the
   girder-and-ladder arcade genre but uses its own stage layout, a neutral
   "barrel machine" instead of any recognisable character, and a generic trophy
   as the prize.
3. **Flat girders.** Real cabinet versions slope their girders. Flat girders keep
   the physics (and the tests) simple without changing how the game plays.
4. **One-way girders.** The player passes upward through a girder and lands on it
   only when falling. Ceiling collisions would add nothing at this jump height.
5. **No hammer / no smashing barrels.** Cut for scope. Barrels are dodged and
   hurdled only.
6. **One stage layout for every level.** Levels change barrel speed and drop
   rate, not the scaffold. Simpler to reason about and to test.
7. **Climbing locks horizontal movement.** Left/right input is ignored while on a
   ladder, so the player can't drift off a rung mid-climb.
8. **A death resets the level, not the score.** Score is kept, the stage is
   cleared and the bonus refills — losing a life shouldn't erase the climb you
   already paid for.
9. **Fixed 600×480 canvas.** Matches the repo's other games; no responsive
   scaling.
