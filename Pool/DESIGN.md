# Pool — Design

## Concept

A single-player billiards table rendered on an HTML5 canvas. Nine numbered
object balls are racked in a diamond; the player takes shot after shot with the
cue ball until every object ball has been pocketed. The challenge is efficiency:
the game counts shots, and the fewest-shots run is remembered in
`localStorage`, so each rack is a race against your own personal best.

There is no opponent and no turn passing — the table is a solitaire puzzle of
angles. Every shot is a small geometry problem: pick a ball, find the ghost-ball
contact point, and judge how much power the cushions will eat.

## Rules

- The rack is nine object balls (1–9) plus the cue ball.
- Sinking **any** object ball in **any** pocket is legal and permanent.
- Every stroke of the cue counts as one shot.
- **Scratch** — pocketing the cue ball — costs one extra shot as a penalty and
  the cue ball is re-spotted on the head spot. If that spot is occupied the ball
  slides back along the head string toward the rail; if the whole head string is
  blocked, `respotCue()` falls back to a coarse scan of the cloth for the first
  square that is clear of other balls and clear of a pocket.
- The rack is cleared when all nine object balls are down. Final score is the
  shot count; lower is better.
- `R` re-racks at any time.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim — the cue points from the cue ball toward the pointer |
| Mouse press & hold on the table | Charge the shot (the power bar fills) |
| Mouse release | Strike |
| `←` `→` | Nudge the aim by 2° (hold `Shift` for 0.4° fine aim) |
| `Space` (hold) | Charge the shot; release to strike |
| `Space` (while idle / after a win) | Start a new rack |
| `R` | Re-rack |

## Physics model

All motion lives in `step(dt)`, which subdivides `dt` into fixed 1/240 s
sub-steps so a fast ball (up to `MAX_SHOT_SPEED` = 1150 px/s) never moves more
than ~5 px per sub-step — comfortably less than one ball radius, which is what
keeps balls from tunnelling through each other or through a cushion.

Each sub-step does four things in order:

1. **Integrate** — `x += vx*dt`, and apply rolling friction as an exponential
   decay `v *= FRICTION_PER_SEC^dt`. Below `STOP_SPEED` (6 px/s) a ball is
   snapped to rest, which guarantees the table always settles.
2. **Pocket test** — a ball whose centre comes within `POCKET_R` of a pocket
   centre is removed from play. This is checked *before* cushion bounces so a
   ball entering a pocket mouth is not first reflected back out.
3. **Cushion test** — a ball crossing a rail is clamped back inside the play
   area and its normal velocity component is negated and scaled by `RAIL_E`
   (0.92), so cushions absorb a little energy.
4. **Ball–ball test** — every pair is checked for overlap. Overlapping pairs are
   separated symmetrically along the contact normal, and if they are
   *approaching* (relative normal velocity < 0) an equal-mass impulse with
   restitution `BALL_E` (0.95) is applied. Equal masses mean a dead-on hit
   transfers nearly all the cue ball's speed to the object ball, which is what
   makes stop shots and cut shots behave the way a player expects.

The model is intentionally 2-D and spinless: no english, no throw, no masse, no
cue-ball draw or follow. A struck ball simply leaves at the aim angle.

## Game states

```
idle ──Space/Start──► aiming ──release charge──► rolling
                        ▲                           │
                        └────── table settles ──────┤
                                                    │ last ball down
                                                    ▼
                                                   won ──Space──► aiming
```

`step(dt)` is inert unless the state is `rolling`, so tests can safely call it
at any time. Charging happens while `aiming` and is advanced by
`updateCharge(dt)` from the animation frame, so the power bar fills at a
wall-clock rate rather than a frame-rate-dependent one.

## Code layout

Written as one classic (non-module) script, matching the other games in this
repo, so the Playwright tests can reach state and helpers as plain globals:

- `Pool/index.html` — HUD, canvas, overlay, power meter, help legend.
- `Pool/style.css` — dark felt-and-brass presentation.
- `Pool/game.js`
  - **Geometry constants** — table, pockets, rack layout.
  - **Setup** — `rackBalls()`, `startGame()`, `respotCue()`.
  - **Physics** — `step(dt)`, `subStep(h)`, `collidePair()`, `allStopped()`.
  - **Shooting** — `setAim()`, `beginCharge()`, `updateCharge()`,
    `releaseCharge()`, `shoot(power)`.
  - **Rendering** — `draw()` paints felt, pockets, balls, cue stick and the aim
    guide with its ghost ball.
  - **Input** — mouse and keyboard bindings, then `requestAnimationFrame` loop.

### Globals the tests rely on

`state`, `balls`, `cueBall`, `pockets`, `shots`, `bestShots`, `aimAngle`,
`power`, `charging`, `step`, `shoot`, `beginCharge`, `updateCharge`,
`releaseCharge`, `setAim`, `allStopped`, `ballsRemaining`, `startGame`, and the
geometry constants `CANVAS_W`, `CANVAS_H`, `BALL_R`, `PLAY_L`, `PLAY_R`,
`PLAY_T`, `PLAY_B`, `POCKET_R`, `MAX_SHOT_SPEED`, `OBJECT_BALL_COUNT`.

## Assumptions

These were decisions taken without a human to ask; the simpler reading won each
time.

1. **Solo, not versus.** Two-player 8-ball needs group assignment, legal-shot
   validation, call shots and ball-in-hand. A shot-count solitaire rack keeps
   the physics as the whole game and stays fully deterministic to test.
2. **Nine balls, any pocket, no call shots.** No "must hit the lowest ball
   first" rule, so there is no foul beyond the scratch. This removes an entire
   class of rules arbitration.
3. **Spinless physics.** No english/draw/follow. Adding spin would need a third
   state variable per ball and a contact-patch model for very little gain in an
   arcade context.
4. **Scratch costs a shot rather than ball-in-hand.** Ball-in-hand would need a
   drag-to-place UI mode; a +1 penalty expresses the same "scratching is bad"
   pressure in one line.
5. **Pockets are circles.** Real pockets have jaws that can rattle a ball back
   out. A circular capture radius is far simpler and reads as fair.
6. **Score is shots, lower is better.** `bestShots` starts unset and shows `—`
   until the first cleared rack.
7. **Branch naming.** The task asked for a branch named after the game
   (`pool`), but this session's standing git instruction pins all work to
   `claude/loving-euler-o9h95v`. The explicit branch pin wins; the folder and
   game id still carry the game's name.
8. **Browser category.** Registered in the game browser under `Sports`,
   alongside Bowling, Darts and Mini Golf.
