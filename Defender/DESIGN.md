# Defender — Design

## Concept

A side-scrolling planetary rescue shooter. You fly a ship over a wrapping
mountain landscape defending ten humanoids from alien landers. Landers drop out
of the sky, pluck a humanoid off the ground and haul it to the top of the
screen; a lander that gets there mutates into a fast, homicidal mutant and the
humanoid is gone for good. Shoot a lander while it is carrying and the humanoid
falls — catch it with your ship and set it back down for a bonus. Clear every
alien in a wave and the next, larger wave arrives. Lose all ten humanoids and
the planet dies: every remaining lander mutates at once.

The world is 3040 px wide and wraps, while the canvas shows 760 px of it, so a
scanner strip across the top of the canvas plots the whole planet — enemies,
humanoids and your own ship — in miniature. Reading the scanner is most of the
game: the trouble is usually off-screen.

## Layout

```
+--------------------------------------------------+
|  scanner (whole 3040px world, 0.25 scale)        |  y 0..64
+--------------------------------------------------+
|                                                  |
|            sky / play field                      |  y 64..520
|      ~~~~~~~~/\~~~~~~~~ terrain ~~~~~~~          |
+--------------------------------------------------+
```

- Canvas is 760 × 520. The scanner occupies the top 64 px, the play field the
  rest.
- Terrain is a wrapping polyline sampled every 40 px, generated from a seeded
  RNG so every run gets the same recognisable planet.
- The camera keeps the ship at 40% of the screen width when it faces right and
  60% when it faces left; the offset eases across when you turn, so turning
  "looks ahead" the way the arcade original does.

## Entities

| Entity | Behaviour |
|---|---|
| Ship | Thrust-based motion with drag, wraps horizontally, clamped between the sky ceiling and the terrain. |
| Laser | Fired forwards, 900 px/s, 0.55 s life, up to 6 in flight, 0.16 s cooldown. |
| Lander | Descends towards the nearest ground humanoid, grabs it, then climbs. Fires slow aimed shots. 150 pts. |
| Mutant | A lander that reached the top. Chases the ship directly, faster and erratic. 250 pts. |
| Humanoid | `ground` → `abducted` → `lost`, or `falling` → `aboard` → `ground`. |
| Alien shot | 190 px/s aimed projectile, 4 s life. |

### Humanoid lifecycle

```
ground --(lander grabs)--> abducted --(reaches top)--> lost
   ^                          |
   |                    (lander shot)
   |                          v
   +---(lands / dropped)-- falling --(ship overlaps)--> aboard
```

Catching a falling humanoid scores 250. Carrying it down to the terrain and
releasing it (automatic when the ship flies low) scores 500.

## Mechanics

- **Waves.** Wave *n* spawns `4 + n` landers (capped at 12). Killing the last
  alien enters a 2 s `waveclear` state that pays 100 points per surviving
  humanoid, then spawns the next wave. Every third wave grants a smart bomb.
- **Smart bomb.** Destroys every alien currently on screen and awards their
  points. Three at the start.
- **Death.** Touching an alien or an alien shot costs a life; a 1.6 s `dying`
  state clears alien fire and respawns the ship mid-screen. Anything within
  130 px is caught in the blast, and the replacement ship is untouchable (and
  blinking) for 1.4 s, so a death never cascades into the next one. Out of
  lives is game over, and the best score persists in `localStorage`.
- **Bonus ships.** Every 10,000 points pays a ship and a smart bomb. Every score
  change goes through `addScore()`, so that threshold is tested in one place.
- **Planet death.** When the tenth humanoid is lost, every remaining lander
  mutates immediately and the terrain is drawn scorched red for the rest of the
  run.

## Controls

| Input | Action |
|---|---|
| ← / → (or A / D) | Thrust, and set the direction the ship faces |
| ↑ / ↓ (or W / S) | Climb / dive |
| Space | Fire (also starts the game from the title or game-over screen) |
| B | Smart bomb |
| P | Pause / resume |
| Enter | Start / resume |

