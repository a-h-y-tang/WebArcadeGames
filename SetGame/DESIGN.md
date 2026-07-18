# Set — Design

## Game concept

Set is a real-time pattern-recognition card game. Twelve cards are dealt from a
special 81-card deck. Every card has four attributes — **count** (1, 2 or 3),
**colour** (red, green or purple), **shape** (oval, diamond or squiggle) and
**shading** (solid, striped or open). A *Set* is any three cards for which each
of the four attributes is, independently, either **all the same** or **all
different** across the three cards. The player hunts the board for Sets; each
valid Set is scooped up (and replaced from the deck) and scores points, while a
wrong guess costs a small penalty. Play continues until the deck runs out and no
Set remains on the table.

## Mechanics

- **The deck.** The 81 cards are exactly the 3⁴ combinations of the four
  three-valued attributes. Each card is encoded as an integer `0..80`; its four
  attribute values are its digits in base 3.
- **The Set rule.** Three cards form a Set iff, for every attribute, the sum of
  the three values is divisible by 3. (Sum ≡ 0 mod 3 is equivalent to
  "all equal or all different" for three values in `{0,1,2}` — an elegant,
  branch-free test.)
- **Selecting.** Clicking a card toggles its selection. Clicking a third card
  triggers evaluation:
  - If the three cards are a Set: they score `SET_POINTS`, the *sets-found*
    counter rises, the cards are removed and — if the board would otherwise
    drop below twelve — replaced from the deck.
  - If they are not a Set: a *mistake* is recorded and the score drops by
    `MISTAKE_PENALTY` (never below zero). The selection clears.
- **Always solvable.** After every change the board is checked; if it holds no
  Set and the deck still has cards, three more are dealt (12 → 15 → 18) until a
  Set exists. This keeps the player from getting stuck.
- **Ending.** When the deck is empty and the board contains no Set, the game is
  over. In a clean run that means every card has been paired away.
- **Scoring.** Score accumulates from Sets minus mistakes. The best score is
  persisted to `localStorage` under `set-best` and shown in the HUD.
- **Hints.** Pressing **H** briefly highlights one valid Set on the board (this
  is the same `findSetIndices` routine the solvability check uses).
- **States.** `idle` (start overlay) → `running` → `over` (game-over overlay).
  Space / click / the on-screen button starts or restarts the game.

## Controls

| Key / input | Action |
|---|---|
| Click / tap a card | Toggle its selection (a third selection is evaluated) |
| Space / Enter | Start / restart the game |
| H | Highlight one valid Set (hint) |

An on-screen **Start / Play Again** button mirrors the keyboard start.

## Rendering

A single 600×400 canvas. The board is laid out in three rows; the number of
columns grows with the board (4 → 5 → 6). Each card is drawn from canvas
primitives only — its `count` shapes stacked vertically, drawn as ovals,
diamonds or squiggles, in red / green / purple, and filled solid, striped
(clipped hatching) or open (outline). Selected cards get a highlighted frame.
No image assets, so the game runs straight from `index.html` with no build step
or network access.

## Testing approach (TDD)

Following the board/logic games already in this repo (Reversi, Minesweeper,
Sudoku, Lights Out), the game logic lives as plain globals on a classic
(non-module) script so the Playwright tests can read and drive state directly.
Because Set is turn-based rather than real-time, there is no `step(dt)`; instead
the pure rule functions and the board mutations are exercised directly. Tests
were written first and cover:

- initial/idle state, canvas size, HUD zeros, best-score load from storage
- the `isSet` rule: recognising valid Sets (all-same and all-different cases)
  and rejecting non-Sets
- `findSetIndices` locating a Set that really satisfies `isSet`
- starting: twelve unique cards dealt and at least one Set present
- selection toggling (click a selected card to deselect it)
- a valid Set scoring, incrementing sets-found and being removed/replaced
- an invalid trio recording a mistake, applying the penalty and clearing
  selection without changing the board size
- deck-exhausted + no-Set ending the game, and a Set present keeping it running
- best-score update and persistence to `localStorage`, and not lowering it on a
  worse run
- game-over overlay / Play Again button and restart resetting state

Determinism is achieved by letting tests assign the `board` and `deck` globals
directly to known card ids before exercising a rule, so no shuffle seeding is
needed; `startGame()`'s own shuffle is only used by the "deal twelve" test,
which asserts structural properties (uniqueness, a Set exists) rather than exact
cards.

## Assumptions

- **Folder name.** Uses `SetGame/` (PascalCase, avoiding the bare word "Set")
  to match existing folders such as `LightsOut/`, `DinoRun/`; the git branch is
  the kebab-case `set-game`.
- **Simpler interpretation.** Where the task was ambiguous the simpler path was
  taken: the board auto-deals when no Set exists (rather than requiring the
  player to call "no Set"), scoring is a flat points-per-Set minus a flat
  mistake penalty (no time bonus), and there is no timer.
- **Set rule via mod-3.** The sum-divisible-by-3 formulation is used instead of
  four explicit all-same/all-different checks; it is equivalent and simpler to
  test.
- **Best-score key.** `localStorage['set-best']`, consistent with the
  `dino-best` / `tetris-best` style keys used elsewhere in the repo.
