# Vineyard Keeper

*"I will repay you for the years the locusts have eaten — the great locust and
the young locust, the other locusts and the locust swarm."* — Joel 2:25

A canvas shooter set in a vineyard. A long green caterpillar winds down through
the rows of grapevines — flick pebbles at it from the bottom of the vineyard and
chase it off before it reaches you.

## How to play

Open `index.html` in any browser — no build step or server required.

- **Move** with the **arrow keys** or **WASD** (you're confined to the bottom
  band of the screen).
- **Flick a pebble** straight up with **Space** — one pebble on screen at a time.
- **Pause / resume** with **P**.
- **Start / restart** with any move key, Space, or the on-screen button.

## Goal

Chase off every caterpillar segment to clear the wave. Hitting a middle segment
splits the caterpillar into two independent trains, so a long caterpillar
quickly becomes a swarm. Grape clusters take four hits to clear and force the
caterpillar to drop and reverse — use them, but don't let the field box you in. Clear a wave
and the next caterpillar is longer and faster.

## Scoring

| Event | Points |
|---|---|
| Grape cluster cleared | 1 |
| Caterpillar segment chased off | 10 |
| Wave cleared | 100 |

You have **3 lives**; a segment reaching you costs one. Your best score
is saved in the browser via `localStorage`.

## Under the hood

See [DESIGN.md](DESIGN.md) for the grid model, the per-segment movement rule
that makes splitting emergent, the state machine, and the assumptions made.
Behaviour is covered by a Playwright suite in [tests/](tests/).
