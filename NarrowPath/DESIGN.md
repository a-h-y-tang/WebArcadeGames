# The Narrow Path — design notes

## Game concept

A tilting-board marble game, the wooden-labyrinth genre, themed on the narrow
way of Matthew 7:13-14: *"Narrow is the gate and difficult is the way which
leads to life."*

You tilt a wooden pilgrim's board and a round stone — the pilgrim — rolls under
gravity. Along the way are **waymarks** (Jeremiah 31:21, *"Set up waymarks"*) to
gather and open **ditches** beside the road to avoid. Gather every waymark on a
board and the **narrow gate** at the far corner opens; roll into it to finish
that stage. Fall into a ditch and you lose one of three journeys and the stone
is set back at the start of the stage, keeping the waymarks already gathered.

Four stages of rising difficulty: *The Village Road*, *The Winding Way*,
*The Steep Pass*, *The Narrow Gate*. Finish all four and the run is complete.

Nothing in the game is a prize to be won in place of the gospel — the gate is
simply the end of a road, and the verse is quoted plainly on the title screen.

## Board

The board is a 16 x 12 grid of 40 px cells, which is exactly the 640 x 480
canvas. Each stage is authored as twelve 16-character strings:

| char | meaning |
|---|---|
| `#` | wall (the raised rim and the inner walls) |
| `.` | open floor |
| `S` | the stone's starting cell (one per stage) |
| `G` | the narrow gate (one per stage) |
| `*` | a waymark to gather |
| `o` | a ditch (pit) |

`buildLevel()` turns a layout into `walls` (a boolean grid), `pits`, `waymarks`,
`startCell` and `gateCell`, all in pixel coordinates at cell centres.

A stage is only fair if the gate and every waymark can be reached **without
rolling across a ditch**, so `reachableCells()` flood-fills from the start with
ditch cells treated as blocked, and a test asserts the gate and all waymarks are
in that set for every stage. Ditches are therefore always avoidable rather than
tolls on the only route.

## Mechanics

### Tilt

`tilt.x` and `tilt.y` each run in [-1, 1] and are what the player actually
controls. Held keys (or a held pointer) set a target; the tilt moves toward that
target at `TILT_RATE` per second and springs back toward 0 at `TILT_RETURN` per
second when nothing is held. Opposite keys cancel, so the board levels out.

### Rolling

The stone is a point with a radius. Each `step(dt)`:

1. acceleration `ACCEL * tilt` is added to the velocity;
2. velocity decays by `FRICTION` per second (rolling resistance) and is clamped
   to `MAX_SPEED`;
3. the stone is moved one axis at a time, and each axis is resolved against the
   wall cells it now overlaps — pushed back out and the velocity on that axis
   reversed and scaled by `WALL_BOUNCE`. Resolving the axes separately is what
   keeps a stone travelling diagonally into a corner from tunnelling through it;
4. ditches, waymarks and the gate are tested against the new position.

Motion is expressed per second and advanced only through `step(dt)`, so the
Playwright tests can simulate exact frames. `requestAnimationFrame` only calls
`step` while the `simulate` flag is true; tests switch it off and drive the
simulation themselves, which keeps their assertions deterministic.

### Ditches, waymarks, gate

- **Ditch**: the stone falls when its centre comes within `PIT_R - FALL_MARGIN`
  of a ditch centre, so grazing the lip is safe and rolling over the middle is
  not. A fall costs a journey, plays a short `dying` pause and then sets the
  stone back at the stage start with no velocity.
- **Waymark**: gathered when the stone's centre comes within `WAYMARK_R +
  BALL_R`; worth `WAYMARK_POINTS`. The last one opens the gate.
- **Gate**: while waymarks remain it stays shut and does nothing; with all of
  them gathered, the stone's centre entering the gate cell clears the stage for
  `STAGE_POINTS` plus a time bonus of `TIME_BONUS` a second for every second of
  the stage's `par` left on the clock.

### Run structure

`state` is one of `idle`, `running`, `paused`, `dying`, `stageclear`, `won`,
`over`. Three journeys (lives) are shared across the whole run and carry over
between stages. Losing the last one ends the run; the best score is kept in
`localStorage` under `narrow-path-best`.

## Controls

| input | action |
|---|---|
| Arrow keys / WASD | tilt the board |
| Space or Enter | start a run, continue, or play again |
| P | pause / unpause |
| R | restart the run |
| hold the pointer on the board | tilt toward the pointer (touch friendly) |
| Start / Pause buttons | same as Space and P |

## Code layout

A single classic (non-module) script, `game.js`, so every constant, piece of
state and helper is reachable from the tests as a plain global — the same shape
as the other arcade games in this repo. `index.html` holds the HUD, the canvas,
the overlay and the rules; `style.css` holds the parchment-and-wood styling.

`tests/narrow-path.spec.js` is the Playwright suite: layout fairness, tilt,
rolling, wall collision, ditches, waymarks, the gate, stage progression, lives,
scoring, the HUD, the controls and the drawing.

## Assumptions

Decisions taken without being able to ask, with the simpler reading preferred:

1. **Branch name.** The task asks for a branch named after the game
   (`narrow-path`), but this session's environment requires all work on
   `claude/compassionate-ramanujan-ggfdkp`. The environment rule wins; the game
   folder carries the name instead.
2. **Falling keeps gathered waymarks.** A fall sets the stone back to the stage
   start but does not take back waymarks already gathered. Re-gathering them
   every time would make the later stages a memory grind rather than a test of
   steering.
3. **The gate is a goal, not a wall.** Before every waymark is gathered the gate
   is simply inert: the stone can roll over its cell and nothing happens, and the
   status line says what is still missing. This is simpler than modelling a shut
   gate as a solid object that later disappears.
4. **Ditches are always avoidable.** Rather than letting a ditch sit in the
   middle of a one-cell corridor on the only route, every stage is authored (and
   tested) so the gate and all waymarks are reachable without crossing one.
5. **Four stages, three journeys.** No high-score table, no stage select; a run
   is the four stages in order. This keeps the run about five minutes long.
6. **Tilt, not aim.** The stone cannot be nudged directly: only the board tilts.
   That is what makes the genre, so there is no "stop" key — level the board and
   let friction do it.
7. **No sound.** None of the other games in the repo ship audio, so this one
   stays silent too.
