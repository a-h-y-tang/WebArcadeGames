# Canyon Raider — Design

## Game concept

A vertically scrolling flight shooter set in a winding river canyon. You fly a
jet upstream at a fixed screen row while the canyon streams past beneath you.
The rock walls are lethal, so is anything moored or hovering in the water lane,
and the tank drains the entire time — the only way to keep flying is to skim the
fuel depots floating in the river. Every section of the canyon is sealed by a
bridge: blow it up and the next section opens, faster and busier than the last.

Nothing else in this repo pairs a procedurally generated, endlessly scrolling
playfield with a resource (fuel) that forces you to fly *towards* danger. Moon
Patrol and Frostbite scroll sideways over fixed layouts; Galaga and Space
Invaders are single-screen shooters. Here the canyon itself is the main
opponent: it narrows, meanders and drops obstacles in the only gap you have.

## World model

The canyon lives in a **world** whose y axis grows in the direction of flight.
`scroll` is how far the world has slid past the bottom of the canvas, so:

```
screenY(worldY) = CANVAS_H - (worldY - scroll)
planeWorldY()   = scroll + (CANVAS_H - PLANE_Y)
```

Everything in the canyon (banks, ships, depots, bridges, bullets) stores a world
y, so scrolling is a single number per frame — nothing has to be nudged
individually, and the tests can place an object "160 px ahead of the plane"
without caring where the camera happens to be.

The river is a list of **rows**, one per `ROW_H` (16 px) of world, each holding
the `left` and `right` bank x. Row *i* covers world y `[i·16, (i+1)·16)`, so
`riverBoundsAtWorld()` is a division and an array lookup. Rows are generated
lazily but never discarded, which keeps row *i* meaning the same thing for the
whole run (and lets a test compare `rows.slice(0, 60)` between two seeded runs).

| Constant | Value | Meaning |
|---|---|---|
| `CANVAS_W` / `CANVAS_H` | 480 / 640 | canvas size |
| `ROW_H` | 16 px | one generated slice of river |
| `MIN_RIVER_W` / `MAX_RIVER_W` | 110 / 330 px | river width bounds |
| `BANK_MARGIN` | 12 px | minimum rock thickness on each side |
| `PLANE_Y` | 560 | screen row the plane is pinned to |
| `SECTION_ROWS` | 110 | rows between bridges |
| `LOOKAHEAD` | 480 px | canyon kept generated above the view |

## Canyon generation

Generation is a random walk with inertia. The generator holds a *target* centre
and width; every 22–60 rows it picks new ones, and each row eases towards them by
at most `MAX_CENTER_DRIFT` (0.5 px) and `MAX_WIDTH_DRIFT` (1.0 px). Slow drift is
what makes the canyon flyable: at 190 px/s the plane covers ~12 rows a second, so
a wall can never close in faster than you can steer away from it. Width and
centre are then clamped so the banks stay inside `BANK_MARGIN` and the river
stays between `MIN_RIVER_W` and `MAX_RIVER_W`.

Every `SECTION_ROWS`-th row is a **bridge row**: the generator straightens the
river (centre back to the middle, a comfortable width) and spawns a bridge that
spans the full canvas.

Randomness is a small mulberry32 PRNG so a seed reproduces a canyon exactly —
`startGame(seed)` is what the tests use. Terrain and entity placement draw from
**two separate streams** (`terrainRng`, `entityRng`): skipping an enemy spawn
near a respawn must never shift the shape of the river, so the terrain stream is
never consulted for anything but banks.

## Mechanics

### Flying

- The plane holds a fixed screen row and steers left/right at `PLANE_SPEED`
  (260 px/s), clamped to the canvas.
- The throttle (`↑`/`↓`) changes `scrollSpeed` at `THROTTLE_RATE` (150 px/s²)
  between `MIN_SPEED` 120 and `MAX_SPEED` 320. Speed is both risk and reward:
  distance climbs faster, but so does fuel burn, and the walls arrive sooner.
- Collision with a bank is checked along the whole fuselage (`worldY ± PLANE_H/2`
  in half-row steps), so you cannot clip a corner by sitting between two rows.

### Fuel

`fuel` starts at `MAX_FUEL` (100) and burns at `FUEL_BURN · (scrollSpeed /
BASE_SPEED)` per second — full throttle costs about 1.7× cruise. Overlapping a
depot refills at `FUEL_REFILL` (42/s), capped at full. Running dry is a crash.
Depots are the one thing in the river you can safely touch, which is the central
tension: they sit in the water lane, so refuelling means lining up with an
obstacle instead of dodging it, and a depot you shoot for points is a depot you
cannot drink from. Below `LOW_FUEL` (25) the HUD gauge flashes red and a pulsing
`LOW FUEL` warning appears on the canvas, where your eyes already are.

### Weapons

`Space` fires a bullet from the nose, up to `MAX_BULLETS` (6) in the air. Bullets
climb the *screen* at a constant `BULLET_SPEED`, which in world terms means
`BULLET_SPEED + scrollSpeed` — otherwise opening the throttle would appear to
slow your own shots. A bullet stops at the first thing it overlaps: one bullet,
one target.

| Target | Score | Notes |
|---|---|---|
| Gunboat (`ship`) | 30 | patrols left/right between the banks |
| Helicopter (`chopper`) | 60 | patrols faster |
| Fuel depot (`fuel`) | 80 | shooting it forfeits the refuel |
| Bridge | 500 | clears the section; the next one runs faster |

