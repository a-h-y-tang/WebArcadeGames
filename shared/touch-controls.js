/*
 * Touch controls shared by every game in WebArcadeGames.
 *
 * The games were written for a keyboard and mouse. On a phone or tablet this
 * script:
 *   - scales the page so the whole game fits the screen (by widening the
 *     layout viewport, so canvas and mouse coordinates are unchanged),
 *   - draws on-screen buttons that send the same keyboard events the game
 *     already listens for,
 *   - can turn swipes and taps on the play area into key presses,
 *   - can turn touch drags into mouse events for games steered by the mouse.
 *
 * On a desktop with a mouse nothing is drawn and the keyboard works as before.
 * Add ?touch=1 to a game's URL to force the controls on, or ?touch=0 to hide them.
 *
 * Usage, after the game's own script:
 *   <script src="../shared/touch-controls.js"></script>
 *   <script>
 *     TouchControls.init({
 *       pad: 'dpad',                         // 'dpad' | 'leftright' | 'updown' | null,
 *                                            // or { kind: 'dpad', keys: { ArrowUp: 'w', ... } }
 *       pad2: { kind: 'dpad' },              // optional second pad on the right (twin-stick)
 *       buttons: [{ label: 'Fire', key: ' ' }],
 *       swipe: '#canvas',                    // swipe on this element = arrow key
 *       tap: { target: '#overlay', key: 'Enter' }, // tap on this element = key
 *       drag: '#canvas',                     // touch drag = mouse events
 *       doubleTap: '#canvas',                // two quick taps = dblclick
 *       hint: 'Use the buttons below',       // replaces the keyboard hint text
 *     });
 *   </script>
 */
