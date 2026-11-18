# Gather the Stones

> "And he fenced it, and gathered out the stones thereof, and planted it with the
> choicest vine." — Isaiah 5:2

A vineyard cannot be planted until the field is cleared. Work a stony hillside
with a woven basket and a round threshing stone: every field stone the stone
strikes is knocked loose and gathered in. Clear five fields and the vines go in.

Open `index.html` in any browser — no build step, no server.

## How to play

| Input | Action |
|---|---|
| Mouse over the field | Move the basket |
| ← → or A D | Move the basket |
| Space, or click the field | Launch the stone, release a held stone, start, or clear an overlay |
| P | Pause / carry on |
| R | Start over from the first field |

Start with **Space** or the **Start Work** button. The stone rests on the basket
until you launch it; after that, keep it off the ground.

### The stones

| Stone | Hits | Points |
|---|---|---|
| Loose stone (pale sand) | 1 | 10 |
| Packed stone (warm brown) | 2 | 20 |
| Boulder (slate grey) | 3 | 30 |
| Bedrock (dark basalt) | never breaks | — |

Cracked stones darken as they give way. Bedrock never shifts, so later fields
have to be played around it.

**Where the stone lands on the basket decides where it goes next.** The middle
sends it back up the way it came; the edges throw it out wide. That is the whole
of the aiming in this game, and the last few stones of a field need it.

### Gifts

A knocked-out stone sometimes leaves a gift behind. Catch it with the basket —
each one is worth 25 points on top of its effect.

| Gift | Effect |
|---|---|
| **Wide basket** | The basket grows for 20 seconds |
| **Steady hand** | The stone slows down for 15 seconds |
| **Three stones** | The stone in play splits into three |
| **Sticky pitch** | The basket holds the stone for 20 seconds; Space sends it off again |
| **Extra helper** | One more worker, up to five |

Timed gifts show as labelled bars above the field, each draining as its time runs
out.

### The five fields

1. **Stony field** — loose stones only, room to learn the angles.
2. **Terraced slope** — packed stones that need two hits.
3. **Thorn hedge** — bedrock pillars and a gap down the middle.
4. **Old wall** — boulders along the top, bedrock in the corners.
5. **Vineyard gate** — an arch of boulders and packed stone, bedrock either side.

Losing the stone past the bottom of the field costs a worker; three workers and
the game is over. Clearing a field is worth 100 points times the field number, and
the best score is kept in the browser.

## Files

| File | What it holds |
|---|---|
| `index.html` | Page, HUD and overlay |
| `style.css` | Layout and the colours of the HUD, gifts and overlay |
| `game.js` | Geometry, field maps, simulation (`step`), input, rendering |
| `DESIGN.md` | How the game is put together, and the assumptions behind it |
| `tests/` | The Playwright suite |

## Tests

From the repository root:

```powershell
npx playwright test GatherTheStones/tests/
```

74 tests cover the HUD, the basket, launching, every bounce, stone damage and
scoring, bedrock, losing a stone and losing workers, field completion and the win,
all five gifts, pause and restart, the level data, and the rules that keep the
stone from settling into a loop that never reaches the last stone.
