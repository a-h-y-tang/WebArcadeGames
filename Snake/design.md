# Snake — Design Document

## Architecture

The game is a single HTML page with no dependencies: `index.html`, `style.css`, and `game.js`.

## Grid Model

The play field is a **20×20 logical grid**. Each cell is rendered as 25×25 pixels, giving a 500×500 canvas. All game logic works in grid coordinates (integers); only the draw step converts to pixel coordinates.

## State Machine

`state` is one of four values that gate what each subsystem does:

```
idle ──► running ──► paused ──► running
                └──► over ──► running
```

- **idle**: start screen visible, no loop running.
- **running**: `requestAnimationFrame` loop active.
- **paused**: loop cancelled, overlay shown.
- **over**: end screen shown with final score.

## Game Loop

`requestAnimationFrame` drives the loop. Rather than using `setInterval` (which fires off-time during tab switches), the loop compares `timestamp - lastTime` against the current speed threshold each frame. This gives smooth animation and easy speed control.

```js
function loop(timestamp) {
    if (elapsed >= speedMs(score)) {
        lastTime = timestamp;
        tick();   // advance game state
    }
    draw();       // render every frame regardless
    animId = requestAnimationFrame(loop);
}
```

`speedMs(score)` starts at **150 ms** and drops by 4 ms per point, flooring at **70 ms**, so the game noticeably accelerates without becoming unplayable.

## Snake Representation

The snake is an array of `{x, y}` grid cells. Index 0 is the head; the last index is the tail.

- **Move:** prepend a new head, pop the tail.
- **Grow:** prepend a new head, do NOT pop the tail.

This makes both operations O(1) amortized and keeps the snake in correct draw order.

## Collision Detection

On each tick, the new head position is computed before any mutation:

1. **Wall:** `head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS`
2. **Self:** iterate `snake[0..length-2]` (the tail tip is excluded because it vacates its cell this same tick).

## Direction Buffering

To prevent a known Snake bug where two direction keys pressed between ticks cancel into a reversal, a single `pendingDir` slot is used. The current direction is applied at the start of `tick()`, not immediately on keydown. Reversal into the opposite direction is rejected at input time by comparing against `OPPOSITE[currentKey]`.

## Food Spawning

`randomCell(exclude)` picks a random grid cell in a `do/while` loop, rejecting positions occupied by any snake segment. This is O(n) worst-case but negligible for a 20×20 grid.

## Rendering

Each frame:
1. Fill canvas with background color.
2. Draw the subtle grid lines (0.5 px, dark).
3. Draw food as a rounded rect with a red `shadowBlur` glow.
4. Draw snake body segments (index 1…n) in medium green.
5. Draw the head (index 0) in a lighter green for visual distinction.

`ctx.roundRect` (supported in all modern browsers since 2023) keeps the draw calls simple.

## Persistence

`localStorage` stores the all-time best score under the key `snake-best`. It is read on page load and written only when a new high score is set.
