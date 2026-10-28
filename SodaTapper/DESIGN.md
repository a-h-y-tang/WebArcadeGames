# Soda Tapper — Design

## Game concept

Soda Tapper is a single-screen lane game. Four bar counters run left to right
across the playfield. Patrons come in through the doorway at the left end and
walk steadily toward the taps at the right end, where the player stands. The
player picks a lane and pours a mug; the mug slides *left* down that counter
until it reaches the patron nearest the taps, who starts drinking and is pushed
back toward the door. Push a patron past the door and they are served.

The twist that makes the game more than "shoot the lane" is that every mug comes
back. A patron who finishes a drink slides the empty mug back *right* along the
counter, and the player has to be standing in that lane to catch it. So each pour
creates two obligations in two directions, and a careless extra mug is as
expensive as an unserved patron.

Three mugs (lives), waves of increasing size and speed, one score, best score
kept in `localStorage`.

## Playfield and geometry

| Constant | Value | Meaning |
|---|---|---|
| `W` × `H` | 640 × 560 | canvas size in CSS pixels |
| `LANE_COUNT` | 4 | bar counters |
| `LANE_TOP` / `LANE_GAP` | 80 / 120 | lane 0 centre, and the spacing below it |
| `BAR_LEFT` | 44 | the doorway end of a counter |
| `TAP_X` | 556 | where a freshly poured mug appears |
| `SERVER_X` | 598 | where the player stands, behind the taps |
| `GRAB_X` | 530 | a patron reaching here takes a life |
| `CATCH_X` | 508 | an empty mug can be caught from here on |
| `SHATTER_X` | 572 | ...and smashes once past here |
| `PATRON_HALF` / `MUG_R` | 11 / 9 | half-width of a patron, mug radius |
| `HIT_DIST` | 20 | mug-to-patron gap that counts as a delivery |

`laneY(i)` is the only thing that maps a lane index to pixels, and `laneFromY(y)`
inverts it for mouse input. Everything else — patrons, mugs, the player — stores
a lane *index*, never a y coordinate, so a lane can never be half-occupied.

## Mechanics

### Speeds and timings

| Constant | Value | Meaning |
|---|---|---|
| `MUG_SPEED` | 185 px/s | a full mug sliding toward the door |
| `EMPTY_SPEED` | 150 px/s | an empty mug sliding back to the taps |
| `PUSH_SPEED` | 110 px/s | a drinking patron being pushed back |
| `PUSH_TIME` | 0.75 s | how long one mug keeps a patron drinking |
| `POUR_COOLDOWN` | 0.25 s | minimum gap between two pours |
| `PATRON_SPEED_BASE/STEP/MAX` | 26 / 5 / 70 px/s | patron walking speed by wave |
| `SPAWN_BASE/STEP/MIN/JITTER` | 2.6 / 0.18 / 0.9 / 0.6 s | gap between arrivals |
| `QUOTA_BASE/STEP/MAX` | 5 / 2 / 15 | patrons per wave |
| `MAX_PER_LANE` | 3 | patrons allowed in one lane at once |

One mug therefore buys `PUSH_SPEED × PUSH_TIME ≈ 82 px` of ground, while the full
length of a counter is `GRAB_X − BAR_LEFT = 486 px`: a patron spotted late needs
several mugs, which is what makes ignoring a lane expensive.

### The state machine

`state` is one of `idle`, `running`, `paused`, `waveclear`, `gameover`. Space, a
click on the bar, a click on the overlay and the Start button all funnel through
`advance()`, which does whatever the current state asks for next: start a game,
start the next wave, restart after a game over, or — while running — pour.

### One simulation step

`physicsStep(dt)` runs on a fixed `1/120 s` timestep and does nothing unless
`state === 'running'`. The order inside a step is fixed and the tests rely on it:

1. run the pour cooldown down,
2. `updateSpawning` — maybe let a new patron in,
3. `updateMugs` — move every mug, then resolve what it ran into,
4. `updatePatrons` — push the drinkers back, walk the rest forward,
5. `updateSplashes` — age out the cosmetic sparkles,
6. `checkWave` — is the wave over?

After any step that costs a life the function re-checks `state` and bails out, so
a game that ends mid-step cannot keep simulating.

### Mugs

A mug is `{ lane, x, dir, full }` and moves only along its lane. A **full** mug
(`dir === -1`) looks for the patron in its lane nearest the taps within
`HIT_DIST`; finding one consumes the mug and starts that patron drinking. Reaching
`BAR_LEFT` without finding anyone smashes it and costs a life.

An **empty** mug (`dir === +1`) is caught the moment it is at or past `CATCH_X`
*and* the player is standing in its lane — a 64 px window, about 0.43 s, which is
the whole skill in catching. Past `SHATTER_X` it smashes and costs a life.

