# Kaboom! — Design

## Concept

A single-screen reflex arcade game inspired by the Activision classic *Kaboom!*.
A "Mad Bomber" paces back and forth along the top of the screen, dropping bombs.
The player controls a vertical stack of buckets at the bottom and slides it left
and right to catch every bomb before it hits the ground. Miss one and the whole
stack goes up in smoke — lose a bucket and the round restarts. Clear a full wave
of bombs and the bomber speeds up for the next, faster wave.

## Mechanics

- **The bomber** moves horizontally at the top, bouncing off the left/right
  walls. It periodically reverses direction at random and releases a bomb from
  its current position on a fixed cadence.
- **Bombs** fall straight down at the current wave's fall speed. A bomb is
  *caught* the instant its bottom reaches the bucket line while its centre lies
  within the horizontal span of the bucket stack. A bomb is *missed* when it
  falls past the bottom of the screen uncaught.
- **Buckets / lives.** The player starts with 3 buckets. Every catch scores
  points (higher waves are worth more per bomb). A single miss costs one bucket,
  clears all bombs currently on screen, and resumes the same wave. When the last
  bucket is lost the game is over.
- **Waves.** Each wave contains a fixed number of bombs (`BOMBS_PER_WAVE`).
  Catching the whole wave (no miss) advances to the next wave: bombs fall faster
  and the bomber paces faster, and per-bomb points increase.
- **Scoring.** Catching a bomb adds `wave` points. `Best` persists in
  `localStorage`.

## Controls

- **Left / Right arrows** (or **A / D**): slide the bucket stack.
- **Mouse move** over the canvas: the bucket stack centres on the pointer.
- **Space / Start button**: begin a game (and restart after game over).

The bucket stack is clamped so it never leaves the play field.

## Testable core

The game logic is written as plain top-level functions and mutable state so a
Playwright test can drive it deterministically without relying on the animation
loop or randomness:

- State: `state` (`'idle' | 'playing' | 'over'`), `bombs`, `bomber`, `paddleX`,
  `buckets`, `score`, `best`, `wave`, `spawnedThisWave`, `caughtThisWave`.
- Pure helpers: `paddleLeft()`, `paddleRight()`, `bombCaught(bomb)`,
  `fallSpeed()`, `bomberSpeed()`.
- Steppers: `dropBomb()`, `stepBombs(dt)`, `stepBomber(dt)`, `movePaddle(dx)`,
  `update(dt)`.
- Lifecycle: `resetGame()`, `startGame()`.

Tests place bombs, move the paddle, and call the steppers with a fixed `dt`
instead of waiting on `requestAnimationFrame`, so every assertion is
deterministic.

## Assumptions

- **Simpler miss rule.** In the original, missing a bomb detonates the entire
  remaining group. Here a miss costs exactly one bucket and clears the screen —
  the simpler, more predictable interpretation.
- **Bucket stack as one paddle.** The three-bucket stack is modelled as a single
  wide paddle rather than three independently-shrinking catch zones; losing a
  bucket narrows the stack's height visually but the catch span is constant.
  This keeps catch detection to a single interval test.
- **Fixed bombs per wave.** Each wave has a fixed bomb count rather than the
  escalating group sizes of the arcade original, chosen for predictability.
- **Deterministic testing over randomness.** The bomber's random direction
  changes only affect visuals/feel; all scoring-relevant logic (drop position,
  fall, catch, miss) is deterministic given inputs, so tests never depend on RNG.
- Canvas is a fixed 480×640; no responsive scaling.
