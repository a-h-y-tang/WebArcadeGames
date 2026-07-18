# Word Guess — Design

## Concept

Word Guess is a five-letter word-deduction game in the style of the popular
"Wordle" puzzle. You have **six guesses** to find a hidden five-letter word.
After each guess every tile is colored to tell you how close you are, and the
on-screen keyboard remembers what you have learned. It rewards careful
deduction under a tight guess budget.

## Mechanics

- The answer is a random five-letter word from an embedded word list.
- A guess must be a **valid five-letter word** from that same list; otherwise
  it is rejected and does not cost a row.
- Each submitted guess is scored letter-by-letter into three states:
  - **correct** — right letter in the right position (green).
  - **present** — the letter is in the word but in a different position
    (yellow).
  - **absent** — the letter is not in the word (gray).
- **Duplicate letters are handled the same way as Wordle:** correct positions
  are matched first, then remaining "present" matches are assigned only while
  unmatched copies of that letter remain in the answer. So a guessed letter
  that appears more times than it does in the answer will show some copies as
  absent.
- The **on-screen keyboard** shows the best state discovered for each letter
  (correct outranks present outranks absent).
- **Win** by guessing the word within six tries. **Lose** if all six rows are
  used without a correct guess; the answer is then revealed.
- **Streak:** consecutive wins. The current streak and the best streak are
  persisted to `localStorage` (`wordguess-streak`, `wordguess-best`). A loss
  resets the current streak to zero.

## Controls

| Input | Action |
|---|---|
| Letter keys `A`–`Z`, or click on-screen keys | Type a letter into the row |
| `Backspace` / on-screen ⌫ | Delete the last letter |
| `Enter` / on-screen ⏎ | Submit the guess |
| `Space` / start button | Start a new game (from the idle / end screen) |

## States

`idle` → `playing` → (`won` | `lost`) → `playing` on a new game.

## Testable API

Rendering is separated from logic, and the logic is exposed on `window` so
Playwright can drive real rules deterministically:

- Globals: `state`, `answer`, `guesses` (submitted rows: `{word, marks}`),
  `current` (the row being typed), `row`, `streak`, `best`, `WORD_LEN`,
  `MAX_ROWS`, `WORDS`.
- `startGame(word?)` — begin; an optional word forces the answer (test hook).
- `evaluate(guess, answer)` — pure scorer returning an array of
  `'correct' | 'present' | 'absent'`.
- `typeLetter(ch)`, `backspace()` — edit the current row.
- `submitGuess()` — validate + score the current row; returns
  `{ ok, invalid, marks, won, lost }`.
- `keyState(letter)` — best known state for a letter, or `''`.

`draw()` only reads the model, so no test depends on pixels.

## Assumptions

- **Simpler interpretation chosen:** the valid-guess dictionary and the pool of
  possible answers are the *same* embedded list of common words, rather than
  shipping the full Scrabble dictionary. This keeps the file small while still
  rejecting nonsense guesses. The list is easy to extend.
- There is no daily/seeded puzzle — each new game picks a random answer, so the
  game is replayable rather than once-per-day.
- Guesses may be repeated; the game does not forbid re-entering a prior guess.
- The streak is a simple win counter (higher is better), reset on any loss —
  this fills the repo's conventional "Best" HUD slot.
- Canvas size is fixed to match the other games in this repo.
