# 8-Ball Pool — Design

## Concept

A two-player (hot-seat) game of 8-ball pool played on an HTML5 canvas. Players
alternate shots on a six-pocket table. The first legal pot after the break
assigns one player the solid balls (1–7) and the other the stripes (9–15). Once
a player has cleared their group they shoot at the 8-ball; sinking it legally
wins the game, sinking it early loses it.

The game is a single, dependency-free `<script>` (no modules, no build step),
matching the rest of the repo: `index.html` can be opened straight from disk.
Because the script is a classic script, all state and logic live as plain
globals, which is what the Playwright suite drives.

## Table geometry

```
CANVAS_W = 800, CANVAS_H = 440      canvas pixels
CUSHION  = 26                        rail thickness; play area is inset by this
BALL_R   = 10                        ball radius
POCKET_R = 19                        capture radius, measured from pocket centre
```

Six pockets sit at the four corners and the middle of the top and bottom rails
of the play area. `pockets` is an array of `{x, y}`.

The cue ball starts on the head spot (25% along the table), the rack is built
around the foot spot (75% along the table).

## Ball model

`balls` is an array of 16 objects:

```js
{ n, x, y, vx, vy, potted, color }
```

`n === 0` is the cue ball, `1..7` are solids, `8` is the eight ball, `9..15` are
stripes. `groupOf(n)` maps a number to `'cue' | 'solid' | 'eight' | 'stripe'`.

The rack is a **fixed, deterministic triangle** (no shuffling) so tests and
replays behave identically:

```
row 0:            1
row 1:          2   9
row 2:       10   8   3
row 3:     11   4  12   5
row 4:   13   6  14   7  15
```

The 8-ball sits in the centre of the third row, as in a legal rack.

## Physics

`step(dt)` advances the world by `dt` seconds. Internally it splits `dt` into
sub-steps of at most `1/240 s` so that a fast ball (max ≈ 1500 px/s) never moves
more than a few pixels per sub-step and cannot tunnel through another ball.

Each sub-step:

1. **Integrate** — `x += vx*dt`, `y += vy*dt` for every un-potted ball.
2. **Cushions** — a ball crossing a rail is pushed back inside and its normal
   velocity component is negated and scaled by `CUSHION_RESTITUTION` (0.92).
3. **Ball collisions** — equal-mass elastic response along the contact normal.
   Overlap is resolved positionally first (each ball backs off half the
   penetration) so balls never stick together. Tangential velocity is
   untouched — no spin, no throw.
4. **Pockets** — a ball whose centre is within `POCKET_R` of a pocket centre is
   marked `potted` and removed from play.
5. **Friction** — velocity decays exponentially, `v *= FRICTION_DECAY^dt`, and
   snaps to zero below `STOP_SPEED` (6 px/s) so the table always settles.

When every ball has stopped and the state is `rolling`, `resolveShot()` runs the
rules.

## Rules implemented

Tracked per shot in `shotInfo`: `firstHit` (number of the first object ball the
cue ball touched), `potted` (ball numbers, in the order they dropped) and
`targetGroup` (the group the shooter was legally on when the shot was taken).

`currentTargetGroup()` returns:

- `'open'` — the shooter has no group yet (table open, e.g. the break),
- `'solid'` / `'stripe'` — the shooter's assigned group still has balls left,
- `'eight'` — the shooter has cleared their group.

A shot is a **foul** when any of these hold:

- the cue ball hit nothing,
- the first ball contacted was not of the shooter's target group (on an open
  table anything except the 8-ball is legal),
- the cue ball was potted (scratch).

Outcomes:

| Situation | Result |
|---|---|
| 8-ball potted while on `'eight'` with no foul | shooter **wins** |
| 8-ball potted otherwise | shooter **loses** |
| Table open, object ball potted, no foul | groups assigned from the first ball potted |
| No foul and the shooter potted one of their own balls | shooter keeps the table |
| Foul | opponent gets **ball in hand** and the turn |
| Legal shot with no pot | turn passes |

After a scratch the cue ball is returned to the table and the incoming player
places it (`ballInHand`).

## Controls

| Input | Action |
|---|---|
| Mouse move | aim the cue at the pointer |
| Mouse down / hold `Space` | charge the power meter (0 → 100% in ~1 s) |
| Mouse up / release `Space` | take the shot |
| `←` `→` | nudge the aim by 0.02 rad |
| `↑` `↓` | nudge the power by 5% |
| Click (ball in hand) | place the cue ball |
| `R` | rack a new game |

`setAim(angle)`, `setPower(p)`, `shoot()` and `placeCue(x, y)` are also exposed
as globals, which is how the tests drive the game without synthesising input.

## Game states

`state` is one of:

- `'idle'` — start overlay showing, nothing racked,
- `'aiming'` — waiting for the shooter,
- `'rolling'` — balls in motion; resolves to `'aiming'` or `'over'`,
- `'over'` — someone has won; the overlay shows the result.

## Rendering

`draw()` paints the wooden rails, the felt, the pockets, every un-potted ball
(solids as filled circles, stripes as a white ball with a coloured band, each
with its number) and — while aiming — a dashed guide line from the cue ball
along the aim angle. The power meter and turn/group readouts are DOM elements
in the HUD rather than canvas drawing, so tests can assert on them as text.

## Testing

`EightBall/tests/eightball.spec.js` drives the page through Playwright. To keep
simulations deterministic the render loop only advances the world while the
global `autoStep` is `true`; tests set `autoStep = false` and then call
`step(dt)` or the `settle()` helper (which runs fixed 1/240 s steps until the
table stops or a step budget is exhausted) directly. Rules tests set up exact
board positions by writing to `balls` before shooting.

## Assumptions

These were decisions made without a human to ask; the simpler reading was taken
each time.

1. **Branch name.** The task asked for a branch named after the game
   (`eight-ball-pool`), but the session's standing instruction is to develop and
   push only on the assigned branch `claude/loving-euler-gir4mq`. The assigned
   branch wins; no separate game branch was created.
2. **Two-player hot-seat, no AI.** Both players share the keyboard/mouse. An
   opponent AI (shot selection over a physics table) is a much larger job and
   isn't needed for the game to be complete.
3. **Simplified break.** Real 8-ball requires four balls to reach a rail on the
   break; that rule is not enforced. Any break that contacts the rack is legal.
4. **Ball in hand is anywhere.** After a foul the cue ball may be placed
   anywhere on the table, not just behind the head string.
5. **No called shots or called pockets.** Any pot of your own group counts.
6. **No spin.** English/draw/follow are not modelled; collisions are pure
   equal-mass elastic responses, which keeps the physics deterministic and
   testable.
7. **Fixed rack.** The rack is the same every game (see above) rather than
   randomised, so games are reproducible and tests are stable.
8. **A ball that leaves the table is impossible** — cushions always reflect, so
   there is no "ball off the table" foul to handle.
