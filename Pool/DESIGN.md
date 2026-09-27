# 8-Ball Pool — Design

## Concept

A two-player hot-seat game of 8-ball on a top-down HTML5 canvas pool table.
Players alternate shots on the same keyboard/mouse. The table starts *open*:
the first player to legally pot an object ball takes that group (solids or
stripes) and their opponent gets the other. Clear your seven balls, then pot
the 8 ball to win — pot it early and you lose on the spot.

Everything runs from `index.html` with no build step, no assets and no
randomness: the rack is fixed and the physics is deterministic, so the same
shot always produces the same table.

## Mechanics

### Table

- Canvas 800×440. The cushion faces enclose the play area `x ∈ [40, 760]`,
  `y ∈ [40, 400]` — a 720×360 rectangle, the classic 2:1 pool table shape.
- Six pockets: four corners plus the two long-rail middles. A ball whose
  **centre** comes within `POCKET_R` (19px) of a pocket centre drops.
- Balls have radius 10. The cue ball starts on the head spot (¼ of the way
  down the table) and the rack apex sits at the ¾ point, with the 8 ball in
  the middle of the triangle and one solid / one stripe in the back corners.
  Racked balls are spaced a fraction of a pixel apart so the break's impulse
  travels through the stack as real collisions rather than overlap corrections.

### Physics

All motion is expressed per second and advanced by `step(dt)`:

1. `step(dt)` charges the power meter (if the player is holding the shot
   button), then calls `advance(dt)`.
2. `advance(dt)` splits the frame into sub-steps small enough that the fastest
   ball moves less than `0.4 × R` per sub-step, so nothing tunnels through a
   cushion or past another ball.
3. Each sub-step integrates position, applies cloth friction
   (`FRICTION = 190 px/s²`, snapping to a dead stop below 6 px/s), drops balls
   into pockets, bounces balls off cushions (86% restitution), then resolves
   ball-to-ball collisions.
4. Collisions are equal-mass impulses along the contact normal with 98.5%
   restitution — a full-ball hit transfers almost all of the speed and leaves
   the cue ball nearly dead, like a real stun shot. A second positional pass
   pushes any remaining overlap apart so balls never settle inside each other.

When every ball has stopped and a shot was in progress, `resolveShot()` judges
it.

### Shot resolution

Each shot records three things: which balls were potted, which ball the cue
ball touched **first**, and whether the cue ball itself dropped.

A shot is a foul when:

- the cue ball is potted (a scratch), or
- the cue ball hits nothing at all, or
- the first ball contacted is illegal — an opponent's ball, or the 8 ball
  before your group is cleared. On an open table, any ball but the 8 is legal.

"Group cleared" is snapshotted when the shot is taken, not after it, so
clearing your last ball on a shot does not retroactively make that shot a
foul for having hit your own ball first.

Outcomes, in order:

1. **8 ball potted** → the game ends immediately. The shooter wins only if
   they had a group, that group is now clear, and the shot was not a foul.
   Otherwise the opponent wins.
2. **Open table** → the first non-8 ball potted assigns the groups.
3. **Foul** → the cue ball is respotted if it was scratched, and the turn
   passes.
4. **Potted one of your own** → shoot again.
5. **Otherwise** → the turn passes.

After a scratch the cue ball returns to the head spot, or — if that spot is
occupied — to the nearest clear position found by an outward spiral search
that also avoids the pockets.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim (the cue points from the cue ball toward the pointer) |
| Hold mouse button / `Space` | Charge power; release to shoot |
| `←` `→` | Fine-tune the aim angle |
| `↑` `↓` | Nudge power up/down without charging |
| `R` | Re-rack |
| `Space` (idle or after a win) | Start / rematch |

A dashed guide line traces the cue ball's path to the first ball or cushion it
will meet, and the cue stick pulls back as power builds.

## Code layout

| File | Contents |
|---|---|
| `index.html` | Table markup, HUD, power meter, overlay |
| `style.css` | Dark felt-green theme matching the rest of the arcade |
| `game.js` | Geometry constants, rack, physics, rules, rendering, input |
| `tests/pool.spec.js` | 53 Playwright tests |

`game.js` is a classic (non-module) script, so its state and functions are
plain globals — the same convention as Kaboom, Snake and Tetris in this repo.
Tests drive the game through `startGame()`, `setAim()`, `setPower()`,
`shoot()` and `step(dt)`, and read state straight off `balls`, `players`,
`currentPlayer`, `foul` and `winner`. Because `step(dt)` is the only clock,
a whole shot can be simulated in a single `page.evaluate` without waiting on
`requestAnimationFrame`.

## Testing

Tests were written first, then the implementation was built until they passed
(the initial run failed on a missing `index.html`). Coverage:

- initial/idle state, canvas size, pocket count
- rack legality: 7 solids, 7 stripes, the 8 centred, nothing overlapping,
  everything inside the cushions
- aiming with the mouse and the arrow keys, power clamping, charge-and-release
  on both mouse and `Space`, rejecting shots at zero power or while the table
  is rolling
- physics: friction to a dead stop, cushion bounces, staying in bounds,
  momentum transfer, potting, `allStopped`
- rules: group assignment from an open table, keeping/losing the turn, all
  three foul types, cue-ball respotting without overlap
- the 8 ball: early loss, clean win, either player winning, open-table loss
- HUD text and the power meter, plus re-racking

Two shot geometries do the heavy lifting: a straight 45° cut from (600, 240)
into the bottom-right pocket for guaranteed pots, and a gentle straight roll
along `y = 220` for shots that must hit but not pot. Balls that aren't part of
a scenario are parked in the top-left corner, clear of the shot line.

Run them with `npx playwright test Pool/tests/`.

## Assumptions

Ambiguities were resolved toward the simpler reading and recorded here.

- **Scope of the rules.** Simplified 8-ball: fouls are limited to scratches,
  hitting nothing, and hitting an illegal ball first. The "no rail after
  contact" rule, called shots/pockets, and jump/masse shots are not modelled.
- **Ball in hand.** A foul respots the cue ball automatically at the head spot
  rather than letting the opponent place it anywhere. This keeps the input
  model to a single aim-and-shoot interaction.
- **Break.** The table is assigned on the first legal pot even if that pot
  happens on the break, instead of the official rule that the break always
  leaves the table open.
- **Last ball plus the 8.** Potting your final group ball and the 8 on the
  same shot counts as a win, not a loss.
- **Fouls do not respot object balls.** A potted ball stays down even if the
  shot that sank it was a foul.
- **Physics fidelity.** Balls are treated as sliding discs: no spin, English,
  throw or cut-induced deflection. Rolling resistance is a constant
  deceleration, which is close enough for arcade play and keeps every shot
  exactly reproducible.
- **Two humans.** No computer opponent — both players share the mouse and
  keyboard, matching the other hot-seat games in the repo (Air Hockey,
  Artillery Duel, Dots and Boxes).
- **Branch name.** The scheduled task asked for a branch named after the game,
  but the session's standing instructions pin all work to
  `claude/loving-euler-991gp8`. The designated branch wins; no game-named
  branch was created.
