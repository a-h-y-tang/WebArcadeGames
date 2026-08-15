# Curling

A match of curling on a top-down sheet of ice. Deliver your stones from the
hack, sweep them down the sheet, and finish nearer the button than the computer
rink.

Open `index.html` in any browser — no build step or server needed.

## How to play

Each end, you and the computer alternate throwing four stones each. When all
eight have come to rest, whoever has the stone nearest the button scores one
point for every stone of theirs closer than the opponent's best. Three ends
decide the match.

A shot is three choices, then one live decision:

1. **Aim** — swing the line of delivery left or right.
2. **Weight** — how hard you throw. Too light and the stone is removed for not
   reaching the hog line; too heavy and it runs through the back of the house.
3. **Handle** — an in-turn or an out-turn makes the stone curl right or left as
   it slows. Straight is the default.
4. **Sweeping** — once the stone is on its way, hold the key or the mouse
   button to sweep. A swept stone runs further *and* curls less, which is how
   you rescue a shot that was thrown a little light or a little wide.

The white dashed ring marks the stone currently lying shot.

## Controls

| Input | Action |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> or mouse move | Aim |
| <kbd>↑</kbd> <kbd>↓</kbd> | Weight |
| <kbd>Q</kbd> / <kbd>E</kbd> | Out-turn / in-turn handle (press again for straight) |
| <kbd>Space</kbd> or click | Deliver — then hold to sweep |
| <kbd>P</kbd> | Pause |
| <kbd>R</kbd> | Restart the match |

## Tactics

The computer takes out your shot stone whenever you are lying nearest the
button, and it aims in a straight line. So the classic curling play works here:
throw a **guard** short of the house first (about 50% weight), then draw in
behind it. A stone the rink cannot see is a stone it cannot remove.

Weight 58% with no handle is a dead-weight draw to the button — a good shot to
learn first, and a good reference point for everything else.

## Scoring notes

- A stone counts as being in the house if any part of it overlaps the outer
  ring, so a stone "biting" the twelve-foot still scores.
- An end with nothing in the house is a blank end: nobody scores, and the
  throwing order stays as it was.
- Whoever scores throws first in the next end, giving up the hammer.

Your best match score is kept in `localStorage`.

## Tests

```powershell
npx playwright test Curling/tests/
```

81 Playwright tests cover the physics, the boundary rules, collisions, scoring,
match flow and the computer opponent. See `DESIGN.md` for how the code is put
together.
