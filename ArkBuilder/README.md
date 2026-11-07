# Ark Builder

*"So make yourself an ark of cypress wood; make rooms in it and coat it with
pitch inside and out."* — Genesis 6:14

A one-button stacking game built with HTML5 Canvas. Help Noah build the ark,
one deck of gopher wood at a time.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Space | Start, then drop the block |
| Click / tap the canvas | Start, then drop the block |
| Start button | Start / play again |

**Objective:** A deck of gopher wood slides back and forth above the ark. Drop it as close
to perfectly aligned as you can. Any part that hangs over the deck below is
sawn off, so sloppy drops make the ark narrower and narrower. Build as high as
you can before a deck misses the ark entirely.

**Perfect drops** (aligned within a few pixels) lose no width, regrow the deck
a little, and score double — precision is how you survive a long run. The deck
speeds up as your score climbs.

Your best score is saved in `localStorage` and persists between sessions.

See [DESIGN.md](DESIGN.md) for the mechanics, state model, and design notes.
