# Soda Tapper — Design

## Concept

**Soda Tapper** is a lane-juggling arcade game inspired by the 1983 coin-op
*Tapper*. You are the soda jerk behind a four-lane counter. Thirsty customers
push in through the doors on the **left** and shuffle **right** toward you. Slide
a frosty mug down a lane and the customer at the far end of it catches the drink,
staggers backward, and slides the **empty mug** back at you. Catch the empties,
serve everybody, and survive the shift.

Three ways to lose a life:

- a customer reaches the tap at the right-hand end of the counter,
- a full mug slides the whole length of an empty lane and smashes on the floor,
- an empty mug comes back down a lane you aren't standing in and smashes.

Lose all three lives and the shift is over.

## Mechanics

### The counter

The board is a **720×440** canvas holding **4 horizontal lanes**. Every lane runs
from `BAR_LEFT` (the doors, x = 60) to `BAR_RIGHT` (the taps, x = 660). The
bartender stands to the right of `BAR_RIGHT` and occupies exactly one lane at a
time. Lane *i*'s vertical centre is `laneY(i)`.

### Customers

- Customers spawn at the doors (`x = BAR_LEFT`) on a repeating timer
  (`spawnInterval()`) in a random lane whose doorway is clear, and walk right at
  `customerSpeed()`.
- At most `MAX_ACTIVE` customers are at the counter at once; while the counter is
  full, the queue outside simply waits.
- A customer that reaches `BAR_RIGHT` grabs the bartender: **lose a life**, and
  that customer is removed.

### Mugs

- Pressing **Space** pours a mug into the bartender's current lane. It appears at
  `BAR_RIGHT` and slides **left** at `MUG_SPEED`. Pouring is rate-limited by
  `POUR_COOLDOWN` seconds so the key can't be spammed into a wall of foam.
- A mug that overlaps a customer serves them: the mug disappears, the customer is
  knocked back `KNOCKBACK` pixels toward the doors, stops for `DRINK_TIME`
  seconds to drink, and the player scores `POINTS_HIT`.
- When a mug overlaps more than one customer, the **rightmost** one (the one the
  mug meets first) is served.
- A knockback that pushes a customer to `BAR_LEFT` or beyond means they leave
  happy: the customer is removed, the player scores `POINTS_SERVED`, and the
  customer slides their **empty mug** back down the lane.
- A mug that reaches `BAR_LEFT` without hitting anybody smashes: **lose a life**.
  Pouring more mugs than the crowd in a lane can absorb is therefore the main way
  a hurried player kills themselves.

### Empty mugs

- One empty comes back per customer *served* — not per mug thrown — so the
  catching workload is bounded by the level's customer count.
- An empty that reaches `BAR_RIGHT` while the bartender is standing **in that
  lane** is caught for `POINTS_EMPTY`.
- An empty that reaches `BAR_RIGHT` in **any other lane** smashes: **lose a
  life**.

### Losing a life

Losing a life clears every mug and empty currently sliding on the counter (a
clean slate to recover from) but leaves the customers where they are. When lives
reach zero the game ends.

### Levels

- Level *n* sends `customersForLevel()` = `4 + 2n` customers through the doors.
- The level is complete once every customer for that level has **spawned** and
  the counter is **empty of customers** — whether they left happy or grabbed you.
  Clearing a level awards `POINTS_LEVEL × level` bonus points, restores one life
  up to `MAX_LIVES`, and sweeps the counter clean — an empty still on its way
  back is forgiven rather than carried into the next level.
- Each level customers walk faster (`customerSpeed()`) and arrive more often
  (`spawnInterval()`), both derived purely from `level`.

### Scoring

| Event | Points |
|---|---|
| Mug connects with a customer | `POINTS_HIT` (10) |
| Customer leaves satisfied | `POINTS_SERVED` (50) |
| Empty mug caught | `POINTS_EMPTY` (25) |
| Level cleared | `POINTS_LEVEL × level` (100 × level) |

The best score is persisted to `localStorage` under `soda-tapper-best`.

## Controls

| Input | Action |
|---|---|
| ↑ / W | Move up one lane |
| ↓ / S | Move down one lane |
| Space | Start the game / pour a mug |
| Click a lane | Jump to that lane and pour |
| P | Pause / resume |

## Code structure

Three plain files, no build step, matching the rest of this repo:

