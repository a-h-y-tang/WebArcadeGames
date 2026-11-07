# Wilderness Wanderings

*"By day the Lord went ahead of them in a pillar of cloud to guide them on their
way and by night in a pillar of fire to give them light."* — Exodus 13:21

A procedurally generated desert maze built with HTML5 Canvas. Lead the pillar of
fire from the top-left of the wilderness to the glowing green Promised Land at
the bottom-right before the timer runs out — each journey you finish opens a
fresh, larger wilderness for the next level.

![Wilderness Wanderings screenshot](screenshot.png)

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| Arrow keys or WASD | Move up / down / left / right |
| Start / Play Again button | Begin a new game |
| Any movement key (while idle / over) | Start a new game |

**Objective:** Find your way to the glowing green Promised Land. Every maze is *perfect*
(exactly one route between any two points), so there is always a path — the
challenge is finding it before the clock hits zero.

**Levels & score:** Each maze you clear increases your score and generates a
new, slightly larger maze with a fresh time budget. Run out of time and the game
ends. Your best score is saved in `localStorage` and persists between sessions.

## How it works

See [DESIGN.md](DESIGN.md) for the maze-generation algorithm (iterative
recursive backtracker), the shortest-path solver, and the full list of state
exposed for testing.
