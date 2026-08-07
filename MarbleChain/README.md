# Marble Chain

A marble shooter in the Zuma tradition. A chain of coloured marbles crawls along a
spiral track toward the pit at the centre of the board. You sit in the middle,
firing marbles into the chain — land three or more of a colour together and they
blow up. Clear the whole chain before its head reaches the pit.

![Marble Chain](screenshot.png)

## Playing

Open `index.html` in a browser. No build step, no server.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim |
| Click | Fire |
| `←` / `→` | Aim left / right |
| `Space` | Fire (also starts the game) |
| `S` / right-click | Swap the loaded marble with the next one |
| `P` | Pause / resume |

## Rules

- Marbles pour out of the tunnel at the top of the board and crawl toward the pit.
- Firing a marble into the chain wedges it in wherever it lands.
- Three or more of the same colour touching are destroyed for **10 points each**.
- If the marbles that close the gap also match, they blow too — a **combo**, worth
  double on the second blast, triple on the third, and so on.
- Clearing every marble in the level pays a bonus of **250 × level** and starts the
  next one, which is faster and holds more marbles.
- The loaded marble is always a colour that is still on the track, so you can never
  be handed something useless.
- The game ends the moment the leading marble drops into the pit. The halo around
  it turns red as it gets close.

Your best score is remembered in the browser's local storage.

## Development

Tests are Playwright specs in `tests/`:

```powershell
npx playwright test MarbleChain/tests/
```

`DESIGN.md` explains how the code works — the spiral path sampling, the packed
chain model, insertion and the combo resolver.
