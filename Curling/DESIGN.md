# Curling — Design

## Concept

A single-sheet game of curling played against the computer. You slide eight
granite stones (four each, alternating) down the ice toward the house — the
target rings at the far end — trying to finish the end with more stones closer
to the button than your rival has. Stones curve as they travel (the *curl*),
collide like real granite, and can be swept to run further and straighter.

The match is four ends long; the side with the most points at the end of the
fourth end wins.

## The sheet

The sheet runs left-to-right across the canvas (900 × 360). Coordinates are in
pixels and all constants live at the top of `game.js`:

```
 hack        hog line                            tee line   back line
  |             |                                    |          |
  x=60         x=210                               x=700      x=830
```

- **Hack** (`HACK_X`) — where a delivered stone starts, on the centre line.
- **Hog line** (`HOG_X`) — a delivered stone that stops short of it is removed.
- **Tee line / button** (`TEE_X`, `TEE_Y`) — the centre of the house and the
  point every distance is measured from.
- **Back line** (`BACK_X`) — a stone that runs past it is out of play.
- **Side lines** (`SIDE_TOP`, `SIDE_BOTTOM`) — a stone that touches a side is
  out of play.

The house is four concentric rings (12-foot, 8-foot, 4-foot and the button)
drawn with radii `HOUSE_R`, `RING_8`, `RING_4`, `BUTTON_R`.

## Mechanics

### Delivery

A shot is described by three numbers, which is exactly what `throwStone(power,
aimY, spin)` takes:

| Input | Meaning |
|---|---|
| `power` | 0…1, mapped to a launch speed between `MIN_SPEED` and `MAX_SPEED` |
| `aimY` | the y the broom sits on at the tee line — the stone is launched along the line from the hack to `(TEE_X, aimY)` |
| `spin` | the handle: `-1` curls the stone toward the top of the sheet, `+1` toward the bottom, `0` runs straight |

### Physics

Every stone is integrated in fixed sub-steps (`SUB = 1/240 s`) inside
`step(dt)`, so behaviour does not depend on frame rate and the Playwright tests
can advance the simulation deterministically.

- **Friction** — a constant deceleration `FRICTION` applied against the
  direction of travel. Below `STOP_SPEED` a stone is snapped to rest, so a
  shot always settles in finite time.
- **Curl** — an acceleration perpendicular to the direction of travel, scaled
  by `spin` and by `1 - speed / CURL_REF` (clamped to a floor). A fast stone
  runs nearly straight and bends more and more as it slows, which is what makes
  a real stone curl late.
- **Sweeping** — while sweeping, friction is multiplied by `SWEEP_FRICTION`
  (< 1) and curl by `SWEEP_CURL` (< 1): a swept stone travels further and
  straighter. Each delivery has a `SWEEP_BUDGET` of seconds; `sweepLeft` drains
  while the broom is down and sweeping stops when it hits zero.
- **Collisions** — stones are equal-mass circles resolved pairwise: overlap is
  pushed apart along the contact normal and the normal components of the two
  velocities are exchanged (a perfectly elastic hit), leaving the tangential
  components alone. This gives the familiar curling take-out where the shooter
  stops dead and the target rolls away.

### Out of play

Checked continuously while stones move: past the back line, or touching either
side line, removes a stone at once. The hog-line rule is checked once the shot
comes to rest and only applies to the stone that was delivered — a stone
knocked back over the hog line by a hit stays in play, as in the real game.

### Scoring an end

When all eight stones have been delivered and everything has stopped,
`finishEnd()` applies what `computeEndScore()` works out:

1. Keep the stones in the house — centre within `HOUSE_R + STONE_R` of the
   button, i.e. any part of the stone touching the rings counts.
2. Whoever owns the single closest stone scores.
3. They score one point for every one of their stones closer to the button
   than the opponent's *best* stone.
4. If no stone is in the house it is a blank end and nobody scores.

### Hammer

