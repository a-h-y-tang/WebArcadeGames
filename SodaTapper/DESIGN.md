# Soda Tapper — Design

## Game concept

Soda Tapper is a four-lane bar-service arcade game in the spirit of the 1983
coin-op *Tapper*. The player is a soda jerk working four bars at once. Thirsty
customers walk in through the doors on the left of each bar and advance steadily
toward the tap on the right. The player slides full mugs down a bar to shove the
customers back, and catches the empties they send sailing back up the bar.

The whole game is one screen of pure reaction and lane-juggling: every mug you
pour is a commitment to be back in that lane a couple of seconds later to catch
what comes home.

## Mechanics

### The bars

Four horizontal bars stacked down the canvas (600×400). Each bar runs from the
door at `LANE_LEFT = 40` to the tap at `BAR_X = 540`. The player always stands
at the tap end and only ever changes *which* bar they're standing at — there is
no horizontal player movement.

### Customers

- A customer enters at the door and walks right at `customerSpeed()` px/s.
- Getting hit by a full mug pushes them back `PUSH_BACK = 140` px and freezes
  them for `DRINK_TIME = 0.5` s while they drink.
- Pushed back to the door (`x <= LANE_LEFT`) they leave happy: **served**, worth
  `10 × wave` points.
- Reaching the tap (`x >= BAR_X`) costs a life — they got past you.

A customer starting at the door needs one mug; one that has walked most of the
bar needs four. That's the pressure curve — let someone get deep and they cost
you the whole tap for a while.

### Mugs

- `Space` (or a click) pours a full mug at the tap in the current lane, subject
  to a `POUR_COOLDOWN = 0.25` s tap cooldown.
- A full mug slides left at 300 px/s. It hits the customer **nearest the tap**
  in its lane and is consumed.
- A full mug that reaches the door end with nobody to catch it smashes on the
  floor: one life.

### Empties

- Every mug a customer drinks becomes an empty, released where they end up after
  being pushed back, sliding right at 170 px/s.
- An empty reaching the tap is caught if the player is standing at that lane
  (`5 × wave` points). If not, it smashes: one life.

### Waves

- A wave is `CUSTOMERS_PER_WAVE = 6` customers. Arrivals are spread out by
  `spawnInterval()` seconds into a lane whose doorway is currently clear.
- The wave ends when all six have been *resolved* — served or slipped past.
  Tracking "resolved" rather than only "served" matters: if the wave ended only
  on serves, a single customer walking through to the tap would leave the wave
  permanently one short, with nothing left to spawn and nothing left to do.
- Clearing a wave clears the bars, awards one bonus life (capped at
  `MAX_LIVES = 5`), and speeds customers up while shortening the gap between
  arrivals.

### Lives

Start with 3, cap at 5. Any mishap — customer at the tap, mug off the end, empty
uncaught — costs one and sweeps all loose glassware off the bars, so a mistake
doesn't instantly cascade into three more. At zero it's last call.

## Controls

| Input | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one bar |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one bar |
| <kbd>Space</kbd> | Pour a mug (also starts / restarts the game) |
| Mouse move | Move to the bar under the cursor |
| Click | Pour a mug |
| <kbd>P</kbd> | Pause / resume |

## Code structure

Three files, no build step:

- `index.html` — HUD (`#score`, `#wave`, `#lives`, `#best`), the canvas, and the
  start/pause/game-over overlay.
- `style.css` — the shared dark arcade-cabinet look used across this repo, in a
  warm bar-room palette.
- `game.js` — a single classic (non-module) script. Game state and logic live as
  plain globals so the Playwright tests can reach them directly, matching Kaboom,
  Dino Run and Tetris in this repo.

### Simulation model

All motion is expressed per-second and advanced through `step(dt)`, which runs
fixed 1/240 s sub-steps. That keeps mug/customer crossings from being skipped at
low frame rates, and — more importantly for the tests — lets a spec simulate
exact frame counts without depending on `requestAnimationFrame` wall-clock
timing. `requestAnimationFrame` only feeds `step()` a real `dt` and then draws.

Because any mishap clears the mug and empty arrays mid-scan, each phase of
`substep()` returns immediately after calling `loseLife()` rather than
continuing to iterate a list that has just been emptied.

### Test seams

The spawners (`spawnCustomer`, `spawnMug`, `spawnEmpty`) take explicit
`{ lane, x }` and skip the cooldown and state checks, so a test can lay out an
exact board. `pourMug()` is the player-facing action layered on top.
`stopSpawning()` suppresses automatic arrivals so a test can simulate several
seconds without random customers wandering into the scenario.

## Testing

`tests/sodatapper.spec.js` — 63 Playwright tests covering the initial state,
starting, bartender movement, pouring and the tap cooldown, customer walking and
arrival, serving and push-back, mug misses, empty catches, wave progression and
difficulty scaling, lives and game over, scoring and the persisted best, and
pause/restart. Written before the implementation; the wave-deadlock case above
was found by writing its test first and watching it fail.

```powershell
npx playwright test SodaTapper/tests/
```

## Assumptions

Made autonomously while building this, per the "pick the simpler interpretation"
instruction:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is under standing instructions to develop and
  push only on its designated branch, `claude/loving-euler-x63m4n`. The
  designated branch wins; no separate `soda-tapper` branch was created.
- **Game choice.** No game was marked *In Progress* in the root `README.md`, so
  this is a new game rather than a continuation. Soda Tapper was picked because
  nothing Tapper-like exists among the 111 games already in the repo.
- **Only two of the arcade original's three penalties.** The original also
  penalises serving a customer who is already leaving; that is dropped here.
  Mishaps are exactly: customer reaches the tap, mug falls off the end, empty
  uncaught.
- **No bonus/attract rounds.** The original's "spot the odd can out" bonus round
  between waves is omitted. Waves differ only in customer speed, arrival rate and
  points.
- **Every drink returns an empty**, including a hit that only pushes a customer
  partway back — not just the final mug that sends them out of the door. This is
  faithful to the original and is what makes lane-juggling the core skill.
- **A mishap sweeps the bars** of loose mugs and empties instead of ending the
  wave or resetting customer positions. Simplest rule that stops one mistake from
  cascading into several.
- **Bonus life per wave**, capped at 5 — the same shape as Kaboom's bucket bonus
  in this repo, chosen for consistency.
- **Customers never queue two-deep at a door.** Arrivals pick a lane whose
  doorway is clear rather than modelling a queue, which would need overlap
  handling for no real gameplay gain.
