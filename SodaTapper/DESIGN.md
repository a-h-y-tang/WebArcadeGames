# Soda Tapper — Design

## Concept

Soda Tapper is a single-screen arcade game in the spirit of *Tapper*. You are the
lone soda jerk behind four long counters. Thirsty customers stroll in from the
far end of every counter and march steadily toward you. Slide a frosty mug down
the counter to push each one back; keep pushing and they leave happy — and toss
the empty mug back at you, which you have to catch before it smashes on the
floor.

Nothing waits. Mugs you pour into an empty counter shatter at the far end, empty
mugs you fail to catch shatter at your end, and any customer who reaches your
station grabs you by the apron. Every one of those costs a life. Clear the whole
crowd for a wave and the next one arrives thirstier and faster.

## Screen layout

```
   x=40                                                    x=640   x=700
    |                                                        |       |
 ---+--------------------------------------------------------+---+---+  lane 0
 ---+--------------------------------------------------------+---+---+  lane 1
 ---+--------------------------------------------------------+---+---+  lane 2
 ---+--------------------------------------------------------+---+---+  lane 3
    ^ customers enter here                     taps / soda jerk ^
      (and served customers leave here)
```

- Canvas is 720 x 460 with four counters (lanes) 96 px apart.
- `BAR_LEFT = 40` is the open end: customers walk in there, poured mugs that
  reach it shatter, and served customers exit there.
- `BAR_RIGHT = 640` is the tap end: the soda jerk stands just past it, full mugs
  are poured there, and returning empty mugs must be caught there.

## Mechanics

**Customers** spawn at the open end of a random counter and walk right at
`PATRON_SPEED` (which climbs with the wave number). A customer that crosses
`BAR_RIGHT` reaches the taps and costs a life.

**Pouring.** Pressing serve pours a full mug at the tap end of the counter the
jerk is standing at. It slides left at `MUG_SPEED`. Pours are rate-limited by
`POUR_COOLDOWN` so a held key cannot flood a lane.

**Serving.** A full mug that overlaps a customer is drunk on the spot: the mug
disappears, the customer is shoved `PUSH_DISTANCE` px back toward the open end
and pauses for `DRINK_TIME` before walking again. Shove a customer past the open
end and they leave satisfied — worth `SERVE_POINTS` — and slide their empty mug
back up the counter to the right at `EMPTY_SPEED`.

**Catching.** An empty mug that reaches `BAR_RIGHT` is caught if the jerk is
standing in that lane (worth `CATCH_POINTS`); otherwise it shatters and costs a
life.

**Losing a life** happens three ways: a poured mug reaches the open end
untouched, an empty mug is not caught, or a customer reaches the taps. Each one
clears the counters (see Assumptions) and play continues with the remaining
customers of the wave. At zero lives the game is over.

**Waves.** Wave `n` sends `PATRONS_BASE + n * PATRONS_PER_LEVEL` customers, with
a shorter gap between arrivals and a higher walking speed each wave. The wave is
complete once every customer has been spawned, served or cleared and no mugs are
left in play; that scores `LEVEL_BONUS` and starts the next wave immediately.

## Controls

| Key | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | move down one counter |
| <kbd>Space</kbd> | pour and slide a mug (also starts the game) |
| <kbd>Enter</kbd> | start / restart |
| <kbd>P</kbd> | pause / resume |

The counters do not wrap: pressing up on the top counter or down on the bottom
one does nothing.

## Code structure

`game.js` is a single classic (non-module) script, matching Lode Runner, Tetris
and Kaboom in this repo, so the Playwright tests can reach state and helpers as
plain globals.

- **State** lives in module-level variables: `state` (`idle` / `running` /
  `paused` / `gameover`), `score`, `lives`, `level`, `lane`, plus the `patrons`
  and `mugs` arrays and the `remaining` spawn counter.
- **`step(dt)`** advances the entire simulation — spawn timer, customer walking,
  mug travel, collisions, life loss, wave completion. It is pure of any
  `requestAnimationFrame` timing, so tests advance frames deterministically.
- **`setAutoStep(false)`** freezes the animation-frame driver; the frame loop
  still draws, but only the test drives `step(dt)`.
- **Randomness** goes through a seeded `mulberry32` generator; `setSeed(n)` makes
  spawn lanes reproducible, and `setSpawning(false)` turns automatic arrivals off
  entirely so a test can place customers by hand with `spawnPatron(lane, x)`.
- **`getState()`** returns a plain snapshot (state, score, lives, level, lane,
  remaining, and copies of the customer and mug lists) for assertions.
- **Drawing** is a pure function of that state, so no test depends on render
  order.

## Assumptions

These were resolved in favour of the simpler reading and are recorded here as
required by the task brief.

1. **Branch name.** The brief asks for a branch named after the game
   (`soda-tapper`), but this session is required by its operating instructions to
   develop and push on its designated branch. The designated branch wins; the
   game name lives in the folder name (`SodaTapper/`) instead.
2. **Original title.** The game is Tapper-*style*, not a clone of any specific
   commercial game: original name, art and constants, and soda rather than any
   branded drink.
3. **Losing a life clears the counters.** The arcade original animates a
   life-loss sequence and resets the screen. Here, losing a life simply removes
   every customer and mug in play; customers cleared this way count as gone
   rather than being re-queued, so a wave always ends.
4. **No interstitial between waves.** Completing a wave scores the bonus and the
   next wave begins immediately, rather than showing a "wave complete" screen.
5. **One shove per mug.** Every full mug pushes a customer the same fixed
   distance; there is no partial drinking or per-customer thirst meter.
6. **Empty mugs pass through customers.** A returning empty mug slides over any
   customers on its counter; only the catch at the tap end matters.
7. **Serve key doubles as start.** <kbd>Space</kbd> starts the game from the
   title or game-over screen and pours while playing, so a player never needs the
   mouse.
8. **Best score** is kept in `localStorage` under `soda-tapper-best`; if storage
   is unavailable the game still runs and simply reports a best of 0.
