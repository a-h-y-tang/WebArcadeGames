# Soda Rush — Design

## Concept

A one-person soda counter under siege. Four counters run left to right across
the screen. Thirsty customers come in through the doors on the left and walk
steadily towards the fountain on the right, where the server stands. The server
can only be at one counter at a time, so the game is a lane-juggling problem:
decide which queue is closest to reaching you, slide a soda down it, and get
back in position to catch the empty glass it sends you in return.

Pushing a customer out of the door is worth points, but it immediately creates
a second obligation — an empty glass sliding back towards an unmanned counter —
so every serve makes the next few seconds busier. That tension (serving creates
work) is the whole game.

## Mechanics

### The counters

Four counters, evenly spaced, each running from a doorway on the left
(`LANE_LEFT`) to the fountain on the right (`LANE_RIGHT`). Entities are stored
as `{ lane, x }` — the lane index is the whole of the vertical position, so
collisions are a one-dimensional problem per lane.

### Customers

- Arrive at the doorway end and walk right at `customerSpeedFor(level)`
  px/s (36 on wave 1, +6 per wave, capped at 78).
- A customer that reaches `GRAB_X` (just short of the fountain) grabs the
  server: **one life lost**.
- A lane only accepts a new arrival when its left end is clear, so customers
  never spawn on top of each other.

### Sodas

- `Space` slides a soda from the tap down the server's current counter at
  `SODA_SPEED` (300 px/s), subject to a `SERVE_COOLDOWN` of 0.18 s and a limit
  of `MAX_SODAS_PER_LANE` (2) glasses in flight per counter.
- A soda is stopped by the customer **closest to the fountain** in its lane, so
  queues are served front to back and a glass never sails past somebody.
- A hit knocks that customer back `KNOCKBACK` (96 px) and freezes them for
  `DRINK_TIME` (0.55 s) while they drink. Nearer customers therefore cost more
  serves than ones caught just inside the door.
- A knockback that carries a customer past the doorway satisfies them:
  `SCORE_SATISFY` (100 points), one off the wave quota, and an empty glass is
  sent back down the lane.
- A soda that runs the whole counter without finding anyone spills:
  `SPILL_PENALTY` (25 points, never below zero). Spilling is deliberately *not*
  fatal — the two ways to die are both about neglecting a lane, not about
  wasting a glass.

### Empty glasses

- Slide right at `MUG_SPEED` (210 px/s) from the doorway.
- Caught automatically when they reach `CATCH_X` **and** the server is standing
  at that counter: `SCORE_MUG` (50 points).
- A glass that passes the fountain end unmanned smashes: **one life lost**.

### Waves

- A wave is cleared by satisfying `quotaFor(level)` customers (6 on wave 1, +2
  per wave, capped at 18).
- Clearing awards `WAVE_BONUS * level` (250 × wave), then a `WAVE_PAUSE` break
  of 1.2 s with the counters cleared before the next wave starts.
- Each wave speeds customers up and shortens the spawn interval
  (`spawnIntervalFor`: 2.1 s, −0.13 s per wave, floor 0.9 s, with ±20% jitter).

### Lives

Three lives. Losing one clears every counter, pauses for `DEATH_PAUSE` (0.9 s)
and resumes. The third loss ends the game and writes the score to
`localStorage` under `soda-rush-best` if it beats the stored best.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one counter |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one counter |
| <kbd>Space</kbd> | Slide a soda down the current counter (also starts / restarts) |
| <kbd>P</kbd> | Pause / resume |
| Start button | Start, or resume from pause |

## Code structure

Single classic (non-module) script, matching Pooyan, BurgerTime and Snake in
this repo, so every constant and helper is a plain global the Playwright specs
can read and drive.

- **Constants** — canvas and counter geometry, speeds, scoring, difficulty
  curves. The specs assert against these names rather than magic numbers, so
  tuning the game does not invalidate the suite.
- **State** — `state` (`idle | running | paused | dying | waveclear | over`),
  `score`, `lives`, `level`, `served`, plus the `customers`, `sodas` and `mugs`
  arrays and the `server` record.
- **RNG** — a seeded Park–Miller style LCG (`srand` / `rand`) so spawn order and
  jitter are reproducible; the specs seed it and assert that two runs match.
- **`step(dt)`** — the whole simulation, expressed per second. Order within a
  frame: sodas move → hits resolve → customers walk → empties slide → arrivals.
  Anything that changes `state` mid-frame (a life lost, a wave cleared) returns
  immediately, so the rest of the frame belongs to the new state.
- **`draw()`** — canvas primitives only; no image assets, so the game runs
  straight from `file://`.
- **Main loop** — `requestAnimationFrame` calls `step(dt)` then `draw()`. The
  tests never rely on it: they call `step(dt)` themselves for exact, repeatable
  frames.

## Testing

`tests/soda-rush.spec.js` — 74 Playwright specs, written before the
implementation. They cover the idle screen and HUD, starting and restarting,
lane movement, serve cooldown and per-lane limits, soda travel and spills,
customer walking, knockback and drinking, front-of-queue targeting,
satisfaction and the empty glass it sends back, catching and smashing empties,
wave quotas and bonuses, deterministic spawning, pausing, lives, game over,
best-score persistence, score popups and rendering.

Two conventions keep them stable:

- Specs that are not about spawning start the game and then set
  `spawnEnabled = false`, placing entities explicitly.
- The real `requestAnimationFrame` loop keeps running during a test, so
  anything the loop could disturb between two round trips — a
  distance-per-second measurement, or a snapshot taken during the 0.9 s death
  pause or the 1.2 s wave break — is set up, stepped and read inside a single
  `page.evaluate` call, where no background frame can interleave.

## Assumptions

Decisions made without being asked, taking the simpler reading each time:

1. **Branch name.** The task asked for a branch named after the game
   (`soda-rush`), but this session's standing instructions pin all work to the
   designated branch `claude/compassionate-ramanujan-fjoy0x`. The designated
   branch wins; the game folder carries the name instead.
2. **Original theme.** The lane-serving arcade format is the classic *Tapper*
   idea. This is an original implementation with a soda-fountain theme — no
   alcohol, no borrowed art, all sprites drawn from canvas primitives.
3. **Catching is positional, not a button.** An empty glass is caught simply by
   standing at its counter when it arrives, rather than needing a separate
   keypress. One action key keeps the game about lane choice.
4. **Spilled sodas cost points, not lives.** Three failure sources would make
   early waves punishing; a spill is a small score penalty instead.
5. **One knockback distance.** Customers are pushed back a fixed 96 px rather
   than needing a fixed number of drinks. A customer caught near the door
   leaves on the first serve; one that has walked halfway takes several — the
   difficulty comes out of the geometry rather than an extra counter.
6. **Counters reset between waves and after a death.** Any customers, sodas and
   empties still in play are cleared, so a wave always starts from a clean
   counter and a life lost is a genuine reprieve.
7. **Mug speed is constant.** Customers get faster each wave but returning
   empties do not; the rising pressure comes from arrival rate and walking
   speed, which is easier to read as a player.
8. **Pacing was tuned against a scripted bot.** A simple "serve the most
   urgent counter" bot plays five seeded games; the speeds and spawn
   intervals above are the ones that put it out around wave 5–7 after three
   to four minutes, with a do-nothing player surviving about 45 seconds.
9. **Best score only.** One `localStorage` key (`soda-rush-best`); no profile,
   no per-wave history.
