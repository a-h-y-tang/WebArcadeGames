# Soda Tapper — Design

## Concept

You are the bartender of a four-lane soda bar. Thirsty customers file in from the
left end of each bar and walk steadily toward you. Slide a frosty mug down the
lane to push a customer back; keep pushing until they are shoved off the end of
the bar, satisfied and served. Every customer that reaches your end of the bar
grabs you by the collar and costs a life — and so does every mug that shatters on
the floor, whether it ran off the far end of an empty lane or came back as an
empty and you were not standing there to catch it.

Clear a whole wave of customers and the next round starts: more customers, and
they walk faster.

## Board

The canvas is 720 x 480. Four horizontal bars are stacked vertically, lane 0 at
the top. Each bar runs from `BAR_LEFT` (70) to `BAR_RIGHT` (650); the bartender
stands just to the right of `BAR_RIGHT` and can only occupy one lane at a time.

```
lane 0  |=====================================|  (bartender here)
lane 1  |=====================================|
lane 2  |=====================================|
lane 3  |=====================================|
        ^ customers enter                    ^ mugs are poured
```

## Mechanics

**Customers.** A customer enters at the left end of a lane and advances right at
`BASE_CUSTOMER_SPEED + 4 * (level - 1)` px/s. A customer whose leading edge
reaches `GRAB_X` (620) grabs the bartender: the customer is removed and a life is
lost.

**Pouring.** Pressing the serve key slides a full mug from `BAR_RIGHT` down the
bartender's current lane at `MUG_SPEED` (260 px/s) leftward. A short
`POUR_COOLDOWN` (0.18 s) and a per-lane cap of `MUGS_PER_LANE` (4) keep the key
from being spammed into a solid wall of glass.

**Drinking and push-back.** A full mug that overlaps a customer is consumed: the
customer enters the `drinking` state for `DRINK_TIME` (0.8 s), then sends an empty
mug back toward the bartender at `EMPTY_SPEED` (180 px/s) and staggers `PUSHBACK`
(110 px) to the left. A customer pushed left of `BAR_LEFT` is **served** — they
leave happy and score `SCORE_SERVE` (150).

**Queued drinks.** A mug that catches a customer who is *already* drinking is not
wasted: it is queued (`customer.queued`) and becomes their next round the moment
the current one is finished, with its own empty and its own shove. This is what
makes stacking two or three mugs into one lane a real tactic — it is the only way
to out-push a customer on the later levels — and the price is a burst of empties
all coming home at once. A customer served while still holding queued rounds
sends those empties back as they go, spaced out down the bar, so a mug poured is
always an empty owed and stacking mugs onto a nearly-served customer is never
free.

**Empties.** An empty mug travelling right is caught for `SCORE_CATCH` (50) if the
bartender is standing in its lane once it enters the catch zone — the near stretch
of bar from `CATCH_X` (555) to `BAR_RIGHT` (620), painted brighter than the rest.
Otherwise it sails past the end and shatters, costing a life. The zone is 65 px
wide, about a third of a second: enough that a player can plan a route between
lanes, which a single-frame catch line would not allow.

**Runaway mugs.** A full mug that reaches `BAR_LEFT` without meeting a customer
falls off the far end of the bar and shatters, costing a life.

**Losing a life.** All mugs and empties in flight are swept away (pending queued
drinks with them), any customer already at the bartender's end is removed, and the
remaining customers stagger back by `PUSHBACK`, clamped so nobody is shoved off
the far end of the bar. At zero lives the game is over and the best score is written
to `localStorage` under `sodatapper-best`.

**Waves.** Level *n* spawns `4 + 2n` customers on a timer that shortens as the
level rises. When every customer of the wave has been spawned and the bar is
completely clear of customers, mugs and empties, the level is complete:
`LEVEL_BONUS` (500) is scored and the next wave begins.

## Controls

| Input | Action |
|---|---|
| `↑` / `W` | Move up one lane |
| `↓` / `S` | Move down one lane |
| `Space` / `Enter` | Pour and slide a mug (also starts/restarts the game) |
| `P` | Pause / resume |

## Code shape

`game.js` is a single classic (non-module) script, matching Gold Runner,
BurgerTime and Snake in this repo: every piece of state and every helper is a
plain global, so the Playwright specs can reach them directly. All motion is
expressed in pixels per second and advanced through `step(dt)`, and the
requestAnimationFrame loop only calls `step` when `autoStep` is true. Tests set
`autoStep = false` and drive `step(dt)` themselves, which makes every simulation
result exact rather than timing-dependent.

Lane choice for spawning uses a small seeded LCG (`setSeed`, `rand`) rather than
`Math.random`, so a spec can pin a wave to a known sequence of lanes.

## Balance

The tuning above was settled by running scripted players against the simulation
rather than by eye. Three findings shaped it:

- **The catch zone had to be widened.** At its first size the window on a
  returning empty was 0.11 s, which made pouring more than one mug at a time a
  guaranteed death and flattened the game into a one-mug treadmill.
- **Mugs had to survive meeting a drinking customer.** Before queued drinks
  existed, a second mug slid straight past a drinking customer and smashed, so
  the only survivable strategy was one mug per lane — and since a fixed shove
  cannot out-pace a customer who walks faster every level, play plateaued into
  an endless score farm that never advanced.
- **The speed ramp was softened** from +6 to +4 px/s per level, so difficulty
  comes from more customers arriving faster rather than from customers who
  outrun the mechanic outright.

A player who counts the drinks already committed to a lane before pouring another
now reaches level 5 or 6 and serves around fifty customers, and loses to customers
reaching the bar rather than to wasted glassware.

## Assumptions

These points were ambiguous; the simpler reading was taken in each case.

- **Branch name.** The task asks for a branch named after the game
  (`soda-tapper`), but this session is configured to develop and push on
  `claude/compassionate-ramanujan-3k7734`. The session's designated branch wins,
  since pushing anywhere else is explicitly disallowed.
- **Pouring is one press, one mug.** The original arcade game has you hold the
  tap to fill a mug and release to slide it. A single keypress producing a single
  full mug is simpler to play and to test; the cooldown and per-lane cap stand in
  for the filling time.
- **Catching is automatic.** An empty mug is caught simply by the bartender being
  in that lane, with no separate catch input.
- **No tips, no bonus round.** The arcade original scatters tip coins and has a
  "guess which can was shaken" interlude. Both are omitted; scoring is serves,
  catches and the level bonus.
- **One customer type.** Customers differ only in the lane they walk down and the
  speed the level gives them.
- **Push-back is a fixed distance.** Rather than modelling a customer's drink
  capacity, each mug consumed pushes a customer back a fixed 110 px, so a
  customer takes two to five mugs depending on how far they had walked.
- **Life loss does not reset the wave.** The level continues with the customers
  still on the bar; only the glassware is cleared.
