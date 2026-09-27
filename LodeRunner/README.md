# Lode Runner

A grid platformer about stealing gold out from under a guard patrol, built with
plain HTML5 canvas and JavaScript — no build step, no dependencies. You cannot
jump and you cannot fight. What you *can* do is **dig**: blast the brick beside
your feet and leave a hole for a guard to fall into, then sprint across its head
while it struggles out.

Collect every bar of gold and the hidden escape ladders light up. Climb to the
top of the screen and you are away.

Inspired by the 1983 Brøderbund classic.

![Lode Runner screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / → (or A / D) | Run left / right |
| ↑ / ↓ (or W / S) | Climb a ladder, or drop off a bar |
| Z (or `,`) | Dig down-left |
| X (or `.`) | Dig down-right |
| Space | Start / restart the game |
| P / Esc | Pause / resume |

- **Gold** is collected by running over it. Take every bar and the hidden ladders
  down the side walls become climbable — reach the **top row** to clear the level.
- **Digging** only works on plain brick — the reddish blocks — and only from firm
  footing, never from a ladder or a bar. Grey stone cannot be dug.
- A hole **fills itself back in after five seconds**, flashing before it closes. A
  guard still in it is buried and respawns at its post — and so are you, if you
  are standing in your own hole.
- A trapped guard is solid ground: you can run straight over its head.
- Touching an untrapped guard costs a life. You have three; the score and the gold
  you already banked survive a death.
- Three levels, then you escape for good. Your best score is saved in the
  browser's `localStorage`.

### Scoring

| Event | Points |
|---|---|
| Bar of gold | 100 |
| Guard trapped | 50 |
| Guard buried | 100 |
| Level cleared | 500 + 100 per life left |

## Development

Lode Runner follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test LodeRunner/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the level maps are
written, and how the simulation is kept deterministic for testing.
