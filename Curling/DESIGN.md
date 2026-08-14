# Curling — Design

## Concept

A top-down sheet of curling ice. You and a computer skip alternate deliveries
from the hack on the right toward the house on the left. Each stone is aimed,
given *weight* (how far it will run), and a *handle* (the rotation that makes it
curl sideways as it slows). While it slides you can sweep, which makes it run
farther and curl less. When both teams have thrown all their stones, the team
lying closest to the button scores one point for every stone it has closer than
the other team's nearest stone.

The game is a single classic (non-module) script, as with the other games in
this repo: state and helpers are plain globals so the Playwright specs can reach
them, and all motion is expressed per second and advanced by `step(dt)` so tests
can simulate deterministically without depending on `requestAnimationFrame`.

## The sheet

Landscape, 760 × 380, with the house on the left and the hack on the right.

| Feature | Where | Meaning |
|---|---|---|
| Side lines | `y = 30` and `y = 350` | A stone touching one is out of play |
| Back line | `x = 70` | Tangent to the back of the twelve foot ring; a stone past it is out |
| Button (tee) | `x = 160, y = 190` | Rings at 90 / 60 / 30 / 10 px |
| Far hog line | `x = 320` | A delivery that stops short of it is removed |
| Hack | `x = 730` | Every delivery starts here on the centre line |

## Mechanics

### Weight and friction

Weight is a 0–100 slider that maps to the **distance the stone would run on
unswept ice**, not to a raw speed — so the number reads like a curler's "draw
weight". `distForWeight()` spans 400 px (short of the hog line, so the stone is
taken off) to 690 px (through the back line). The launch speed follows from
`v = √(2·a·d)` with a constant deceleration of 26 px/s². Weight 59 is a draw to
the button; anything above ~80 is takeout weight that runs out the back if it
misses.

### Curl

Curl is a sideways acceleration perpendicular to the direction of travel, signed
by the handle (`+1` in-turn curls down the sheet, `-1` out-turn up it). It is
scaled by `clamp(1 − speed / 180, 0, 1)`, so a fast stone runs almost straight
and the curl arrives late in the slide — which is what makes a draw around a
guard possible and a hard takeout nearly straight. A draw to the button curls
about 30 px.

### Sweeping

Sweeping multiplies friction by 0.8 (≈25% more run) and curl by 0.45. It applies
only to the stone currently being delivered, and only while it is still moving.
Holding <kbd>Space</kbd> after the throw sweeps; releasing stops.

### Collisions

Equal-mass circle collisions resolved along the contact normal with restitution
0.98, plus a positional push so stones never rest overlapping. A struck stone
has its handle zeroed — it is sliding, not rotating, so it should not curl away
on its own.

### Removal from play

Checked every frame while stones are moving: a stone past the back line, or
touching either side line, is taken off. The hog line is checked once the sheet
comes to rest, and only against the delivered stone.

### Scoring an end

`endResult()` sorts every stone within `HOUSE_R + STONE_R` of the button by
distance. The owner of the closest stone scores one point per stone before the
first opposing stone. An empty house is a blank end. The team that was scored on
takes the hammer (last stone) for the next end; a blank end leaves it where it
was. A match is 4 ends of 6 stones per team; the player starts with the hammer,
so the computer leads off.

### The computer skip

`aiThrow()` picks a shot, then aims off the curl using `curlDrift()`, an
analytic estimate of the sideways drift over the run:

1. If the player is lying shot in the house — hit it out at takeout weight.
2. Otherwise, if its own stone is already close to the button — put up a guard.
3. Otherwise — draw to the button.

Handle alternates each throw, and aim and weight get a little noise so it is
beatable. `aiNoise = 0` makes it deterministic for tests, and `autoAi = false`
switches it off entirely so a spec controls every delivery.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> / <kbd>W</kbd> <kbd>S</kbd> | Aim (±8° off the centre line) |
| <kbd>←</kbd> <kbd>→</kbd> / <kbd>A</kbd> <kbd>D</kbd> | Weight down / up |
| <kbd>H</kbd> | Flip the handle (in-turn / out-turn) |
| <kbd>Space</kbd> | Deliver; keep holding to sweep |
| <kbd>P</kbd> | Pause |
| Mouse | Move to aim at a spot, click to deliver and hold to sweep |

A dotted guide shows the predicted path of the current aim, weight and handle
(the equivalent of the skip's broom), ending in a broom ring where the stone
would come to rest. It ignores other stones on purpose — a guard is meant to
block the shot you were shown.

## Files

| File | Contents |
|---|---|
| `index.html` | HUD, canvas, overlay, control legend |
| `style.css` | Layout and the dark-panel/ice palette used by the repo |
| `game.js` | Geometry, physics, scoring, computer skip, rendering, input |
| `tests/curling.spec.js` | 78 Playwright specs |

## State machine

```
idle ──Space/Enter──> aiming ──throw──> sliding ──all stones stop──> aiming
                        │                                              │
                        │                          both teams out of stones
                        │                                              ▼
                    paused <──P──                                  endover
                                                                       │
                                                        2.5s ──────────┤
                                                                       ▼
                                             next end (aiming)  or  over ──Space──> aiming
```

## Assumptions

The task description left some things open; these were resolved toward the
simpler reading and recorded here.

- **Branch name.** The task asked for a branch named after the game, but the
  session's standing instruction pins development to `claude/loving-euler-84t85a`.
  The pinned branch wins; the game folder carries the name instead.
- **Match length.** Real curling is 8 or 10 ends of 8 stones each. This is 4 ends
  of 6 stones, which is about 10 minutes of play.
- **Free guard zone.** Not implemented — guards in front of the house can be
  removed at any point in the end.
- **Back line rule.** A stone is removed when its *centre* passes the back line,
  rather than when it is entirely across. Simpler, and it keeps the boundary
  unambiguous for the specs.
- **Hog line rule.** Applied only to the delivered stone, as in the real rules;
  a stone knocked back short of the hog line stays where it lies.
- **Sweeping.** Only the delivering team sweeps, and only its own stone; there is
  no opposition sweeping behind the tee line. Its effect (25% more run) is
  stronger than real ice so that it is worth using.
- **Burned stones, hammer coin toss, extra ends.** Not modelled. A tied match is
  reported as a tie rather than played out in an extra end.
- **Best score.** The stored "best" is the highest point total the player has
  scored in a completed match, matching how the other games in the repo persist
  a single number to `localStorage`.
