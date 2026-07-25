# Fox and Hounds

A classic asymmetric board game on the dark squares of an 8×8 checkerboard. One
player is the lone **Fox**; the other commands four **Hounds**. The hounds march
down the board trying to **trap** the fox; the fox tries to **slip past** them and
reach the top row. Nobody is ever captured — it's a pure game of blocking.

A two-player hot-seat game: one person plays the fox, the other the hounds.

## How to play

- **Click** one of your pieces to pick it up — its legal moves are highlighted
  with green dots. Click a highlighted square to move there.
- Pieces move **one step diagonally** onto an empty dark square.
  - **Hounds move forward only** (down the board) — they can never retreat.
  - **The fox moves in any diagonal direction.**
- **The fox moves first**, then turns alternate.

## Winning

- **Fox wins** by reaching the top row — it has broken through the pack.
- **Hounds win** by trapping the fox so that, on its turn, it has no legal move.

Played well, the hounds can always win — the challenge is not to leave a gap.

### Shortcuts

| Key | Action |
|---|---|
| **Click** | Select a piece / move to a highlighted square |
| **R** | Restart |

## Playing

Open `index.html` directly in a browser — no build step or server required.

## How it works

Every rule is a pure function over global state, with no animation or timing —
see [DESIGN.md](DESIGN.md) for the full breakdown and why it makes the game
testable frame-free.

## Tests

From the repo root:

```powershell
npx playwright test FoxAndHounds/tests/
```
