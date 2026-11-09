# Feast of Booths

> "You shall dwell in booths seven days ... that your generations may know that
> I made the children of Israel to dwell in booths when I brought them out of
> the land of Egypt." — Leviticus 23:42-43

A quiet logic puzzle about keeping the feast. The camp is a grid of sand with
palm trees scattered through it; your task is to pitch a booth of palm branches
beside every palm, working out where they go from the counts along the edges.

Open `index.html` in any browser — there is no build step and no server.

## How to play

Each palm tree needs exactly one booth of its own, and each booth belongs to
exactly one palm.

1. **A booth stands beside its palm** — directly above, below, left or right of
   it. A palm on the diagonal does not count.
2. **No two booths touch**, not even at a corner. Every camp needs room.
3. **The numbers count booths.** The figure at the left of a row, or the top of
   a column, is the number of booths in that row or column.

A palm may be beside more than one booth, but only one of them can be *its*
booth, so every palm must end up with a booth to call its own.

### Controls

| Action | Effect |
|---|---|
| Click an open square | Pitch a booth |
| Click again | Brush the square to sand — your "no booth here" mark |
| Click a third time | Clear the square |
| Right-click | Walk the same three states backwards (straight to sand) |
| **Small / Middle / Large camp** | Choose an 8×8, 10×10 or 12×12 camp |
| **Reset** | Clear every mark and keep the same camp |
| **New Camp** | Generate a fresh camp of the same size |
| **Hint** | Pitch one booth from the answer, and sweep the squares around it to sand |

A row or column count turns **green** when the number of booths in it is right,
and **red** when there are too many. Booths that touch each other, or that stand
nowhere near a palm, are ringed in red while you work. The camp is complete the
moment every count is met, no two booths touch and every palm has a booth of its
own.

## Camps

| Camp | Grid | Booths |
|---|---|---|
| Small | 8 × 8 | 10 |
| Middle | 10 × 10 | 15 |
| Large | 12 × 12 | 22 |

Every camp is built by a seeded generator, and a camp is only dealt out once it
has been checked to have exactly one answer **and** to be solvable by deduction
alone. You will never be left guessing between two equally good layouts, and you
will never need to guess to make progress.

## Tests

```powershell
npx playwright test FeastOfBooths/tests/
```
