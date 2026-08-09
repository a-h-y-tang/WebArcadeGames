# Billiards — Design

## Concept

A top-down pool table rendered on a single HTML5 canvas. The player breaks a
rack of ten object balls, pots the nine colours in any order, then pots the
black 8 to clear the rack and rack up a fresh one. Potting the 8 while colours
are still on the table ends the run — that is the only way to lose, so every
shot near the black carries real risk. Score, rack count and best score persist
across the session; the best score is stored in `localStorage`.

There is no opponent and no shot clock: the tension comes from the 8 ball and
from the scratch penalty, not from a timer.

## Rules

| Event | Effect |
|---|---|
| Pot a colour | +100 |
| Pot the cue ball (scratch) | foul, −50 (score floor 0), cue respotted on the head spot |
| Pot the 8 with colours left | game over |
| Pot the 8 with the table clear | +300 rack bonus, next rack, cue respotted |

A scratch on the same shot that legally pots the 8 still costs the foul, but the
rack is cleared and a new one is racked.

## Mechanics

### Rack

`newRack()` builds the standard triangle — rows of 1, 2, 3 and 4 balls with the
8 in the middle of the third row. Balls are spaced `2·BALL_R + 0.5` px apart so a
fresh rack never starts overlapping. The cue ball goes on the head spot, a
quarter of the way along the table.

### Physics

All motion is expressed per second and advanced by `step(dt)`, which splits `dt`
into fixed `1/240 s` sub-steps. A sub-step is:

1. **Friction** — a constant `DECEL` of 240 px/s² applied against the direction
   of travel. Below `STOP_SPEED` (6 px/s) a ball is parked exactly at zero, which
   is what lets `allStopped()` terminate a shot cleanly.
2. **Integration** — `x += vx·h`, `y += vy·h`.
3. **Pockets** — a ball whose centre comes within `POCKET_R` of a pocket centre
   is potted. This runs *before* the cushion clamp so a ball rolling into a
   corner drops instead of being pushed back onto the cloth.
4. **Cushions** — positions are clamped to the cloth and the normal velocity is
   reflected with a `CUSHION_LOSS` of 0.86.
5. **Ball collisions** — every remaining pair is checked. Overlapping balls are
   pushed apart along the line of centres, then the *normal* component of the
   relative velocity is exchanged (equal masses, restitution 0.96). Only the
   normal component is swapped, which is what makes cut shots throw the object
   ball off at the natural angle while the cue ball slides along the tangent.

A fixed sub-step of 1/240 s means a ball at the maximum 1150 px/s moves under
5 px per tick — well under a ball radius — so nothing tunnels through a cushion
or another ball.

The shot ends when every ball on the cloth has stopped; `resolveShot()` then
applies fouls, rack clears and game over, and hands control back to the player.

### Aiming and power

`aimAngle` is a plain radian heading from the cue ball. `aimContact()` casts a
ray along it, intersecting the swept circle of radius `2·BALL_R` against every
live ball and then the cushions, and returns the nearest hit — that is what draws
the guide line and the ghost ball at the contact point.

Power is a 0–1 charge. Holding the shot control ramps it at `CHARGE_RATE` (1.1
per second) inside `step()`, so the meter fills at the same rate whether the
frame rate is high or low, and releasing fires the cue at `power · MAX_SPEED`.

### State machine

```
idle ──Space/Start──> ready ──shoot()──> rolling ──all balls stopped──> ready
                        ^                                │
                        └──────── new rack ──────────────┤
                                                         │ 8 potted early
                                                         v
                                                        over ──Space/Play Again──> ready
```

## Controls

| Input | Action |
|---|---|
| Mouse move | aim the cue at the pointer |
| Mouse hold / release | charge power, shoot |
| `Space` hold / release | charge power, shoot (also starts the game) |
| `←` `→` | fine-tune the aim |
| `↑` `↓` | nudge the power meter without charging |
| `R` | new game |

## Code layout

- `index.html` — HUD, canvas, overlay, help line.
- `style.css` — dark felt-green shell matching the other games in the repo.
- `game.js` — a single classic (non-module) script. State and physics are plain
  globals so the Playwright tests can drive `step(dt)` deterministically without
  depending on `requestAnimationFrame` wall-clock timing, exactly as Kaboom,
  Snake and Tetris do here.
- `tests/billiards.spec.js` — 59 Playwright tests covering the rack, aiming and
  the power meter, friction, cushions, ball-on-ball collisions, pocketing,
  fouls, the 8 ball, racks, scoring, restart and mouse control.

## Assumptions

These were the ambiguous points; in each case the simpler reading was taken.

1. **Branch name.** The task asked for a branch named after the game
   (`billiards`), but this session is pinned to the designated development
   branch `claude/loving-euler-i1qrme` and must not push elsewhere. The work is
   therefore committed on the designated branch and the game name is carried by
   the folder instead.
2. **Simplified 8-ball.** No solids/stripes group assignment, no called pockets,
   no two-player turn passing, no "must hit the lowest ball first" rule. Pot the
   nine colours in any order, then the 8. A miss simply costs a shot; only a
   scratch is penalised.
3. **Ten object balls, not fifteen.** A 4-row rack keeps the table readable at
   720×400 and keeps a rack to a sensible length for an arcade session. Balls are
   numbered 1–7, 9 and 10 (9 and 10 drawn as stripes) plus the 8.
4. **No cue-ball spin.** No english, draw or follow — the cue ball is struck
   through its centre. Sidespin would need a rolling/sliding model well beyond
   what this game needs.
5. **Endless racks.** Rather than ending after one clearance, clearing a rack
   racks up a new one and keeps the score running, so a session has a natural
   high-score arc.
6. **Permanent aim guide.** The guide line and ghost ball are always shown
   rather than being unlocked or limited; this is a casual arcade game, not a
   simulator.
7. **Scratch respot.** The cue ball returns to the head spot, sliding left along
   the baulk line if another ball is parked there, rather than giving the player
   ball-in-hand.
