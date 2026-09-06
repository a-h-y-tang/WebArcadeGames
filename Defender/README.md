# Defender

A side-scrolling rescue shooter, built with plain HTML5 canvas and JavaScript —
no build step, no dependencies. You patrol a **wrap-around planet** while alien
**Landers** descend to abduct the **Humanoids** on the surface. Shoot the
landers, catch the humanoids they drop and fly them back to the ground.

A lander that carries a humanoid to the top of the sky mutates into a fast,
aggressive **Mutant**. Lose every humanoid and the planet itself dies: the
surface turns to rubble and every remaining lander mutates at once.

Inspired by the 1981 Williams arcade classic.

![Defender screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Enter** (or click **Start
Game**) to begin.

| Key | Action |
|---|---|
| ← / A | Thrust left (the ship turns to face left) |
| → / D | Thrust right (the ship turns to face right) |
| ↑ / W | Climb |
| ↓ / S | Dive |
| Space | Fire |
| B | Smart bomb |
| P | Pause / resume |
| Enter | Start / restart |

## The world

The planet is four screens wide and wraps around, so most of the action happens
somewhere you cannot see. The **scanner** — the strip above the play area — is a
squashed map of the entire world: yellow ticks are humanoids, purple blocks are
landers, red blocks are mutants, and the green bracket shows the slice you are
currently looking at. Watch it, or you will lose the planet while flying the
wrong way.

## Rules

- **Landers** dive for the nearest humanoid, grab it and haul it skywards. Shoot
  one before it reaches the top and the humanoid falls.
- A humanoid dropped from high up **dies on impact**. Fly into it while it falls
  to catch it, then descend to the ground to set it down.
- **Mutants** are what landers become once they reach the top with a humanoid —
  or what *every* lander becomes the moment the last humanoid dies. They chase
  you and shoot far more often.
- **Smart bombs** destroy every enemy currently on screen. You start with three
  and earn one per wave, up to six.
- You start with three ships. A bullet or a collision costs one, followed by two
  seconds of invulnerability.

## Scoring

| Event | Points |
|---|---|
| Lander or mutant destroyed | 150 |
| Humanoid returned to the ground | 500 |
| Wave cleared | 100 × wave × humanoids still alive |

Your best score is saved in the browser's `localStorage`.

## Development

Defender follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test Defender/tests/
```

`DESIGN.md` in this folder explains the world model, the entity state machines
and the assumptions behind the simplifications.
