# Mancala

One of the world's oldest board games, played against a built-in CPU. Scoop the
stones from a pit and sow them around the board, angling for extra turns and
captures until one side runs empty. Whoever has hoarded the most stones in their
store wins. This is the classic **Kalah** ruleset.

## How to play

1. Open `index.html` in any modern browser (no build step, no server).
2. You are the **bottom** row; the CPU plays the top row.
3. Click one of your pits (or press **1**–**6**) to sow its stones.

### Controls

| Action           | Input                                        |
|------------------|----------------------------------------------|
| Sow a pit        | Click one of your pits (bottom row)          |
| Sow pit 1–6      | Press **1**–**6** (left to right)            |
| New game         | The **New Game** button                      |

## Rules

- Stones are sown one per pit, counter-clockwise, into your own store but
  **skipping the opponent's store**.
- Land your last stone in **your store** and you take another turn.
- Land your last stone in an **empty pit on your side** while the pit opposite
  has stones, and you **capture** both into your store.
- When either player's six pits are all empty the game ends, and each side
  sweeps its remaining stones into its own store.
- Most stones in your store wins; an even split is a tie.

## Development

Tests live in `tests/` and run through the repo's shared Playwright setup:

```powershell
npx playwright test Mancala/tests/
```

See [design.md](design.md) for the rules engine, the CPU heuristic, and the
design decisions behind them.
