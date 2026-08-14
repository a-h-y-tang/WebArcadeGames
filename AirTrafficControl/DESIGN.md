# Air Traffic Control — Design

## Concept

You are the controller for a small, busy patch of airspace. Aircraft drift in
from the edges of the radar scope and keep flying in a straight line until you
tell them where to go. You tell them by **drawing a flight path with the
mouse**: press on an aircraft, drag a line across the scope, release. The
aircraft turns onto your line and flies it waypoint by waypoint.

Every aircraft has a destination determined by its type:

| Type       | Destination | Speed    | Look                       |
|------------|-------------|----------|----------------------------|
| Jet        | Runway      | 62 px/s  | cyan delta-wing triangle   |
| Helicopter | Helipad     | 40 px/s  | amber body with rotor disc |

Guide an aircraft onto its own destination and it lands: +1 point, and it
leaves the scope. Let any two aircraft touch and you lose the shift.

The pressure comes from density. Every landing shortens the gap between
arrivals, so the scope fills up faster and faster while the paths you have
already drawn keep executing whether you are watching them or not.

## Mechanics

### Airspace

The scope is a 720x480 canvas. Aircraft are kept inside it: an aircraft with no
path left to fly (or that has flown to the end of its path) continues on its
last heading and **reflects off the boundary** like a billiard ball, so nothing
ever disappears off-screen unattended. Everything is expressed per second and
advanced through `step(dt)`, so the tests can simulate frames deterministically
without depending on `requestAnimationFrame` timing.

### Flight paths

A path is a list of waypoints. Each frame an aircraft is given a travel budget
of `speed * dt` pixels and it walks its path: it heads straight at the first
waypoint, consumes it when it arrives, and spends whatever budget is left on
the next one — so a frame can cross several closely-spaced waypoints without
stalling. When the path runs out the remaining budget is spent flying straight
ahead (free flight, with boundary reflection).

Drawing collects pointer samples at least 6 px apart, clamped inside the scope.
Releasing commits the samples as the aircraft's new path, replacing any path it
was already flying. A press-and-release on an aircraft without dragging (fewer
than two samples) **clears** its path, leaving it in free flight.

### Landing

After movement, any aircraft within `LANDING_RADIUS` (16 px) of the destination
that matches its type lands: score +1, aircraft removed, arrivals speed up.
Arriving over the *wrong* destination does nothing at all — a helicopter can
cross the runway freely.

### Separation

After movement, every pair of aircraft is measured:

- closer than `ALERT_RADIUS` (52 px) — both are flagged `alert` and drawn with a
  pulsing warning ring, a "TOO CLOSE" warning appears in the HUD;
- closer than `SEPARATION_RADIUS` (20 px) — they collide, the shift ends, and
  the crash site is marked on the scope.

### Arrivals

`spawnInterval()` starts at 4.5 s and drops 0.12 s per landing, with a floor of
1.8 s. A spawn places an aircraft just inside a random edge, heading roughly
towards the middle of the scope (with jitter), and is skipped if no attempt
lands clear of existing traffic. At most `MAX_TRAFFIC` (7) aircraft are in the
air at once, which caps the worst case rather than the average one.

Randomness runs through a small seeded LCG (`setSeed`, `rand`) so a seeded run
reproduces exactly — used by the tests and handy for debugging.

## Controls

| Input                     | Action                                   |
|---------------------------|------------------------------------------|
| Drag from an aircraft     | Draw its flight path                     |
| Click an aircraft         | Clear its path (back to free flight)     |
| `Space`                   | Start, or start a new shift after a crash|
| `P`                       | Pause / resume                           |
| Start button              | Same as `Space`                          |

## Code layout

Single classic (non-module) script, matching Slime Volley, Kaboom and Tetris in
this repo, so state and helpers are reachable from Playwright as plain globals.

- `index.html` — HUD, canvas, overlay, controls legend
- `style.css` — dark radar-scope theme shared with the rest of the arcade
- `game.js`
  - constants (geometry, radii, speeds, arrival pacing)
  - state: `state`, `aircraft`, `score`, `best`, `spawnTimer`, `drawing`
  - `spawnAircraft(opts)` / `setPath(craft, points)` / `destinationFor(type)`
  - `step(dt)` — arrivals, movement, landings, separation
  - `beginDraw/dragDraw/endDraw` — pointer-independent path drawing, called by
    the pointer handlers so tests can drive either level
  - `draw()` — scope, destinations, paths, aircraft, alerts
- `tests/air-traffic-control.spec.js` — Playwright suite, written first

## Assumptions

These were ambiguous in the brief; the simpler reading was taken each time and
recorded here.

1. **Aircraft steer instantly.** Real traffic turns at a limited rate; here the
   heading snaps to the bearing of the next waypoint. It keeps the movement
   model exact and testable, and drawn paths are followed literally.
2. **Landing is proximity-only.** No approach heading or runway alignment is
   required — touching the destination at any angle lands the aircraft.
3. **One destination per type.** A single runway and a single helipad, rather
   than a configurable airport layout.
4. **No fuel, no holding patterns, no altitude.** The scope is a flat 2D plane;
   every aircraft is a conflict risk with every other aircraft.
5. **Wrong-destination overflights are free.** No penalty and no interaction, so
   the runway and helipad never become obstacles.
6. **Unattended aircraft bounce off the boundary** rather than leaving the
   scope. Leaving would need a "handoff versus lost aircraft" rule; bouncing
   keeps every arrival the controller's problem.
7. **Branch naming.** The task asked for a branch named after the game
   (`air-traffic-control`), while the session's standing instruction pins pushes
   to `claude/loving-euler-h5yvxi`. Work is developed under the game-named
   branch and pushed to the designated branch, which satisfies both.
8. **Game browser integration** is an entry in
   `game-browser/src/assets/games.json` (category `Strategy`), which is how
   every other game in the repo is listed.
