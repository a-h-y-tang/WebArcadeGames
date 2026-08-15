# Scramble

An auto-scrolling cave shooter on an HTML5 canvas. Fly a jet across four
terrain sections — rolling hills, jagged mountains, a stalactite cave and a
tunnel guarded by an enemy base. The world never stops moving forward: you
steer inside the window, shoot ahead with a laser and lob bombs at the ground.

Fuel drains the whole time you are in the air, so the fuel dumps below are not
scenery — blowing them up is the only way to reach the end of a level.

![Scramble](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | climb / dive |
| `←` `→` / `A` `D` | hang back / push on inside the window |
| `Space` | fire the laser (also starts the game when idle or after game over) |
| `B` | drop a bomb |
| `Enter` | start / restart |
| `P` | pause / resume |

## How to play

**Keep the tank full.** Fuel drains at a steady 4 units a second and a level
takes longer to cross than one tank holds. Every fuel dump you destroy returns
18. Miss too many and you fall out of the sky with nothing in front of you.

**Two weapons, two jobs.** The laser fires flat and fast — it is for rockets
standing in your path and for dumps you are already level with. Bombs fall
under gravity and carry your forward speed, so they have to be released *early*,
well before you are over the target. Bombs are worth more against rockets (80
against 50) precisely because they are harder to place.

**Shoot the rockets before you arrive.** A rocket sitting on the ground is
harmless until you come within 140 px, at which point it lifts off and climbs
straight into your flight path. Clearing them on approach is the difference
between a calm run and a scramble.

**Mind the roof.** Sections three and four are caves. The corridor is never
narrower than 120 px, but it moves — and it moves while rockets are launching
into it.

**Checkpoints.** Crashing costs a ship and sends you back to the start of the
current section with a full tank, a clear screen and a moment of
invulnerability. Every target from the checkpoint onward comes back with you.

## Scoring

| Target | Points |
|---|---|
| Fuel dump | 100 (and +18 fuel) |
| Rocket, by laser | 50 |
| Rocket, by bomb | 80 |
| Enemy base | 800 |
| Clearing a level | 500 × level |

The best score is kept in `localStorage`.

## Levels

Terrain and target placement come from a seeded generator keyed on the level
number, so level 3 is always the same level 3. Each level up scrolls faster
(100 px/s, +12 per level, capped at 190), launches rockets faster and packs
them closer together.

## Design

See [DESIGN.md](DESIGN.md) for the world geometry, the simulation loop and the
assumptions behind the rules.

## Tests

From the repository root:

```powershell
npx playwright test Scramble/tests/
```
