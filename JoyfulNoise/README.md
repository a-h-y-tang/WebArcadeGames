# Joyful Noise

*"Make a joyful noise unto the LORD, all ye lands."* — Psalm 100:1

A falling-notes rhythm game on four instruments of praise. The notes of a hymn
fall down four lanes — **harp, lyre, timbrel and trumpet**, low notes on the left
and high notes on the right. Strike a lane as its note crosses the line and that
instrument sounds the note, so a clean run plays the tune under your fingers.

Three hymns are included — *Amazing Grace*, *Joyful, Joyful, We Adore Thee* and
*Holy, Holy, Holy* — at three speeds. There is no way to lose: the hymn always
plays through to its last note, and the end screen grades how much of it you
caught.

## How to play

1. Open `index.html` in any modern browser (no build step, no server).
2. Choose a hymn and a speed, then press **Space** (or **Play**) to begin.
3. A four-beat count leads in, then strike each note as it reaches the line.

### Controls

| Action                   | Input                                        |
|--------------------------|----------------------------------------------|
| Start / play again       | **Space**, **Enter** or the **Play** button  |
| Harp lane (far left)     | **D** or **←**                               |
| Lyre lane                | **F** or **↓**                               |
| Timbrel lane             | **J** or **↑**                               |
| Trumpet lane (far right) | **K** or **→**                               |
| Pause / resume           | **P** or **Esc**                             |
| Start the hymn again     | **R**                                        |
| Choose hymn 1, 2 or 3    | **1**, **2**, **3**                          |

A lane can also be played by clicking or tapping anywhere in its column, so the
game works on a touch screen.

### Scoring

| Judgement | How close           | Points |
|-----------|---------------------|--------|
| Perfect   | within 50 ms        | 100    |
| Great     | within 100 ms       | 60     |
| Good      | within 160 ms       | 30     |
| Missed    | the note passes by  | 0      |

Every note struck lengthens your combo and a note let slip ends it; the longest
combo of the run is kept. A press on an empty lane costs nothing, so there is no
penalty for a stray finger — but mashing scores nothing either, because each note
still has to be struck inside its own window.

Accuracy weighs the judgements (perfect 1, great 0.8, good 0.4) and the end
screen turns it into a grade, from *Give it another voice* up to *A joyful
noise!* at 95%.

## How it works

`DESIGN.md` covers the design in full. In short: each hymn is stored as a melody
of notes and beats, and the chart — note times, and which lane each note falls in
— is derived from it arithmetically, so it is the same on every run. Hits are
judged on the gap between the press and the note's time, and each hit plays its
own pitch through the Web Audio API.

## Tests

```powershell
npx playwright test JoyfulNoise/tests/
```

The suite drives the game through a pinned clock (`freezeClock` /
`advanceClock`), so a press can be placed an exact number of milliseconds from a
note: it covers the chart built from each melody, every timing window, misses,
combos, accuracy and grading, the keyboard, the pads, pausing, and the drawing.