## Code structure

`game.js` is a single classic (non-module) script, matching Snake, Tetris,
Kaboom! and BurgerTime in this repo, so its state and helpers are reachable
from the Playwright specs as plain globals. All motion is expressed per second
and advanced through `step(dt)`; `requestAnimationFrame` only supplies `dt` and
calls `draw()`. That split is what makes the tests deterministic — they call
`step(1/60)` in a loop instead of waiting on wall-clock frames.

Sections, in file order:

1. Constants (world, ship, aliens, scoring).
2. Seeded RNG (`setSeed`, `rand`) and the terrain generator.
3. World helpers — `wrapX`, `signedDelta`, `terrainY`, `screenX`.
4. State: `ship`, `bullets`, `alienShots`, `aliens`, `humanoids`, `particles`.
5. Update: input → ship → bullets → aliens → humanoids → collisions → wave.
6. Draw: scanner, terrain, entities, banners.
7. HUD / overlay, input handling, main loop, init.

Test seams exposed on purpose:

- `startGame()`, `nextWave()`, `spawnLander()`, `fire()`, `useSmartBomb()`.
- `spawnEnabled` — when false, `spawnWave()` creates no aliens, so a spec can
  place exactly the aliens it wants to reason about.
- `alienFireEnabled` — when false, landers never shoot, so long simulations stay
  free of stray projectiles.
- `autoStep` — when false the animation loop still draws but stops calling
  `step()`, so nothing advances between two `page.evaluate()` calls and the
  specs stop racing `requestAnimationFrame`. One spec turns it back on to check
  the game does run itself.
- `setSeed(n)` — reseeds the RNG for reproducible terrain and spawn placement.

### Ordering inside `step`

The camera is refreshed immediately after the ship moves and before the aliens
update, because a lander's "am I on screen?" test — which gates whether it may
shoot — has to agree with where the ship is *this* frame. Wave-clear is checked
last, so an alien killed by the final laser of a frame still triggers it.

### Flight feel

Horizontal flight is thrust plus exponential drag: the ship carries momentum,
which is the whole character of Defender. The climb, by contrast, drives the
vertical velocity straight at its target (`LIFT_RESPONSE`), so threading a gap
in the mountains is precise rather than a wrestling match.

## Assumptions

These were the ambiguous calls; in each case the simpler reading was taken and
recorded here rather than guessed at repeatedly.

1. **Branch name.** The task asked for a branch named after the game
   (`defender`), but this session's standing instruction designates
   `claude/compassionate-ramanujan-q3ejc5` as the branch to develop and push to,
   and forbids pushing elsewhere. The designated branch wins; the game folder
   name carries the game's identity instead.
2. **Enemy roster.** The arcade original has landers, mutants, baiters, bombers,
   pods and swarmers. This implementation keeps landers and mutants — the pair
   that carries the humanoid-rescue loop — and leaves the rest out.
3. **Hyperspace** (the random-teleport panic button) is omitted; the smart bomb
   is the only panic button.
4. **Falling humanoids always survive** the landing. The original kills them if
   dropped from above a certain height; here the drop is never fatal, so
   catching one is a bonus rather than a rescue from certain death.
5. **Vertical wrapping** does not exist — the sky has a hard ceiling and the
   terrain a hard floor, both of which the ship simply cannot pass.
6. **The scanner shows everything** at all times, with no fade or radius limit.
7. **Smart bombs are screen-scoped**, killing only aliens whose world position
   is inside the current 760 px view — not the whole planet.
8. **Terrain is decorative**, not collidable for aliens or bullets: only the
   ship is stopped by it. Alien shots and lasers pass over the mountains. The
   dimmer range drawn behind the playfield at half scroll speed is pure
   parallax and has no gameplay meaning at all.
9. **A dead planet stays dead** for the rest of the run. The arcade original
   restores the landscape on a later wave; here the run simply becomes a
   mutants-only endurance test, which is the simpler rule to state and to play.
