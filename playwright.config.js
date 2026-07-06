const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// In some CI / cloud environments a full Chromium is pre-installed at a fixed
// path and Playwright's own browser download is disabled. If that executable
// exists, point the browser at it; otherwise fall back to the browser
// Playwright manages itself (the normal local-dev case).
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(PREINSTALLED_CHROMIUM)
    ? { executablePath: PREINSTALLED_CHROMIUM }
    : {};

module.exports = defineConfig({
    testDir: '.',
    testMatch: '**/tests/*.spec.js',
    timeout: 10_000,
    use: {
        headless: true,
        launchOptions,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], launchOptions },
        },
    ],
});
