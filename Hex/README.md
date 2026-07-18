# Hex

The classic **connection** game, invented independently by Piet Hein (1942) and
John Nash (1948), rendered on an HTML5 canvas. Two players share the board and
race to link their own pair of opposite edges. Unlike align-in-a-row or capture
games, in Hex you *build a path* — and by a famous theorem, the game can never
end in a draw.

## How to play

Open `index.html` in any browser — no build step or server required.

1. The board is an **11×11 rhombus** of hexagons. **Red** owns the **top** and
   **bottom** edges (drawn red); **Blue** owns the **left** and **right** edges
   (drawn blue).
2. **Red moves first.** Players take turns **clicking any empty cell** to drop a
   stone of their colour.
3. **Red wins** by forming an unbroken chain of red stones connecting the top
   edge to the bottom edge. **Blue wins** by connecting left to right.
4. Each hexagon touches **six** neighbours, so chains can weave diagonally — the
   two "extra" hex diagonals (up-right and down-left) are what make Hex richer
   than a square grid.
5. The instant a player completes their connection the game ends and the winner
   is announced.

### The swap (pie) rule

Moving first is a genuine advantage, so Hex uses the standard **pie rule** to
balance it: immediately after Red plays the opening stone, **Blue** may press
**Swap** to take that stone over as their own instead of replying — after which
the turn passes back to Red. Blue can also just ignore the offer and play a
normal move. The Swap button only appears for that one decision.

## Strategy tips

- **Build bridges, not solid walls.** Two stones a knight-ish hop apart with two
  empty cells between them are "connected" in practice — an opponent can only
  block one of the two links, so you fill the other. Bridges advance fast and are
  hard to cut.
- **Block and build at once.** Because exactly one player can complete a
  connection, every stone that extends your chain also obstructs your opponent's.
  Look for moves that do both.
- **Fight for the centre early.** Central stones have the most room to branch
  toward either of your edges.
- If you're Blue, **use the swap rule** — if Red opens on a strong central cell,
  take it.

## Controls

| Input | Action |
|---|---|
| Left-click / tap an empty cell | Place your stone |
| **Swap** button | Take over Red's opening stone (Blue's first turn only) |
| `R` key or **New Game** button | Restart |
| Any key / button on the title screen | Start |

## Implementation

See [DESIGN.md](DESIGN.md) for how the code works: the deterministic rule core
(`neighbors` / `place` / `connects` / `checkWin`) is kept separate from
rendering, so the full Playwright suite in [`tests/`](tests/) builds exact board
positions and asserts outcomes with no timing dependence.
