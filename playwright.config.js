const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// In some managed / CI / cloud environments a full Chromium binary is
// pre-installed at a fixed path and Playwright's own browser download is
// disabled. When that binary exists, point Playwright at it; otherwise fall
// back to the browser Playwright manages itself (the normal local/Windows case).
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
