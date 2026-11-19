# Scribe's Crossword — design

> "Ezra had set his heart to study the Law of the LORD, and to do it, and to
> teach his statutes and judgments in Israel." — Ezra 7:10

## Concept

A crossword puzzle whose every answer comes from the Bible — people, places,
books and things, from the ark to the empty tomb. The player sits at a scribe's
desk: the grid is a sheet of parchment, the clues are read down the side, and a
finished grid is a finished scroll.

Nothing in the collection yet is a crossword (Bible Words is a five-letter
deduction game, Words of Life is a typing game), so this adds a genre rather
than another variation.

The puzzles are **generated at run time** from a bank of 183
answer-and-clue pairs, in the "criss-cross" style: words interlock at shared
letters and the cells that are not part of a word stay blank parchment. A
seeded PRNG builds the grid, so a seed always produces the same scroll, and
*New Scroll* produces a different one.

## Mechanics

### Generating a scroll

`buildPuzzle(level, seed)` lays words down one at a time:

1. Candidates are the bank entries that fit the grid (`answer.length <= cols`),
   shuffled by the seeded PRNG and then sorted longest-first so the first word
   is a long spine.
2. The first word goes across the middle of the grid, centred.
3. Every later word is tried in every position where one of its letters falls on
   a letter already on the grid. A placement is legal when
   - it stays inside the grid,
   - every cell it covers is empty or already holds the same letter,
   - the cells immediately before and after it on its own axis are empty,
   - and for every cell it covers that is *not* a crossing, both perpendicular
     neighbours are empty.
   Those last two rules are what keep stray two-letter runs from appearing, so
   **every maximal run of two or more letters on the finished grid is one of the
   placed answers** — the invariant the test suite checks directly.
4. Among the legal placements the generator prefers the one with the most
   crossings (ties broken by the PRNG), which keeps the scroll compact.
5. Generation stops at the level's target word count. The whole build is retried
   with fresh shuffles (up to 60 attempts) until it reaches the target, and the
   best attempt is kept, so a scroll always has at least the level's minimum.

The finished block of words is then slid so that it sits centred on the grid —
the generator grows wherever it can, and centring makes the result look
deliberate. Entries are then numbered the way a newspaper numbers them: scan the grid in
reading order, and every cell that begins an across run or a down run of two or
more letters takes the next number. A cell that begins both shares one number.

### Levels

| Level | Grid | Longest answer | Target words | Minimum |
|---|---|---|---|---|
| Short scroll | 9 × 9 | 7 | 10 | 8 |
| Long scroll | 11 × 11 | 8 | 14 | 11 |
| Great scroll | 13 × 13 | 9 | 18 | 14 |

### Playing

- The grid is drawn on a 460 × 460 canvas; cell size follows the level, so the
  board always fills the same square.
- One cell is **selected** and one **direction** is current. The selected cell is
  outlined in gold and the rest of the current entry is washed in a lighter
  parchment tone, so it is always clear which clue is being answered.
- The current clue is printed in a banner above the grid, and highlighted in the
  Across / Down lists below it.
- Typing a letter writes it into the selected cell and steps one cell along the
  current direction, stopping at the end of the entry. Backspace clears and steps
  back. Lower case is written as capitals, and anything that is not a letter is
  ignored.
- Clicking a cell selects it. Clicking the selected cell again turns the
  direction, as does **Space** — but only when the cell really has an entry in
  the other direction.
- An **on-screen keyboard** (A–Z and a rub-out key) writes the same letters, so
  the scroll can be filled in on a tablet or phone with no keyboard attached.
- **Tab** / **Shift+Tab** move to the next and previous entry in numbered order,
  **arrow keys** move a cell at a time (skipping blank parchment), **Escape**
  clears the selection.
- **Check** marks every wrong letter in red for a few seconds and says how many
  are wrong; it never fills anything in. **Reveal Letter** writes the correct
  letter into the selected cell and counts a hint. **Reset** empties the grid,
  **New Scroll** generates another one, and the level buttons switch scrolls.
- Each time a word comes out right the status line says so and counts down how
  many are left, so there is a little feedback without giving anything away.
- The scroll is finished the moment every letter cell holds the right letter: an
  overlay congratulates the scribe and offers the next scroll. After that,
  typing does nothing.

### Controls

| Input | Action |
|---|---|
| Click a cell | Select it (click again to turn the direction) |
| Click a clue | Jump to the first cell of that entry |
| A–Z | Write a letter and step along |
| Backspace / Delete | Clear and step back |
| Arrow keys | Move one cell |
| Space | Turn across ↔ down |
| Tab / Shift+Tab | Next / previous entry |
| Escape | Clear the selection |
| On-screen keyboard | The same letters, and a rub-out key |
| Buttons | Check, Reveal Letter, Reset, New Scroll, level |

Letter keys all type into the grid, so — unlike the other puzzle games here —
there are no single-letter shortcuts for hint or new puzzle; those are buttons.

## Code shape

One plain script, `game.js`, no build step and no dependencies, matching the
rest of the collection. The pure parts (word bank, placement rules, numbering)
and the live state are plain globals so the Playwright suite can read them:

| Global | What it is |
|---|---|
| `puzzle` | `{ cols, rows, grid, entries, seed }`; `grid[r][c]` is the solution letter or `null` |
| `entries` | each `{ num, dir, r, c, len, answer, clue, cells }` |
| `letters` | the player's grid, `''` where empty |
| `selection` | `{ r, c, dir }` or `null` |
| `levelIndex`, `hintsUsed`, `solved` | HUD state |
| `cellCentre(r, c)` | canvas coordinates of a cell's centre, for clicks |
| `WORD_BANK`, `LEVELS` | the data behind a scroll |
| `buildPuzzle(level, seed)` | builds a scroll without touching the page, for the tests |

Rendering is a single `draw()` over the whole canvas, called after every input —
there is no animation loop to keep running, which also keeps the tests quiet.

## Content

Every answer and clue is drawn from the Bible and checked against it; the bank
holds people (Moses, Ruth, Lydia), places (Sinai, Jericho, Corinth), books
(Genesis, Acts), and things (manna, mustard, armour). Nothing in the bank
touches gambling, alcohol, the occult or anything crude, per the repository's
content policy: clues about the Lord's supper and the wedding at Cana are
deliberately left out of the bank rather than phrased around.

## Assumptions

Made without asking, as the brief directs:

1. **Criss-cross rather than newspaper symmetry.** A generated grid cannot also
   be guaranteed rotationally symmetric with a bank this size, so blank cells
   are simply unused parchment and the grid has no black squares. This is the
   simpler interpretation and it keeps every puzzle solvable from the clues.
2. **Generated, not hand-authored.** Three hand-built grids would be the same
   three puzzles forever; a seeded generator gives a fresh scroll each visit and
   is far better served by tests, which can assert the interlocking rules rather
   than spot-check a fixed grid.
3. **No auto-advance between entries.** When an entry is filled the cursor stays
   on its last cell instead of jumping to the next clue; jumping is explicit
   (Tab, or clicking a clue). Predictable, and much easier to test.
4. **Answers are letters only** — no spaces, hyphens or punctuation in the bank,
   so a cell is always exactly one A–Z letter.
5. **Clue difficulty is uniform.** Levels differ by grid size and word count
   only, not by a separate easy/hard clue bank.
6. **Check is advisory.** It highlights wrong letters but never corrects them, so
   it cannot be used to solve the puzzle by repeated pressing; only *Reveal
   Letter*, which is counted, gives anything away.
