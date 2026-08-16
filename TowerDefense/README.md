# Tower Defense

Build gun emplacements along a winding road and stop twelve waves of creeps
before they march off the right-hand edge of the map.

Open `index.html` in any browser — no build step or server required.

## How to play

Creeps enter from the red marker on the left and walk a fixed road to the green
marker on the right. Every creep that makes it out costs you lives (tanks cost
2, bosses cost 5). Lose all 20 lives and the game ends; hold all twelve waves
and you win.

Killing a creep pays gold, and clearing a wave pays a bonus. Spend that gold on
new towers and upgrades between (or during) waves.

## Controls

| Input | Action |
|---|---|
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Pick Arrow / Cannon / Frost to build |
| Click a build button | Same, with the mouse |
| Click open ground | Place the selected tower there |
| Click a tower | Select it — the panel shows Upgrade and Sell |
| <kbd>Esc</kbd> | Cancel the current selection |
| <kbd>Space</kbd> | Start the game, and send the next wave between waves |
| <kbd>P</kbd> | Pause / resume |

Towers can only be built on open ground — never on the road, never on top of
another tower.

## Towers

| Tower | Cost | What it does |
|---|---|---|
| Arrow | 50g | Long range, fast single-target shots. The workhorse. |
| Cannon | 90g | Slow, heavy shells that splash damage around the impact. |
| Frost | 70g | Light damage, but chills what it hits down to 45% speed. |

Each tower upgrades twice (to level 3). Every level adds 30% damage and 10%
range; the upgrade price scales with the level. Selling a tower refunds 60% of
everything you have put into it, so a badly placed tower is not a disaster.

## Tips

- Towers shoot the creep that is *furthest along the road*, so a tower covering
  a hairpin bend gets far more shooting time than one covering a straight.
- A Frost tower early in the road multiplies everything built after it.
- Cannons pay off against tightly packed waves of runners; they are wasted on
  lone tanks.
- Waves do not start on their own. Take as long as you like to build, then
  press <kbd>Space</kbd> when you are ready.

## Tests

```powershell
npx playwright test TowerDefense/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
