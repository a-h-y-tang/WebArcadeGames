# Droid Arena — Design

## Concept

Droid Arena is a single-screen, twin-stick arena shooter. You are the last human
pilot dropped into a sealed robot testing arena. Waves of hostile droids spawn
around you, and scattered among them are stranded civilians. You move with one
hand and shoot with the other — the two are completely independent, so you can
back-pedal while laying down fire — clearing every destructible droid to advance
to the next wave while grabbing as many civilians as you can along the way.

The arena is one fixed screen (640 × 480) with solid walls. Nothing scrolls,
nothing is off-screen: every threat is visible, and the challenge is entirely
about positioning inside a shrinking amount of safe space.

## Mechanics

### The player

- Moves in eight directions at a constant `PLAYER_SPEED` (diagonals are
  normalised, so moving diagonally is not faster).
- Fires automatically, in the aimed direction, at a fixed cadence
  (`FIRE_INTERVAL`). There is no fire button — pressing an aim key *is* firing.
- Dies on contact with any droid or enemy bullet. Starts with `START_LIVES`
  lives and earns an extra one every `EXTRA_LIFE_EVERY` points.
- After dying (with lives left) the current wave is rebuilt from scratch and the
  player respawns in the centre with `RESPAWN_INVULN` seconds of invulnerability,
  drawn as a flickering shield ring.

### The droids

| Droid | Behaviour | Bullets | Score |
|---|---|---|---|
| **Grunt** (red) | Walks straight at you, with a small sideways wobble so a pack fans out instead of stacking into one dot. Gets faster every wave up to a cap. | Destroyed by one hit | 100 |
| **Sentry** (violet) | Drifts slowly toward a wandering anchor point and fires a slow aimed shot every `SENTRY_FIRE_INTERVAL` seconds. | Destroyed by one hit | 200 |
| **Hulk** (steel) | Indestructible. Moves along one axis at a time, changing direction on walls or on a timer. Tramples any civilian it touches. Your bullets only knock it back a little. | Immune | — |

A wave is cleared when every *destructible* droid (grunts and sentries) is gone.
Hulks are ignored for that check — otherwise a wave with a hulk could never end.
Clearing a wave immediately spawns the next one, with more grunts, more sentries
and (from wave 2) more hulks.

### Civilians

Civilians wander randomly and are rescued by walking into them. Rescues are worth
an escalating 1000 → 2000 → 3000 → 4000 → 5000 points; the chain caps at 5000 and
resets at the start of every wave (and when you lose a life). Hulks trample
civilians, so a rescue chain is a race against the hulks.

### Spawning

Droids and civilians spawn at random points inside the arena walls but never
closer than `MIN_SPAWN_DIST` to the player, so a wave can never start with an
instant death. Per-wave counts:

- grunts: `6 + 2 × wave`, capped at 26
- hulks: `floor(wave / 2)`, capped at 4 (so wave 1 has none)
- sentries: `1 + floor((wave − 2) / 2)` from wave 2 on, capped at 5
- civilians: `max(2, 5 − floor((wave − 1) / 3))`

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move (eight directions) |
| `←` `↑` `→` `↓` | Shoot in that direction |
| `Space` | Start / restart |
| `P` | Pause / resume |

Move and aim are on separate key groups, which is what makes it a twin-stick
game on a keyboard.

## Code structure

`game.js` is a single classic (non-module) script, matching the rest of this
repo, so every piece of state and logic is reachable from the Playwright tests
as a plain global.

- **Constants** — arena geometry, speeds, radii, scoring, wave shape.
- **State** — `state` (`idle` / `running` / `paused` / `over`), `score`, `lives`,
  `wave`, `highScore`, `rescueIndex`, plus the `player` object and the
  `bullets`, `enemyBullets`, `enemies`, `humans`, `particles` and `popups`
  arrays. `particles` are the debris of an explosion; `popups` are the floating
  score numbers a rescue leaves behind.
- **Spawning** — `spawnWave(n)` plus `spawnGrunt/​spawnHulk/​spawnSentry/​spawnHuman`,
  which take explicit coordinates so tests can build exact scenarios.
- **`step(dt)`** — the whole simulation for one slice of time: input → player →
  firing → droid AI → bullets → collisions → wave/life bookkeeping. It is a pure
  function of the game state and `dt`, so the tests can advance the game
  deterministically without touching `requestAnimationFrame`.
- **`draw()`** — all rendering; never mutates game state (only the particle list
  is aged, and that happens in the frame loop, not in `draw`).
- **Frame loop** — `frame(t)` measures real elapsed time, clamps it to 50 ms to
  survive tab switches, and calls the same `step(dt)` the tests use.

Collision detection is circle-vs-circle throughout (`hits(a, b, ra, rb)`), which
is both cheap and forgiving to play against at these entity sizes.

## Assumptions

These were ambiguous in the brief; the simpler reading was taken in each case and
recorded here.

1. **Branch naming.** The task asked for a branch named after the game
   (`droid-arena`), but this session is also required to push to a fixed
   designated branch. Development happens on `droid-arena` and the finished work
   is pushed to the designated branch, so both constraints hold.
2. **"Novel" game idea.** Read as *not already present in this repo*, not as
   *never made before*. Droid Arena is an original take on the twin-stick arena
   shooter; the repo has no arena shooter, and its nearest neighbours (Asteroids,
   Centipede, Galaga) are all single-axis or momentum-based.
3. **Death behaviour.** Losing a life rebuilds the current wave instead of
   leaving the survivors in place. That is simpler to reason about, matches the
   arcade games this borrows from, and avoids a respawn into an unwinnable board.
4. **Aiming.** Keyboard only — no mouse aim. Four aim keys give eight directions
   when combined, which is enough, and it keeps the game playable with one hand
   on each side of the keyboard.
5. **Hulks and wave clear.** Hulks are permanent for the wave and do not block
   wave completion.
6. **Scoring during a hulk trample.** A trampled civilian is simply removed — no
   penalty beyond the lost rescue value.
7. **Persistence.** Only the high score is persisted (`localStorage`, key
   `droid-arena-best`), matching the other games in this repo.
