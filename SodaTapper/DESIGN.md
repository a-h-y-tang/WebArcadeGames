# Soda Tapper — Design

## Concept

A four-lane soda-fountain arcade game on a single HTML5 canvas. The player is a
soda jerk pinned to the tap end of four parallel bars. Thirsty patrons walk in
from the door end of each bar; a full mug slid down a bar shoves whoever it hits
back toward the door. Push a patron all the way off the far end and they leave
happy — and slide their empty mug back down the bar, which has to be caught
before it sails past the tap and shatters.

The tension is that both halves of the loop share one body: you can only pour on
the lane you are standing on, and you can only catch on the lane you are
standing on. Every soda you pour creates an empty you will have to be somewhere
else to collect.

## Mechanics

**Bars.** Four lanes, `laneY(i)` apart, spanning `BAR_LEFT` (door, x=40) to
`BAR_RIGHT` (tap, x=600).

**Patrons.** One patron at most per lane at a time. They enter at `ENTRY_X` and
walk toward the tap at `patronSpeed()` = 40 px/s + 9 px/s per level. A patron is
in one of three modes:

| Mode | Behaviour |
|---|---|
| `walking` | advancing toward the tap |
| `sliding` | shoved back 110 px at 170 px/s after being hit by a mug |
| `drinking` | 0.7 s pause at the end of a slide, then back to `walking` |

**Full mugs.** `serve()` puts a mug at `TAP_X` on the bartender's current lane,
travelling left at 260 px/s. Overlap with a patron on the same lane (AABB on x)
converts to a hit: the mug is consumed, the patron's `drinks` count goes up and
they enter `sliding`.

**Serving a patron.** A sliding patron whose x falls below `BAR_LEFT` leaves:
`SCORE_SERVE × level` points, `served` increments, and `spawnEmpty()` puts an
empty mug on that lane travelling right at 200 px/s.

**Catching empties.** Once an empty reaches `CATCH_X` (560) it is caught if the
bartender is on that lane — `SCORE_CATCH` (50) points. The gap between
`CATCH_X` and `BREAK_X` (600) is the reaction window: the player can still
change lanes inside it.

**Losing a life** (three ways, all clear the bar and pause spawning for 1.4 s):

1. a patron reaches `GRAB_X` (570) — they get you before you get them a soda;
2. a full mug reaches `BAR_LEFT` without hitting anyone — it smashes on the floor;
3. an empty mug passes `BREAK_X` uncaught.

At zero lives the game ends and the best score is written to `localStorage`
under `sodatapper-best`.

**Levels.** Level *n* needs `6 + 2n` patrons served. When the target is met and
the bar is completely clear (no patrons, no mugs, no empties) the level advances:
`LEVEL_BONUS` 250 points, faster patrons, shorter spawn interval (2.6 s down to a
floor of 0.9 s), and a bigger target. Spawning stops once
`served + patrons.length >= levelTarget`, so a level always drains to empty
rather than overshooting.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between bars |
| `Space` | pour a soda down the current bar (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| click a bar | move there and pour (touch-friendly shortcut) |

## Code structure

Everything lives in three files — `index.html`, `style.css`, `game.js` — with no
build step, matching the rest of the repo.

`game.js` is deliberately written as plain top-level globals and free functions
rather than a module or class. The Playwright specs drive the simulation by
calling `step(dt)` directly and read `state`, `score`, `patrons`, `mugs`,
`empties` and friends straight off the page, so state must not be hidden inside a
closure.

- **Geometry / tuning constants** — all layout and speed numbers at the top.
- **State** — `state` (`idle | running | paused | over`), score/lives/level
  counters, the `bartender` object and the three entity arrays.
- **Entities** — `makePatron`, `spawnPatron`, `spawnEmpty`, `serve`.
- **Flow** — `startGame`, `nextLevel`, `loseLife`, `gameOver`, `togglePause`.
- **Simulation** — `step(dt)` calls `stepSpawning`, `stepPatrons`, `stepMugs`,
  `stepEmpties`, `stepEffects` in order, re-checking `state` between phases so a
  life lost mid-frame stops the rest of that frame cleanly, then tests the
  level-complete condition.
- **Drawing** — `draw()` repaints the fountain, bars, entities and effects each
  frame; it is pure rendering and never mutates game state, so tests can call it
  at any time.
- **Input** — one `keydown` listener plus the start button and a canvas click
  handler. `e.repeat` is ignored so a held key does not machine-gun mugs.
- **Main loop** — `requestAnimationFrame` with dt clamped to 50 ms, so a
  backgrounded tab cannot teleport entities through each other.

`step(dt)` is the only thing that mutates the simulation; `draw()` is the only
thing that paints. That split is what makes the game testable frame by frame.

## Testing

`tests/sodatapper.spec.js` holds 62 Playwright specs, written before the
implementation. They open `index.html` over `file://` — no server needed — and
drive the game deterministically:

- `advance(page, frames)` calls `step(1/60)` a fixed number of times;
- `advanceUntil(page, predicate)` steps in small batches until a condition holds,
  for cases where the exact frame count is uninteresting;
- `startQuiet(page)` starts a game with `spawnEnabled = false` and empty entity
  arrays, so each spec controls exactly who is on the bar;
- key presses are confirmed against game state with `waitForFunction` before the
  spec continues, because Chromium can acknowledge a synthetic key event before
  the page listener has run.

Coverage: idle state and HUD, all three start paths, lane movement and its
bounds, pouring, mug/patron collision, serving and scoring, empty-mug catching
and breaking, all three life-loss routes, level progression, pause, game over and
restart, best-score persistence, and rendering (canvas actually painted, drawing
a populated running game does not throw, and the real RAF loop advances a live
game on its own).

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and is
recorded here.

1. **Branch name.** The brief asks for a branch named after the game
   (`soda-tapper`), but this session is required to develop and push on its
   designated branch `claude/loving-euler-gyo2jz`. The designated branch wins;
   no separate `soda-tapper` branch was created.
2. **Original riff, not a clone.** "Soda Tapper" is an original take on the
   lane-serving arcade format rather than a reproduction of any particular
   commercial game's levels, art or naming.
3. **No serve cooldown.** Mugs can be poured as fast as the player can press
   Space. `e.repeat` is ignored so autorepeat does not do it for them. A
   cooldown would be one more piece of state for tests to reason about and adds
   nothing at these speeds.
4. **One patron per lane.** Classic versions queue several patrons per bar.
   One at a time keeps collision resolution unambiguous (a mug can only ever hit
   one patron) and keeps the difficulty in lane-juggling rather than crowd
   management.
5. **Empties ignore patrons.** An empty mug slides back along the bar top and
   passes patrons without interacting. Modelling a patron catching their own
   empty back would create loops with no clear resolution.
6. **Instant lane changes.** The bartender teleports between bars on a key press
   instead of animating between them, so "am I on that lane yet" is never
   ambiguous — for the player or for a test.
7. **Level ups do not interrupt play.** Levelling up flashes a canvas banner for
   1.4 s but never pauses the game or shows a modal overlay.
8. **Losing a life clears the whole bar,** not just the offending lane, and
   gives a 1.4 s breather before the next arrival, so the player is never
   instantly killed twice by a situation they had no time to read.
9. **`game-browser/e2e/game-browser.spec.ts` was left alone.** It hardcodes a
   count of 105 game cards while `games.json` already listed 108 before this
   change, so that spec was stale independently of this game. It is not part of
   the root `npm test` run (the root config only matches `**/tests/*.spec.js`),
   and fixing it is out of scope here.