### Patrons

A patron is `{ lane, x, state, pushTimer, owed }`, where `state` is `advancing`
or `drinking`.

- **advancing**: walks right at `patronSpeed(wave)`. Reaching `GRAB_X` removes the
  patron and costs a life; it does *not* count toward the wave's served tally.
- **drinking**: moves left at `PUSH_SPEED` while `pushTimer` runs down. Crossing
  `BAR_LEFT` serves them — points, `servedThisWave++`, and their empty mug is left
  on the bar. If the timer runs out first they go back to advancing and send the
  empty back from wherever they stand.

`owed` is a 0-or-1 flag rather than a counter: a mug delivered to a patron who is
already drinking tops them up — it buys another `PUSH_TIME` of push — but they
still send back only one empty. That keeps "one empty per patron per drink" true
no matter how hard a lane is hammered.

### Waves

A wave is a quota of arrivals (`waveQuotaFor(wave)`), released on a timer with
`rng()` jitter into a lane picked from the ones that are under `MAX_PER_LANE` and
whose doorway is clear by `SPAWN_CLEARANCE`. That spawn rule is the only thing
keeping patrons from stacking on each other, and it is tested directly.

The wave ends when the last arrival has been released *and* the bar holds no
patrons and no mugs — whether they were all served or some of them got through.
Finishing pays `WAVE_BONUS × wave`, and the next wave starts on Space with the
score and remaining lives intact.

### Randomness

Everything random goes through a seeded mulberry32 `rng()`, so `seedRng(n)`
replays an identical wave; the page itself seeds from the clock on load. The test
suite uses this both for reproducibility and for a two-minute soak run that
asserts no patron, mug, life or score ever leaves its legal range.

## Rendering

`draw()` paints, back to front: room and doorway, the four counters (with a
spotlight on the player's lane), the tap column, mugs, patrons, the player, the
splash sparkles, and a footer strip showing lives as spare mugs and the wave's
serve progress. Nothing in the draw path mutates game state, so a test can call
`draw()` in any state — including states the player cannot normally see — purely
to check it does not throw.

Patrons bob as they walk (`sin(x)` off their own position, so it is deterministic
rather than clock-driven) and tip the mug back while drinking. Lane colour is
taken from `LANE_COLORS[lane]`, which keeps the four lanes legible at a glance.

## Testing

`tests/soda-tapper.spec.js` drives the real page over `file://`. The pattern that
makes this deterministic: set `autoRun = false` to stop the animation loop from
advancing the simulation, push the exact patrons and mugs the test cares about
onto `patrons`/`mugs`, then call `physicsStep(1/120)` a known number of times.
Groups cover the idle page and HUD, starting, lane movement, pouring and the tap
cooldown, full-mug travel and smashes, deliveries and top-ups, serving, catching
and dropping empties, patrons reaching the taps, lives and game over, pausing,
spawning (including determinism under a fixed seed), waves and difficulty curves,
the HUD, rendering, a soak run, and the repo/game-browser integration.

## Assumptions

Decisions taken without asking, resolved toward the simpler reading:

1. **Branching.** Development happened on the game-named branch `soda-tapper` as
   the task asked, but the commits are pushed to this session's designated remote
   branch `claude/compassionate-ramanujan-pj61ww`, which the session rules pin.
2. **A wasted full mug costs a life**, as in the arcade game this borrows from.
   It is what stops the game from being "hold Space in every lane", so it is a
   rule rather than a penalty-free miss.
3. **A patron who reaches the taps costs a life and is removed**, rather than
   resetting the whole wave as the arcade original does. Losing the life is
   punishment enough and keeps the wave readable.
4. **One empty mug per drink** (the `owed` flag above), rather than one per mug
   delivered. Returning an empty for every top-up punished exactly the play the
   game asks for.
5. **Lane movement is one lane per key press**, with no key-repeat sweep. Mouse
   movement, which jumps straight to a lane, covers the case where a player wants
   to cross the bar quickly.
6. **No bonus round or tip jar.** The arcade original breaks up its waves with a
   shell-game bonus screen; waves here run straight on from one to the next.
7. **Waves run forever**, getting faster up to `PATRON_SPEED_MAX` and bigger up
   to `QUOTA_MAX`, with no victory screen — the run ends when the lives do.
8. **`autoRun` test hook.** The animation loop only advances the simulation while
   the global `autoRun` is true. The game never changes it; the test suite sets it
   to `false` to place patrons by hand and step physics deterministically.
9. **Canvas is fixed at 640 × 560** with no responsive scaling, matching the
   fixed-size canvases used by the other games in this repo.
