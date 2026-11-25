const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// ---------------------------------------------------------------------------
// Helpers. The game keeps its state and logic in plain globals and advances all
// motion through `step(dt)`, so the tests can drive it deterministically
// without waiting on requestAnimationFrame.
// ---------------------------------------------------------------------------

// Start a run and clear the sky, leaving the game running with no scrolls.
async function startClean(page) {
    await page.evaluate(() => {
        startGame();
        scrolls.length = 0;
        lockIndex = -1;
        spawnTimer = 999; // no spontaneous spawns during the test
    });
}

// Put one named scroll in the sky at a known height.
async function placeScroll(page, word, y = 40) {
    return page.evaluate(
        ([word, y]) => {
            const s = spawnScroll(word);
            s.y = y;
            return { word: s.word, y: s.y, w: s.w };
        },
        [word, y]
    );
}

async function type(page, text) {
    return page.evaluate((text) => [...text].map((ch) => typeChar(ch)), text);
}

// Advance the simulation by an exact number of fixed frames, so the distance
// covered is predictable to the pixel.
async function stepFor(page, seconds, dt = 1 / 60) {
    await page.evaluate(
        ([seconds, dt]) => {
            const frames = Math.round(seconds / dt);
            for (let i = 0; i < frames; i++) step(dt);
        },
        [seconds, dt]
    );
}

async function snapshot(page) {
    return page.evaluate(() => ({
        state,
        score,
        best,
        combo,
        candles,
        chapter,
        copied,
        lockIndex,
        scrolls: scrolls.map((s) => ({ word: s.word, typed: s.typed, x: s.x, y: s.y, w: s.w })),
    }));
}

