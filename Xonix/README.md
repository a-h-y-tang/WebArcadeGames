# Xonix

A territory-capture arcade game. Dart out from the safe land, carve a trail across
the sea, and seal it back to shore — the enclosed water without a drone in it turns
to solid land. Claim **75%** of the sea to win, but don't let a bouncing drone
touch your trail, and never cross your own line.

## How to play

1. Open `index.html` in a browser (no build or server needed), or press
   **Start Game**.
2. Use the arrows / WASD to move. Along the land border you move freely.
3. Head out into the sea to draw a **trail**. Bring it back to land to seal off an
   area — the side with no drone is claimed as land.
4. Reach the target percentage shown in the HUD.

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / WASD | Set direction |
| R | Restart |
| P | Pause / resume |

## Rules

- **Drawing** — leaving the land onto the sea starts a trail. It's live and
  vulnerable until you seal it.
- **Sealing** — returning to land converts your trail to land and runs a flood
  fill: any sea a drone can't reach becomes land. That's how you claim area.
- **Drones** — bounce diagonally around the sea. If one touches your live trail,
  you lose a life. They can't cross onto land.
- **Self-collision** — running into your own trail costs a life.
- **Lives** — you start with 3. Losing one wipes your unfinished trail and returns
  you to the edge. At 0 lives it's game over.
- **Score** — one point per cell claimed; the best score persists.

## Strategy

- Small, quick nibbles are safe. Big loops claim more but leave a long trail
  exposed for a drone to hit.
- Watch where the drones are heading before you commit to a long excursion — the
  flood fill only claims the pocket they *aren't* in.

## Implementation

See [`design.md`](design.md) for the cell-state model, the flood-fill capture
algorithm, enemy bouncing, and the deterministic, testable API. All behaviour is
covered by the Playwright suite in [`tests/`](tests/).
