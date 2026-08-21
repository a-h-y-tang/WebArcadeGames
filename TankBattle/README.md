# Tank Battle

A top-down arcade tank shooter on an HTML5 canvas. You have one tank, a maze
built mostly out of brick, and a base to keep alive. Every shot — yours and
theirs — chews a hole through the walls, so the battlefield you finish a level
on is never the one you started it on.

![Tank Battle](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `←` `↑` `↓` `→` / `W` `A` `S` `D` | drive |
| `Space` | fire (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |

Holding more than one direction uses the most recently pressed key, so you can
roll from one to the next without a dead frame.

## How to play

**Defend the base.** The eagle sits at the bottom centre inside a fortress: two
layers of brick above it, steel to either side. One hit on the base and the run
is over, however many lives you have left. The steel flanks mean it can only ever
be reached from *above* — so column 9 is the ground you actually have to hold.
Watch that wall: once enemies start chewing through it you have about three shots
of warning.

**Clear the wave.** Each level fields `10 + 2 × (level − 1)` tanks, four on the
board at a time, arriving from the three spawn points along the top. Destroy them
all and the next level builds a fresh maze.

| Enemy | Worth | Watch out for |
|---|---|---|
| grey | 100 | the ordinary one |
| green | 200 | fast — it will outrun you |
| yellow | 300 | its shells travel much faster than yours |
| red | 400 | four hits to kill; the bar on its hull shows what's left |

**Use the terrain.** Brick is cover you can also delete. Steel stops everything
until your firepower is maxed. Water blocks tanks but not bullets — shoot across
it from safety. Forest hides whatever drives into it, you included.

**Pick up the drops.** Every fourth tank flashes red; kill that one and a
power-up appears somewhere on the map. It is worth 500 points and expires after
15 seconds.

| Power-up | Effect |
|---|---|
| ★ star | +1 firepower (max 3): two shots in flight, faster, and at 3 they punch through steel |
| ⛨ shield | 10 seconds of invulnerability |
| ✸ bomb | destroys every enemy on screen |
| ♥ life | one extra life |
| ⛏ shovel | turns the fortress brick to steel for 15 seconds |

Dying costs you your firepower as well as a life, so the star is worth guarding.

**A warning.** Nothing stops you shooting your own fortress. Three shots straight
down into it from above and you have ended your own game.

## Scoring

- Enemy tanks: 100 / 200 / 300 / 400 by type
- Power-up collected: 500
- Level cleared: 200 × level

Your best score is kept in the browser's local storage.

## Tests

```powershell
npx playwright test TankBattle/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
