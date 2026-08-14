# Tower Defense

A grid-based tower defense game on an HTML5 canvas. Twelve waves of creeps march
along a fixed winding road from the entrance on the left edge to the exit on the
right. You never fight them yourself — you spend gold on turrets built on the
grass beside the road, and they do the shooting. Every creep that walks the whole
road costs you lives.

![Tower Defense](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `Left click` on grass | build the selected turret |
| `Left click` on your turret | upgrade it one level |
| `Right click` on your turret | sell it for 60 % of what you put in |
| `1` `2` `3` | pick gun / frost / cannon |
| `Space` | start the game, or send the next wave |
| `P` | pause / resume |
| `R` | restart after a win or a loss |

## How to play

**Build, then send.** Nothing moves until you call a wave, so take your time
placing turrets — there is no build timer. Press `Space` (or click *Send Wave*)
when you are ready, and the wave spawns one creep at a time from the left.

**Watch where the road doubles back.** The road folds over itself four times, so a
turret in the middle of the map can cover three lanes at once while a turret in a
corner covers one. Hovering a cell draws the range circle before you commit.

**Three turrets, three jobs.**

| Turret | Cost | Job |
|---|---|---|
| Gun | 20 | cheap, fast, single target — your bread and butter |
| Frost | 30 | almost no damage, but slows what it hits to half speed for 1.8 s, which keeps creeps inside everyone else's range |
| Cannon | 45 | slow, heavy shells with 40 px splash — the answer to tightly packed runners and to tanks |

Every turret shoots the creep **furthest along the road** that is inside its
range, so building near the exit means shooting the creeps closest to leaking.

**Upgrade as well as expand.** Clicking a turret you own upgrades it up to level 3.
Each level is +50 % damage and +10 % range for the base cost times its current
level, so a level-3 gun (45 gold all in) out-damages two fresh ones and takes only
one cell of the map.

**Creeps.**

| Creep | Behaviour |
|---|---|
| Grunt | the baseline: middling speed, middling health |
| Runner | fast and fragile — leaks before slow turrets get a second shot |
| Tank | slow and tough, and costs 2 lives if it gets through |
| Boss | wave 12 only, and 5 lives if it reaches the exit |

Creep health grows about 32 % per wave, so a defense that coasted through wave 6
will be overrun by wave 9 if you stop reinvesting.

**Win and lose.** You start with 20 lives and 100 gold. Reach 0 lives and the run
ends; clear all twelve waves with a life left and you have defended the base. Your
best score is kept in the browser's local storage.

## Testing

From the repository root:

```powershell
npx playwright test TowerDefense/tests/
```

The suite drives the simulation through `step(dt)` rather than waiting on real
time, so all 84 specs — placement rules, upgrade and sell economics, targeting,
splash, slows, wave and leak handling, win and loss — run in a few seconds.
