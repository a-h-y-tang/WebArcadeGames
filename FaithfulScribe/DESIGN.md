# Faithful Scribe — design notes

> *"Take a scroll and write on it all the words I have spoken to you."* — Jeremiah 36:2

## Concept

A typing arcade game. Blank scrolls drift down from the top of the scriptorium
toward the scribe's desk; each one carries a single word taken from Scripture.
Copy a scroll by typing its word before it reaches the desk. Every word copied
is ink on the page and points on the board; every scroll that lands on the desk
un-copied snuffs out one of the scribe's candles. Three candles out and the
day's work ends.

Nothing else in the repository is driven by typing, so the whole game is played
on the letter keys — no aiming, no steering, no reflex clicks.

## Mechanics

### The scriptorium

* The canvas is 640x420. A desk occupies the bottom strip; its top edge is the
  **baseline** at `BASELINE_Y`. A scroll whose bottom edge touches the baseline
  has landed and is lost.
* Scrolls are spawned at the top at a random x that keeps the whole parchment on
  the canvas, and fall at a constant speed for their chapter.
* At most `MAX_SCROLLS` (7) scrolls are in the air at once; spawning pauses while
  the desk is that full.
* When a word is picked, the game prefers one whose first letter is not already
  the first letter of a scroll in the air, so the first keystroke is never
  ambiguous.

### Typing

* Typing a letter when nothing is locked **locks** the lowest (most urgent)
  scroll whose first letter matches, and counts as the first copied letter.
* While a scroll is locked, every letter is checked against the next letter it
  needs. A correct letter advances the copy; a wrong one is a **blot**: the
  combo drops to zero, but the lock and the letters already copied are kept.
* `Escape` releases the lock so another scroll can be started. With nothing
  locked, `Escape` pauses and resumes the game.
* Letters are compared case-insensitively, so proper nouns can be displayed with
  a capital (`Jerusalem`) and still be typed in lower case.

### Scoring

* A finished word scores `word.length * 10 * multiplier`, where the multiplier is
  `min(5, 1 + floor(combo / 5))` using the combo *before* the word is counted.
  So the fifth word in a streak starts paying double, the tenth triple, and so on.
* The combo rises by one per word copied, and resets to zero on a blot or a
  landed scroll.

### Chapters

* Copying `WORDS_PER_CHAPTER` (8) words finishes a chapter. Each new chapter
  falls faster, spawns sooner and draws on longer words:
  `maxLen(chapter) = min(20, 4 + 2 * chapter)`.
* Finishing a chapter lights one candle back, up to `MAX_CANDLES` (5).

### Candles and the end of the day

* The scribe starts with `START_CANDLES` (3) candles. A landed scroll costs one.
* At zero candles the game ends, the overlay shows the score and the words
  copied, and the best score is kept in `localStorage` under
  `faithful-scribe-best`.

## Controls

| Input | Action |
|---|---|
| Letter keys | Copy the locked scroll, or lock the lowest scroll starting with that letter |
| `Escape` | Release the locked scroll; with nothing locked, pause / resume |
| `Space` or `Enter` | Start a new day from the title or game-over overlay |
| Click / tap the canvas | Focus the hidden text field so a phone keyboard appears |
| Start button | Start, or resume from pause |

## Code structure

Plain `index.html` + `style.css` + `game.js`, no build step, matching the rest of
the repository. `game.js` is a classic (non-module) script, so its state and
functions are reachable from the Playwright tests as plain globals.

* **Constants** — geometry, difficulty curve, vocabulary (`WORDS`).
* **State** — `state` (`idle` / `running` / `paused` / `over`), `score`, `best`,
  `combo`, `candles`, `chapter`, `copied`, `scrolls`, `lockIndex`, `spawnTimer`.
* **Pure helpers** — `multiplier(combo)`, `wordScore(word, combo)`,
  `maxLen(chapter)`, `fallSpeed(chapter)`, `spawnInterval(chapter)`,
  `pickWord()`.
* **Simulation** — `step(dt)` advances every scroll, spawns new ones and retires
  landed ones. All motion is expressed per second and the real-time loop only
  ever calls `step(dt)`, so the tests can simulate any number of frames
  deterministically without waiting on `requestAnimationFrame`.
* **Input** — `typeChar(ch)` is the single entry point for a typed letter and
  returns `'lock' | 'hit' | 'word' | 'blot' | 'ignored'`; the `keydown` handler
  and the hidden mobile input both funnel into it.
* **Rendering** — `draw()` paints the scriptorium, the parchment scrolls with
  their copied prefix highlighted, the desk, the inkwell and the candles. Drawing
  reads state and never changes it.

Randomness runs through a seeded `mulberry32` generator (`seed`, `rand()`), so a
test can fix the seed and get the same scrolls every run.

## Assumptions

Made without asking, as the task directs; the simpler reading was taken each time.

1. **Single words, not whole verses.** Falling verses would need line wrapping
   and a much wider canvas; single words keep the game readable at 640x420.
2. **Blots keep the lock.** Losing the lock on a typo would punish a slip twice
   (combo *and* progress). The combo reset is punishment enough.
3. **A locked scroll is the lowest matching one.** Lowest on screen is the most
   urgent, so that is the one the player almost always means.
4. **`Escape` does double duty** (release lock, else pause) because every letter
   key is taken by the game itself and `P` would be a letter in a word.
5. **Case is ignored** when matching letters; the player never needs Shift.
6. **The vocabulary is a fixed, hand-written list** of Bible words — people,
   places and virtues — rather than a generated or fetched word list, so the
   game stays a single offline folder with no data file.
7. **Words may repeat** across a long game; the list is not a draw-without-
   replacement deck.
8. **Category `Action`** in the game browser catalogue: it is a real-time,
   timed arcade game, not a puzzle to think over.
