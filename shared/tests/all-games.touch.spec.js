// Every game in the catalogue must be usable on a phone: the touch layer is
// loaded, the game fits the screen without sideways scrolling, and nothing
// throws. Each game's own tests/*.touch.spec.js then plays it by touch.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { openGame, expectPhoneReady } = require('../test-helpers/touch');

const ROOT = path.resolve(__dirname, '../..');
const dirs = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'index.html')));

test.describe.configure({ mode: 'parallel' });

for (const dir of dirs) {
    test(`${dir} is ready for a phone`, async ({ page }) => {
        await openGame(page, dir);
        await expectPhoneReady(page);
    });

    test(`${dir} has its own touch play test`, async () => {
        const tests = fs.existsSync(path.join(ROOT, dir, 'tests'))
            ? fs.readdirSync(path.join(ROOT, dir, 'tests')) : [];
        expect(tests.some((f) => f.endsWith('.touch.spec.js'))).toBe(true);
    });
}