- `index.html` — HUD, canvas, overlay, help text.
- `style.css` — dark arcade styling shared in spirit with the other games.
- `game.js` — a single classic (non-module) script. All state and logic live as
  top-level globals so the Playwright tests can reach them directly by name.

The simulation is a pure function of time: `step(dt)` advances everything by `dt`
seconds and `frame()` (driven by `requestAnimationFrame`) does nothing but
compute `dt`, call `step`, and draw. Tests therefore never depend on wall-clock
timing — they call `step(0.016)` in a loop and assert on the resulting state.

`step(dt)` runs, in order: pour cooldown → customers walk → mugs slide left and
resolve collisions → empties slide right and resolve catches → level-complete
check. Resolving collisions and edge events appends to a deferred "life lost"
flag rather than mutating the arrays mid-iteration, so a single frame can never
double-charge the player.

### Test-facing API

| Symbol | Purpose |
|---|---|
| `state` | `'idle' \| 'running' \| 'paused' \| 'over'` |
| `score`, `best`, `level`, `lives` | HUD values |
| `customers`, `mugs`, `empties` | live entity arrays |
| `player` | `{ lane }` |
| `startGame()`, `endGame()`, `togglePause()` | lifecycle |
| `step(dt)` | advance the simulation |
| `moveLane(delta)`, `setLane(i)` | bartender movement |
| `pourMug()` | pour, returns whether a mug was actually poured |
| `spawnCustomer(lane, x)`, `spawnMug(lane, x)`, `spawnEmpty(lane, x)` | entity factories |
| `laneY(i)`, `customerSpeed()`, `spawnInterval()`, `customersForLevel()` | derived values |
| `updateHud()` | refresh the DOM HUD |

## Assumptions

The task description left a few things open. Each was resolved toward the
simpler reading, and recorded here:

1. **Branch name.** The task asks for a branch named after the game
   (`soda-tapper`), but the session's standing instructions designate
   `claude/loving-euler-2cwoju` as the branch to develop and push to, and forbid
   pushing elsewhere without explicit permission. The designated branch wins; the
   game name is carried by the folder (`SodaTapper/`) instead.
2. **Pouring.** The arcade original has you *hold* the tap to fill a mug and
   *release* to slide it. That is modelled here as a single keypress plus a short
   cooldown — one press, one mug — which keeps the input model uniform with the
   rest of the repo's keyboard games.
3. **Customer behaviour.** In the original, a served customer drinks, advances
   again, and can be served repeatedly; there are also tip-leaving bonus rounds.
   Here a customer is a single value — an `x` position — that mugs push left and
   time pushes right, with no drinking animation state and no bonus rounds.
4. **Life loss.** The original resets the whole screen and replays an
   attract-style flourish. Here a lost life clears mugs and empties only,
   instantly, with a brief on-canvas flash; customers are left alone so the
   player cannot farm lives to wipe a crowded counter.
5. **Level completion.** Completion is keyed on *all customers for the level
   having spawned and the counter being empty*, rather than on all of them being
   served. Otherwise a customer lost to the tap would leave the level
   unwinnable.
6. **Difficulty ceiling.** `customerSpeed()` and `spawnInterval()` scale linearly
   with `level` but are clamped (`CUSTOMER_MAX`, `SPAWN_MIN`) so very late levels
   stay playable rather than becoming instantly fatal. A flawless player can
   therefore keep going indefinitely, which is the normal arcade contract.

## Balance

Two rules exist purely to keep the game *finishable*, and both were added after
an autoplaying bot found the failure they prevent. Without them the game reaches
a stable equilibrium: the crowd's forward walk exactly absorbs the knockback a
player can apply, so a level can be held indefinitely but never cleared — the
player is stuck, unable to win or lose, scoring forever.

1. **The drink pause** (`DRINK_TIME`). A served customer stops walking while they
   drink, so every mug that lands is guaranteed net backward progress rather than
   progress the customer can walk off during the next mug's flight.
2. **The crowd cap** (`MAX_ACTIVE`). Total forward pressure is bounded at
   `MAX_ACTIVE × CUSTOMER_MAX` px/s, comfortably under the knockback rate a
   player pouring steadily can apply. Without the cap the crowd simply grows
   until no pour rate can keep up.

`tests/soda-tapper.spec.js` guards both: *"steady service always pushes a
customer out of the doors"* pins rule 1, and *"a competent autoplaying bartender
clears levels"* plays a full game and fails if the equilibrium ever comes back.
