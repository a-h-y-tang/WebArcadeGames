# Hezekiah's Tunnel

*"...and how he made the pool and the tunnel and brought water into the city..."*
— 2 Kings 20:20

King Hezekiah's workmen cut a channel through solid rock to bring the water of
the Gihon spring inside Jerusalem's walls, into the Pool of Siloam
(2 Kings 20:20; 2 Chronicles 32:30). You are the engineer — and the spring is
already running.

A pipe-laying race on an HTML5 canvas. No build step and no dependencies: open
`index.html` in a browser.

## How to play

Sections of hewn channel arrive one at a time from the stonecutters; the next
five are shown beside the board. Lay each one on the bedrock so the water, when
it comes, runs from the spring on the left all the way to the pool on the right.

* **Lay a section** by clicking any patch of bare ground, or by moving the
  cursor with the **arrow keys** and pressing **Space**. The section at the head
  of the queue is the one that goes down — it cannot be skipped, and once it is
  laid it cannot be moved.
* **Rock cannot be dug.** Every stretch scatters outcrops across the bedrock,
  and there is always at least one way around them.
* **The countdown** at the top of the screen is all the time you have before the
  spring starts to run: twelve seconds on the first stretch, eight on the last.
* **The water** then moves at a steady pace through whatever you have laid.
  Every cell it fills scores **10**.
* **A leak** — water meeting bare ground, rock, the edge of the grid, a section
  with no opening facing it, or a channel that has already run — costs a **day**
  of digging, and the stretch is laid out afresh. Three lost days end the dig.
* **Reaching the pool** finishes the stretch and pays a **200** bonus. Five
  stretches complete the tunnel.

A long, winding route scores more than a short dash, so when the countdown is
generous it pays to wander.

### The sections

| Shape | Opens onto |
|---|---|
| Straight | west–east, or north–south |
| Elbow | two sides at a right angle |
| Cross | all four sides — and it carries two separate channels, so a route may cross itself |

### Controls

| Input | Action |
|---|---|
| Mouse click | Lay the next section on that cell |
| Arrow keys | Move the cursor |
| Space / Enter | Start the dig, lay a section, dismiss an overlay |
| P | Pause / resume |
| N | New game |

## Files

| File | What it is |
|---|---|
| `index.html` | Page, HUD, overlay and rules |
| `style.css` | Styling |
| `game.js` | Board, sections, water simulation and drawing |
| `DESIGN.md` | How the code works, and the assumptions behind the rules |
| `tests/` | Playwright suite |

## Tests

From the repository root:

```powershell
npx playwright test HezekiahsTunnel/tests/
```
