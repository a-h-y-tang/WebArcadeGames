# Soda Shack — Design

## Game concept

You are the only barkeep in a four-counter soda shack. Thirsty patrons push
through the door at the far end of each counter and walk steadily toward the
taps. You stand at the tap end and can only be in **one lane at a time**.

Pour a mug and it slides down the counter away from you. The first walking
patron it reaches grabs it, is pushed back down the bar, drinks, and then
**slides the empty mug back at you**. If you are standing in that lane when it
arrives you catch it; if you are not, it shatters on the floor.

So the game is a two-way juggling act. Every mug you pour creates a second
obligation a couple of seconds later, in the same lane, and the patrons you
have not served yet keep walking the whole time.

Three things cost a life:

- a patron reaches the taps (nobody served them in time),
- a full mug runs off the door end of the counter (you poured into an empty lane),
- an empty mug reaches the tap end of a counter you are not standing in.

Clear every patron in a wave and the shift ends; the next shift sends more
patrons, closer together, walking faster.

## Mechanics

### The bar

Four counters at `LANE_Y = [110, 212, 314, 416]`, each running from
`BAR_LEFT = 70` (the door) to `BAR_RIGHT = 560` (the taps). The barkeep is drawn
just off the end at `KEEPER_X`, and only `keeper.lane` matters to the rules.

### Patrons

A wave queues `patronsForLevel(n) = min(20, 5 + n)` arrivals. One walks in every
`spawnInterval(n) = max(0.9, 2.6 - 0.18 * (n - 1))` seconds, in a lane drawn
from a small deterministic generator (see *Determinism* below), at
`patronSpeed(n) = min(70, 26 + 4 * (n - 1))` px/s.

A patron is in one of three states:

| state | behaviour |
|---|---|
| `walking` | advances toward the taps; can catch a full mug; costs a life at `x + PATRON_R >= BAR_RIGHT` |
| `drinking` | slides back `PUSHBACK` px spread over `DRINK_TIME`, then releases an empty mug |
| `leaving` | walks back toward the door and is removed past `BAR_LEFT - 40` |

### Mugs

A mug is `{ lane, x, full }`. A full mug slides left at `MUG_SPEED`; an empty one
slides right at `EMPTY_SPEED`. The tap needs `POUR_COOLDOWN` seconds between
pours, which is what stops the game being solved by holding the fire key.

Collision is a one-dimensional distance test inside a lane: a full mug serves a
walking patron when `|patron.x - mug.x| <= MUG_R + PATRON_R`. When several
walking patrons are in range the **frontmost** one (largest `x`, i.e. the one
closest to the taps and so the most urgent) takes the mug, and each mug serves
at most one patron.

### Scoring

| event | points |
|---|---|
| serving a patron | `SERVE_POINTS` (50) |
| catching an empty | `CATCH_POINTS` (25) |
| clearing a wave | `levelBonus() = 100 * level + 50 * lives` |

The best score is kept in `localStorage` under `sodashack-best`.

### Wave and life flow

`waveComplete()` is true when the queue is empty, no patron is left on the bar
and no mug is sliding; it moves the game to `levelclear`, pays the bonus and
waits for the player. Losing a life clears the counters completely and restarts
the **same** wave after a `RESPAWN_GRACE` pause, so the player never inherits a
half-served bar they cannot read. The score survives; at zero lives the game
ends and the best score is written out.

## Controls

| input | action |
|---|---|
| `↑` / `↓`, `W` / `S` | move the barkeep one lane |
| mouse move over the bar | jump straight to the lane under the pointer |
| `Space` / `Enter` / click | pour and serve (and start / advance from any overlay) |
| `P` | pause and resume |

## Code shape

`game.js` is one plain script — no modules, no build step — so every top-level
name is reachable from the console and from Playwright:

- **difficulty**: `patronsForLevel`, `spawnInterval`, `patronSpeed`, `levelBonus`
- **flow**: `startGame`, `loadLevel`, `advance`, `togglePause`, `levelClear`, `gameOver`, `loseLife`
- **player actions**: `setLane`, `laneBy`, `pour`
- **simulation**: `physicsStep` and its helpers (`updateSpawning`, `movePatrons`,
  `moveMugs`, `serveCollisions`, `resolveMugs`, `checkPatronReach`)
- **drawing**: `draw` and one `drawX` function per thing on screen

All simulation runs on a fixed `DT = 1/120` timestep through `physicsStep(dt)`.
The animation loop accumulates real elapsed time and spends it in whole
timesteps, so the bar behaves identically no matter the display refresh rate.
Setting `autoRun = false` stops the loop simulating, which is how the test suite
arranges a bar and advances it one deterministic step at a time.

### Determinism

Lane choice uses a small LCG (`rng()`) re-seeded from the level number in
`loadLevel`, so a given shift always deals the same arrival order. A wave is a
test of reflexes, not of luck, and the suite can replay one and compare.

## Assumptions

These were the open questions; in each case the simpler reading was taken.

1. **One mug satisfies a patron.** The arcade ancestor of this game made a
   patron take several mugs before leaving. One mug per patron keeps the rules
   legible and is the simpler interpretation.
2. **A mug only serves a `walking` patron.** A mug sliding into someone who is
   already drinking passes straight through and smashes at the door end. That
   punishes over-pouring without needing a separate rule for it.
3. **Losing a life restarts the wave rather than freezing the screen.** There is
   no "life lost" cutscene state: the counters clear, a spill is drawn, and the
   same wave begins again after a short grace period. Fewer states, same stakes.
4. **Levels are endless.** There is no win screen; waves get harder until
   `patronsForLevel` and `spawnInterval` reach their floors, after which the
   shift is a plain endurance run.
5. **The barkeep teleports between lanes.** Lane changes are instant rather than
   a walk along the taps — a lane change is a decision, not a race.
6. **Catching is positional only.** No catch button: standing in the lane when
   the empty arrives is the whole skill. The barkeep's `x` never changes.
7. **The idle overlay owns idle clicks.** While the start / pause / game-over
   overlay is up it covers the canvas, so a stray click on the bar cannot start
   a shift or waste a mug — the overlay's own button does that.
8. **Branch naming.** The task asked for a branch named after the game
   (`soda-shack`), but this session is pinned to the designated branch
   `claude/compassionate-ramanujan-a7wbxk`; the designated branch wins, and the
   game name lives in the folder, the commit and the PR title instead.
