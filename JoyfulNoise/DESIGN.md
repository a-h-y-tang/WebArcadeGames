# Joyful Noise — design

*"Make a joyful noise unto the LORD, all ye lands."* — Psalm 100:1

## Game concept

A falling-notes rhythm game. Four instruments of praise stand at the foot of the
screen — **harp, lyre, timbrel and trumpet** — and the notes of a hymn fall down
their four lanes towards a strike line. Press the lane's key as its note crosses
the line and the instrument sounds that note of the melody; play the whole hymn
in time and the tune plays back cleanly under your fingers.

Three public-domain hymn melodies ship with the game — *Amazing Grace*,
*Joyful, Joyful, We Adore Thee* and *Holy, Holy, Holy* — and three speeds. There
is no fail state: the hymn always plays to its last note, and the end screen
grades how much of it you caught.

This is the first rhythm game in the collection; every other music-adjacent game
here (Praise Echo) is a memory game rather than a timing one.

## Mechanics

### Charts are built from melodies, not hand-placed

Each song is stored as a melody: a list of `{ p, b }` steps, where `p` is a note
name (`'G4'`, `'F#4'`, `null` for a rest) and `b` is a length in beats. A chart
is derived from it (`buildChart`):

1. Beats become milliseconds at the song's tempo: `ms = beat * 60000 / bpm`.
2. The song's distinct pitches are sorted and split into four buckets, so the
   lowest quarter of the melody's range falls in the harp lane and the highest in
   the trumpet lane (`laneForPitch`). The melody's shape is therefore visible as
   movement across the lanes.
3. Every non-rest step becomes a note `{ time, lane, pitch, dur }`, sorted by
   time. Rests advance the clock only.

Because the chart is derived arithmetically from the melody and the tempo, it is
identical on every run — the tests assert against exact note times.

### Timing and judgement

`songTime` is the number of milliseconds since the hymn's first beat, after a
four-beat lead-in count. A note is judged by the gap between the press and the
note's time, taking the nearest unjudged note in that lane:

| Judgement | Window      | Points |
|-----------|-------------|--------|
| Perfect   | ≤ 50 ms     | 100    |
| Great     | ≤ 100 ms    | 60     |
| Good      | ≤ 160 ms    | 30     |
| Miss      | note passes 160 ms late | 0 |

Where two notes fall close together the press takes the **first** unstruck note
in its window rather than the nearest one, so a press a little late belongs to
the note it was aimed at instead of stealing the note behind it and leaving the
first to be missed.

A hit extends the combo and a miss ends it; the longest combo of the run is kept.
Accuracy is weighted — perfect 1, great 0.85, good 0.6, miss 0 — over the notes
judged so far, so it reads the same mid-hymn as at the end, where every note has
been judged and the denominator is the whole chart. The end screen turns it into
a grade: 95% "A joyful noise!", 80% "Well played", 55% "Keep praising", below
that "Give it another voice". The bands are set against whole runs — catching
every note of a hymn, even a little late, is always worth more than the bottom
grade, which is reserved for a hymn with notes left unstruck.

Notes approach the strike line over a fixed travel time set by the speed: Gentle
2200 ms, Steady 1600 ms, Lively 1100 ms. Speed changes how far apart the notes
look, never where they fall in time, so the same chart is playable at all three.

### Sound

A hit plays its own note of the melody through the Web Audio API (a triangle
voice with a short decay), so a clean run plays the hymn. The audio context is
created on the first press or click, and every call into it is guarded — the game
plays silently and without errors where audio is unavailable (headless test runs).

## Controls

| Action                   | Input                                        |
|--------------------------|----------------------------------------------|
| Start / restart the hymn | **Space**, **Enter** or the **Play** button  |
| Harp lane (lane 1)       | **D** or **←**                               |
| Lyre lane (lane 2)       | **F** or **↓**                               |
| Timbrel lane (lane 3)    | **J** or **↑**                               |
| Trumpet lane (lane 4)    | **K** or **→**                               |
| Pause / resume           | **P** or **Esc**                             |
| Choose hymn / speed      | The buttons under the canvas, or **1**–**3** |

Lanes can also be played by clicking or tapping the instrument pads, so the game
works on a touch screen.

## Code layout

One plain script, `game.js`, as in the rest of the collection, with the rules and
the live state reachable from Playwright as globals:

- **Melodies and charts** — `SONGS`, `laneForPitch`, `buildChart`, `pitchToMidi`.
- **State** — `state` (`score`, `combo`, `bestCombo`, counts per judgement,
  `phase`), `chart`, `songIndex`, `speedIndex`.
- **Timing** — `nowMs`, `songTimeMs`, `lastNoteMs`, `tick`, and a deterministic
  test clock:
  `freezeClock(ms)` pins the clock, `advanceClock(ms)` moves it on and runs a
  tick, and `thawClock()` hands timing back to the browser. A suite (or the
  console) can therefore place a press a known number of milliseconds from a
  note without waiting in real time. Unfrozen, `nowMs` is `performance.now()`.
- **Play** — `pressLane`, `judgeFor`, `releaseLane`, `startSong`, `togglePause`.
- **Drawing** — `draw`, called from the animation frame. It lays down the lanes,
  a beat grid that scrolls with the hymn, the count and combo watermark, then the
  notes, the strike line, the instrument pads and the judgement flash, in that
  order, so no text ever hides a falling note.

## Assumptions

- **Branch name.** The task asks for a branch named after the game
  (`joyful-noise`), but this repository's standing instructions pin development
  to `claude/compassionate-ramanujan-7iqvp3` and allow pushing to no other
  branch. The work is therefore committed on the pinned branch, which is also
  what every recent game in this repo did.
- **No fail state.** Missing notes costs score and combo but never ends the hymn
  early. The simpler and kinder reading for a family-friendly site, and it keeps
  the end screen's accuracy meaningful.
- **A press on an empty lane is ignored.** It neither scores nor breaks the
  combo. Arcade rhythm games usually punish it; for young players the gentler
  rule was chosen, and it keeps mashing from being scored as skill because every
  note still has to be struck in its own window.
- **Hymn melodies are approximations.** The three tunes are public-domain
  melodies transcribed by ear into the melody format at a readable tempo; they
  carry the shape of each hymn rather than a hymnal's exact rhythm.
- **Lane assignment is by pitch bucket**, not by hand-authored choreography, so a
  repeated pitch always falls in the same lane. Simpler, deterministic, and it
  makes the melody's rise and fall legible on screen.
- **One note per lane at a time.** The melodies are single-voice, so no chart
  needs two notes struck together, and `pressLane` judges exactly one note.
