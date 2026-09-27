# Air Traffic Control

Route inbound aircraft onto their landing sites by drawing flight paths across a
radar scope — and never let two of them touch.

Open `index.html` in a browser. No build step, no server.

## How to play

Aircraft drift into the scope from the edges and keep flying straight ahead
until you give them somewhere to go.

- **Drag from an aircraft** to draw its flight path. It turns onto your line and
  flies it waypoint by waypoint.
- **Click an aircraft** (press and release without dragging) to clear its path
  and put it back into free flight.
- Guide each aircraft to the destination that matches its type:
  - **Jets** (cyan triangles, fast) land on the **runway**.
  - **Helicopters** (amber, slower) land on the **helipad**.
- Every landing is a point — and shortens the gap until the next arrival, so the
  scope fills up faster the better you do.
- Aircraft that get close flash a red warning ring. If two of them touch, the
  shift is over.

Aircraft never leave the scope on their own: with no path to fly they bounce off
the boundary and come back at you, so nothing can be safely ignored.

| Key | Action |
|---|---|
| `Space` | Start a shift, or start a new one after a crash |
| `P` | Pause / resume |

Your best score is kept in the browser's local storage.

## Files

| File | Purpose |
|---|---|
| `index.html` | HUD, canvas, overlay and controls legend |
| `style.css` | Dark radar-scope theme |
| `game.js` | Aircraft, path following, landings, separation, rendering |
| `DESIGN.md` | How the code works, and the design assumptions made |
| `tests/` | Playwright suite (78 tests) |

## Tests

From the repository root:

```powershell
npx playwright test AirTrafficControl/tests/
```
