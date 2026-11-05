# Burrow Brigade — Design

## Concept

A crowd-rescue puzzle. A hatch drops a steady stream of mindless critters into a
cave. They walk forward, turn at walls, fall off ledges and drown in water
without ever thinking for themselves. The player never controls a critter
directly — instead the player spends a small, fixed inventory of **abilities**,
clicking an individual critter to turn it into a tool for the rest of the crowd:
a wall, a shovel, a drill, a staircase, a parachute.

Each level asks for a quota: save *N* of *M* critters before the clock runs out.
Three levels of rising difficulty, then a win screen. The puzzle is deciding
*which* critter to convert and *when* — an ability spent on the wrong critter is
gone for good.

This is the repo's first game where the player edits the *world and the agents*
rather than piloting an avatar, which is why it was picked: nothing else in the
collection has an autonomous-crowd mechanic.

## Mechanics

### Grid world

The level is a cell grid, `COLS × ROWS = 80 × 60`, drawn at `CELL = 8` px on a
640×480 canvas. Every cell is one of:

| Value | Name    | Solid? | Diggable? | Notes                                |
|-------|---------|--------|-----------|--------------------------------------|
| `0`   | `EMPTY` | no     | —         | open air                             |
| `1`   | `DIRT`  | yes    | yes       | the ordinary terrain                 |
| `2`   | `STEEL` | yes    | **no**    | stops diggers and bashers dead       |
| `3`   | `WATER` | no     | no        | critters fall in and drown           |
| `4`   | `BRICK` | yes    | yes       | laid down by a builder               |

`isSolid()` treats out-of-bounds columns as solid, so critters turn around at
the level edges instead of walking into nothing. A critter that falls below the
last row is lost.

### Critters

A critter is one cell wide and two cells tall. `(x, y)` is its **foot** cell; it
also occupies `(x, y - 1)`, and it stands on `(x, y + 1)`. It carries a facing
`dir` of `+1`/`-1`, an `ability`, a `fallDist` counter and a `bricks` budget.

The simulation is a fixed-step integer state machine — `simStep()` advances the
whole world exactly one tick, and the render loop calls it 20 times a second.
Nothing in the simulation reads the clock or a float delta, so a test can call
`simStep()` by hand and get the same answer every time.

Each tick, for every live, unsaved critter:

1. **Falling**: if the cell below is not solid the critter drops — `2` cells per
   tick normally, `1` for a floater — and accumulates `fallDist`. On landing, a
   fall longer than `SPLAT_DIST = 16` cells kills it, unless it is a floater,
   which survives any drop. A digger or basher that drops into open air has
   finished its job and lands as a walker, rather than boring on through
   whatever it hits next. Gravity applies to blockers too: one assigned in
   mid-air falls to the ground before it takes root.
2. **Blockers**, once landed, do nothing at all — they are scenery with a
   heartbeat.
3. **Working** (standing on solid ground), by ability:
   - **digger** — clears the three cells below it (`x-1 … x+1`) and sinks one
     cell. Steel below it cannot be removed, so the digger reverts to a walker.
   - **basher** — clears a four-cell-tall swath in the cell ahead and steps into
     it. If there is nothing diggable ahead, or the swath is steel, it reverts
     to a walker.
   - **builder** — lays a `BRICK` in the cell ahead and steps up onto it,
     spending one of `BUILDER_BRICKS = 12`. A ceiling in the way turns it
     around; running out of bricks reverts it to a walker.
   - **walker / floater** — moves one cell forward. A blocker (or another
     critter's blocker body) in the way reverses it. A ledge one or two cells
     high is climbed; anything taller, or a blocked body cell, reverses it.
4. **Hazards and goal**: entering a `WATER` cell drowns it; reaching the 2×2
   exit footprint saves it and bumps the level's `saved` tally.

### Level flow

A level carries terrain, a hatch, an exit, `total` critters, a `required`
quota, a per-ability inventory and a tick budget. The hatch releases one critter
every `SPAWN_INTERVAL = 20` ticks (once a second). The level resolves when the
clock expires, or when every critter has been released and none is still
walking: quota met → next level (or the win screen after level 3), quota missed
→ level failed, and `R` restarts it.

`score` counts critters saved across the run; the best run is kept in
`localStorage` under `burrowbrigade-best`.

### Abilities

Inventory is per level and strictly finite:

| Key | Ability | Effect |
|-----|---------|--------|
| `1` | Blocker | Freezes the critter into a wall that turns the others back |
| `2` | Digger  | Tunnels straight down |
| `3` | Basher  | Tunnels straight ahead |
| `4` | Builder | Lays up to 12 bricks as a diagonal staircase |
| `5` | Floater | Falls slowly and survives any drop |

An ability can only be given to a live, unsaved, non-blocker critter, and only
while stock remains. Blockers are permanent — there is no "un-block".

## Controls

| Input | Action |
|-------|--------|
| `Space` | Start the game / dismiss a result screen |
| Mouse click on a critter | Assign the selected ability |
| `1` – `5`, or click an ability button | Select the ability to assign |
| `P` | Pause / resume |
| `R` | Restart the current level |

## Assumptions

Decisions made without being able to ask; the simpler reading was taken each
time, as instructed.

- **Branch naming.** The scheduled prompt asks for a branch named after the game
  (`burrow-brigade`), while the session's standing git instructions pin all
  development and pushes to `claude/compassionate-ramanujan-vck99b`. The standing
  instruction wins, since pushing elsewhere is explicitly forbidden;
  `burrow-brigade` exists locally as the game's namesake branch, and the work
  lands on the designated branch.
- **"DESIGN.md in the game's folder."** The repo's own README asks for a
  lowercase `design.md`; every existing game actually ships `DESIGN.md`, and the
  prompt says `DESIGN.md`, so `DESIGN.md` it is.
- **Not a Lemmings clone.** The mechanic is the inspiration, not the content —
  no original levels, art, names or sprites are reproduced. Levels, ability set
  and tuning are all original and deliberately coarser (cell-grid terrain rather
  than per-pixel), which keeps the simulation integer-exact and testable.
- **Chunky terrain.** Terrain is destroyed a cell at a time rather than a pixel
  at a time. It costs some visual finesse and buys a simulation with no floating
  point in it, which is what makes the Playwright suite deterministic.
- **Fall speed stands in for fall animation.** Rather than animate a fall, a
  falling critter moves two cells a tick and a floater one. "Floats slowly" is
  therefore literally true, and the splat threshold is a plain cell count.
- **Three levels.** Enough to teach every ability and show difficulty rising,
  without turning the task into level authoring. Cave 1 is a tiered descent
  that can be cleared with no abilities at all, cave 2 needs a builder and a
  basher, cave 3 needs a digger and a blocker. Each is held to that standard by
  a test that plays it through: `simStep()` is called in a loop with the
  ability assignments scripted, and the quota must actually be met.
- **An ability spent badly is spent.** A basher told to bash thin air reverts to
  a walker and the charge is gone. That is the genre's bargain, so levels carry
  a spare of anything a mistimed click can waste rather than becoming
  unwinnable on one bad click.
- **No nuke button.** Classic crowd games offer "destroy everyone" as an escape
  hatch from an unsolvable board; `R` to restart the level covers the same need
  with less state to reason about.
- **Score is lives saved.** No multipliers or time bonus — the HUD already shows
  the quota, so a second number measured in points would be noise.
