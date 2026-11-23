// Helpers for the phone tests (*.touch.spec.js). They run in the "iphone"
// Playwright project, which emulates an iPhone 13 with a touch screen.
// Nothing here presses a keyboard key: everything is done by touch.
const path = require('path');
const { pathToFileURL } = require('url');
const { expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '../..');

function gameUrl(dir) {
    return pathToFileURL(path.join(ROOT, dir, 'index.html')).href;
}

/** Opens a game on the emulated phone and waits for the touch layer to settle. */
async function openGame(page, dir) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(gameUrl(dir));
    await page.waitForFunction(() => window.TouchControls && window.TouchControls.enabled, null, { timeout: 3000 });
    await page.waitForTimeout(350);
    page.__gameErrors = errors;
    return errors;
}

/** The whole game (and the touch bar) is visible without scrolling sideways. */
async function expectFitsScreen(page) {
    const m = await page.evaluate(() => {
        const vv = window.visualViewport;
        const canvases = [...document.querySelectorAll('canvas')]
            .filter((c) => c.offsetWidth > 0)
            .map((c) => c.getBoundingClientRect())
            .map((r) => ({ left: r.left, right: r.right, width: r.width }));
        return {
            scrollWidth: document.documentElement.scrollWidth,
            layoutWidth: window.innerWidth,
            visualWidth: vv.width,
            canvases,
        };
    });
    expect(m.scrollWidth, 'page is no wider than the screen').toBeLessThanOrEqual(m.layoutWidth + 1);
    expect(m.visualWidth, 'page is zoomed out to its full width').toBeGreaterThanOrEqual(m.layoutWidth - 3);
    for (const c of m.canvases) {
        expect(c.left).toBeGreaterThanOrEqual(-1);
        expect(c.right).toBeLessThanOrEqual(m.layoutWidth + 1);
    }
}

/** The on-screen button that sends `key`. */
function control(page, key) {
    return page.locator(`#tc-bar .tc-btn[data-key="${key}"]`);
}

async function cdp(page) {
    if (!page.__cdp) page.__cdp = await page.context().newCDPSession(page);
    return page.__cdp;
}

async function centre(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('element is not visible');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Puts a finger down on an element (and keeps it there). */
async function touchDown(page, locator, id = 1) {
    const p = await centre(locator);
    const s = await cdp(page);
    page.__touches = page.__touches || new Map();
    page.__touches.set(id, p);
    await s.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [...page.__touches.entries()].map(([i, q]) => ({ x: q.x, y: q.y, id: i })),
    });
}

/** Lifts a finger put down by touchDown. */
async function touchUp(page, id = 1) {
    const s = await cdp(page);
    page.__touches.delete(id);
    await s.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [...page.__touches.entries()].map(([i, q]) => ({ x: q.x, y: q.y, id: i })),
    });
}

/** Holds an element for `ms` milliseconds. */
async function hold(page, locator, ms = 400) {
    await touchDown(page, locator);
    await page.waitForTimeout(ms);
    await touchUp(page);
}

/** Taps the on-screen button for `key`. */
async function tapControl(page, key, times = 1) {
    for (let i = 0; i < times; i++) {
        await hold(page, control(page, key), 60);
        await page.waitForTimeout(40);
    }
}

/** Drags a finger across an element. Offsets are fractions of its size, from its top-left. */
async function drag(page, locator, from, to, steps = 8) {
    const box = await locator.boundingBox();
    const pt = (f) => ({ x: box.x + box.width * f[0], y: box.y + box.height * f[1] });
    const a = pt(from);
    const b = pt(to);
    const s = await cdp(page);
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 9 }] });
    for (let i = 1; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 9 }] });
        await page.waitForTimeout(16);
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Swipes across an element: dir is 'up' | 'down' | 'left' | 'right'. */
async function swipe(page, locator, dir) {
    const v = { up: [0, -0.3], down: [0, 0.3], left: [-0.3, 0], right: [0.3, 0] }[dir];
    await drag(page, locator, [0.5, 0.5], [0.5 + v[0], 0.5 + v[1]], 6);
}

/** Taps a point on an element; x and y are fractions of its size. */
async function tapAt(page, locator, fx = 0.5, fy = 0.5) {
    const box = await locator.boundingBox();
    await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
}

/** Page position of a point given in the canvas's own pixel coordinates. */
async function canvasToPage(locator, cx, cy) {
    const box = await locator.boundingBox();
    const size = await locator.evaluate((c) => ({ w: c.width, h: c.height }));
    return { x: box.x + (cx / size.w) * box.width, y: box.y + (cy / size.h) * box.height };
}

/** Drags a finger between two points in canvas pixel coordinates. */
async function dragCanvas(page, locator, from, to, steps = 10) {
    const a = await canvasToPage(locator, from[0], from[1]);
    const b = await canvasToPage(locator, to[0], to[1]);
    const s = await cdp(page);
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 9 }] });
    for (let i = 1; i <= steps; i++) {
        await s.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps, id: 9 }],
        });
        await page.waitForTimeout(16);
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Taps a point given in canvas pixel coordinates. */
async function tapCanvas(page, locator, cx, cy) {
    const p = await canvasToPage(locator, cx, cy);
    await page.touchscreen.tap(p.x, p.y);
}

/** Checks the standard phone setup every game must have. */
async function expectPhoneReady(page) {
    await expectFitsScreen(page);
    expect(page.__gameErrors || []).toEqual([]);
}

module.exports = {
    gameUrl, openGame, expectFitsScreen, expectPhoneReady, control, touchDown, touchUp,
    hold, tapControl, drag, swipe, tapAt, canvasToPage, dragCanvas, tapCanvas,
};

/**
 * Finds a canvas point (in canvas pixels) for which `hit(x, y)` — evaluated in
 * the page — returns `want` (compared as JSON). Lets a test tap a board cell
 * without knowing the board's geometry.
 */
async function findCanvasPoint(page, hitSource, want, selector = 'canvas') {
    return page.evaluate(({ src, wantJson, sel }) => {
        const hit = eval(src);
        const c = document.querySelector(sel);
        // Centre of all matching points, so the tap lands well inside the cell.
        let sx = 0, sy = 0, n = 0;
        for (let y = 2; y < c.height; y += 3) {
            for (let x = 2; x < c.width; x += 3) {
                const got = hit(x, y);
                if (got !== undefined && JSON.stringify(got) === wantJson) { sx += x; sy += y; n++; }
            }
        }
        return n ? [sx / n, sy / n] : null;
    }, { src: hitSource, wantJson: JSON.stringify(want), sel: selector });
}
module.exports.findCanvasPoint = findCanvasPoint;
