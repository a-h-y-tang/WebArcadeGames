# Mastermind — Design

## Concept

Mastermind is the classic code-breaking game. A hidden code of four coloured
pegs is drawn from six colours (repeats allowed). You have ten guesses to crack
it. After each guess the board scores it with **feedback pegs**:

- a **black** peg for every peg that is the right colour *in the right place*;
- a **white** peg for every peg that is the right colour *in the wrong place*.

The feedback never tells you *which* peg was right — deducing that is the whole
game. Crack the code (four blacks) before your ten guesses run out.

The scoring rule is a pure function of the guess and the secret, which makes
Mastermind an ideal fit for the repo's test-first-with-Playwright approach.

## Mechanics

- **Code** — `secret` is an array of four integers in `0..5` (colour indices).
- **Guessing** — you build a row peg-by-peg into `current`; once it holds four
  pegs it can be submitted.
- **Scoring** — `scoreGuess(guess, secret)` returns `{ black, white }` using the
  standard non-double-counting rule (see below). The scored row is pushed onto
  `guesses`.
- **Winning** — four black pegs ends the game as a win.
- **Losing** — using all ten guesses without cracking the code ends it as a
  loss, and the overlay reveals the answer.

### The scoring rule

Blacks are counted first (exact position hits). For the remaining pegs, the
leftover guess colours and leftover secret colours are tallied separately, and
each colour contributes `min(guessCount, secretCount)` whites. This is what
stops three guessed reds from all scoring when the secret contains only one
red — a subtlety that has an explicit test.

## Controls

| Input | Action |
|---|---|
| Keys 1–6 | Add that colour to the current row |
| Click a palette swatch | Add that colour |
| Enter (or click the row when full) | Submit the guess |
| Backspace | Remove the last peg |
| Esc | Clear the current row |
| Any key | Start / restart (on the overlays) |

## Code structure

Everything lives in `game.js` as intentionally global bindings so the Playwright
suite can drive and inspect the game via `page.evaluate()`.

- **Config** — `COLORS`, `COLOR_NAMES`, `CODE_LENGTH`, `MAX_GUESSES`.
- **State** — `state` (`idle → playing → won|lost`), `secret`, `guesses`,
  `current`.
- **Pure logic** — `scoreGuess()` and `randomCode()` have no side effects and
  are unit-tested directly.
- **Actions** — `pickColor()`, `removeLast()`, `clearCurrent()`, `submitGuess()`
  mutate the row/board and re-render; `win()`/`lose()`/`newGame()` handle the
  flow; `setSecret()` exists purely so tests can pin the hidden code.
- **Layout helpers** — `guessCenter(row, col)` and `swatchRect(i)` return pixel
  geometry; the render code and the tests' click targets share them, so a
  layout tweak can't desync the two.
- **Rendering** — immediate-mode 2D canvas: guess pegs (glossy filled circles),
  the 2×2 feedback clusters, the active-row highlight, and the palette.

## Assumptions

Resolved by picking the simpler interpretation, per the project's guidance:

- **Six colours, length four, ten guesses.** The most common Mastermind ruleset.
- **Repeats allowed in the code.** The standard, more interesting variant; the
  scoring rule handles duplicates correctly.
- **Feedback pegs are unordered.** The black/white pegs convey only *counts*,
  never which position they refer to — as in the physical game.
- **No score persistence.** Play is per-session; there is no `localStorage`
  "best", since a single win/loss doesn't map cleanly onto a comparable score.
- **Keyboard-first, with palette clicks.** Number keys map one-to-one onto the
  six colours; clicking the palette is the equivalent pointer action. There is
  no drag-and-drop.
