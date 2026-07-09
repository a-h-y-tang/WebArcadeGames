# Pong

The 1972 arcade original, built with HTML5 Canvas — you versus the computer.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| ↑ / ↓ arrows (or W / S) | Move your paddle up / down |
| Mouse over the board | Move your paddle to the cursor |
| P | Pause / resume |
| ↑ / ↓ or the button | Start or restart |

**Objective:** You control the **left** paddle; the computer controls the
**right**. Keep the ball in play and get it past the CPU's paddle to score.
**First to 7 points wins.**

**Aiming:** Where the ball strikes your paddle changes its angle — hit with the
top of the paddle to send it upward, the bottom to send it downward, the middle
to flatten it out. Every rally the ball gets a little faster, so long rallies
get tense.

**Best Rally:** The game tracks your **longest rally** (most consecutive paddle
hits in a single point) and saves it in `localStorage`, so your personal best
persists between sessions.

See [design.md](design.md) for how the code works.
