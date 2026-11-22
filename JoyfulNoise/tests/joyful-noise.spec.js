const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers
//
// The game exposes its chart and its live state as globals, plus a frozen test
// clock (freezeClock / advanceClock), so a press can be placed a known number of
// milliseconds away from a note without waiting in real time.
// ---------------------------------------------------------------------------

// Start a hymn with the clock pinned at 0, so songTime is exactly the amount of
// time advanced minus the lead-in.
async function startFrozen(page, songIndex = 0, speedIndex = 1) {
    await page.evaluate(([song, speed]) => {
        setSpeed(speed);
        freezeClock(0);
        startSong(song);
    }, [songIndex, speedIndex]);
}

// The song time at which a given note of the chart should be struck.
async function noteAt(page, index) {
    return page.evaluate((i) => {
        const n = chart[i];
        return { time: n.time, lane: n.lane, pitch: n.pitch };
    }, index);
}

async function songTime(page) {
    return page.evaluate(() => Math.round(songTimeMs()));
}

async function getState(page) {
    return page.evaluate(() => ({
        score: state.score,
        combo: state.combo,
        bestCombo: state.bestCombo,
        perfect: state.counts.perfect,
        great: state.counts.great,
        good: state.counts.good,
        miss: state.counts.miss,
        phase: state.phase,
    }));
}

// Advance the frozen clock to a song time and press a lane there.
async function pressAt(page, time, lane) {
    await page.evaluate(([t, l]) => {
        advanceClockTo(LEAD_IN_MS + t);
        pressLane(l);
    }, [time, lane]);
}

const LANE_KEYS = ['d', 'f', 'j', 'k'];

async function keyPressAt(page, time, lane) {
    await page.evaluate((t) => advanceClockTo(LEAD_IN_MS + t), time);
    await page.keyboard.press(LANE_KEYS[lane]);
}

// Play the whole hymn perfectly through the public press path.
async function playPerfectly(page) {
    await page.evaluate(() => {
        for (const note of chart) {
            advanceClockTo(LEAD_IN_MS + note.time);
            pressLane(note.lane);
        }
        advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50);
    });
}