The hammer is last-stone advantage: the side with it throws second in every
pair, so it delivers the eighth and final stone of the end. The side *without*
the hammer starts the end. The side that scores loses the hammer for the next
end; a blank end leaves it where it was. The rival starts the match with the
hammer, so the player throws the first stone of the match.

## Controls

| Input | Action |
|---|---|
| Mouse over the sheet | move the broom (the aim line) |
| <kbd>↑</kbd> / <kbd>↓</kbd> | nudge the broom up / down |
| <kbd>←</kbd> / <kbd>→</kbd> | set the handle (curl left / curl right) |
| <kbd>Space</kbd> or click | start the power meter, then lock it in and throw |
| <kbd>Space</kbd> (held, while the stone slides) | sweep |
| <kbd>P</kbd> | pause / resume |

The power meter is an oscillating bar drawn under the sheet: press once to set
it swinging, press again to deliver at whatever it reads.

## Code layout

`game.js` is a single classic (non-module) script, matching the other games in
this repo, so its state and functions are reachable from the Playwright tests
as plain globals.

| Section | What lives there |
|---|---|
| Constants | sheet geometry, physics tuning, match length |
| State | `state`, `phase`, `stones`, `scoreboard`, `endNumber`, `hammer`, `turn`, `stonesLeft` |
| Delivery | `throwStone()`, `aim`, `armPower()`, the power meter |
| Physics | `moveStones()`, `resolveCollisions()`, `removeOutOfPlay()`, `substep()`, `step()` |
| Flow | `finishShot()`, `computeEndScore()`, `finishEnd()`, `startEnd()`, `endGame()` |
| Rival | `planRivalShot()` / `rivalShot()` — draw, guard or take-out from the position |
| Render | `draw()` — ice, rings, stones, broom line, meters, stone rack |

`state` is one of `idle`, `running`, `paused`, `over`. `phase` (only meaningful
while running) is one of `aim` (your shot), `power` (meter swinging), `slide`
(stones moving) and `rival` (the computer is about to throw). The score for an
end is announced with a banner drawn over the sheet for a couple of seconds
rather than a phase of its own, so play never blocks.

`settle()` runs the simulation on until the stones stop; it exists for the
tests, which use it instead of waiting on real time.

The rival is deterministic: it uses a seeded `mulberry32` RNG re-seeded at the
start of every match, so the same sequence of player shots always produces the
same match.

## Assumptions

These were decided while building the game; where the request was ambiguous the
simpler reading was taken.

1. **Branch.** The task asked for a branch named after the game, while the
   session's standing instruction pins pushes to `claude/loving-euler-fwkfjh`.
   Development happens on a local `curling` branch and the work is pushed to
   the designated branch, which is the stricter of the two rules.
2. **Match length.** Four ends rather than the regulation eight or ten, so a
   match is a few minutes long. `ENDS` is a single constant.
3. **Ties.** A tied match is reported as a tie; there is no extra end.
4. **Hog line.** Only the delivered stone is removed for stopping short of the
   hog line. The real rule about a stone having to be released before the near
   hog line has no analogue here, because delivery is instantaneous.
5. **Free guard zone.** Not implemented. Any stone may be taken out at any
   point in the end.
6. **Sweeping.** One shared broom with a per-shot time budget, rather than
   modelling two sweepers or directional sweeping. You may sweep your rival's
   stones too — the broom is simply "on the moving stone".
7. **Delivery.** A shot is a launch velocity, not a slide-out-of-the-hack
   animation; the stone appears at the hack already moving.
8. **Physics.** Equal-mass, perfectly elastic collisions and a constant
   friction deceleration. Real ice is pebbled and stones rotate; neither is
   modelled beyond the curl acceleration.
9. **Measurement.** Distances are exact centre-to-button distances, so there is
   never a "measure stick" situation to resolve.
10. **Persistence.** Only the number of matches won is remembered
    (`localStorage`, key `curling-wins`), matching the light-touch persistence
    other games here use.
