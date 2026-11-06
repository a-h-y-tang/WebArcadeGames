# Soda Tapper

You are the only bartender on a four-lane soda bar, and every lane is filling up
with patrons walking in from the door. Slide a full mug down a lane to meet one,
and they drink it and get shoved back toward the door — then throw the empty mug
straight back at you. Push a patron all the way out of the door and they leave
satisfied. Miss an empty, let a mug smash against the door, or let a patron reach
the taps, and it costs you.

## How to play

1. Press **Space**, or click **Start Game**.
2. Move between lanes with **↑/↓** or **W/S**, or click the lane you want.
3. Press **Space** (or click a lane) to pour a mug down it.
4. Stand in a lane to catch the empty coming back.
5. Serve everybody the level sends and the level is yours. Five levels make a
   full shift.

Three lives. Every mishap costs one, and the last one ends the run. Your best
score is remembered between sessions.

## Points

| What | Points |
|---|---|
| A patron catches a mug | 50 |
| A patron leaves satisfied | 150 |
| An empty caught at the taps | 25 |
| Every life left when a level ends | 200 |

One mug is rarely enough: each drink shoves a patron 130 px back, so somebody who
has walked halfway down the bar needs two or three before the door takes them.

## Mishaps

| What | Cost |
|---|---|
| A full mug reaches the door with nobody to drink it | 1 life |
| An empty reaches the taps and you are in another lane | 1 life |
| A patron gets within reach of the taps | 1 life |

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | change lane |
| `Space` | start, pour, or dismiss an overlay |
| Click a lane | move there and pour |
| `P` | pause and unpause |

## Tips

- Pour early. A patron served near the door only needs one mug to be gone; one
  served near the taps needs three and leaves you an empty to catch from far away.
- Every mug you pour books a return trip. Two mugs in a lane means two empties
  coming back, and they arrive at the taps a fixed distance apart.
- The taps only hold two mugs per lane in flight, so spamming one lane wastes the
  pour you needed somewhere else.
- A queue cannot walk through itself: patrons stack up a mug's width apart, which
  means the lane with four patrons in it is slower than it looks — but a shove
  into a crowd is absorbed, so the front of a queue takes more mugs to clear.

## Files

- `index.html` — page shell, HUD, canvas and overlay
- `style.css` — cabinet styling
- `game.js` — simulation and rendering
- `DESIGN.md` — how the game works internally, and the assumptions behind it
- `tests/soda-tapper.spec.js` — Playwright suite

Run the tests from the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
