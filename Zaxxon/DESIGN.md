# Zaxxon — Design

## Game concept

Zaxxon is an isometric scrolling shooter. A fighter flies over an enemy space
fortress that slides past diagonally, and the whole game turns on one extra
dimension the other scrolling shooters in this repo do not have: **altitude**.

The ship occupies a point in three numbers — `x` across the deck, `alt` above
it, and the fixed depth plane `z = 0`. Everything else in the world approaches
along `z`. A bullet leaves the ship at the ship's own altitude, so a gun
emplacement bolted to the deck can only be shot from low down, and an enemy
fighter cruising at mid-height can only be shot by matching its height. The same
rule bites back: fly low and the deck clutter is lethal, fly high and the
fortress guns have a clean line on you.

Fuel drains the whole time. The only way to top it up is to shoot the fuel tanks
on the deck — which means descending into the dangerous layer on purpose. Each
level ends with a robot that has to be shot six times.

Four levels, three lives, one score, and the best score is remembered between
sessions.

## Projection

The world is drawn with a fixed axonometric projection — no camera, no matrices:

```
proj(x, alt, z) = {
    sx: ORIGIN_X + x + z * SKEW_X,
    sy: NEAR_Y  - z * DEPTH_Y - alt * ALT_Y,
}
```

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 480 × 640 | canvas size in CSS pixels |
| `FIELD_W` | 200 | width of the fortress deck in world units |
| `MAX_ALT` | 90 | ceiling; `alt = 0` is skimming the deck |
| `VIEW_DEPTH` | 520 | how far ahead the world is drawn |
| `ORIGIN_X` | 40 | screen x of the deck's left edge at `z = 0` |
| `NEAR_Y` | 560 | screen y of the deck at `z = 0` |
| `SKEW_X` | 0.40 | screen px right per unit of depth |
| `DEPTH_Y` | 0.62 | screen px up per unit of depth |
| `ALT_Y` | 1.50 | screen px up per unit of altitude |

Depth and altitude both push a sprite *up* the screen, which is exactly the
ambiguity the arcade game had to solve. It is solved the same way here: every
object and the ship itself cast a shadow on the deck directly below them, so the
vertical gap between a sprite and its shadow reads as height. A graduated
altitude ladder down the right-hand side of the canvas gives the exact number.

## Mechanics

### Ship

`ship = { x, alt }`. Lateral keys move it at `SHIP_SPEED` 120 units/s, clamped to
`[SHIP_HALF, FIELD_W - SHIP_HALF]`; altitude keys move it at `ALT_SPEED` 55
units/s, clamped to `[0, MAX_ALT]`. The ship never changes depth.

### The world

Every obstacle is an object `{ kind, x, z, ... }` built by `makeObject()`, which
fills in the defaults each kind needs. `objects` is kept sorted far-to-near for
drawing. An object is culled once it passes behind the ship (`z < -60`).

| Kind | Half-width | Altitude band | Shootable | Behaviour |
|---|---|---|---|---|
| `tank` | 14 | 0 – 30 | yes, 150 pts | +30 fuel when destroyed |
| `turret` | 13 | 0 – 24 | yes, 200 pts | fires every 1.6 s while within 320 of the ship |
| `plane` | 15 | `alt ± 13` | yes, 300 pts | closes on the ship at 70 units/s on top of the scroll |
| `wall` | full deck | 0 – `MAX_ALT` minus its opening | no | must be flown through its opening |
| `boss` | 45 | 0 – 70 | 6 hits, 2000 pts | fires every 1.1 s; ends the level |

### Shooting

`bullets` are `{ x, alt, z }` fired from the ship's own `x` and `alt`, travelling
forward at `BULLET_SPEED` 420 units/s. At most `MAX_BULLETS` 3 are in flight and
a shot costs `FIRE_COOLDOWN` 0.18 s. A bullet destroys an object when it is
within 16 of its depth, within `halfWidth + 4` of its lateral centre, **and its
altitude falls inside the object's altitude band**. That last clause is the whole
game: altitude is what you aim with.

### Enemy fire

A turret or the boss fires a shot aimed at where the ship is *at that moment*:
flight time is `z / SHOT_SPEED` and the shot's lateral and vertical rates are set
so it arrives there. Keep moving and it misses; sit still and it does not. A shot
hits when it reaches the ship's plane within 12 of the ship in both `x` and
`alt`.

### Fuel, crashes and lives

