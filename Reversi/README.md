# Reversi (Othello)

The classic disc-flipping strategy game, rendered on an HTML5 canvas. You play
**black** against a computer opponent playing **white**. Out-flank your
opponent's discs to flip them to your colour and finish with the most discs on
the board.

## How to play

Open `index.html` in any browser — no build step or server required.

1. The board starts with four discs in the centre. **Black moves first** — that's
   you.
2. Legal squares are marked with a small dot. **Click** one to place a disc.
   Your disc must **flank** a straight line of one or more white discs, capping
   it with one of your own — every disc in that line flips to black.
3. After you move, the **white AI** replies automatically after a short pause.
4. If you have no legal move, your turn is passed automatically; if the AI has
   none, play comes straight back to you.
5. The game ends when neither side can move (usually a full board). **The player
   with more discs wins.** Equal counts are a draw.

## Strategy tips

- **Corners are king** — they can never be flipped. The AI values them highly, so
  grab them when you can and avoid giving them away.
- Beware the squares diagonally next to an empty corner; playing there often lets
  your opponent take the corner.
- Having *fewer* discs in the mid-game is often good — it means more flipping
  opportunities remain for you later.

## Controls

| Input | Action |
|---|---|
| Left-click a highlighted square | Place your (black) disc |
| `R` key or **New Game** button | Restart |

## The AI

White is a deterministic one-ply heuristic: it scores each legal move by a
positional weight table (corners high, corner-adjacent traps low) plus how many
discs the move flips, and plays the best one. It's a genuine challenge but
beatable — and predictable enough to be unit-tested.

## Files

- `index.html` — page scaffold (scoreboard, canvas, controls).
- `style.css` — felt-board and disc styling.
- `game.js` — all game logic and canvas rendering. Logic is exposed on
  `window.game` for testing.
- `design.md` — how the game and its code work.
- `tests/reversi.spec.js` — Playwright test suite.

## Running the tests

From the repository root:

```powershell
npx playwright test Reversi/tests/
```
