# Gem Match

A Bejeweled-style match-three puzzle, built with HTML5 Canvas.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Click a gem | Select it (click again to deselect) |
| Click an adjacent gem | Swap the two |
| Arrow keys | Move the keyboard cursor |
| Space / Enter | Select the cursor's gem, then a neighbour to swap |
| Button | Start / restart |

**Objective:** Swap two adjacent gems to line up **three or more** of the same
colour. Matched gems clear, the gems above fall to fill the gaps, and new gems
drop in from the top. You have **25 moves** — build the highest score you can.

**Cascades:** When falling gems form new matches, they clear too, automatically,
chaining into a **cascade**. Each step of a cascade is worth progressively more,
so setting up a chain is the route to a big score. Newly dropped-in gems never
match on arrival, so cascades reward *your* setups rather than luck.

**Scoring:** Each cleared gem is worth `10 × cascade-depth` points — bigger
matches and longer chains score more.

**No dead ends:** A swap that makes no match snaps back and costs you nothing,
and if the board ever runs out of legal moves it is reshuffled so you are never
stuck.

**Best score:** Your highest score is saved in `localStorage` and shown in the
HUD, so your personal best persists between sessions.

See [design.md](design.md) for how the code works.
