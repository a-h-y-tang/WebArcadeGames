# Tavern Tapper — Design

## Concept

Tavern Tapper is a four-bar drink-serving arcade game. You are the barkeep
standing at the right-hand end of four parallel bars. Thirsty patrons come in
through the door on the left and shuffle steadily toward you; a patron who
reaches the taps grabs you by the apron and the shift goes badly.

Your only tool is the tap. Pour a mug and it slides down the bar the barkeep is
standing at. A patron caught by a mug takes it, is shoved back down the bar and
stands there drinking. Once their **thirst** is satisfied they head home and
send the empty mug sliding back toward you — catch it or it shatters on the
floorboards. Mugs are not free: a mug poured into a bar with nobody on it runs
off the far end and smashes too.

Every one of those mistakes costs a life. The game is therefore about pouring
*exactly* as many mugs as the bar in front of you actually needs, while
remembering which bar an empty is about to come back down.

## Mechanics

- **The tavern** is a 600×420 canvas holding `LANE_COUNT` (4) bars. Bar *i* has
  its counter top at `laneY(i)` = `LANE_TOP` + *i* × `LANE_H`. Everything —
  patrons, mugs, the barkeep — lives on one of those four lines, so the whole
  game is one-dimensional per bar.
- **Patrons** enter at the door (`LEAVE_X`) and walk right at `customerSpeed()`
  px/s. Each arrives with `customerThirst()` mugs of thirst, drawn as gold pips
  above their hat. Reaching `GRAB_X` costs a life.
- **Pouring.** `Space` (or a click on the canvas) pours a mug at `TAP_X` in the
  barkeep's current bar. The tap refills for `SERVE_COOLDOWN` (0.35 s), so mugs
  can be streamed roughly three per second but not instantly.
- **A full mug** slides left at `MUG_SPEED`. When it comes within `HIT_DIST` of
  a patron in the same bar it is consumed by the patron *nearest the taps* — the
  front of the queue always gets served first. Reaching `COUNTER_LEFT` with
  nobody served smashes the mug and costs a life.
- **Drinking.** A served patron loses one point of thirst, is shoved
  `PUSH_BACK` (70 px) back down the bar and stands still for `DRINK_TIME`
  (0.8 s). Thirst alone decides when they leave: a patron shoved all the way to
  the door simply stacks up there until their last mug lands (see *Balance*).
- **Empties.** A satisfied patron leaves an empty mug where they stood; it
  slides right at `EMPTY_SPEED`. When it arrives at `TAP_X` it is caught if the
  barkeep is standing in that bar (`SCORE_CATCH`), and smashes for a life if not.
- **Losing a life** clears the whole tavern — patrons, mugs and empties — and
  gives `RESPAWN_GRACE` (1.2 s) of quiet before the door opens again. At zero
  lives the run ends and the best score is written to `localStorage` under
  `tavern-tapper-best`.
- **Levels.** A level sends `levelCustomers()` = 5 + level patrons through the
  door at `spawnInterval()` seconds apart, into random bars. The level clears
  once the door has stopped (`toSpawn` is 0) and no patrons or empties remain;
  that pays `LEVEL_BONUS` (500) and starts the next one. Mugs still sliding at
  the moment a level clears are written off as last call rather than smashed —
  otherwise clearing the final patron with a mug already in flight would have
  been an unavoidable life.
- **Scoring.** `SCORE_HIT` 50 per mug landed, `SCORE_SERVED` 200 per patron sent
  home, `SCORE_CATCH` 100 per empty caught, `LEVEL_BONUS` 500 per level.

## Difficulty curve

Three dials move with the level, all deliberately gentle so the ramp is felt
rather than hit as a wall:

| Dial | Formula | Level 1 | Level 5 | Level 10 |
|---|---|---|---|---|
| Walking speed | `20 + (level - 1) * 4` px/s | 20 | 36 | 56 |
| Thirst per patron | `min(3, 1 + floor(level / 3))` | 1 | 2 | 3 |
| Patrons per level | `5 + level` | 6 | 10 | 15 |
| Spawn gap | `max(1.1, 3.4 - level * 0.25)` s | 3.15 | 2.15 | 1.1 |

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | Move up one bar |
| `↓` / `S` | Move down one bar |
| `Space` | Pour a mug into the current bar |
| Click canvas | Pour a mug |
| `P` | Pause / resume |
| `Space` / `Enter` | Start a game, or restart after a game over |

