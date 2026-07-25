# Bowling — Design

## Game concept

Classic ten-pin bowling for one player, rendered top-down on an HTML5 canvas.
You line up your shot by sliding an aim marker left and right across the foul
line, then bowl. The ball rolls straight up the lane and ploughs into the pin
rack; pins in its path fall and knock their neighbours down in a deterministic
cascade. A full ten-frame game is scored with the real strike/spare rules,
shown on a live scorecard. Chase a perfect **300**.

## Mechanics

### Frames & scoring

- A game is **10 frames**. Frames 1–9 give up to two balls; the 10th gives up
  to three (a strike or spare there earns bonus balls).
- Standard ten-pin scoring:
  - **Strike** (all 10 on the first ball): 10 + the next **two** balls.
  - **Spare** (all 10 across two balls): 10 + the next **one** ball.
  - **Open frame**: just the pins knocked down.
- The scorecard shows the cumulative total per frame; a frame stays blank until
  its bonus is known.
- `frameScores(rolls)` is a **pure function** over the list of ball results
  returning the cumulative score per frame (or `null` for a frame whose score
  is not yet determined). This is the classic bowling-scoring kata and is the
  heart of the test suite.

### Aiming & the pin cascade

- Aim is a normalized value in `[-1, 1]`; `0` is dead centre. It maps to a lane
  x-position `aim × AIM_RANGE`. Extreme aims roll into the gutter (0–1 pins);
  a centred shot finds the pocket.
- Pins use the standard triangle (head pin nearest the bowler, four rows deep).
- `knockPins(ballX, standing)` is **pure and deterministic**:
  1. **Direct hits** — every standing pin within `BALL_R` laterally of the
     ball's path falls.
  2. **Cascade** — a fallen pin knocks a standing neighbour within
     `NEIGHBOR_R` only if that neighbour is *deeper* down the lane or *further
     out* in the same row (i.e. it is pushed away from the impact, never back
     toward the bowler). This spreads a good pocket hit into a strike while
     keeping a clipped corner hit local.
- Same aim + same rack ⇒ same pins, every time, so shots are fully testable.

### Game flow

`roll(count)` records one ball of `count` pins and advances the frame/ball
state machine (including the special three-ball 10th frame), setting `over`
when the game ends. `bowl(aim)` is the UI/physics entry point: it computes the
knocked pins from the current rack via `knockPins`, then feeds the count to the
same `roll` logic — so flow is identical whether driven by tests or by play.

## Controls

| Input | Action |
|---|---|
| ← / → (or A / D) | Slide the aim marker |
| Space / click | Bowl the ball (and start a new game from the overlay) |
| R | Reset to a new game |

## Deterministic core & testing

Everything that decides an outcome is a pure function of explicit inputs — no
wall-clock, no randomness. Tests call `newGame()` then either:

- `roll(count)` to drive scoring/flow with exact pin counts (gutter game,
  perfect game, all spares, 10th-frame bonus balls, "can't roll after over"), or
- `bowl(aim)` / `knockPins(...)` to assert the pin physics (centre ⇒ strike,
  gutter ⇒ 0, determinism).

Core state and helpers are exposed as page globals: `rolls`, `frame`,
`ballInFrame`, `over`, `state`, `frameScores`, `totalScore`, `roll`, `bowl`,
`knockPins`, `newGame`, `PINS`, `standingPins`, `BALL_R`, `NEIGHBOR_R`,
`AIM_RANGE`.

## Assumptions

- **Straight ball only** — no hook/spin/curve. The single skill is lining up
  the aim. (Simpler interpretation; keeps the physics deterministic and the
  game approachable.)
- **Forgiving pocket** — a dead-centre hit is scored as a strike rather than
  producing a realistic centre-hit split, so a well-aimed ball is rewarded.
- **Fixed ball speed/power** — there is no power meter; only lateral aim
  matters.
- **No gutter animation nuance** — a ball whose path misses every pin simply
  scores 0 for that ball.
