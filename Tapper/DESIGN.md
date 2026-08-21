# Tapper — Design

## Concept

A single-screen arcade game about serving a bar that never stops filling up.
Four counters run across the screen. Thirsty patrons walk in from the left end
of each counter and shuffle steadily toward you at the right end. You are the
bartender: you can only stand at the right end of one counter at a time, and
your only tools are full mugs (slid *away* from you, down the counter) and your
hands (to catch the empties the patrons slide *back*).

The tension is that both directions matter. Pouring is how you push patrons
back, but every mug you pour becomes an empty mug flying at you a moment later,
on the counter where you poured it. Serve too greedily on one counter and the
empties pile back while a patron creeps up on another.

## Board

- Canvas is 640×480.
- Four counters at `y = 80, 180, 280, 380`, spanning `x = 40 … 596`.
- The bartender stands just right of the counters at `x = 610` and occupies
  exactly one row at a time.
- Patrons enter at the left end of a counter and advance rightward.

## Mechanics

**Pouring.** `Space` slides a full mug from the right end of the bartender's
current counter toward the left at 230 px/s. A short cooldown (0.18 s) keeps a
single keypress from producing a stack of mugs.

**Serving.** A full mug that reaches a patron pushes that patron 88 px back
toward the entrance and puts them into a 0.9 s drinking pause, during which they
do not advance. The patron immediately slides the **empty mug** back toward the
bartender at 170 px/s. A mug always hits the *rightmost* (nearest) patron on its
counter — the one closest to grabbing you.

**Satisfying a patron.** When a push-back carries a patron past the left end of
the counter, they leave happy: +50 points and they are removed from the wave.
So a patron caught right as they walk in takes one mug, while a patron who has
made it halfway down the bar takes several.

**One for the road.** A departing patron takes one mug still sliding along
behind them, worth +25. Without this, the natural move of pouring a second mug
while the first is in flight would kill you every time the first one finished
the job — the trailing mug would find an empty counter and shatter. Play-testing
with a scripted bot made that trap the single biggest cause of death, so
departing patrons now clear one trailing mug. Pouring at a genuinely empty
counter, or stacking three mugs deep, is still punished.

**Catching empties.** An empty mug that reaches the right end is caught for +10
if the bartender is standing on that counter. If the bartender is elsewhere, the
mug sails off the end and shatters — that costs a life.

**Wasting a mug.** A full mug poured down a counter with no patron on it runs
off the far end and shatters — also a life.

**Getting grabbed.** A patron who reaches the right end of a counter grabs the
bartender — a life.

**Losing a life** clears the whole bar (mugs, empties, patrons) and restarts the
current wave after a short pause. Three lives; at zero the game ends.

**Waves.** Wave *n* contains `5 + n` patrons (capped at 12), released one at a
time at shrinking intervals (2.8 s on level 1, floor 1.1 s) onto random
counters. Patrons walk at 25 px/s on level 1 and 5 px/s faster per level, up to
78 px/s. Clearing a wave scores a `100 × level` bonus and advances the level.

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | Move up one counter |
| `↓` / `S` | Move down one counter |
| `Space` | Pour a mug down the current counter |
| `P` | Pause / resume |
| `Space` (idle or game over) | Start a new game |

Mouse: the **Start Game** button on the overlay starts (or resumes from pause).

## Code structure

`game.js` is a single classic (non-module) script, matching the convention used
by Snake, Tetris, Kaboom! and BurgerTime in this repo: all state and helpers are
plain globals, so the Playwright specs can read and drive them directly.

All motion is expressed per second and applied by `step(dt)`. `requestAnimation-
Frame` only computes a `dt` and calls `step` then `draw`, so the tests can
simulate any amount of game time deterministically by calling `step(1/60)` in a
loop without depending on wall-clock timing.

Key globals the tests use:

| Name | Meaning |
|---|---|
| `state` | `'idle'`, `'running'`, `'paused'`, `'over'` |
| `bartender` | `{ row }` — which counter the player is on |
| `patrons` | `[{ row, x, drinkTimer }]` |
| `mugs` | full mugs travelling left |
| `emptyMugs` | empty mugs travelling right |
| `pending` | patrons in this wave not yet released |
| `spawnEnabled` | set to `false` by tests to freeze the spawner |
| `startGame()`, `pour()`, `spawnPatron(row)`, `step(dt)`, `draw()` | entry points |

`step(dt)` is a no-op unless `state === 'running'`, which is what makes the pause
tests meaningful. Life loss is handled by a `loseLife()` that clears the bar and
returns immediately, so two simultaneous disasters in one frame cannot cost two
lives.

Best score persists in `localStorage` under `tapper-best`.

## Assumptions

These are the judgement calls made where the brief (or the arcade original) was
ambiguous. In each case the simpler reading was taken.

1. **Branch name.** The task asked for a branch named after the game
   (`tapper`), but this session is required to develop and push on its assigned
   branch `claude/loving-euler-9p1zb5`. The assigned branch wins; no `tapper`
   branch is created.
2. **One patron queue per counter, no bunching rules.** The original packs
   patrons into queues that shove each other. Here patrons simply occupy
   positions on a counter and a mug hits the nearest one; the spawner just
   avoids dropping a new patron on top of one still near the entrance.
3. **Losing a life restarts the current wave** rather than resuming it
   mid-flight. Simpler to reason about and to test.
4. **No bonus rounds.** The arcade original breaks the action with a "guess
   which can was shaken" bonus stage and with dancing-girl distractions; neither
   adds to the core loop, so both are omitted. The one-for-the-road tip above is
   the only scoring extra.
5. **Discrete row movement.** One keypress moves exactly one counter, rather
   than the bartender sliding continuously between rows.
6. **Random spawns are seeded** by a small deterministic PRNG so a test can
   enable spawning and still get a reproducible wave.
7. **Balance was set by play-testing, not by feel.** A scripted greedy bot
   played the game at three levels of pouring discipline; the constants above
   are the ones where careless pouring loses quickly, careful pouring survives
   for many minutes, and nearly every death comes from a patron reaching the
   bartender rather than from a shattered mug.
8. **The theme is soft drinks**, not beer — the counters serve soda, which keeps
   the game appropriate for the same audience as the rest of the arcade.
