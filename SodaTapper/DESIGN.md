# Soda Tapper — Design

## Game concept

Soda Tapper is a single-screen arcade game about being the only bartender on a
four-lane soda bar. Thirsty patrons walk in from the door end of each lane and
march steadily toward the taps. You stand at the tap end, hop between lanes, and
slide full mugs down a lane to meet them.

A patron who catches a mug stops to drink and is shoved back toward the door, and
they throw the empty mug straight back at you. So every mug you pour creates two
problems to solve: the patron it has to reach, and the empty that comes back and
has to be caught. Push a patron all the way out of the door and they leave
satisfied, which is where the real points are.

Three lives, five levels, one score. Each level sends more patrons, faster, with
less time between them.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 720 × 480 | canvas size in CSS pixels |
| `LANES` | 4 | number of bar lanes |
| `LANE_TOP` | 96 | centre line of lane 0 |
| `LANE_GAP` | 100 | distance between lane centre lines |
| `TAP_X` | 74 | x of the taps — where you stand and where empties must be caught |
| `EXIT_X` | 660 | x of the door — where patrons enter and leave |
| `MUG_SPEED` | 215 px/s | speed of a mug, full or empty |
| `MUG_R` | 11 | mug radius, used for collision |
| `PATRON_R` | 16 | patron radius, used for collision |
| `PATRON_PUSH` | 130 px | how far one drink shoves a patron back toward the door |
| `PATRON_REACH` | 26 px | how close to the taps a patron gets before they grab you |
| `PATRON_GAP` | 36 px | closest two patrons in one lane ever stand |
| `DOOR_CLEARANCE` | 60 px | doorway kept clear before a new patron walks in |
| `POUR_COOLDOWN` | 0.3 s | minimum gap between two pours |
| `MUGS_PER_LANE` | 2 | full mugs allowed in flight in one lane at a time |
| `LIVES_START` | 3 | lives at the start of a run |
| `LEVEL_COUNT` | 5 | levels in a full run |

Lane `i` is drawn at `laneY(i) = LANE_TOP + i * LANE_GAP`, so the four lanes sit
at y = 96, 196, 296 and 396. Everything in the simulation moves along x only;
the lane index is the whole of an entity's vertical position.

## Rules

1. **Pouring.** `pour()` puts a full mug at `TAP_X + 14` in the bartender's lane,
   moving right. It is refused while a pour cooldown is running, while the lane
   already holds `MUGS_PER_LANE` full mugs, or while the game is not running.
2. **Serving.** When a full mug reaches a patron (centres within
   `MUG_R + PATRON_R`), the patron drinks it: `+50`, the patron's `drinks` goes
   up, they are shoved `PATRON_PUSH` px toward the door, and the empty mug is
   thrown back down the lane toward the taps.
3. **Satisfied patrons.** A shove that puts a patron at or past `EXIT_X` sends
   them out of the door: `+150` and `served` goes up. A patron who walks in
   usually needs two or three mugs to get there, depending on how far they got.
4. **Catching empties.** An empty mug that reaches `TAP_X` is caught if the
   bartender is standing in that lane: `+25` and the catch streak grows. If the
   bartender is in another lane the mug smashes on the floor and costs a life,
   and the streak resets to zero.
5. **Mugs that miss.** A full mug that reaches `EXIT_X` without meeting a patron
   smashes and costs a life.
6. **Patrons that reach the taps.** A patron who gets within `PATRON_REACH` of
   the taps grabs the bartender: the patron leaves and it costs a life.
7. **The queue.** Patrons in a lane are stepped front first and clamped to
   `PATRON_GAP` behind the one ahead, so a fast patron queues up behind a slow
   one instead of walking through them. The same gap limits a shove: if the
   patron behind is too close, the crowd absorbs it and the drinker stays put
   (they still drink the mug and still score).
8. **Level clear.** When a level has no patrons left to send, no patrons on the
   bar and no mugs in flight, the level is cleared and pays
   `CLEAR_BONUS_PER_LIFE × lives`. Clearing level `LEVEL_COUNT` wins the run.
