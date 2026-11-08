# Fishers of Men &mdash; design

> &ldquo;Follow me, and I will make you fishers of men.&rdquo; &mdash; Matthew 4:19

## Game concept

A net-casting arcade game on the Sea of Galilee. You crew one of the fishing boats
Simon Peter and his brothers worked, rowing along the surface, dropping the net into
the shoals below and hauling it back aboard before the catch slips away. Each level
is one morning's fishing: land the level's quota of fish before the light goes, and
you sail on to deeper water.

The theme is drawn from the Gospel fishing accounts &mdash; the call by the lakeside
(Matthew 4:18&ndash;22), the catch that filled the nets until they began to break
(Luke 5:4&ndash;7) and the hundred and fifty-three large fish of John 21:11, which
the five level names echo. There is no violence and nothing to wager; the only
pressure is the clock and the weight of a full net.

## Mechanics

**The sea.** The canvas is 640&times;520. Everything above the waterline at `y = 80`
is sky, far shore and boat; everything between the waterline and the sea floor at
`y = 500` is water. Fish swim in three horizontal bands:

| Fish | Points | Band | Notes |
|---|---|---|---|
| Sardine | 10 | shallow | small, quick, plentiful |
| Bream | 25 | middle | mid-sized |
| Tilapia | 50 | deep | the big one, slowest to carry |

Fish swim straight across their band and are recycled at the far edge. A fish taken
out of the sea is replaced four seconds later by another swimming in from the edge of
its own band, so the shoals keep moving through and no level can be fished dry and
left unfinishable. A fish that tears its way back out of the net cancels one pending
replacement rather than doubling the shoal. Each level also drifts a number of **snags** &mdash; waterlogged
driftwood tangled with weed &mdash; through the middle depths.

**Casting.** With the net stowed, the boat rows left and right and the net rides with
it. `Space` casts: the net drops from the middle of the boat at a steady 118 px/s with
a rope trailing to the deck. While the net is in the water the boat holds station and
the arrow keys steer the net itself.

**Catching.** Any fish whose body overlaps the net is scooped up and rides inside it.
The net holds only the level's capacity (4 at first, 8 by the last level); once it is
full it turns for home on its own, as it does if it reaches the sea floor.

**Hauling.** `Space` again hauls a sinking net up early. A full net is heavy: haul
speed is `max(48, 140 - 16 × fish aboard)` px/s, so a greedy haul from the deep is a
slow climb back through the snags. **Fish only score when the net reaches the boat**
&mdash; that is the central tension of the game.

**Snags.** Touching a snag tears a hole: one fish slips out and darts back into the
sea, and the tear has a 0.7 s cooldown so a single piece of driftwood can never empty
a net in one pass. An escaped fish is un-catchable for 1.5 s so it genuinely gets away
rather than falling straight back into the mesh. An empty net passes a snag unharmed.

**Scoring.** A landed fish pays its own points, plus a **net bonus** of 10 points for
every fish beyond the first in the same haul &mdash; three fish in one haul beat three
separate trips. The best score is kept in `localStorage`.

**Levels.** Five of them, named for the Gospel accounts: quota, net capacity and fish
speed all rise and more driftwood drifts through, while every level allows 1:30.
Filling the quota clears the level; running the clock out ends the game.

The quotas were set by running a deliberately careless scripted player &mdash; one
that chases the nearest fish and ploughs straight through driftwood &mdash; against
each level. Every level is clearable by that bot with time to spare, so finishing is
within reach of any player; the skill shows in the score, not in whether you finish.

## Controls

| Key | Action |
|---|---|
| &larr; &rarr; (or A / D) | row the boat; steer the net once it is in the water |
| `Space` | cast the net; press again to haul it in |
| `P` | pause / resume |
| `R` | restart the level |
| mouse / touch | drag to row the boat or steer the net; tap the water to cast, tap again to haul; tap an overlay to start, sail on or resume |

The Start button casts off from the title screen and advances to the next level, and
the Restart Level button mirrors `R`.

## How the code works

