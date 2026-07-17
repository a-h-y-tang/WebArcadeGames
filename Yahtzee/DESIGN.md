# Yahtzee — Design

## Concept

Yahtzee is the classic five-dice game. Over thirteen turns you roll five dice
(up to three times per turn, holding any dice between rolls) and bank each
result into one of thirteen scoring categories. Every category can be used
exactly once, so part of the game is deciding *where* to spend a mediocre roll.
Fill the whole scorecard and the highest grand total wins. It fills a genre gap
in the collection — no dice game exists here yet.

## Mechanics

### A turn
- A turn starts with **3 rolls available** and all dice un-held.
- **Rolling** re-rolls only the dice that are **not held**, and decrements the
  rolls-left counter. You may roll up to three times.
- Between rolls you **hold** dice you want to keep.
- Once you have rolled at least once you **bank** the dice into any unused
  category. Banking scores that category, ends the turn, and resets to a fresh
  turn (3 rolls, nothing held).

### Categories

**Upper section** — score = sum of the dice showing that face:

| Category | Scores |
|---|---|
| Ones … Sixes | sum of dice showing that number |

If the six upper categories total **63 or more**, a **35-point bonus** is added.

**Lower section:**

| Category | Scores |
|---|---|
| Three of a Kind | sum of all dice, if ≥3 of one face (else 0) |
| Four of a Kind | sum of all dice, if ≥4 of one face (else 0) |
| Full House | 25 for a 3-of-a-kind + a pair (else 0) |
| Small Straight | 30 for four consecutive faces (else 0) |
| Large Straight | 40 for five consecutive faces (else 0) |
| Yahtzee | 50 for five of a kind (else 0) |
| Chance | sum of all dice |

### End of game
After all thirteen categories are filled the game ends and the **grand total**
(all categories + the upper bonus) is shown. The best grand total is persisted
in `localStorage` under `yahtzee-best`.

## Controls

| Input | Action |
|---|---|
| Space / Enter | Start, then roll the dice |
| Roll button | Roll the dice |
| 1–5 | Toggle holding die 1–5 (after a roll) |
| Click a die | Toggle holding that die |
| Click a scorecard row | Bank the current dice into that category |
| Space / Enter | Play again after game over |

Unused categories preview the score the current dice *would* earn (in blue), so
you can weigh your options before committing.

## Architecture

Follows the repo's conventions:

- `index.html` — HUD (score / best), a canvas dice tray, the start/game-over
  overlay, a Roll button, and an HTML scorecard `<table>`.
- `style.css` — presentation.
- `game.js` — all logic with top-level state and helpers deliberately exposed
  on the global scope so Playwright can drive the game deterministically:
  - **Pure scoring:** `scoreFor(key, dice)` computes a category's value for any
    dice array — no state, no randomness, no timing — so tests build exact rolls
    and assert exact scores. `upperSubtotal()`, `upperBonus()`, and
    `grandTotal()` are likewise pure over the `scores` map.
  - **State:** `dice`, `held`, `rollsLeft`, `scores`, `turn`, `state`
    (`ready` | `running` | `over`), and `CATEGORIES`.
  - **Actions:** `startGame()`, `rollDice()`, `toggleHold(i)`,
    `scoreCategory(key)`, `endGame()`.

The dice are drawn on the canvas (with pip layouts and a highlight for held
dice); the scorecard is rendered as a DOM table whose rows are click-to-score,
keeping the interactive scoring surface accessible and easy to test.

## Assumptions

- **Simpler interpretation chosen where rules vary:**
  - **No Yahtzee bonus / Joker rules.** A second scoring Yahtzee does not earn
    extra 100-point bonuses, and a five-of-a-kind is *not* treated as a wildcard
    Full House / Straight. This is the plain scorecard; it keeps every
    category's score a pure function of the dice alone. Noted here as the
    simpler self-contained variant.
  - A Yahtzee (five of a kind) therefore scores **0** in Full House unless the
    dice literally form a 3+2 split — standard for the no-joker ruleset.
- **Forced scoring is allowed:** you may bank into any unused category at any
  time, including scoring a category as 0 to dump a bad roll (there is no
  separate "scratch" step).
- Single-player against your own best score (no CPU opponent), matching the
  solitaire spirit of the original and keeping the game deterministic.
- No sound, consistent with the other games in the repo.
