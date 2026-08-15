# 8-Ball Pool — Design

## Concept

A top-down, canvas-rendered game of 8-ball pool. The player aims the cue ball
with the mouse (or keyboard), charges a power meter, and shoots. A rigid-body
physics simulation rolls the balls, bounces them off the cushions, collides them
with each other and drops them into six pockets. Group assignment (solids vs
stripes), fouls, ball-in-hand and win/lose conditions follow a simplified but
recognisable set of 8-ball rules.

The opponent is a computer player that geometrically searches the table for the
best ghost-ball shot, or a second human in hot-seat mode.

## Table & pieces

| Thing | Value |
|---|---|
| Canvas | 880 × 480 |
| Rail width | 40 px, so the playfield is 800 × 400 at (40, 40)–(840, 440) |
| Ball radius | 11 px |
| Pockets | 6, radius 21 — four at the playfield corners, two at the middle of the long rails |
| Cue ball spot | head spot, 25% along the table (240, 240) |
| Shot speed | 250 px/s at rest on the meter, 1900 px/s at full power |
| Rack apex | foot spot, 75% along the table (640, 240) |

Balls 1–7 are solids, 9–15 are stripes, 8 is black, 0 is the cue ball. The rack
is a fixed, deterministic triangle (no shuffling) with the 8-ball in the middle
of the third row and a solid/stripe in the two back corners, so every game
starts from an identical, reproducible position. Each ball is nudged off the
lattice by a fixed fraction of a pixel derived from its number: a perfectly
symmetric rack hit dead centre barely scatters, and a real rack is never
perfect. The offset is a pure function of the ball number, so the rack is still
byte-identical every game.

## Physics

The simulation is a fixed-substep integrator. `step(dt)` splits `dt` into
substeps of at most 1/240 s and, per substep:

1. **Integrate** — `x += vx·dt`, `y += vy·dt`.
2. **Friction** — a constant rolling deceleration of 150 px/s² applied against
   the direction of travel; below 5 px/s a ball is snapped to rest. Because the
   deceleration is constant (not drag-proportional), balls travel a predictable
   `v²/2a` distance and always come to a complete stop, which keeps shots
   readable and keeps tests from waiting on an asymptote.
3. **Pockets** — a ball whose centre is within the pocket radius of a pocket
   centre is potted: it is flagged `potted`, its velocity zeroed and it is moved
   off-table.
4. **Cushions** — a ball crossing a playfield edge is pushed back inside and its
   normal velocity is reflected and scaled by a restitution of 0.92.
5. **Ball-to-ball** — equal-mass elastic collision along the contact normal:
   the normal components of the two velocities are exchanged (scaled by a
   restitution of 0.99 — nearly elastic, so a break still carries energy
   through the whole pack) and the tangential components are kept. Overlap is
   resolved by pushing both balls apart by half the penetration each, so balls
   never sink into one another.

All of this is pure state mutation over module-level globals, so a test can
drive the whole simulation with `step()` without any timers or rendering.

## Rules implemented

* **Break** — the opening shot. The table is *open* until the first legal pot.
* **Group assignment** — the first shot that legally pots a ball assigns that
  shooter the group (solids or stripes) of the *first ball potted* on that shot;
  the opponent gets the other group. This includes the break.
* **Continuing** — a player shoots again if the shot was legal and potted at
  least one ball of their own group (or, on an open table, potted a ball and so
  claimed a group). Otherwise the turn passes.
