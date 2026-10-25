# Qix — design notes

## Concept

The playfield is a 60x60 grid of cells framed by a one-cell border that you
already own. You steer a **marker** along the edge of the territory you own,
dart out into the open middle to draw a line (the **stix**), and the moment
that line touches owned ground again the loop it just closed is filled in and
becomes yours.

Three things want to stop you:

| Threat | Where it lives | What it does |
|---|---|---|
| **The Qix** | the open, unclaimed middle | a drifting line creature; if it crosses the stix you are drawing, you die |
| **Sparx** | the boundary lattice | electric sparks that patrol the edge of your territory and hunt the marker |
| **The fuse** | the stix itself | lights up when you stop while drawing and burns along your own line toward you |

Claim **75%** of the grid and the level is cleared. Lose all three lives and
the game is over.

The tension is the one the original arcade game found: a big loop is worth far
more than a small one, but every extra cell of line is more time for the Qix to
cross it and more rope for the fuse to burn.

## Mechanics

### The grid and the lattice

Two coordinate systems do all the work:

- **Cells** — `60 x 60`, each `10 x 10` px. `claimed[]` is one byte per cell.
  Anything outside the grid counts as claimed, which removes every
  special-case bounds check from the movement and flood-fill code.
- **Lattice points** — the `61 x 61` corners between cells. The marker, the
  Sparx and every stix vertex live on lattice points and travel along lattice
  edges.

A lattice edge is flanked by exactly two cells. That pair decides everything:

| Flanking cells | Meaning | Marker may move there |
|---|---|---|
| both claimed | solid owned ground | no |
| one claimed | the boundary of your territory | yes — a free walk, no line drawn |
| neither claimed | open space | yes — this starts or continues a line |

So "you cannot draw along a line you already own" is not a rule in the code,
it falls out of the table. A corner of the frame has no open-on-both-sides
edge, so you genuinely cannot start a line from a corner — same as the arcade.

A lattice point is a **boundary point** when any of its four surrounding cells
is claimed. Arriving at one while drawing closes the loop.

### Claiming

`closeLoop()` turns the stix into a set of blocked lattice edges and flood
fills the unclaimed cells, treating claimed cells as walls and blocked edges as
walls between neighbours. The fill therefore splits the open area into the
regions the new line carved out. Every region that does **not** contain a Qix
endpoint (or its midpoint) is claimed.

That single rule gives all the behaviour you want for free: the side the Qix is
on is always spared, a line that fails to separate anything claims nothing, and
cutting the Qix into a smaller and smaller pen is the natural way to play.

Sparing is deliberately generous: if the creature's two ends somehow land in
different regions, both are spared and the claim is worth nothing. Reaching
that state in play means the line went through the Qix, which is a death — but
the generous rule is what guarantees both of its ends stay on open ground, and
that invariant is the only thing keeping the creature from freezing solid
inside claimed territory.

Each claimed cell is worth `10` points, doubled if the line was drawn slowly.

### Speeds

| Thing | Speed |
|---|---|
| marker walking the boundary | 16 cells/s |
| marker drawing fast (default) | 16 cells/s, x1 points |
| marker drawing slow (hold Shift) | 8 cells/s, x2 points |
| Sparx | 11 cells/s |
| the Qix | 70 px/s, +8 per level |
| the fuse | 6 cells/s, after a 0.35 s pause |

The multiplier is captured when the line *starts*, so you cannot draw the
dangerous part fast and then tap Shift at the end.

### The Qix

Two endpoints with independent velocities, reflected per axis whenever the next
position would land on claimed ground, plus a small random kick on each bounce
so it never settles into a boring orbit. A distance constraint keeps the
segment roughly `QIX_LEN` long, which is what makes it tumble. Old positions
are kept in a short trail purely for looks.

Collision is a segment/segment intersection test between the Qix line and every
stix segment, including the partial segment under the moving marker. The Qix
cannot hurt you while you are walking the boundary — it only ever kills a line.

### Sparx

Each Sparx walks lattice edges that are on the boundary of your territory. At
every lattice point it rebuilds the list of legal boundary edges, drops the one
it came from, keeps going straight 75% of the time and otherwise takes the
option that closes on the marker. Claiming land rewrites the boundary under
their feet; a Sparx that finds itself with nowhere legal to go respawns on a
boundary point far from the marker.

A Sparx kills on contact with the marker, so they are only a threat while you
are on the boundary or just starting a line — once you are out in the middle
they cannot follow.

### Deterministic stepping

Everything runs through `stepGame(dt)` on a fixed `1/120 s` timestep, and the
interesting state (`state`, `player`, `stix`, `claimed`, `qix`, `sparx`,
`fuse`) is deliberately kept at the top level under those names, because the
Playwright suite drives the game through exactly those names. `autoRun = false`
freezes the animation loop so a test can place the marker, call `tryStep()` for
one instantaneous lattice step, or advance the simulation a known number of
frames and assert on the result.

Randomness goes through a small seeded LCG (`rand()`) rather than
`Math.random()`, so a level plays out the same way twice.

## Controls

| Input | Action |
|---|---|
| Arrow keys / WASD | move the marker |
| hold Shift / Z | draw slowly for double points |
| Space / Enter | start, and continue between levels |
| P | pause |
| click the board | start |

Moving off the boundary into open space starts a line automatically — there is
no separate draw button.

## Assumptions

Decisions taken without asking, erring toward the simpler reading:

1. **Branch name.** The task asked for a branch named after the game
   (`qix`), but the session's standing instructions pin all work to
   `claude/compassionate-ramanujan-is4idd` and forbid pushing anywhere else.
   The standing instruction wins; the game lives in `Qix/` instead.
2. **Drawing has no button.** In the arcade you hold a draw button. Here,
   stepping off the boundary into open space starts the line. Shift is kept
   only for the slow/fast (and so x2/x1) choice.
3. **The border counts toward the target.** The starting frame is 236 of 3600
   cells (6%), and that 6% is included in the percentage shown and in the 75%
   target, so a level needs roughly 69% of new ground.
4. **One Qix.** The arcade splits into two Qix on later levels. Here there is
   always one; later levels get faster and add a Sparx instead (2 at level 1,
   up to 5).
5. **Death is instant and so is respawn.** No death animation beyond a short
   screen flash; the marker reappears immediately on the boundary point
   furthest from the Sparx, the unfinished line is discarded.
6. **The fuse stops rather than retreats.** Moving again freezes the fuse where
   it is instead of pushing it back, so dithering is permanently expensive.
7. **Sparx cannot climb the stix.** The arcade's later "Super Sparx" do. Here
   they stay on the boundary, which makes the open middle a genuine refuge.
8. **No cosmetic state is tested.** The Qix trail, the claim flash and the
   progress bar are drawing-only and carry no rules.
