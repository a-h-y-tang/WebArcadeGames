# Whac-A-Mole — Design

## Game concept

Whac-A-Mole is the classic timed reflex cabinet. Moles pop up from a grid of
holes and you bop them before they duck back down. Every hit scores a point;
the clock is the only enemy. When the timer runs out the round ends and your
score is compared against your best. The longer the round goes, the faster and
more numerous the moles, so the pressure builds toward the end.

## Mechanics

- The board is a `GRID × GRID` (3×3 = 9) grid of holes.
- Moles surface in random empty holes and stay up for a short window before
  ducking on their own (a miss you don't get points for).
- **Whacking** an up mole scores a point and sends it straight back down.
  Whacking an empty hole does nothing (no penalty in this simpler variant).
- Up to `MAX_UP` moles can be up at once.
- **Difficulty ramp:** as the round progresses the spawn interval and the time
  each mole stays up both shrink, so late-game moles are fleeting and frequent.
- The round lasts `GAME_SECONDS` (30). When the clock hits 0 the game ends.
- **Score** is the number of moles whacked. The best score is saved to
  `localStorage` under `whackamole-best`.

## Controls

| Input | Action |
|---|---|
| Click / tap a mole | Whack it |
| Space / Enter / click | Start / restart |
| P | Pause / resume |

The game is mouse‑driven — clicking directly on a hole is the whole
interaction, matching the mallet of the original cabinet.

## Rendering

- HTML5 Canvas, `GRID × CELL` square (160 px cells → 480×480).
- Each hole is drawn as a dark ellipse; an up mole rises out of it as a rounded
  brown body with eyes and a snout. Moles animate in with a short rise so a pop
  reads clearly.
- A translucent overlay (shared start / pause / game‑over panel) sits on top of
  the canvas, matching the other games in this repo.

## Architecture

- `index.html` — markup: HUD (score, time, best), canvas, overlay, hint.
- `style.css` — dark arcade theme consistent with the sibling games.
- `game.js` — all logic. A timestamp‑driven `requestAnimationFrame` loop drives
  the countdown, mole spawning, and auto‑hide, so behaviour is independent of
  frame rate. State and the core functions (`startGame`, `spawnMole`, `whack`,
  `endGame`) live at module top level so the Playwright suite can drive and
  inspect them deterministically.

### Key state

| Name | Meaning |
|---|---|
| `moles` | array of 9 holes, each `{ up, until }` (`until` = hide timestamp) |
| `score` | moles whacked this round |
| `timeLeft` | whole seconds remaining, derived from `endTime` |
| `endTime` | timestamp at which the round ends |
| `state` | `idle` \| `running` \| `paused` \| `over` |

## Assumptions

Points where the spec was open‑ended; the simpler interpretation was chosen
and recorded here as instructed.

- **No penalty for missing** (whacking an empty hole or letting a mole duck).
  Scoring is purely additive — a cleaner, more forgiving rule than deducting
  points or ending the round on misses.
- **Fixed 30‑second round.** Rather than lives or endless play, a single timed
  round defines a game, which makes "game over" unambiguous.
- **A mole ducking on its own is just a missed opportunity**, not a failure
  state.
- **One difficulty curve** tied to elapsed time, rather than selectable
  difficulty tiers.
- The canvas is a fixed pixel size; no responsive resizing beyond the browser
  scaling the element.
