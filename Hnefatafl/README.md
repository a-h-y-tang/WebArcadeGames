# Hnefatafl

An ancient Norse strategy game of asymmetric siege warfare, in the compact
**Brandub** 7×7 variant. You command the **Defenders** — a King and four
guards — and must escort your King to one of the four corner refuges. A
deterministic AI commands the surrounding **Attackers**, who try to capture
your King. As in traditional tafl, the **Attackers move first**.

## How to play

- **Click** one of your gold pieces (a defender or the King) to select it. Its
  legal moves are highlighted.
- **Click** a highlighted square to move there. The Attacker AI then responds.
- All pieces move **orthogonally any number of empty squares**, like a rook —
  no jumping.
- **Capture a soldier** by sandwiching it between two of your pieces (the
  corners and the throne also count as a wall you can pin against). Moving your
  own piece *into* a gap between two enemies is safe.
- **The King** cannot be captured by a two-sided sandwich — the Attackers must
  surround it on every side (the throne and the board edge count toward the
  surround).

## Win conditions

- **You win** the moment your King reaches any corner refuge.
- **You lose** if the Attackers surround and capture your King.

## Controls

| Action | Input |
|---|---|
| Select a piece | Click a gold piece |
| Move | Click a highlighted square |
| New game / restart | **New Game** button |

## Running

Open `index.html` directly in any modern browser — no build step or server
required.

## Tests

Playwright tests live in `tests/`. From the repository root:

```powershell
npx playwright test Hnefatafl/tests/
```

See [DESIGN.md](DESIGN.md) for the full rules, the capture logic, the
deterministic AI, and the assumptions made where historical rules vary.
