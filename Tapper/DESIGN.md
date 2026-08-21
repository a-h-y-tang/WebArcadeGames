# Tapper — Design

## Concept

You are the lone soda jerk behind a four-counter fountain bar. Thirsty patrons
push in through the door at the far end of each counter and shuffle toward you.
Your only defence is root beer: slide a full mug down a counter and the patron
who catches it is knocked back a few paces while they drink. Knock a patron all
the way back out of the door and they leave happy — but every mug they catch
comes sliding back at you as an empty, and an empty that reaches the taps
un-caught shatters on the floor.

The whole game is a juggling act across four lanes: serve, retreat, catch,
serve again. Clear the shift's quota of patrons and the next shift arrives —
larger and faster.

## Board layout

The canvas is 560 × 440. Four counters run horizontally across it:

| Constant | Value | Meaning |
|---|---|---|
| `LANE_Y` | 64, 160, 256, 352 | top surface of each counter (items rest on this line) |
| `COUNTER_LEFT` / `SPAWN_X` / `EXIT_X` | 40 | the doorway — patrons enter here and leave here |
| `COUNTER_RIGHT` / `SERVE_X` | 496 | the tap end; full mugs are poured here |
| `GRAB_X` | 470 | a patron who walks this far grabs you — a life is lost |
| `CATCH_X` | 486 | an empty mug reaching here is caught (if you're on that lane) or smashes |
| `PLAYER_X` | 522 | where the soda jerk stands |

Everything moves along the x axis only; the lane index is the y axis. That
keeps collision detection to a one-dimensional comparison inside a lane and
makes the whole simulation easy to assert on from tests.

## Mechanics

**Serving.** `Space` pours a mug at `SERVE_X` on the player's current lane. It
slides left at 220 px/s. A short `SERVE_COOLDOWN` (0.22 s) stops the player from
carpeting a counter with a single key repeat.

**Catching a mug (patron side).** A full mug collides with the right-most
patron in its lane within `HIT_R` (15 px). The mug is consumed, the patron is
knocked back `PUSH_DIST` (96 px) — sliding left at `PUSH_SPEED` — and then
stands still for `DRINK_TIME` (0.8 s) before walking again. Every caught mug
scores `MUG_SCORE` (50) and immediately sends an **empty mug** sliding back
toward the player from the patron's position.

**Serving a patron out.** If the knock-back carries a patron to `EXIT_X` they
walk out of the door: `SERVE_SCORE` (200) and the shift's `served` counter goes
up.

**Catching empties.** Empties slide right at 170 px/s. When one reaches
`CATCH_X` the player either is on that lane — `EMPTY_SCORE` (25) — or isn't, in
which case the mug shatters and a life is lost.

**Losing a life.** Three ways:

1. A patron reaches `GRAB_X`.
2. A full mug runs the whole counter without meeting anyone and drops off the
   end at `EXIT_X`.
3. An empty mug reaches `CATCH_X` with the player on another lane.

Losing a life clears every patron and mug on the bar and freezes play for
`RESPAWN_DELAY` (0.8 s). Patrons that were cleared are *not* counted as served —
the spawn counter is rolled back by the number cleared so the shift's quota can
still be met. At zero lives the game ends and the best score is written to
`localStorage` under `tapper-best`.

**Shift (level) progression.** Shift *n* requires `4 + 2n` patrons served
(6 on shift 1). The shift only advances once the quota is met *and* the bar is
completely clear — no patrons, no mugs in flight, no empties. Advancing awards
`LEVEL_BONUS` (500). Patrons walk faster each shift
(`26 + 5·(n−1)` px/s, capped at 60) and arrive more often
(`3.2 − 0.25·n` s between arrivals, floored at 1.2 s), with at most
`MAX_PER_LANE` (3) patrons on any one counter.

## Controls

| Key | Action |
|---|---|
| `↑` / `W` | move up one counter |
| `↓` / `S` | move down one counter |
| `Space` | pour and slide a mug (also starts the game) |
| `P` | pause / resume |
| `Enter` | start, or resume from pause |

Lane changes are discrete — one key press moves exactly one counter. The
player's drawn `y` eases toward the new lane, but every collision test uses the
integer `player.lane`, so what the game judges and what the tests assert are
the same thing.

## Code structure

`game.js` is a single classic (non-module) script, matching Snake, Tetris,
Kaboom! and BurgerTime in this repo: all state and helpers are plain top-level
bindings, so a Playwright test can read `state`, `patrons`, `mugs` or call
`step(dt)` directly through `page.evaluate`.

- **Constants** — geometry, speeds, scores. Tests import nothing; they read
  these globals so a tuning change doesn't silently invalidate an assertion.
- **State** — `state` (`idle` / `running` / `paused` / `over`), `score`,
  `lives`, `level`, `served`, plus the entity arrays `patrons`, `mugs`,
  `empties` and the cosmetic `shards` / `floats`.
- **`step(dt)`** — the whole simulation, expressed per-second: player easing,
  mugs, empties, patrons, spawning, level check, effects. It returns
  immediately unless `state === 'running'`.
- **`draw()`** — pure rendering; it never mutates simulation state.
- **`frame(now)`** — the `requestAnimationFrame` loop: `step` (only while
  `autoStep` is true) then `draw`.

### Testing approach

Tests were written before the implementation and drive the simulation directly
rather than waiting on wall-clock time:

- `autoStep = false` detaches the animation loop's own `step` call, so the only
  time that passes is the time a test asks for. Rendering keeps running, which
  means the draw path is still exercised on every test.
- `advance(page, frames, dt)` runs an exact number of fixed-`dt` frames.
- `spawnEnabled = false` turns off random patron arrivals; specs that care
  about patrons call `spawnPatron(lane)` and place them with explicit
  coordinates. Only the spawner's own specs leave it on.

## Assumptions

These were decisions the brief left open; the simpler reading was taken each
time and recorded here.

1. **Branch name.** The brief asks for a branch named after the game
   (`tapper`), but this session is also instructed to develop and push only on
   its assigned branch `claude/loving-euler-jgcr8q`. The assigned-branch rule
   wins — all work lands there, and no `tapper` branch is created.
2. **Theme.** The 1983 arcade original is a bar game. This version is a soda
   fountain: root beer, not beer. The mechanics are unchanged.
3. **No tap refills.** In the original the bartender must hold the tap to fill
   a mug and can only serve what's in hand. Here `Space` pours and slides in one
   action, rate-limited by a cooldown. One button, one meaning.
4. **Empties are caught by presence.** Standing on the lane catches a returning
   empty; there is no separate catch button and no timing window beyond being
   in the right place.
5. **Instant lane changes.** A key press moves a whole counter rather than
   sliding the player continuously, which keeps "which lane am I on" an
   unambiguous integer for both collisions and assertions.
6. **No bonus round.** The arcade game cuts to a shell-game bonus stage between
   levels. Shifts here run straight into one another with a score bonus and a
   brief on-canvas banner instead.
7. **No tips or bonus patrons.** Score comes only from mugs caught, patrons
   served, empties recovered and the shift bonus.
8. **Empties pass patrons.** A returning empty slides underneath everyone; it
   only ever interacts with the player.
9. **Lives and quota.** Three lives, and a shift quota of `4 + 2n`, chosen so a
   first shift is winnable in well under a minute of play.
