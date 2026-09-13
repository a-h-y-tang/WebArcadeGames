# Soda Tapper

A one-screen arcade game about running four soda fountains at once, built with
plain HTML5 canvas and JavaScript — no build step, no dependencies. You stand at
the taps; the thirsty crowd pushes in from the far end of every bar. You can only
be on one bar at a time.

Slide a mug down a bar and it knocks the nearest customer back while they drink.
Keep knocking them back until they are pushed off the far end — that's a sale.
Then get back to their bar, because the empty they slide back at you smashes on
the floor if nobody is there to catch it.

Inspired by the 1983 Bally Midway classic.

![Soda Tapper screenshot](screenshot.png)

## How to play

Open `index.html` in any modern browser. Press **Space** (or click **Start
Shift**) to begin.

| Key | Action |
|---|---|
| ↑ / ↓ (or W / S) | Move up / down a bar |
| Space | Pour and slide a mug (and start / restart the game) |
| P / Esc | Pause / resume |

- **Serving.** A mug only catches a customer who is *walking*. Someone already
  drinking or sliding back has their hands full, so the mug runs straight past
  them — and a mug that reaches the far end smashes and costs a life. Pour with
  a reason, not on reflex.
- **Selling.** Each mug shoves a customer back a fixed distance. Push them past
  the far end of the bar and they leave: that's where the points are.
- **Empties.** Every departing customer sends their empty mug sliding back at
  you. Be standing on that bar when it arrives or it smashes.
- **Getting grabbed.** Let a customer reach the taps and they have you over the
  counter — one life.
- **Rowdiness.** Every mug a customer drinks makes them come back faster, so
  simply holding the crowd at bay is a losing plan. Sell, don't stall.
- You have three lives, and they are **not** refilled between rounds. Your best
  score is saved in the browser's `localStorage`.

### Rounds

Round *n* sends **4 + n** customers, and the round clears once they have all
been served and the bars are empty. Each round they walk faster and arrive
closer together.

### Scoring

| Event | Points |
|---|---|
| Mug landed | 10 |
| Customer served off the bar | 150 |
| Empty caught | 25 |
| Round cleared | 300 |

## Development

Soda Tapper follows the repo-wide test setup. From the repository root:

```powershell
npm install
npx playwright install chromium
npx playwright test SodaTapper/tests/
```

See [DESIGN.md](DESIGN.md) for how the code is structured, how the simulation is
kept deterministic for testing, and what the scripted playtesting changed about
the balance.
