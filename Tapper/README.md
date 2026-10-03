# Tapper

A four-lane bar service game on an HTML5 canvas. You work the taps; the
patrons keep coming.

## How to play

Patrons come in at the door end (left) of each of the four lanes and walk
steadily towards your taps on the right. Slide between lanes and pour mugs down
them: a mug that lands knocks the patron back down the bar while they drink.
Once a patron has had their fill they wander out of the door and you score.

Every drink also sends an **empty mug sliding back up the lane towards you** —
be standing in that lane when it arrives and you catch it for a bonus.

You lose a life when:

- a patron reaches the taps,
- a poured mug runs the whole lane without meeting anyone and smashes at the
  door end, or
- an empty mug comes back up a lane you are not standing in.

Serve the whole wave to advance a level: more patrons, walking faster, and from
level 4 onwards some of them want more than one drink before they leave. The
pips under a patron show how many drinks they still want.

## Controls

| Input | Action |
|---|---|
| ↑ / ↓ (or W / S) | move between lanes |
| Space | pour a mug down the current lane |
| Click a lane | jump to that lane and pour |
| P | pause / resume |
| Space (idle or game over) | start a new game |

## Scoring

| Event | Points |
|---|---|
| Mug landed on a patron | 100 |
| Empty mug caught | 50 |
| Patron served and out of the door | 150 |
| Wave cleared | 500 × level |

The best score is kept in `localStorage` under `tapper-best`.

## Playing it

Open `index.html` in any modern browser — no build step and no server needed.

## Tests

```powershell
npx playwright test Tapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is put together.
