# Chinese Checkers

The classic race across a six-pointed star, for one player against the computer.
Plain HTML5 canvas and JavaScript — open `index.html` in a browser, no build step
and no dependencies.

Your ten green pegs start in the bottom point of the star; the computer's ten
amber pegs start in the top. You win by filling the top point, it wins by filling
the bottom. Nothing is ever captured — the whole game is about threading a path
through the pegs in your way, because a peg standing next to yours is a stepping
stone, and a chain of jumps can carry one peg from one end of the star to the
other in a single turn.

## How to play

1. Click one of your green pegs. Every hole it can reach is ringed.
2. Click a ringed hole to move there.
3. If you land a jump and another jump is on, the peg stays in hand — keep
   clicking to ride the chain as far as you like, then press **Esc** (or click
   the peg) to stop. The whole chain counts as one move.

### Rules

- **Step** one hole in any of the six directions of the board, if it is empty.
- **Jump** straight over a neighbouring peg of either colour into the empty hole
  directly beyond it.
- Jumps chain; a chain may never land twice on the same hole, and once a peg has
  jumped it may not finish the turn with a step.
- You win when all ten of your pegs stand in the far point. If the other side
  parks a peg in there to block you, nine of yours in a full point win it too.

### Controls

| Input | Action |
|---|---|
| Click a peg / a ringed hole | pick a peg up / move it |
| Arrow keys | move the keyboard cursor along the board's lines |
| Space or Enter | pick up the peg under the cursor, or move it there |
| Esc | put the peg down, or end a chain of jumps |
| **N** / **U** / **D** | new game / undo / switch the computer between Gentle and Keen |
| Buttons | New Game, Undo, Computer: Gentle/Keen |

**Gentle** plays the best move it can see, picking freely among moves of about
equal worth. **Keen** also looks at the reply you would get and is reluctant to
build a ladder you can ride.

## Development

Run the tests from the repository root:

```powershell
npx playwright test ChineseCheckers/tests/
```

[DESIGN.md](DESIGN.md) explains the board model, the rules engine, the computer
player and the assumptions behind them.
