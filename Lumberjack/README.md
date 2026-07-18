# Lumberjack

A fast, reaction-based chopping game (in the spirit of the classic "Timberman").
Chop the bottom of a tall trunk from the left or the right. Every chop drops the
trunk down and grows a new segment on top — but branches poke out on the left and
right, and if one falls to your side while you're standing there, you're out. A
timer bar drains constantly, so you can never stop: each chop tops it back up.

## How to play

- **Chop left:** `←` / `A`, or click / tap the left half of the canvas.
- **Chop right:** `→` / `D`, or click / tap the right half.
- **Start / restart:** any chop key, `Space`, `Enter`, or the button.

Watch the segment about to fall to your level: if it has a branch on the side
you chop, you lose. Always chop the *clear* side — fast. Your best score (chops
landed) is saved between sessions.

## Running

Open `index.html` directly in a browser — no build step or server required.

## Design

See [DESIGN.md](DESIGN.md) (also available as `design.md`) for the concept,
mechanics, state model, and assumptions.
