# Soda Tapper — Design

## Concept

Four bars run left to right across a single canvas. Thirsty patrons come in
through the door at the far (left) end of each bar and walk steadily toward the
tap at the near (right) end, where the bartender stands. The bartender hops
between bars and slides mugs of soda down them. A patron who catches a mug
stops to drink and is shoved back down the bar while they do; push a patron
clean off the far end and they are served — but they send their empty mug
sliding back, and that has to be collected at the tap or it smashes on the
floor.

The tension is that every action creates the next problem: pouring a mug means
committing to that bar, and serving a patron means an empty is now racing back
toward a tap the bartender has probably already left.

## Mechanics

### The bar

- 4 bars (`LANES`), each spanning `BAR_LEFT` (48) to `BAR_RIGHT` (584).
- The bartender occupies one bar at a time and always stands at the tap end.
- Patrons stand *behind* the counter; mugs slide along the top of it.

### Pouring

- `serve()` puts a full mug on the bartender's current bar at the tap end; it
  slides toward the far end at `MUG_SPEED` (230 px/s).
- The tap has a `SERVE_COOLDOWN` of 0.18 s, so holding the key down pours a
  steady stream rather than a solid wall of mugs.
- A mug that reaches the far end without being caught is a spill: **life lost**.

### Patrons

- A patron walks toward the tap at `patronSpeed()`, which rises with the round
  and is capped (`PATRON_SPEED_CAP`, 64 px/s) well below `MUG_SPEED`, so a
  poured mug can always catch up with the patron it was aimed at.
- When a mug overlaps a walking patron, the patron nearest the tap takes it —
  the front of the queue is always served first.
- Drinking lasts `DRINK_TIME` (1.2 s) and pushes the patron back at
  `PUSH_SPEED` (95 px/s), about 114 px per mug. A patron who arrives at the tap
  end therefore needs roughly five mugs to be pushed back out of the bar.
- A patron pushed past the far end is **served**: `SERVE_POINTS`, and an empty
  mug starts sliding back toward the tap.
- A patron who reaches the bartender grabs them: **life lost**.

### Empty mugs

- Empties slide back toward the tap at `EMPTY_SPEED` (190 px/s).
- The bartender collects one automatically when it is within `CATCH_ZONE`
  (64 px) of the tap *and* they are standing on that bar — the catch zone is
  drawn on the bar so the window is visible.
- An empty that passes the tap uncollected smashes: **life lost**.

### Rounds

- Round *n* lets in `waveSize()` patrons (6, +1 per round, capped at 14) at
  `spawnInterval()` seconds apart (2.6 s, −0.18 s per round, floor 1.0 s).
- New patrons go to the emptiest bar that has room at the far end
  (`QUEUE_GAP`), picked with a small seeded LCG rather than `Math.random` so a
  game can be replayed exactly by fixing the seed. `startGame()` seeds from the
  clock, so ordinary play still varies; the specs never depend on which bar a
  patron picks, only on the spacing rules.
- A round is complete when every patron has been let in and the bar is empty of
  patrons, mugs and empties. That is worth `LEVEL_BONUS` (500) and a short
  breather before the next round.

### Lives

- Three lives. Losing one freezes play for `DYING_TIME` (1.6 s) and shows what
  went wrong, then wipes the bar and sends everyone still waiting back to the
  far end, so play always resumes from a survivable position. Round progress
  (how many patrons have already been let in) is kept.
- At zero lives the game ends and the best score is written to `localStorage`
  under `sodatapper-best`.

### Scoring

| Event | Points |
|---|---|
| Patron catches a mug | 25 |
| Patron served | 120 |
| Empty mug collected | 60 |
| Round cleared | 500 |

## Controls

| Input | Action |
|---|---|
| `↑` / `↓`, `W` / `S` | Move the bartender up or down a bar |
| `Space` | Pour a mug down the current bar |
| Click a bar | Move there and pour (pointer shortcut) |
| `P` | Pause / resume |
| `Space` / `Enter` | Start, or play again after game over |

## Code structure

Single classic (non-module) script, matching BurgerTime, Kaboom! and Snake in
this repo:

- `index.html` — HUD, canvas (640×480) and the overlay used for the title,
  pause, round-clear and game-over screens.
- `style.css` — the shell around the canvas; all gameplay is drawn on canvas.
- `game.js` — constants, state, `step(dt)`, `draw()` and input handling, all as
  top-level globals.

`step(dt)` applies every motion in units per second and is the only place state
advances; `frame()` merely calls `step(dt)` then `draw()`. Because of that the
Playwright specs can call `step(1/60)` themselves and get identical results on
every run. Two flags exist purely for the tests: `spawnEnabled` switches the
patron queue off so a spec only sees the patrons it places, and `loopEnabled`
switches `requestAnimationFrame` stepping off so nothing races the spec.

Drawing order puts patrons behind the counter and mugs on top of it:
room → doorways → patrons → bartender → counters → empties → mugs → taps →
splashes → banner.

## Testing

`tests/sodatapper.spec.js` drives the page with Playwright: 63 specs covering
the idle screen, starting, bartender movement, pouring and the tap cooldown,
patrons catching/drinking/being served, empty mugs and the catch zone, every
way a life is lost, round progression and difficulty curves, pause, the stored
best score, and that `draw()` runs without throwing in every state.

Run them with:

```powershell
npx playwright test SodaTapper/tests/
```

## Assumptions

Ambiguities were resolved toward the simpler reading and recorded here:

- **Branch name.** The task asked for a branch named after the game
  (`soda-tapper`), but this session is required to develop and push on its
  designated branch `claude/loving-euler-e3vgxs`. The designated branch wins;
  the game folder and games.json id carry the game's own name.
- **Catching empties is automatic.** The arcade original made the player press
  a button to grab a returning mug. Here, standing on the right bar while the
  empty is inside the drawn catch zone is enough — one fewer key to fight with,
  and the difficulty already comes from being on the *wrong* bar.
- **Only served patrons return an empty.** A patron who is merely drinking does
  not throw a mug back; the empty appears when they are pushed off the end.
  This keeps the number of returning mugs equal to the number of patrons served.
- **A death does not cost round progress.** Patrons already let in are sent
  back to the door rather than removed, and `spawned` is untouched, so a fumble
  costs a life and position but never leaves a round unfinishable.
- **Difficulty plateaus.** Patron speed, wave size and spawn interval all clamp
  (levels ~9 and up are equally hard). An arcade game that eventually becomes
  literally impossible is less interesting than one where the score chase is
  about stamina.
- **Fixed geometry.** The canvas is a fixed 640×480 and scales with CSS rather
  than laying out responsively, as in the other games here.
- **No audio.** No game in this repo ships sound, so this one does not either.
