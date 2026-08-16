# Curling

A four-end curling match against the computer, on one sheet of ice. Slide your
stones toward the house, curl them around guards, take out the rival's rocks
and sweep to squeeze out the last few feet.

Open `index.html` in a browser — no build step or server required.

![Curling](screenshot.png)

## How to play

Each end you and the rival deliver four stones each, alternating. When all
eight have been thrown, whoever has the stone nearest the button scores — one
point for every one of their stones closer than the rival's best. Most points
after four ends wins the match.

A delivery is three decisions:

1. **Where to aim.** Move the broom with the mouse (or <kbd>↑</kbd> /
   <kbd>↓</kbd>). The dashed line shows the path the stone starts on.
2. **Which handle.** <kbd>←</kbd> and <kbd>→</kbd> set the curl. A stone with a
   handle bends more and more as it slows, so aim wide and let it come back.
3. **How hard.** <kbd>Space</kbd> (or a click) starts the power meter swinging;
   press again to throw at whatever it reads.

While the stone is running, hold <kbd>Space</kbd> to sweep: swept ice is
slicker, so the stone travels further and curls less. You get three seconds of
sweeping per delivery — the blue bar shows what's left.

| Key | Action |
|---|---|
| Mouse / <kbd>↑</kbd> <kbd>↓</kbd> | move the broom |
| <kbd>←</kbd> <kbd>→</kbd> | set the handle (curl direction) |
| <kbd>Space</kbd> / click | arm the power meter, then deliver |
| <kbd>Space</kbd> (held) | sweep the running stone |
| <kbd>P</kbd> | pause / resume |

## Rules in this version

- A delivered stone that stops short of the **hog line** is removed. One
  knocked back over it by a hit stays in play.
- A stone past the **back line**, or touching a **side line**, is out of play.
- A stone counts if any part of it touches the outer ring of the house.
- **Hammer** (last stone) starts with the rival. The side that scores gives up
  the hammer for the next end; a blank end leaves it where it was.
- Four ends. A tied match is reported as a tie — there is no extra end.

The line score under the sheet records what happened in each end, and the
number of matches you have won is kept in `localStorage`.

## Tests

Playwright specs live in `tests/`:

```powershell
npx playwright test Curling/tests/
```

They drive the game through the same `step(dt)` the animation loop uses, so
friction, curl, sweeping, collisions, out-of-play rules, scoring, the hammer
and the whole match flow are all checked deterministically.

See [DESIGN.md](DESIGN.md) for how the code is put together.
