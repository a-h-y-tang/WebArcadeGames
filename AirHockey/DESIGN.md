# Air Hockey — Design

## Game concept

Air Hockey is the classic table game: a low-friction puck slides around a
walled rink with a goal mouth at each end, and two mallets knock it back and
forth. You control the mallet on the **bottom** half of the table; the computer
controls the **top**. Slam the puck into the computer's goal to score, defend
your own, and the first to seven goals wins the match.

The table is drawn in portrait (tall) orientation: your goal is the gap in the
bottom wall, the computer's goal is the gap in the top wall, and the puck
bounces off every other stretch of wall.

## Mechanics

The simulation is a single deterministic physics step, `update(dt)`, where
`dt` is elapsed seconds. It is a pure function of the current state and the
held keys / mallet positions — it never reads the clock or `state` — so tests
can drive it frame by frame.

Each step, in order:

1. **Mallet motion.** The player mallet moves from held arrow/WASD keys (the
   mouse can also place it directly during real play); the AI mallet chases the
   puck while the puck is in its half and drifts back to a home spot otherwise.
   Both mallets are clamped inside the walls and to their own half of the table
   (neither may cross the centre line). Each mallet's velocity is derived from
   how far it moved this frame, so a moving mallet transfers momentum to the
   puck.
2. **Puck integration + friction.** The puck's velocity decays slightly each
   step (air hockey is near-frictionless, so the decay is gentle), is capped at
   a maximum speed, and is integrated into position.
3. **Wall bounces.** The puck reflects off the left and right walls always, and
   off the top/bottom walls **except** where the goal mouth is cut out. Inside
   the goal mouth the puck passes straight through.
4. **Mallet collisions.** When the puck overlaps a mallet, it is pushed clear
   along the contact normal and its velocity is reflected about that normal,
   plus a share of the mallet's own velocity — so a well-timed swipe sends the
   puck flying.
5. **Goals.** When the puck leaves the table entirely past the top edge it is
   the player's goal; past the bottom edge it is the computer's. The scorer's
   tally rises, the puck re-centres with a serve toward the side that conceded,
   and both mallets reset home. Reaching the winning score ends the match.

## Controls

| Input | Action |
|---|---|
| `←` `→` `↑` `↓` (or `A` `S` `D` `W`) | Move your mallet (held) |
| Mouse over the table | Place your mallet under the cursor |
| `P` | Pause / resume |
| Arrow / Space / Enter / button | Start or restart |

Your mallet is confined to the bottom half of the table.

## State exposed for testing

`game.js` runs as a classic script, so its top-level bindings are global. The
Playwright suite reads and drives them directly: `player` and `cpu` (mallets,
`{x, y, vx, vy, px, py, r}`, centre based), `puck` (`{x, y, vx, vy, r}`),
`playerScore`, `cpuScore`, `wins`, `state` (`idle` \| `running` \| `paused` \|
`over`), `keys`, the pure `update(dt)` step, lifecycle helpers `startGame()`
and `endGame(winner)`, and tunables (`WIDTH`, `HEIGHT`, `GOAL_WIDTH`,
`WIN_SCORE`, `PUCK_R`, `MALLET_R`).

## Assumptions

- **DESIGN.md vs. design.md.** The repo convention is a lowercase `design.md`
  per game; the task asked for `DESIGN.md`. This single file serves both roles.
- **Single-player vs. a CPU.** Like the repo's Pong, this is you versus a
  beatable AI rather than two-player hotseat — the simpler interpretation.
- **First to 7 wins**, mirroring Pong's match length.
- **Lifetime wins** (matches the player has won) persist via `localStorage`
  under `airhockey-wins`, following the persistence pattern used by the other
  games in this repo.
- **Portrait table** (460×700) with goal mouths top and bottom, suiting the
  vertical layout and keeping the AI/player split simple (top half vs. bottom
  half).
- **Gentle friction.** A real air-hockey puck is almost frictionless; a small
  decay is applied so rallies eventually settle rather than continuing forever,
  which also keeps the simulation well-behaved in tests.
