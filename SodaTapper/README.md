# Soda Tapper

Keep four bars of thirsty customers happy without losing a mug.

![Soda Tapper](screenshot.png)

## Playing

Open `index.html` in a browser — no build step or server needed.

## How to play

You are the bartender at the right-hand end of four bars. Customers come in
through the doors on the left and walk toward you.

- **Pour a soda** down the bar you are standing at. The mug slides toward the
  customers.
- A customer who catches a mug **stops to drink and is pushed back** down the
  bar. Keep pouring: push them clean off the far end and they are served.
- A served customer **slides their empty mug back** to you. Be standing on that
  bar when it reaches the glowing stretch near the taps and you will catch it.

You lose a life if:

- a mug runs off the far end of a bar (nobody there to catch it),
- a customer reaches you at the taps,
- an empty mug gets past you and smashes.

Three lives. Clear every customer in a round to bank a 500 point bonus and move
on — later rounds send more customers, faster and closer together.

## Controls

| Input | Action |
|---|---|
| `↑` / `↓` (or `W` / `S`) | Move up or down a bar |
| `Space` | Pour a soda |
| Click a bar | Move there and pour |
| `P` | Pause |
| `Space` / `Enter` | Start, or play again |

## Scoring

| Event | Points |
|---|---|
| Customer catches a mug | 25 |
| Customer served | 120 |
| Empty mug caught | 60 |
| Round cleared | 500 |

Your best score is kept in the browser's local storage.

## Development

Implementation notes are in [DESIGN.md](DESIGN.md). The Playwright suite lives
in `tests/`:

```powershell
npx playwright test SodaTapper/tests/
```
