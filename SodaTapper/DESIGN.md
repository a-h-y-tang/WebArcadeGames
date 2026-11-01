# Soda Tapper — Design

## Concept

Soda Tapper is a single-screen, four-lane serving game in the spirit of the 1983
arcade cabinet *Tapper*. You are the lone soda jerk at a retro arcade bar with
four counters. Thirsty patrons shoulder their way in at the far (left) end of
each counter and walk steadily toward the taps where you stand. Slide a full mug
down a counter to stop a patron: they catch it, get shoved backwards while they
drink, and send the empty glass sliding back at you.

The game is a juggling act between three ways to die:

- a patron that reaches the taps grabs you by the apron,
- a mug you slide down an **empty** counter smashes on the far end,
- an empty glass coming back that you are not standing in front of smashes on
  the floor.

So you cannot spam mugs, you cannot camp in one lane, and you cannot ignore the
glassware you have already sent out. Clear every patron on the level and the next
shift opens with more customers, walking faster, some of them wanting a second
round.

## Layout

The canvas is 760 × 470 and holds four counters stacked top to bottom.

| Constant | Value | Meaning |
|---|---|---|
| `LANES` | 4 | number of counters |
| `LANE_TOP` | 26 | y of the first counter's band |
| `LANE_H` | 108 | height of one counter band |
| `BAR_LEFT` | 70 | far end of a counter: patrons enter, mugs smash |
| `BAR_RIGHT` | 672 | tap end of a counter: empties are caught, patrons grab you |
| `BARMAN_X` | 706 | where the barman is drawn, right of the taps |
| `CUST_R` | 18 | patron collision half-width |
| `MUG_R` | 9 | mug collision half-width |

Positions are plain pixel x-coordinates along a counter plus an integer lane
index, so there is no grid and no 2-D collision: every interaction is a 1-D
overlap test inside one lane. That is what keeps the rules decidable and the
tests deterministic.

## Entities

**Barman** — `{ lane }`. He never leaves the tap column; only his lane changes,
one counter per key press.

**Patron** — `{ lane, x, speed, thirst, mode, timer, push }` with three modes:

| Mode | Behaviour |
|---|---|
| `advancing` | walks right at `speed` px/s; reaching the taps costs a life |
| `drinking` | shoved left by `PUSH_BACK` px at `PUSH_SPEED`, for `DRINK_TIME` s |
| `leaving` | walks left at `LEAVE_SPEED`; off the far end it scores and is gone |

A drink decrements `thirst`. At zero the patron switches to `leaving`;
otherwise they go back to `advancing` for another round.

**Mug** — `{ lane, x, vx }` with `vx = -MUG_SPEED`: a full mug sliding away from
the taps. It is consumed by the first `advancing` patron it overlaps and smashes
if it passes `BAR_LEFT`.

**Empty** — `{ lane, x, vx }` with `vx = +EMPTY_SPEED`: the glass a patron slides
back after drinking. At `BAR_RIGHT` it is caught if the barman is in that lane
and smashes otherwise.

## Tuning

| Constant | Value |
|---|---|
| `MUG_SPEED` | 300 px/s |
| `EMPTY_SPEED` | 215 px/s |
| `CUST_BASE_SPEED` | 26 px/s (level 1) |
| `CUST_SPEED_STEP` | 5.5 px/s per level |
| `PUSH_BACK` / `PUSH_SPEED` | 86 px / 170 px/s |
| `DRINK_TIME` | 0.9 s |
| `LEAVE_SPEED` | 150 px/s |
| `POUR_COOLDOWN` | 0.22 s |
| `LIFE_PAUSE` / `CLEAR_PAUSE` | 1.1 s / 1.5 s |
| `LIFE_PUSHBACK` | 60 px |

