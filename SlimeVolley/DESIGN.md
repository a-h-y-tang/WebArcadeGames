# Slime Volley — Design

## Concept

Slime Volley is a two-player physics volleyball match played by two **slimes** —
half-discs that walk and jump on a sand court divided by a net. The player
controls the green slime on the left; the computer controls the pink slime on
the right. A single ball falls under gravity and bounces off the walls, the
ceiling, the net and the domes of both slimes. Whoever lets the ball touch the
sand **on their own side** concedes the point. First to `WIN_SCORE` (7) points
wins the match.

The appeal is the physics: a slime's dome is a curved surface, so *where* on the
dome you make contact decides the angle the ball leaves at. Catching the ball on
the outside flank sends it flat and fast; catching it dead centre lobs it high.
Jumping into the ball adds pace, and walking into it adds sideways drift.

## Mechanics

- **The court** is a 600×400 canvas. The sand line is at `GROUND_Y` (340); the
  net is a `NET_W`-wide (8 px) post standing at `NET_X` (the exact middle) with
  its rim at `NET_TOP` (90 px above the sand).
- **The slimes** are half-discs of radius `SLIME_R` (32). Each is confined to its
  own half — the outer wall on one side, the net post on the other — so neither
  slime can ever cross the net. They walk at `MOVE_SPEED` and jump with
  `JUMP_V`, falling back under `SLIME_GRAVITY`. Jumping is only allowed from the
  ground, so there is no double-jump.
- **The ball** is a circle of radius `BALL_R` (11) under `GRAVITY`. It bounces
  perfectly elastically off the side walls and the ceiling (there is no floor
  bounce — touching the sand ends the point).
- **Hitting.** Only the *upper* half of a slime's disc is solid, so a ball rolling
  along the sand can never be scooped from underneath. On contact, the ball is
  pushed clear of the dome and leaves along the contact normal at its incoming
  speed, clamped to `[MIN_HIT_SPEED, MAX_BALL_SPEED]`, plus a fraction of the
  slime's own walking (`HIT_PUSH_X`) and jumping (`HIT_PUSH_Y`) velocity.
- **Aiming bias.** A contact whose normal is nearly vertical (|nx| < `AIM_MIN_X`)
  is angled toward the opponent's court instead. Without this, a ball struck
  dead-centre bounces straight up and down forever and the point can never end —
  this was found by simulating a full match during development (see *Testing*).
- **The net** is solid: a ball level with the post is turned back sideways; a
  ball dropping onto the rim reflects off the nearest point of the post, so
  tape shots that trickle over are possible.
- **Scoring.** When the ball touches the sand, the side it landed on concedes.
  The winner of the point serves next: the ball is placed above the middle of
  the winner's court and hangs for `SERVE_DELAY` (0.7 s) before dropping.
- **Rally counter.** Every slime contact increments `rally`; a point resets it.
  The longest rally of the session is kept as *Best Rally* and persisted in
  `localStorage` under `slime-volley-best`.

### Key constants

| Constant | Value | Meaning |
|---|---|---|
| `GROUND_Y` | 340 | sand line |
| `NET_H` / `NET_W` | 90 / 8 | net height above the sand, post width |
| `SLIME_R` / `BALL_R` | 32 / 11 | dome radius, ball radius |
| `MOVE_SPEED` / `JUMP_V` | 300 / 740 | player walk speed, jump launch speed |
| `GRAVITY` / `SLIME_GRAVITY` | 1100 / 2200 | px/s² on the ball / on the slimes |
| `MIN_HIT_SPEED` / `MAX_BALL_SPEED` | 380 / 900 | speed floor and ceiling after a hit |
| `AIM_MIN_X` | 0.32 | minimum sideways component of a hit |
| `WIN_SCORE` | 7 | points needed to take the match |

## Controls

| Key | Action |
|---|---|
| ← / A | Walk left |
| → / D | Walk right |
| ↑ / W | Jump |
| Space | Start / restart the match; jump while playing |
| P | Pause / resume |

## Opponent AI

The rival is deliberately simple and beatable, and uses no lookahead physics:

1. While the ball is on its half it walks toward `ball.x + ball.vx * 0.12` — the
   ball's position with a crude 0.12 s lead — clamped to its own court.
