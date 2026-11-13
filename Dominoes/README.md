# Dominoes

Classic **draw dominoes** on an HTML5 canvas: you against the computer with a
double-six set, first to 100 points.

Open `index.html` in any browser — no build step, no server, no dependencies.

## How to play

Twenty-eight bones are shuffled. You and the computer take seven each and the
remaining fourteen become the **boneyard**. The player holding the highest
double leads with it (that bone is forced, so it is played for you), and from
there you take turns adding a bone to either open end of the train so that the
touching numbers match.

- **Nothing playable?** Take a bone from the boneyard with **Draw**.
- **Boneyard empty and still stuck?** You must **Pass**.
- Two passes in a row **block** the train. The lighter hand wins and scores the
  pips left in the heavier one; level hands score nothing.
- Play your last bone — "domino!" — and you score every pip left in the
  computer's hand.
- First to **100 points** wins the match.

## Controls

| Input | Effect |
|---|---|
| Click a bone in your hand | Selects it; if it fits only one end it is played there at once |
| Click a glowing pad beside the train | Plays the selected bone at that end |
| `←` / `→` | Move the selection along your hand |
| `Enter` | Play the selected bone |
| `L` / `R` | Play it at the left / right end |
| `D` | Draw from the boneyard |
| `P` | Pass |
| Draw / Pass buttons | The same, and they enable only when the rules allow it |
| New Game | Reshuffle and start the match again at 0–0 |

Bones you cannot play are dimmed in your hand, and the two pads beside the
train light up for the ends the selected bone fits.

## The computer

It plays the heaviest bone it can, preferring doubles when two bones weigh the
same — doubles are the awkward ones to shed, so it gets rid of them early. That
makes it a solid, honest opponent: it will not throw a hand away, and it is
beatable.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page, scoreboard, buttons and rules |
| `style.css` | Dark table-side styling |
| `game.js` | Rules, computer opponent, canvas drawing and input |
| `DESIGN.md` | How the code works and the decisions behind it |
| `tests/dominoes.spec.js` | Playwright suite (47 tests) |

## Tests

From the repository root:

```powershell
npx playwright test Dominoes/tests/
```
