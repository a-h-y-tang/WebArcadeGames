# Flock to the Fold

*"I am the good shepherd, and know my sheep, and am known of mine."* — John 10:14 (KJV)

A flock-rescue puzzle. The gate opens and a stream of cheerfully wandering sheep
tumbles onto the hillside. They walk, they turn at walls, they fall off ledges
and they stumble into water, and they will keep doing exactly that unless you,
the shepherd, step in.

You never steer a sheep. You hand out a small, fixed stock of **jobs**, clicking
one sheep at a time to turn it into a help for everyone behind it: a wall, a
shovel, a drill, a staircase, a parachute. Bring enough of the flock home to the
sheepfold before the clock runs out, across three hillsides.

## How to play

1. Press **Space** (or click **Start Game**).
2. Pick an ability with **1**–**5** or the buttons under the cave.
3. **Click a critter** to spend one of that ability on it.

The HUD shows the level, how many you have **Saved**, how many you **Need**,
how many are **Out** of the hatch, the **Time** left and your **Best** run.

| Input | Action |
|-------|--------|
| `Space` | Start the game, or move on from a result screen |
| Click a critter | Give it the selected ability |
| `1` – `5` | Select Blocker / Digger / Basher / Builder / Floater |
| `P` | Pause and resume |
| `R` | Restart the current cave |

## The abilities

| Ability | What it does |
|---------|--------------|
| **Blocker** | The critter freezes into a wall. Anyone who walks into it turns around. Permanent — a blocker can never be given another job. |
| **Digger** | Tunnels straight down, clearing a three-wide shaft, until it breaks into open air or hits steel. |
| **Basher** | Tunnels straight ahead, clearing a four-cell-tall swath. Steel stops it. |
| **Builder** | Lays up to twelve bricks as a diagonal staircase. Bricks are ordinary solid ground afterwards — diggable, climbable, standable. |
| **Floater** | Falls at half speed and survives a drop of any height. |

Everything else is physics: a drop of more than sixteen cells kills an ordinary
critter, water kills instantly, and dirt and bricks can be dug while steel
cannot. A digger or basher that drops into open air lands as a walker, and a
blocker assigned in mid-air falls before it takes root.

Spend carefully: a basher told to chew thin air reverts to a walker and that
charge is gone.

## The caves

1. **The Long Walk** — no abilities needed at all. The critters tumble down a
   staircase of ledges from the hatch to the exit, so you can watch how the
   crowd behaves before you have to manage it.
2. **Mind the Gap** — a chasm of water between the hatch and the exit. A builder
   gets a staircase over it; blockers keep the rest of the crowd from marching
   in while you work.
3. **Down and Out** — the exit is in the chamber below, under a dirt floor with a
   steel plate across the middle. Dig through the dirt, and mind the pool on the
   lower level.

## Files

| File | What's in it |
|------|--------------|
| `index.html` | Page shell: HUD, canvas, overlay, ability bar, help text |
| `style.css` | Presentation only |
| `game.js` | Grid, levels, critter state machine, renderer, input |
| `DESIGN.md` | How the simulation works, and the assumptions behind it |
| `tests/flock-to-the-fold.spec.js` | Playwright suite — 106 tests |

Open `index.html` in any browser; there is no build step.

## Tests

From the repository root:

```powershell
npx playwright test FlockToTheFold/tests/
```

The simulation is a fixed-step integer state machine with no floating point in
it, so the tests freeze the render loop, paint the exact cave they care about,
drop in a single critter and call `simStep()` by hand — every assertion about
falling, digging, bashing, building and drowning is exact rather than timed.

Three of the tests play a whole cave through with the ability assignments
scripted, so all three levels are provably winnable and stay that way if the
terrain is ever edited.
