# 8-Ball Pool

A top-down game of 8-ball on an HTML5 canvas, with a real rigid-body
simulation: rolling friction, cushion bounces, ball-to-ball collisions and six
pockets. Play the computer, or hand the mouse back and forth in two-player mode.

Open `index.html` in a browser — no build step and no server needed.

## How to play

1. Press **Space** (or click **Start Game**) to rack up and break.
2. Aim with the mouse, **hold** the button to fill the power meter, and
   **release** to shoot. The dotted line shows the cue's path, the outlined
   circle is where it will make contact, and the yellow line shows where the
   object ball will go.
3. The table is **open** until someone legally pots a ball. Whoever does gets
   that group — solids (1–7) or stripes (9–15) — and the opponent gets the other.
4. Pot one of your own balls and you shoot again. Miss, and it's the other
   player's turn.
5. Clear your whole group, then pot the **8-ball** to win. Pot the 8 early — or
   scratch while potting it — and you lose on the spot.

### Fouls

A foul gives your opponent **ball in hand**: they click anywhere on the table to
place the cue ball. The three fouls are:

* **Scratch** — the cue ball drops into a pocket.
* **No contact** — the cue ball hits nothing at all.
* **Wrong ball first** — first contact is an opponent's ball, or the 8-ball
  while you still have balls of your own on the table.

## Controls

| Input | Action |
|---|---|
| Mouse move | aim |
| Mouse hold / release | charge power, shoot |
| `←` `→` | fine-tune the aim (hold `Shift` for coarse steps) |
| `Space` | hold to charge, release to shoot (also starts a game) |
| Click | place the cue ball when you have ball in hand |
| `P` | pause / resume |
| `R` | new game |

The **Opponent** button under the table switches between playing the computer
and hot-seat two-player.

## Tests

```powershell
npx playwright test Pool/tests/
```

The suite covers the physics (friction, cushions, collisions, no tunnelling, no
escaping the table, determinism), the pockets, the 8-ball rules, ball in hand,
the HUD and controls, the computer's shot selection, and a full game played out
to a winner.

See [DESIGN.md](DESIGN.md) for how the code is put together.
