This repo holds many arcade games accessible from one central home page.

For each new game, put it in a new folder. Each game should have its own README.md to describe how it works and how to play. Each game should include a design.md that explains how the code works.

## Games

| Game | Folder | Status |
|---|---|---|
| Snake | [Snake/](Snake/) | Complete |
| Reversi (Othello) | [Reversi/](Reversi/) | Complete |
| Match-3 | [Match3/](Match3/) | Complete |
| Space Invaders | [SpaceInvaders/](SpaceInvaders/) | Complete |
| Flappy Bird | [FlappyBird/](FlappyBird/) | Complete |
| 2048 | [2048/](2048/) | Complete |
| Tetris | [Tetris/](Tetris/) | Complete |
| Breakout | [Breakout/](Breakout/) | Complete |
| Connect Four | [ConnectFour/](ConnectFour/) | Complete |
| Simon | [Simon/](Simon/) | Complete |
| Galaga | [Galaga/](Galaga/) | Complete |
| Lights Out | [LightsOut/](LightsOut/) | Complete |
| Dino Run | [DinoRun/](DinoRun/) | Complete |
| Whack-a-Mole | [WhackAMole/](WhackAMole/) | Complete |
| Bubble Shooter | [BubbleShooter/](BubbleShooter/) | Complete |
| Pac-Man | [PacMan/](PacMan/) | Complete |
| Bomberman | [Bomberman/](Bomberman/) | Complete |
| Centipede | [Centipede/](Centipede/) | Complete |
| Tron Light Cycles | [Tron/](Tron/) | Complete |
| Lunar Lander | [LunarLander/](LunarLander/) | Complete |
| Missile Command | [MissileCommand/](MissileCommand/) | Complete |
| Pong | [Pong/](Pong/) | Complete |
| Minesweeper | [Minesweeper/](Minesweeper/) | Complete |
| Frogger | [Frogger/](Frogger/) | Complete |
| Asteroids | [Asteroids/](Asteroids/) | Complete |
| Sokoban | [Sokoban/](Sokoban/) | Complete |
| Doodle Jump | [DoodleJump/](DoodleJump/) | Complete |
| Xonix | [Xonix/](Xonix/) | Complete |

## Playing

Open any game's `index.html` directly in a browser — no build step or server required.

## Development

### Prerequisites

- [Node.js](https://nodejs.org) (LTS) — required for running tests

Install Node.js on Windows via winget:

```powershell
winget install OpenJS.NodeJS.LTS
```

### Install dependencies

```powershell
npm install
npx playwright install chromium
```

### Running tests

```powershell
npm test
```

Tests for all games live in `<GameFolder>/tests/` and are picked up automatically. To run just one game's tests:

```powershell
npx playwright test Snake/tests/
```

To run with a visible browser (useful for debugging):

```powershell
npx playwright test --headed
```

To open the interactive Playwright UI:

```powershell
npm run test:ui
```

### .gitignore

`node_modules/` and Playwright's generated output (`test-results/`, `playwright-report/`) are gitignored. Everything else — source files, test specs, `package.json`, `playwright.config.js` — should be committed.