`game.js` is a plain script (no modules), so every piece of state is a page global.
That is deliberate: the Playwright suite can switch the render loop off with
`autoRun = false`, empty the sea, drop in one fish or one snag at an exact position
and advance the world one `simStep()` at a time.

- **Fixed step.** `simStep()` advances the world by exactly `DT = 1/60` s. The
  `requestAnimationFrame` loop accumulates real elapsed time and runs whole steps,
  so the simulation behaves the same on any refresh rate and is fully deterministic
  under test.
- **State machine.** `state` is one of `title`, `running`, `paused`, `cleared`,
  `gameover`, `won`. `simStep()` returns immediately unless the state is `running`,
  which is what freezes the clock when the game is paused or over.
- **Sea layout.** `loadLevel(n)` seeds a small `mulberry32` generator with
  `0x5ea + n × 7919` and stocks the lanes from it, so a level always lays out the
  same sea &mdash; replayable for a player, reproducible for a test.
- **Collision.** Fish, snags and the net are all axis-aligned boxes; `overlaps()` is
  the only collision primitive in the game.
- **Input.** Keys set flags in a `keys` map; a pointer records a canvas-space
  `pointerX`, scaled from the element's real box so it works at any layout size.
  `simStep()` reads both: a held arrow key moves at full speed and takes priority,
  otherwise `chase()` eases the boat or the net toward the pointer at that same
  speed without overshooting. Keyboard and touch therefore share one code path and
  one set of clamps. Pressing an arrow key clears `pointerX`, so a cursor left
  parked over the water cannot drag the boat back the moment the key is released,
  and losing window focus clears the key map rather than leaving a key stuck down.
- **Rendering.** `draw()` paints sky, shore, water with a moving foam line and sun
  shafts, the sea bed, snags, fish (each with a wagging tail), the rope, the net with
  its catch inside, and the boat with its sail and fisherman. Drawing never mutates
  simulation state, so it can be called in any state without side effects.

### Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas, overlay and help text |
| `style.css` | lakeside palette and responsive layout |
| `game.js` | constants, level table, simulation, rendering, input |
| `tests/fishers-of-men.spec.js` | 61 Playwright tests |

## Assumptions

These were decided without being specified, taking the simpler reading each time:

1. **Branch name.** The task asked for a branch named after the game
   (`fishers-of-men`), but this session's standing instructions pin all development
   and pushes to `claude/compassionate-ramanujan-kfcgfj` and forbid pushing elsewhere
   without explicit permission. The work therefore lives on the designated branch;
   the game name is carried by the folder instead.
2. **Scope of "novel".** The repository already holds 144 games, including every
   obvious catch-and-drop variant, but nothing about fishing. A net with capacity and
   weight, where the catch only counts once it is aboard, is the new mechanic here.
3. **No lives.** The pressure is the clock alone. A torn net costs fish, not a life,
   which keeps the game gentle enough for younger players.
4. **Time, not accuracy, is the limit.** Every fish landed is restocked from the edge
   a few seconds later, so a level can always be finished; the question is whether it
   can be finished in time. Without that, a level like the last one &mdash; 19 fish in
   the water for a quota of 18 &mdash; could be rendered unwinnable by a few torn
   nets.
5. **Escaped fish swim free.** A fish shaken out of the net is immune for 1.5 s. The
   alternative &mdash; letting it be re-caught instantly &mdash; made snags
   meaningless.
6. **Steering while hauling** stays enabled, so a player can dodge driftwood on the
   way up. That is what makes a heavy net interesting rather than merely slow.
7. **Score is cumulative across levels** but `R` rewinds the score to where the level
   began, so restarting cannot be used to farm points.
8. **Category.** Filed under `Action` in the game browser: it is a real-time arcade
   game, not a puzzle.
9. **Touch is a first-class control.** Phones have no arrow keys, so a drag rows the
   boat or steers the net and a tap on the water casts and hauls. The keyboard wins
   while a key is held, so the two never fight.
10. **Finishing should be reachable, scoring should not.** Quotas are set so a
    careless player still clears the level; the net bonus is where skill pays.
11. **Verse placement.** Matthew 4:19 sits on the title overlay and in both READMEs,
   quoted accurately and without turning the gospel into a prize to be won.
