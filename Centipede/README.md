# Centipede

A canvas remake of the 1981 Atari arcade classic. A segmented centipede weaves
down the screen through a field of mushrooms — blast it apart from your blaster
at the bottom before it reaches you.

## How to play

Open `index.html` in any browser — no build step or server required.

- **Move** with the **arrow keys** or **WASD** (you're confined to the bottom
  band of the screen).
- **Fire** straight up with **Space** — one shot on screen at a time.
- **Pause / resume** with **P**.
- **Start / restart** with any move key, Space, or the on-screen button.

## Goal

Destroy every centipede segment to clear the wave. Shooting a middle segment
splits the centipede into two independent trains, so a long centipede quickly
becomes a swarm. Mushrooms take four hits to clear and force the centipede to
drop and reverse — use them, but don't let the field box you in. Clear a wave
and the next centipede is longer and faster.

## Scoring

| Event | Points |
|---|---|
| Mushroom destroyed | 1 |
| Centipede segment destroyed | 10 |
| Wave cleared | 100 |

You have **3 lives**; a segment reaching your blaster costs one. Your best score
is saved in the browser via `localStorage`.

## Under the hood

See [DESIGN.md](DESIGN.md) for the grid model, the per-segment movement rule
that makes splitting emergent, the state machine, and the assumptions made.
Behaviour is covered by a Playwright suite in [tests/](tests/).
