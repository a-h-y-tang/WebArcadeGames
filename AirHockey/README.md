# Air Hockey

The arcade table game, built with HTML5 Canvas — you versus the computer on a
portrait rink.

## How to Play

Open `index.html` in any modern browser — no build step, no dependencies.

| Input | Action |
|---|---|
| ← → ↑ ↓ arrows (or W A S D) | Move your mallet |
| Mouse over the table | Place your mallet under the cursor |
| P | Pause / resume |
| Arrow / Space or the button | Start or restart |

**Objective:** You control the **bottom** mallet; the computer controls the
**top**. Knock the puck through the gap in the computer's (top) wall to score,
and defend the gap in your own (bottom) wall. **First to 7 goals wins.**

**Physics:** The puck is nearly frictionless — it ricochets off the side walls
and the solid stretches of the end walls, but sails straight through the goal
mouths. Swipe your mallet *into* the puck to add your own momentum and fire it
across the table; a still mallet just deflects it.

**Wins:** Every match you win is added to a lifetime **Wins** tally saved in
`localStorage`, so your record persists between sessions.

See [DESIGN.md](DESIGN.md) for the concept, mechanics, controls, and how the
code works.
