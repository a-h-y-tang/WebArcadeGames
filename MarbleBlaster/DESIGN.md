# Marble Blaster — Design

## Concept

A chain of coloured marbles crawls along a winding track toward a pit at the
end. The player sits in the middle of the track with a launcher and fires
marbles into the chain. Any run of three or more marbles of the same colour
pops. Clear every marble the level sends before the chain reaches the pit, and
the next level starts with more marbles, more colours and a faster chain.

The genre (a path-based marble shooter) was not represented in this repo:
Bubble Shooter and Match-3 both work on a static grid, while here the targets
are a single moving, ordered sequence, which makes insertion position and
timing the core skill.

## Mechanics

### The track

The track is a fixed polyline (`PATH`) — a serpentine that starts off the left
edge of the canvas and ends at the pit near the bottom. `PATH_LEN` holds the
cumulative arc length at each vertex, so any point on the track is addressed by
a single number: the distance travelled from the entrance. `pointAt(d)`
converts that back to canvas coordinates by finding the segment containing `d`
and interpolating.

Addressing marbles by arc length rather than by `(x, y)` is what makes the rest
of the game simple: packing, insertion and matching are all one-dimensional.

### The chain

`chain` is an array ordered front-to-back — `chain[0]` is the marble nearest the
pit, and every marble behind it has a strictly smaller `dist`. Each frame:

1. The front marble advances by `frontSpeed() * dt`.
2. Every marble behind it is clamped to `chain[i-1].dist - SPACING`. If it sits
   further back than that (because of a clear or an insertion) it closes the gap
   at `PULL_SPEED` instead of teleporting.

So the chain is a queue that packs itself against its own head. There is only
ever one segment — see *Assumptions*.

While marbles are still queued to enter (`toSpawn > 0`), the chain moves at
`FEED_MULTIPLIER × ` the crawl speed, as if pushed by the marbles streaming out
of the entrance; once the queue empties it settles into its slow crawl. This is
what makes the opening of a level a fast stream and the tail end a tense crawl.
The first playtest ran without it and the track never filled — supply was capped
by the crawl speed, which made levels trivial.

`feedChain()` adds at most one marble per frame, and only once the tail marble
has cleared the entrance by a full diameter, so marbles never overlap.

### Shooting

The launcher holds a current marble and a next marble, and can be aimed in any
direction (mouse, or the arrow keys). `fire()` launches the current marble at
`SHOT_SPEED`, promotes the next one, and starts a `RELOAD` cooldown. A shot in
flight is advanced in sub-steps of at most half a marble radius so a fast marble
cannot tunnel through the chain.

The launcher only ever loads a colour that is still on the track, so no shot is
dead weight and the last few marbles of a level always stay clearable. Marbles
entering the track are drawn freely from the level palette.

### Insertion

When a shot overlaps a chain marble, the marble it hit decides where it lands:
the game compares the shot's position against the points half a spacing in
front of and behind that marble, and inserts on the closer side. Inserting at
index `k > 0` shoves everything from `k` back by one spacing (the tail then
closes up at `PULL_SPEED`); inserting at the very front pushes the new marble
one spacing ahead instead — unless there is no track left in front, in which
case it tucks in behind so a shot can never itself push a marble into the pit.

### Matching

After an insertion, `resolveMatches()` finds the run of equal colours containing
the new marble. Three or more pops. Then, if the two marbles now facing each
other across the seam share a colour, that run is checked too, and so on — the
chain reaction. Each successive pop in one resolution raises the combo
multiplier: `run length × 10 × combo`, so a two-stage combo is worth far more
than two separate matches.

### Levels and losing

A level ends when the queue is empty and the chain is clear: the player banks
`250 × level`, and the next level sends 6 more marbles, moves ~18% faster, and
adds a colour every second level (capped at the six-colour palette). The game
ends the moment the lead marble reaches the end of the track. The last stretch
before the pit is flagged as danger, which throbs the pit and the border.

## Controls

| Input | Action |
|---|---|
| Mouse move | Aim the launcher |
| Click / `Space` | Fire |
| `←` `→` | Swing the aim |
| `S` | Swap the current and next marble |
| `P` | Pause / resume |
| `Space` (when idle or after a game over) | Start / restart |

## Code layout

| File | Role |
|---|---|
| `index.html` | HUD, canvas, overlay, help bar |
| `style.css` | Presentation only — no layout logic in JS |
| `game.js` | Constants, path maths, chain, shooting, matching, flow, rendering, input |
| `tests/marble-blaster.spec.js` | 66 Playwright specs |

`game.js` keeps every piece of state and every rule in plain top-level
functions (`step`, `insertMarble`, `resolveMatches`, `pointAt`, …). Rendering
reads state and never writes it, and `step(dt)` takes its timestep as an
argument, so tests can drive an exact number of deterministic frames instead of
waiting on wall-clock animation.

## Assumptions

These were decisions taken without a human in the loop; each takes the simpler
reading.

- **Branch name.** The task asked for a branch named after the game
  (`marble-blaster`), but the session is pinned to the branch
  `claude/loving-euler-mewxal` and is not permitted to push elsewhere. The work
  is on the pinned branch.
- **One chain segment, not many.** In the original arcade genre a clear splits
  the chain into independent segments that can drift apart and even roll
  backwards. Here every marble always packs against the single head, and a gap
  closes forward at `PULL_SPEED`. This keeps the model one-dimensional and
  predictable, at the cost of losing the "rollback" feel.
- **Chain reactions resolve instantly.** When a clear leaves two same-coloured
  marbles facing each other, the follow-up match fires immediately rather than
  waiting for the gap to physically close. Same outcome, far simpler to reason
  about and to test.
- **Insertion pushes backwards.** A shot landing mid-chain shoves the marbles
  behind it back rather than driving the front of the chain toward the pit, so a
  shot can never directly cause a loss.
- **No lives and no power-ups.** One track, one chain, and the run ends when a
  marble reaches the pit. Levels are endless rather than a fixed campaign.
- **Colour count over difficulty curve.** Levels grow by marble count, speed and
  palette size only; the track never changes shape.
- **Best score only.** Progress is not saved mid-run; `localStorage` holds a
  single best score under `marble-blaster-best`, and a browser that refuses
  storage degrades to an in-memory best.
