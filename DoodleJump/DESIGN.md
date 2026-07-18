# Doodle Jump — Design Notes

## Concept

Doodle Jump is a vertical, endless jumper played on an HTML5 canvas. The
character bounces automatically and forever; the player only steers left and
right. The goal is to climb as high as possible by landing on platforms,
avoiding the one hazard: falling off the bottom of the screen. The higher you
climb, the higher your score.

## Mechanics

### Auto-bounce physics

- The player is subject to constant downward gravity, expressed in
  pixels-per-millisecond² so motion is frame-rate independent (the same
  approach the other games in this repo use).
- Whenever the player is **falling** (`vy > 0`) and its feet cross the top of a
  solid platform while horizontally overlapping it, the player bounces: its
  vertical velocity is reset to a fixed upward jump velocity. Because the jump
  velocity is constant, every bounce reaches the same apex height, so the game
  is a test of steering, not timing.

### Camera & scoring

- The world scrolls only when the player climbs above a fixed **camera line**
  (40% from the top). At that point everything below is shifted down by the
  amount climbed, the player is pinned to the camera line, and the climbed
  distance is added to a running height total.
- **Score is the total climbed height** (in whole pixels). It never decreases —
  descending back down within the visible screen does not subtract from it.
- The best score is saved to `localStorage` under `doodlejump-best`.

### Platforms

New platforms are generated above the screen as the player climbs, and
platforms that scroll off the bottom are recycled. Three types keep it
interesting:

| Type | Colour | Behaviour |
|---|---|---|
| **Normal** | green | Solid, static. Standard bounce. |
| **Moving** | cyan | Solid, drifts horizontally and reverses at the screen edges. Standard bounce. |
| **Breakable** | brown | Breaks the moment you touch it — **no bounce**, you fall straight through. |

Gaps between successive platforms are randomised within a range that is always
reachable by a single jump (max jump apex ≈ 107 px; gaps stay ≤ 95 px).

### Horizontal wrap

Moving off one side of the screen wraps the player to the opposite side, exactly
like the original game.

### Game over

The run ends when the player falls below the bottom edge of the canvas
(`player.y > HEIGHT`). The game-over overlay shows the final score and offers a
replay.

## Controls

| Action | Keys |
|---|---|
| Move left / right | **←** / **→** or **A** / **D** |
| Start | **Space**, **←**, **→**, **A**, **D**, or the **Start** button |
| Pause / resume | **P** |

## State model

`state` is one of `idle`, `running`, `paused`, `over`. The main loop only
advances physics while `running`; `step(dt)` is a pure-ish function of the
current state that the Playwright tests drive directly for deterministic
assertions (the same testing seam as the other games here).

## Assumptions

- **Canvas size 400×600 (portrait).** The other games use 500×500, but a
  vertical jumper reads far better tall than square, so this game deviates
  deliberately. The value is asserted in the tests so it is a stable contract.
- **Platform generation is random, seeded from the clock at each start.** Tests
  never depend on a specific generated layout — they manipulate `player` and
  `platforms` directly (as the Breakout suite does) — so an unseeded, varied
  game and deterministic tests coexist. A fixed reachable gap range guarantees
  every generated layout is winnable in principle.
- **Breakable platforms give no bounce.** This mirrors the original game and is
  the simpler of the two plausible readings (the alternative — bounce once then
  break — needs an extra "breaking" animation state that adds nothing testable).
- **One hazard only: the floor.** No monsters, holes, or projectiles. Endless
  jumpers get their difficulty from platform spacing and moving/breakable
  platforms alone, which keeps the scope tight and the mechanics fully
  deterministic.
- **No springs / jetpacks / power-ups.** Kept out of scope to keep the physics
  a single, well-tested rule (constant-apex bounce).