Level *n* queues `6 + 2n` patrons (so eight on level 1), spawned on a shrinking
interval (`max(1.05, 2.6 - 0.18(n-1))` seconds, jittered), walking at
`CUST_BASE_SPEED + CUST_SPEED_STEP(n-1)`. From level 2 on, a patron has a
`min(0.5, 0.12(n-1))` chance of wanting two rounds. Patron lanes, jitter and
thirst come from a small seeded LCG (`setSeed`), so a run is reproducible and a
test can pin the sequence.

## Scoring

| Event | Points |
|---|---|
| Mug served (per drink) | 50 |
| Empty glass caught | 25 |
| Patron leaves satisfied | 100 |
| Level cleared | 750 |

Best score is kept in `localStorage` under `sodatapper-best`.

## State machine

`idle → playing ⇄ paused`, with two timed interludes and one terminal state:

| State | Meaning |
|---|---|
| `idle` | title overlay; `step()` is inert |
| `playing` | the simulation runs |
| `paused` | `P` pressed; `step()` is inert |
| `life` | a life was just lost; `LIFE_PAUSE` s of held breath, then `playing` |
| `clear` | level finished; `CLEAR_PAUSE` s, then the next level is built |
| `gameover` | overlay with the final score; best score written |

A level is cleared when at least one patron has been spawned on it and the
pending queue, the patrons, the mugs and the empties are all empty.

Losing a life clears every mug and empty in flight and shoves all patrons back
`LIFE_PUSHBACK` px (clamped to `BAR_LEFT`), so play never resumes with a patron
already on top of the taps.

## Code shape

`game.js` is a single classic (non-module) script, like Snake, Tetris, BurgerTime
and Gold Runner in this repo, so its state and helpers are reachable from the
Playwright specs as plain globals. All motion is expressed per second and
advanced through `step(dt)`; `requestAnimationFrame` only ever calls `step` when
`autoStep` is true, so a spec can switch the real clock off and simulate frames
by hand.

Rendering is a pure function of state (`draw()`): wood counters with grain, a
tap column, patrons drawn as hatted figures behind the bar, amber mugs with foam
and translucent empties, plus short-lived `splashes` for smashed glass. Nothing
in `draw()` mutates game state.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` or `W` `S` | move the barman one counter |
| `Space` | pour and slide a mug down the current counter |
| `Space` / `Enter` | start, or restart after game over |
| `P` | pause / resume |

Clicking the canvas also pours, and clicking the upper/lower half of a counter is
not used — the mouse is a convenience for pouring only.

## Assumptions

Decisions taken without asking, each resolved toward the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`soda-tapper`), but this session's harness pins all development to
   `claude/compassionate-ramanujan-wv7ndd` and forbids pushing elsewhere. The
   harness branch wins; the game name lives in the folder name instead.
2. **No hold-to-fill.** The arcade original has you hold the tap handle to fill a
   mug and release to slide it. Here a single `Space` press pours and slides in
   one go, rate-limited by `POUR_COOLDOWN`. Overfilling as a failure mode is
   dropped.
3. **Automatic catching.** The barman catches a returning empty simply by being
   in its lane when it reaches the taps; there is no separate catch input.
4. **Mugs only hit advancing patrons.** A mug slides straight past a patron who
   is drinking or leaving. This keeps "wasted mug smashes" the clear consequence
   of sliding into a lane you have already cleared.
5. **Empties ignore patrons.** A returning glass passes under everyone; only the
   taps end resolves it.
6. **Patrons cannot be shoved off the far end.** Push-back is clamped at
   `BAR_LEFT`, so a drink never ends with a patron walking out backwards — they
   leave only when their thirst is satisfied.
7. **No bonus rounds.** The original's "shake the cans" bonus screen and the
   dancing-girls interlude are out of scope; levels run back to back.
8. **One mug sprite.** Soda, not beer — the theme is a soda fountain, so the
   artwork is amber soda in a glass mug with foam, and no alcohol is depicted or
   named.
9. **Lives on both smash types.** Smashing a full mug on the far end and dropping
   a returning empty both cost a life, exactly like letting a patron reach the
   taps. There is no "cheaper" mistake.