## Code structure

Single classic (non-module) script, matching Slime Volley, BurgerTime and Tetris
in this repo, so every piece of state is a plain global the Playwright specs can
read and poke:

- `game.js`
  - **Level shape** — `customerSpeed()`, `customerThirst()`, `levelCustomers()`,
    `spawnInterval()`, `laneY()`. All difficulty lives in these four functions.
  - **Entities** — `customers`, `mugs`, `empties`, `shards` (decorative) and
    `player`, each a flat array of small objects carrying `lane` and `x`.
  - **Simulation** — `step(dt)` advances spawning, patrons, mugs, empties and
    particles, then checks for a cleared level. Everything is expressed in
    units per second and integrated with the caller's `dt`, so the specs can run
    the game at exactly 1/60 s per call.
  - **Life cycle** — `startGame()`, `loseLife()`, `levelUp()`, `gameOver()`,
    `togglePause()`.
  - **Drawing** — `draw()` and its helpers repaint the room, counters, patrons,
    mugs, shards, barkeep and the spare-mug life counter. Drawing reads state
    and never mutates it.
- `index.html` / `style.css` — HUD (`#score`, `#level`, `#lives`, `#best`), the
  canvas, and the overlay (`#overlay`, `#overlay-title`, `#overlay-score`,
  `#overlay-sub`, `#btn-start`) shared by the idle, paused and game-over screens.

### Test hooks

Two globals exist purely so the specs are deterministic instead of racing the
real animation loop:

- `autoStep` — when set to `false`, `requestAnimationFrame` still draws but no
  longer calls `step()`, so a spec owns the clock and advances frame by frame.
- `spawnEnabled` — when set to `false`, the door stops letting patrons in, so a
  spec can place exactly the patrons it wants to reason about.

## Balance work

The rules above are the result of playing the game rather than guessing at it. A
scripted bot (a temporary spec, not committed) played full runs headlessly and
reported the level reached and the cause of each life lost:

1. **The first design had no thirst at all** — patrons left only when shoved off
   the far end of the bar. Because a patron walks forward while a mug travels to
   them, push-back and walking almost cancelled out: a single stream of mugs
   moved a patron a few pixels per cycle and the bot sat at level 1 for four
   simulated minutes without ever clearing it. Thirst replaced the geometry as
   the win condition.
2. **Thirst then rose too steeply** (`1 + floor((level - 1) / 2)`, so three mugs
   by level 5) and every bot run died at level 5. Flattened to
   `1 + floor(level / 3)` and mug speed raised from 220 to 250 px/s.
3. **Patrons leaving early stranded mugs.** With a "shoved past the door leaves
   happy" rule still in place, a patron could leave with thirst to spare, and
   the mugs already on their way smashed with nothing to hit — every bot life
   was lost this way, through no fault of the player. Patrons are now clamped at
   the door and leave only when their thirst runs out, which makes the number of
   mugs a bar needs exactly countable.

After those three changes the bot reaches levels 11–14 in a five-minute run,
losing lives to a mix of grabs and missed empties, so no single failure mode
dominates.

## Assumptions

Choices made where the brief was open, taking the simpler reading:

- **Branch naming.** The task asked for a branch named after the game
  (`tavern-tapper`), while the session's standing instructions pin all work to
  the assigned branch `claude/loving-euler-dhjjwd` and forbid pushing elsewhere.
  The assigned branch wins; the game name lives in the folder, the docs and the
  commit message instead.
- **Catching empties is positional, not a keypress.** Standing in the right bar
  when an empty arrives is enough. Adding a separate catch button would double
  the input load for no extra decision — the decision is already *which bar to
  be in*.
- **One barkeep column.** The barkeep only changes bars; there is no movement
  along a bar. All four taps are equivalent, so the only spatial decision is the
  lane.
- **No bonus/"bonus round" mode.** The arcade games this borrows from have
  side rounds; this build keeps a single escalating shift, which is the simpler
  interpretation and is what the level ladder above tunes.
- **Random spawns are unseeded.** `Math.random()` picks the bar each patron
  walks into. Specs never depend on it — they either disable spawning or assert
  on aggregate outcomes.
- **Best score is per-browser**, kept in `localStorage`; there is no server or
  shared leaderboard. When storage is unavailable the run still tracks its own
  score.
