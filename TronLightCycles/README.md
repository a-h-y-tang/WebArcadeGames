# Tron Light Cycles

A grid-based light-cycle duel inspired by the arcade classic *Tron*. You pilot
the **cyan** cycle; a computer-controlled **orange** cycle races against you.
Both cycles move continuously and leave a solid wall of light behind them.
Crash into a wall — the arena border, your own trail, or the CPU's — and you're
out. Trap the CPU into crashing first to win the round.

## How to play

- The two cycles start facing each other across the arena and immediately begin
  moving.
- Steer to avoid walls while forcing the CPU into a dead end.
- You **cannot** reverse straight back into your own trail — a 180° turn is
  ignored.
- A round ends the instant a cycle crashes:
  - **CPU crashes** → you win, your win count and streak go up.
  - **You crash** → a loss, your streak resets.
  - **Both crash on the same tick** → a draw (counts as neither, streak resets).

### Controls

| Key | Action |
|---|---|
| ↑ ↓ ← → or W A S D | Steer up / down / left / right |
| P | Pause / resume |
| Space / Enter / Start button | Begin a round |

### Scoring

- **Wins** and **Losses** accumulate across rounds and are shown in the HUD.
- **Best Streak** is the longest run of consecutive round wins. It persists
  between sessions via `localStorage`.

## Running

Open `index.html` directly in any modern browser — no build step or server
required.

## Tests

Playwright tests live in [`tests/`](tests/) and drive the game's pure,
grid-stepped simulation deterministically. From the repo root:

```powershell
npx playwright test TronLightCycles/tests/
```

## Design

See [DESIGN.md](DESIGN.md) for how the arena grid, the deterministic `step()`
simulation, the collision rules, and the CPU opponent work.