2. Otherwise it drifts back to the middle of its half (`AI_REST_X`).
3. It jumps when a ball on its side is within 70 px horizontally and above dome
   height.

Because the lead is a fixed linear extrapolation rather than a real trajectory
solve, the AI misjudges high lobs and fast flat drives — which is where the
player's openings come from. It also walks slightly slower than the player
(`AI_SPEED` 268 vs `MOVE_SPEED` 300).

## Code structure

The game is a single classic (non-module) script, matching the rest of this repo
(Kaboom, Dino Run, Tetris). Everything lives as plain globals so the Playwright
tests can reach state and helpers directly.

| Area | Functions |
|---|---|
| Controls | `movePlayer(dir)`, `jump()`, `togglePause()` |
| Match flow | `startGame()`, `endGame(winner)`, `serve(who)`, `scorePoint()` |
| Physics | `step(dt)`, `substep(h)`, `integrateSlime()`, `collideBounds()`, `collideNet()`, `collideSlime(slime, aimDir)` |
| AI | `updateAi(h)` |
| Presentation | `draw()`, `drawSlime()`, `drawShadow()`, `updateHud()`, `showOverlay()` |
| Test hook | `setBall(x, y, vx, vy)` — place the ball and put it straight into play |

### Determinism

`step(dt)` advances the world in fixed `1/240 s` sub-steps, so:

- fast balls cannot tunnel through the 8 px net or a slime between frames;
- the result depends only on the total `dt`, not on the frame rate;
- tests can call `step(0.016)` in a loop and get exactly the same world the
  browser produces at 60 fps.

The render loop (`frame`) does nothing but clamp `dt`, call the same `step()` the
tests call, and draw. The only randomness in the game is in the cosmetic impact
sparks, which never touch the simulation.

## Testing

`tests/slime-volley.spec.js` drives the page from `file://` with Playwright — no
server needed — and covers the initial state, starting, movement and jumping
limits, ball/wall/ceiling physics, all three net cases, dome-contact angles and
speed clamping, scoring and serve rotation, match end, the best-rally record, the
AI's behaviour, and pause/restart.

Two behaviours came out of writing tests and simulating matches rather than from
the original sketch:

1. **The vertical-stalemate bug.** A scripted match between two mirror-image AIs
   ran for three simulated minutes at 0–0 with a 260-hit rally: the ball was
   being struck dead centre every time and bouncing straight up. `AIM_MIN_X` is
   the fix. After it, the same scripted match finishes 7–5 in ~70 s with rallies
   averaging ~6 hits.
2. **Test fixtures must respect the AI.** Several scoring tests originally
   dropped the ball at `x = 450`, which is exactly where the rival stands at rest
   — it kept saving them. They now pull the rival aside first, which is a fixture
   fix, not a game change.

Run them from the repository root:

```powershell
npx playwright test SlimeVolley/tests/
```

## Assumptions

The task description left some things open. Where it did, the simpler reading was
taken and recorded here.

- **Branch name.** The task asks for a branch named after the game
  (`slime-volley`), but this session is also configured with a fixed development
  branch, `claude/loving-euler-0qwme7`, and told never to push elsewhere. The
  configured branch wins; the game name is carried by the folder, the commit and
  the PR title instead.
- **Match format.** First to 7 points, with no win-by-two requirement and no
  deuce. Simpler to explain, and it keeps a match to roughly a minute.
- **Serving.** The winner of a point serves the next one (rally scoring, as in
  modern volleyball). The serve is a drop, not a struck serve: the ball simply
  hangs for 0.7 s above the server's court and then falls.
- **One touch per side.** There is no three-touch rule and no rotation — a slime
  may hit the ball as many times in a row as it can reach. Enforcing volleyball's
  touch rules would need per-side touch tracking with little gain in fun.
- **No floor bounce.** The ball touching the sand always ends the point, so there
  is never a question of whether a bounce was "in".
- **`setBall` is a test hook.** It exists so tests can construct a situation
  directly. It also cancels any pending serve delay, since "put the ball here
  moving like this" means "in play now". Nothing in the game itself calls it.
- **Single player only.** The right slime is always the computer; there is no
  two-human mode, since the repo's other head-to-head games (Air Hockey, Pong)
  are also player-vs-computer.
