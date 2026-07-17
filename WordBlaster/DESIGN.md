# Word Blaster — Design

## Concept

Word Blaster is a typing arcade game. Words drift down from the top of the
screen like falling meteors. You destroy each word by **typing it** before it
crosses the danger line at the bottom. Let a word through and you lose a life;
lose all three lives and the game is over.

It's a distinct genre from everything else in this repo (no other game is
keyboard-typing driven), and the mechanics are fully deterministic, which makes
it a clean fit for TDD with Playwright.

## Mechanics

- **Falling words.** Each word has a position (`x`, `y`), a fall `speed`
  (pixels/second) and a `typed` counter (how many leading letters you've
  already matched). Words spawn at the top at a random horizontal position and
  fall straight down.
- **Targeting.** At any moment at most one word is the *active* target
  (`activeWord`).
  - When no word is active, pressing a letter key looks at every word whose
    **first** letter matches that key and locks onto the one **nearest the
    bottom** (most urgent). Its `typed` advances to 1.
  - While a word is active, only that word receives input. Pressing its next
    expected letter advances `typed`. Wrong keys are ignored (forgiving — no
    reset), so a stray keystroke never ruins a word in progress.
  - When `typed` reaches the word's length, the word is destroyed, the score
    increases, and the active target clears.
  - If the active word falls off the bottom before it's finished, the target
    clears.
- **Scoring.** Destroying a word adds `10 × word.length` points. Longer words
  are worth more.
- **Lives.** You start with 3. A word crossing the danger line at the bottom
  costs one life and is removed. At 0 lives the game ends.
- **Difficulty ramp.** A `level` value rises as you destroy words (every
  `WORDS_PER_LEVEL` kills). Higher levels spawn words more frequently and make
  them fall faster.
- **Best score.** The high score persists in `localStorage` under
  `wordblaster-best`.

## Controls

- **A–Z letter keys** — type the falling words.
- **Esc** — pause / resume. (Pause is on Escape rather than a letter so that
  every letter key stays free for typing words — including words containing
  `p`.)
- **Any letter** or the **Start button** — begin a new game (or restart after
  game over).

## Game states

`idle` → `running` ⇄ `paused`, and `running` → `over`. The overlay is visible
in every state except `running`.

## Rendering

Plain HTML5 canvas (no libraries). Each word is drawn as text: the portion
you've already typed is highlighted (green), the remaining letters are white.
The active word gets an extra glow/underline so you can see your current
target. A dashed danger line sits near the bottom. The HUD shows score, best
and remaining lives.

## Test hooks

Following the repo convention (see `Snake/game.js`), all mutable state and the
key functions are declared as top-level `let`/`function` in a classic (non
-module) script, so they're reachable from Playwright via `page.evaluate`:

- State: `words`, `activeWord`, `score`, `best`, `lives`, `level`, `state`.
- Functions: `startGame()`, `endGame()`, `spawnWord(text, x)`, `update(dtMs)`,
  `typeKey(ch)`.
- Constants: `WORD_LIST`, `SCORE_PER_LETTER`, `START_LIVES`, `DANGER_Y`,
  canvas `WIDTH`/`HEIGHT`.

`update(dtMs)` advances the simulation by an explicit millisecond delta so
tests can force words to fall a precise amount without relying on wall-clock
timing.

## Assumptions

These were ambiguous in the brief; the simpler interpretation was chosen and
recorded here per instructions:

1. **Typing is case-insensitive** and words are lowercase `a–z` only — no
   punctuation, spaces or capitals to worry about.
2. **Mistypes on the active word are ignored** rather than resetting progress.
   This is more forgiving and keeps input handling simple.
3. **Targeting picks the word nearest the bottom** on a first-letter match,
   because that word is the most urgent. Ties are broken by first-encountered
   in the array.
4. **Words fall straight down** at a constant per-word speed; no horizontal
   drift or curving paths.
5. **Three lives**, one lost per word that crosses the danger line — no partial
   credit for partially typed words.
6. The word list is a fixed built-in array of common short/medium English
   words; there is no external dictionary or network access.
