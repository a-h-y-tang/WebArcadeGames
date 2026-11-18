# Dry Land

> "And God said, Let the waters under the heaven be gathered together unto one
> place, and let the dry land appear: and it was so." — Genesis 1:9

A logic puzzle on a map of sea and islands. Every number stands on a piece of dry
land and tells you how many squares that land covers; everything else is sea.
Shade the water in, and the third day of creation takes shape on the board.

Open `index.html` in any browser — no build step, no server.

## The rules

1. Each piece of dry land holds **exactly one number** and covers **exactly that
   many squares**.
2. Two pieces of land **never touch** side by side — only corner to corner.
3. The sea is **gathered into one piece**; every square of it joins the rest.
4. The sea **never fills a whole square of four** — no 2x2 block of water.

Only the sea has to be marked. A square you leave blank counts as dry land, so
you can shade the water and stop; marking land is there to help you think.

Every map can be worked out by those four rules alone. There is never a need to
guess: each one is checked, as it is built, both for having a single answer and
for being solvable by the plain rules.

## How to play

| Input | Action |
|---|---|
| Click a square | sea → dry land → blank |
| Right-click | the same cycle the other way round |
| Drag | shade a whole run the same way |
| Finger drag | the same, on a phone or tablet |
| ← ↑ ↓ → | move the cursor |
| Space | cycle the square under the cursor |
| S / L | mark sea / dry land directly |
| Backspace | clear the square |
| H / C / U | hint, check, undo |
| N / R | new map, reset this one |

| Button | What it does |
|---|---|
| **New map** | A fresh map of the same size |
| **Reset** | Clears your marks, keeps the map |
| **Undo** | Takes back the last mark, or the last drag |
| **Hint** | Fills in one square **and names the rule that settles it** |
| **Check** | Rings every mark that cannot be right, in red, for a few seconds |

Three sizes — Small 7x7, Medium 9x9, Large 11x11 — each with its own best time,
kept in the browser.

## Worked example

A `1` is the easiest number on the map: its land is that square and nothing else,
so all four squares around it are sea. Then look for a square of water three
corners deep — the fourth corner has to be dry, because the sea may not fill a
square of four. Between those two rules and "a square no island can reach is
sea", most of a small map falls out without a single guess.

If you get stuck, **Hint** will tell you which rule applies next, in those words.

## Files

| File | What it holds |
|---|---|
| `index.html` | Page, HUD, controls and overlay |
| `style.css` | The panel, the map and the controls |
| `game.js` | Map generation, both solvers, play, input and drawing |
| `DESIGN.md` | How a map is built and checked, and the assumptions behind it |
| `tests/` | The Playwright suite |

## Tests

From the repository root:

```powershell
npx playwright test DryLand/tests/
```

55 tests cover the board and HUD, marking by click, right-click, drag and
keyboard, the four rules checked against generated maps, single-answer and
logic-solvable generation, hints, checking, undo, reset, the clock and best
times, all three sizes, and the drawing.
