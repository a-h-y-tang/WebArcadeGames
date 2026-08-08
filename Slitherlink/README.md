# Slitherlink

Draw a single closed loop around the grid so that every numbered cell touches
exactly that many loop segments.

Slitherlink — also called *Loop the Loop* or *Fences* — is a classic Japanese
logic puzzle. There is no guessing required: every puzzle here has exactly one
solution reachable by pure deduction.

![Slitherlink](screenshot.png)

## Rules

- The loop runs along the **edges between dots**, horizontally and vertically.
- A number says **exactly how many of that cell's four sides** the loop uses.
  A `0` means the loop never touches that cell; a `3` means it wraps three sides.
- Cells without a number are unconstrained.
- When you are done there must be **one single closed loop** — no branches, no
  loose ends, and no second separate loop.

## How to play

- **Click an edge** to draw a line on it. Click again to mark it with an ✗
  (a "definitely not part of the loop" note), and once more to clear it.
- **Right-click** an edge to go the other way round: ✗ first, then line.
- Numbers turn **green** when they are exactly satisfied and **red** when you
  have drawn too many sides around them — so you always know where you stand.
- The moment the loop closes with every clue satisfied, the puzzle is solved and
  the enclosed area lights up.

### Controls

| Input | Action |
|---|---|
| Left-click edge | Cycle empty → line → ✗ → empty |
| Right-click edge | Cycle empty → ✗ → line → empty |
| Tap | Same as left-click |
| **R** | Restart the current level |
| **N** | Next level |
| **Space** | Start / continue |
| Level buttons | Jump to any level |

## Levels

| Level | Size |
|---|---|
| Warm-up | 4 × 4 |
| Stroll | 5 × 5 |
| Ramble | 6 × 6 |
| Winding | 7 × 7 |
| Labyrinth | 8 × 8 |

## Scoring

The HUD tracks how many clues are still unsatisfied and how many moves you have
made — one edge change is one move. Solving a level in fewer moves is better,
and your best per level is kept in your browser's `localStorage`.

## Tips

- Start with the `0`s. Every side of a `0` can be crossed off immediately, which
  usually pins down its neighbours.
- A `3` next to another `3` always has the edge between them drawn, plus the two
  outer edges.
- Remember that every dot must end up with either **zero or two** lines. If a dot
  already has two, cross off its other sides.

## Running

Open `index.html` in a browser — no build step required.

Tests:

```powershell
npx playwright test Slitherlink/tests/
```
