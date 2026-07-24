# Darts (501) — Design

A single-player **501** darts game on an HTML5 canvas. You throw at a
regulation dartboard, subtracting each throw's value from a running total that
starts at 501, racing to land on **exactly zero** — finishing on a double, as
the real game demands. Your best (fewest darts to finish) is saved.

## Game concept

- The board is a standard dartboard: twenty numbered sectors, single / double /
  triple rings, a 25 outer bull and a 50 bullseye.
- You start at **501**. Each dart's score is subtracted from what remains.
- Darts come in **turns of three**. After three throws the turn ends and the
  next begins.
- **Double-out:** to win you must reduce the total to *exactly* 0 with a
  **double** (the double ring) or the **bullseye** (50, which counts as a double
  bull). Anything else that would take you to 0, past 0, or to 1 is a **bust**:
  the whole turn is voided and your total reverts to where it stood at the start
  of the turn.
- Reaching exactly 0 on a double **wins**. There is no losing condition — this
  is a solo skill game — so the score to beat is your **fewest darts** (saved to
  `localStorage`).

## Board scoring

Geometry uses a normalized radius `r` (0 at centre, 1.0 at the outer edge of the
double ring) and the standard sector order clockwise from the top:

```
20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5
```

| Region                 | Normalized radius   | Value        |
|------------------------|---------------------|--------------|
| Bullseye               | `r ≤ 0.037`         | 50           |
| Outer bull             | `r ≤ 0.094`         | 25           |
| Triple ring            | `0.582 ≤ r ≤ 0.629` | sector × 3   |
| Double ring            | `r ≥ 0.953`         | sector × 2   |
| Single (inner / outer) | everything else in  | sector × 1   |
| Miss                   | `r > 1.0`           | 0            |

The sector under a point is `ORDER[floor(((angleDeg + 9) mod 360) / 18)]`, with
`angle` measured clockwise from straight up. This puts 20 at the top, 6 at 3
o'clock, 3 at the bottom and 11 at 9 o'clock — matching a real board.

## Controls

Aiming is a classic two-stage sweep so it plays well on a keyboard:

1. Press **Space** (or click **Throw**) to lock the horizontal aim — a vertical
   line sweeping left↔right across the board.
2. Press **Space** again to lock the vertical aim — a horizontal line sweeping
   up↔down — which releases the dart at the crosshair.

You can also **click anywhere on the board** to throw a dart straight at that
point. **Space** from the start/win overlay begins a new game.

## State exposed for tests

To match the other games in this repo, the core state lives in script-level
variables reachable from `page.evaluate`: `remaining`, `turnStart`,
`dartsThisTurn`, `totalDarts`, `state` (`idle | running | over`), `phase`
(`x | y`), `aimX`, `aimY`, `best`, plus `startGame()`, `throwDart(x, y)`, and the
pure `scoreDart(x, y)` (returns `{ value, mult, label }`) and board constants
`CX`, `CY`, `R`.

## Assumptions

Where the brief left room, the simpler reading was chosen and recorded here:

1. **Solo, not versus.** Standard 501 is two players; here it's a single-player
   race for fewest darts. Avoids opponent AI and keeps the simulation
   deterministic. The "score to beat" is your own best.
2. **No losing condition.** Because it's solo, you can keep throwing until you
   finish; the game ends only on a win. Difficulty is self-imposed accuracy.
3. **Double-out, no double-in.** You may start scoring immediately (no
   "double to start"), but must finish on a double — the most common ruleset.
4. **Bull is a double.** The 50 bullseye counts as a valid double for
   finishing, as in standard rules.
5. **Deterministic throws.** A locked aim lands exactly on the crosshair — no
   random wobble — so the challenge is timing the sweep, and tests can drive
   `throwDart(x, y)` reproducibly (the same pattern the Snake tests use).
6. **Canvas is 500×500**, board centred at (250, 250) with radius 210.
