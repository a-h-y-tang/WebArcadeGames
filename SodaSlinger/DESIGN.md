# Soda Slinger — Design

## Concept

Soda Slinger is a single-screen arcade game about keeping four bar counters
under control. The player is a soda jerk standing at the left end of all four
counters, in front of the taps. Thirsty customers walk in from the right end of
each counter and shuffle leftward toward the taps. The player slides a filled
mug down whichever counter they are standing at; the mug travels right, the
first advancing customer it reaches catches it, drinks while being pushed back,
then leaves the bar and shoves the empty mug back down the counter. The player
has to be standing at that counter to catch the empty.

Everything that can go wrong goes wrong at the tap end or off the far end:

* An advancing customer that reaches the taps grabs the slinger — a life.
* A filled mug that runs off the far end with nobody to catch it smashes — a life.
* An empty mug that comes back to a counter the slinger is not standing at
  smashes — a life.

Three lives, five increasingly busy levels, best score kept in `localStorage`.

## Field geometry

The canvas is 720x540. Four counters stack vertically; counter `i` has its
centre line at `laneY(i) = LANE_TOP + LANE_H * i + LANE_H / 2` with
`LANE_TOP = 60` and `LANE_H = 112`, so the centres are 116, 228, 340 and 452.

Horizontally:

| Landmark | x | Meaning |
|---|---|---|
| `PLAYER_X` | 44 | the column the slinger works in |
| `TAP_X` | 84 | mugs are poured here; empties are caught here |
| `LOSS_X` | 100 | an advancing customer this far left grabs the slinger |
| `BAR_RIGHT` | 686 | customers walk in here; filled mugs smash past it |

## Mechanics

**Walking.** `player.lane` is the counter the slinger is *heading for* and
`player.y` is where they actually are; `movePlayer` closes the gap at
`PLAYER_SPEED` (380 px/s), so crossing one counter takes about 0.3 s. Anything
that needs the slinger to be *there* — pouring, catching an empty — goes
through `atLane(lane)`, which allows `REACH` (24 px) of slack either side of
the counter line. Changing counters mid-stride just changes the target. This is
what stops the game from being solvable by reflex alone: the slinger cannot be
at two counters at once, so a filled counter and a returning empty genuinely
compete for them.

**Pouring.** `pour()` adds a filled mug at `TAP_X` on the player's counter,
moving right at `MUG_SPEED` (300 px/s). A `POUR_COOLDOWN` of 0.18 s stops a
held key from emitting a wall of mugs, and a pour attempted mid-stride is
simply ignored.

**Serving.** A filled mug serves the frontmost *advancing* customer on its
counter once the gap closes to `CATCH_GAP` (16 px). The customer switches to
`drinking`: it slides right at `DRINK_PUSH` (60 px/s) for `DRINK_TIME` (1.2 s),
then switches to `leaving`, moves right at `LEAVE_SPEED` (170 px/s), and at that
moment releases an empty mug at its own position moving left at `EMPTY_SPEED`
(220 px/s). The customer is removed once it is past the far end. Serving scores
`SERVE_POINTS` (50).

**Empties.** An empty that reaches `TAP_X` is caught for `EMPTY_POINTS` (10) if
`atLane()` says the slinger is standing at its counter, and otherwise smashes
and costs a life — arriving a moment too late is a miss.

**Losing a life.** `loseLife(lane)` clears that counter completely (customers,
filled mugs, empties) so the player is not punished twice for the same pile-up,
records a short cosmetic spill marker, and ends the game at zero lives.

**Levels.** Level `n` asks for `5 + 3n` customers (`quota`) and walks them at
`20 + 8n` px/s. Spawn gaps are `max(0.9, 3.1 - 0.3n)` seconds jittered by
±0.4 s from a seeded PRNG, so a level always plays out the same way. At most
`MAX_PER_LANE` (3) advancing customers share a counter.

The level clears when every customer it owed has come and gone: `spawned >=
quota` and no customers, mugs or empties left anywhere. Keying the condition
off `spawned` rather than `served` matters because a lost life wipes a counter,
so a customer can leave the bar unserved — on `served` alone a level could
stall with an empty bar and an unreachable quota. Clearing pays `100 * level`
and, after `LEVEL_COUNT` (5) levels, wins the game. The HUD still reports
`served / quota`, so a level can be cleared with that counter short of the
quota; the missing drinks were paid for in lives.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | move down one counter |
| <kbd>Space</kbd> | pour and slide a mug (also starts / advances the game) |
| click the canvas | pour a mug |
| <kbd>P</kbd> | pause / resume |

## Code shape

`game.js` is a classic script with its interesting state at the top level —
`state`, `score`, `lives`, `level`, `served`, `quota`, `customers`, `mugs`,
`empties`, `player` (`{ lane, y }`) — because the Playwright suite drives the game through
exactly those names. The simulation runs on a fixed `DT = 1/120` s timestep
inside `physicsStep(dt)`; the animation loop only calls it while
`autoRun && state === 'running'`, so a test can set `autoRun = false` and step
the world by hand. Rendering lives in `draw()` and never changes state.

Pass order inside `physicsStep`: advance timers, walk the slinger, run the
spawner, move customers, move filled mugs and resolve serves, move empties and resolve
catches, then check the level-clear condition.

## Assumptions

The task description left some things open; the simpler reading was taken in
each case and is recorded here.

1. **Branch.** The task asked for a branch named after the game
   (`soda-slinger`), but this session is pinned to the designated branch
   `claude/compassionate-ramanujan-c9xugq` and is not permitted to push
   elsewhere. The work is therefore developed and pushed on the designated
   branch, and the game name is carried by the folder, docs and catalogue entry
   instead.
2. **Catching empties** is positional rather than an extra button: being at the
   counter when the empty arrives is enough. One less thing to explain, one
   less key to press.
3. **No tip bonuses, no runaway "dancer" distraction** from the arcade original
   — scoring is just serves, empties and the level-clear bonus.
4. **Customers never walk back on their own**; only a served drink pushes one
   rightward. A counter therefore only gets safer when the player acts.
5. **Spawning is seeded** (`mulberry32` seeded from the level number) rather
   than `Math.random`, so a level is reproducible and the suite can assert on
   real, unassisted play.
6. **One shared pour cooldown**, not a per-counter one, so moving between
   counters cannot be used to pour faster than `POUR_COOLDOWN`.
7. **A life is lost, not the game**, when a counter pile-up resolves badly; the
   counter is wiped so a single mistake cannot cascade into three lives.
