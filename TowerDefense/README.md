# Tower Defense

A tower defense game on an HTML5 canvas. A road cuts across the map from west to
east and creeps march down it wave after wave. You never touch a creep directly —
you spend gold on towers planted in the grass beside the road, and let them do the
work. Hold all twenty waves to win; leak twenty lives and the run is over.

![Tower Defense](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `1` `2` `3` | pick Arrow / Frost / Cannon as the tower to build |
| Click grass | build the selected tower on that tile |
| Click a tower | select it — its range ring, upgrade price and sell value appear |
| `U` | upgrade the selected tower |
| `S` | sell the selected tower |
| `Esc` | clear the selection |
| `Space` | start the game, or call the next wave in early |
| `P` | pause / resume |

The shop row under the board does the same job with the mouse: click a tower to
arm it, then click the map. Buttons grey out when you cannot afford them.

## The towers

| Tower | Cost | Range | Damage | Rate | What it is for |
|---|---|---|---|---|---|
| Arrow | 50 | 96 px | 8 | 1.4/s | the workhorse — cheap, fast, single target |
| Frost | 75 | 88 px | 4 | 1.0/s | slows what it hits by 45% for 1.5 s |
| Cannon | 100 | 112 px | 26 | 0.55/s | heavy shell with a 44 px splash |

Every tower can be upgraded twice. An upgrade costs `round(cost × 0.8 × level)`,
multiplies its damage by 1.5 and widens its range by 12%. Selling refunds 60% of
everything you put into a tower, upgrades included.

## The creeps

| Creep | HP | Speed | Bounty | Lives it costs you |
|---|---|---|---|---|
| Grunt | 30 | 42 px/s | 8 | 1 |
| Runner | 18 | 78 px/s | 6 | 1 |
| Tank | 120 | 26 px/s | 20 | 2 |
| Boss | 450 | 30 px/s | 100 | 5 |

Wave `n` brings `6 + 2n` creeps. Runners join from wave 3, tanks from wave 5, and
a boss walks in on every fifth wave. Health scales by 25% of the base per wave, so
wave 20 creeps have five times the health of wave 1 creeps.

## How to play

**Build early on the road, not near the end.** Towers shoot whatever is furthest
along the road inside their range, so a tower covering a corner near the start
gets many more seconds of fire per creep than one guarding the exit — and a leak
at the exit costs lives you cannot buy back.

**Cover the corners.** The road doubles back on itself twice. A tower dropped in
the elbow of a bend covers two legs at once and effectively doubles its uptime.

**Arrows first, then specialists.** Arrow towers are the most damage per gold, so
they carry the early waves. Once tanks appear in wave 5, a cannon parked where the
road bunches up pays for itself with splash, and a frost tower in front of a
cluster of arrows keeps everything inside their range for twice as long.

**Spend it.** Gold sitting in your pocket kills nothing. There is an 8-second
breather between waves and `Space` calls the next one in early — but the wave
comes whether you spend or not, so build while the timer runs.

**Upgrade or spread?** Two upgrades cost roughly as much as two new towers but
occupy one tile of road frontage. Upgrade when the good tiles are taken; spread
when the road still has bare stretches.

## Scoring

Killing a creep pays its bounty in both gold and score, and clearing wave `n`
pays a `20 + 5n` bonus. Your best score is kept in `localStorage` and shown in the
HUD.

## Tests

```powershell
npx playwright test TowerDefense/tests/
```

The specs drive `step(dt)` directly — the same function the animation loop calls —
so waves, movement, targeting, splash and the economy are all simulated
frame-by-frame without depending on wall-clock timing.
