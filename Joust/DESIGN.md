# Joust — Design Notes

## Concept

Joust is a flap-to-fly combat arcade game on an HTML5 canvas. You ride a flying
mount over a lava-floored arena dotted with stone platforms. Enemy riders share
the sky; you defeat them by colliding **from above** — the higher rider wins the
joust. A defeated enemy drops an egg; grab the egg before it hatches into a fresh
enemy. Clear every enemy (and egg) to advance to the next, tougher wave. Touch
the lava, or lose a joust, and you lose one of your three lives.

## Mechanics

### Flap physics

Motion is expressed in pixels-per-millisecond and pixels-per-millisecond², so it
is frame-rate independent (the same approach the other games in this repo use).

- **Gravity** pulls the mount down every frame.
- **Flapping** (a discrete key press) subtracts a fixed impulse from the vertical
  velocity, capped at a maximum rise speed. Repeated flaps let you climb or hover;
  stop flapping and you sink.
- **Horizontal** movement accelerates toward a maximum speed while a direction key
  is held and coasts to a stop with friction when released.
- The arena **wraps horizontally**: fly off one side and you reappear on the other,
  exactly like the original.

### Platforms & lava

Stone platforms are solid from above: while falling you land on the first platform
your feet cross and horizontally overlap, stopping your descent. Walking off an
edge drops you back into free flight. The bottom of the arena is **lava** — if the
mount's feet reach the lava line you lose a life and respawn.

### The joust

When you overlap an enemy, the outcome is decided purely by **who is higher**,
measured by sprite centre:

| Situation | Outcome |
|---|---|
| You are clearly higher (`COMBAT_THRESHOLD` px) | **Win** — enemy defeated, an egg drops, you score |
| The enemy is clearly higher | **Lose** — you lose a life and respawn |
| Heights are within the threshold | **Bounce** — both riders are knocked apart, nobody is defeated |

This single, symmetric rule is the whole combat system, which keeps it both
readable and fully testable.

### Eggs

A defeated enemy leaves an egg that falls until it rests on a platform. Touch it to
collect it for points. Leave it too long (`HATCH_TIME`) and it hatches into a new
enemy that rejoins the wave. An egg that falls into the lava is simply lost.

### Waves & scoring

- Defeating an enemy scores `ENEMY_POINTS`; collecting an egg scores `EGG_POINTS`.
- A wave is cleared when **no enemies and no eggs remain**. The next wave increments
  the wave counter and spawns more enemies (up to a cap).
- The best score is saved to `localStorage` under `joust-best`.

### Lives & game over

You start with **3 lives**. Losing a joust or touching the lava costs one life and
respawns the mount on the central platform. When the last life is gone the game
ends and the game-over overlay shows the final score.

## Controls

| Action | Keys |
|---|---|
| Flap (fly up) | **Space**, **↑**, or **W** |
| Move left / right | **←** / **→** or **A** / **D** |
| Start | **Space**, an arrow key, or the **Start** button |
| Pause / resume | **P** |

## State model

`state` is one of `idle`, `running`, `paused`, `over`. The main loop only advances
the world while `running`. `step(dt)` is the deterministic testing seam the
Playwright suite drives directly; `flap()`, `resolveCombat()`, `combatOutcome()`
and `spawnWave()` are the other seams the tests exercise. Tests place the player,
enemies and eggs directly (as the Doodle Jump and Breakout suites do) so the
enemy AI can stay lively in real play without making assertions flaky.

## Assumptions

- **Canvas 700×500 (landscape).** A flight arena reads better wide than tall or
  square; the value is asserted in the tests as a stable contract.
- **Combat is decided by centre height alone.** The simpler of the readings — no
  facing, momentum or lance-length factors — so a single comparison covers every
  case and each outcome is a direct function of two positions.
- **Enemy AI is deliberately simple and seeded.** Enemies drift toward the player
  and flap to gain height on a fixed cadence, driven by a seeded RNG so play varies
  but the logic is deterministic. Tests never depend on AI behaviour; they position
  entities directly.
- **Eggs hatch on a fixed timer once landed; lava-bound eggs are lost.** This keeps
  the egg lifecycle a single timer plus a collect/into-lava terminal, with nothing
  frame-timing-dependent to assert.
- **One mount type, no "pterodactyl" boss.** The classic game adds an
  invulnerable-except-from-one-angle boss on later waves; it is out of scope here
  to keep the combat rule uniform. Difficulty scales through enemy count and speed
  instead.
