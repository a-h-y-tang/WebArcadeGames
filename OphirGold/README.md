# Ophir Gold

*"They sailed to Ophir and brought back 420 talents of gold, which they delivered
to King Solomon."* — 1 Kings 9:28

A single-screen dig-and-climb platformer. Gather every nugget of gold from the
mines of Ophir for the building of Solomon's temple, then climb the ladders that
appear at the top of the mine — while the rock badgers that live in the crags
(Proverbs 30:26) scamper after you.

Open `index.html` in any browser — no build step, no server.

![Ophir Gold](screenshot.png)

## How to play

You cannot jump and you cannot fight. You run, you climb ladders, you swing
along ropes — and you drill. `Z` and `X` bore a hole through the brick
diagonally below you, opening a route down to the next floor and, more
importantly, a trap.

A rock badger that walks into a hole is stuck for a few seconds. If the brick
knits itself back together while the badger is still inside, it scrambles away
and reappears at the top of the mine. Trapped badgers are harmless, so a hole
with a badger in it is also a safe patch of floor to run over.

The same brick will crush you. Dig yourself into a pit you cannot walk out of
and you lose a life — and a life costs you the whole level, gold included.

Collect the last bar and the escape ladders light up at the top of the screen.
Reach the top row and the level is yours.

## Controls

| Input | Action |
|---|---|
| `←` `→` or `A` `D` | run, or move along a rope |
| `↑` `↓` or `W` `S` | climb a ladder; `↓` lets go of a rope |
| `Z` or `,` | dig down-left |
| `X` or `.` | dig down-right |
| `Space` / `Enter` | start, or restart after game over |
| `P` | pause |

## Scoring

| Event | Points |
|---|---|
| Gold bar | 250 |
| Badger sent scrambling | 75 |
| Level cleared | 1500 |

Three levels ship with the game and repeat with faster badgers. Badgers never
quite match your running speed, so any level can be survived on foot. Your best
score is remembered in the browser.

## Tips

- Ropes catch you mid-fall. Dropping past one on purpose costs less time than
  walking around, but you have to hold `↓` to keep going through it.
- Badgers head towards you, so you can lead them onto a hole you have already
  dug rather than digging under one that is already on top of you.
- A brick takes five seconds to knit back. Dig too early and the badger climbs
  straight back out.

## Development

See `DESIGN.md` for the movement model, the guard pathfinding and the tile
format for levels. The Playwright suite lives in `tests/` and was written before
the implementation:

```powershell
npx playwright test OphirGold/tests/
```

It includes three end-to-end specs that actually play each shipped level to
completion with the real physics, so a layout can never regress into being
unwinnable.
