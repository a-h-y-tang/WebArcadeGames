# Tapper — Design

## Concept

Tapper is a lane-based service arcade game inspired by the 1983 Bally Midway
cabinet. You are a bartender working **four bars at once**. Thirsty customers
push in through the doors at the far (left) end of each bar and shuffle toward
the taps. You stand at the tap end and slide full mugs down whichever bar you
are standing at. A customer who catches a mug is knocked back toward the door
while they drink; push them all the way out and they slide their **empty mug**
back down the bar — catch it or it smashes on the floor.

Every mistake costs a life: a mug nobody catches, an empty you let slide past,
or a customer who reaches the tap and grabs you. Serve enough customers and the
next level starts, with a thirstier, faster crowd.

## Mechanics

- **The bar room** is a 640×400 canvas holding `BARS` (4) horizontal bars. Each
  bar runs from `BAR_LEFT` (the door) to `TAP_X` (the taps), and `barY(lane)`
  gives the y of that bar's counter surface.
- **Pouring.** `pourMug()` puts a full mug at the tap end of the bartender's
  current bar, travelling left at `mugSpeed()`. Pours are rate-limited by
  `POUR_COOLDOWN` (0.25 s) so the bar can't be flooded with a single keypress.
- **Serving.** A full mug that slides within `REACH` of a customer in the same
  bar is grabbed by the **rightmost** such customer (the one nearest the tap).
  That customer switches to `drinking`, scores `servePoints()`, and slides back
  toward the door at `PUSHBACK_SPEED` for `DRINK_TIME` seconds. A drinking
  customer who has not been pushed out by the time their drink runs out starts
  advancing again — so a stubborn regular may need several rounds.
- **Departures.** A customer pushed past `BAR_LEFT` leaves: they score
  `leavePoints()`, count toward the level, and send an **empty mug** back down
  their bar at `emptySpeed()`.
- **Empties.** An empty mug is caught when it reaches `CATCH_X` *and* the
  bartender is standing at that bar, scoring `tipPoints()`. Otherwise it is
  flagged `past` and smashes when it leaves the right-hand edge.
- **Losing a life** happens three ways: a full mug reaches the door end
  uncaught, an empty mug smashes, or an advancing customer gets within
  `GRAB_DIST` of the tap. Any of these clears **all** bars and mugs and restarts
  the flow of customers. Losing the last life ends the game.
- **Arrivals.** A repeating `spawnTimer` calls `autoSpawnCustomer()`, which
  picks the emptiest bar that still has room (`MAX_PER_LANE`, 3) and a clear
  doorway (`SPAWN_CLEAR`), so customers never spawn on top of each other.
- **Levels.** Serving `CUSTOMERS_PER_LEVEL` (6) customers clears the level:
  `level` increases, the bars are wiped clean, and a bonus life is awarded up to
  `MAX_LIVES` (5).
- **Scoring.** Points scale with the level, so late levels pay far better.
  The best score is persisted in `localStorage` under `tapper-best`.

### Difficulty scaling (all derived purely from `level`)

| Quantity         | Formula                                            |
|------------------|----------------------------------------------------|
| `mugSpeed`       | `MUG_BASE + (level-1) * MUG_STEP`                   |
| `emptySpeed`     | `EMPTY_BASE + (level-1) * EMPTY_STEP`               |
| `customerSpeed`  | `CUST_BASE + (level-1) * CUST_STEP`                 |
| `spawnInterval`  | `max(SPAWN_MIN, SPAWN_BASE - (level-1)*SPAWN_STEP)` |
| `servePoints`    | `SERVE_POINTS * level`                              |
| `leavePoints`    | `LEAVE_POINTS * level`                              |
| `tipPoints`      | `TIP_POINTS * level`                                |

Because these are pure functions of `level`, the simulation is fully
deterministic given the level and the player's input — which is what makes the
Playwright tests reliable.

## Controls

| Input             | Action                          |
|-------------------|---------------------------------|
| ↑ / W             | Move up one bar                 |
| ↓ / S             | Move down one bar               |
| Space             | Pour a mug (start / restart when not playing) |
| Click the canvas  | Pour a mug                      |
| P                 | Pause / resume                  |

## Code structure

`game.js` is a single classic (non-module) script, matching Kaboom, Dino Run and
Tetris in this repo, so every piece of state is reachable from Playwright as a
plain global.

- **Constants** — geometry, timings and the difficulty curve, all at the top.
- **State** — `state` (`idle` / `running` / `paused` / `over`), `score`, `best`,
  `level`, `lives`, `served`, plus the `bartender`, `mugs`, `customers` and
  cosmetic `splashes` arrays.
- **Simulation** — `substep(h)` advances customers first, then mugs, resolving
  serves, catches and smashes; `step(dt)` slices `dt` into fixed 1/240 s
  sub-steps so a fast mug can never tunnel through a customer, then refreshes
  the HUD.
- **Flow** — `startGame()`, `loseLife()`, `nextLevel()`, `endGame()`,
  `togglePause()`.
- **Rendering** — `draw()` paints the room, a glow marking the bartender's
  current bar, the counters and taps, then customers, mugs, the bartender,
  sparkles and the "served" meter. Rendering never mutates game state, so the
  tests can call `draw()` directly.
- **Input & boot** — key handlers, the Start button, and a
  `requestAnimationFrame` loop that calls `step(dt)` then `draw()`.

## Determinism & testing

Tests drive the game by calling `startGame()`, placing customers and mugs
exactly where they want them (`spawnCustomer({ lane, x })`,
`spawnEmpty({ lane, x })`, `pourMug()`) and then calling `step(dt)` — never by
waiting on wall-clock frames. The only randomness in the game is
`autoSpawnCustomer()`'s choice of bar and the cosmetic sparkle velocities;
tests that need a quiet bar simply set `spawnTimer` to a large value, and no
assertion depends on a random draw.

Run them from the repository root:

```powershell
npx playwright test Tapper/tests/
```

## Assumptions

These choices were made where the brief was open-ended; the simpler option was
taken each time and recorded here:

- **Branch name.** The task asked for a branch named after the game
  (`tapper`), but this session is pinned to the branch `claude/loving-euler-8oanh5`
  and must not push anywhere else, so the work was developed there instead. The
  game folder still carries the game's name.
- **Discrete bars, not free movement.** The bartender snaps between four fixed
  bars rather than sliding along a rail. It is simpler to reason about, simpler
  to test, and matches how the original plays.
- **A lost life clears every bar.** Rather than modelling per-bar recovery, any
  mistake wipes all mugs and customers and restarts the flow of arrivals. This
  keeps the failure path in one place (`loseLife()`).
- **No thrown-mug juggling or bonus rounds.** The original has tipping
  customers, a bonus "guess the can" round and mugs that can be caught in
  mid-air. Those are omitted; the core pour / push / catch loop is the game.
- **Customers only ever move horizontally**, and a drinking customer is pushed
  back at a constant speed rather than a knockback impulse with friction.
- **One customer per mug.** A full mug is always taken by the customer nearest
  the tap in that bar; mugs never pass a customer to reach one further away.
- **Bonus life per level**, capped at 5. The original's bonus schedule is more
  elaborate; one-per-level is the simple version.
- **Mouse click also pours**, so the game is playable without a keyboard.
