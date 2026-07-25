# Mancala — Design

## Concept

Mancala is one of the oldest known board games. This version implements the
popular **Kalah** ruleset: a two-row board of six pits per side, four stones in
each, and a *store* (the large pit) at each end. You play the bottom row
against a simple CPU on the top row. Whoever gathers the most stones in their
store wins.

## Mechanics

Board indices form a single counter-clockwise loop:

```
   12 11 10  9  8  7        CPU pits (player 2)
13                    6     stores: 13 = CPU, 6 = You
    0  1  2  3  4  5        Your pits (player 1)
```

- **Sowing:** pick a non-empty pit on your side, lift all its stones, and drop
  them one at a time into each following pit going counter-clockwise —
  including your own store, but **skipping your opponent's store**.
- **Extra turn:** if your last stone lands in your own store, you immediately
  move again.
- **Capture:** if your last stone lands in an *empty pit on your own side* and
  the pit directly opposite (the opponent's) holds stones, you capture that
  stone plus everything opposite into your store.
- **Game end:** as soon as one player's six pits are all empty, the game ends
  and every remaining stone is swept into its owner's store.
- **Winner:** the player with more stones in their store. Equal stores tie.

## Controls

| Action           | Input                                        |
|------------------|----------------------------------------------|
| Sow a pit        | Click one of your pits (bottom row)          |
| Sow pit 1–6      | Press **1**–**6** (left to right)            |
| New game         | The **New Game** button                      |

The CPU takes its turn automatically a beat after yours.

## The CPU

`aiMove()` is a greedy one-ply chooser. For each of its legal pits it simulates
the sow on a board copy and scores the result by the stones gained in its store,
with a bonus for moves that earn an extra turn; ties resolve toward the pit
nearest its store. It then plays the best pit for real. It is deliberately
simple — good enough to be a real opponent without being unbeatable.

## Code structure

The rules are pure and fully deterministic so the Playwright suite can drive
them without timers or randomness:

- **`applySow(bd, pit, player)`** sows into any board array and returns whether
  an extra turn was earned; it handles store-skipping and captures. Both the
  real move and the CPU's look-ahead reuse it.
- **`sow(pit)`** wraps `applySow` on the live `board`: it validates legality,
  resolves end-of-game (`collectRemaining`), and passes the turn.
- **`legalMove`, `winner`, `isSideEmpty`, `oppositePit`** are small helpers the
  tests assert against directly.
- **`requestAnimationFrame` is not used** — the board is static, so `render()`
  is called only after state changes. CPU pacing uses `setTimeout` purely for
  feel and never affects the pure logic.
- Top-level bindings are plain `let`/`const` in a non-module script, reachable
  from tests via `page.evaluate`.

## Assumptions

- **Ruleset:** Kalah (6 pits, 4 stones, capture-from-empty, extra-turn-on-store)
  is used — the most common digital Mancala. Regional variants (e.g. Oware's
  different capture rules, multi-lap sowing) are out of scope; the simpler,
  most widely recognised rules were chosen.
- **Filename:** the task asked for `DESIGN.md`, but every existing game in this
  repo uses a lowercase `design.md`, and the root README references it. This
  file is `design.md` for consistency and holds all the requested content.
- **Single player:** the game is you vs. a built-in CPU rather than
  hot-seat two-player, matching the arcade "pick up and play" feel of the repo.
- **Capture rule detail:** a capture requires the landing pit to have been empty
  before the final stone (`board[pit] === 1` after landing) — standard Kalah.
