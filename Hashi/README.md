# Hashi (Bridges)

Connect the numbered islands with bridges so that every island gets exactly its
number of connections — and the whole map becomes one connected network.

**Hashi** (short for *Hashiwokakero*, "build bridges") is a classic Japanese logic
puzzle, also known simply as **Bridges**.

## Rules

- Bridges run **horizontally or vertically** in a straight line between two islands.
- A pair of islands can have **one or two** bridges (no more).
- Bridges may **not cross** each other and may **not pass over** an island.
- Each island must end with **exactly its number** of bridges attached.
- When solved, **all islands are connected** into a single group.

## How to play

- **Click an island, then click a neighbouring island** to add a bridge between them.
- **Or drag** from one island to a neighbour.
- Each toggle cycles the bridge count: **none → one → two → none**.
- A bridge that would cross an existing one is refused.
- Islands turn **green** when their number is satisfied (and red if you over-connect).

### Controls

| Input | Action |
|---|---|
| Click island + click neighbour | Toggle a bridge |
| Drag island → neighbour | Toggle a bridge |
| **R** | Restart the current level |
| **N** | Advance to the next level |
| Level buttons | Jump to a level |

## Scoring

The HUD shows how many islands are satisfied and how many moves you've made. Solving
a level in **fewer moves** is better; your best per level is saved in your browser's
`localStorage`.

## Levels

Three hand-crafted, guaranteed-solvable puzzles: a 4-island 5×5 warm-up, a 9-island
7×7 board with double bridges, and an 8-island 5×5 with interior crossing choices.

## Running

Open `index.html` directly in a browser — no build step or server required.

Tests live in `tests/hashi.spec.js` and run with Playwright:

```powershell
npx playwright test Hashi/tests/
```

See [DESIGN.md](DESIGN.md) for the mechanics, exposed API, and design assumptions.
