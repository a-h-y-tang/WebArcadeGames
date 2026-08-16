# Root Beer Rush — Design

## Concept

A four-lane bar-service arcade game on a single HTML5 canvas. You are the only
barkeep in a saloon with four bars, and every one of them is filling up with
thirsty patrons. Slide mugs of root beer down a bar to push its patrons back
toward the door; catch the empties they slide back. Let anything hit the floor —
or let a patron reach your end of the bar — and the round costs you a life.

The tension comes from splitting attention across four lanes: pouring is free,
but every mug you pour is a mug you must eventually catch coming back, in the
right lane, at the right moment.

## Mechanics

### The bar

- Four bars (lanes), each running from `BAR_LEFT` (the far end, where patrons
  come from) to `BAR_RIGHT` (the barkeep end).
- The barkeep occupies exactly one lane at a time and can jump between adjacent
  lanes instantly. Only the lane matters — there is no horizontal movement.

### Mugs

- `Space` pours a mug into the barkeep's current lane, at the barkeep end. A
  `POUR_CD` (0.22 s) cooldown keeps a single keypress from stacking mugs.
- A full mug slides toward the far end at `MUG_SPEED`.
- If it reaches a **walking** patron (within `HIT_DIST`), the patron takes it:
  `DRINK_POINTS` are scored and the patron is shoved `PUSH_DIST` back down the
  bar.
- If it reaches `BAR_LEFT` untouched it drops off the end and costs a life. Pour
  only when someone is actually coming.

### Patrons

- Patrons enter at the far end and walk toward the barkeep at `patronSpeed(level)`.
  They queue rather than overlap: a walking patron stops `PATRON_GAP` behind
  whoever is ahead of them in the same lane.
- A served patron drinks for `DRINK_TIME`, standing still, then slides the empty
  mug back toward the barkeep and resumes walking.
- A patron pushed past `EXIT_X` leaves satisfied: `SERVE_POINTS` and the served
  counter goes up. That is the only way to make progress on the level quota.
- A patron who reaches `GRAB_X` — the barkeep's end of the bar — costs a life.

### Empty mugs

- Empties slide back toward the barkeep at `EMPTY_SPEED`.
- Reaching `CATCH_X` with the barkeep standing in that lane is a catch:
  `CATCH_POINTS`.
- Sliding past `MISS_X` with the barkeep elsewhere smashes the mug and costs a
  life.

### Levels and lives

- You start with `START_LIVES` (3) lives. Losing one clears the bars, pauses for
  `DEATH_PAUSE`, and restarts the round with the level's progress intact.
- A level asks for `levelTarget(level)` patrons (6, rising by 2 per level, capped
  at 16). It is cleared once the quota has spawned and the bars are empty of
  patrons, mugs and empties — a `LEVEL_BONUS × level` bonus is awarded and the
  next level begins after `CLEAR_PAUSE`.
- Later levels raise patron speed (`patronSpeed`) and shorten the gap between
  arrivals (`spawnInterval`). All three difficulty curves are plain functions of
  the level number so the ramp can be asserted directly in the tests.

### Scoring

| Event | Points |
|---|---|
| Mug delivered to a patron | 50 |
| Patron pushed off the end (served) | 100 |
| Empty mug caught | 25 |
| Level cleared | 250 × level |

The best score is persisted in `localStorage` under `rootbeerrush-best`.

## Controls

| Key | Action |
|---|---|
| <kbd>↑</kbd> / <kbd>W</kbd> | Move up one bar |
| <kbd>↓</kbd> / <kbd>S</kbd> | Move down one bar |
| <kbd>Space</kbd> | Slide a mug down the current bar (also starts/restarts) |
| <kbd>P</kbd> | Pause / resume |

## Code structure

Three files, no build step:

- `index.html` — HUD, canvas, overlay, help line.
- `style.css` — saloon palette shared with the rest of the repo's game styling.
- `game.js` — a single classic (non-module) script.

`game.js` is deliberately written with top-level `let`/`function` declarations
rather than modules or an IIFE, matching BurgerTime, Kaboom! and Snake in this
repo. Everything the tests need — `state`, `patrons`, `mugs`, `empties`,
`barkeep`, `step`, `draw`, `pour`, `spawnPatron`, `spawnEmpty`, `addScore`,
`levelTarget`, `patronSpeed`, `spawnInterval` — is reachable as a global from
`page.evaluate`.

All motion is per-second and advanced by `step(dt)`, which never reads the
clock. `requestAnimationFrame` only supplies `dt` in the browser, so a Playwright
spec can simulate a whole level in milliseconds by calling `step(1/60)` in a
loop. `spawnEnabled` switches off automatic patron arrivals, letting a spec place
exactly the entities it wants to reason about.

`step(dt)` runs in a fixed order — spawning, mugs, patrons, empties, splash
effects, then the level-clear check — and the entity loops walk backwards so an
entity can be removed mid-iteration. Any life loss returns from `step` early,
because `loseLife()` clears the bars underneath the loop that is running.

Drawing paints patrons *before* the bar planks so the plank hides everything
below chest height, which is what makes them read as standing on the far side of
the bar. Mugs are painted after the planks, so they sit on the surface.

## Assumptions

These are the calls made where the brief left room for interpretation; the
simpler reading won each time.

- **Root beer, not beer.** The mechanic is the classic bartender-lane arcade
  game; the theme is soft drinks so the game fits the rest of the repo. The name
  and art are original to this repo.
- **Unlimited mugs.** There is no mug inventory to refill — the pour cooldown is
  the only limit on how fast you can serve. One fewer resource to track.
- **One button per mug.** Pouring is a single keypress rather than hold-to-fill
  then release-to-slide. Simpler to explain and simpler to test.
- **Mugs pass drinking patrons.** Only walking patrons reach out for a mug, so a
  mug poured into a lane where everyone is mid-drink runs off the end and costs a
  life. This keeps "don't pour blindly" as a real decision.
- **Patrons pushed off the end do not send an empty back.** They leave with the
  mug; only patrons who stop to drink mid-bar return one.
- **Instant lane changes.** The barkeep teleports between adjacent lanes instead
  of animating along a rail — lane position is the only thing the rules depend
  on.
- **No tips or bonus rounds.** The arcade original scatters tips and adds a
  shell-game bonus stage; both are out of scope for a first version.
- **Branch naming.** The task description asked for a branch named after the game
  (`root-beer-rush`), but this session's standing instructions pin all work to
  the assigned branch `claude/loving-euler-zu3opq`. The assigned branch wins;
  no separate `root-beer-rush` branch was created.
- **Stale browser test counts.** `game-browser/e2e/game-browser.spec.ts` asserted
  105 game cards while `games.json` already held 108 (three games had been added
  without updating it). Adding this game made it 109, and the hardcoded counts
  were updated to match.

## Testing

`tests/rootbeerrush.spec.js` holds 60 Playwright specs covering the initial and
idle state, starting a run, barkeep movement and clamping, pouring and the pour
cooldown, patron walking and queueing, serving and pushing patrons off the end,
empties being caught or smashed, every way to lose a life, game over and
restart, the level quota and difficulty ramp, pausing, scoring and `localStorage`
persistence, and that rendering a busy bar paints pixels without throwing.

Run them from the repo root:

```powershell
npx playwright test RootBeerRush/tests/
```
