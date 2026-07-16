# Pipe Mania

A race against the flood. Water oozes from a source one segment at a time —
lay pipe ahead of it so it always has somewhere to go, and carry the flow
through enough pipes to clear the level before it spills.

## How to play

Open `index.html` in any browser — no build step or server required.

1. Press **Start** (or any key) to begin. A source appears on the left edge,
   pointing East, and a queue of upcoming pipe pieces shows on the right.
2. **Click** an empty cell to drop the current (front-of-queue) piece. Build
   a connected path leading away from the source.
3. A countdown bar runs along the top. When it empties — or when you press
   **Space** — the water is released and begins flowing.
4. Keep laying pipe ahead of the water. Each pipe the water fills scores a
   point. Reach the **goal** to clear the level.
5. The water **spills** (game over) the moment it reaches an empty cell, a
   pipe with no matching opening, or a pipe it has already flooded.

## Pieces

| Piece | Connects |
|-------|----------|
| Straight | two opposite sides |
| Elbow | two adjacent sides (turns the corner) |
| Cross | all four sides (flow passes straight through) |

## Controls

- **Click** — place the current pipe
- **Space** — release the water early
- **R** — restart the level with a fresh board
- **Enter / any key** — start, or continue from a finished screen

## Scoring

Your score is the number of pipes the water fills. **Best** tracks the most
pipes you have ever carried and persists in `localStorage`. Each level raises
the goal and speeds up the flow.

## Development

See [DESIGN.md](DESIGN.md) for how the code works. Tests live in `tests/` and
run with the repo-wide Playwright suite:

```powershell
npx playwright test PipeMania/tests/
```