9. **Lives.** Each mishap costs one life. The last life ends the run.

## Levels

`levelPlan(n)` is a pure function of the level number, so a level always sends
the same number of patrons at the same base speed:

| Level | Patrons | Base speed | Spawn interval |
|---|---|---|---|
| 1 | 6 | 32 px/s | 2.3 s |
| 2 | 8 | 38 px/s | 2.0 s |
| 3 | 10 | 44 px/s | 1.7 s |
| 4 | 12 | 50 px/s | 1.4 s |
| 5 | 14 | 56 px/s | 1.1 s |

An individual patron's speed is jittered by ±10% of the base so a lane never
becomes a metronome. The jitter and the lane choice come from `rnd()`, a seeded
LCG, which keeps a run reproducible and lets the test suite pin the seed.

A spawn is held back (without spending one from the level's allowance) while the
chosen lane still has a patron within 60 px of the door, so patrons never appear
on top of each other.

## Code structure

`game.js` runs in the global scope on purpose, exactly like the other games in
this repo: the Playwright suite reaches straight into `state`, `score`, `lives`,
`patrons`, `mugs`, `bartender` and `physicsStep()`, so those names are part of
the game's contract and are not wrapped in a module.

- **State.** `state` is one of `idle`, `running`, `paused`, `levelclear`,
  `gameover`, `won`. `score`, `level`, `lives`, `served`, `streak` and `best`
  are the scoreboard. `patrons` and `mugs` are flat arrays; `bartender` holds
  `{ lane, pourCooldown }`.
- **Simulation.** `physicsStep(dt)` is the only thing that advances the world:
  spawns, patron walking, mug travel, collisions, life loss and the level-clear
  check, in that order. It runs on a fixed `DT = 1/120` timestep. The animation
  loop accumulates real time and calls it as many times as needed, so frame rate
  never changes the outcome and a test can call it directly.
- **`autoRun`.** The animation loop only simulates while `autoRun` is true. The
  test suite sets it to false, builds an exact board, and steps the simulation by
  hand.
- **Rendering.** `draw()` paints the bar, lanes, patrons, mugs and bartender from
  state and holds no state of its own.
- **Input.** `↑/↓` or `W/S` change lane, `Space` pours (and starts the game or
  dismisses an overlay), `P` pauses. Clicking a lane jumps to it and clicking the
  canvas while running pours.
- **Persistence.** The best score is stored in `localStorage` under
  `sodatapper-best`.

## Assumptions

These are the places the brief left room, and the simpler reading was taken each
time. Noted here rather than guessed at silently.

- **Pouring is one keypress, not hold-and-release.** The arcade original has you
  hold a tap to fill a mug and release to slide it. A single `pour()` per press,
  rate-limited by `POUR_COOLDOWN` and by `MUGS_PER_LANE`, gives the same
  "don't spam the taps" pressure with far less state, so that is what is here.
- **The bartender does not move along x.** Only the lane changes. The tap end and
  the catch line are the same place, which keeps the catch rule to a single
  comparison.
- **Empties come straight back.** A patron who catches a mug returns the empty in
  the same step instead of drinking for a while first. One timer fewer, and the
  pressure on the player is the same.
- **No bonus round and no tips.** The original cuts to a shell-game bonus screen
  between levels and scatters tips along the bar. Both are separate games bolted
  onto this one; the level-clear bonus pays for surviving instead.
- **Catching is automatic when you are in the lane.** There is no separate catch
  button — standing in the right lane when the empty arrives is the skill.
- **Queues absorb shoves.** A shove into the patron behind is swallowed rather
  than pushing the whole queue along. One rule instead of a chain reaction, and
  it gives a crowded lane its own character: the front of a queue is the hardest
  patron on the bar to clear.
- **A life is lost, not a lane.** Every mishap costs exactly one life and play
  continues immediately, with no reset of the bar and no invulnerability window.
- **The branch name.** The brief asks for a branch named after the game
  (`soda-tapper`), but this session is required to develop and push on its
  designated branch `claude/compassionate-ramanujan-aawn3v`. The designated
  branch wins; the game name lives in the folder, the game id and the commits.
