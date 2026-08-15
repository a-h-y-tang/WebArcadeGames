# Curling — Design

How the code works, and why it is shaped this way.

## Game concept

A top-down sheet of ice. You and a computer rink alternate delivering stones
from the hack at the bottom of the sheet towards the house (the rings) at the
top. When every stone of an end has come to rest, the team lying nearest the
button scores. Three ends decide the match.

The interesting decision on every shot is a three-way trade-off:

- **Weight** — too light and the stone never reaches the hog line (removed);
  too heavy and it sails through the back of the house (removed).
- **Line** — the aim, plus the handle, which bends the stone as it slows.
- **Sweeping** — after release you can still change the shot: sweeping makes
  the stone run further *and* straighten out. Whether you sweep is decided
  while the stone is travelling, which is the only real-time part of the game.

Because a stone that is already in the house can be knocked out, the last stone
of an end (the hammer) is worth a lot — which is why the scoring team gives up
the hammer for the next end.

## Files

| File | Role |
|---|---|
| `index.html` | Canvas, HUD, overlay and the key/mouse legend |
| `style.css` | Presentation only — no layout is computed in JS |
| `game.js` | All state, physics, rules, AI and rendering |
| `tests/curling.spec.js` | 81 Playwright tests, written before the game |

`game.js` is a single classic (non-module) script, matching Slime Volley, Kaboom
and Tetris in this repo. Every piece of state and every rule function is a plain
global, so a test can reach in, set up a position, and assert on the outcome
without any test-only hooks in the production path.

## Geometry

All measurements are canvas pixels on a 520×720 sheet:

```
y =  60   back line          a stone past this is out of play
y = 170   tee line / button  centre of the house (radius 84)
y = 560   hog line           a stone short of this is removed
y = 690   hack               where every delivery starts
```

Stones have radius 14. The house rings are 84 / 60 / 36 / 12.

## The simulation

`step(dt)` is the single entry point for time. It is called by the
`requestAnimationFrame` loop with real elapsed time (clamped to 1/30 s so a
backgrounded tab cannot teleport a stone), and by the tests with a fixed
`1/60`. It subdivides `dt` into 1/120 s sub-steps so fast stones cannot tunnel
through each other, and each sub-step does:

1. **Friction** — a deceleration of `FRICTION` px/s² directly opposing travel.
   Sweeping multiplies it by `SWEEP_FRICTION_MULT` (0.8).
2. **Curl** — a sideways acceleration of `CURL_ACCEL` px/s² perpendicular to
   travel, in the direction of the handle. Sweeping multiplies it by
   `SWEEP_CURL_MULT` (0.15), so a swept stone runs straight.
   Because the pull is perpendicular to *current* travel, the path bends
   progressively as the stone turns — the trajectory curves rather than
   sliding sideways.
3. **Collisions** — equal-mass, near-elastic. The velocity component along the
   line of centres is exchanged, the tangential component is untouched, and the
   pair is pushed apart so stones can never settle overlapping. A struck stone
   loses its handle (no curl), which is roughly true on real ice and keeps the
   physics predictable.
4. **Off-sheet removal** — anything past the back line or off the side is
   removed immediately.

A stone is at rest when its speed drops below `STOP_SPEED`, at which point its
velocity is snapped to exactly zero — so `allStopped()` is an exact test and
never a float comparison against an epsilon.

Distances follow from `v²/2a`, which is how the weight range was chosen:

| Weight | Release speed | Runs | Finishes at |
|---|---|---|---|
| 0% | 140 px/s | 89 px | short of the hog line — removed |
| 50% | 310 px/s | 437 px | y ≈ 253, a guard in front of the house |
| 58% | 337 px/s | 517 px | y ≈ 173, on the button |
| 100% | 480 px/s | 1047 px | through the back — removed |

## Rules

`scoreEnd()` is pure: it reads the stones on the sheet and returns
`{ team, points }` without touching the scoreboard. It sorts every stone that
overlaps the house by distance to the button; the nearest stone's team scores
one point for each of its own stones ahead of the opponent's best. `closeEnd()`
is the one that applies the result, updates the hammer and shows the break
overlay. Keeping the two apart is what lets the tests assert scoring on a dozen
hand-built positions without playing a single stone.

The state machine is deliberately small:

```
idle ──Space──> aiming ──throw──> sliding ──all stopped──┬──> aiming (next stone)
                  ^                                      └──> break ──Space──> aiming (next end)
                  └──────────── paused ────────────┘                  └──> over ──Space──> aiming
```

## The computer rink

`planAiShot()` returns `{ aim, power, spin }` and plays two shots:

- If the player is lying shot (nearest the button, in the house), it plays a
  **takeout**: aim straight at that stone, heavy weight, no handle.
- Otherwise it **draws** to the button.

Every shot gets a small random error — ±1.5° of line and a few percent of
weight — from a seeded RNG. The seed is reset per match from `Math.random()`,
so no two matches play out identically, but `rngState` is a plain global that a
test can pin to replay an end exactly.

Because the takeout aims at a straight line and ignores anything in the way, a
guard parked in front of your shot stone genuinely protects it. That is the
main strategy the game rewards, and it fell out of the AI being simple rather
than being designed in.

## Testing

Tests were written first, and drove several implementation details:

- Physics runs through `step(dt)`, not the animation loop, so a whole shot can
  be simulated inside a single `page.evaluate` and asserted deterministically.
- `throwStone()` returns the stone it created, so a test can identify the
  delivered stone when others are already on the sheet.
- `draw()` is called once during init, so the sheet is painted before the first
  animation frame.
- `playEnd()` exists purely so tests can fast-forward a whole end; the game
  itself never calls it.

Run them with `npx playwright test Curling/tests/`.

## Assumptions

Made where the brief was open, always choosing the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`curling`), but this session is required to develop and push on its
   designated branch `claude/loving-euler-hazt1j`. The designated branch wins;
   no second branch was created.
2. **Short match.** Real curling is 8–10 ends of 8 stones per team. This is
   3 ends of 4 stones each — a match lasts a couple of minutes, which suits a
   browser arcade game.
3. **Ties stand.** If the scores are level after the last end the match is a
   tie; there is no extra end.
4. **Hammer.** You throw first in end 1, so the computer holds the hammer;
   after that the team that scored throws first, per the real rule. A blank end
   leaves the order unchanged.
5. **Only the delivered stone is hog-lined.** A stone knocked short by a
   collision stays in play; only the stone just thrown is removed for failing
   to reach the hog line. There is no far hog line and no free-guard-zone rule.
6. **Sweeping is all-or-nothing** and applies only to the stone being
   delivered, not to stones it has struck.
7. **Handles do not survive a collision.** A stone that is hit stops curling.
8. **The player is always the red handles** and throws from the same hack; the
   sheet is never re-drawn from the other end.
