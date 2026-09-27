# Droid Arena

A single-screen twin-stick arena shooter. You are dropped into a sealed robot
testing arena with waves of hostile droids and a handful of stranded civilians.
Move with one hand, shoot with the other, clear every destructible droid to
advance — and grab the civilians before the hulks flatten them.

Open `index.html` in any browser. No build step, no server.

## Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move (eight directions) |
| `←` `↑` `→` `↓` | Shoot in that direction |
| `Space` | Start / restart |
| `P` | Pause / resume |

Movement and aiming are completely independent — that is the game. You never
stop firing to run, and you can back-pedal while covering the way you came.

## How to play

- **Clear the wave.** A wave ends when every destructible droid is gone. Grey
  hulks are indestructible and do not hold the wave open — ignore them, or use
  your shots to shove them out of the way.
- **Stay off everything.** Touching any droid, or catching a sentry's shot,
  costs a life. You start with three and earn another every 25,000 points.
- **Rescue civilians.** Walk into one to save them: 1000 points, then 2000,
  3000, 4000 and 5000 for a chain of rescues in the same wave. The chain resets
  each wave and whenever you lose a life, so a full five-rescue sweep is worth
  15,000 points.

## The droids

| Droid | Behaviour | Score |
|---|---|---|
| **Grunt** (red) | Walks straight at you and speeds up every wave. One shot kills it. | 100 |
| **Sentry** (violet) | Drifts around the arena and fires slow aimed shots. The ring around it shows how close the next shot is. | 200 |
| **Hulk** (grey) | Indestructible. Slides along one axis at a time and tramples any civilian it touches. Your shots only knock it back. | — |

Waves get bigger as you go: more grunts, more sentries, and up to four hulks.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell — HUD, canvas and overlay |
| `style.css` | Presentation |
| `game.js` | All game logic and rendering |
| `DESIGN.md` | How the code works, and the design decisions behind it |
| `tests/droid-arena.spec.js` | Playwright test suite |

## Tests

From the repository root:

```powershell
npx playwright test DroidArena/tests/
```
