# Pipe Dream

Race the ooze! Green sludge pours from the source and creeps forward one pipe at
a time. Lay pipe from the queue to keep it flowing — connect **20** pipes before
it springs a leak and you win.

## How to play

- A **source** sits on the board with one open end. After a short head start, the
  ooze starts flowing out of it.
- **Click an empty tile** to drop the next pipe from the **Next** tray there.
- Build a connected path *ahead* of the ooze: each pipe must line up with the one
  before it.
- If the ooze reaches a dead end, a misaligned pipe, or the board edge, it
  **leaks** and the game is over.
- Fill **20** pipes to win. Your best score is saved between sessions.

### Pieces

Straights (─ │), curves (└ ┌ ┐ ┘), and a cross (┼). Curves turn the flow 90°; the
cross lets it run straight through. You always place the front piece of the
queue — plan around what's coming next.

### Controls

| Input | Action |
|---|---|
| Click an empty tile | Place the next queued pipe |
| Click (idle / end screen) | Start a new game |
| **P** | Pause / resume |
| **Start / Play Again** | Start / restart |

## Playing

Open `index.html` directly in a browser — no build step or server required.

## Tests

Playwright tests live in `tests/`. From the repository root:

```powershell
npx playwright test PipeDream/tests/
```

## How it works

See [design.md](design.md) for the board/piece model, the deterministic
`flowStep()` simulation, the seeded piece queue, and the state machine.
