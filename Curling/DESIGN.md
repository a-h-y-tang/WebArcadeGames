# Curling — Design

## Concept

A two-player (you vs. the computer) game of curling played on a top-down HTML5
canvas. Each end, both teams deliver four stones down the sheet toward the
house; when all eight stones have come to rest, the team with the stone nearest
the button scores one point for every stone of theirs that is closer than the
opponent's nearest stone. The match runs for three ends and the higher total
wins.

The skill in the game is the same as in real curling: judging weight (how hard
to throw), line (where to aim) and curl (which way the stone rotates and
therefore bends), plus deciding whether to draw into the house, guard a stone
you already have there, or take an opponent's stone out.

## Game world

The sheet is drawn vertically: the player delivers from the hack at the bottom
of the canvas and the house sits at the top.

| Feature | Value |
|---|---|
| Canvas | 460 × 700 |
| Side lines | x = 24 and x = 436 |
| Centre line | x = 230 |
| Tee (button centre) | y = 150 |
| Back line | y = 62 |
| Far hog line | y = 430 |
| Release point (hack) | (230, 645) |
| Stone radius | 13 px |
| House rings | 78 / 52 / 26 px, button 9 px |

## Mechanics

### Delivery

A shot is described by three numbers:

- **Power** — 0–100, mapped linearly onto a release speed of 120–290 px/s.
- **Aim** — an angle in radians, clamped to ±0.12 rad (about ±6.9°), where 0 is
  straight up the sheet.
- **Curl** — a handle of −1 (counter-clockwise, bends left), 0 (no handle, runs
  straight) or +1 (clockwise, bends right).

Pressing throw creates a stone at the hack with velocity
`(sin(aim), −cos(aim)) · v` and hands control to the physics.

### Physics

All motion is integrated in `step(dt)` in units of pixels and seconds, so the
tests can advance the simulation deterministically without depending on
`requestAnimationFrame` wall-clock timing.

- **Friction** is a constant deceleration of 48 px/s² applied along the
  direction of travel. This makes the distance a stone runs a clean function of
  its release speed (`d = v²/2a`), which is what lets the aim guide predict a
  resting place and lets the computer plan a draw.
- **Curl** is a constant lateral acceleration of 4 px/s² applied perpendicular
  to the direction of travel, to the right for a clockwise handle. Because it
  acts for the whole of the stone's run, a slow stone (which travels for longer)
  bends further than a fast one — the same qualitative behaviour as real ice.
- **Collisions** between stones are treated as equal-mass circle collisions:
  the velocity components along the line of centres are exchanged with a
  restitution of 0.97, then the pair is separated by their overlap. Both stones
  lose their handle on impact and run straight afterwards.
- A stone comes to rest when its speed drops below 5 px/s.

### Stone removal

- A stone whose centre crosses the back line (y < 62) has run through the house
  and is removed.
- A stone that touches a side line is out of play and is removed.
- The *delivered* stone must fully cross the far hog line, otherwise it is
  hogged and removed once everything has stopped. Stones already sitting on the
  ice are never hogged, even if a collision nudges them back.

### Scoring

A stone counts if it is touching the house, i.e. its centre is within
`78 + 13` px of the button (a "biting" stone counts, as in the real game). All
counting stones are sorted by distance to the button; the team owning the
nearest one scores one point for each of its stones that is nearer than the
opponent's nearest. If no stone is in the house the end is blanked and nobody
scores.

The match is three ends. Teams alternate stones within an end, and the team
that throws first alternates from end to end, with the player leading the first
end.

### Computer opponent

The opponent plans its shot by brute force over the same physics the player
uses. It sweeps a grid of candidate shots (7 aims × 7 powers × 3 handles),
simulates each one with `simulateThrow` — which runs on a deep copy of the
stones and therefore never disturbs the live game — and scores the resulting
position with `evaluatePosition`. That evaluation is worth 10 per point the end
would be worth, plus a small proximity bonus per stone, so the search naturally
discovers draws, guards and takeouts without any of them being special-cased.

The best candidate is then perturbed by a small random error in aim and power
so the opponent misses the way a human does. Tests set the global `cpuNoise` to
0 to make the opponent perfectly repeatable.

## Controls

| Input | Action |
|---|---|
| Mouse move over the sheet | aim toward the pointer |
| <kbd>←</kbd> / <kbd>→</kbd> | fine-tune the aim |
| <kbd>↑</kbd> / <kbd>↓</kbd> or mouse wheel | adjust power by 2 |
| <kbd>Q</kbd> / <kbd>E</kbd> | counter-clockwise / clockwise handle |
| <kbd>W</kbd> | no handle (straight) |
| <kbd>Space</kbd> or click the sheet | deliver the stone |
| <kbd>Enter</kbd> | start, or continue to the next end |
| <kbd>R</kbd> | new match |

While aiming, a dashed guide shows the path the stone would take with the
current settings and a faint ghost circle marks where it would come to rest,
ignoring any stones in the way.

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay and help text |
| `style.css` | dark arcade shell around a pale ice sheet |
| `game.js` | constants, physics, rules, opponent, rendering, input |
| `tests/curling.spec.js` | Playwright specs |

`game.js` is a classic (non-module) script, matching Kaboom, Snake and Tetris in
this repo, so its state and functions are reachable from the tests as plain
globals. The state machine is:

```
idle ──▶ aiming ──▶ sliding ──▶ (aiming | cpu) ──▶ … ──▶ endover ──▶ aiming
                                                            └──▶ gameover
```

`cpu` is a short pause before the opponent delivers, counted down inside
`step(dt)` so that tests drive it the same way the animation loop does.

## Assumptions

These are points where the brief was open-ended; the simpler reading was taken
each time.

- **Branch name.** The task asked for a branch named after the game
  (`curling`), but this session is also required to develop and push only on its
  designated branch `claude/loving-euler-gmlmmo`. The designated branch wins,
  since pushing elsewhere is explicitly forbidden.
- **Match length.** Real curling is eight or ten ends of eight stones. Three
  ends of four stones per team keeps a match to a couple of minutes, which suits
  an arcade collection.
- **Hammer.** Rather than awarding last stone to the team that failed to score,
  the lead simply alternates each end. It is one line instead of a rule, and
  over three ends it is very nearly the same thing.
- **No sweeping.** Sweeping would need a second, continuous input during the
  stone's run. The stone's fate is settled at release instead.
- **Free guard zone.** The rule protecting early guards from being taken out is
  omitted; any stone may be hit at any time.
- **Curl is constant.** Real stones curl hardest as they slow down. A constant
  lateral acceleration gives a visually similar arc with far simpler maths, and
  still makes slow stones curl more overall.
- **Handle is lost on impact.** Struck stones run straight, which keeps
  collisions predictable enough to aim takeouts.
- **Out over the back line** is judged on the stone's centre rather than on the
  stone being wholly past the line.
- **One opponent difficulty.** No difficulty selector; the opponent's random
  error is fixed.
