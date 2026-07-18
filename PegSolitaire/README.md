# Peg Solitaire

The classic single-player board puzzle on the English cross board. Jump pegs over
their neighbours to remove them, and try to clear the board down to a single peg.

## How to play

- The board is a plus of 33 holes, full of pegs except the centre.
- **Click a peg**, then **click a highlighted hole** to jump: the peg leaps
  straight over an adjacent peg into the empty hole beyond, and the jumped peg is
  removed.
- Jumps are horizontal or vertical only — never diagonal.
- The game ends when no jumps remain. **One peg left is a win** ("Solved!");
  more than one and you're "Stuck!".

## Controls

- **Mouse** — click a peg to select it (selectable pegs' targets are shown as
  translucent dots), then click a highlighted hole to jump.
- **Any key** or the **Start / Play Again** button — begin or restart.

## Scoring

`Removed` counts the pegs you've cleared (max 31 for a perfect solve). Your
**Best** — the most pegs you've ever removed — is saved between sessions.

## Running

Open `index.html` directly in a browser — no build step or server needed.

## Tests

Playwright specs live in `tests/pegsolitaire.spec.js`. From the repo root:

```powershell
npx playwright test PegSolitaire/tests/
```

See [design.md](design.md) for the board model, jump rules and end-game logic.
