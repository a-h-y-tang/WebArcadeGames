# Tapper — Design

## Concept

**Tapper** is a single-screen arcade game about being the fastest bartender in
town. Four bar counters run across the screen. Thirsty customers push in from
the right-hand end of each bar and shuffle toward you. You stand at the taps on
the left, slide full mugs down the counters to knock them back, and catch the
empties they send rolling back before they hit the floor.

Let a customer reach the taps, spill a mug off the far end, or smash an empty
and you lose one of your three bartenders. Clear a shift's worth of customers
and the next shift arrives — more of them, and thirstier.

Nothing else in this repo plays like it: it is a lane-management reaction game
where the same lane carries traffic in *both* directions, so the pressure comes
from deciding which lane deserves your attention right now.

## Screen layout

```
      x=60   x=90                                             x=600
        |      |                                                 |
 lane 0 |  🍺  ==========================================   👤 👤  |
 lane 1 |      ==========================================         |
 lane 2 |      ==========================================         |
 lane 3 |      ==========================================         |
        taps   BAR_LEFT                                  BAR_RIGHT
```

* Canvas is 640 × 460, four lanes of 96 px starting at y = 60.
* `TAP_X` (60) is where the bartender stands; `BAR_LEFT` (90) is the left end of
  the counter — mugs are poured there, and it is the line where customers grab
  you and where empties are caught or smashed.
* `BAR_RIGHT` (600) is the swing door: customers walk in there and served
  customers are pushed back out through it.

## Mechanics

### Pouring and serving

* `pour()` puts a full mug at `BAR_LEFT` in the bartender's current lane. Pours
  have a short cooldown (`POUR_COOLDOWN`, 0.18 s) so a held key cannot carpet a
  lane in a single frame.
* Full mugs slide right at `MUG_SPEED` (300 px/s).
* A full mug that touches the leftmost customer in its lane is consumed. That
  customer is shoved back toward the door (`PUSH_BACK`, 120 px, travelled at
  `PUSH_SPEED`) and then stands still drinking for `DRINK_TIME` (0.7 s) before
  resuming the walk toward you.
* A shove that carries a customer past `BAR_RIGHT` **serves** them: `+100`
  points, and they slide an *empty* mug back down that lane.
* A full mug that reaches `BAR_RIGHT` without hitting anyone is spilled — one
  life.

### Empties

* Empty mugs travel left at `EMPTY_SPEED` (230 px/s) and ignore customers.
* When an empty reaches `BAR_LEFT`, it is caught if the bartender is standing in
  that lane (`+50` points); otherwise it smashes — one life.

### Customers

* Customers walk left at `levelSpeed()` = `CUSTOMER_SPEED × (1 + 0.18 × (level − 1))`.
* Within a lane a customer never walks *through* the one ahead of it: while
  walking left its x is clamped to the customer ahead plus `CUST_SPACING`. The
  clamp applies only to walking, not to being shoved, so a shove can briefly
  overlap the queue behind — a deliberate simplification (see Assumptions).
* A customer reaching `BAR_LEFT` grabs the bartender — one life.

### Lives, shifts and scoring

* Three bartenders (`LIVES_START`). Losing one clears the screen — every
  customer, full mug and empty — and the shift resumes with a fresh spawn timer.
* A shift (level) asks for `quotaFor(level)` = `4 + 2 × level` customers served
  (six on level 1). The level advances only once the quota is served *and* the
  screen is clear, so a returning empty must be dealt with before the next
  shift begins.
* Each shift spawns faster (`spawnInterval` shrinks by 0.25 s per level, floor
  0.9 s) and its customers walk faster.
* Score is `100` per customer served, `50` per empty caught. The best score is
  kept in `localStorage` under `tapper-high`.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | move up one bar |
| `↓` / `S` | move down one bar |
| `Space` | pour a mug (also starts / restarts the game) |
| `P` | pause / resume |
| Start button | start, restart, or resume from pause |

## Code structure

`game.js` is a plain classic script (no modules, no build step) so that
`index.html` opens straight from the filesystem and so that Playwright can reach
every top-level binding through `page.evaluate`.

* **State** — `state` (`idle` / `running` / `paused` / `over`), `score`,
  `lives`, `level`, `served`, `quota`, `player`, and the three entity arrays
  `customers`, `mugs` (full, moving right) and `empties` (moving left).
* **`step(dt)`** is the whole simulation and is deterministic: the animation
  frame loop only computes `dt` and calls it, so tests drive the game by calling
  `step(0.016)` in a loop instead of waiting on wall-clock time. `step` returns
  immediately unless `state === 'running'`.
* Order inside `step`: pour cooldown → full mugs (movement, collisions, spills)
  → empties (movement, catch/smash) → customers (shove, drink, walk, serve,
  grab) → spawning → level completion. Any life lost aborts the rest of the
  frame, because losing a life clears every array.
* **`draw()`** is pure rendering and reads no state it does not own; nothing in
  the simulation depends on it, so headless tests never need a rendered frame.
* Randomness goes through a small seeded LCG (`rand()`, `seedRng(n)`) so spawn
  patterns can be made repeatable in a test.

## Testing

`tests/tapper.spec.js` drives the real page through Playwright. Tests place
entities directly (`spawnCustomer(lane, x)`), pump `step(0.016)`, and assert on
game state and on the HUD's DOM. Written before the implementation: the whole
suite was red first, then made green.

## Assumptions

Decisions taken without asking, per the "pick the simpler interpretation" rule:

1. **Branch name.** The task asked for a branch named after the game
   (`tapper`), but this session is required to develop and push on
   `claude/compassionate-ramanujan-qh3lth`. The required branch wins; the game
   folder carries the name instead.
2. **No bonus rounds.** The arcade original has a "pick the unshaken can"
   bonus stage between levels. Skipped — it is a separate minigame and adds
   nothing to the core loop.
3. **No tip dancers.** In the original, serving a customer can drop a tip that
   distracts customers when collected. Skipped for the same reason.
4. **One bar theme.** The original changes decor per level (saloon, sports bar,
   punk club, space bar). Here the decor is fixed and only the difficulty
   changes.
5. **Shoves may overlap the queue.** Anti-overlap clamping applies to walking
   customers only. Making shoves push the whole queue would need chained
   collision resolution for a case players rarely notice.
6. **Customers never turn around.** A customer walks left, drinks, then walks
   left again; there is no wandering.
7. **Empties pass under customers.** A returning empty is never blocked by a
   customer standing in the lane.
8. **A lost life clears the whole screen**, not just the offending lane. It is
   the more forgiving reading and keeps the recovery moment readable.
9. **`game-browser` e2e counts.** The browser's e2e spec hard-codes the number
   of game cards (105) and was already out of date against `games.json` (108).
   Adding Tapper makes 109, and the spec was updated to that real count.