Patrolling entities bounce off the banks: after moving, an entity that has pushed
past `riverBoundsAtWorld(e.worldY)` is placed back against the bank and its
velocity flipped, so nothing ever patrols through rock.

### Crashes and respawns

A crash (wall, gunboat, helicopter, bridge, or an empty tank) costs a life, stops
the scroll, and burns for `RESPAWN_DELAY` (1.2 s). On respawn the plane is placed
in the centre of the river with a full tank, and the stretch ahead is swept:
entities within `CLEAR_AHEAD` (520 px) are removed and no new ones spawn until
you have flown past that point. The same sweep gives the start of a run a
`START_SAFE` (700 px) run-up. Without it a respawn could drop you straight back
into the gunboat that killed you. A bridge that falls inside a sweep is simply
never built, so you coast through that section boundary without a toll — a small
consolation prize for having just died.

With `START_LIVES` (3) gone the run ends, the best score is written to
`localStorage` under `canyon-raider-best`, and the overlay reports the final
score, section and distance.

### Difficulty

Two dials move with `section`: spawn density (`0.06 + section·0.008`, capped at
0.11) and patrol speed (`×(1 + section·0.08)`). Clearing a bridge also nudges
`scrollSpeed` up by 8 px/s, so sections get quicker even if you never touch the
throttle.

## Controls

| Key | Action |
|---|---|
| ← / → (or A / D) | Steer |
| ↑ / ↓ (or W / S) | Throttle up / down |
| Space | Fire — and start or restart a run |
| P | Pause / resume |

## Code layout

| File | Contents |
|---|---|
| `index.html` | HUD (score, best, lives, section, distance, fuel gauge), canvas, overlay, help line |
| `style.css` | Canyon-toned palette, HUD/overlay layout, fuel gauge |
| `game.js` | Everything else, as one classic script |
| `tests/canyonraider.spec.js` | 47 Playwright specs |

`game.js` is a plain (non-module) script, matching Slime Volley, Kaboom and
Tetris in this repo: `state`, `plane`, `rows`, `entities`, `bullets`, `fuel`,
`score` and the functions below are globals, so a test can drive the game with
`page.evaluate` and no test-only hooks in the shipped code.

Simulation entry points:

- `step(dt)` — advance the world. Clamps `dt` to 50 ms and splits it into
  sub-steps of at most 1/120 s so a fast bullet cannot tunnel through a thin
  target. Returns immediately unless the run is `running` (or `crashed`, where it
  only ticks the respawn timer and the explosion).
- `tick(dt)` — one sub-step: throttle, scroll, generate, steer, burn fuel, move
  entities and bullets, resolve collisions.
- `draw()` — canyon, entities, bullets, plane, particles. Purely a function of
  state; the frame loop is the only thing that calls it on a timer.

The renderer's scenery (rock boulders) uses a *stateless* hash of the row index
rather than the PRNG, so boulders stay put as the canyon scrolls and drawing
never perturbs generation.

## Testing

Test-driven: `tests/canyonraider.spec.js` was written and committed red before
`game.js` existed, then the implementation was built until all 47 specs passed.
Coverage:

- idle screen, HUD defaults, `localStorage` best score
- starting a run: seeded canyon reproducibility, plane placed inside the river
- canyon invariants: every generated row is inside the canvas and within the
  width bounds, rows generate ahead of the plane, scroll advances
- controls: steering (direct and via arrow keys), canvas clamping, throttle
  limits, bullet limit, bullet flight and expiry, pause freezing the world
- fuel: burn, refuel, cap, gauge width, running dry
- combat: each target type's score and destruction, one-bullet-one-target,
  patrol containment, bridges advancing the section
- crashes: wall, gunboat, bridge, frozen scroll, safe respawn, life counter,
  game over, best-score persistence
- restarting from the game-over overlay

Tests that are not *about* crashing (the throttle limits, for instance) keep the
plane centred and the canyon clear so a stray gunboat cannot make them flaky.

## Assumptions

The scheduled task that produced this game left a few things open. Choices made,
per the "pick the simpler interpretation" instruction:

1. **Branch name.** The task asked for a branch named after the game
   (`canyon-raider`), but this session is also required to develop and push only
   on its designated branch `claude/loving-euler-cs4kbf`. The designated branch
   wins; no `canyon-raider` branch was created.
2. **DESIGN.md vs design.md.** The repo README asks each game for a `design.md`;
   the task asked for `DESIGN.md`. Every existing game uses `DESIGN.md`, so this
   file matches its neighbours.
3. **No islands.** The classic river-shooter formula includes mid-river islands
   that split the channel. Bank-to-bank rivers with a widely varying width give
   the same "pick a gap" pressure with a much simpler collision model, so islands
   were left out.
4. **Depots are safe to touch.** In the arcade original, flying into a fuel
   depot destroys you; here, flying over one refuels. Refuelling by collision is
   simpler to teach, simpler to test, and makes shooting a depot a real
   trade-off rather than a free 80 points.
5. **Enemies do not shoot back.** The canyon walls, the fuel clock and the
   patrol traffic already supply the pressure; return fire would need a second
   projectile system for little added depth.
6. **Endless, not level-based.** Sections keep coming; "winning" is a distance
   and score, tracked as a best in `localStorage`.
7. **Category.** Registered in the game browser as **Action**, alongside the
   other shooters.
