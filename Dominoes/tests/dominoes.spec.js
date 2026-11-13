const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_URL = pathToFileURL(path.resolve(__dirname, '../index.html')).href;

// A deterministic position. `layout` entries are [leftFace, rightFace].
async function setup(page, position) {
    await page.evaluate((p) => setupHand(p), position);
}

async function state(page) {
    return page.evaluate(() => ({
        you: hands[0].map((t) => t.join('-')),
        cpu: hands[1].map((t) => t.join('-')),
        boneyard: boneyard.length,
        layout: layout.map((e) => [e.a, e.b]),
        ends: openEnds(layout),
        turn,
        scores: scores.slice(),
        phase,
        selected,
        message,
    }));
}

// Click the visible part of the i-th bone in your hand.
async function clickHandTile(page, i) {
    const pos = await page.evaluate((i) => {
        const r = handGeometry(hands[0])[i];
        return { x: r.clickX, y: r.clickY };
    }, i);
    await page.locator('#canvas').click({ position: pos });
}

async function clickEndPad(page, end) {
    const pos = await page.evaluate((end) => {
        const pad = trainGeometry(layout)[end === 'left' ? 'leftPad' : 'rightPad'];
        return { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 };
    }, end);
    await page.locator('#canvas').click({ position: pos });
}

