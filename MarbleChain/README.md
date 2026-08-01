# Marble Chain

A path-shooter match-3 arcade game. A train of coloured marbles crawls along a
winding track toward the hole at the end. You sit in the middle of the field
with a turret — fire marbles into the train, line up three or more of a colour,
and burst them before the leading marble drops into the hole.

![Marble Chain](screenshot.png)

## How to play

- **Aim** with the mouse, or turn the turret with <kbd>←</kbd> / <kbd>→</kbd>.
- **Fire** by clicking or pressing <kbd>Space</kbd>.
- **Swap** the loaded marble with the preview marble with <kbd>S</kbd>.
- **Pause** with <kbd>P</kbd>.

Open `index.html` in any browser — there is no build step and no server needed.

## Rules

- A fired marble wedges into the chain wherever it lands, pushing everything
  behind it back down the track. A well-placed shot buys you time as well as a
  burst.
- Three or more of the same colour in a row burst. Longer runs are worth more.
- After a burst the marbles behind roll forward to close the gap. If the two
  ends that meet make another run of three, it bursts too — and each burst in
  the same cascade is worth another multiple of the base score. Combos are
  where the points are.
- Clear every marble on the track to finish the level. Each level sends more
  marbles, adds colours (up to six), and rolls the chain faster.
- If any marble reaches the hole, the run is over.
- The turret only ever loads a colour that is still somewhere on the track, so
  you never get a marble you cannot use.

## Scoring

| Event | Points |
|---|---|
| Burst | `marbles × 10 × combo` |
| Level cleared | `100 × level` |

`combo` counts the bursts caused by a single shot: the first is ×1, a burst
triggered by the gap closing is ×2, the next ×3, and so on. It resets when you
fire again.

Your best score is kept in the browser's `localStorage`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell — HUD, canvas, overlay |
| `style.css` | Presentation |
| `game.js` | Track, chain, turret, matching, rendering |
| `DESIGN.md` | How the code works and why |
| `tests/marble-chain.spec.js` | Playwright suite (69 tests) |

## Tests

From the repository root:

```powershell
npx playwright test MarbleChain/tests/
```
