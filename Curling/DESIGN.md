# Curling — Design

## Game concept

A single-player match of curling against a CPU opponent, played on an HTML5
canvas. You (red) and the CPU (yellow) alternate sliding stones up a sheet of
ice towards the *house* — the target rings at the far end. Stones slow down
under friction, bend sideways depending on the handle they were thrown with,
and knock each other around on contact. When all stones have been delivered the
end is scored, and after four ends the higher total wins.

The interesting decisions are the same ones real curlers make: draw a stone into
the rings and hope it survives, or fire a heavy stone through and clear the
opponent's counters out of play.

## Mechanics

### The sheet

The canvas is 420 × 720 px and models a curling sheet seen from above:

| Feature | Value | Meaning |
|---|---|---|
| Side lines | x = 20 and x = 400 | A stone touching either line is out of play |
| Back line | y = 80 | A stone driven past it is out of play |
| Button (tee) | (210, 170) | The centre of the house |
| House rings | r = 78, 52, 26, 13 | 12-foot, 8-foot, 4-foot, button |
| Hog line | y = 560 | A delivered stone must come to rest past it |
| Hack (release) | (210, 672) | Where every stone is delivered from |
| Stone radius | 13 | Stones are circles of equal mass |

### Delivery

A throw has three inputs:

- **Line** — the aim angle, clamped to ±0.22 rad either side of straight.
- **Weight** — a power value in 0–1 that maps to a release speed of
  `100 + power × 260` px/s. The power meter sweeps 0 → 1 → 0 over 1.6 s while
  the throw button is held, so the weight is a timing decision. A black tick on
  the meter marks the weight that draws to the button.
- **Handle** — the curl, one of `-1` (anticlockwise, bends left), `0`
  (straight) or `+1` (clockwise, bends right).

### Physics

Everything is integrated in fixed 1/240 s sub-steps inside `substep(h)`:

1. **Curl.** A stone with a handle gets an acceleration perpendicular to its
   direction of travel of magnitude `20 × curl / (1 + speed / 50)`. The
   divisor is what makes a curling stone behave like a curling stone: the
   sideways bite is weak while the stone is quick and grows sharply as it slows,
   so the path bends late. A typical draw finishes about 30 px off the line it
   was thrown on.
2. **Friction.** Speed is reduced by 60 px/s² along the direction of travel. A
   stone below 3 px/s is snapped to rest. This makes the range a clean function
   of release speed: `distance ≈ v² / 120`, so 245 px/s draws to the button and
   the top weight of 360 px/s carries clean through the back line.
3. **Collisions.** Every overlapping pair is separated along the contact normal
   and exchanges the normal component of its relative velocity with a
   restitution of 0.96 (equal masses, so it is a straight swap). Resolving
   positions every sub-step is what guarantees resting stones never overlap.

### Shot resolution

When every stone has stopped, `resolveShot()` applies the out-of-play rules —
a stone touching a side line, past the back line, or (for the stone just
delivered) short of the hog line is removed — and then hands over the turn.

### Scoring

Each team throws four stones per end. At the end of an end, `scoreEnd()` sorts
every stone touching the house by distance to the button. The team owning the
nearest stone scores one point for each of its stones that is closer than the
opponent's best stone; everything else counts for nothing. An empty house is a
blank end worth zero.

The **hammer** (last stone of the end, a real advantage) starts with the CPU and
then passes to whichever team conceded the last end. A blank end leaves it where
it is. The team *without* the hammer leads off the next end.

A match is four ends. If the scores are level after the fourth, extra ends are
played until someone leads.

### CPU opponent

`cpuPlan()` picks between two shots:

- **Takeout** — if the player has a stone in the house lying closer to the
  button than any CPU stone, aim straight through it with 260 px of extra
  carry so the collision drives it out.
- **Draw** — otherwise, put a stone on the button.

`deliveryFor(tx, ty, extra)` inverts the friction model to solve for the line
and weight that stop a stone at a target, and the CPU then adds a little
Gaussian-ish noise (±0.01 rad of line, ±0.028 of power) so it misses the way a
human does. The CPU always throws a straight handle.

## Controls

| Input | Action |
|---|---|
| Mouse move over the sheet | Aim the line at the pointer |
| <kbd>←</kbd> / <kbd>→</kbd> | Nudge the line by 0.012 rad |
| <kbd>A</kbd> / <kbd>S</kbd> / <kbd>D</kbd> | Handle: curl left / straight / curl right |
| Hold <kbd>Space</kbd> or hold the mouse button, then release | Charge the power meter and deliver |
| <kbd>Space</kbd> on the overlay | Start the game / start the next end / play again |

## Code layout

- `index.html` — HUD, canvas and the overlay used for the start, end summaries
  and the final result.
- `style.css` — dark panel around a pale ice-coloured canvas.
- `game.js` — a single classic (non-module) script. State and logic live as
  plain globals so the Playwright tests can reach them directly, matching Kaboom,
  Dino Run and Tetris in this repo. All motion is per-second and advanced by
  `step(dt)`, so tests simulate frames deterministically instead of waiting on
  `requestAnimationFrame`.
- `tests/curling.spec.js` — 61 Playwright tests covering the aim controls,
  delivery physics, curl, collisions, out-of-play rules, turn order, scoring,
  hammer handling, match flow and the CPU.

The real-time loop calls the same `step(dt)` the tests use, so there is only one
simulation path.

## Assumptions

These were ambiguous in the task; the simpler reading was taken in each case and
recorded here.

- **Branch name.** The task asked for a branch named after the game
  (`curling`), but this session is also required to develop and push on the
  designated branch `claude/loving-euler-ubex0m`. The designated branch wins,
  since it is the one the session is permitted to push to.
- **Match length.** Real curling plays 8 or 10 ends with 8 stones a team. That
  is far too long for a browser session, so this is 4 ends of 4 stones a team —
  long enough for the hammer to matter, short enough to finish.
- **No sweeping.** Sweepers extend a stone's run and straighten its curl. Adding
  them would mean a second input phase after release; the simpler interpretation
  is line/weight/handle at delivery only.
- **No free guard zone.** The real rule protecting early guards from takeouts
  was left out — the CPU may clear any stone at any time.
- **Delivery is always from the centre of the hack.** Real curlers shift their
  starting position; here only the angle varies, which covers the same ground
  with one input instead of two.
- **Straight-handle CPU.** The CPU never throws a curl. It misses through noise
  rather than through modelled ice-reading, which keeps it beatable and its
  behaviour easy to test.
- **Ties.** A level match plays extra ends rather than being declared a draw, so
  a game always produces a winner. `endGame()` still handles a draw defensively
  if it is ever called with level scores.
- **Persistence.** Only the win/loss record is stored (`curling-record` in
  `localStorage`); a match in progress is not saved across reloads.
