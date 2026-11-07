# Shield of Faith

*"In addition to all this, take up the shield of faith, with which you can
extinguish all the flaming arrows of the evil one."* — Ephesians 6:16

A defence game rendered on an HTML5 `<canvas>` with vanilla JavaScript. No
build step, no server — just open `index.html`.

## How to play

Waves of fiery darts streak down toward six villages on the hillside. You
defend them from the watchman's post: **click anywhere in the sky** to send a
ray of light that flies to that point and opens into a golden **shield of
faith**. Any dart caught in the shield is quenched. Let one through and it
burns a village — lose all six and it's game over.

| Input | Action |
|---|---|
| Mouse click | Raise a shield of light at that point |
| `Space` | Start / restart |
| `P` | Pause / resume |

- **Chain your shields** to catch clusters of darts.
- **Watch your shields** — it's limited per wave and refills when you clear one.
- **Survive the wave** to bank a bonus for every village still standing; the next
  wave arrives faster and heavier.
- Your best score is saved locally.

## Running the tests

From the repository root:

```powershell
npx playwright test ShieldOfFaith/tests/
```

## Design

See [DESIGN.md](DESIGN.md) for the mechanics, architecture, and the assumptions
made while building the game.
