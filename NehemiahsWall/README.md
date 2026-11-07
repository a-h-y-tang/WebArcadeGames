# Nehemiah's Wall

*"Those who carried materials did their work with one hand and held a weapon in
the other."* — Nehemiah 4:17

A siege game on an HTML5 canvas, themed on Nehemiah rebuilding the walls of
Jerusalem while enemies tried to stop the work. You hold the towers of a city by
the water; raiders' boats stand off the shore and bombard your walls. Between
attacks you are handed stones in wall-piece shapes and have to close the ring
again — because when the round ends, the enemy pours in through any gap, and a
tower it can reach is lost.

![Nehemiah's Wall](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| Mouse move | move the cursor |
| Left click | place a catapult / fire / place a wall piece |
| Right click | rotate the wall piece |
| `←` `↑` `↓` `→` / `WASD` | move the cursor |
| `Space` | act at the cursor (also starts the game when idle or after game over) |
| `R` | rotate the wall piece |
| `P` | pause / resume |

## How to play

Every round runs through the same three phases. The clock in the HUD tells you
which one you are in and how long it has left.

**Place catapults (10 s).** The ground you enclose is tinted. Drop 2 × 2 catapults on
it — you get two, plus one for every tower you currently hold. The cursor shows
green where a catapult fits and red where it does not. Catapults stay on the board
between rounds, so a quiet round builds a battery.

**Defend (30 s).** Boats sail in from the west and anchor off the coast. Their
guns stay quiet while they are still out at sea and open up over the last stretch
of the run in — that approach is your window. Click a boat and *every* loaded
catapult in range fires at that point at once; driving one off is worth 200 points. Boats
that live long enough start shelling, and each shell blows a small crater in your
stonework — and in any catapult it lands on.

From round 4 the raiders arrives armoured and takes more than one ball to sink, and
the boats come thicker and faster the longer you hold out.

Your own shells destroy your own walls too. Firing across your ramparts at
something just behind them will punch a hole in your own ring, so pick targets in
open water where you can.

**Rebuild (25 s, shorter every round).** You are dealt wall pieces one at a time,
tetromino-shaped, with the next one shown in the corner. Place them on open land
to close the holes; the grey rubble marks show you exactly where the wall used to
be. Pieces cannot overlap anything already standing, so a one-cell pinhole either
waits for the single-cell piece or gets bypassed with a small bulge around it.

**The checkpoint.** When the repair clock runs out the board floods from its
edges. Every tower the flood cannot reach survives and pays 150 points; the
round counter ticks up and the raiders comes back larger. If the flood reaches all
three towers, the city has fallen.

## Strategy

- **Drive off boats early.** Damage you prevent is repair time you keep. The window
  between a boat anchoring and its first shot is the most valuable few seconds in
  the round.
- **Shrink, don't sprawl.** A tight ring around one tower takes about sixteen
  cells to close. If the round went badly, abandon the outer wall and draw a
  small ring you can actually finish.
- **Then sprawl.** Once you are comfortable, wall in a second tower: it pays a
  bonus every round *and* grants another catapult each placement phase.
- **Watch the water.** Enclosed sea is enclosed, but you cannot build a catapult on
  it. A ring drawn out over a bay holds a tower but gives you nowhere to put
  guns.

## Development

Tests live in `tests/` and run with Playwright from the repo root:

```powershell
npx playwright test NehemiahsWall/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
