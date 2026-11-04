# Soda Tapper — Design

## Game concept

You are the only soda jerk working four counters of a very thirsty arcade bar.
Patrons shuffle in from the far (right) end of each counter and walk steadily
towards your taps on the left. Pull a soda and it slides down the counter; the
patron who catches it is shoved back towards the door and flings the empty mug
back at you. Catch the empty, keep every counter clear, and push every patron
out of the door to clear the shift.

Three things end a life:

- a patron reaches the taps (they grab you by the apron),
- a soda runs the whole length of a counter without being caught (it smashes on
  the floor at the far end),
- a returning empty mug reaches the taps while you are standing at another
  counter (it shatters).

Lose three lives and the shift is over. Clear a shift and the next one spawns
more patrons, who walk faster and arrive more often.

## Mechanics

### Geometry

The board is a fixed `760 x 460` canvas holding `LANES = 4` horizontal
counters. Every counter spans the same x range: `BAR_LEFT = 110` (the taps,
where the jerk stands) to `BAR_RIGHT = 720` (the door). Counter *i* is drawn at
`LANE_Y[i]`. All gameplay is one-dimensional per counter — the only vertical
movement in the game is the jerk hopping between counters — which keeps every
rule decidable from a single x coordinate.

### Entities

| Entity | Fields | Motion |
|---|---|---|
| jerk | `lane` | teleports between counters (no travel time) |
| full mug | `lane, x, kind:'full'` | `+MUG_SPEED` (rightwards, 300 px/s) |
| empty mug | `lane, x, kind:'empty'` | `-EMPTY_SPEED` (leftwards, 230 px/s) |
| patron | `lane, x, push, drinks` | `-walkSpeed` while `push === 0`, else `+PUSH_SPEED` |
| tip | `lane, x` | `-TIP_SPEED` (leftwards, 180 px/s) |

A patron spawns at `SPAWN_X = BAR_RIGHT - 24` and leaves satisfied once
`x >= BAR_RIGHT`. A patron that reaches `CAUGHT_X = BAR_LEFT + 30` costs a life.

### The serve loop

1. `pour()` pushes a full mug onto the jerk's counter at `BAR_LEFT + 8` and
   starts a `POUR_COOLDOWN` (0.22 s) timer, so sodas cannot be spammed.
2. A full mug and a patron collide when their centres are within
   `(MUG_W + PATRON_W) / 2`. On a collision the mug is consumed, the patron's
   `drinks` counter increments, `PUSH_DIST` (150 px) of shove is *added* to the
   patron's `push` budget (so pushes stack), and an empty mug is spawned at the
   patron's position heading back towards the taps.
3. An empty mug that reaches `BAR_LEFT` is caught automatically if the jerk is
   standing at that counter, and shatters otherwise.
4. A patron shoved past `BAR_RIGHT` leaves through the door, and has a
   `TIP_CHANCE` (35%) of leaving a tip sliding back down the counter. A tip is
   collected like an empty mug, but missing one costs nothing.

Because the shove is a fixed distance, serving a patron early (while they are
still near the door) ends their visit in one or two sodas, while a patron who
has walked most of the counter needs four. The counter position *is* the
difficulty curve.

### Shifts (levels)

`levelConfig(level)` derives every per-shift number from the shift index:

```
walkSpeed    = 24 + 5 * (level - 1)      px/s
spawnInterval= max(1.6, 4.2 - 0.35 * (level - 1))  seconds
patrons      = 5 + 2 * level             total arrivals in the shift
maxOnScreen  = min(2 + level, 6)         concurrent patrons
```

A shift is cleared when every arrival has been spawned and no patrons are left
on any counter. Clearing a shift awards `LEVEL_BONUS * level` (1000 per shift)
and immediately starts the next one.

### Scoring

| Event | Points |
|---|---|
| Patron catches a soda | 50 |
| Empty mug caught | 100 |
| Patron leaves through the door | 250 |
| Tip collected | 500 |
| Shift cleared | 1000 x shift |

The best score is kept in `localStorage` under `sodatapper-best`.

### Losing a life

Any of the three failures calls `lose(reason)`, which clears that one counter —
its patrons, mugs and tips all go — and decrements `lives`. The rest of the bar
keeps running. At zero lives the state becomes `over`.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` / `Enter` | pour a soda (also starts or resumes the game) |
| `P` | pause / resume |
| Click a counter | jump to that counter and pour |

## Code layout

`game.js` is a single classic (non-module) script, matching Gold Runner,
BurgerTime, Snake and the rest of the repo: all state and helpers are plain
globals so the Playwright suite can read and drive them directly. Every speed
is expressed per second and the whole simulation is advanced by `step(dt)`, so
tests set `autoStep = false` and call `step` a fixed number of times instead of
depending on `requestAnimationFrame` wall-clock timing. `draw()` is pure
rendering and never mutates game state.

Randomness (spawn counter choice, tip drops) goes through a seeded LCG
(`seedRng`, `rand`) so a test can pin the sequence when it needs to.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
is recorded here.

1. **Branch name.** The brief asks for a branch named after the game
   (`soda-tapper`), but this session's standing instructions designate
   `claude/compassionate-ramanujan-3j5wje` and forbid pushing anywhere else.
   The designated branch wins; the game folder carries the game's name.
2. **The jerk stands at the taps.** In the original arcade cabinet the
   bartender runs the length of the bar to collect empties. Here the jerk is
   pinned to the tap end and only changes counter, so a counter is either
   covered or it is not — one binary instead of a chase.
3. **Catching is automatic.** No catch button. Being on the right counter when
   an empty or tip arrives is the whole skill.
4. **Pouring is instant.** No hold-to-fill meter; `Space` yields a full mug,
   rate-limited by a cooldown.
5. **A patron is satisfied by distance, not by a drink quota.** Enough shove to
   push them out of the door is the only requirement, so the number of sodas a
   patron needs depends on where they were served.
6. **Pushes stack.** Two sodas landing on the same patron add their shoves
   rather than the second being wasted.
7. **Shift transitions are instant.** No inter-shift cutscene or bonus round;
   the next shift begins on the frame the last patron leaves, which keeps the
   simulation deterministic for tests.
8. **Losing a life clears only the offending counter.** The other three keep
   simulating, so a mistake is local rather than a full board reset.
9. **Missing a tip is free.** Tips are upside only; the penalty is the lost
   points.
