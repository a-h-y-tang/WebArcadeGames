# Soda Tapper

A four-lane soda-fountain arcade game on an HTML5 canvas. You are the soda jerk
stuck at the tap end of four bars. Thirsty patrons stream in from the door and
walk straight at you — slide a full mug down their bar to shove them back, and
push them all the way off the end to send them home happy. Then catch the empty
they slide back before it sails past you and shatters.

![Soda Tapper](screenshot.png)

## Playing

Open `index.html` in any modern browser. No build step and no server required.

## Controls

| Input | Action |
|---|---|
| `↑` `↓` / `W` `S` | move between bars |
| `Space` | pour a soda down the current bar (also starts the game when idle or after game over) |
| `Enter` | start / restart |
| `P` | pause / resume |
| click a bar | move there and pour — handy on a touch screen |

## How to play

**Pour early.** A mug only pushes the patron it actually reaches. Pouring on an
empty bar wastes the mug — it smashes on the floor at the far end and costs you a
life.

**One mug is rarely enough.** Each hit shoves a patron back about 110 px, then
they take a swig and start walking again. A patron who entered at the door needs
several sodas before they slide off the end.

**Catch your empties.** Every patron you serve slides their empty mug back down
the bar at you. Be standing on that lane when it arrives — you have a short
window between the catch line and the tap to switch lanes and grab it. Miss it
and it shatters.

**Watch all four bars.** You can only pour and only catch on the lane you are
standing on, so the game is really about deciding which bar can survive without
you for the next second.

## Losing a life

Three ways, and all of them clear the bar and give you a short breather:

- a patron reaches the tap and grabs you;
- a poured mug runs off the far end without hitting anyone;
- an empty mug gets past you at the tap end.

Three lives; the game ends when they run out.

## Scoring

| Event | Points |
|---|---|
| Patron served (pushed off the far end) | 100 × current level |
| Empty mug caught | 50 |
| Level cleared | 250 |

Your best score is stored in the browser under `sodatapper-best`.

## Levels

Level *n* needs `6 + 2n` patrons served — 8 on level 1, 10 on level 2, and so on.
Each level the patrons walk faster and arrive more often, down to a floor of one
arrival every 0.9 seconds. A level advances only when the target is met *and* the
bar is completely clear, so there is always a last empty mug to catch before the
banner appears.

## Development

The game is plain HTML, CSS and JavaScript with no dependencies. See
[DESIGN.md](DESIGN.md) for how the code is put together and which assumptions
were made.

Run the Playwright suite from the repository root:

```powershell
npx playwright test SodaTapper/tests/
```
