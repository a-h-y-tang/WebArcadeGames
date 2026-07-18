# Yahtzee

The classic five-dice game, built with HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space / Enter, or **Roll** | Roll the dice (up to 3 times per turn) |
| 1–5, or click a die | Hold / release that die between rolls |
| Click a scorecard row | Bank the dice into that category |
| Space / Enter | Start / play again |

**Objective:** Each turn, roll the five dice up to three times, keeping the ones
you like, then bank the result into one of the thirteen categories. Every
category is used exactly once. Fill the whole scorecard for the highest total.

- **Upper section** (Ones–Sixes) scores the sum of the matching dice; reach a
  63+ upper subtotal for a **35-point bonus**.
- **Lower section** rewards combinations — three/four of a kind, a full house
  (25), small (30) and large (40) straights, a **Yahtzee** (five of a kind, 50),
  and Chance (sum of everything).

Unused rows preview what the current dice would score, in blue, so you can plan
your move. Your best grand total is saved in `localStorage`.

See [DESIGN.md](DESIGN.md) for the full rules, scoring, and implementation notes.