test.describe('Faithful Scribe', () => {
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
        test('page title is Faithful Scribe', async ({ page }) => {
            await expect(page).toHaveTitle('Faithful Scribe');
        });

        test('canvas is 640x420', async ({ page }) => {
            await expect(page.locator('#canvas')).toHaveAttribute('width', '640');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '420');
        });

        test('loads with no page or console errors', async ({ page }) => {
            await page.waitForTimeout(250);
            expect(errors).toEqual([]);
        });

        test('the title overlay is visible and invites the player to start', async ({ page }) => {
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-sub')).toContainText(/space|start/i);
        });

        test('the page carries the Jeremiah 36 reference', async ({ page }) => {
            await expect(page.locator('#verse')).toContainText(/Jeremiah 36/i);
        });

        test('state is idle before starting', async ({ page }) => {
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('score, combo and words copied start at zero', async ({ page }) => {
            const s = await snapshot(page);
            expect([s.score, s.combo, s.copied]).toEqual([0, 0, 0]);
        });

        test('the scribe starts with three candles on chapter one', async ({ page }) => {
            const s = await snapshot(page);
            expect(s.candles).toBe(3);
            expect(s.chapter).toBe(1);
            expect(await page.evaluate(() => START_CANDLES)).toBe(3);
        });

        test('no scrolls are in the sky before starting', async ({ page }) => {
            expect(await page.evaluate(() => scrolls.length)).toBe(0);
        });

        test('stepping while idle moves nothing', async ({ page }) => {
            await stepFor(page, 5);
            expect(await page.evaluate(() => scrolls.length)).toBe(0);
            expect(await page.evaluate(() => state)).toBe('idle');
        });

        test('typing while idle is ignored', async ({ page }) => {
            expect(await type(page, 'faith')).toEqual(['ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
        });

        test('best score is read from localStorage', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('faithful-scribe-best', '4820'));
            await page.reload();
            await expect(page.locator('#best')).toHaveText('4820');
            expect(await page.evaluate(() => best)).toBe(4820);
        });

        test('the HUD shows the opening values', async ({ page }) => {
            await expect(page.locator('#score')).toHaveText('0');
            await expect(page.locator('#chapter')).toHaveText('1');
            await expect(page.locator('#candles')).toHaveText('3');
            await expect(page.locator('#combo')).toHaveText('0');
        });
    });

    // -------------------------------------------------------------------
    // The vocabulary
    // -------------------------------------------------------------------
    test.describe('vocabulary', () => {
        test('holds a good number of words', async ({ page }) => {
            expect(await page.evaluate(() => WORDS.length)).toBeGreaterThanOrEqual(60);
        });

        test('every word is plain letters, two or more long', async ({ page }) => {
            const bad = await page.evaluate(() => WORDS.filter((w) => !/^[A-Za-z]{2,}$/.test(w)));
            expect(bad).toEqual([]);
        });

        test('has no duplicates', async ({ page }) => {
            const dupes = await page.evaluate(() => {
                const seen = new Set();
                return WORDS.filter((w) => seen.size === seen.add(w.toLowerCase()).size);
            });
            expect(dupes).toEqual([]);
        });

        test('holds short words for the first chapter', async ({ page }) => {
            const short = await page.evaluate(() => WORDS.filter((w) => w.length <= maxLen(1)).length);
            expect(short).toBeGreaterThanOrEqual(10);
        });

        test('holds long words for the later chapters', async ({ page }) => {
            const long = await page.evaluate(() => WORDS.filter((w) => w.length >= 9).length);
            expect(long).toBeGreaterThanOrEqual(8);
        });
    });

    // -------------------------------------------------------------------
    // Starting a run
    // -------------------------------------------------------------------
    test.describe('starting', () => {
        test('Space starts the day', async ({ page }) => {
            await page.keyboard.press('Space');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('Enter starts the day', async ({ page }) => {
            await page.keyboard.press('Enter');
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('the start button starts the day', async ({ page }) => {
            await page.locator('#btn-start').click();
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('a first scroll is in the sky as soon as the day begins', async ({ page }) => {
            await page.evaluate(() => startGame());
            expect(await page.evaluate(() => scrolls.length)).toBe(1);
        });

        test('starting resets the score, candles, chapter and combo', async ({ page }) => {
            await page.evaluate(() => {
                score = 900;
                combo = 7;
                candles = 1;
                chapter = 4;
                copied = 5;
                startGame();
            });
            const s = await snapshot(page);
            expect([s.score, s.combo, s.candles, s.chapter, s.copied]).toEqual([0, 0, 3, 1, 0]);
        });
    });

    // -------------------------------------------------------------------
    // Falling scrolls
    // -------------------------------------------------------------------
    test.describe('falling scrolls', () => {
        test('a scroll falls at its chapter speed', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 0);
            await stepFor(page, 2);
            const { y, speed } = await page.evaluate(() => ({ y: scrolls[0].y, speed: scrolls[0].speed }));
            expect(speed).toBeCloseTo(await page.evaluate(() => fallSpeed(1)), 5);
            expect(y).toBeCloseTo(speed * 2, 0);
        });

        test('later chapters fall faster and spawn sooner', async ({ page }) => {
            const curve = await page.evaluate(() =>
                [1, 2, 3, 4, 5, 6].map((c) => ({ fall: fallSpeed(c), gap: spawnInterval(c) }))
            );
            for (let i = 1; i < curve.length; i++) {
                expect(curve[i].fall).toBeGreaterThan(curve[i - 1].fall);
                expect(curve[i].gap).toBeLessThanOrEqual(curve[i - 1].gap);
            }
        });

        test('the gap between scrolls never falls below the floor', async ({ page }) => {
            const floor = await page.evaluate(() => SPAWN_MIN);
            const gaps = await page.evaluate(() =>
                Array.from({ length: 40 }, (_, i) => spawnInterval(i + 1))
            );
            expect(Math.min(...gaps)).toBeGreaterThanOrEqual(floor);
        });

        test('new scrolls appear as time passes', async ({ page }) => {
            await page.evaluate(() => startGame());
            await stepFor(page, 6);
            expect(await page.evaluate(() => scrolls.length)).toBeGreaterThan(1);
        });

        test('no more than MAX_SCROLLS hang in the sky', async ({ page }) => {
            await page.evaluate(() => startGame());
            await stepFor(page, 40);
            const max = await page.evaluate(() => MAX_SCROLLS);
            const count = await page.evaluate(() => scrolls.length);
            expect(count).toBeLessThanOrEqual(max);
        });

        test('every scroll stays inside the canvas', async ({ page }) => {
            await page.evaluate(() => startGame());
            await stepFor(page, 30);
            const bad = await page.evaluate(() =>
                scrolls.filter((s) => s.x < 0 || s.x + s.w > CANVAS_W)
            );
            expect(bad).toEqual([]);
        });

        test('two scrolls in the sky never start with the same letter', async ({ page }) => {
            await page.evaluate(() => startGame());
            for (let i = 0; i < 12; i++) {
                await stepFor(page, 4);
                const clash = await page.evaluate(() => {
                    const first = scrolls.map((s) => s.word[0].toLowerCase());
                    return first.filter((c, i) => first.indexOf(c) !== i);
                });
                expect(clash).toEqual([]);
            }
        });

        test('a scroll that reaches the desk is lost and costs a candle', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 0);
            await page.evaluate(() => { combo = 6; });
            await stepFor(page, 30);
            const s = await snapshot(page);
            expect(s.scrolls).toEqual([]);
            expect(s.candles).toBe(2);
            expect(s.combo).toBe(0);
        });

        test('a landed scroll scores nothing', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 0);
            await stepFor(page, 30);
            expect(await page.evaluate(() => score)).toBe(0);
        });

        test('losing the locked scroll releases the lock', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 0);
            await type(page, 'fa');
            expect(await page.evaluate(() => lockIndex)).toBe(0);
            await stepFor(page, 30);
            expect(await page.evaluate(() => lockIndex)).toBe(-1);
        });

        test('losing a scroll keeps the lock on the right one', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'mercy', 0);     // the one that will land first
            await placeScroll(page, 'faith', -200);  // locked, far from the desk
            await type(page, 'fa');
            await page.evaluate(() => { scrolls[0].y = BASELINE_Y - SCROLL_H; });
            await stepFor(page, 0.1);
            const s = await snapshot(page);
            expect(s.scrolls.map((x) => x.word)).toEqual(['faith']);
            expect(s.lockIndex).toBe(0);
            expect(s.scrolls[0].typed).toBe(2);
        });
    });

    // -------------------------------------------------------------------
    // Typing
    // -------------------------------------------------------------------
    test.describe('typing', () => {
        test('the first letter locks a matching scroll', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            expect(await type(page, 'f')).toEqual(['lock']);
            const s = await snapshot(page);
            expect(s.lockIndex).toBe(0);
            expect(s.scrolls[0].typed).toBe(1);
        });

        test('a letter matching nothing is ignored', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            expect(await type(page, 'z')).toEqual(['ignored']);
            const s = await snapshot(page);
            expect(s.lockIndex).toBe(-1);
            expect(s.scrolls[0].typed).toBe(0);
        });

        test('the lowest matching scroll is the one locked', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 30);
            await placeScroll(page, 'favour', 220);
            await type(page, 'f');
            const s = await snapshot(page);
            expect(s.scrolls[s.lockIndex].word).toBe('favour');
        });

        test('further letters copy the locked scroll', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            expect(await type(page, 'fai')).toEqual(['lock', 'hit', 'hit']);
            expect((await snapshot(page)).scrolls[0].typed).toBe(3);
        });

        test('letters are matched whatever the case', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'Jerusalem');
            expect(await type(page, 'jeR')).toEqual(['lock', 'hit', 'hit']);
            expect((await snapshot(page)).scrolls[0].typed).toBe(3);
        });

        test('a wrong letter is a blot: the combo goes, the progress stays', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await page.evaluate(() => { combo = 9; });
            expect(await type(page, 'faq')).toEqual(['lock', 'hit', 'blot']);
            const s = await snapshot(page);
            expect(s.combo).toBe(0);
            expect(s.lockIndex).toBe(0);
            expect(s.scrolls[0].typed).toBe(2);
        });

        test('a blot costs no candle and no points', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await type(page, 'fqqqq');
            const s = await snapshot(page);
            expect(s.candles).toBe(3);
            expect(s.score).toBe(0);
        });

        test('while one scroll is locked, another scroll cannot be started', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 30);
            await placeScroll(page, 'mercy', 60);
            await type(page, 'f');
            expect(await type(page, 'm')).toEqual(['blot']);
            const s = await snapshot(page);
            expect(s.scrolls[s.lockIndex].word).toBe('faith');
            expect(s.scrolls[1].typed).toBe(0);
        });

        test('Escape releases the lock so another scroll can be started', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith', 30);
            await placeScroll(page, 'mercy', 60);
            await type(page, 'fa');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => lockIndex)).toBe(-1);
            expect(await page.evaluate(() => state)).toBe('running');
            expect(await type(page, 'm')).toEqual(['lock']);
        });

        test('a released scroll keeps the letters already copied', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await type(page, 'fai');
            await page.keyboard.press('Escape');
            expect((await snapshot(page)).scrolls[0].typed).toBe(3);
            expect(await type(page, 't')).toEqual(['hit']);
        });

        test('finishing the word copies the scroll away', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            expect(await type(page, 'faith')).toEqual(['lock', 'hit', 'hit', 'hit', 'word']);
            const s = await snapshot(page);
            expect(s.scrolls).toEqual([]);
            expect(s.lockIndex).toBe(-1);
            expect(s.copied).toBe(1);
            expect(s.combo).toBe(1);
        });

        test('typing is driven straight from the keyboard', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            for (const ch of 'faith') await page.keyboard.press(ch);
            const s = await snapshot(page);
            expect(s.scrolls).toEqual([]);
            expect(s.copied).toBe(1);
        });

        test('the canvas offers a hidden field so a phone keyboard appears', async ({ page }) => {
            await startClean(page);
            await page.locator('#canvas').click({ position: { x: 300, y: 200 } });
            const focused = await page.evaluate(() => document.activeElement.id);
            expect(focused).toBe('typing-input');
        });
    });

    // -------------------------------------------------------------------
    // Scoring
    // -------------------------------------------------------------------
    test.describe('scoring', () => {
        test('the multiplier climbs every five words and stops at five', async ({ page }) => {
            const table = await page.evaluate(() =>
                [0, 1, 4, 5, 9, 10, 14, 15, 19, 20, 25, 99].map((c) => [c, multiplier(c)])
            );
            expect(table).toEqual([
                [0, 1], [1, 1], [4, 1],
                [5, 2], [9, 2],
                [10, 3], [14, 3],
                [15, 4], [19, 4],
                [20, 5], [25, 5], [99, 5],
            ]);
        });

        test('a word is worth ten a letter, times the multiplier', async ({ page }) => {
            const got = await page.evaluate(() => [
                wordScore('faith', 0),
                wordScore('faith', 5),
                wordScore('Jerusalem', 0),
                wordScore('Jerusalem', 20),
            ]);
            expect(got).toEqual([50, 100, 90, 450]);
        });

        test('copying a word adds its score', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'mercy');
            await type(page, 'mercy');
            expect(await page.evaluate(() => score)).toBe(50);
        });

        test('a streak pays more for the same word', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { combo = 10; });
            await placeScroll(page, 'mercy');
            await type(page, 'mercy');
            expect(await page.evaluate(() => score)).toBe(150);
        });

        test('the combo rises with every word copied', async ({ page }) => {
            await startClean(page);
            for (const word of ['faith', 'hope', 'mercy']) {
                await placeScroll(page, word);
                await type(page, word);
            }
            expect(await page.evaluate(() => combo)).toBe(3);
        });

        test('the HUD follows the score, combo and words copied', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await type(page, 'faith');
            await expect(page.locator('#score')).toHaveText('50');
            await expect(page.locator('#combo')).toHaveText('1');
        });
    });

    // -------------------------------------------------------------------
    // Chapters
    // -------------------------------------------------------------------
    test.describe('chapters', () => {
        test('eight words finish a chapter', async ({ page }) => {
            expect(await page.evaluate(() => WORDS_PER_CHAPTER)).toBe(8);
            await startClean(page);
            for (let i = 0; i < 8; i++) {
                await placeScroll(page, 'faith');
                await type(page, 'faith');
            }
            const s = await snapshot(page);
            expect(s.chapter).toBe(2);
            expect(s.copied).toBe(0);
        });

        test('a finished chapter lights a candle again', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { candles = 2; });
            for (let i = 0; i < 8; i++) {
                await placeScroll(page, 'faith');
                await type(page, 'faith');
            }
            expect(await page.evaluate(() => candles)).toBe(3);
        });

        test('candles are capped', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => { candles = MAX_CANDLES; });
            for (let i = 0; i < 8; i++) {
                await placeScroll(page, 'faith');
                await type(page, 'faith');
            }
            const max = await page.evaluate(() => MAX_CANDLES);
            expect(await page.evaluate(() => candles)).toBe(max);
        });

        test('the words grow longer as the chapters pass', async ({ page }) => {
            const lens = await page.evaluate(() => [1, 2, 3, 4, 5].map((c) => maxLen(c)));
            for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThanOrEqual(lens[i - 1]);
            expect(lens[0]).toBeLessThan(lens[4]);
        });

        test('a chapter never spawns a word longer than its limit', async ({ page }) => {
            const bad = await page.evaluate(() => {
                const out = [];
                for (const c of [1, 2, 3]) {
                    chapter = c;
                    for (let i = 0; i < 200; i++) {
                        const w = pickWord();
                        if (w.length > maxLen(c)) out.push([c, w]);
                    }
                }
                return out;
            });
            expect(bad).toEqual([]);
        });

        test('a chapter turn announces itself and then fades', async ({ page }) => {
            await startClean(page);
            for (let i = 0; i < 8; i++) {
                await placeScroll(page, 'faith');
                await type(page, 'faith');
            }
            expect(await page.evaluate(() => banner && banner.text)).toBe('Chapter 2');
            await page.evaluate(() => { for (let i = 0; i < 180; i++) updateParticles(1 / 60); });
            expect(await page.evaluate(() => banner)).toBeNull();
        });

        test('the chapter shows in the HUD', async ({ page }) => {
            await startClean(page);
            for (let i = 0; i < 8; i++) {
                await placeScroll(page, 'faith');
                await type(page, 'faith');
            }
            await expect(page.locator('#chapter')).toHaveText('2');
        });
    });

    // -------------------------------------------------------------------
    // The end of the day
    // -------------------------------------------------------------------
    test.describe('the end of the day', () => {
        async function burnOut(page) {
            await startClean(page);
            await page.evaluate(() => { candles = 1; });
            await placeScroll(page, 'faith', 0);
            await stepFor(page, 30);
        }

        test('the last candle ends the day', async ({ page }) => {
            await burnOut(page);
            expect(await page.evaluate(() => state)).toBe('over');
            expect(await page.evaluate(() => candles)).toBe(0);
        });

        test('the overlay reports the day and offers another', async ({ page }) => {
            await burnOut(page);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-score')).toContainText(/\d/);
            await expect(page.locator('#btn-start')).toBeVisible();
        });

        test('typing and falling stop once the day is over', async ({ page }) => {
            await burnOut(page);
            await placeScroll(page, 'faith', 10);
            expect(await type(page, 'f')).toEqual(['ignored']);
            await stepFor(page, 2);
            expect(await page.evaluate(() => scrolls[0].y)).toBe(10);
        });

        test('the best score is kept', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'righteousness');
            await type(page, 'righteousness');
            await page.evaluate(() => { candles = 1; });
            await placeScroll(page, 'faith', 0);
            await stepFor(page, 30);
            const score = await page.evaluate(() => score);
            expect(score).toBe(130);
            expect(await page.evaluate(() => best)).toBe(130);
            expect(await page.evaluate(() => window.localStorage.getItem('faithful-scribe-best'))).toBe('130');
            await expect(page.locator('#best')).toHaveText('130');
        });

        test('a lower score does not overwrite the best', async ({ page }) => {
            await page.evaluate(() => window.localStorage.setItem('faithful-scribe-best', '9000'));
            await page.reload();
            await startClean(page);
            await page.evaluate(() => { candles = 1; });
            await placeScroll(page, 'faith', 0);
            await stepFor(page, 30);
            expect(await page.evaluate(() => best)).toBe(9000);
        });

        test('Space starts a fresh day', async ({ page }) => {
            await burnOut(page);
            await page.keyboard.press('Space');
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.candles).toBe(3);
            expect(s.score).toBe(0);
        });
    });

    // -------------------------------------------------------------------
    // Pausing
    // -------------------------------------------------------------------
    test.describe('pausing', () => {
        test('Escape with nothing locked pauses the game', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('paused');
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/paus/i);
        });

        test('Escape again resumes', async ({ page }) => {
            await startClean(page);
            await page.keyboard.press('Escape');
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => state)).toBe('running');
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('nothing falls while paused', async ({ page }) => {
            await page.keyboard.press('Space');
            await placeScroll(page, 'faith', 20);
            await page.keyboard.press('Escape');
            const before = await page.evaluate(() => scrolls.map((s) => s.y));
            await page.waitForTimeout(350);
            expect(await page.evaluate(() => scrolls.map((s) => s.y))).toEqual(before);
        });

        test('scrolls do fall while running', async ({ page }) => {
            await page.keyboard.press('Space');
            await placeScroll(page, 'faith', 20);
            const before = await page.evaluate(() => scrolls.map((s) => s.y));
            await page.waitForTimeout(400);
            const after = await page.evaluate(() => scrolls.map((s) => s.y));
            expect(after.length).toBeGreaterThan(0);
            after.forEach((y, i) => expect(y).toBeGreaterThan(before[i]));
        });

        test('typing is ignored while paused', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await page.keyboard.press('Escape');
            expect(await type(page, 'f')).toEqual(['ignored']);
        });

        test('the start button resumes a paused game', async ({ page }) => {
            await startClean(page);
            await placeScroll(page, 'faith');
            await page.keyboard.press('Escape');
            await page.locator('#btn-start').click();
            const s = await snapshot(page);
            expect(s.state).toBe('running');
            expect(s.scrolls.length).toBe(1); // resumed, not restarted
        });
    });

    // -------------------------------------------------------------------
    // Robustness
    // -------------------------------------------------------------------
    test.describe('robustness', () => {
        test('a long run keeps the game consistent', async ({ page }) => {
            await page.evaluate(() => startGame());
            await stepFor(page, 120);
            const s = await snapshot(page);
            expect(s.candles).toBeGreaterThanOrEqual(0);
            expect(s.score).toBeGreaterThanOrEqual(0);
            expect(['running', 'over']).toContain(s.state);
            const max = await page.evaluate(() => MAX_SCROLLS);
            expect(s.scrolls.length).toBeLessThanOrEqual(max);
            expect(errors).toEqual([]);
        });

        test('the real-time loop runs without error', async ({ page }) => {
            await page.keyboard.press('Space');
            await page.waitForTimeout(800);
            expect(errors).toEqual([]);
            expect(await page.evaluate(() => state)).toBe('running');
        });

        test('drawing a loaded sky raises nothing', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                for (const w of WORDS.slice(0, 7)) spawnScroll(w);
                scrolls.forEach((s, i) => { s.y = i * 40; s.typed = i % 3; });
                lockIndex = 2;
                draw();
            });
            expect(errors).toEqual([]);
        });

        test('the desk line sits inside the canvas', async ({ page }) => {
            const ok = await page.evaluate(() => BASELINE_Y > 0 && BASELINE_Y < CANVAS_H);
            expect(ok).toBe(true);
        });

        test('the warning band sits above the desk', async ({ page }) => {
            const ok = await page.evaluate(() => DANGER_BAND > 0 && DANGER_BAND < BASELINE_Y);
            expect(ok).toBe(true);
        });

        test('a scroll in the warning band can still be copied', async ({ page }) => {
            await startClean(page);
            await page.evaluate(() => {
                const s = spawnScroll('mercy');
                s.y = BASELINE_Y - SCROLL_H - 4; // deep in the warning band
            });
            expect(await type(page, 'mercy')).toEqual(['lock', 'hit', 'hit', 'hit', 'word']);
            expect(await page.evaluate(() => candles)).toBe(3);
        });

        test('a seeded run repeats exactly', async ({ page }) => {
            const run = async () => {
                await page.evaluate(() => { setSeed(1234); startGame(); });
                await stepFor(page, 20);
                return page.evaluate(() => scrolls.map((s) => `${s.word}@${Math.round(s.x)}`));
            };
            const first = await run();
            const second = await run();
            expect(second).toEqual(first);
            expect(first.length).toBeGreaterThan(0);
        });
    });
});