* **Fouls** — potting the cue ball (scratch), hitting nothing at all, or making
  first contact with a ball that is not legal for the shooter (an opponent's
  ball, or the 8 before the shooter's group is cleared). A foul gives the
  opponent **ball in hand**: they may place the cue ball anywhere on the table
  that is not overlapping another ball.
* **Winning** — pot the 8-ball on a legal shot after clearing your own group.
  Potting the 8-ball early, or potting the 8 together with a scratch, loses
  immediately.

## Controls

| Input | Action |
|---|---|
| Mouse move | aim the cue at the pointer |
| Mouse hold | charge the power meter (fills in ~0.9 s) |
| Mouse release | shoot |
| `←` `→` | fine-tune the aim (0.6°/frame, ×5 with `Shift`) |
| `Space` (hold) | charge the power meter |
| `Space` (release) | shoot |
| Click (ball in hand) | place the cue ball |
| `P` | pause |
| `R` | new game |

The power meter is shown under the table and the aim line with its ghost ball is
drawn from the cue ball while aiming.

## Computer opponent

When `aiEnabled` is true, player 2 is the computer. After the table settles on
its turn it thinks for a beat, then searches every (own ball × pocket) pair:

* project the **ghost ball** position — the cue-ball centre at contact, one ball
  diameter back from the object ball along the pocket line;
* reject the shot if the cut angle exceeds ~72° (an unmakeable thin cut);
* reject it if either the cue → ghost path or the ball → pocket path is blocked
  by another ball;
* score the remaining shots by cut angle and distance, and take the best.

A small random aim error (`AI_ERROR` radians, scaled by shot difficulty) is added
so the computer is beatable. Tests set `AI_ERROR = 0` and `aiEnabled = false`
to keep the simulation deterministic.

## Code layout

```
Pool/
  index.html   markup: HUD, canvas, overlay, power meter, help text
  style.css    felt-green presentation, HUD, overlay
  game.js      constants, state, physics, rules, AI, input, render loop
  tests/
    pool.spec.js   Playwright suite (physics, rules, AI, UI)
```

`game.js` is a plain (non-module) script so every global — `balls`, `state`,
`step`, `shoot`, `resolveShot`, … — is reachable from `page.evaluate()`, which
is the convention the rest of this repo's games and tests use.

Key globals:

| Name | Meaning |
|---|---|
| `state` | `idle` \| `aiming` \| `rolling` \| `ballinhand` \| `paused` \| `gameover` |
| `balls` | array of `{ n, x, y, vx, vy, potted, type, color }`, `balls[0]` is the cue |
| `currentPlayer` | 1 or 2 |
| `groups` | `{ 1: null\|'solid'\|'stripe', 2: … }` |
| `shotInfo` | per-shot record: `{ firstContact, potted[], cuePotted }` |
| `message` | the text shown in the HUD status line |

## Assumptions

The task description left several things open. Each was resolved toward the
simpler reading and is recorded here.

1. **Branch name.** The task asks for a branch named after the game
   (`eight-ball-pool`), but this session is pinned to the branch
   `claude/loving-euler-txtctl` and may not push elsewhere. The work is done on
   the pinned branch; the game name is carried by the folder and commit message
   instead.
2. **Scope of the 8-ball rules.** Call-shot, "must drive a ball to a rail",
   three-foul loss, and the safety-play rules are omitted. The fouls modelled
   are scratch, no-contact, and wrong-first-contact — enough to make play feel
   fair without a rulebook.
3. **Break.** Treated as an ordinary shot: a ball potted on the break assigns
   groups. (Many house rules leave the table open after a break; assigning is
   the simpler single code path.)
4. **Mixed pots.** If a shot on an open table pots both a solid and a stripe,
   the group is taken from the first ball potted during that shot.
5. **Potted balls are gone.** No re-spotting of the 8 or of illegally potted
   balls; a potted ball stays off the table.
6. **Ball in hand is anywhere on the table**, not restricted to behind the head
   string, even after a scratch on the break.
7. **Opponent.** Default is human-vs-computer since the repo's games are mostly
   single-player; a hot-seat two-player toggle is provided in the HUD.
8. **No sound**, matching the other games in this repo.
9. **Rendering is 2D top-down** with flat-shaded circles and a numbered
   ball design — no sprites or external assets, so the game runs from
   `file://` with no server.
