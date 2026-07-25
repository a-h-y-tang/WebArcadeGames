# Calcudoku

A **KenKen-style** logic puzzle — a Latin square with arithmetic. Fill the grid
so every **row** and **column** contains each digit once, and every outlined
**cage** reaches its target using the operation shown.

## How to play

- Each cage prints a clue in its top-left corner, such as `12×` (its cells
  multiply to 12), `1−` (the two cells differ by 1), `2÷` (one is double the
  other), or a bare number (a fixed given).
- `+` and `×` cages use all their cells; `−` and `÷` cages compare the two cells.
- Click a cell and type a digit **1–4**. A digit that repeats in its row or
  column, or that completes a cage with the wrong result, is highlighted red —
  it's a hint, not a block.
- Complete the grid correctly and you win.

## Controls

| Input | Action |
|---|---|
| **Click** | Select a cell |
| **1–4** | Enter a digit |
| **0 / Backspace / Delete** | Clear the cell |
| **← ↑ ↓ →** | Move the selection |
| **Space / Enter / Click** | Start |
| **R** | Restart |

## Running

Open `index.html` directly in any browser — no build step or server required.

## Tests

Playwright specs live in `tests/`. From the repo root:

```powershell
npx playwright test Calcudoku/tests/
```

## How it works

See [DESIGN.md](DESIGN.md) for the concept, mechanics, architecture, and how the
bundled puzzle is generated so it has a single, unique solution.
