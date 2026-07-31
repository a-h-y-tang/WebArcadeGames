# BurgerTime — Design

## Game concept

A burger-building arcade platformer. Chef Pepper runs along six girder floors
connected by ladders. Walking the full width of a burger ingredient makes it
drop one floor; ingredients that reach the plates at the bottom of the screen
finish the burger. Four burgers of four ingredients each must be assembled
while hot dogs, eggs and pickles hunt the chef. A limited supply of pepper
freezes pursuers, and a falling ingredient squashes anything under it.

Clearing all four burgers advances to the next level: the same layout, faster
and more numerous enemies, and a fresh set of pepper shakers.

## Layout

```
 floor 0  ────────────────────────────────  ingredients start here
 floor 1  ────────────────────────────────
 floor 2  ────────────────────────────────
 floor 3  ────────────────────────────────
 floor 4  ────────────────────────────────  chef starts here
 floor 5  ══════════════════════════════ ═  plate row (finished burgers)
```

- Canvas is 640×560. Floor walking surfaces sit at y = 90, 170, 250, 330, 410, 490.
- Five full-height ladders at x = 22, 170, 330, 490, 618 join every floor.
- Four burger columns centred at x = 90, 250, 410, 570; each ingredient is 96 px
  wide and split into four 24 px segments the chef must walk across.
- Each column starts with bun-top / lettuce / patty / bun-bottom on floors 0–3
  and an empty plate on the plate row.

## Mechanics

**Stepping.** Whenever the chef stands on a floor and its centre is over an
ingredient segment, that segment is marked and drawn dipped. When all four
segments of an ingredient are marked, it drops.

**Falling and the push chain.** A dropping ingredient falls at 240 px/s toward
the floor below. If an ingredient is resting on that floor, it is shoved down a
floor of its own while the falling one settles on top of it. That shove can
ripple through a column, but **every ingredient moves exactly one floor per
drop** — the column shifts down as a unit rather than collapsing onto the plate
in one go. Ingredients that reach the plate row stack there and are finished:
they can no longer be stepped on or dropped.

**Enemies.** Enemies walk toward the chef on their own floor; when the chef is
on a different floor, they head for the nearest ladder that leads in the right
direction and climb it. Touching an unfrozen enemy costs a chef; the board keeps
its state but the chef and all enemies return to their starting spots and the
chef gets 1.5 s of grace. An enemy caught under a falling ingredient — including
one shoved by the push chain — is squashed for 100 points and returns after a
3 s delay.

**Pepper.** Space throws a cloud of pepper ahead of the chef (in whatever
direction it last faced). Enemies caught in the cloud freeze for 4 seconds and
are harmless to touch while frozen. Five shakers per level, restocked on each
new level.

**Scoring.** Dropping an ingredient 50, squashing an enemy 100, clearing a
level 1000. The best score is kept in `localStorage` under `burgertime-best`.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Walk along a floor |
| `↑` `↓` / `W` `S` | Climb a ladder (the chef snaps to a ladder within 14 px) |
| `Space` | Throw pepper (starts the game when idle) |
| `P` | Pause / resume |

Vertical input takes priority over horizontal so a diagonal key press still
grabs the ladder.

## Code structure

Single classic (non-module) script, matching Kaboom, Snake and Tetris in this
repo, so state and helpers are reachable from the Playwright tests as plain
globals.

- `buildBoard()` lays out the 16 ingredients and empty plates.
- `step(dt)` is the whole simulation tick: chef movement, trampling, falling
  ingredients, enemy AI, pepper clouds, collisions, enemy respawns and the
  level-clear check. Everything is expressed per-second, so tests advance the
  world deterministically with `step(0.016)` instead of waiting on
  `requestAnimationFrame`.
- `draw()` is pure rendering and holds no state.
- Test-facing helpers: `startGame`, `endGame`, `togglePause`, `setChef`,
  `moveChef`, `dropPiece`, `spawnEnemy`, `firePepper`, `nextLevel`,
  `topFloorOf`, `pieceAt`, `enemySpeed`.

Key state: `pieces` (`{col, kind, x, floor, y, segs[4], falling, onPlate}`),
`enemies` (`{x, y, floor, kind, stun, climbing, …}`), `clouds`, `plateCount`,
`chef`, plus the scalars `state`, `score`, `level`, `lives`, `peppers`, `best`.

## Assumptions

These are the judgement calls made where the brief was open-ended; each took the
simpler reading.

- **Branch name.** The task asked for a branch named after the game
  (`burger-time`), but the session's standing instruction pins development to
  `claude/loving-euler-tdcjiz`. The designated branch wins; the game name is
  carried by the folder and commit message instead.
- **Ladders are uniform.** Every ladder spans all six floors. The arcade
  original uses partial ladders for difficulty; full-height ladders keep the
  level always solvable and the collision rules simple.
- **One level layout.** Later levels reuse the layout and scale enemy speed and
  count rather than introducing new maps.
- **Push chain moves one floor.** See above. The arcade original lets a piece
  ride a stack further down; the one-floor rule is easier to reason about and
  keeps a level roughly 20 ingredient-walks long.
- **Stepping is by position, not direction.** Standing on a segment marks it;
  the chef does not have to enter it from a particular side.
- **Losing a chef keeps the burgers.** Only positions reset, so a bad run never
  undoes assembly progress.
- **Mid-ladder the chef is on no floor** (`chef.floor === -1`) and cannot step
  off sideways until it reaches a girder.
- **Frozen enemies are walk-through**, matching the arcade behaviour of pepper
  neutralising a pursuer, and they award no points.
- **No sound.** Consistent with the rest of the repo.