test.describe('Dominoes', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(GAME_URL);
        await page.evaluate(() => {
            aiDelay = 0;
        });
    });

    // -----------------------------------------------------------------------
    // Pure rules
    // -----------------------------------------------------------------------
    test.describe('the bones', () => {
        test('a double-six set holds 28 distinct bones worth 168 pips', async ({ page }) => {
            const set = await page.evaluate(() => fullSet());
            expect(set).toHaveLength(28);
            expect(new Set(set.map((t) => t.join('-'))).size).toBe(28);
            expect(set.every(([a, b]) => a <= b && a >= 0 && b <= 6)).toBe(true);
            expect(set.reduce((s, t) => s + t[0] + t[1], 0)).toBe(168);
        });

        test('pips sums a bone and isDouble spots a double', async ({ page }) => {
            const r = await page.evaluate(() => ({
                p: [pips([0, 0]), pips([3, 4]), pips([6, 6])],
                d: [isDouble([0, 0]), isDouble([6, 6]), isDouble([2, 5])],
            }));
            expect(r.p).toEqual([0, 7, 12]);
            expect(r.d).toEqual([true, true, false]);
        });

        test('handPips adds up what is left in a hand', async ({ page }) => {
            expect(await page.evaluate(() => handPips([[1, 2], [6, 6], [0, 4]]))).toBe(19);
            expect(await page.evaluate(() => handPips([]))).toBe(0);
        });
    });

    test.describe('the train', () => {
        test('an empty train has no open ends and accepts any bone', async ({ page }) => {
            const r = await page.evaluate(() => ({
                ends: openEnds([]),
                can: canPlayTile([3, 5], []),
            }));
            expect(r.ends).toBeNull();
            expect(r.can).toEqual({ left: true, right: true });
        });

        test('the open ends are the outer faces of the end bones', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0 });
            expect((await state(page)).ends).toEqual({ left: 5, right: 6 });
        });

        test('a bone can only go on an end that matches one of its numbers', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0 });
            const r = await page.evaluate(() => ({
                leftOnly: canPlayTile([1, 5], layout),
                rightOnly: canPlayTile([6, 3], layout),
                both: canPlayTile([5, 6], layout),
                neither: canPlayTile([0, 4], layout),
            }));
            expect(r.leftOnly).toEqual({ left: true, right: false });
            expect(r.rightOnly).toEqual({ left: false, right: true });
            expect(r.both).toEqual({ left: true, right: true });
            expect(r.neither).toEqual({ left: false, right: false });
        });

        test('playableTiles lists the bones in a hand that can be played', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0 });
            const idx = await page.evaluate(() =>
                playableTiles([[0, 1], [1, 5], [3, 3], [6, 6]], layout));
            expect(idx).toEqual([1, 3]);
        });
    });

    test.describe('opening a hand', () => {
        test('the highest double leads', async ({ page }) => {
            const move = await page.evaluate(() =>
                openingMove([[[1, 2], [4, 4], [0, 6]], [[3, 3], [5, 6], [2, 2]]]));
            expect(move).toEqual({ player: 0, index: 1 });
        });

        test('without a double, the heaviest bone leads', async ({ page }) => {
            const move = await page.evaluate(() =>
                openingMove([[[1, 2], [0, 3]], [[4, 6], [2, 5]]]));
            expect(move).toEqual({ player: 1, index: 0 });
        });
    });

    test.describe("the computer's choice", () => {
        test('it plays the heaviest bone it can', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[5, 2], [2, 6]], turn: 1 });
            const move = await page.evaluate(() => bestMove([[0, 5], [6, 4], [1, 1]], layout));
            expect(move).toEqual({ index: 1, end: 'right' });
        });

        test('it prefers a double when two bones weigh the same', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[3, 3]], turn: 1 });
            const move = await page.evaluate(() => bestMove([[3, 6], [3, 4], [1, 1]], layout));
            expect(move.index).toBe(0);
        });

        test('it has no move when nothing matches', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[5, 5]], turn: 1 });
            expect(await page.evaluate(() => bestMove([[0, 1], [2, 3]], layout))).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // Opening state
    // -----------------------------------------------------------------------
    test.describe('a new game', () => {
        test('the page is titled Dominoes and the canvas is 880x330', async ({ page }) => {
            await expect(page).toHaveTitle('Dominoes');
            await expect(page.locator('#canvas')).toHaveAttribute('width', '880');
            await expect(page.locator('#canvas')).toHaveAttribute('height', '330');
        });

        test('deals seven bones each from one complete set', async ({ page }) => {
            const s = await page.evaluate(() => {
                aiEnabled = false;
                newGame(1234);
                const all = [...hands[0], ...hands[1], ...boneyard, ...layout.map((e) => e.tile)];
                return {
                    hands: [hands[0].length, hands[1].length],
                    boneyard: boneyard.length,
                    unique: new Set(all.map((t) => t.join('-'))).size,
                    total: all.length,
                };
            });
            // One bone has already been led, so one hand holds six.
            expect(s.hands.slice().sort()).toEqual([6, 7]);
            expect(s.boneyard).toBe(14);
            expect(s.total).toBe(28);
            expect(s.unique).toBe(28);
        });

        test('opens with the forced bone and hands the turn to the other player', async ({ page }) => {
            const s = await page.evaluate(() => {
                aiEnabled = false;
                newGame(99);
                // The best opener of the fourteen dealt bones is forced.
                const dealt = [...hands[0], ...hands[1], layout[0].tile];
                const doubles = dealt.filter(isDouble);
                const forced = doubles.length
                    ? doubles.sort((x, y) => pips(y) - pips(x))[0]
                    : dealt.slice().sort((x, y) => pips(y) - pips(x))[0];
                return {
                    layout: layout.length,
                    led: layout[0].tile,
                    leader: hands[0].length === 6 ? 0 : 1,
                    turn,
                    phase,
                    forced,
                };
            });
            expect(s.layout).toBe(1);
            expect(s.turn).toBe(1 - s.leader);
            expect(s.phase).toBe('playing');
            expect(s.led).toEqual(s.forced);
        });

        test('starts the match at nil-nil and shows it', async ({ page }) => {
            await page.evaluate(() => newGame(7));
            expect(await page.evaluate(() => scores)).toEqual([0, 0]);
            await expect(page.locator('#score-you')).toHaveText('0');
            await expect(page.locator('#score-cpu')).toHaveText('0');
            await expect(page.locator('#boneyard-count')).toHaveText('14');
        });

        test('the same seed always deals the same bones', async ({ page }) => {
            const deal = () => page.evaluate(() => {
                aiEnabled = false;
                newGame(42);
                return hands.map((h) => h.map((t) => t.join('-')).join(','));
            });
            const a = await deal();
            const b = await deal();
            const other = await page.evaluate(() => {
                aiEnabled = false;
                newGame(43);
                return hands.map((h) => h.map((t) => t.join('-')).join(','));
            });
            expect(a).toEqual(b);
            expect(a).not.toEqual(other);
        });

        test('the overlay is hidden while a hand is in play', async ({ page }) => {
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });
    });

    // -----------------------------------------------------------------------
    // Playing bones
    // -----------------------------------------------------------------------
    test.describe('playing a bone', () => {
        test('clicking a bone that fits one end plays it there', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[0, 0]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => layout.length)).toBeGreaterThan(2);
            const s = await state(page);
            expect(s.layout[0]).toEqual([1, 5]);
            expect(s.ends.left).toBe(1);
            expect(s.you).toEqual([]);
        });

        test('a bone laid on the right end keeps the train joined', async ({ page }) => {
            await setup(page, {
                you: [[6, 3]], computer: [[0, 0]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => layout.length)).toBeGreaterThan(2);
            const s = await state(page);
            expect(s.layout[2]).toEqual([6, 3]);
            expect(s.ends.right).toBe(3);
            const joined = await page.evaluate(() =>
                layout.every((e, i) => i === 0 || layout[i - 1].b === e.a));
            expect(joined).toBe(true);
        });

        test('a bone that fits both ends waits for you to choose an end', async ({ page }) => {
            await setup(page, {
                you: [[5, 6], [0, 0]], computer: [[1, 1]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            expect(await page.evaluate(() => selected)).toBe(0);
            expect(await page.evaluate(() => layout.length)).toBe(2);
            await clickEndPad(page, 'left');
            await expect.poll(() => page.evaluate(() => layout.length)).toBeGreaterThan(2);
            expect((await state(page)).layout[0]).toEqual([6, 5]);
        });

        test('an unplayable bone is refused and says why', async ({ page }) => {
            await setup(page, {
                you: [[0, 4]], computer: [[1, 1]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            const ok = await page.evaluate(() => humanPlay(0, 'right'));
            expect(ok).toBe(false);
            expect(await page.evaluate(() => layout.length)).toBe(2);
            await expect(page.locator('#message')).toContainText(/fit|match/i);
        });

        test('you cannot play while it is the computer\'s turn', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[1, 1]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 1,
            });
            expect(await page.evaluate(() => humanPlay(0, 'left'))).toBe(false);
            expect(await page.evaluate(() => layout.length)).toBe(2);
        });

        test('the computer answers your move', async ({ page }) => {
            await setup(page, {
                you: [[1, 5], [0, 0]], computer: [[6, 4]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => layout.length)).toBe(4);
            const s = await state(page);
            expect(s.layout[3]).toEqual([6, 4]);
            expect(s.cpu).toEqual([]);
        });

        test('arrow keys move the selection and R plays on the right', async ({ page }) => {
            await setup(page, {
                you: [[0, 0], [6, 3]], computer: [[1, 1]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await page.keyboard.press('ArrowRight');
            expect(await page.evaluate(() => selected)).toBe(1);
            await page.keyboard.press('r');
            await expect.poll(() => page.evaluate(() => layout.length)).toBeGreaterThan(2);
            expect((await state(page)).layout[2]).toEqual([6, 3]);
        });
    });

    // -----------------------------------------------------------------------
    // Drawing and passing
    // -----------------------------------------------------------------------
    test.describe('the boneyard', () => {
        test('you may not draw while you hold a playable bone', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[1, 1]], boneyard: [[0, 0], [3, 4]], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await expect(page.locator('#btn-draw')).toBeDisabled();
            expect(await page.evaluate(() => humanDraw())).toBe(false);
            expect(await page.evaluate(() => hands[0].length)).toBe(1);
        });

        test('with nothing playable you draw, and the turn stays yours', async ({ page }) => {
            await setup(page, {
                you: [[0, 4]], computer: [[1, 1]], boneyard: [[0, 0], [3, 4]], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await expect(page.locator('#btn-draw')).toBeEnabled();
            await page.locator('#btn-draw').click();
            const s = await state(page);
            expect(s.you).toHaveLength(2);
            expect(s.boneyard).toBe(1);
            expect(s.turn).toBe(0);
            await expect(page.locator('#boneyard-count')).toHaveText('1');
        });

        test('you may not pass while the boneyard still has bones', async ({ page }) => {
            await setup(page, {
                you: [[0, 4]], computer: [[1, 1]], boneyard: [[0, 0]], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await expect(page.locator('#btn-pass')).toBeDisabled();
            expect(await page.evaluate(() => humanPass())).toBe(false);
            expect(await page.evaluate(() => turn)).toBe(0);
        });

        test('with the boneyard empty and nothing playable you pass', async ({ page }) => {
            await setup(page, {
                you: [[0, 4]], computer: [[6, 6], [1, 1]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await expect(page.locator('#btn-pass')).toBeEnabled();
            await page.locator('#btn-pass').click();
            await expect.poll(() => page.evaluate(() => layout.length)).toBe(3);
            expect((await state(page)).layout[2]).toEqual([6, 6]);
        });

        test('the computer draws when it is stuck, then passes', async ({ page }) => {
            await setup(page, {
                you: [[1, 5], [0, 0]], computer: [[0, 3]], boneyard: [[0, 2], [3, 3]], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);   // 1-5 on the left: the ends become 1 and 6
            await expect.poll(() => page.evaluate(() => turn)).toBe(0);
            const s = await state(page);
            expect(s.boneyard).toBe(0);     // it emptied the boneyard looking for a match
            expect(s.cpu).toHaveLength(3);
            expect(s.message).toMatch(/passes/i);
            expect(s.phase).toBe('playing');
        });
    });

    // -----------------------------------------------------------------------
    // Ending a hand
    // -----------------------------------------------------------------------
    test.describe('ending a hand', () => {
        test('playing your last bone wins the hand and scores their pips', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[6, 6], [0, 3]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => phase)).toBe('hand-over');
            expect(await page.evaluate(() => scores)).toEqual([15, 0]);
            await expect(page.locator('#overlay')).toHaveClass(/visible/);
            await expect(page.locator('#overlay-title')).toContainText(/domino|you win/i);
            await expect(page.locator('#score-you')).toHaveText('15');
        });

        test('the computer can win the hand too', async ({ page }) => {
            await setup(page, {
                you: [[1, 5], [0, 4]], computer: [[6, 3]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => phase)).toBe('hand-over');
            expect(await page.evaluate(() => scores)).toEqual([0, 4]);
        });

        test('a blocked train is won by the lighter hand', async ({ page }) => {
            await setup(page, {
                you: [[0, 4]], computer: [[6, 6]], boneyard: [], layout: [[5, 2], [2, 3]], turn: 0,
            });
            await page.locator('#btn-pass').click();
            await expect.poll(() => page.evaluate(() => phase)).toBe('hand-over');
            expect(await page.evaluate(() => scores)).toEqual([12, 0]);
            await expect(page.locator('#overlay-sub')).toContainText(/block/i);
        });

        test('a blocked train with level hands scores nothing', async ({ page }) => {
            await setup(page, {
                you: [[1, 3]], computer: [[0, 4]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await page.locator('#btn-pass').click();
            await expect.poll(() => page.evaluate(() => phase)).toBe('hand-over');
            expect(await page.evaluate(() => scores)).toEqual([0, 0]);
            await expect(page.locator('#overlay-sub')).toContainText(/level|tie|nobody/i);
        });

        test('the next hand keeps the scores and deals again', async ({ page }) => {
            await page.evaluate(() => { aiEnabled = false; });
            await setup(page, {
                you: [[1, 5]], computer: [[6, 6], [0, 3]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => phase)).toBe('hand-over');
            await page.locator('#btn-continue').click();
            const s = await state(page);
            expect(s.phase).toBe('playing');
            expect(s.scores).toEqual([15, 0]);
            expect(s.boneyard).toBe(14);
            expect(s.layout).toHaveLength(1);
            expect(s.you.length + s.cpu.length).toBe(13);
            await expect(page.locator('#overlay')).not.toHaveClass(/visible/);
        });

        test('reaching a hundred points wins the match', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[6, 6], [6, 5]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
                scores: [90, 0],
            });
            await clickHandTile(page, 0);
            await expect.poll(() => page.evaluate(() => phase)).toBe('game-over');
            expect(await page.evaluate(() => scores[0])).toBeGreaterThanOrEqual(100);
            await expect(page.locator('#overlay-title')).toContainText(/match/i);
            await expect(page.locator('#btn-continue')).toContainText(/new game/i);
        });

        test('New Game resets the match', async ({ page }) => {
            await setup(page, {
                you: [[1, 5]], computer: [[6, 6]], boneyard: [], layout: [[5, 2], [2, 6]], turn: 0,
                scores: [40, 20],
            });
            await page.locator('#btn-new').click();
            const s = await state(page);
            expect(s.scores).toEqual([0, 0]);
            expect(s.phase).toBe('playing');
            expect(s.boneyard).toBe(14);
        });
    });

    // -----------------------------------------------------------------------
    // Geometry and drawing
    // -----------------------------------------------------------------------
    test.describe('layout on the canvas', () => {
        test('a long train wraps into rows and stays on the canvas', async ({ page }) => {
            await page.evaluate(() => {
                const chain = [];
                let v = 0;
                for (let i = 0; i < 20; i++) {
                    chain.push([v, (v + 1) % 7]);
                    v = (v + 1) % 7;
                }
                setupHand({ you: [], computer: [], boneyard: [], layout: chain, turn: 0 });
            });
            const g = await page.evaluate(() => {
                const geo = trainGeometry(layout);
                return {
                    n: geo.tiles.length,
                    rows: new Set(geo.tiles.map((t) => t.y)).size,
                    inside: geo.tiles.every((t) =>
                        t.x >= 0 && t.y >= 0 && t.x + t.w <= canvas.width && t.y + t.h <= canvas.height),
                    padsInside: [geo.leftPad, geo.rightPad].every((p) =>
                        p.x >= 0 && p.y >= 0 && p.x + p.w <= canvas.width && p.y + p.h <= canvas.height),
                };
            });
            expect(g.n).toBe(20);
            expect(g.rows).toBeGreaterThan(1);
            expect(g.inside).toBe(true);
            expect(g.padsInside).toBe(true);
        });

        test('bones on the train do not overlap each other', async ({ page }) => {
            await page.evaluate(() => newGame(5));
            await setup(page, {
                you: [], computer: [], boneyard: [],
                layout: [[1, 1], [1, 4], [4, 4], [4, 0], [0, 6], [6, 6]], turn: 0,
            });
            const overlaps = await page.evaluate(() => {
                const t = trainGeometry(layout).tiles;
                const hit = [];
                for (let i = 0; i < t.length; i++)
                    for (let j = i + 1; j < t.length; j++) {
                        const a = t[i], b = t[j];
                        if (a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 &&
                            a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01) hit.push([i, j]);
                    }
                return hit;
            });
            expect(overlaps).toEqual([]);
        });

        test('a short train is centred on the cloth', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[2, 4], [4, 5]], turn: 0 });
            const g = await page.evaluate(() => {
                const t = trainGeometry(layout).tiles;
                const left = t[0].x;
                const right = t[t.length - 1].x + t[t.length - 1].w;
                return { left, right, mid: (left + right) / 2, cy: t[0].y + t[0].h / 2 };
            });
            expect(Math.abs(g.mid - 440)).toBeLessThan(2);
            expect(Math.abs(g.cy - (42 + (3 * 66) / 2))).toBeLessThan(2);
        });

        test('doubles are laid across the train', async ({ page }) => {
            await setup(page, { you: [], computer: [], boneyard: [], layout: [[3, 3], [3, 5]], turn: 0 });
            const shape = await page.evaluate(() => trainGeometry(layout).tiles.map((t) => t.w > t.h));
            expect(shape).toEqual([false, true]);
        });

        test('your hand is laid out left to right inside the canvas', async ({ page }) => {
            await page.evaluate(() => newGame(3));
            const g = await page.evaluate(() => {
                const geo = handGeometry(hands[0]);
                return {
                    n: geo.length,
                    sorted: geo.every((r, i) => i === 0 || r.x > geo[i - 1].x),
                    inside: geo.every((r) =>
                        r.x >= 0 && r.x + r.w <= canvas.width && r.y + r.h <= canvas.height),
                    clickable: geo.every((r) =>
                        r.clickX >= r.x && r.clickX <= r.x + r.w && r.clickY >= r.y && r.clickY <= r.y + r.h),
                };
            });
            expect(g.n).toBe(await page.evaluate(() => hands[0].length));
            expect(g.sorted).toBe(true);
            expect(g.inside).toBe(true);
            expect(g.clickable).toBe(true);
        });

        test('a crowded hand still fits on the canvas', async ({ page }) => {
            await page.evaluate(() => setupHand({
                you: fullSet().slice(0, 21), computer: [], boneyard: [], layout: [[0, 0]], turn: 0,
            }));
            const inside = await page.evaluate(() =>
                handGeometry(hands[0]).every((r) => r.x >= 0 && r.x + r.w <= canvas.width));
            expect(inside).toBe(true);
        });

        test('the board is actually drawn, not blank', async ({ page }) => {
            await setup(page, { you: [[1, 2]], computer: [[0, 0]], boneyard: [], layout: [[5, 5]], turn: 0 });
            const painted = await page.evaluate(() => {
                const mean = (x, y, w, h) => {
                    const d = canvas.getContext('2d').getImageData(x, y, w, h).data;
                    const sum = [0, 0, 0];
                    for (let i = 0; i < d.length; i += 4) {
                        sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2];
                    }
                    return sum.map((v) => (v * 4) / d.length);
                };
                const t = trainGeometry(layout).tiles[0];
                return {
                    face: mean(Math.round(t.x) + 2, Math.round(t.y) + 2, Math.round(t.w) - 4, Math.round(t.h) - 4),
                    felt: mean(2, 2, 20, 20),
                };
            });
            // The bone face is light, the cloth behind it is not.
            expect(painted.face.reduce((a, b) => a + b, 0)).toBeGreaterThan(450);
            expect(painted.felt.reduce((a, b) => a + b, 0)).toBeLessThan(450);
        });
    });
});
