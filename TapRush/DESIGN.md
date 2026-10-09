# Tap Rush — Design

## Concept

Tap Rush is a single-screen arcade game about running a four-lane bar during a
rush. Thirsty patrons shoulder their way in from the right end of each counter
and walk steadily toward the bartender. The bartender stands at the left end of
the bar and can only be in one lane at a time. Pour a mug and it slides down the
counter; a patron who catches one stops to drink and is shoved back toward the
door. Patrons who have had their fill wander out — and slide their empty mug
back down the counter, which the bartender has to catch before it falls off the
end and smashes.

The tension comes from the three ways the bar can go wrong at once:

* a patron reaching the bartender (you got cornered),
* a poured mug sliding off the far end of the counter (you wasted a mug), and
* an empty mug falling off the near end (you were in the wrong lane).

All three cost a life, and you only have three. Every lane therefore competes
for the bartender's attention: pouring into lane 0 is also a decision not to be
in lane 3 when an empty arrives there.

## Mechanics

### Layout

* Canvas is 640 × 480, fixed size, no scaling.
* `LANE_COUNT = 4` counters. Lane `i` occupies `LANE_TOP + i * LANE_H` and its
  centre line is `laneY(i)`.
* `BAR_LEFT = 96` is the serving end (where a poured mug appears and where an
  empty must be caught); `BAR_RIGHT = 604` is the door end (where patrons enter
  and leave).
* The bartender is drawn at `BARTENDER_X = 54`, left of the bar, and occupies a
  lane rather than a free position — moving is a lane change, not a walk.

### Entities

`patrons`, `mugs` (full, sliding right) and `empties` (empty, sliding left) are
three flat arrays. Every entity carries its `lane` and its `x`; `y` is derived
from the lane at draw time, so nothing can drift between lanes.

A patron is `{ lane, x, thirst, phase, timer }` where `phase` is one of:

| phase | behaviour |
|---|---|
| `advancing` | walks left at `PATRON_SPEED` (scaled by level) |
| `drinking` | frozen for `DRINK_TIME` after catching a mug |
| `leaving` | walks right at `LEAVE_SPEED`, exits at `BAR_RIGHT` |

### Serving

* `pour()` puts a full mug at `BAR_LEFT` in the bartender's lane, subject to
  `POUR_COOLDOWN` (0.22 s) so a single frame cannot emit a stack of mugs.
* A full mug slides right at `MUG_SPEED`. When it comes within `CATCH_DIST` of an
  `advancing` patron in the same lane, the patron catches it: `thirst` drops by
  one, the patron is knocked back `KNOCKBACK` px (clamped to `BAR_RIGHT`) and
  switches to `drinking` for `DRINK_TIME`. The mug is consumed.
* When the drink finishes, a patron with `thirst` left goes back to `advancing`;
  a patron at `thirst` 0 switches to `leaving` and slides an empty mug back down
  the counter from its own position.
* A full mug that passes `BAR_RIGHT` smashes: **−1 life**.
* An empty mug slides left at `EMPTY_SPEED`. At `BAR_LEFT` it is caught if the
  bartender is in that lane (score +`EMPTY_POINTS`); otherwise it keeps going and
  smashes at `BAR_LEFT - CATCH_WINDOW`: **−1 life**.
* An `advancing` patron that reaches `CORNER_X` (just past the serving end) has
  cornered the bartender: the patron is removed and **−1 life**.

Each of the three ways to lose a life sets `lastLoss` and drops a labelled splat
on the canvas — `MUG SMASHED!`, `EMPTY DROPPED!` or `CORNERED!` — so the mistake
is always legible at a glance.

### Waves

`wave` holds `{ remaining, timer, interval, thirst }`. A level queues
`4 + 2 * level` patrons, released one at a time on `interval` seconds into a
lane chosen by a seeded pseudo-random generator, so a given level always plays
out the same way. Patron thirst for the level is
`min(3, 1 + floor((level - 1) / 2))` — one mug per patron for levels 1–2, two for
3–4, three from level 5 on. Patron walking speed scales by
`1 + 0.08 * (level - 1)` and the spawn interval shrinks, so later waves press
from several lanes at once.

When the queue is empty and no patrons, mugs or empties are left on the bar, the
wave is complete: the player banks `WAVE_BONUS * level`, the state becomes
`wavecomplete` for `WAVE_PAUSE` seconds, then the next level starts. Lives carry
over and are never refilled.

### Scoring

| event | points |
|---|---|
| patron catches a mug | 25 |
| patron leaves the bar | 75 |
| empty mug caught | 25 |
| wave cleared | 200 × level |

Best score is kept in `localStorage` under `taprush-best`.

### Simulation

Everything runs through `physicsStep(dt)` on a fixed `DT = 1/120` timestep,
accumulated from `requestAnimationFrame`. `physicsStep` also refreshes the HUD,
so the DOM stays in sync even when the animation loop is frozen. The test suite
sets `autoRun = false` and calls `physicsStep` itself, which makes every rule
above directly and deterministically observable. Game state is deliberately kept
in top-level `let`/`const` bindings (`state`, `score`, `lives`, `level`,
`bartender`, `patrons`, `mugs`, `empties`, `wave`) because the Playwright suite
drives the game through exactly those names.

## Controls

| input | action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | move the bartender up one lane |
| <kbd>↓</kbd> / <kbd>S</kbd> | move the bartender down one lane |
| <kbd>Space</kbd> | pour a mug (and start the game from the title screen) |
| <kbd>P</kbd> | pause / resume |
| click <kbd>Start</kbd> | start or restart |

Holding a movement key repeats every `MOVE_REPEAT` (0.16 s). Lane movement is
clamped at both ends — it does not wrap.

## Balance

A scripted player that always chases the nearest empty, pours only when no mug
is already on its way to a patron, and never idles clears seven waves in about
four minutes before wave 8 (thirst 3, patrons ~47 px/s, one every 1.15 s) corners
it. Human play is slower than that, so the first real pressure lands around wave
3, when patrons start wanting a second mug.

## Assumptions

These were ambiguous; the simpler reading was taken each time and recorded here.

1. **Branch name.** The task asked for a branch named after the game
   (`tap-rush`), while this session's standing instructions pin all development
   and pushes to `claude/compassionate-ramanujan-ylmw4g`. The standing
   instruction wins: the work lives on that branch, and `tap-rush` is only the
   game's identifier (`TapRush/`, id `tap-rush`).
2. **Pouring is a tap, not a hold.** The arcade original fills a mug while the
   handle is held and the mug's size depends on the pour. Here one key press
   yields one full mug, with a short cooldown instead of a fill meter.
3. **Lane movement snaps.** The bartender changes lanes instantly rather than
   walking between them, so a lane is always unambiguous for catching.
4. **A knocked-back patron is never pushed out of the door.** Knockback is
   clamped to `BAR_RIGHT`; only a fully served patron leaves. A patron cannot be
   "served" by force.
5. **One shared bartender, no per-lane tap positions.** Mugs always appear at
   `BAR_LEFT`, the same x for every lane.
6. **A cornering patron is removed.** The original restarts the whole wave when a
   patron reaches you. Here the patron is simply removed along with the life, so
   the wave keeps its progress.
7. **Patron lanes are seeded, not random.** A level's spawn order comes from a
   seeded generator keyed on the level number, so replaying level 3 gives the
   same wave. This keeps the game fair and the tests meaningful.
8. **No sound.** The repo's other games are silent; this one is too.
