# Blob Drop

A falling-piece action-puzzle in the spirit of *Puyo Puyo*. Coloured **blobs**
drop from the top of a narrow well in joined **pairs**. Slide and rotate each
pair onto the pile, and whenever **four or more blobs of the same colour connect**
(up/down/left/right) they pop and vanish. Blobs above a pop fall into the gap,
which can set off *more* pops — a **chain reaction**, and the real source of big
scores. The well slowly fills; when a new pair has no room to appear, it's game
over.

Unlike the repo's other stacking games (Tetris clears lines, Columns/match-3
clear runs), Blob Drop clears **connected groups of one colour** and rewards
cascading chains.

## How to play

- A pair of blobs falls into the well. Position it, then let it land (or slam it
  down).
- Connect **4+ of the same colour** to pop them.
- Popped blobs let the blobs above fall — engineer setups where one pop triggers
  the next for **chain reactions** and multiplied scores.
- Survive as long as you can; the game ends when the well tops out.

The sidebar shows the **next** pair, your **score**, your **best**, and the
length of your **last chain**.

## Controls

| Input                     | Action                       |
|---------------------------|------------------------------|
| **← / →** or **A / D**    | Move the pair left / right    |
| **↑ / X** or **W**        | Rotate clockwise             |
| **Z**                     | Rotate counter-clockwise     |
| **↓** or **S**            | Soft drop (one row)          |
| **Space**                 | Hard drop (slam down)        |
| **P**                     | Pause / resume               |
| **R**                     | Restart                      |

## Playing locally

Open `index.html` directly in any modern browser — no build step or server
required.

## Design & implementation

See [`DESIGN.md`](DESIGN.md) for the full write-up of the concept, mechanics,
the pure clearing engine, the testable API, and the assumptions made. The
clearing engine — `settleGravity`, `findGroups`, and `resolveBoard` — is a set
of pure functions, which makes the game fully deterministic and drives the
Playwright test suite in [`tests/`](tests/).

## Running the tests

From the repository root:

```powershell
npx playwright test BlobDrop/tests/
```
