# Darts (501)

A single-player game of **501** on a regulation HTML5-canvas dartboard. Start at
501, subtract every throw, and race to land on exactly zero — finishing on a
double, just like the real game. Your fewest-darts finish is saved as your best.

## How to play

Aiming is a two-stage sweep so it works on a keyboard:

1. **Space** — lock the horizontal aim (the vertical line sweeping left↔right).
2. **Space** — lock the vertical aim and throw the dart at the crosshair.

Or just **click anywhere on the board** to throw straight at that spot. Press
**Space** or **Start Game** on the overlay to begin.

## Rules

- Darts come in **turns of three**.
- Each dart's value is subtracted from what remains. Triples and doubles score
  ×3 / ×2; the outer bull is 25 and the bullseye is 50.
- **Double-out:** you win by reaching *exactly* 0 with a **double** or the
  **bullseye**. Overshooting, landing on 1, or hitting 0 with a non-double is a
  **bust** — the whole turn is voided and your total reverts.
- It's a solo skill game: there's no way to lose, so the target is your
  **fewest darts** (saved to `localStorage`).

## Running

Open `index.html` directly in a browser — no build step or server needed.

## Tests

```powershell
npx playwright test Darts/tests/
```

## Design

See [DESIGN.md](DESIGN.md) for the board geometry, scoring table, ruleset, and
the assumptions made where the brief was open-ended.