test.describe('Joyful Noise', () => {
    const errors = [];
    test.beforeEach(async ({ page }) => {
        errors.length = 0;
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(GAME_URL);
    });

    // -------------------------------------------------------------------
    // Initial state
    // -------------------------------------------------------------------
    test.describe('initial state', () => {
        test('page title is Joyful Noise', async ({ page }) => {
            await expect(page).toHaveTitle('Joyful Noise');
        });

        test('canvas is 460x620', async ({ page }) => {
            const canvas = page.locator('#canvas');
            await expect(canvas).toHaveAttribute('width', '460');
            await expect(canvas).toHaveAttribute('height', '620');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(300);
            expect(errors).toEqual([]);
        });

        test('shows the Psalm 100 verse', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText('joyful noise');
            await expect(page.locator('#verse')).toContainText('Psalm 100');
        });

        test('score, combo and accuracy start empty', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#combo')).toHaveText('0');
            await expect(page.locator('#accuracy')).toHaveText('100%');
        });

        test('waits on the title screen until the player starts', async ({ page }) => {
            expect((await getState(page)).phase).toBe('ready');
            await expect(page.locator('#overlay')).toBeVisible();
        });

        test('offers three hymns and three speeds', async ({ page }) => {
            await expect(page.locator('.song-btn')).toHaveCount(3);
            await expect(page.locator('.speed-btn')).toHaveCount(3);
        });

        test('names the four instrument lanes and their keys', async ({ page }) => {
            const lanes = await page.evaluate(() => LANES.map((l) => l.name));
            expect(lanes).toEqual(['Harp', 'Lyre', 'Timbrel', 'Trumpet']);
            const keys = await page.evaluate(() => LANES.map((l) => l.key));
            expect(keys).toEqual(['D', 'F', 'J', 'K']);
        });
    });

    // -------------------------------------------------------------------
    // Charts built from the melodies
    // -------------------------------------------------------------------
    test.describe('charts', () => {
        test('every hymn builds a non-empty chart', async ({ page }) => {
            const sizes = await page.evaluate(() => SONGS.map((s) => buildChart(s).length));
            expect(sizes.length).toBe(3);
            for (const size of sizes) expect(size).toBeGreaterThan(20);
        });

        test('notes are ordered in time and sit in the four lanes', async ({ page }) => {
            const bad = await page.evaluate(() =>
                SONGS.flatMap((s) => {
                    const notes = buildChart(s);
                    const problems = [];
                    notes.forEach((n, i) => {
                        if (i > 0 && n.time < notes[i - 1].time) problems.push(`${s.name}: out of order at ${i}`);
                        if (!Number.isInteger(n.lane) || n.lane < 0 || n.lane > 3) problems.push(`${s.name}: lane ${n.lane}`);
                        if (!(n.time >= 0)) problems.push(`${s.name}: time ${n.time}`);
                    });
                    return problems;
                })
            );
            expect(bad).toEqual([]);
        });

        test('rests advance the clock but drop no note', async ({ page }) => {
            const result = await page.evaluate(() => {
                const song = { name: 'test', bpm: 60, melody: [{ p: 'C4', b: 1 }, { p: null, b: 2 }, { p: 'C5', b: 1 }] };
                const notes = buildChart(song);
                return { count: notes.length, times: notes.map((n) => n.time) };
            });
            expect(result.count).toBe(2);
            expect(result.times).toEqual([0, 3000]);
        });

        test('beats become milliseconds at the hymn tempo', async ({ page }) => {
            const times = await page.evaluate(() => {
                const song = { name: 'test', bpm: 120, melody: [{ p: 'C4', b: 1 }, { p: 'D4', b: 2 }, { p: 'E4', b: 1 }] };
                return buildChart(song).map((n) => n.time);
            });
            expect(times).toEqual([0, 500, 1500]);
        });

        test('the lowest pitch plays the harp and the highest the trumpet', async ({ page }) => {
            const lanes = await page.evaluate(() => {
                const song = {
                    name: 'test', bpm: 60,
                    melody: [{ p: 'C4', b: 1 }, { p: 'E4', b: 1 }, { p: 'G4', b: 1 }, { p: 'C5', b: 1 }],
                };
                return buildChart(song).map((n) => n.lane);
            });
            expect(lanes).toEqual([0, 1, 2, 3]);
        });

        test('the same pitch always falls in the same lane', async ({ page }) => {
            const consistent = await page.evaluate(() =>
                SONGS.every((s) => {
                    const byPitch = new Map();
                    for (const n of buildChart(s)) {
                        if (byPitch.has(n.pitch) && byPitch.get(n.pitch) !== n.lane) return false;
                        byPitch.set(n.pitch, n.lane);
                    }
                    return true;
                })
            );
            expect(consistent).toBe(true);
        });

        test('every lane is used by every hymn, so no hand sits idle', async ({ page }) => {
            const unused = await page.evaluate(() =>
                SONGS.filter((s) => new Set(buildChart(s).map((n) => n.lane)).size < 4).map((s) => s.name)
            );
            expect(unused).toEqual([]);
        });

        test('note pitches are real note names the audio can sound', async ({ page }) => {
            const bad = await page.evaluate(() =>
                SONGS.flatMap((s) => buildChart(s).filter((n) => !(pitchToMidi(n.pitch) > 0)).map((n) => n.pitch))
            );
            expect(bad).toEqual([]);
        });
    });

    // -------------------------------------------------------------------
    // Judging presses
    // -------------------------------------------------------------------
    test.describe('judging a press', () => {
        test.beforeEach(async ({ page }) => {
            await startFrozen(page);
        });

        test('the song clock starts after the lead-in count', async ({ page }) => {
            expect(await songTime(page)).toBeLessThan(0);
            await page.evaluate(() => advanceClockTo(LEAD_IN_MS));
            expect(await songTime(page)).toBe(0);
        });

        test('a press right on the note is perfect and scores 100', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            const s = await getState(page);
            expect(s.perfect).toBe(1);
            expect(s.score).toBe(100);
            expect(s.combo).toBe(1);
        });

        test('a press 80 ms out is great and scores 60', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time + 80, note.lane);
            const s = await getState(page);
            expect(s.great).toBe(1);
            expect(s.score).toBe(60);
        });

        test('a press 140 ms early is good and scores 30', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time - 140, note.lane);
            const s = await getState(page);
            expect(s.good).toBe(1);
            expect(s.score).toBe(30);
        });

        test('a press far too early judges nothing and leaves the note standing', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time - 900, note.lane);
            const s = await getState(page);
            expect(s.score).toBe(0);
            expect(s.perfect + s.great + s.good + s.miss).toBe(0);
            expect(await page.evaluate(() => chart[0].judgement)).toBe(null);
        });

        test('a press in the wrong lane leaves the note standing', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, (note.lane + 1) % 4);
            expect(await page.evaluate(() => chart[0].judgement)).toBe(null);
            expect((await getState(page)).score).toBe(0);
        });

        test('a note left unstruck is missed once it passes the window', async ({ page }) => {
            const note = await noteAt(page, 0);
            await page.evaluate((t) => advanceClockTo(LEAD_IN_MS + t), note.time + 400);
            const s = await getState(page);
            expect(s.miss).toBe(1);
            expect(await page.evaluate(() => chart[0].judgement)).toBe('miss');
        });

        test('a miss ends the combo but keeps the best combo', async ({ page }) => {
            const notes = await page.evaluate(() => chart.slice(0, 3).map((n) => ({ time: n.time, lane: n.lane })));
            await pressAt(page, notes[0].time, notes[0].lane);
            await pressAt(page, notes[1].time, notes[1].lane);
            await page.evaluate((t) => advanceClockTo(LEAD_IN_MS + t), notes[2].time + 400);
            const s = await getState(page);
            expect(s.bestCombo).toBe(2);
            expect(s.combo).toBe(0);
            expect(s.miss).toBe(1);
        });

        test('one press judges one note only', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            await pressAt(page, note.time, note.lane);
            expect((await getState(page)).perfect).toBe(1);
        });

        test('a press on an empty lane neither scores nor breaks the combo', async ({ page }) => {
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            const emptyLane = await page.evaluate((t) => {
                for (let l = 0; l < 4; l++) {
                    if (!chart.some((n) => n.lane === l && Math.abs(n.time - t) <= GOOD_MS)) return l;
                }
                return -1;
            }, note.time + 300);
            expect(emptyLane).toBeGreaterThanOrEqual(0);
            await pressAt(page, note.time + 300, emptyLane);
            const s = await getState(page);
            expect(s.score).toBe(100);
            expect(s.combo).toBe(1);
        });

        test('notes in a lane are judged in the order they fall', async ({ page }) => {
            const picked = await page.evaluate(() => {
                const lane = chart[0].lane;
                const pair = chart.filter((n) => n.lane === lane).slice(0, 2);
                advanceClockTo(LEAD_IN_MS + pair[1].time);
                pressLane(lane);
                return { first: pair[0].judgement, second: pair[1].judgement };
            });
            // The first note is long gone by then, so the press takes the second.
            expect(picked.first).toBe('miss');
            expect(picked.second).toBe('perfect');
        });

        test('a late press takes the note it was aimed at, not the one behind it', async ({ page }) => {
            const outcome = await page.evaluate(() => {
                // A pair of notes in one lane close enough that a late press for
                // the first sits nearer the second.
                const lane = 2;
                chart = [
                    { time: 1000, dur: 300, pitch: 'C4', lane, judgement: null, hitAt: 0 },
                    { time: 1260, dur: 300, pitch: 'C4', lane, judgement: null, hitAt: 0 },
                ];
                advanceClockTo(LEAD_IN_MS + 1140);
                pressLane(lane);
                return { first: chart[0].judgement, second: chart[1].judgement };
            });
            expect(outcome.first).toBe('good');
            expect(outcome.second).toBe(null);
        });
    });

    // -------------------------------------------------------------------
    // Accuracy and grading
    // -------------------------------------------------------------------
    test.describe('accuracy and grade', () => {
        test('a flawless run reads 100% and the top grade', async ({ page }) => {
            await startFrozen(page);
            await playPerfectly(page);
            const s = await getState(page);
            expect(s.miss).toBe(0);
            expect(s.phase).toBe('finished');
            expect(await page.evaluate(() => Math.round(accuracy() * 100))).toBe(100);
            await expect(page.locator('#accuracy')).toHaveText('100%');
            await expect(page.locator('#overlay-title')).toContainText('joyful noise');
        });

        test('the hymn ends on its own once the last note has passed', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50));
            expect((await getState(page)).phase).toBe('finished');
            await expect(page.locator('#overlay')).toBeVisible();
        });

        test('a run of all misses reads 0% and the gentlest grade', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50));
            const s = await getState(page);
            expect(s.score).toBe(0);
            expect(s.miss).toBe(await page.evaluate(() => chart.length));
            await expect(page.locator('#accuracy')).toHaveText('0%');
            await expect(page.locator('#overlay-title')).toContainText('another voice');
        });

        test('accuracy weighs the judgements', async ({ page }) => {
            const weighted = await page.evaluate(() => {
                setSpeed(1);
                freezeClock(0);
                startSong(0);
                // One perfect, one good, the rest missed.
                advanceClockTo(LEAD_IN_MS + chart[0].time);
                pressLane(chart[0].lane);
                advanceClockTo(LEAD_IN_MS + chart[1].time - 140);
                pressLane(chart[1].lane);
                advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50);
                return { acc: accuracy(), total: chart.length, judged: state.counts };
            });
            // Every note is judged by the end, so the whole chart is the denominator.
            expect(weighted.judged).toEqual({ perfect: 1, great: 0, good: 1, miss: weighted.total - 2 });
            expect(weighted.acc).toBeCloseTo((1 + 0.6) / weighted.total, 6);
        });

        test('mid-hymn accuracy weighs only the notes judged so far', async ({ page }) => {
            await startFrozen(page);
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            // One note of twenty-odd struck cleanly still reads as a clean run.
            await expect(page.locator('#accuracy')).toHaveText('100%');
            expect(await page.evaluate(() => accuracy())).toBe(1);
        });

        test('catching every note a little late still earns a good grade', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                for (const note of chart) {
                    advanceClockTo(LEAD_IN_MS + note.time + 80);
                    pressLane(note.lane);
                }
                advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50);
            });
            const s = await getState(page);
            expect(s.miss).toBe(0);
            expect(s.great).toBe(await page.evaluate(() => chart.length));
            await expect(page.locator('#overlay-title')).toHaveText('Well played');
        });

        test('a hymn half left unstruck falls to the gentlest grade', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => {
                chart.forEach((note, i) => {
                    if (i % 2) return;                 // strike every other note
                    advanceClockTo(LEAD_IN_MS + note.time);
                    pressLane(note.lane);
                });
                advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50);
            });
            await expect(page.locator('#overlay-title')).toHaveText('Give it another voice');
        });

        test('the HUD tracks score and combo as the hymn plays', async ({ page }) => {
            await startFrozen(page);
            const notes = await page.evaluate(() => chart.slice(0, 2).map((n) => ({ time: n.time, lane: n.lane })));
            await pressAt(page, notes[0].time, notes[0].lane);
            await pressAt(page, notes[1].time, notes[1].lane);
            await expect(page.locator('#score')).toHaveText('200');
            await expect(page.locator('#combo')).toHaveText('2');
        });
    });

    // -------------------------------------------------------------------
    // Keyboard and pads
    // -------------------------------------------------------------------
    test.describe('controls', () => {
        test('Space starts the hymn from the title screen', async ({ page }) => {
            await page.keyboard.press('Space');
            expect((await getState(page)).phase).toBe('playing');
            await expect(page.locator('#overlay')).toBeHidden();
        });

        test('the Play button starts the hymn', async ({ page }) => {
            await page.locator('#btn-play').click();
            expect((await getState(page)).phase).toBe('playing');
        });

        test('D, F, J and K play the four lanes', async ({ page }) => {
            for (let lane = 0; lane < 4; lane++) {
                await startFrozen(page);
                const note = await page.evaluate((l) => {
                    const n = chart.find((x) => x.lane === l);
                    return { time: n.time, lane: l };
                }, lane);
                await keyPressAt(page, note.time, lane);
                expect((await getState(page)).perfect).toBe(1);
            }
        });

        test('the arrow keys play the same four lanes', async ({ page }) => {
            const arrows = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'];
            for (let lane = 0; lane < 4; lane++) {
                await startFrozen(page);
                const note = await page.evaluate((l) => chart.find((x) => x.lane === l).time, lane);
                await page.evaluate((t) => advanceClockTo(LEAD_IN_MS + t), note);
                await page.keyboard.press(arrows[lane]);
                expect((await getState(page)).perfect).toBe(1);
            }
        });

        test('clicking an instrument pad plays its lane', async ({ page }) => {
            await startFrozen(page);
            const note = await noteAt(page, 0);
            await page.evaluate((t) => advanceClockTo(LEAD_IN_MS + t), note.time);
            const pos = await page.evaluate((l) => padCentre(l), note.lane);
            await page.locator('#canvas').click({ position: pos });
            expect((await getState(page)).perfect).toBe(1);
        });

        test('P pauses and resumes without the song clock running on', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => advanceClockTo(LEAD_IN_MS + 1000));
            await page.keyboard.press('p');
            expect((await getState(page)).phase).toBe('paused');
            await page.evaluate(() => advanceClock(5000));
            expect(await songTime(page)).toBe(1000);
            await page.keyboard.press('p');
            expect((await getState(page)).phase).toBe('playing');
            await page.evaluate(() => advanceClock(500));
            expect(await songTime(page)).toBe(1500);
        });

        test('a press while paused is ignored', async ({ page }) => {
            await startFrozen(page);
            const note = await noteAt(page, 0);
            await page.keyboard.press('p');
            await pressAt(page, note.time, note.lane);
            expect((await getState(page)).score).toBe(0);
        });

        test('R restarts the hymn and clears the score', async ({ page }) => {
            await startFrozen(page);
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            expect((await getState(page)).score).toBe(100);
            await page.keyboard.press('r');
            const s = await getState(page);
            expect(s.score).toBe(0);
            expect(s.combo).toBe(0);
            expect(s.phase).toBe('playing');
            expect(await page.evaluate(() => chart.every((n) => n.judgement === null))).toBe(true);
        });

        test('playing again after the end resets every count', async ({ page }) => {
            await startFrozen(page);
            await page.evaluate(() => advanceClockTo(LEAD_IN_MS + chart[chart.length - 1].time + OUTRO_MS + 50));
            await page.locator('#btn-play').click();
            const s = await getState(page);
            expect(s.phase).toBe('playing');
            expect(s.miss).toBe(0);
            expect(s.score).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Choosing a hymn and a speed
    // -------------------------------------------------------------------
    test.describe('hymns and speeds', () => {
        test('each hymn button loads its own chart', async ({ page }) => {
            for (let i = 0; i < 3; i++) {
                await page.locator('.song-btn').nth(i).click();
                const loaded = await page.evaluate(() => ({ index: songIndex, name: SONGS[songIndex].name, notes: chart.length }));
                expect(loaded.index).toBe(i);
                expect(loaded.notes).toBe(await page.evaluate((n) => buildChart(SONGS[n]).length, i));
                await expect(page.locator('.song-btn').nth(i)).toHaveClass(/active/);
                await expect(page.locator('#song-name')).toHaveText(loaded.name);
            }
        });

        test('choosing a hymn mid-run starts it afresh', async ({ page }) => {
            await startFrozen(page, 0);
            const note = await noteAt(page, 0);
            await pressAt(page, note.time, note.lane);
            await page.locator('.song-btn').nth(1).click();
            const s = await getState(page);
            expect(s.score).toBe(0);
            expect(s.phase).toBe('ready');
        });

        test('the speed buttons change how long a note takes to fall', async ({ page }) => {
            const travels = [];
            for (let i = 0; i < 3; i++) {
                await page.locator('.speed-btn').nth(i).click();
                travels.push(await page.evaluate(() => approachMs()));
                await expect(page.locator('.speed-btn').nth(i)).toHaveClass(/active/);
            }
            expect(travels[0]).toBeGreaterThan(travels[1]);
            expect(travels[1]).toBeGreaterThan(travels[2]);
        });

        test('the speed leaves the note times alone', async ({ page }) => {
            const gentle = await page.evaluate(() => { setSpeed(0); startSong(0); return chart.map((n) => n.time); });
            const lively = await page.evaluate(() => { setSpeed(2); startSong(0); return chart.map((n) => n.time); });
            expect(lively).toEqual(gentle);
        });

        test('keys 1 to 3 choose the hymn', async ({ page }) => {
            await page.keyboard.press('3');
            expect(await page.evaluate(() => songIndex)).toBe(2);
            await page.keyboard.press('1');
            expect(await page.evaluate(() => songIndex)).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Drawing
    // -------------------------------------------------------------------
    test.describe('drawing', () => {
        test('the canvas paints the lanes and the strike line', async ({ page }) => {
            const colours = await page.evaluate(() => {
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                const seen = new Set();
                for (let i = 0; i < data.length; i += 4 * 97) {
                    seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
                }
                return seen.size;
            });
            expect(colours).toBeGreaterThan(3);
        });

        test('a falling note sits above the strike line and reaches it on time', async ({ page }) => {
            await startFrozen(page);
            const note = await noteAt(page, 0);
            const early = await page.evaluate((t) => {
                advanceClockTo(LEAD_IN_MS + t - approachMs() / 2);
                return noteY(chart[0]);
            }, note.time);
            const onTime = await page.evaluate((t) => {
                advanceClockTo(LEAD_IN_MS + t);
                return noteY(chart[0]);
            }, note.time);
            expect(early).toBeLessThan(onTime);
            expect(Math.round(onTime)).toBe(await page.evaluate(() => Math.round(STRIKE_Y)));
        });

        test('the hymn stays within the canvas and plays no note off-lane', async ({ page }) => {
            const inside = await page.evaluate(() =>
                LANES.every((l, i) => {
                    const c = padCentre(i);
                    return c.x > 0 && c.x < canvas.width && c.y > 0 && c.y < canvas.height;
                })
            );
            expect(inside).toBe(true);
        });

        test('plays a long run without errors', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            await page.keyboard.press('d');
            await page.keyboard.press('f');
            await page.keyboard.press('j');
            await page.keyboard.press('k');
            await page.waitForTimeout(400);
            expect(errors).toEqual([]);
        });
    });
});
