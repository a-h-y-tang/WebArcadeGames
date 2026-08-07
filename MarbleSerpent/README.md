# Marble Serpent

A serpent of coloured marbles crawls along a winding track toward the pit at its
end. You sit in the middle with a cannon. Fire marbles into the line, match three
or more of a colour to pop them, and clear the whole serpent before its head
reaches the pit.

Open `index.html` in any browser — no build step or server required.

## How to play

- **Aim** with the mouse (or <kbd>←</kbd> / <kbd>→</kbd>).
- **Fire** by clicking, or with <kbd>Space</kbd>.
- **Swap** the loaded marble with the one behind it with <kbd>S</kbd>.
- **Pause** with <kbd>P</kbd>.
- Press <kbd>Space</kbd> or click **Start Game** to begin.

## Rules

- A fired marble wedges itself into the serpent wherever it lands.
- Three or more touching marbles of the same colour pop for 10 points each.
- Popping splits the serpent. The tail then sprints forward to close the gap —
  if the colours that meet make another three, they pop too, and each pop in the
  same cascade is worth a higher multiplier (`x2`, `x3`, …).
- Clear every marble to finish the level and collect a 200-point bonus. Each
  level crawls faster, is longer, and adds a new colour every other level (up to
  six).
- If the head of the serpent reaches the pit you lose a life and the level's
  serpent starts over. Three lives.
- The cannon only ever loads a colour that is still somewhere on the board, so
  you can never be handed a useless marble.
- Your best score is remembered in the browser.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell — HUD, canvas and overlay |
| `style.css` | Presentation |
| `game.js` | All game logic and rendering |
| `DESIGN.md` | How the code works, and the design decisions behind it |
| `tests/` | Playwright specs |

## Tests

From the repository root:

```powershell
npx playwright test MarbleSerpent/tests/
```