Fuel starts at `FUEL_MAX` 100 and drains at `FUEL_RATE` 3.2/s, so a full tank
lasts about 31 seconds — less than a level, which forces at least a couple of
descents onto the deck. A fuel tank returns `FUEL_PER_TANK` 30, capped at the
maximum.

`crash()` costs a life, refills the tank, recentres the ship and grants
`INVULN` 1.5 s of invulnerability so the ship cannot be killed twice by the same
obstacle. Fuel reaching zero is a crash. With no lives left the run ends and the
best score is saved.

### Level flow

`state` is one of `idle`, `running`, `paused`, `levelclear`, `gameover`, `won`.
A level is a fixed list of objects from `LEVEL_PLANS` — hand-authored, nothing
random, so a level is always the same fortress and the Playwright suite is
deterministic. Each plan entry carries a `gap`, the depth added since the
previous entry, which makes the layouts easy to read and to re-space.

The scroll runs at `SCROLL_BASE + (level - 1) * SCROLL_STEP` = 110, 128, 146,
164 units/s. The level ends when `objects` is empty — everything has either been
destroyed or has passed behind the ship — which is always the boss, since it is
the last entry of every plan. Clearing a level pays `LEVEL_BONUS` 1000 plus 10
per unit of fuel still in the tank; clearing level `LEVEL_COUNT` 4 wins the run.

### Simulation

`physicsStep(dt)` is the whole game tick and runs on a fixed `DT = 1/120 s`
timestep, in this order: scroll, ship, fuel, bullets, plane movement, enemy
firing, enemy shots, ship collisions, culling, timers, level check. The
animation loop only calls it while `autoRun` is true and the state is `running`,
so a test can freeze the world, place exactly the obstacle it cares about and
step the simulation by hand.

## Controls

| Input | Action |
|---|---|
| `←` / `→`, `A` / `D` | move across the deck |
| `↑` / `↓`, `W` / `S` | climb and dive |
| `Space` (tap or hold), click | start / fire / dismiss an overlay |
| `P` | pause and unpause |
| Start button | start, or continue from an overlay |

## Code layout

- `index.html` — HUD (`#score`, `#level`, `#lives`, `#fuel`, `#best`), the
  `#canvas`, the `#overlay` and its Start button, and a control legend.
- `style.css` — the dark cabinet styling the other games here use.
- `game.js` — one classic script, no modules and no build step. The state
  (`state`, `score`, `level`, `lives`, `fuel`, `ship`, `objects`, `bullets`,
  `enemyShots`) and the functions that drive it (`startGame`, `fire`,
  `physicsStep`, `makeObject`, `buildLevel`, `proj`, `crash`, `advance`,
  `togglePause`) are deliberately top-level so the Playwright suite can drive
  the simulation directly.
- `tests/zaxxon.spec.js` — the Playwright suite, written before the game.

## Assumptions

Decisions taken without asking, resolved toward the simpler reading:

1. **Branching.** Development happened on the game-named branch `zaxxon` as the
   task asked, but the commits are pushed to this session's designated remote
   branch `claude/compassionate-ramanujan-y2qlbe`, which the session rules pin.
2. **One scrolling axis.** The arcade cabinet scrolls the fortress diagonally and
   the ship holds station on screen. Here the ship holds station too, but the
   world approaches along a single depth axis and the diagonal look comes from
   the projection's `SKEW_X`. This is the simpler reading and costs nothing in
   feel.
3. **Altitude is a number, not a sprite scale.** Objects are not drawn larger as
   they approach, only moved; the deck grid supplies the depth cue. Sprite
   scaling in a hand-rolled projection reads as noise more often than as depth.
4. **Bullets travel level.** A shot keeps the altitude it was fired at forever
   instead of dropping, which is what makes "fly low to kill ground targets" a
   clean, learnable rule rather than a timing trick.
5. **Walls are never shootable** and have exactly one rectangular opening. The
   ship must fit through it whole — half a wing inside is a crash — so an
   opening is always at least 70 wide and 45 tall.
6. **Fuel is the only timer.** There is no per-level clock; running the tank dry
   costs a life rather than ending the run outright.
7. **No mid-air refuel bonus and no score multiplier.** Fixed values keep the
   scoring readable; the level bonus already rewards finishing with fuel.
8. **The deck has no holes to fall through.** `alt = 0` is a legal cruising
   altitude, just a dangerous one.
9. **`autoRun` test hook.** The animation loop advances the simulation only while
   the global `autoRun` is true. The game never changes it; the suite sets it to
   `false` to step physics deterministically.
10. **Canvas is fixed at 480 × 640** with no responsive scaling, matching the
    other games in this repo.
