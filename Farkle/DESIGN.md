# Farkle — Design

## Concept

**Farkle** is the classic push-your-luck dice game. You roll six dice, set
aside the ones that score, and choose between banking your points or rerolling
the rest to chase more — but roll no scoring dice and you *Farkle*, losing
everything you had accumulated that turn. The goal is to reach **10,000
points** in as few turns as possible.

This is a **solo** implementation: a single player racing a fixed target. Your
best result — the fewest turns you've ever needed to reach 10,000 — persists in
`localStorage`.

## Scoring

The scoring core, `scoreDice(dice)`, is a pure function. It scores a set of
dice and reports whether **every** die contributed (`allUsed`), which the game
uses to validate that a set-aside selection is legal.

| Combination | Score |
|---|---|
| Single **1** | 100 |
| Single **5** | 50 |
| Three **1**s | 1000 |
| Three of a kind (face `n`, n≠1) | `n × 100` (e.g. three 4s = 400) |
| Four of a kind | 1000 |
| Five of a kind | 2000 |
| Six of a kind | 3000 |
| Straight 1-2-3-4-5-6 (all six dice) | 1500 |
| Three pairs (all six dice) | 1500 |

Dice showing **2, 3, 4, or 6** score nothing on their own — only as part of a
three-or-more-of-a-kind, straight, or three-pairs. Four/five/six of a kind pay
a flat 1000/2000/3000 regardless of the face value. The straight and
three-pairs bonuses are only recognized when all six dice are involved (they
can't occur with fewer dice anyway).

## Turn flow

1. **Roll** all your remaining dice (six at the start of a turn).
2. If the roll contains **no** scoring dice, it's a **Farkle** — you lose all
   points banked this turn and the turn ends.
3. Otherwise you must **set aside** at least one scoring die or combination.
   Click dice to select them and press **Set Aside**; the selection is only
   accepted if every selected die scores. Their value is added to your *turn
   score*.
4. Now choose:
   - **Roll** again with the dice you did *not* set aside (risking the turn
     score for more), or
   - **Bank** to add your turn score to your total and end the turn safely.
5. **Hot dice** — if you set aside all six dice, you may roll all six again
   while keeping your turn score.
6. Reach **10,000** to win.

## Controls

| Input | Action |
|---|---|
| **Roll** button / `R` / `Space` | Roll the available dice |
| Click a die / number keys `1`–`6` | Toggle its selection (while choosing) |
| **Set Aside** button / `A` | Bank the selected scoring dice into the turn score |
| **Bank** button / `B` | Add the turn score to your total and end the turn |

## State exposed for tests

All logic and mutable state live at module scope so the Playwright suite can
drive the game deterministically:

- Pure helpers: `scoreDice`, `hasScore`, `selectedScore`.
- Actions: `startGame`, `roll`, `toggleSelect`, `setAside`, `bank`.
- The dice roller is `rollNDice(n)` — a reassignable module-scope binding, so a
  test can replace it with a fixed sequence to make `roll()` deterministic.
- State: `state` (`'ready' | 'playing' | 'over'`), `turnPhase`
  (`'await-roll' | 'select'`), `dice`, `selected`, `totalScore`, `turnScore`,
  `remainingDice`, `turnNumber`, `best`, and `WIN_TARGET`.

## Assumptions

- **Solo, not vs. CPU** — The simplest faithful ruleset with a clear win
  condition (race to 10,000). No opponent AI keeps the game deterministic and
  the mechanics focused on the push-your-luck decision.
- **"Best" = fewest turns** — Since every game reaches the same 10,000 target,
  skill shows as *efficiency*. The best (lowest) turn count is persisted; a
  fresh player shows `—`.
- **No minimum to get on the board** — Some house rules require banking 500+
  before your first score counts. Omitted as an unnecessary complication; any
  banked amount counts.
- **Flat four/five/six-of-a-kind values** — 1000/2000/3000, a common and
  unambiguous schedule, chosen over the "double the triple" variants.
- **Straight and three-pairs each pay 1500** — the widespread standard values.
- **You may bank only your own accumulated turn score** — Banking is available
  once you've set aside at least one scoring combination this turn; you cannot
  bank immediately after a fresh roll without first setting dice aside.
