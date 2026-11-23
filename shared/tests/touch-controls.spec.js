// Desktop checks for the shared touch layer: with a mouse and keyboard it
// must stay out of the way; ?touch=1 forces it on for trying it on a desktop.
const { test, expect } = require('@playwright/test');
const { gameUrl } = require('../test-helpers/touch');

test('draws no touch controls on a desktop', async ({ page }) => {
    await page.goto(gameUrl('LostSheep'));
    await expect(page.locator('#tc-bar')).toHaveCount(0);
    expect(await page.evaluate(() => TouchControls.enabled)).toBe(false);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /device-width/);
});

test('?touch=1 forces the controls on, and they send real key events', async ({ page }) => {
    await page.goto(gameUrl('LostSheep') + '?touch=1');
    await expect(page.locator('#tc-bar')).toBeVisible();
    const keys = await page.evaluate(() => {
        const seen = [];
        window.addEventListener('keydown', (e) => seen.push(`down:${e.key}:${e.code}:${e.keyCode}`));
        window.addEventListener('keyup', (e) => seen.push(`up:${e.key}`));
        window.__seen = seen;
        return seen;
    });
    expect(keys).toEqual([]);
    await page.locator('#tc-bar [data-key="ArrowLeft"]').click();
    expect(await page.evaluate(() => window.__seen)).toEqual(['down:ArrowLeft:ArrowLeft:37', 'up:ArrowLeft']);
});
