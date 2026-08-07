# Burger Time

An arcade maze game in the style of the 1982 Data East classic. You are Chef
Peter Pepper, loose in a lattice of platforms and ladders draped with the parts
of four giant hamburgers. Walk the full width of an ingredient and it drops down
the shaft, sweeping every piece below it along the way, until the burger lands
assembled on the plate at the bottom.

Three animated foods — a hot dog, a fried egg and a pickle — hunt you through the
same lattice the whole time.

## Playing

Open `index.html` in any browser. No build step, no server.

## Controls

| Input                     | Action                                   |
|---------------------------|------------------------------------------|
| ← / → or A / D            | Walk left / right along a floor          |
| ↑ / ↓ or W / S            | Climb a ladder (only on a ladder column) |
| Space                     | Throw pepper (also starts the game)      |
| Enter / Start button      | Start or restart                         |
| P                         | Pause / resume                           |

## How it works

- Each ingredient is split into **three segments**. Standing on a segment presses
  it down; press all three and the ingredient falls.
- A falling ingredient runs all the way to its plate and **knocks loose anything
  resting below it**, so a well-timed top bun can clear a whole shaft in one go.
- Assemble all four burgers to clear the level.

## Fighting back

- **Squash them.** Any enemy caught under a falling ingredient is flattened for
  100 points. It comes back four seconds later.
- **Pepper them.** Space throws a cloud in the direction you are facing that
  freezes anything inside it for three seconds — long enough to walk past. You
  start with five shots and earn one more per level, up to nine.

Touching an enemy that is neither squashed nor frozen costs a life. You have
three. Burger progress survives losing a life.

## Scoring

| Event                    | Points |
|--------------------------|--------|
| Ingredient knocked loose | 50     |
| Enemy squashed           | 100    |
| Level cleared            | 1000   |

Your best score is saved in the browser.

## Levels

Every level reuses the same lattice but fields a larger, faster pack of enemies —
two on level 1, up to five, each level adding 8 px/s to their speed.

## Development

Design notes are in [DESIGN.md](DESIGN.md). The Playwright suite lives in
`tests/` and is run from the repository root:

```powershell
npx playwright test BurgerTime/tests/
```