(function () {
    'use strict';

    const KEY_INFO = {
        ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40],
        ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
        ' ': ['Space', 32], Enter: ['Enter', 13], Escape: ['Escape', 27],
        Shift: ['ShiftLeft', 16], Control: ['ControlLeft', 17], Tab: ['Tab', 9],
        Backspace: ['Backspace', 8],
    };

    function keyInfo(key) {
        if (KEY_INFO[key]) return { key, code: KEY_INFO[key][0], keyCode: KEY_INFO[key][1] };
        if (/^[a-z]$/i.test(key)) {
            const up = key.toUpperCase();
            return { key, code: 'Key' + up, keyCode: up.charCodeAt(0) };
        }
        if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, keyCode: key.charCodeAt(0) };
        return { key, code: key, keyCode: 0 };
    }

    let keyTarget = null;

    /** Sends a keyboard event exactly like a real key would, as far as the games can tell. */
    function sendKey(type, key) {
        const info = keyInfo(key);
        const ev = new KeyboardEvent(type, {
            key: info.key, code: info.code, bubbles: true, cancelable: true,
        });
        // keyCode/which cannot be set through the constructor in every browser.
        Object.defineProperty(ev, 'keyCode', { get: () => info.keyCode });
        Object.defineProperty(ev, 'which', { get: () => info.keyCode });
        const target = (keyTarget && document.querySelector(keyTarget)) || document.body || document;
        target.dispatchEvent(ev);
    }

    function pressKey(key) {
        sendKey('keydown', key);
        sendKey('keyup', key);
    }

    function forcedMode() {
        const m = /[?&]touch=([01])/.exec(location.search);
        return m ? m[1] === '1' : null;
    }

    function isTouchDevice() {
        const forced = forcedMode();
        if (forced !== null) return forced;
        return window.matchMedia('(pointer: coarse)').matches ||
            (window.matchMedia('(hover: none)').matches && navigator.maxTouchPoints > 0);
    }

    const STYLE = `
html.tc-touch { touch-action: manipulation; -webkit-text-size-adjust: 100%; }
html.tc-touch body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
html.tc-touch canvas { touch-action: none; }
#tc-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
  display: flex; justify-content: space-between; align-items: flex-end;
  padding: 0.5em 0.9em calc(0.6em + env(safe-area-inset-bottom)); pointer-events: none;
  font-family: system-ui, -apple-system, sans-serif; }
#tc-bar .tc-group { display: flex; gap: 0.6em; align-items: flex-end; pointer-events: none; }
#tc-bar .tc-btn { pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent; width: 4.2em; height: 4.2em; border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.55); background: rgba(30,41,59,0.55); color: #fff;
  font: 600 0.95em/1 system-ui, -apple-system, sans-serif; display: flex; align-items: center;
  justify-content: center; text-align: center; padding: 0.2em; box-sizing: border-box; }
#tc-bar .tc-btn.tc-down { background: rgba(250,204,21,0.75); color: #111; }
#tc-bar .tc-pad { display: grid; grid-template-columns: repeat(3, 3.6em); grid-template-rows: repeat(3, 3.6em);
  gap: 0.15em; pointer-events: none; }
#tc-bar .tc-pad .tc-btn { width: 3.6em; height: 3.6em; border-radius: 0.8em; font-size: 1em; }
#tc-bar .tc-pad.tc-leftright { grid-template-rows: 3.6em; }
#tc-bar .tc-pad.tc-leftright .tc-btn { width: 4.4em; height: 4.4em; }
#tc-bar .tc-pad.tc-leftright { grid-template-columns: repeat(2, 4.4em); grid-template-rows: 4.4em; gap: 0.6em; }
#tc-bar .tc-pad.tc-updown { grid-template-columns: 4.4em; grid-template-rows: repeat(2, 4.4em); gap: 0.6em; }
#tc-bar .tc-pad.tc-updown .tc-btn { width: 4.4em; height: 4.4em; }
#tc-bar.tc-has-keypad { flex-wrap: wrap; }
#tc-bar .tc-keypad { flex: 1 0 100%; display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4em; pointer-events: none; }
#tc-bar .tc-keypad .tc-btn { width: 2.9em; height: 2.9em; border-radius: 0.6em; font-size: 1.05em; }
#tc-bar .tc-small { width: 3em; height: 3em; font-size: 0.8em; }
`;

    const ARROWS = { ArrowUp: '▲', ArrowDown: '▼', ArrowLeft: '◀', ArrowRight: '▶' };

    function makeButton(label, key, opts) {
        const btn = document.createElement('div');
        btn.className = 'tc-btn' + (opts && opts.small ? ' tc-small' : '');
        btn.textContent = label;
        btn.dataset.key = key;
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', (opts && opts.aria) || label);
        const repeat = opts && opts.repeat;
        let down = false;
        let repeatTimer = null;

        const release = (e) => {
            if (!down) return;
            down = false;
            btn.classList.remove('tc-down');
            clearTimeout(repeatTimer);
            clearInterval(repeatTimer);
            sendKey('keyup', key);
            if (e) e.preventDefault();
        };
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            if (btn.setPointerCapture) {
                try { btn.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            }
            if (down) return;
            down = true;
            btn.classList.add('tc-down');
            sendKey('keydown', key);
            if (repeat) {
                repeatTimer = setTimeout(() => {
                    repeatTimer = setInterval(() => sendKey('keydown', key), typeof repeat === 'number' ? repeat : 110);
                }, 280);
            }
        });
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('lostpointercapture', release);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
        return btn;
    }

    function makePad(spec, repeat) {
        // spec: 'dpad' | 'leftright' | 'updown', or { kind, keys: { ArrowUp: 'w', ... }, repeat }
        const kind = typeof spec === 'string' ? spec : spec.kind || 'dpad';
        const keymap = (typeof spec === 'object' && spec.keys) || {};
        if (typeof spec === 'object' && spec.repeat !== undefined) repeat = spec.repeat;
        const pad = document.createElement('div');
        pad.className = 'tc-pad tc-' + kind;
        const cells = {
            dpad: [null, 'ArrowUp', null, 'ArrowLeft', null, 'ArrowRight', null, 'ArrowDown', null],
            leftright: ['ArrowLeft', 'ArrowRight'],
            updown: ['ArrowUp', 'ArrowDown'],
        }[kind];
        for (const key of cells) {
            if (!key) {
                pad.appendChild(document.createElement('span'));
                continue;
            }
            pad.appendChild(makeButton(ARROWS[key], keymap[key] || key, { repeat, aria: key.replace('Arrow', '') }));
        }
        return pad;
    }

    function resolve(target) {
        if (!target) return null;
        return typeof target === 'string' ? document.querySelector(target) : target;
    }

    /** Swipes on the element become arrow key presses; a short tap can send a key too. */
    function attachSwipe(spec) {
        const opts = typeof spec === 'string' || spec instanceof Element ? { target: spec } : spec;
        const el = resolve(opts.target);
        if (!el) return;
        el.style.touchAction = 'none';
        let start = null;
        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            start = { x: e.clientX, y: e.clientY, sent: false };
        });
        el.addEventListener('pointermove', (e) => {
            if (!start || start.sent || !opts.continuous) return;
            const key = swipeKey(e.clientX - start.x, e.clientY - start.y, opts.min || 24);
            if (key) {
                pressKey(key);
                start = { x: e.clientX, y: e.clientY, sent: false };
            }
        });
        const end = (e) => {
            if (!start) return;
            const key = swipeKey(e.clientX - start.x, e.clientY - start.y, opts.min || 24);
            if (key && !start.sent) pressKey(key);
            else if (!key && opts.tapKey) pressKey(opts.tapKey);
            start = null;
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', () => { start = null; });
    }

    function swipeKey(dx, dy, min) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < min) return null;
        if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'ArrowRight' : 'ArrowLeft';
        return dy > 0 ? 'ArrowDown' : 'ArrowUp';
    }

    /** A tap on the element sends a key press (or a key held while the finger is down). */
    function attachTap(spec) {
        const el = resolve(spec.target);
        if (!el) return;
        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse') return;
            if (spec.ignore && e.target.closest(spec.ignore)) return;
            if (spec.hold) {
                sendKey('keydown', spec.key);
            } else {
                pressKey(spec.key);
            }
        });
        if (spec.hold) {
            const up = (e) => {
                if (e.pointerType === 'mouse') return;
                sendKey('keyup', spec.key);
            };
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
        }
    }

    /** Touch drags on the element become mousedown / mousemove / mouseup / click. */
    function attachDrag(spec) {
        const opts = typeof spec === 'string' || spec instanceof Element ? { target: spec } : spec;
        const el = resolve(opts.target);
        if (!el) return;
        el.style.touchAction = 'none';
        let startPt = null;
        const fire = (type, t, target) => {
            const ev = new MouseEvent(type, {
                bubbles: true, cancelable: true, view: window, button: 0,
                buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
                clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY,
            });
            (target || el).dispatchEvent(ev);
        };
        el.addEventListener('touchstart', (e) => {
            const t = e.changedTouches[0];
            startPt = { x: t.clientX, y: t.clientY };
            fire('mousemove', t);
            fire('mousedown', t);
            e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchmove', (e) => {
            fire('mousemove', e.changedTouches[0]);
            e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchend', (e) => {
            const t = e.changedTouches[0];
            fire('mouseup', t);
            if (opts.releaseClick || (startPt && Math.hypot(t.clientX - startPt.x, t.clientY - startPt.y) < 12)) fire('click', t);
            startPt = null;
            e.preventDefault();
        }, { passive: false });
        el.addEventListener('touchcancel', (e) => {
            fire('mouseup', e.changedTouches[0]);
            startPt = null;
        });
    }

    /**
     * Rewrites keyboard instructions the game shows (now and later) into touch
     * ones, e.g. say: [['Press P to resume', 'Tap \u23F8 to resume']].
     */
    function watchText(pairs) {
        const rules = pairs.map(([from, to]) => [typeof from === 'string' ? new RegExp(escapeRe(from), 'g') : from, to]);
        const fix = (node) => {
            const v = node.nodeValue;
            let out = v;
            for (const [re, to] of rules) out = out.replace(re, to);
            if (out !== v) node.nodeValue = out;
        };
        const walk = (root) => {
            const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = it.nextNode())) fix(n);
        };
        walk(document.body);
        new MutationObserver((muts) => {
            for (const m of muts) {
                if (m.type === 'characterData') fix(m.target);
                for (const n of m.addedNodes || []) {
                    if (n.nodeType === 3) fix(n);
                    else if (n.nodeType === 1) walk(n);
                }
            }
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    function escapeRe(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Two quick taps on the element send a dblclick, for games that use a
     * double-click (some phone browsers never send one for touch).
     */
    function attachDoubleTap(spec) {
        const el = resolve(spec);
        if (!el) return;
        let last = null;
        let nativeAt = 0;
        el.addEventListener('dblclick', (e) => {
            if (!e.__tcSynthetic) nativeAt = performance.now();
        }, true);
        el.addEventListener('pointerup', (e) => {
            if (e.pointerType === 'mouse') return;
            const now = performance.now();
            const pt = { x: e.clientX, y: e.clientY, sx: e.screenX, sy: e.screenY, t: now };
            if (last && now - last.t < 400 && Math.hypot(pt.x - last.x, pt.y - last.y) < 30) {
                last = null;
                setTimeout(() => {
                    if (performance.now() - nativeAt < 200) return; // the browser sent its own
                    const ev = new MouseEvent('dblclick', {
                        bubbles: true, cancelable: true, view: window, detail: 2,
                        clientX: pt.x, clientY: pt.y, screenX: pt.sx, screenY: pt.sy,
                    });
                    ev.__tcSynthetic = true;
                    el.dispatchEvent(ev);
                }, 60);
            } else {
                last = pt;
            }
        });
    }

    // ---------------------------------------------------------------------
    // Fit the page to the screen
    // ---------------------------------------------------------------------
    let viewportMeta = null;
    let device = null;
    let bar = null;
    let fitOpts = {};

    /** Size of the game's content in CSS pixels (independent of the zoom). */
    function contentBox() {
        let w = 0;
        let top = Infinity;
        let bottom = 0;
        for (const el of document.body.children) {
            if (el === bar || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' || cs.display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            const mx = (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
            w = Math.max(w, r.width + mx, el.scrollWidth + mx);
            top = Math.min(top, r.top - (parseFloat(cs.marginTop) || 0));
            bottom = Math.max(bottom, r.bottom + (parseFloat(cs.marginBottom) || 0));
        }
        if (top === Infinity) top = 0;
        return { w: Math.ceil(w), h: Math.ceil(bottom - top) };
    }

    function setViewport(content) {
        if (!viewportMeta) {
            viewportMeta = document.querySelector('meta[name="viewport"]');
            if (!viewportMeta) {
                viewportMeta = document.createElement('meta');
                viewportMeta.name = 'viewport';
                document.head.appendChild(viewportMeta);
            }
        }
        viewportMeta.setAttribute('content', content);
    }

    /** Screen size in device-independent pixels, whatever the page zoom is now. */
    function measureDevice() {
        const vv = window.visualViewport;
        if (vv) return { w: vv.width * vv.scale, h: vv.height * vv.scale };
        return { w: window.innerWidth, h: window.innerHeight };
    }

    let currentScale = 1;
    const BAR_FONT = 16;

    /** Zooms the page out just enough for the game and the touch buttons to fit the screen. */
    function fit() {
        if (!device) device = measureDevice();
        let barH = 0;
        if (bar) {
            const fs = parseFloat(bar.style.fontSize) || BAR_FONT;
            barH = bar.getBoundingClientRect().height * (BAR_FONT / fs); // height at scale 1
        }
        const box = contentBox();
        const margin = 10;
        const wScale = device.w / (box.w + margin);
        const hScale = (device.h - barH - margin) / (box.h + margin);
        const scale = Math.min(1, wScale, Math.max(hScale, fitOpts.minScale || 0.55));
        const layoutW = Math.round(device.w / scale);
        currentScale = device.w / layoutW;
        setViewport(`width=${layoutW}, initial-scale=${currentScale.toFixed(4)}, viewport-fit=cover`);
        if (bar) {
            // Keep the buttons the same physical size whatever the zoom.
            bar.style.fontSize = (BAR_FONT / currentScale).toFixed(2) + 'px';
            document.body.style.paddingBottom = Math.ceil((barH + margin) / currentScale) + 'px';
        }
        document.documentElement.dataset.tcScale = currentScale.toFixed(3);
    }

    function refit() {
        setViewport('width=device-width, initial-scale=1, viewport-fit=cover');
        setTimeout(() => {
            device = null;
            fit();
        }, 60);
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------
    const TouchControls = {
        enabled: false,
        sendKey,
        pressKey,
        isTouchDevice,

        init(opts) {
            opts = opts || {};
            const start = () => this._setup(opts);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', start);
            } else {
                start();
            }
        },

        _setup(opts) {
            if (!isTouchDevice()) return;
            this.enabled = true;
            this.options = opts;
            keyTarget = opts.keyTarget || null;
            fitOpts = opts;
            document.documentElement.classList.add('tc-touch');

            const style = document.createElement('style');
            style.id = 'tc-style';
            style.textContent = STYLE;
            document.head.appendChild(style);

            if (opts.pad || opts.pad2 || (opts.buttons && opts.buttons.length) || opts.keypad) {
                bar = document.createElement('div');
                bar.id = 'tc-bar';
                const left = document.createElement('div');
                left.className = 'tc-group tc-left';
                const right = document.createElement('div');
                right.className = 'tc-group tc-right';
                if (opts.pad) left.appendChild(makePad(opts.pad, opts.padRepeat));
                if (opts.pad2) right.appendChild(makePad(opts.pad2, opts.padRepeat));
                for (const b of opts.buttons || []) {
                    const btn = makeButton(b.label, b.key, b);
                    (b.side === 'left' ? left : right).appendChild(btn);
                }
                if (opts.keypad) {
                    // A row of keys, e.g. digits for a number puzzle.
                    bar.classList.add('tc-has-keypad');
                    const row = document.createElement('div');
                    row.className = 'tc-keypad';
                    for (const k of opts.keypad) {
                        const spec = typeof k === 'string' ? { key: k, label: k } : k;
                        row.appendChild(makeButton(spec.label || spec.key, spec.key, { aria: spec.aria }));
                    }
                    bar.appendChild(row);
                }
                bar.appendChild(left);
                bar.appendChild(right);
                document.body.appendChild(bar);
                if (opts.barStyle) Object.assign(bar.style, opts.barStyle);
            }

            if (opts.swipe) [].concat(opts.swipe).forEach(attachSwipe);
            if (opts.tap) [].concat(opts.tap).forEach(attachTap);
            if (opts.drag) [].concat(opts.drag).forEach(attachDrag);
            if (opts.doubleTap) [].concat(opts.doubleTap).forEach(attachDoubleTap);

            if (opts.hint) {
                const hintEl = document.querySelector(opts.hintTarget || '#controls-hint, .controls-hint');
                if (hintEl) hintEl.textContent = opts.hint;
            }
            if (opts.text) {
                for (const [sel, text] of Object.entries(opts.text)) {
                    document.querySelectorAll(sel).forEach((el) => { el.textContent = text; });
                }
            }

            if (opts.say) watchText(opts.say);

            if (opts.fit !== false) {
                fit();
                // Fonts and late layout can change the size; fit again once settled.
                window.addEventListener('load', () => fit());
                setTimeout(() => fit(), 300);
                window.addEventListener('orientationchange', () => setTimeout(refit, 250));
                let lastW = device && device.w;
                window.addEventListener('resize', () => {
                    const d = measureDevice();
                    if (lastW && Math.abs(d.w - lastW) > 40) { lastW = d.w; refit(); }
                });
            }
        },

        refit,
    };

    window.TouchControls = TouchControls;
})();
