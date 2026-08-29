# Sky Climber — Design

A vertical climbing arcade game on an HTML5 canvas, in the spirit of *Crazy
Climber*. You scale the face of a skyscraper hand over hand, hauling yourself up
a lattice of windows while the building tries to shake you off: windows slam
shut on your fingers and flower pots rain down from the roof.

## Concept

The building is a grid of windows — `COLS` columns wide and `rows` tall, where
`rows` grows with each level. The climber straddles **two adjacent columns**,
one hand on each. Each hand grips a window ledge; a hand may only move onto a
window that is currently **open**.

Climbing is deliberately two-handed: a hand may never be more than one row above
or below its partner, so you rise by alternating — raise the left, raise the
right, raise the left. Your *body row* is the lower of the two hands, and that
is what counts as height, what the camera follows, and what the hazards hit.

Reach the roof (both hands on the top row) to clear the building and start a
taller one.

## Mechanics

### The grid

| Constant | Value | Meaning |
|---|---|---|
| `COLS` | 5 | window columns |
| `COL_W` | 96 px | column width |
| `ROW_H` | 56 px | row height |
| `ROWS_BASE` / `ROWS_STEP` | 16 / 3 | building height at level 1, and per level |
| `CANVAS_W` × `CANVAS_H` | 520 × 640 | canvas size |

Row 0 is the street-level ledge and its windows are **always open**, so the
ground is always a safe landing. The top row (`roofRow = rows - 1`) is the roof.

### Windows

Every window above row 0 runs its own cycle, driven by a seeded PRNG so a run is
reproducible:

```
open (4–9 s) → closing (0.8 s warning flash) → closed (1.5–3.5 s) → open → …
```

Timings shorten as the level rises (×0.88 per level), and each window starts at
a random point in its cycle so the wall does not open and shut in one wave —
roughly 60–80% of it is open at any moment.

A hand may only be *moved onto* an `open` window. A window that is `closing`
still holds — the flashing frame is your warning to move. When it reaches
`closed` with a hand on it, the grip breaks and the climber **slips**: both hands
slide down to the nearest row below where both of the climber's columns are open.
Because row 0 is always open, a slip can never be fatal — it only costs height.

### Flower pots

Pots are dropped from above at a rate and speed that scale with the level: one
every ~3 s falling at 180 px/s on the first building, tightening from there, with
at most three in flight so the lanes never all fill at once. A pot falls down a
single column, and for the first 1.5 s of a climb none of them can touch you.

A pot that reaches the climber's body while it is in either of the climber's two
columns knocks them off the wall: the state becomes `falling`, the climber drops
to the street, and a life is spent. With lives left you restart at the bottom of
the *same* building with your score intact; otherwise the game is over.

### Scoring

| Event | Points |
|---|---|
| Each new highest row reached | 10 |
| Reaching the roof | 500 × level |

Height points are paid only for rows above your best so far *on the current
building*, so sliding down and re-climbing the same stretch earns nothing; a new
building starts the height marker again. The best score is kept in
`localStorage` under `skyclimber.best`.

### Level progression

Clearing a building gives a short celebration pause, then the next level starts
with a building `ROWS_STEP` rows taller, faster pots, a shorter gap between pot
drops and quicker window cycles. Lives carry over; the climber restarts at the
bottom of the new building.

## Controls

| Input | Action |
|---|---|
| `W` / `S` | raise / lower the **left** hand |
| `↑` / `↓` | raise / lower the **right** hand |
| `A` `D` / `←` `→` | shift both hands one column (needs both hands level) |
| `Space` | start the game when idle or after game over |
| `Enter` | start / restart |
| `P` | pause / resume |

Holding a hand key repeats the move every 0.15 s. Holding both hand keys climbs
at full speed — the one-row rule between the hands paces the alternation for you,
so the skill lies in reading the wall and dodging, not in drumming the keys.

## Code layout

```
SkyClimber/
  index.html    page shell: HUD, canvas, overlay, help text
  style.css     dark "night skyline" theme matching the other games
  game.js       all game state and logic (classic script, globals)
  tests/
    sky-climber.spec.js   Playwright suite
```

`game.js` is a classic (non-module) script, like Snake, Tetris and BurgerTime in
this repo, so every piece of state (`state`, `score`, `climber`, `pots`,
`windows`) and every helper (`step`, `draw`, `startGame`, `tryRaise`, …) is a
plain global the Playwright tests can reach through `page.evaluate`.

All motion is expressed per second and advanced by `step(dt)`. The animation
loop only computes `dt` and calls `step`/`draw`, so a test can simulate any
number of frames deterministically without depending on `requestAnimationFrame`
wall-clock timing. Tests park the loop with `autoStep = false`, switch off the
random systems with `potsEnabled = false`, `windowCycling = false` and
`graceTimer = 0`, and reshape the wall with `openAllWindows()` and
`setWindow(col, row, 'closed')`.

### State machine

```
idle ──start──▶ running ──roof──▶ levelclear ──pause──▶ running (next level)
                  │  ▲                   
             hit  │  │ respawn (lives > 0)
                  ▼  │
               falling ──── lives = 0 ───▶ over ──start──▶ running
                  
running ◀──P──▶ paused
```

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken and
recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`sky-climber`), but this session's standing instructions pin development to
   `claude/compassionate-ramanujan-nn13r4`. The session branch wins, since
   pushing elsewhere is explicitly forbidden.
2. **Two-joystick controls simplified.** The arcade original gives each arm its
   own joystick with full four-way movement. Here each hand moves only
   vertically and the pair always straddles two adjacent columns; sideways
   movement shifts both hands at once and requires them to be level. This keeps
   the climber's posture always legal and the rules explainable in one line.
3. **Slipping is never fatal.** A window closing on a hand costs height, not a
   life. Only a flower pot ends a life. One clearly-signalled way to die is
   easier to learn than two.
4. **Only one hazard type.** The original also throws signs, birds and a giant
   ape. This build ships flower pots only, scaled by level, rather than a
   shallow version of four hazards.
5. **Height is measured in rows,** and the HUD shows the body row directly
   rather than converting to metres or floors.
6. **Score is not reset on a life lost,** and neither is the best-row marker, so
   re-climbing after a fall pays nothing until you pass your previous best on
   that building.
7. **Difficulty was tuned by simulation, not by feel.** A scripted bot that
   climbs and sidesteps falling pots was run over a dozen seeded games; the
   building height, pot rate and window odds above are the numbers at which that
   bot clears the first building about half the time, which leaves headroom for
   a human who reads the wall better than it does.
8. **Game-browser count assertion left alone.** `game-browser/e2e/game-browser.spec.ts`
   asserts an exact card count that was already stale before this change (it
   expects 105 for the 108 entries in `games.json`). That suite is not part of
   the root `npm test` run, and correcting an unrelated pre-existing assertion is
   out of scope for this game, so only the `games.json` entry was added.
