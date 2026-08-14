# Lode Runner

A grid platformer in the spirit of the 1983 classic. You cannot jump and you
cannot fight — all you have is a drill that melts one brick out of the floor
beside you. Grab every gold chest on a level, then climb the escape ladders that
appear off the top of the screen.

Open `index.html` in a browser. No build step, no server.

## How to play

1. Run and climb around the level collecting the gold chests.
2. Guards home in on you constantly. Outrun them, or drill a hole in the floor
   ahead of one and let it drop in — then run over its head while it struggles.
3. A drilled hole seals itself after about five seconds. Anything still in it is
   crushed: a guard dies and respawns, and so do you, so don't bury yourself.
4. When the last chest is taken, the hidden escape ladders (green) light up.
   Climb one to the top row to clear the level.

Three lives, three levels. Your best score is remembered in the browser.

## Controls

| Input | Action |
|---|---|
| `←` `→` / `A` `D` | Run, or move along a rope |
| `↑` `↓` / `W` `S` | Climb a ladder, drop off a rope |
| `Z` or `,` | Drill down-left |
| `X` or `.` | Drill down-right |
| `Space` | Start / restart |
| `P` | Pause |

## Scoring

| Event | Points |
|---|---|
| Gold chest | 100 |
| Guard crushed by a refilling brick | 75 |
| Level cleared | 500 |

## Tiles

| Look | Meaning |
|---|---|
| Orange brick | Diggable floor |
| Grey stone | Bedrock — drill-proof |
| Gold ladder | Climb it |
| Thin rope | Hang and traverse; you never fall while holding on |
| Green ladder | Escape ladder, visible only once all the gold is gone |

## Development

`DESIGN.md` explains how the code works. Tests are Playwright specs in
`tests/`, run from the repository root:

```powershell
npx playwright test LodeRunner/tests/
```
