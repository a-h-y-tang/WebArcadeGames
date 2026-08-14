# Tapper — Design

## Concept

A single-screen arcade game inspired by the 1983 coin-op bartender games. You
are the barkeep on the right-hand side of four parallel bars. Thirsty patrons
push in from the far left of each bar and shuffle towards you. Slide a full mug
down a bar to knock a patron back; keep every bar under control and catch the
empty mugs that come sliding back before they shatter on the floor.

The game is a wave/level game: each level has a fixed number of patrons. Clear
them all and the next level arrives with more patrons, faster patrons, and
(from level 3) patrons that need more than one drink before they give up.

## Screen layout

```
 x = 40                                                     x = 600
  ┌──────────────────────────────────────────────────────────┐
  │  patrons enter here ──►                    ◄── barkeep   │   lane 0  y =  90
  ├──────────────────────────────────────────────────────────┤
  │                                                          │   lane 1  y = 190
  ├──────────────────────────────────────────────────────────┤
  │                                                          │   lane 2  y = 290
  ├──────────────────────────────────────────────────────────┤
  │                                                          │   lane 3  y = 390
  └──────────────────────────────────────────────────────────┘
```

Canvas is a fixed 640 × 480. `BAR_LEFT = 40`, `BAR_RIGHT = 600`, four lanes at
`laneY(i) = 90 + i * 100`.

## Mechanics

### Entities

| Entity | Fields | Behaviour |
|---|---|---|
| Barkeep | `bartender.lane` | Snaps instantly between lanes 0–3. Always at the right edge. |
| Patron | `lane, x, mugs, need, state, drinkTimer` | Walks right at the level's speed. `state` is `walking`, `drinking` or `leaving`. |
| Full mug | `lane, x` | Spawns at the barkeep, slides **left** at `MUG_SPEED`. |
| Empty mug | `lane, x` | Spawns where a patron gave up, slides **right** at `EMPTY_MUG_SPEED`. |

### Rules

1. **Serving.** `Space` pours a mug into the barkeep's current lane. A
   `SERVE_COOLDOWN` of 0.22 s stops a held key from flooding the bar. Mugs are
   unlimited.
2. **Catching a patron.** A full mug is caught by the right-most patron in its
   lane whose body it overlaps. The patron is shoved `PUSH_BACK = 70` px to the
   left and drinks for `DRINK_TIME = 1.1` s (frozen in place), then walks again.
   Each sip scores `SCORE_SIP = 25`.
3. **Serving a patron out.** When a patron has drunk `need` mugs it gives up:
   it turns around, walks off the left end, and scores `SCORE_SERVED = 100`.
   As it leaves it slides its **empty mug** back towards the barkeep.
4. **Empty mugs.** An empty mug that reaches `BAR_RIGHT` is caught for
   `SCORE_CATCH = 50` if the barkeep is standing in that lane. If the barkeep is
   somewhere else the mug smashes on the floor and costs a life.
5. **Missed serve.** A full mug that reaches `BAR_LEFT` without meeting a patron
   smashes and costs a life.
6. **Getting grabbed.** A patron that reaches the barkeep's end of a bar costs a
   life.
7. **Losing a life.** All patrons and mugs are cleared, the game pauses in the
   `dying` state for 1.2 s, and the current wave restarts from the beginning.
   At zero lives the game is `over` and the best score is written to
   `localStorage` under `tapper-best`.
8. **Clearing a level.** When every patron of the wave has spawned and no
   patrons or mugs remain, the game enters `levelup` for 1.4 s, awards
   `LEVEL_BONUS × level`, then starts the next wave.

### Level scaling

| Quantity | Formula |
|---|---|
| Patrons per wave | `4 + level * 2` |
| Patron walk speed | `26 + (level - 1) * 6` px/s |
| Spawn interval | `max(0.9, 2.6 - level * 0.15)` s, ±25 % jitter |
| Mugs needed per patron | `min(3, 1 + floor((level - 1) / 2))` |

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | Move the barkeep up one bar |
| `↓` / `S` | Move the barkeep down one bar |
| `Space` | Pour a mug down the current bar |
| `P` | Pause / resume |
| `Space` / Start button (idle or game over) | Start a new game |

## Code structure

`game.js` is a plain classic script — no modules, no bundler — so that every
piece of state is reachable from a Playwright `page.evaluate` by name. The file
is organised as:

1. Constants and DOM handles.
2. Mutable game state (`state`, `score`, `lives`, `level`, `best`,
   `bartender`, `customers`, `mugs`, `emptyMugs`).
3. A seeded `rng()` (mulberry32 over `rngSeed`) so waves are reproducible.
4. Pure-ish helpers: `spawnCustomer`, `serve`, `spawnEmptyMug`, `loseLife`,
   `nextLevel`.
5. `step(dt)` — the whole simulation for one time slice.
6. `draw()` — all rendering, no state mutation.
7. Input handlers and the `requestAnimationFrame` driver.

### Testing hooks

Three globals exist purely so the Playwright suite can be deterministic:

- `autoStep` — when `false`, the animation loop keeps drawing but stops calling
  `step()`, so the only simulation progress is what a test asks for.
- `spawnEnabled` — when `false`, no patrons spawn on the timer; tests place
  patrons themselves with `spawnCustomer(lane, need)`.
- `rngSeed` — seeds the wave RNG.

`step(dt)` is called with a fixed `dt` by tests (1/60 by default) and with a
clamped real delta by the animation loop.

## Assumptions

These were ambiguous in the task description; the simpler reading was taken and
is recorded here.

- **Branch name.** The task asks for a branch named after the game
  (`tapper`), but this session is pinned to the designated branch
  `claude/loving-euler-nubuaq` and must not push anywhere else. Work is
  therefore done on the designated branch and the game name is carried by the
  folder, the commit message and the pull request title instead.
- **Mug supply.** The arcade original gives the barkeep a limited number of
  mugs per keg. Unlimited mugs were chosen — the pressure comes from patrons
  and from returning empties, which is enough.
- **Barkeep movement.** Lane changes are instant snaps rather than an animated
  slide. It keeps the collision model exact and the controls crisp.
- **Losing a life restarts the wave** rather than the whole level's score, so a
  mistake costs progress but not points.
- **No bonus/distraction items** (the original's dancing-girl round and cash
  tips) — they add art and state without changing the core loop.
- **Fixed canvas size.** 640 × 480, not responsive, matching the other games in
  this repo.
