# Tapper

A four-lane tavern arcade game. You are the bartender, stuck at the right-hand
end of four bars while thirsty patrons shuffle towards you from the doors on the
left. Slide a full mug down a bar to shove a patron back — then catch the empty
when it comes sliding back, or it shatters and costs you a life.

Open `index.html` in any browser. No build step, no server.

## How to play

| Input | Action |
|---|---|
| `↑` / `W` | move up one bar |
| `↓` / `S` | move down one bar |
| `Space` / `Enter` | pull the tap |
| `P` | pause / resume |

`Space` also starts the game from the title screen and restarts after a game
over.

## Rules

- **Serve.** A full mug slides left down the bar you are standing at. When it
  reaches a patron it shoves them back towards the door and they stop to drink.
  **+50**
- **Clear the bar.** A patron shoved all the way out of the door leaves
  satisfied and counts towards the level quota. **+200**
- **Catch the empties.** Every drink finished sends an empty mug sliding back to
  the tap. Be standing at that bar when it arrives. **+25**
- **Tips.** Every third satisfied patron flips a coin onto the bar. Catch it the
  same way you catch an empty. **+500**. Missing a tip costs nothing.
- **Clear the wave.** Serve the level's quota of patrons for a **300 × level**
  bonus and a faster, busier next level.

## Losing a life

Three ways, and you start with three lives:

1. A patron reaches you at the tap end.
2. An empty mug reaches the tap while you are on a different bar.
3. A full mug slides all the way down a bar with nobody on it.

Losing a life sweeps every mug, patron and tip off the bars — but you keep the
progress you had already made towards the level quota.

## Tips for playing

- Do not pour blind. A mug down an empty bar is a wasted life.
- Each bar holds at most two full mugs at once, so you cannot spam your way out
  of a crowded bar — you have to pick which one is closest to grabbing you.
- A patron mid-drink is still a valid target. A second mug shoves them again and
  restarts their timer, which is the fastest way to clear someone who came in
  close to the tap.
- The empty always comes back. Count your pours per bar, because every one of
  them is a mug you owe yourself a catch for.

## Design

`DESIGN.md` in this folder explains the geometry, the entity model, the
difficulty curves, and the assumptions taken while building it.

## Tests

Playwright specs live in `tests/tapper.spec.js` and drive the page over
`file://`.

```powershell
npx playwright test Tapper/tests/
```
